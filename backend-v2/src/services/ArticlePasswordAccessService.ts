import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../core/Database';
import { IpUtils } from '../utils/IpUtils';
import {
  articleCodeDigest,
  articleIpHash,
  articleSessionTokenHash,
  normalizeArticlePassword,
  validateArticlePassword,
} from '../utils/ArticleAccess';
import { FeishuArticleAccessSyncService } from './feishu-sync/FeishuArticleAccessSyncService';

const SESSION_DAYS = 30;

const cookieValue = (req: Request, name: string): string => {
  const encodedName = encodeURIComponent(name);
  for (const entry of (req.headers.cookie || '').split(';')) {
    const [key, ...parts] = entry.trim().split('=');
    if (key === encodedName || key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
};

const setSessionCookie = (res: Response, token: string, expiresAt: Date) => {
  res.cookie(config.articleAccess.cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: config.articleAccess.cookieDomain || undefined,
    path: '/',
    expires: expiresAt,
  });
};

export type RedeemResult = {
  success: true;
  expiresAt: string;
} | {
  success: false;
  status: number;
  message: string;
};

export class ArticlePasswordAccessService {
  private static assertReady(): void {
    if (!config.articleAccess.enabled) throw new Error('文章密码访问功能未开启');
    if (config.articleAccess.pepper.length < 32) throw new Error('文章密码访问密钥配置无效');
  }

  private static async resolveSession(req: Request) {
    const token = cookieValue(req, config.articleAccess.cookieName);
    if (!token) return null;
    const tokenHash = articleSessionTokenHash(token);
    const session = await prisma.anonymousAccessSession.findUnique({ where: { tokenHash } });
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    return { session, token };
  }

  private static async createSession() {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    const session = await prisma.anonymousAccessSession.create({
      data: { tokenHash: articleSessionTokenHash(token), expiresAt },
    });
    return { session, token };
  }

  public static async redeem(req: Request, res: Response, postId: string, input: unknown): Promise<RedeemResult> {
    this.assertReady();
    const password = normalizeArticlePassword(input);
    if (validateArticlePassword(password)) {
      return { success: false, status: 401, message: '密码无效、已使用或已过期' };
    }

    const now = new Date();
    const digest = articleCodeDigest(config.articleAccess.pepper, config.feishu.dataEnvironment, password);
    const code = await prisma.articleAccessCode.findFirst({
      where: {
        environment: config.feishu.dataEnvironment,
        postId,
        codeDigest: digest,
        status: 'active',
        usedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (!code || !(await bcrypt.compare(password, code.passwordHash))) {
      return { success: false, status: 401, message: '密码无效、已使用或已过期' };
    }

    const clientIp = IpUtils.getClientIp(req);
    if (!IpUtils.isValid(clientIp)) {
      return { success: false, status: 400, message: '无法确认访问来源，请稍后重试' };
    }

    let sessionData = await this.resolveSession(req);
    const createdSession = !sessionData;
    if (!sessionData) sessionData = await this.createSession();
    const session = sessionData.session;
    const grantExpiresAt = new Date(Math.min(
      now.getTime() + code.grantHours * 60 * 60 * 1000,
      code.expiresAt?.getTime() || Number.MAX_SAFE_INTEGER,
      session.expiresAt.getTime(),
    ));
    const ipHash = code.bindIp ? articleIpHash(config.articleAccess.pepper, clientIp) : null;

    try {
      await prisma.$transaction(async tx => {
        const consumed = await tx.articleAccessCode.updateMany({
          where: { id: code.id, status: 'active', usedAt: null },
          data: { status: 'used', usedAt: now, usedIpHash: ipHash },
        });
        if (consumed.count !== 1) throw new Error('ARTICLE_CODE_ALREADY_CONSUMED');
        await tx.articleAccessGrant.create({
          data: {
            sessionId: session.id,
            postId,
            codeId: code.id,
            boundIpHash: ipHash,
            expiresAt: grantExpiresAt,
          },
        });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      // The same browser can submit twice before the first response returns.
      // If the first transaction created its grant, treat the second request as
      // idempotent instead of surfacing a false 503.
      if (!createdSession && await this.hasGrant(req, postId)) {
        return { success: true, expiresAt: grantExpiresAt.toISOString() };
      }
      // A losing concurrent request may have created a session before the
      // serializable transaction. Do not retain that unreferenced session.
      if (createdSession) {
        await prisma.anonymousAccessSession.deleteMany({
          where: { id: session.id, grants: { none: {} } },
        }).catch(() => undefined);
      }
      if (error instanceof Error && error.message === 'ARTICLE_CODE_ALREADY_CONSUMED') {
        return { success: false, status: 401, message: '密码无效、已使用或已过期' };
      }
      throw error;
    }

    setSessionCookie(res, sessionData.token, session.expiresAt);
    void FeishuArticleAccessSyncService.reportUsed(code.feishuRecordId, now, clientIp);
    return { success: true, expiresAt: grantExpiresAt.toISOString() };
  }

  public static async hasGrant(req: Request, postId: string): Promise<boolean> {
    if (!config.articleAccess.enabled || config.articleAccess.pepper.length < 32) return false;
    const sessionData = await this.resolveSession(req);
    if (!sessionData) return false;
    const grant = await prisma.articleAccessGrant.findUnique({
      where: { sessionId_postId: { sessionId: sessionData.session.id, postId } },
      include: { code: { select: { status: true } } },
    });
    if (!grant || grant.expiresAt.getTime() <= Date.now() || grant.code.status !== 'used') return false;
    if (!grant.boundIpHash) return true;
    const clientIp = IpUtils.getClientIp(req);
    return IpUtils.isValid(clientIp)
      && grant.boundIpHash === articleIpHash(config.articleAccess.pepper, clientIp);
  }

  public static async grantedPostIds(req: Request, postIds: string[]): Promise<Set<string>> {
    const uniquePostIds = [...new Set(postIds.filter(Boolean))];
    if (uniquePostIds.length === 0 || !config.articleAccess.enabled || config.articleAccess.pepper.length < 32) {
      return new Set();
    }
    const sessionData = await this.resolveSession(req);
    if (!sessionData) return new Set();
    const clientIp = IpUtils.getClientIp(req);
    const clientIpHash = IpUtils.isValid(clientIp)
      ? articleIpHash(config.articleAccess.pepper, clientIp)
      : '';
    const grants = await prisma.articleAccessGrant.findMany({
      where: {
        sessionId: sessionData.session.id,
        postId: { in: uniquePostIds },
        expiresAt: { gt: new Date() },
        code: { status: 'used' },
      },
      select: { postId: true, boundIpHash: true },
    });
    return new Set(
      grants
        .filter(grant => !grant.boundIpHash || grant.boundIpHash === clientIpHash)
        .map(grant => grant.postId),
    );
  }
}

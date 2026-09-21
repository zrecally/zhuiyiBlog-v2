import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, type CardCode } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../core/Database';
import { IpUtils } from '../utils/IpUtils';
import {
  cardCodeDigest,
  cardIpHash,
  cardRequestDigest,
  createCardDownloadTicket,
  normalizeCardCode,
  validateCardCode,
  validateRedeemRequestId,
  verifyCardDownloadTicket,
} from '../utils/CardRedeem';
import { readCardFile, type CardFileHandle } from '../utils/CardFileStorage';
import { cardOssPresignGet } from '../core/CardOssClient';
import { FeishuCardCodeSyncService } from './feishu-sync/FeishuCardCodeSyncService';
import { maskIpForAudit } from '../utils/ArticleAccess';

type CardRedeemSuccess = {
  success: true;
  productName: string;
  download: {
    fileName: string;
    mediaType: string;
    fileSize: number;
    url: string;
    expiresAt: string;
  };
  replayed?: boolean;
};

export type CardRedeemResult = CardRedeemSuccess | {
  success: false;
  status: number;
  message: string;
};

type DownloadGrant = {
  id: string;
  issuedAt: Date;
  expiresAt: Date;
};

type DownloadAudit = {
  grantId: string;
  fileSize: number;
  cardId: number;
  codeHint: string;
  fileKey: string;
};

export type ResolvedCardDownload = (DownloadAudit & {
  storage: 'local';
  filePath: string;
  fileName: string;
  mediaType: string;
}) | (DownloadAudit & {
  storage: 'oss';
  redirectUrl: string;
}) | {
  storage: 'blocked';
  reason: 'already_issued';
};

export type DownloadPreflightResult = 'ready' | 'already_issued' | 'invalid';

type DownloadGrantDecision = {
  created: true;
  grant: DownloadGrant;
} | {
  created: false;
};

type DownloadCard = CardCode & {
  usedAt: Date;
  usedIpHash: string;
  replayExpiresAt: Date;
  fileKey: string;
  fileName: string;
  fileMediaType: string;
  fileSize: number;
};

const unavailable = (): CardRedeemResult => ({
  success: false,
  status: 401,
  message: '卡密无效、已使用或已过期',
});

class DownloadGrantDeniedError extends Error {}
class DownloadGrantRaceError extends Error {}

const isSerializableConflict = (error: unknown): boolean => (
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
);

export class CardRedemptionService {
  private static assertReady() {
    if (!config.cardRedeem.enabled) throw new Error('卡密提取功能未开启');
    if (config.cardRedeem.secret.length < 32) throw new Error('卡密提取密钥配置无效');
    if (config.cardRedeem.previousSecrets.some(secret => secret.length < 32)) {
      throw new Error('卡密旧密钥配置无效');
    }
  }

  private static secrets(): string[] {
    return [config.cardRedeem.secret, ...config.cardRedeem.previousSecrets];
  }

  private static async findCardByCode(environment: string, code: string) {
    for (const secret of this.secrets()) {
      const digest = cardCodeDigest(secret, environment, code);
      const card = await prisma.cardCode.findUnique({
        where: { environment_codeDigest: { environment, codeDigest: digest } },
      });
      if (card) return { card, secret, digest };
    }
    return null;
  }

  private static fileIdentity(card: { fileEtag: string | null; fileVersionId: string | null }) {
    return { etag: card.fileEtag, versionId: card.fileVersionId };
  }

  private static async reveal(card: {
    id: number;
    productName: string;
    fileKey: string | null;
    fileName: string | null;
    fileMediaType: string | null;
    fileSize: number | null;
    fileEtag: string | null;
    fileVersionId: string | null;
    replayExpiresAt: Date | null;
    usedIpHash: string | null;
  }, secret: string, replayed = false): Promise<CardRedeemSuccess> {
    if (
      !card.fileKey
      || !card.fileName
      || !card.fileMediaType
      || card.fileSize === null
      || !card.replayExpiresAt
      || !card.usedIpHash
    ) throw new Error('卡密文件元数据不完整');

    await readCardFile(card.fileKey, card.fileSize, this.fileIdentity(card));
    // Request replay remains available long enough to recover a lost POST
    // response, while the URL-carried ticket itself stays short-lived.
    const ticketExpiresAt = new Date(Math.min(
      card.replayExpiresAt.getTime(),
      Date.now() + config.cardRedeem.downloadTicketMinutes * 60 * 1000,
    ));
    const ticket = createCardDownloadTicket(secret, {
      cardId: card.id,
      expiresAt: ticketExpiresAt.getTime(),
      ipHash: card.usedIpHash,
    });
    return {
      success: true,
      productName: card.productName,
      download: {
        fileName: card.fileName,
        mediaType: card.fileMediaType,
        fileSize: card.fileSize,
        url: `/api/v1/cards/download/${encodeURIComponent(ticket)}`,
        expiresAt: ticketExpiresAt.toISOString(),
      },
      replayed,
    };
  }

  public static async redeem(codeInput: unknown, requestIdInput: unknown, clientIp: string): Promise<CardRedeemResult> {
    this.assertReady();
    const code = normalizeCardCode(codeInput);
    if (validateCardCode(code) || !validateRedeemRequestId(requestIdInput)) return unavailable();
    if (!IpUtils.isValid(clientIp)) {
      return { success: false, status: 400, message: '无法确认访问来源，请稍后重试' };
    }

    const now = new Date();
    const environment = config.feishu.dataEnvironment;
    const found = await this.findCardByCode(environment, code);
    if (!found) return unavailable();
    const { card, secret, digest } = found;
    const requestDigest = cardRequestDigest(secret, environment, requestIdInput);
    const usedIpHash = cardIpHash(secret, clientIp);

    if (
      card.status === 'used'
      && card.replayTokenHash === requestDigest
      && card.usedIpHash === usedIpHash
      && card.replayExpiresAt
      && card.replayExpiresAt.getTime() > now.getTime()
    ) {
      return this.reveal(card, secret, true);
    }
    if (card.status !== 'active' || card.usedAt || (card.expiresAt && card.expiresAt <= now)) {
      return unavailable();
    }
    if (!(await bcrypt.compare(code, card.codeHash))) return unavailable();
    if (!card.fileKey || !card.fileName || !card.fileMediaType || card.fileSize === null) {
      return { success: false, status: 503, message: '对应文件暂不可用，请联系销售方' };
    }
    try {
      await readCardFile(card.fileKey, card.fileSize, this.fileIdentity(card));
    } catch {
      return { success: false, status: 503, message: '对应文件暂不可用，请联系销售方' };
    }

    const replayExpiresAt = new Date(now.getTime() + config.cardRedeem.replayMinutes * 60 * 1000);
    const consumed = await prisma.cardCode.updateMany({
      where: {
        id: card.id,
        codeDigest: digest,
        updatedAt: card.updatedAt,
        status: 'active',
        usedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        status: 'used',
        usedAt: now,
        usedIpHash,
        replayTokenHash: requestDigest,
        replayExpiresAt,
        downloadGrantId: null,
        downloadGrantIssuedAt: null,
        downloadGrantExpiresAt: null,
      },
    });

    if (consumed.count !== 1) {
      const concurrent = await prisma.cardCode.findUnique({ where: { id: card.id } });
      if (
        concurrent
        && concurrent.status === 'used'
        && concurrent.replayTokenHash === requestDigest
        && concurrent.usedIpHash === usedIpHash
        && concurrent.replayExpiresAt
        && concurrent.replayExpiresAt.getTime() > Date.now()
      ) {
        return this.reveal(concurrent, secret, true);
      }
      return unavailable();
    }

    if (card.feishuRecordId) {
      void FeishuCardCodeSyncService.reportUsed(card.feishuRecordId, now, clientIp);
    }
    return this.reveal({ ...card, replayExpiresAt, usedIpHash }, secret);
  }

  private static async createGrant(card: {
    id: number;
    codeHint: string;
    fileKey: string;
    fileSize: number;
    usedAt: Date;
    usedIpHash: string;
    replayExpiresAt: Date;
    downloadGrantId: string | null;
    downloadGrantIssuedAt: Date | null;
    downloadGrantExpiresAt: Date | null;
  }, storage: CardFileHandle['storage'], clientIp: string): Promise<DownloadGrantDecision | null> {
    if (card.downloadGrantId) return { created: false };
    // A grant is intentionally one-shot per redemption lifecycle. An expired
    // grant requires an administrator reset instead of silently issuing a new URL.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = new Date();
      const grant: DownloadGrant = {
        id: randomUUID(),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + config.cardRedeem.oss.presignTtlSeconds * 1000),
      };
      try {
        return await prisma.$transaction(async tx => {
          const latest = await tx.cardCode.findUnique({ where: { id: card.id } });
          if (latest?.downloadGrantId) return { created: false } as DownloadGrantDecision;
          if (
            !latest
            || latest.downloadGrantId
            || latest.status !== 'used'
            || latest.usedAt?.getTime() !== card.usedAt.getTime()
            || latest.usedIpHash !== card.usedIpHash
            || !latest.replayExpiresAt
            || latest.replayExpiresAt.getTime() <= now.getTime()
          ) throw new DownloadGrantDeniedError();

          // Do not issue a second grant to a still-live redemption created by
          // an older application version that already recorded a download.
          const legacyIssued = await tx.cardDownloadLog.count({
            where: {
              cardId: card.id,
              createdAt: { gte: card.usedAt },
              status: { in: ['link_issued', 'completed'] },
            },
          });
          if (legacyIssued > 0) throw new DownloadGrantDeniedError();

          if (config.cardRedeem.dailyDownloadBytesLimit > 0) {
            const startOfToday = new Date(now);
            startOfToday.setHours(0, 0, 0, 0);
            const today = await tx.cardDownloadLog.aggregate({
              where: { status: { in: ['link_issued', 'completed'] }, createdAt: { gte: startOfToday } },
              _sum: { bytes: true },
            });
            const reserved = today._sum.bytes ?? 0;
            if (reserved + card.fileSize > config.cardRedeem.dailyDownloadBytesLimit) {
              console.error(
                `[CardRedeem] 今日下载授权将超过熔断阈值(${reserved}+${card.fileSize}>${config.cardRedeem.dailyDownloadBytesLimit})`,
              );
              throw new DownloadGrantDeniedError();
            }
          }

          const claimed = await tx.cardCode.updateMany({
            where: {
              id: card.id,
              status: 'used',
              usedAt: card.usedAt,
              usedIpHash: card.usedIpHash,
              downloadGrantId: null,
            },
            data: {
              downloadGrantId: grant.id,
              downloadGrantIssuedAt: grant.issuedAt,
              downloadGrantExpiresAt: grant.expiresAt,
            },
          });
          if (claimed.count !== 1) throw new DownloadGrantRaceError();

          // The grant and its quota reservation commit together. A failed log
          // insert rolls the card claim back, so the controller never fails open.
          await tx.cardDownloadLog.create({
            data: {
              grantId: grant.id,
              cardId: card.id,
              codeHint: card.codeHint,
              fileKey: card.fileKey,
              bytes: card.fileSize,
              ipMasked: maskIpForAudit(clientIp),
              storage,
              status: 'link_issued',
            },
          });
          return { created: true, grant } as DownloadGrantDecision;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isSerializableConflict(error) && attempt < 2) continue;
        if (error instanceof DownloadGrantRaceError || isSerializableConflict(error)) {
          const latest = await prisma.cardCode.findUnique({ where: { id: card.id } });
          return latest?.downloadGrantId ? { created: false } : null;
        }
        if (error instanceof DownloadGrantDeniedError) return null;
        throw error;
      }
    }
    return null;
  }

  private static async findDownloadCard(ticket: unknown, clientIp: string): Promise<DownloadCard | null> {
    if (typeof ticket !== 'string' || !IpUtils.isValid(clientIp)) return null;
    let verified: { payload: NonNullable<ReturnType<typeof verifyCardDownloadTicket>>; secret: string } | null = null;
    for (const secret of this.secrets()) {
      const payload = verifyCardDownloadTicket(secret, ticket);
      if (payload) {
        verified = { payload, secret };
        break;
      }
    }
    if (!verified) return null;
    const { payload, secret } = verified;
    const currentIpHash = cardIpHash(secret, clientIp);
    if (payload.ipHash !== currentIpHash) return null;

    const card = await prisma.cardCode.findUnique({ where: { id: payload.cardId } });
    if (
      !card
      || card.status !== 'used'
      || card.usedIpHash !== currentIpHash
      || !card.usedAt
      || !card.replayExpiresAt
      || card.replayExpiresAt.getTime() < Date.now()
      || !card.fileKey
      || !card.fileName
      || !card.fileMediaType
      || card.fileSize === null
    ) return null;
    return card as DownloadCard;
  }

  public static async preflightDownload(ticket: unknown, clientIp: string): Promise<DownloadPreflightResult> {
    this.assertReady();
    const card = await this.findDownloadCard(ticket, clientIp);
    if (!card) return 'invalid';
    if (card.downloadGrantId) return 'already_issued';

    // Compatibility guard for links issued before persisted grant fields were
    // introduced. A historical log still makes this redemption one-shot.
    const legacyIssued = await prisma.cardDownloadLog.count({
      where: {
        cardId: card.id,
        createdAt: { gte: card.usedAt! },
        status: { in: ['link_issued', 'completed'] },
      },
    });
    return legacyIssued > 0 ? 'already_issued' : 'ready';
  }

  public static async resolveDownload(ticket: unknown, clientIp: string): Promise<ResolvedCardDownload | null> {
    this.assertReady();
    const card = await this.findDownloadCard(ticket, clientIp);
    if (!card) return null;

    const handle = await readCardFile(card.fileKey, card.fileSize, this.fileIdentity(card));
    const decision = await this.createGrant({
      id: card.id,
      codeHint: card.codeHint,
      fileKey: card.fileKey,
      fileSize: card.fileSize,
      usedAt: card.usedAt,
      usedIpHash: card.usedIpHash,
      replayExpiresAt: card.replayExpiresAt,
      downloadGrantId: card.downloadGrantId,
      downloadGrantIssuedAt: card.downloadGrantIssuedAt,
      downloadGrantExpiresAt: card.downloadGrantExpiresAt,
    }, handle.storage, clientIp);
    if (!decision) return null;
    if (!decision.created) return { storage: 'blocked', reason: 'already_issued' };
    const { grant } = decision;

    const audit: DownloadAudit = {
      grantId: grant.id,
      cardId: card.id,
      codeHint: card.codeHint,
      fileKey: card.fileKey,
      fileSize: card.fileSize,
    };
    if (handle.storage === 'local') {
      return {
        ...audit,
        storage: 'local',
        filePath: handle.filePath,
        fileName: card.fileName,
        mediaType: card.fileMediaType,
      };
    }

    const expiresInSeconds = Math.max(60, Math.floor(
      (grant.expiresAt.getTime() - grant.issuedAt.getTime()) / 1000,
    ));
    const { url } = await cardOssPresignGet(card.fileKey, card.fileName, {
      signingDate: grant.issuedAt,
      expiresInSeconds,
      versionId: card.fileVersionId,
    });
    return { ...audit, storage: 'oss', redirectUrl: url };
  }

  public static async markLocalDownloadCompleted(grantId: string): Promise<void> {
    await prisma.cardDownloadLog.updateMany({
      where: { grantId, storage: 'local', status: 'link_issued' },
      data: { status: 'completed' },
    });
  }
}

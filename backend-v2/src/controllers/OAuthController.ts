import { Request, Response } from 'express';
import path from 'node:path';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import https from 'https';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../core/Database';
import { FeishuIdentitySyncService } from '../services/feishu-sync/FeishuIdentitySyncService';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const BACKEND_URL = config.backendUrl;
const OAUTH_STATE_COOKIE = 'zhuiyi_oauth_state';

function readCookie(req: Request, name: string): string {
  const prefix = `${name}=`;
  const item = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value.slice(0, 2048);
}

function beginOAuth(provider: string, scope: string[]) {
  return (req: Request, res: Response, next: unknown) => {
    const nonce = randomBytes(24).toString('base64url');
    const state = jwt.sign({ kind: 'oauth-state', nonce, returnTo: safeReturnTo(req.query.returnTo) }, config.jwtSecret, { expiresIn: '10m' });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${OAUTH_STATE_COOKIE}=${encodeURIComponent(nonce)}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
    passport.authenticate(provider, { scope, state })(req, res, next);
  };
}

type OAuthExchangeError = {
  statusCode?: number;
  data?: unknown;
};

function describeOAuthExchangeError(error: unknown): Record<string, unknown> {
  const passportError = error as { oauthError?: OAuthExchangeError; message?: string } | undefined;
  const oauthError = passportError?.oauthError;
  let body: unknown = oauthError?.data;

  if (typeof body === 'string') {
    const rawBody = body;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      // Some OAuth servers return an urlencoded error response. Keep logging
      // bounded and never include a raw authorization code or client secret.
      body = rawBody.slice(0, 500);
    }
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    return {
      statusCode: oauthError?.statusCode,
      error: typeof record.error === 'string' ? record.error : undefined,
      description: typeof record.error_description === 'string' ? record.error_description : undefined,
    };
  }

  return { statusCode: oauthError?.statusCode, message: passportError?.message, response: body };
}

function attachGithubMtlsAgent(strategy: GitHubStrategy): boolean {
  if (process.env.MTLS_PROXY_ENABLED !== 'true') return true;

  try {
    const clientCertPath = process.env.MTLS_CLIENT_CERT_PATH;
    const clientKeyPath = process.env.MTLS_CLIENT_KEY_PATH;
    const serverCaPath = process.env.MTLS_PROXY_SERVER_CA_CERT_PATH || process.env.MTLS_CA_CERT_PATH;
    if (!clientCertPath || !clientKeyPath) {
      throw new Error('MTLS_CLIENT_CERT_PATH and MTLS_CLIENT_KEY_PATH are required when MTLS_PROXY_ENABLED=true');
    }

    // 证书路径兼容两种运行环境：容器内（cwd=/app）与宿主机（cwd=backend-v2）。
    // 按原值、cwd 相对、仓库根相对的顺序取第一个真实存在的文件。
    const resolveCertPath = (p: string): string => {
      if (path.isAbsolute(p) && fs.existsSync(p)) return p;
      const candidates = [path.resolve(process.cwd(), p), path.resolve(process.cwd(), '..', p)];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
      return p;
    };

    const agentOptions: https.AgentOptions = {
      cert: fs.readFileSync(resolveCertPath(clientCertPath)),
      key: fs.readFileSync(resolveCertPath(clientKeyPath)),
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    };
    if (serverCaPath) agentOptions.ca = fs.readFileSync(resolveCertPath(serverCaPath));

    // node-oauth has a supported setAgent API.  Do not replace its private
    // _executeRequest implementation: that bypasses status-code handling and
    // turns a useful GitHub 400 response into a generic missing-token error.
    (strategy as any)._oauth2.setAgent(new https.Agent(agentOptions));
    logger.info('[OAuth] GitHub Strategy 已挂载 mTLS 代理 Agent');
    return true;
  } catch (error) {
    logger.error('[OAuth] GitHub mTLS 代理初始化失败:', error);
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncUser(profile: any, provider: string, emailStr?: string) {
  try {
    const email = emailStr || profile.emails?.[0]?.value || `${profile.username || profile.id}@${provider}.com`;
    const username = profile.username || profile.displayName || `${provider}_user_${profile.id}`;
    const avatar = profile.photos?.[0]?.value || '/avatars/default.svg';

    let userRecord = await prisma.user.findUnique({ where: { email } });
    if (!userRecord) {
      userRecord = await prisma.user.create({
        data: {
          email,
          username,
          avatar,
          avatarDark: '/avatars/default.svg',
          isActive: true,
        }
      });
    }

    const user = {
      id: userRecord.id,
      username: userRecord.username,
      email: userRecord.email,
      avatar: userRecord.avatar,
      provider
    };

    await FeishuIdentitySyncService.queueUserUpsertToFeishu(userRecord, provider);
    logger.info(`[OAuth] Saved latest user state for ${user.username} in Feishu`);

    return user;
  } catch (error) {
    logger.error(`[OAuth] Failed to sync ${provider} user:`, error);
    return {
      id: profile.id,
      username: profile.username || profile.displayName || `${provider}_user`,
      email: emailStr || profile.emails?.[0]?.value || '',
      avatar: profile.photos?.[0]?.value || '',
      provider
    };
  }
}

// GitHub
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const githubOptions: any = {
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/api/v1/auth/github/callback`,
    userAgent: 'zhuiyi-github-oauth',
    customHeaders: { Accept: 'application/json' },
  };

  // 如果后端在国内，无法直接访问 github.com，可以通过配置代理
  if (process.env.GITHUB_PROXY_BASE) {
    githubOptions.tokenURL = `${process.env.GITHUB_PROXY_BASE}/login/oauth/access_token`;
  }
  if (process.env.GITHUB_API_PROXY_BASE) {
    githubOptions.userProfileURL = `${process.env.GITHUB_API_PROXY_BASE}/user`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategy = new GitHubStrategy(githubOptions, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    const user = await syncUser(profile, 'github');
    return done(null, user);
  });

  // If mTLS is required but cannot be initialized, do not silently fall back
  // to an unauthenticated outbound connection.
  if (attachGithubMtlsAgent(strategy)) passport.use(strategy);
}

// Google
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/api/v1/auth/google/callback`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    const user = await syncUser(profile, 'google');
    return done(null, user);
  }));
}

// Facebook
if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/api/v1/auth/facebook/callback`,
    profileFields: ['id', 'displayName', 'photos', 'email']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    const user = await syncUser(profile, 'facebook');
    return done(null, user);
  }));
}

// Discord
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/api/v1/auth/discord/callback`,
    scope: ['identify', 'email']
  } as any, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    const user = await syncUser(profile, 'discord', profile.email);
    return done(null, user);
  }));
}

// Microsoft
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  passport.use(new MicrosoftStrategy({
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/api/v1/auth/microsoft/callback`,
    scope: ['user.read', 'email']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    const user = await syncUser(profile, 'microsoft', profile.emails?.[0]?.value);
    return done(null, user);
  }));
}

export class OAuthController {

  private static generateCallback(provider: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (req: Request, res: Response, next: any) => {
      let state: { kind?: string; nonce?: string; returnTo?: string };
      try {
        state = jwt.verify(String(req.query.state || ''), config.jwtSecret) as typeof state;
        const cookieNonce = readCookie(req, OAUTH_STATE_COOKIE);
        const left = Buffer.from(cookieNonce);
        const right = Buffer.from(state.nonce || '');
        if (state.kind !== 'oauth-state' || !left.length || left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('invalid state');
      } catch {
        return res.status(400).json({ success: false, message: 'OAuth 登录状态无效或已过期' });
      }
      res.setHeader('Set-Cookie', `${OAUTH_STATE_COOKIE}=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      passport.authenticate(provider, { session: false }, (err: any, user: any) => {
        const returnTo = safeReturnTo(state.returnTo);

        if (err || !user) {
          logger.error(`[OAuth] ${provider} login failed`, describeOAuthExchangeError(err));
          return res.redirect(`${config.frontendUrl}${returnTo}?error=oauth_failed`);
        }

        // 修复 H2: OAuth JWT 缺 id、硬编码 role
        const token = jwt.sign(
          { id: user.id, email: user.email, username: user.username, avatar: user.avatar, role: 'user' },
          config.jwtSecret,
          { expiresIn: '7d' }
        );
        const separator = returnTo.includes('?') ? '&' : '?';
        return res.redirect(`${config.frontendUrl}${returnTo}${separator}token=${token}`);
      })(req, res, next);
    };
  }

  // GitHub
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static githubLogin(req: Request, res: Response, next: any) {
    if (!process.env.GITHUB_CLIENT_ID) return res.status(503).json({ error: 'GitHub OAuth is not configured' });
    beginOAuth('github', ['user:email'])(req, res, next);
  }
  public static githubCallback = OAuthController.generateCallback('github');

  // Google
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static googleLogin(req: Request, res: Response, next: any) {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth is not configured' });
    beginOAuth('google', ['profile', 'email'])(req, res, next);
  }
  public static googleCallback = OAuthController.generateCallback('google');

  // Facebook
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static facebookLogin(req: Request, res: Response, next: any) {
    if (!process.env.FACEBOOK_CLIENT_ID) return res.status(503).json({ error: 'Facebook OAuth is not configured' });
    beginOAuth('facebook', ['email'])(req, res, next);
  }
  public static facebookCallback = OAuthController.generateCallback('facebook');

  // Discord
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static discordLogin(req: Request, res: Response, next: any) {
    if (!process.env.DISCORD_CLIENT_ID) return res.status(503).json({ error: 'Discord OAuth is not configured' });
    beginOAuth('discord', ['identify', 'email'])(req, res, next);
  }
  public static discordCallback = OAuthController.generateCallback('discord');

  // Microsoft
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static microsoftLogin(req: Request, res: Response, next: any) {
    if (!process.env.MICROSOFT_CLIENT_ID) return res.status(503).json({ error: 'Microsoft OAuth is not configured' });
    beginOAuth('microsoft', ['user.read', 'email'])(req, res, next);
  }
  public static microsoftCallback = OAuthController.generateCallback('microsoft');
}

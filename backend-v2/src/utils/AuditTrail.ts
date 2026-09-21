import { Request } from 'express';
import { prisma } from '../core/Database';
import { IpUtils } from './IpUtils';

/**
 * 管理端操作统一审计（总日志）。
 *  - action 用 UPPER_SNAKE 事件名（与既有 AUTO_BAN / CLEAR_CACHE 等一致）；
 *  - details 面向管理员可读，禁止携带卡密/授权码明文与密钥；
 *  - 写入失败只记日志，不阻塞业务响应。
 */
export function auditTrail(req: Request, action: string, details: string): void {
  void prisma.auditLog.create({
    data: { ip: IpUtils.getClientIp(req), action, details },
  }).catch(error => console.error('[AuditTrail] 写入审计日志失败:', error));
}

/**
 * 总审计分类 → action 前缀映射（CardDeck 全站审计页的标签过滤）。
 * 未匹配的 action 归入「其他/系统」；映射保持单向追加，不改写既有事件名。
 */
export const AUDIT_CATEGORY_PREFIXES: Record<string, string[]> = {
  security: ['AUTO_BAN', 'LOGIN', 'STRICT', 'SECURITY', 'IP_', 'RATE_'],
  card: ['CARD_', 'REDEEM_'],
  license: ['LICENSE_', 'PLUGIN_'],
  site: ['BEIJING_', 'STATIC_', 'SNAPSHOT_', 'POLL', 'ALBUM_'],
  system: ['CLEAR_CACHE', 'SYSTEM_', 'CONFIG_', 'CACHE_'],
};

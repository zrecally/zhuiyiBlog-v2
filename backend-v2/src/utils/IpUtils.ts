import { Request } from 'express';
import { isIP } from 'node:net';

export class IpUtils {
  public static normalize(ip: unknown): string {
    if (typeof ip !== 'string') return '';
    const trimmed = ip.trim();
    return trimmed.slice(0, 7).toLowerCase() === '::ffff:' && isIP(trimmed.slice(7)) === 4
      ? trimmed.slice(7) : trimmed;
  }

  public static isValid(ip: unknown): boolean {
    return isIP(IpUtils.normalize(ip)) !== 0;
  }

  public static getClientIp(req: Request): string {
    // 强制依赖 Express 框架基于 trust proxy 配置所解析出来的真实 IP。
    // 严禁自行从 headers 读取 X-Real-IP/X-Forwarded-For，防止客户端伪造头绕过安全限制。
    try {
      const ip = IpUtils.normalize(req.ip);
      return IpUtils.isValid(ip) ? ip : 'unknown';
    } catch {
      // A detached socket or malformed forwarding chain must not make error logging throw.
      // Do not fall back to the proxy's LAN address: that could bypass IP restrictions.
      return 'unknown';
    }
  }

  public static isLAN(ip: unknown): boolean {
    const normalized = IpUtils.normalize(ip);
    if (!IpUtils.isValid(normalized)) return false;
    if (normalized === '127.0.0.1' || normalized === '::1') return true;
    if (normalized.startsWith('192.168.')) return true;
    if (normalized.startsWith('10.')) return true;
    if (normalized.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true;
    return false;
  }

  public static isTrustedProxy(ip: unknown, trustedIps: readonly string[] = []): boolean {
    const normalized = IpUtils.normalize(ip);
    if (!IpUtils.isValid(normalized)) return false;
    return IpUtils.isLAN(normalized) || trustedIps.some(candidate => IpUtils.normalize(candidate) === normalized);
  }
}

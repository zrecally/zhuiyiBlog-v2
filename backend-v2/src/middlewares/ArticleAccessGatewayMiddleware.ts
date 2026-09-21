import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { IpUtils } from '../utils/IpUtils';

const safeSecretMatch = (provided: string, expected: string): boolean => {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const requireArticleAccessGateway = (req: Request, res: Response, next: NextFunction) => {
  if (!config.articleAccess.enabled) return res.status(404).end();

  const sourceIp = IpUtils.normalize(req.socket.remoteAddress || 'unknown');
  const sourceAllowed = config.articleAccess.gatewayProxyIps.includes(sourceIp)
    || (config.articleAccess.allowLanGateway && IpUtils.isLAN(sourceIp));
  const secretAllowed = safeSecretMatch(
    req.get('x-zhuiyi-access-gateway') || '',
    config.articleAccess.gatewaySecret,
  );

  if (!sourceAllowed || !secretAllowed) {
    // Do not disclose that a private gateway exists.
    return res.status(404).end();
  }
  next();
};

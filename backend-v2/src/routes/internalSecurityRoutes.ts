import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config';
import {
  banClientIp,
  beijingStaticAutoBanLimiter,
  blacklistedIPs,
} from '../middlewares/RateLimitMiddleware';
import { IpUtils } from '../utils/IpUtils';

const router = Router();

const safeSecretMatches = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
};

router.use((req, res, next) => {
  const peerIp = IpUtils.normalize(req.socket.remoteAddress || '');
  const providedSecret = req.get('x-zhuiyi-internal-secret') || '';
  const sourceAllowed = config.internalSecurity.allowedProxyIps.includes(peerIp);
  const secretConfigured = config.internalSecurity.sharedSecret.length >= 32;

  if (!sourceAllowed || !secretConfigured
      || !safeSecretMatches(providedSecret, config.internalSecurity.sharedSecret)) {
    // Return 404 so the private control-plane route is not disclosed.
    return res.sendStatus(404);
  }

  next();
});

const readTargetIp = (value: string | undefined): string | null => {
  if (!value) return null;
  const normalized = IpUtils.normalize(value);
  if (!IpUtils.isValid(normalized) || IpUtils.isLAN(normalized)) return null;
  return normalized;
};

router.get('/ip-status', (req, res, next) => {
  const clientIp = readTargetIp(req.get('x-zhuiyi-client-ip'));
  if (!clientIp) return res.sendStatus(400);
  if (blacklistedIPs.has(clientIp)) return res.sendStatus(403);
  return next();
}, beijingStaticAutoBanLimiter, (req, res) => {
  return res.sendStatus(204);
});

router.post('/ban', (req, res) => {
  const clientIp = readTargetIp(req.get('x-zhuiyi-client-ip'));
  if (!clientIp) return res.sendStatus(400);

  const requestUri = (req.get('x-zhuiyi-request-uri') || '/').slice(0, 2048);
  const source = (req.get('x-zhuiyi-source') || 'unknown-proxy').slice(0, 50);

  banClientIp(clientIp, {
    maxRequests: 150,
    source,
    url: requestUri,
  });

  // Let the browser render the same explanatory page used by the interactive
  // frontend. The Beijing Nginx permits only this static route and assets.
  return res.redirect(302, '/banned');
});

export default router;

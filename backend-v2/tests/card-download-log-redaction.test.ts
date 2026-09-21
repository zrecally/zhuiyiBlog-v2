import assert from 'node:assert/strict';
import test from 'node:test';
import { requestTargetForLogs } from '../src/middlewares/TraceMiddleware';

test('download tickets are redacted from logs and alert targets', () => {
  const token = 'eyJ2ZXJzaW9uIjoxLCJjYXJkSWQiOjF9.secret-signature';
  const redacted = requestTargetForLogs({
    originalUrl: `/api/v1/cards/download/${token}?source=retry`,
  } as any);
  assert.equal(redacted, '/api/v1/cards/download/[redacted]?source=retry');
  assert.equal(redacted.includes(token), false);
});

test('ordinary request targets remain unchanged', () => {
  assert.equal(
    requestTargetForLogs({ originalUrl: '/api/v1/posts?page=2' } as any),
    '/api/v1/posts?page=2',
  );
});

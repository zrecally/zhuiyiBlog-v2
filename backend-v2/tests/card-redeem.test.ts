import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardCodeDigest,
  cardIssueRequestFingerprint,
  cardIpHash,
  cardRequestDigest,
  createCardDownloadTicket,
  decryptCardIssueCodes,
  encryptCardIssueCodes,
  normalizeCardCode,
  validateCardCode,
  validateRedeemRequestId,
  verifyCardDownloadTicket,
} from '../src/utils/CardRedeem';
import { cardFileMediaType, sanitizeCardFileName } from '../src/utils/CardFileStorage';
import {
  CARD_CODE_ALPHABET,
  CARD_CODE_LENGTH,
  generateCardCode,
  generateCardCodes,
  isValidCardCode,
} from '../src/utils/CardCodeRule';

const secret = 'local-test-secret-that-is-longer-than-32-characters';

test('card rule only accepts 20-character case-sensitive alphanumeric codes', () => {
  const generated = generateCardCode();
  assert.equal(generated.code.length, CARD_CODE_LENGTH);
  assert.equal(isValidCardCode(generated.code), true);
  assert.match(generated.display, /^([A-Za-z0-9]{5}-){3}[A-Za-z0-9]{5}$/);
  assert.equal(isValidCardCode(generated.display.replace(/-/g, '')), true);

  assert.equal(isValidCardCode('ABCD1234'), false);
  assert.equal(isValidCardCode('A'.repeat(19)), false);
  assert.equal(isValidCardCode('A'.repeat(21)), false);
  assert.equal(isValidCardCode('A'.repeat(20) + '!'), false);
  assert.equal(isValidCardCode(''), false);
  assert.equal(isValidCardCode(undefined as unknown as string), false);
});

test('card normalization keeps case while validation stays strict', () => {
  const generated = generateCardCode();
  const spaced = generated.code.replace(/(.{5})(?=.{5})/g, '$1-');
  assert.equal(normalizeCardCode(` ${spaced} `), generated.code);
  assert.equal(validateCardCode(normalizeCardCode(spaced)), null);
  // 区分大小写：大小写变化后仍是合法形态，但代表不同卡密
  const flipped = /[a-z]/.test(generated.code)
    ? generated.code.replace(/[a-z]/, c => c.toUpperCase())
    : `a${generated.code.slice(1)}`;
  assert.equal(validateCardCode(flipped), null);
  assert.notEqual(cardCodeDigest(secret, 'Test', generated.code), cardCodeDigest(secret, 'Test', flipped));
  assert.match(validateCardCode('ABCD1234') || '', /不符合规则/);
  assert.match(validateCardCode(`${generated.code.slice(0, -1)}!`) || '', /不符合规则/);
  assert.equal(validateRedeemRequestId('01991e8b-d8f0-7b30-a1e1-c18181adfe22'), true);
  assert.equal(validateRedeemRequestId('too-short'), false);
});

test('card generator is random, in-alphabet, and deduplicates batches', () => {
  const batch = generateCardCodes(200);
  const codes = new Set(batch.map(item => item.code));
  assert.equal(codes.size, batch.length);
  for (const item of batch) {
    assert.equal(item.code.length, CARD_CODE_LENGTH);
    for (const char of item.code) {
      assert.ok(CARD_CODE_ALPHABET.includes(char), `unexpected char ${char}`);
    }
  }
  const sample = batch.slice(0, 100).map(item => item.code).join('');
  const coverage = new Set(sample.split(''));
  assert.equal(coverage.size >= 25, true, 'alphabet coverage too narrow for random output');
  assert.throws(() => generateCardCodes(0));
  assert.throws(() => generateCardCodes(10001));
});

test('card and retry digests are deterministic and scoped', () => {
  assert.equal(cardCodeDigest(secret, 'Test', 'ABCD1234'), cardCodeDigest(secret, 'Test', 'ABCD1234'));
  assert.notEqual(cardCodeDigest(secret, 'Test', 'ABCD1234'), cardCodeDigest(secret, 'Production', 'ABCD1234'));
  assert.notEqual(
    cardCodeDigest(secret, 'Test', 'ABCD1234'),
    cardRequestDigest(secret, 'Test', 'ABCD1234ABCD1234'),
  );
});

test('card issue receipts are authenticated, scoped, and recoverable for idempotent retries', () => {
  const requestId = '01991e8b-d8f0-7b30-a1e1-c18181adfe22';
  const codes = ['AAAAA-BBBBB-CCCCC-DDDDD', '11111-22222-33333-44444'];
  const encrypted = encryptCardIssueCodes(secret, 'Test', requestId, codes);
  assert.deepEqual(decryptCardIssueCodes(secret, 'Test', requestId, encrypted), codes);
  assert.equal(decryptCardIssueCodes(secret, 'Production', requestId, encrypted), null);
  assert.equal(decryptCardIssueCodes(`${secret}-wrong`, 'Test', requestId, encrypted), null);
  assert.equal(decryptCardIssueCodes(secret, 'Test', requestId, `${encrypted}x`), null);

  const payload = { ossKey: 'card-files/product.zip', productName: 'Product', count: 10 };
  assert.equal(
    cardIssueRequestFingerprint(secret, 'Test', payload),
    cardIssueRequestFingerprint(secret, 'Test', payload),
  );
  assert.notEqual(
    cardIssueRequestFingerprint(secret, 'Test', payload),
    cardIssueRequestFingerprint(secret, 'Test', { ...payload, count: 11 }),
  );
});

test('download tickets are signed, source-bound, and expire', () => {
  const ipHash = cardIpHash(secret, '127.0.0.1');
  const expiresAt = Date.now() + 60_000;
  const ticket = createCardDownloadTicket(secret, { cardId: 12, expiresAt, ipHash });
  assert.deepEqual(verifyCardDownloadTicket(secret, ticket), {
    version: 1,
    cardId: 12,
    expiresAt,
    ipHash,
  });
  assert.equal(verifyCardDownloadTicket(`${secret}-wrong`, ticket), null);
  assert.equal(verifyCardDownloadTicket(secret, `${ticket}x`), null);

  const expired = createCardDownloadTicket(secret, {
    cardId: 12,
    expiresAt: Date.now() - 1,
    ipHash,
  });
  assert.equal(verifyCardDownloadTicket(secret, expired), null);
});

test('file metadata recognizes archives without trusting paths', () => {
  assert.equal(sanitizeCardFileName('../../测试资料.zip'), '测试资料.zip');
  assert.equal(cardFileMediaType('测试资料.zip'), 'application/zip');
  assert.equal(cardFileMediaType('安装包.7z'), 'application/x-7z-compressed');
  assert.equal(cardFileMediaType('unknown.custom'), 'application/octet-stream');
});

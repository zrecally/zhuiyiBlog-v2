import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config';
import { prisma } from '../src/core/Database';
import { cardOssApplySettings } from '../src/core/CardOssClient';
import { CardRedemptionService } from '../src/services/CardRedemptionService';
import { CardSupportService } from '../src/services/CardSupportService';
import { cardCodeDigest, cardIssueRequestFingerprint } from '../src/utils/CardRedeem';
import { generateCardCode } from '../src/utils/CardCodeRule';

/**
 * 卡密兑换状态机集成测试（连接本地 Test 环境数据库）。
 * 前置条件与 article-access.integration.ts 相同：backend-v2/.env 指向本地库，
 * FEISHU_DATA_ENV=Test，且 CARD_REDEEM_ENABLED=true、CARD_REDEEM_SECRET >= 32 字符。
 * 运行：npm run test:card-redeem-integration
 */

type CreatedCard = { id: number; code: string; display: string };

const createdCardIds: number[] = [];
const createdFiles: string[] = [];

const createCard = async (options?: { expiresAt?: Date | null }): Promise<CreatedCard> => {
  const generated = generateCardCode();
  const fileKey = `${randomUUID()}.zip`;
  const fileBuffer = Buffer.from(`card-integration-payload-${fileKey}`);
  await fsp.mkdir(config.cardRedeem.fileDir, { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.resolve(config.cardRedeem.fileDir, fileKey), fileBuffer);
  createdFiles.push(fileKey);

  const card = await prisma.cardCode.create({
    data: {
      environment: config.feishu.dataEnvironment,
      source: 'local-oss',
      productName: 'Integration Product',
      codeDigest: cardCodeDigest(config.cardRedeem.secret, config.feishu.dataEnvironment, generated.code),
      codeHash: await bcrypt.hash(generated.code, 4),
      codeHint: generated.code.slice(-4),
      fileKey,
      fileName: `${fileKey}`,
      fileMediaType: 'application/zip',
      fileSize: fileBuffer.length,
      salesChannel: 'external-platform',
      status: 'active',
      expiresAt: options?.expiresAt ?? null,
    },
  });
  createdCardIds.push(card.id);
  return { id: card.id, code: generated.code, display: generated.display };
};

const main = async () => {
  assert.equal(config.feishu.dataEnvironment, 'Test');
  assert.equal(config.cardRedeem.enabled, true);
  assert.ok(config.cardRedeem.secret.length >= 32);
  // 集成测试走本地文件存储，避免依赖本地 OSS mock 是否在线
  cardOssApplySettings({ enabled: false });

  // ── 场景 1：正常兑换 ──────────────────────────────────────────
  const card1 = await createCard();
  const winner = await CardRedemptionService.redeem(card1.display, 'integration-req-0001', '203.0.113.10');
  assert.equal(winner.success, true, 'first redeem must succeed');
  if (winner.success) {
    assert.equal(winner.replayed, false);
    assert.ok(winner.download.url.startsWith('/api/v1/cards/download/'), 'must return a signed download url');
    assert.equal(winner.download.fileName.endsWith('.zip'), true);
  }
  const afterRedeem = await prisma.cardCode.findUniqueOrThrow({ where: { id: card1.id } });
  assert.equal(afterRedeem.status, 'used');
  assert.ok(afterRedeem.usedAt);
  assert.ok(afterRedeem.replayExpiresAt);

  // ── 场景 2：同 requestId + 同 IP 在窗口内重放 → 成功且标记 replayed ──
  const replay = await CardRedemptionService.redeem(card1.display, 'integration-req-0001', '203.0.113.10');
  assert.equal(replay.success, true, 'replay with same requestId/ip must succeed');
  if (replay.success) assert.equal(replay.replayed, true);

  // ── 场景 3：同 requestId 但换 IP → 拒绝 ───────────────────────
  const ipSwitch = await CardRedemptionService.redeem(card1.display, 'integration-req-0001', '203.0.113.11');
  assert.equal(ipSwitch.success, false, 'replay from a different ip must be rejected');

  // ── 场景 4：已核销的卡换 requestId 再兑 → 拒绝（一次性）────────
  const reuse = await CardRedemptionService.redeem(card1.display, 'integration-req-0002', '203.0.113.11');
  assert.equal(reuse.success, false, 'a used card must not redeem twice');

  // ── 场景 5：并发兑换同一张卡 → 恰好一个赢家 ───────────────────
  const card2 = await createCard();
  const contenders = [
    { requestId: 'integration-req-a001', ip: '203.0.113.21' },
    { requestId: 'integration-req-a002', ip: '203.0.113.22' },
    { requestId: 'integration-req-a003', ip: '203.0.113.23' },
  ];
  const raced = await Promise.all(contenders.map(item =>
    CardRedemptionService.redeem(card2.display, item.requestId, item.ip)));
  assert.equal(raced.filter(result => result.success).length, 1, 'concurrent redemption must have exactly one winner');

  // ── 场景 6：过期卡兑换 → 拒绝 ────────────────────────────────
  const card3 = await createCard({ expiresAt: new Date(Date.now() - 1000) });
  const expired = await CardRedemptionService.redeem(card3.display, 'integration-req-0003', '203.0.113.10');
  assert.equal(expired.success, false, 'expired card must be rejected');
  const expiredRow = await prisma.cardCode.findUniqueOrThrow({ where: { id: card3.id } });
  assert.equal(expiredRow.status, 'active', 'expired redemption must not consume the card');

  // ── 场景 7：售后撤销 → 无法兑换 ──────────────────────────────
  const card4 = await createCard();
  const revoked = await CardSupportService.revoke(card4.display, 'integration refund');
  assert.equal(revoked.success, true, 'revoke must succeed');
  const revokedRedeem = await CardRedemptionService.redeem(card4.display, 'integration-req-0004', '203.0.113.10');
  assert.equal(revokedRedeem.success, false, 'revoked card must not redeem');
  const revokeAgain = await CardSupportService.revoke(card4.display);
  assert.equal(revokeAgain.success, false, 'revoking a revoked card must conflict');

  // ── 场景 8：售后重置 → 卡恢复可兑换，可再次成功 ───────────────
  const reset = await CardSupportService.reset(card1.display);
  assert.equal(reset.success, true, 'reset must succeed');
  const resetRow = await prisma.cardCode.findUniqueOrThrow({ where: { id: card1.id } });
  assert.equal(resetRow.status, 'active');
  assert.equal(resetRow.usedAt, null);
  assert.equal(resetRow.replayExpiresAt, null);
  const redeemedAgain = await CardRedemptionService.redeem(card1.display, 'integration-req-0005', '203.0.113.30');
  assert.equal(redeemedAgain.success, true, 'reset card must redeem again');
  // 重置后的卡再次核销仍处于 used，售后可再次重置（闭环可重复救援）
  const resetAgain = await CardSupportService.reset(card1.display);
  assert.equal(resetAgain.success, true, 'a re-used card must be resettable again');

  // ── 场景 9：单卡查询返回脱敏视图 ─────────────────────────────
  const view = await CardSupportService.lookup(card2.display);
  assert.equal(view.success, true);
  if (view.success) {
    assert.equal(view.card.status, 'used');
    assert.ok(view.card.codeHint.length === 4);
    assert.equal('codeDigest' in view.card, false, 'support view must not leak digests');
  }
  const unknown = await CardSupportService.lookup('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ');
  assert.equal(unknown.success, false, 'unknown card must 404');

  // ── 场景 10：有效期参与发卡幂等指纹 ──────────────────────────
  const payload = { ossKey: 'card-files/product.zip', productName: 'P', count: 3 };
  assert.notEqual(
    cardIssueRequestFingerprint(config.cardRedeem.secret, 'Test', { ...payload, expiresInDays: null }),
    cardIssueRequestFingerprint(config.cardRedeem.secret, 'Test', { ...payload, expiresInDays: 365 }),
    'changing expiresInDays must change the idempotency fingerprint',
  );

  // ── 场景 11：同一次核销只创建一个逻辑下载授权 ──────
  const card5 = await createCard();
  const budgetRedeem = await CardRedemptionService.redeem(card5.display, 'integration-req-cap1', '203.0.113.40');
  assert.equal(budgetRedeem.success, true, 'grant-scenario redeem must succeed');
  if (!budgetRedeem.success) throw new Error('unreachable');
  const ticketUrl = new URL(`https://local.test${budgetRedeem.download.url}`);
  const ticket = decodeURIComponent(ticketUrl.pathname.replace('/api/v1/cards/download/', ''));
  const downloaderIp = '203.0.113.40';

  assert.equal(await CardRedemptionService.preflightDownload(ticket, downloaderIp), 'ready',
    'unused ticket must pass preflight without consuming the grant');
  const first = await CardRedemptionService.resolveDownload(ticket, downloaderIp);
  assert.notEqual(first, null, 'first click must create a grant');
  assert.notEqual(first?.storage, 'blocked', 'first click must receive the file');
  assert.equal(await CardRedemptionService.preflightDownload(ticket, downloaderIp), 'already_issued',
    'preflight must report a consumed download opportunity');
  const second = await CardRedemptionService.resolveDownload(ticket, downloaderIp);
  assert.equal(second?.storage, 'blocked', 'second click must be blocked instead of returning error bytes');
  assert.equal(await prisma.cardDownloadLog.count({ where: { cardId: card5.id } }), 1,
    'one redemption must reserve quota exactly once');

  // ── 场景 12：并发点击只有一个赢家，其余明确拦截 ────────────
  const card6 = await createCard();
  const slackRedeem = await CardRedemptionService.redeem(card6.display, 'integration-req-cap2', '203.0.113.41');
  assert.equal(slackRedeem.success, true);
  if (!slackRedeem.success) throw new Error('unreachable');
  const slackTicketUrl = new URL(`https://local.test${slackRedeem.download.url}`);
  const slackTicket = decodeURIComponent(slackTicketUrl.pathname.replace('/api/v1/cards/download/', ''));
  const concurrentDownloads = await Promise.all(Array.from({ length: 12 }, () => (
    CardRedemptionService.resolveDownload(slackTicket, '203.0.113.41')
  )));
  assert.equal(concurrentDownloads.filter(item => item && item.storage !== 'blocked').length, 1,
    'concurrent clicks must have exactly one download winner');
  assert.equal(concurrentDownloads.filter(item => item?.storage === 'blocked').length, 11,
    'all losing clicks must be explicitly blocked');
  assert.equal(await prisma.cardDownloadLog.count({ where: { cardId: card6.id } }), 1,
    'concurrent clicks must write one quota reservation');

  console.log('card redeem integration: PASS');
};

const cleanup = async () => {
  if (createdCardIds.length > 0) {
    await prisma.cardDownloadLog.deleteMany({ where: { cardId: { in: createdCardIds } } });
    await prisma.cardCode.deleteMany({ where: { id: { in: createdCardIds } } });
  }
  for (const fileKey of createdFiles) {
    await fsp.unlink(path.resolve(config.cardRedeem.fileDir, fileKey)).catch(() => undefined);
  }
  await prisma.$disconnect();
};

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();

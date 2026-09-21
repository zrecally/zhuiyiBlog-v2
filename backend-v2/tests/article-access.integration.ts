import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { config } from '../src/config';
import { prisma } from '../src/core/Database';
import { ArticlePasswordAccessService } from '../src/services/ArticlePasswordAccessService';
import { articleCodeDigest } from '../src/utils/ArticleAccess';

const postId = 'article-access-integration';
const password = 'one-use-access-2026';
const recordId = `integration-${Date.now()}`;

const fakeRequest = (ip: string, cookie = '') => ({
  headers: { cookie },
  ip,
  socket: { remoteAddress: '127.0.0.1' },
}) as unknown as Request;

const fakeResponse = () => {
  let issuedCookie = '';
  const response = {
    cookie(name: string, value: string) {
      issuedCookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
      return response;
    },
  } as unknown as Response;
  return { response, getCookie: () => issuedCookie };
};

const main = async () => {
  assert.equal(config.feishu.dataEnvironment, 'Test');
  assert.equal(config.articleAccess.enabled, true);
  assert.ok(config.articleAccess.pepper.length >= 32);

  const sessionsBefore = await prisma.anonymousAccessSession.count();
  await prisma.articleAccessCode.create({
    data: {
      feishuRecordId: recordId,
      environment: 'Test',
      postId,
      codeDigest: articleCodeDigest(config.articleAccess.pepper, 'Test', password),
      passwordHash: await bcrypt.hash(password, 4),
      codeHint: password.slice(-4),
      bindIp: true,
      grantHours: 1,
      status: 'active',
    },
  });

  try {
    const contenders = [
      { ip: '203.0.113.10', response: fakeResponse() },
      { ip: '203.0.113.11', response: fakeResponse() },
    ];
    assert.equal(await ArticlePasswordAccessService.hasGrant(fakeRequest(contenders[0].ip), postId), false);

    const results = await Promise.all(contenders.map(contender => (
      ArticlePasswordAccessService.redeem(
        fakeRequest(contender.ip),
        contender.response.response,
        postId,
        password,
      )
    )));
    assert.equal(results.filter(result => result.success).length, 1, 'concurrent redemption must have one winner');
    const winnerIndex = results.findIndex(result => result.success);
    const winner = contenders[winnerIndex];
    const loser = contenders[winnerIndex === 0 ? 1 : 0];
    const cookie = winner.response.getCookie();
    assert.ok(cookie.includes('='), 'successful redemption must issue an anonymous session');

    assert.equal(
      await ArticlePasswordAccessService.hasGrant(fakeRequest(winner.ip, cookie), postId),
      true,
      'the anonymous browser session must retain access after redemption',
    );
    assert.deepEqual(
      [...await ArticlePasswordAccessService.grantedPostIds(fakeRequest(winner.ip, cookie), [postId])],
      [postId],
      'article lists must expose the existing anonymous grant after a refresh',
    );

    const reused = await ArticlePasswordAccessService.redeem(
      fakeRequest(loser.ip),
      fakeResponse().response,
      postId,
      password,
    );
    assert.equal(reused.success, false, 'a consumed password must never unlock a second session');

    assert.equal(
      await ArticlePasswordAccessService.hasGrant(fakeRequest(loser.ip, cookie), postId),
      false,
      'an IP-bound grant must reject a different client IP',
    );

    const code = await prisma.articleAccessCode.findUnique({ where: { feishuRecordId: recordId } });
    assert.ok(code);
    assert.equal(code.status, 'used');
    assert.ok(code.usedAt);
    assert.ok(code.usedIpHash);
    assert.equal(await prisma.articleAccessGrant.count({ where: { codeId: code.id } }), 1);
    console.log('article access integration: PASS');
  } finally {
    const code = await prisma.articleAccessCode.findUnique({ where: { feishuRecordId: recordId } });
    if (code) {
      const grants = await prisma.articleAccessGrant.findMany({
        where: { codeId: code.id },
        select: { sessionId: true },
      });
      await prisma.articleAccessGrant.deleteMany({ where: { codeId: code.id } });
      await prisma.articleAccessCode.delete({ where: { id: code.id } });
      if (grants.length > 0) {
        await prisma.anonymousAccessSession.deleteMany({
          where: { id: { in: grants.map(item => item.sessionId) } },
        });
      }
    }
    assert.equal(
      await prisma.anonymousAccessSession.count(),
      sessionsBefore,
      'integration cleanup and the losing concurrent request must not leave orphan sessions',
    );
    await prisma.$disconnect();
  }
};

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

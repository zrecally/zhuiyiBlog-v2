import assert from 'node:assert/strict';
import test from 'node:test';
import express, { type Request } from 'express';
import { IpUtils } from '../src/utils/IpUtils';

test('missing and non-string addresses are never normalized or trusted as LAN', () => {
  for (const ip of [undefined, null, 0, false, {}, ['127.0.0.1']]) {
    assert.equal(IpUtils.normalize(ip), '');
    assert.equal(IpUtils.isValid(ip), false);
    assert.equal(IpUtils.isLAN(ip), false);
    assert.equal(IpUtils.isTrustedProxy(ip, ['', 'unknown']), false);
  }
  for (const ip of ['', ' ', 'unknown', '10.attacker', '192.168.999.1', '172.16.bad']) {
    assert.equal(IpUtils.isValid(ip), false);
    assert.equal(IpUtils.isLAN(ip), false);
    assert.equal(IpUtils.isTrustedProxy(ip, [ip]), false);
  }
});

test('valid IPv4, IPv6 and mapped proxy addresses retain existing trust boundaries', () => {
  assert.equal(IpUtils.normalize(' ::FFFF:192.168.1.3 '), '192.168.1.3');
  for (const ip of ['10.2.3.4', '192.168.1.3', '172.16.1.1', '172.31.255.255', '127.0.0.1', '::1', '::ffff:10.2.3.4']) {
    assert.equal(IpUtils.isLAN(ip), true);
    assert.equal(IpUtils.isTrustedProxy(ip), true);
  }
  for (const ip of ['172.15.1.1', '172.32.1.1', '203.0.113.9', '2001:db8::1']) assert.equal(IpUtils.isTrustedProxy(ip), false);
  assert.equal(IpUtils.isTrustedProxy('203.0.113.9', ['203.0.113.9']), true);
  assert.equal(IpUtils.isTrustedProxy('2001:db8::1', ['2001:db8::1']), true);
});

function expressRequest(remoteAddress: string | undefined, forwarded: string): Request {
  const app = express();
  app.set('trust proxy', (ip: unknown) => IpUtils.isTrustedProxy(ip));
  const req = Object.create(app.request);
  req.app = app;
  req.socket = { remoteAddress };
  req.headers = { 'x-forwarded-for': forwarded, 'x-real-ip': '127.0.0.1' };
  return req;
}

test('actual Express proxy-addr chain handles detached socket without trusting forwarded localhost', () => {
  const req = expressRequest(undefined, '127.0.0.1');
  assert.doesNotThrow(() => req.ip);
  assert.equal(req.ip, undefined);
  assert.equal(IpUtils.getClientIp(req), 'unknown');
  assert.equal(IpUtils.isLAN(IpUtils.getClientIp(req)), false);
});

test('forwarded address is used only behind a trusted peer; malformed chain stays untrusted', () => {
  assert.equal(IpUtils.getClientIp(expressRequest('203.0.113.7', '127.0.0.1')), '203.0.113.7');
  assert.equal(IpUtils.getClientIp(expressRequest('172.18.0.2', '203.0.113.7')), '203.0.113.7');
  assert.equal(IpUtils.getClientIp(expressRequest('172.18.0.2', '10.attacker')), 'unknown');
});

test('logging a request with a broken ip getter cannot throw or fall back to a trusted proxy', () => {
  const req = { get ip() { throw new Error('detached request'); }, socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '127.0.0.1' } } as unknown as Request;
  assert.equal(IpUtils.getClientIp(req), 'unknown');
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../src/config';
import { PluginPackageService } from '../src/services/PluginPackageService';
import { LicenseSigner } from '../src/utils/LicenseSigner';

const rawEd25519Pair = () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const privateDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return {
    privateHex: privateDer.subarray(-32).toString('hex'),
    publicHex: publicDer.subarray(-32).toString('hex'),
  };
};

test('license signing has no source-code private-key fallback', () => {
  const previousKid = process.env.LICENSE_ED25519_ACTIVE_KID;
  process.env.LICENSE_ED25519_ACTIVE_KID = 'missing_test_key';
  delete process.env.LICENSE_ED25519_PRIVATE_KEY_MISSING_TEST_KEY;
  process.env.LICENSE_ED25519_PUBLIC_KEY_MISSING_TEST_KEY = rawEd25519Pair().publicHex;
  try {
    assert.throws(() => LicenseSigner.assertSigningReady(), /未配置私钥/);
  } finally {
    if (previousKid === undefined) delete process.env.LICENSE_ED25519_ACTIVE_KID;
    else process.env.LICENSE_ED25519_ACTIVE_KID = previousKid;
    delete process.env.LICENSE_ED25519_PUBLIC_KEY_MISSING_TEST_KEY;
  }
});

test('configured Ed25519 key signs and verifies a license', () => {
  const previousKid = process.env.LICENSE_ED25519_ACTIVE_KID;
  const pair = rawEd25519Pair();
  process.env.LICENSE_ED25519_ACTIVE_KID = 'test_rotation';
  process.env.LICENSE_ED25519_PRIVATE_KEY_TEST_ROTATION = pair.privateHex;
  process.env.LICENSE_ED25519_PUBLIC_KEY_TEST_ROTATION = pair.publicHex;
  try {
    const signed = LicenseSigner.signLicense({ key: 'TEST-KEY', deviceId: 'device-123456' });
    assert.equal(LicenseSigner.verifyLicense(signed), true);
    assert.equal(LicenseSigner.getPublicKeyHex(), pair.publicHex);
  } finally {
    if (previousKid === undefined) delete process.env.LICENSE_ED25519_ACTIVE_KID;
    else process.env.LICENSE_ED25519_ACTIVE_KID = previousKid;
    delete process.env.LICENSE_ED25519_PRIVATE_KEY_TEST_ROTATION;
    delete process.env.LICENSE_ED25519_PUBLIC_KEY_TEST_ROTATION;
  }
});

test('mismatched Ed25519 keypair is rejected before signing', () => {
  const previousKid = process.env.LICENSE_ED25519_ACTIVE_KID;
  const privatePair = rawEd25519Pair();
  const publicPair = rawEd25519Pair();
  process.env.LICENSE_ED25519_ACTIVE_KID = 'mismatched_pair';
  process.env.LICENSE_ED25519_PRIVATE_KEY_MISMATCHED_PAIR = privatePair.privateHex;
  process.env.LICENSE_ED25519_PUBLIC_KEY_MISMATCHED_PAIR = publicPair.publicHex;
  try {
    assert.throws(() => LicenseSigner.assertSigningReady(), /公钥与私钥不匹配/);
  } finally {
    if (previousKid === undefined) delete process.env.LICENSE_ED25519_ACTIVE_KID;
    else process.env.LICENSE_ED25519_ACTIVE_KID = previousKid;
    delete process.env.LICENSE_ED25519_PRIVATE_KEY_MISMATCHED_PAIR;
    delete process.env.LICENSE_ED25519_PUBLIC_KEY_MISMATCHED_PAIR;
  }
});

test('plugin registry rejects traversal and writes portable metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhuiyi-plugin-test-'));
  const previousPackagesDir = config.license.pluginPackagesDir;
  const previousStagingDir = config.license.pluginStagingDir;
  try {
    config.license.pluginPackagesDir = path.join(root, 'packages');
    config.license.pluginStagingDir = path.join(root, 'staging');
    fs.mkdirSync(config.license.pluginStagingDir, { recursive: true });
    fs.writeFileSync(path.join(config.license.pluginStagingDir, 'policy.json'), '{"ok":true}\n');

    assert.throws(() => PluginPackageService.pluginRoot('../outside'), /插件 ID 格式无效/);
    assert.throws(() => PluginPackageService.publish({
      pluginId: 'orchestration-pro', version: '../1.0', stagingDir: config.license.pluginStagingDir,
    }), /语义化版本/);

    const info = PluginPackageService.publish({
      pluginId: 'orchestration-pro', version: '9.9.9-test', stagingDir: config.license.pluginStagingDir,
    });
    const metadata = JSON.parse(fs.readFileSync(
      path.join(config.license.pluginPackagesDir, 'orchestration-pro', '9.9.9-test', 'version.json'),
      'utf8',
    ));
    assert.equal(metadata.payloadSHA256, info.payloadSHA256);
    assert.equal('payloadDir' in metadata, false);
    assert.throws(() => PluginPackageService.publish({
      pluginId: 'orchestration-pro', version: '9.9.9-test', stagingDir: config.license.pluginPackagesDir,
    }), /版本已存在/);

    const linkedStaging = path.join(root, 'linked-staging');
    fs.mkdirSync(linkedStaging);
    fs.symlinkSync(root, path.join(linkedStaging, 'outside'));
    assert.throws(() => PluginPackageService.computePayloadSHA256(linkedStaging), /符号链接/);

    const stagingLink = path.join(root, 'staging-link');
    fs.symlinkSync(linkedStaging, stagingLink);
    assert.throws(() => PluginPackageService.publish({
      pluginId: 'orchestration-pro', version: '9.9.10', stagingDir: stagingLink,
    }), /不能是符号链接/);
  } finally {
    config.license.pluginPackagesDir = previousPackagesDir;
    config.license.pluginStagingDir = previousStagingDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { TABLE_ORDER } from '../src/database/PortableDatabase';
import { MODEL_SPEC } from '../src/database/modelSpec';

test('portable database contract includes persisted comment reactions', () => {
  assert.equal(TABLE_ORDER.includes('CommentAction'), true);
  assert.ok(TABLE_ORDER.indexOf('CommentAction') > TABLE_ORDER.indexOf('Comment'));
  assert.deepEqual(MODEL_SPEC.Comment.likes, { type: 'Int', nullable: false });
  assert.deepEqual(MODEL_SPEC.Comment.dislikes, { type: 'Int', nullable: false });
  assert.equal(MODEL_SPEC.Comment.postId.maxLength, 255);
  assert.deepEqual(Object.keys(MODEL_SPEC.CommentAction), [
    'id', 'commentId', 'action', 'ipHash', 'createdAt',
  ]);
});

test('portable database contract includes licenses before activation audit rows', () => {
  assert.ok(TABLE_ORDER.indexOf('LicenseKey') > -1);
  assert.ok(TABLE_ORDER.indexOf('LicenseActivation') > TABLE_ORDER.indexOf('LicenseKey'));
  assert.equal(MODEL_SPEC.LicenseKey.keyDigest.maxLength, 64);
  assert.equal(MODEL_SPEC.LicenseActivation.deviceId.maxLength, 64);
});

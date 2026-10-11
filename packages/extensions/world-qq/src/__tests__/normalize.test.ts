import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DEFAULT_QQ_LIMITS, messageId, validateConfig } from '../config.ts';
import { normalize } from '../normalize.ts';
import { binding, message } from '../../tests/helpers/peer.ts';

it('preserves signed native IDs, plain CQ text and bounded unsupported metadata', () => {
  const raw = message(-2147483648, '[CQ:at,qq=123] @name');
  raw.message.push(...Array.from({ length: DEFAULT_QQ_LIMITS.metadataEntries + 1 }, () => ({ type: 'image', data: { text: 'ignored' } })));
  const fact = normalize(raw, binding, DEFAULT_QQ_LIMITS)!;
  assert.equal(fact.messageId, -2147483648); assert.equal(fact.text, '[CQ:at,qq=123] @name');
  assert.equal(fact.unsupported.length, DEFAULT_QQ_LIMITS.metadataEntries); assert.equal(fact.metadataTruncated, true);
  assert.equal(messageId(2147483648), false); assert.equal(messageId(0), true);
});
it('rejects string messages and malformed native time while filtering unrelated/self messages', () => {
  assert.throws(() => normalize(message(1, '', { message: 'CQ string' }), binding, DEFAULT_QQ_LIMITS), /array/);
  assert.throws(() => normalize(message(1, '', { time: Infinity }), binding, DEFAULT_QQ_LIMITS), /time/);
  for (const overrides of [{ self_id: 9 }, { group_id: 9 }, { user_id: binding.accountId }, { post_type: 'message_sent' }]) assert.equal(normalize(message(1, '', overrides), binding, DEFAULT_QQ_LIMITS), undefined);
});
it('validates transport credentials, positive account IDs and configured budgets', () => {
  const config = { endpoint: 'ws://localhost:3001/', accessToken: 'token', journalPath: 'journal', binding };
  assert.deepEqual(validateConfig(config), DEFAULT_QQ_LIMITS);
  assert.throws(() => validateConfig({ ...config, endpoint: 'ws://localhost/?access_token=secret' }));
  assert.throws(() => validateConfig({ ...config, limits: { apiMs: 0 } }));
});

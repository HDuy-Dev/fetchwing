import test from 'node:test';
import assert from 'node:assert/strict';
import { createSend, GONE_ERROR, isGone } from '../src/lib/runtime-send.js';

test('passes replies through', async () => {
  const send = createSend({ sendMessage: async m => ({ ok: true, echo: m.type }), onGone: () => assert.fail('not gone') });
  assert.deepEqual(await send({ type: 'x' }), { ok: true, echo: 'x' });
});

test('a reloaded extension is reported once and returns an error instead of throwing', async () => {
  let gone = 0;
  const send = createSend({ sendMessage: () => { throw new Error('Extension context invalidated.'); }, onGone: () => gone++ });
  assert.deepEqual(await send({ type: 'mutate' }), { ok: false, error: GONE_ERROR });
  assert.deepEqual(await send({ type: 'mutate' }), { ok: false, error: GONE_ERROR });
  assert.equal(gone, 1);
});

test('a rejected promise with the same cause is also caught', async () => {
  let gone = 0;
  const send = createSend({ sendMessage: async () => { throw new Error('Extension context invalidated.'); }, onGone: () => gone++ });
  assert.equal((await send({})).error, GONE_ERROR);
  assert.equal(gone, 1);
});

test('other failures become an error reply without the reload notice', async () => {
  let gone = 0;
  const send = createSend({ sendMessage: async () => { throw new Error('Could not establish connection.'); }, onGone: () => gone++ });
  assert.deepEqual(await send({}), { ok: false, error: 'Could not reach Fetchwing: Could not establish connection.' });
  assert.equal(gone, 0);
});

test('a missing reply becomes an error reply', async () => {
  const send = createSend({ sendMessage: async () => undefined, onGone: () => {} });
  assert.deepEqual(await send({}), { ok: false, error: 'Could not reach Fetchwing.' });
});

test('isGone recognises a reloaded extension', () => {
  assert.equal(isGone(new Error('Extension context invalidated.')), true);
  assert.equal(isGone(new Error('Could not establish connection.')), false);
  assert.equal(isGone(undefined), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { grantPath, completeGrant } from '../src/lib/grant-follow-up.js';

function fakeSend(replies = {}) {
  const sent = [];
  const send = async msg => {
    sent.push(msg);
    return msg.type in replies ? replies[msg.type] : { ok: true };
  };
  return { send, sent };
}

test('adds the site, then turns the mock on', async () => {
  const { send, sent } = fakeSend();
  assert.equal(await completeGrant({ send, origin: 'http://a.test', mockId: 'm1' }), null);
  assert.deepEqual(sent, [
    { type: 'addMockSite', origin: 'http://a.test' },
    { type: 'mutate', mutation: { type: 'setMockEnabled', id: 'm1', enabled: true } },
  ]);
});

test('without a mock only adds the site', async () => {
  const { send, sent } = fakeSend();
  assert.equal(await completeGrant({ send, origin: 'http://a.test', mockId: null }), null);
  assert.equal(sent.length, 1);
});

test('returns the duplicate error', async () => {
  const error = 'Another mock for this request is already on: X';
  const { send } = fakeSend({ mutate: { ok: false, error } });
  assert.equal(await completeGrant({ send, origin: 'http://a.test', mockId: 'm1' }), error);
});

test('stops when the site cannot be added', async () => {
  const { send, sent } = fakeSend({ addMockSite: { ok: false, error: 'Invalid site' } });
  assert.equal(await completeGrant({ send, origin: 'bad', mockId: 'm1' }), 'Invalid site');
  assert.equal(sent.length, 1);
});

test('reports a missing reply', async () => {
  const { send } = fakeSend({ addMockSite: undefined });
  assert.equal(await completeGrant({ send, origin: 'http://a.test' }), 'Could not reach Fetchwing.');
  assert.equal(await completeGrant({ send: async () => { throw new Error('gone'); }, origin: 'http://a.test' }), 'Could not reach Fetchwing.');
});

test('grantPath carries what to do after access is granted', () => {
  assert.equal(grantPath('http://a.test:3000', 'm1'), 'src/grant/grant.html?origin=http%3A%2F%2Fa.test%3A3000&site=1&mock=m1');
  assert.equal(grantPath('http://a.test'), 'src/grant/grant.html?origin=http%3A%2F%2Fa.test&site=1');
});

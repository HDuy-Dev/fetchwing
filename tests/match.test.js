import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, matchKey } from '../src/lib/match.js';

test('normalizeUrl sorts query', () => {
  assert.equal(normalizeUrl('https://API.Example.com/Users?size=10&page=2'), 'https://api.example.com/Users?page=2&size=10');
  assert.equal(normalizeUrl('https://x.dev/a?b=2&a=1&a=0'), 'https://x.dev/a?a=0&a=1&b=2');
});

test('normalizeUrl drops default port, fragment and empty query', () => {
  assert.equal(normalizeUrl('https://x.dev:443/a?#top'), 'https://x.dev/a');
  assert.equal(normalizeUrl('http://x.dev:80/'), 'http://x.dev/');
  assert.equal(normalizeUrl('http://localhost:3000/api'), 'http://localhost:3000/api');
});

test('normalizeUrl keeps invalid urls trimmed', () => {
  assert.equal(normalizeUrl('  {{base}}/x '), '{{base}}/x');
});

test('matchKey ignores query order', () => {
  assert.equal(matchKey('get', 'https://x.dev/u?page=2&size=10'), matchKey('GET', 'https://x.dev/u?size=10&page=2'));
});

test('matchKey distinguishes different query values and paths', () => {
  assert.notEqual(matchKey('GET', 'https://x.dev/u?page=2'), matchKey('GET', 'https://x.dev/u?page=3'));
  assert.notEqual(matchKey('GET', 'https://x.dev/u'), matchKey('GET', 'https://x.dev/u?page=2'));
  assert.notEqual(matchKey('GET', 'https://x.dev/U'), matchKey('GET', 'https://x.dev/u'));
});

test('matchKey distinguishes methods', () => {
  assert.notEqual(matchKey('GET', 'https://x.dev/u'), matchKey('POST', 'https://x.dev/u'));
});

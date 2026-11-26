import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_MODES, bodyBadge, bodylessWarning, blankRowLabels } from '../src/lib/body-view.js';

test('BODY_MODES lists the five types in order', () => {
  assert.deepEqual(BODY_MODES.map(([value]) => value), ['none', 'json', 'text', 'urlencoded', 'formdata']);
});

test('bodyBadge shows the readable name, and nothing for no body', () => {
  assert.equal(bodyBadge('none'), null);
  assert.equal(bodyBadge('json'), 'JSON');
  assert.equal(bodyBadge('urlencoded'), 'URL-encoded');
  assert.equal(bodyBadge('formdata'), 'Form data');
});

test('bodylessWarning warns only when GET or HEAD would drop a body', () => {
  assert.equal(bodylessWarning('GET', 'json'), "GET requests don't send a body. Change the method to send it.");
  assert.equal(bodylessWarning('HEAD', 'formdata'), "HEAD requests don't send a body. Change the method to send it.");
  assert.equal(bodylessWarning('GET', 'none'), null);
  assert.equal(bodylessWarning('POST', 'json'), null);
});

test('blankRowLabels says what typing will add', () => {
  assert.deepEqual(blankRowLabels('field'), { key: 'Add key', value: 'Add value' });
  assert.deepEqual(blankRowLabels('header'), { key: 'Add header', value: 'Add value' });
});

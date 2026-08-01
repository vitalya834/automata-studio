import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedExternalUrl } from './security.mjs';

test('allows only approved project HTTPS hosts', () => {
  assert.equal(trustedExternalUrl('https://github.com/vitalya834/automata-studio'), true);
  assert.equal(trustedExternalUrl('https://vitalya834.github.io/automata-studio/'), true);
  assert.equal(trustedExternalUrl('http://github.com/vitalya834/automata-studio'), false);
  assert.equal(trustedExternalUrl('https://github.com.example.test/attack'), false);
  assert.equal(trustedExternalUrl('javascript:alert(1)'), false);
  assert.equal(trustedExternalUrl('not a URL'), false);
});

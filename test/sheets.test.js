const { test } = require('node:test');
const assert = require('node:assert');
const { authMode, isTransient } = require('../src/sheets');

test('isTransient flags premature-close and network errors, not auth errors', () => {
  assert.strictEqual(isTransient({ code: 'ERR_STREAM_PREMATURE_CLOSE' }), true);
  assert.strictEqual(isTransient({ message: 'socket hang up' }), true);
  assert.strictEqual(isTransient({ message: 'request failed with status 503' }), true);
  assert.strictEqual(isTransient({ message: 'invalid_grant' }), false);
  assert.strictEqual(isTransient(null), false);
});

test('authMode picks service-account when GDRIVE_SA_JSON is set (wins over OAuth)', () => {
  assert.strictEqual(authMode({ GDRIVE_SA_JSON: '{"x":1}' }), 'service-account');
  assert.strictEqual(authMode({
    GDRIVE_SA_JSON: '{"x":1}',
    GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b', GOOGLE_OAUTH_REFRESH_TOKEN: 'c',
  }), 'service-account');
});

test('authMode picks oauth when the full OAuth trio is set', () => {
  assert.strictEqual(authMode({
    GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b', GOOGLE_OAUTH_REFRESH_TOKEN: 'c',
  }), 'oauth');
});

test('authMode is none when nothing (or a partial OAuth set) is configured', () => {
  assert.strictEqual(authMode({}), 'none');
  assert.strictEqual(authMode({ GOOGLE_OAUTH_CLIENT_ID: 'a' }), 'none'); // missing secret + token
});

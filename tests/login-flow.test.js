const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoginFlow } = require('../js/utils/login-flow');

test('invitation intent survives Supabase clearing URL tokens', () => {
  const flow = createLoginFlow('#access_token=example&type=invite', '?');
  assert.equal(flow.mode, 'invite');
  flow.handleEvent('SIGNED_IN');
  assert.equal(flow.shouldRedirect({}), false);
});
test('recovery event switches a normal login to password setup', () => {
  const flow = createLoginFlow('', '');
  assert.equal(flow.shouldRedirect({}), true);
  flow.handleEvent('PASSWORD_RECOVERY');
  assert.equal(flow.mode, 'recovery');
  assert.equal(flow.shouldRedirect({}), false);
});
test('explicit welcome redirect works when provider already consumed the hash', () => {
  assert.equal(createLoginFlow('', '?setup=invite').mode, 'invite');
});
test('failed and expired links do not redirect an existing session', () => {
  const flow = createLoginFlow('#error=access_denied&error_description=Link+expired', '');
  assert.equal(flow.error, 'Link expired');
  assert.equal(flow.shouldRedirect({}), false);
});

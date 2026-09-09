const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoginFlow, emailLinkHelp } = require('../js/utils/login-flow');

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
test('expired invitation links offer administrator help without a usable session', () => {
  const flow = createLoginFlow('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '?setup=invite');
  assert.equal(flow.linkHelp.kind, 'invite');
  assert.match(flow.linkHelp.explanation, /once/);
  assert.equal(flow.shouldRedirect({}), false);
});
test('an expiry code without a description still shows a recovery path', () => {
  const flow = createLoginFlow('', '?error_code=otp_expired');
  assert.ok(flow.error);
  assert.equal(flow.linkHelp.kind, 'unknown');
  assert.equal(flow.shouldRedirect({}), false);
});
test('password recovery and app-level invitation expiry choose the right help', () => {
  assert.equal(createLoginFlow('#type=recovery&error=access_denied&error_code=otp_expired', '').linkHelp.kind, 'recovery');
  assert.equal(emailLinkHelp('recovery', 'Invitation expired').kind, 'invite');
});
test('ordinary login failures and valid invitations do not look expired', () => {
  assert.equal(emailLinkHelp('login', 'Invalid login credentials'), null);
  assert.equal(emailLinkHelp('invite', 'Unable to connect'), null);
  assert.equal(createLoginFlow('#type=invite&access_token=fixture', '').linkHelp, null);
  assert.equal(createLoginFlow('#error=server_error', '').linkHelp, null);
});

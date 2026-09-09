const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoginFlow, emailLinkHelp, verifyEmailCode, completeSignIn } = require('../js/utils/login-flow');

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

test('resent invitation keeps setup intent even when Auth uses a recovery token', () => {
    const flow = createLoginFlow('#type=recovery', '?setup=invite');
    flow.handleEvent('PASSWORD_RECOVERY');
    assert.equal(flow.mode, 'invite');
});
test('code landing pages never redirect an existing session before verification', () => {
    const flow = createLoginFlow('', '?setup=invite&verification=recovery');
    assert.equal(flow.verificationType, 'recovery');
    assert.equal(flow.mode, 'invite');
    assert.equal(flow.shouldRedirect({}), false);
    assert.equal(createLoginFlow('', '?verification=invite').mode, 'invite');
});
test('code verification uses email and the matching provider type only on explicit invocation', async () => {
    const calls = [];
    const client = { auth: { verifyOtp: async input => { calls.push(input); return {data:{session:{user:{id:'u1'}}},error:null}; } } };
    await verifyEmailCode(client, 'invite', ' Worker@example.test ', ' 123456 ');
    await verifyEmailCode(client, 'recovery', 'worker@example.test', '654321');
    assert.deepEqual(calls, [
        {email:'worker@example.test',token:'123456',type:'invite'},
        {email:'worker@example.test',token:'654321',type:'recovery'},
    ]);
    await assert.rejects(verifyEmailCode(client, 'signup', 'worker@example.test', '123456'));
    await assert.rejects(verifyEmailCode(client, 'invite', '', '123456'));
    await assert.rejects(verifyEmailCode(client, 'invite', 'worker@example.test', 'not-a-code'));
    assert.equal(calls.length, 2);
});
test('an invalid code or missing verified session cannot advance to password setup', async () => {
    const expired = {message:'Token has expired or is invalid',code:'otp_expired'};
    await assert.rejects(verifyEmailCode({auth:{verifyOtp:async()=>({error:expired})}}, 'invite', 'w@example.test','123456'), e=>e===expired);
    await assert.rejects(verifyEmailCode({auth:{verifyOtp:async()=>({data:{session:null},error:null})}}, 'invite', 'w@example.test','123456'), /session/i);
});
test('password sign-in waits for pending invitation completion before navigation', async () => {
    let resolve;
    let completed = false;
    const client = {rpc: name => { assert.equal(name, 'complete_invitation'); return new Promise(r=>resolve=r); }};
    const work = completeSignIn(client).then(()=>{ completed=true; });
    await Promise.resolve();
    assert.equal(completed, false);
    resolve({error:null});
    await work;
    assert.equal(completed, true);
});
test('expired, cancelled and failed completion remain blocked instead of redirecting', async () => {
    for (const message of ['Invitation expired','Invitation cancelled','Unable to connect']) {
        const error = {message};
        await assert.rejects(completeSignIn({rpc:async()=>({error})}), e=>e===error);
    }
});

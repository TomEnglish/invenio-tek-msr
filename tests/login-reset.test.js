const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('login.html', 'utf8');

assert.match(html, /id="forgot-password-btn"/);
assert.match(html, /resetPasswordForEmail/);
assert.match(html, /updateUser\(\{\s*password:\s*newPassword\s*\}\)/);
assert.match(html, /PASSWORD_RECOVERY/);
assert.match(html, /InvenioLoginFlow.createLoginFlow/);
assert.match(html, /loginFlow.shouldRedirect\(session\)/);
// The code step takes its heading and email label from the flow, so a reset reads as a reset.
assert.match(html, /InvenioLoginFlow\.codeStepText\(loginFlow\.mode\)/);
assert.match(html, /label\[for="verify-email"\]/);

console.log('login reset tests passed');

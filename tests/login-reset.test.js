const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('login.html', 'utf8');

assert.match(html, /id="forgot-password-btn"/);
assert.match(html, /resetPasswordForEmail/);
assert.match(html, /updateUser\(\{\s*password:\s*newPassword\s*\}\)/);
assert.match(html, /PASSWORD_RECOVERY/);
assert.match(html, /let recoveryFlowStarted = isRecoveryUrl\(\);/);
assert.match(html, /if \(session && !recoveryFlowStarted\)/);

console.log('login reset tests passed');

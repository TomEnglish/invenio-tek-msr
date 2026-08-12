const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('user-admin.html', 'utf8');
const guard = fs.readFileSync('js/utils/auth-guard.js', 'utf8');
const sidebar = fs.readFileSync('js/utils/sidebar.js', 'utf8');

assert.match(page, /<body data-required-role="admin">/);
assert.match(page, /id="btnInviteUser"/);
assert.match(page, /id="userTableBody"/);
assert.match(page, /id="userForm"/);
assert.match(page, /js\/utils\/admin-users-client\.js/);
assert.match(page, /user-admin\.js/);
assert.match(guard, /from\('users'\)/);
assert.match(guard, /requiredRole === 'admin'/);
assert.match(guard, /canAccessAdminPages/);
assert.match(sidebar, /user-admin\.html/);
assert.match(sidebar, /data-admin-only/);

console.log('user admin page tests passed');

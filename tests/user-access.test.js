const assert = require('node:assert/strict');
const {
  canAccessAdminPages,
  canUseApp,
  normalizeProfile,
} = require('../js/utils/user-access');

assert.equal(canUseApp({ role: 'field_worker', is_active: true }), true);
assert.equal(canUseApp({ role: 'office_staff', is_active: true }), true);
assert.equal(canUseApp({ role: 'admin', is_active: true }), true);
assert.equal(canUseApp({ role: 'admin', is_active: false }), false);
assert.equal(canUseApp(null), false);

assert.equal(canAccessAdminPages({ role: 'admin', is_active: true }), true);
assert.equal(canAccessAdminPages({ role: 'office_staff', is_active: true }), false);
assert.equal(canAccessAdminPages({ role: 'admin', is_active: false }), false);

assert.deepEqual(
  normalizeProfile({ id: 'u1', full_name: ' Admin ', role: 'admin', is_active: true }),
  { id: 'u1', fullName: 'Admin', role: 'admin', isActive: true },
);

console.log('user access tests passed');

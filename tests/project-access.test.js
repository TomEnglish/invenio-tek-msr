const test = require('node:test');
const assert = require('node:assert/strict');
const scope = require('../js/utils/project-scope');
function client(projects, error = null) {
  return { from: () => ({ select() { return this; }, eq: async () => ({ data: projects.map(project => ({ projects: project })), error }) }) };
}
test('project initialization fails closed and never uses the configured default', async () => {
  global.SUPABASE_CONFIG = { defaultProjectId: 'wrong-project' };
  await scope.initializeProjectScope(client([{ id: 'a', name: 'A', status: 'active' }]), 'user-a');
  assert.equal(scope.getActiveProjectId(), 'a');
  await scope.initializeProjectScope(client([]), 'user-b');
  assert.equal(scope.getActiveProjectId(), null);
  assert.throws(() => scope.withProjectId('materials', {}), /No project access/);
  assert.throws(() => scope.setActiveProjectId('a'), /not assigned/);
});
test('archived projects are excluded and each account restores only its own valid selection', async () => {
  const saved = new Map(); global.localStorage = { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v) };
  const projects = [{id:'a',status:'active'},{id:'b',status:'completed'},{id:'c',status:'archived'}];
  await scope.initializeProjectScope(client(projects), 'user-a'); scope.setActiveProjectId('b');
  await scope.initializeProjectScope(client(projects), 'user-b'); assert.equal(scope.getActiveProjectId(),'a');
  await scope.initializeProjectScope(client(projects), 'user-a'); assert.equal(scope.getActiveProjectId(),'b');
  assert.throws(() => scope.setActiveProjectId('c'), /not assigned/);
  await assert.rejects(() => scope.initializeProjectScope(client([], {message:'offline'}), 'user-a'), /Unable to load/);
  assert.equal(scope.getActiveProjectId(), null);
});

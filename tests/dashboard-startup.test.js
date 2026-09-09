const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function dashboard() {
  let start;
  let resolveAccess;
  let loads = 0;
  const filters = [];
  const indicator = { textContent: 'Connecting...' };
  const context = vm.createContext({
    console: { log() {}, error() {} },
    isSupabaseConfigured: () => true,
    InvenioAuthReady: new Promise(resolve => { resolveAccess = resolve; }),
    document: {
      addEventListener(event, callback) { if (event === 'DOMContentLoaded') start = callback; },
      createElement: () => ({}),
      head: { appendChild() {} },
      getElementById: () => indicator,
    },
    supabaseClient: {
      channel() {
        return {
          on(event, options) { filters.push(options); return this; },
          subscribe(callback) { callback('SUBSCRIBED'); },
        };
      },
    },
  });
  context.window = context;
  for (const file of ['js/utils/project-scope.js', 'dashboard.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  // This test isolates startup and the real project-filtered realtime wiring.
  context.loadAllData = () => { loads++; };
  return {
    start: () => start(), filters, indicator, get loads() { return loads; },
    allow() {
      context.InvenioProjectScope.availableProjects = [{ id: 'assigned-project' }];
      context.InvenioProjectScope.setActiveProjectId('assigned-project');
      resolveAccess(true);
    },
    deny() { resolveAccess(false); },
  };
}

test('dashboard waits for project access before loading and subscribing', async () => {
  const app = dashboard();
  const startup = app.start();
  assert.equal(app.loads, 0);
  assert.equal(app.filters.length, 0);
  app.allow();
  await startup;
  assert.equal(app.loads, 1);
  assert.ok(app.filters.length > 0);
  assert.ok(app.filters.every(options => options.filter === 'project_id=eq.assigned-project'));
  assert.equal(app.indicator.textContent, 'Server connected');
});

test('dashboard does not start data or realtime access when the auth guard denies access', async () => {
  const app = dashboard();
  const startup = app.start();
  app.deny();
  await startup;
  assert.equal(app.loads, 0);
  assert.equal(app.filters.length, 0);
});

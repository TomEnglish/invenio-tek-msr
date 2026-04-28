const assert = require('node:assert/strict');

const {
  DEFAULT_PROJECT_ID,
  isProjectScopedTable,
  withProjectId,
  createProjectScopedClient,
  projectChangeOptions,
} = require('../js/utils/project-scope');

assert.equal(isProjectScopedTable('receiving_records'), true);
assert.equal(isProjectScopedTable('materials'), true);
assert.equal(isProjectScopedTable('purchase_orders'), true);
assert.equal(isProjectScopedTable('vw_active_samsara_trackers'), true);
assert.equal(isProjectScopedTable('inspection_photos'), false);
assert.equal(isProjectScopedTable('audit_log'), false);

assert.deepEqual(
  withProjectId('receiving_records', { material_type: 'Pipe' }, DEFAULT_PROJECT_ID),
  { material_type: 'Pipe', project_id: DEFAULT_PROJECT_ID },
);

assert.deepEqual(
  withProjectId('receiving_records', [{ material_type: 'Pipe' }], 'project-1'),
  [{ material_type: 'Pipe', project_id: 'project-1' }],
);

assert.deepEqual(
  withProjectId('audit_log', { action: 'receiving_created' }, 'project-1'),
  { action: 'receiving_created' },
);

assert.deepEqual(projectChangeOptions('materials', 'INSERT', 'project-1'), {
  event: 'INSERT',
  schema: 'public',
  table: 'materials',
  filter: 'project_id=eq.project-1',
});

assert.deepEqual(projectChangeOptions('audit_log', '*', 'project-1'), {
  event: '*',
  schema: 'public',
  table: 'audit_log',
});

const calls = [];
const query = {
  eq(column, value) {
    calls.push(['eq', column, value]);
    return this;
  },
  insert(payload) {
    calls.push(['insert', payload]);
    return this;
  },
  select(columns, options) {
    calls.push(['select', columns, options]);
    return this;
  },
};

const baseClient = {
  from(table) {
    calls.push(['from', table]);
    return query;
  },
};

const scoped = createProjectScopedClient(baseClient, () => 'project-1');
scoped.from('materials').select('*', { count: 'exact' });
scoped.from('materials').insert({ material_type: 'Valve' });
scoped.from('audit_log').select('*');

assert.deepEqual(calls, [
  ['from', 'materials'],
  ['select', '*', { count: 'exact' }],
  ['eq', 'project_id', 'project-1'],
  ['from', 'materials'],
  ['insert', { material_type: 'Valve', project_id: 'project-1' }],
  ['from', 'audit_log'],
  ['select', '*', undefined],
]);

console.log('project-scope tests passed');

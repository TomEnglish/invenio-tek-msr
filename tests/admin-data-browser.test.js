// Runs admin.js (the Data Browser) against the fake DOM and a fake Supabase that records each query, so the
// QR Codes tab is checked by the query it sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fakeDocument, settle } = require('./support/fake-dom');

const source = fs.readFileSync('admin.js', 'utf8');

function openBrowser(rows) {
    const { document } = fakeDocument();
    const queries = [];
    class Query {
        constructor(table) { this.request = { table, calls: [] }; queries.push(this.request); }
        then(resolve, reject) {
            const neq = this.request.calls.filter(([name]) => name === 'neq');
            const data = rows.filter(row => neq.every(([, key, value]) => row[key] !== value));
            return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
        }
    }
    for (const name of ['select', 'order', 'or', 'range', 'eq', 'neq']) Query.prototype[name] = function (...args) { this.request.calls.push([name, ...args]); return this; };
    const context = { document, console, Promise, crypto: globalThis.crypto, bootstrap: { Modal: class { show() {} hide() {} } },
        projectSupabaseClient: { from: table => new Query(table) } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    const open = async table => { vm.runInContext(`state.currentTable = ${JSON.stringify(table)}; loadData();`, context); await settle(); };
    return { document, context, queries, open, shown: () => vm.runInContext('state.data.map(row => row.code_value)', context) };
}

test('the QR Codes tab lists item codes only; crate labels are left out', async () => {
    const page = openBrowser([
        { id: 'q1', code_value: 'GT2-LO-001', entity_type: 'item' },
        { id: 'q2', code_value: 'HU-7K3QX9', entity_type: 'handling_unit' },
        { id: 'q3', code_value: 'PAL-01', entity_type: 'pallet' },
    ]);
    await page.open('qr_codes');
    const query = page.queries.at(-1);
    assert.equal(query.table, 'qr_codes');
    assert.deepEqual(query.calls.filter(([name]) => name === 'neq'), [['neq', 'entity_type', 'handling_unit']]);
    assert.deepEqual([...page.shown()], ['GT2-LO-001', 'PAL-01']);
    await page.open('locations');
    assert.equal(page.queries.at(-1).calls.some(([name]) => name === 'neq'), false, 'other tables are not filtered');
});

test('the Materials status list has every status the database allows, so a written-off material shows as written off', async () => {
    // The newest materials_status_check in the migrations (022 added written_off).
    const checks = fs.readdirSync('supabase/migrations').sort()
        .flatMap(name => [...fs.readFileSync(`supabase/migrations/${name}`, 'utf8').matchAll(/materials_status_check\s+check\s*\(\s*status\s+in\s*\(([^)]*)\)/gi)]);
    const allowed = [...checks.at(-1)[1].matchAll(/'([^']+)'/g)].map(([, status]) => status);
    assert.ok(allowed.includes('written_off'));
    const page = openBrowser([{ id: 'm1', material_type: 'Pipe', status: 'written_off' }]);
    const options = vm.runInContext("TABLE_CONFIG.materials.columns.find(column => column.key === 'status').options", page.context);
    assert.deepEqual([...options].sort(), allowed.sort());
    await page.open('materials');
    assert.match(page.document.getElementById('tableBody').innerHTML, />written off</);
    const colour = status => vm.runInContext(`statusColor(${JSON.stringify(status)})`, page.context);
    assert.notEqual(colour('written_off'), colour('not_a_status'), 'its own colour, not the one for values the list does not know');
    // The edit form shows the status but doesn't offer it: correct_material takes only the descriptive fields.
    vm.runInContext('openEditModal(0)', page.context);
    const form = page.document.getElementById('editModalBody').innerHTML;
    assert.deepEqual([...form.matchAll(/data-field="([^"]+)"/g)].map(([, key]) => key), ['material_type', 'size', 'grade', 'spec', 'weight']);
    assert.match(form, /read-only<\/span><\/label><div class="field-readonly"><span class="status-badge"[^>]*>written off</);
});

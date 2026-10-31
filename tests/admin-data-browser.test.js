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
    const context = { document, console, Promise, projectSupabaseClient: { from: table => new Query(table) } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    const open = async table => { vm.runInContext(`state.currentTable = ${JSON.stringify(table)}; loadData();`, context); await settle(); };
    return { document, queries, open, shown: () => vm.runInContext('state.data.map(row => row.code_value)', context) };
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

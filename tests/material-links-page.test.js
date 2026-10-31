// Runs material-tracking-supabase.js (PO & Installation) through the real project-scoped client against a fake Supabase
// that applies material_links' row security as migration 013 left it: project members read, office staff insert and
// update while the project is active, and no one deletes. Like PostgREST, a write that row security turns away is not
// an error: it changes no row and sends none back, so the page has to notice that itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createProjectScopedClient } = require('../js/utils/project-scope');
const { fakeDocument, settle } = require('./support/fake-dom');

const source = fs.readFileSync('material-tracking-supabase.js', 'utf8');
const P = 'p1';
const link = (id, extra = {}) => ({ id, project_id: P, po_id: `PO-2000${id}`, po_line_item: 10, po_description: 'Six-inch isolation valve', install_tag: `V-10${id}`,
    install_discipline: 'Mechanical', install_description: 'Valve', quantity: 2, uom: 'EA', material_status: 'ordered', receipt_date: null, receipt_location: null,
    installation_date: null, notes: null, linked_by: 'User', created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', ...extra });

/** The page as `role` sees it. `deletes` stands in for a delete policy the database doesn't have: who it would let delete. */
async function openPage({ role = 'office_staff', projectStatus = 'active', deletes = () => false, answer = 'shipped' } = {}) {
    const office = ['office_staff', 'admin'].includes(role), working = projectStatus === 'active';
    const allowed = { update: office && working, delete: deletes({ office, working }) };
    const server = { links: [link(7), link(8, { material_status: 'shipped' })], log: [] };
    class Query {
        constructor(table) { this.request = { table, action: 'select', filters: [] }; server.log.push(this.request); }
        select(columns) { if (this.request.action === 'select') this.request.columns = columns; else this.request.returning = columns ?? '*'; return this; }
        update(values) { Object.assign(this.request, { action: 'update', values }); return this; }
        delete() { this.request.action = 'delete'; return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        order() { return this; }
        then(resolve, reject) { return Promise.resolve(respond(this.request)).then(resolve, reject); }
    }
    function respond(request) {
        const matched = server.links.filter(row => request.filters.every(([key, value]) => row[key] === value));
        if (request.action === 'select') return { data: structuredClone(matched), error: null };
        const changed = allowed[request.action] ? matched : [];
        if (request.action === 'update') changed.forEach(row => Object.assign(row, request.values));
        else server.links = server.links.filter(row => !changed.includes(row));
        return { data: request.returning ? structuredClone(changed) : null, error: null };
    }
    const { document } = fakeDocument();
    const alerts = [], confirms = [];
    const context = {
        document, console: { log() {}, error() {} }, structuredClone, InvenioAuthReady: Promise.resolve(true),
        confirm: text => { confirms.push(text); return true; }, alert: text => { alerts.push(text); }, prompt: () => answer,
        projectSupabaseClient: createProjectScopedClient({ from: table => new Query(table) }, () => P),
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    const run = async code => { await vm.runInContext(code, context); await settle(); };
    await run('loadMaterialLinks()');
    return { server, alerts, confirms, run, listed: () => [...vm.runInContext('state.materialLinks.map(link => link.id)', context)],
        writes: () => server.log.filter(request => request.action !== 'select'), row: id => server.links.find(row => row.id === id) };
}

test("Delete says the link wasn't deleted when row security deletes nothing, as it does for everyone since 013", async () => {
    for (const role of ['office_staff', 'admin']) {
        const page = await openPage({ role });
        assert.deepEqual(page.listed(), [7, 8]);
        await page.run('deleteLink(7)');
        assert.deepEqual(page.confirms, ['Are you sure you want to delete link #7? This action cannot be undone.']);
        const [remove] = page.writes();
        assert.deepEqual([remove.action, [...remove.filters].sort()], ['delete', [['id', 7], ['project_id', P]]], 'the link, in the open project');
        assert.deepEqual(page.alerts, ["✗ Failed to delete link: material links can't be deleted."], role);
        assert.deepEqual(page.listed(), [7, 8]);
        assert.ok(page.row(7), 'still stored');
    }
});

test('Delete reports success only when the database sends the deleted row back', async () => {
    const page = await openPage({ deletes: ({ office, working }) => office && working });
    await page.run('deleteLink(7)');
    assert.deepEqual(page.alerts, ['✓ Link deleted successfully!']);
    assert.deepEqual(page.listed(), [8]);
    assert.equal(page.row(7), undefined);
});

test("a status change row security turns away says so, for a field worker or a project that isn't active", async () => {
    for (const options of [{ role: 'field_worker' }, { projectStatus: 'completed' }]) {
        const page = await openPage(options);
        await page.run("updateLinkStatus(7, 'ordered')");
        assert.deepEqual(page.writes().map(request => [request.action, request.values.material_status]), [['update', 'shipped']]);
        assert.deepEqual(page.alerts, ['✗ Failed to update status: only office staff can change links, and only while the project is active.'], JSON.stringify(options));
        assert.equal(page.row(7).material_status, 'ordered');
    }
    const office = await openPage();
    await office.run("updateLinkStatus(7, 'ordered')");
    assert.deepEqual(office.alerts, ['✓ Link status updated successfully!']);
    assert.equal(office.row(7).material_status, 'shipped');
});

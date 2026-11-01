// Runs material-tracking-supabase.js (PO & Installation) through the real project-scoped client against a fake Supabase
// that applies material_links' row security as migrations 013 and 024 leave it: project members read, office staff insert
// and update while the project is active, and no one deletes directly. Like PostgREST, a write that row security turns away
// is not an error: it changes no row and sends none back, so the page has to notice that itself. Administrators edit a
// link's details and delete links through 024's functions, which the fake answers as the database would.
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

/** The page as `role` sees it. `answer` is what the prompt gets back; `refuse` makes 024's functions turn a call down. */
async function openPage({ role = 'office_staff', projectStatus = 'active', answer = 'shipped', refuse = null,
    links = [link(7), link(8, { material_status: 'shipped' })] } = {}) {
    const office = ['office_staff', 'admin'].includes(role), working = projectStatus === 'active';
    const server = { links: structuredClone(links), log: [], rpcs: [] };
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
        const changed = request.action === 'update' && office && working ? matched : [];
        changed.forEach(row => Object.assign(row, request.values));
        return { data: request.returning ? structuredClone(changed) : null, error: null };
    }
    // 024's functions: administrators on an active project only, as the database checks.
    async function rpc(name, params) {
        server.rpcs.push([name, structuredClone(params)]);
        if (refuse) return { data: null, error: refuse };
        if (!(role === 'admin' && working)) return { data: null, error: { code: '42501', message: `Only an administrator can ${name === 'admin_delete_material_link' ? 'delete' : 'edit'} a link` } };
        if (name === 'admin_delete_material_link') {
            server.links = server.links.filter(row => row.id !== params.p_link_id);
            return { data: { link_id: params.p_link_id, status_history_removed: 0, trackers_unlinked: 0 }, error: null };
        }
        const row = server.links.find(item => item.id === params.p_link_id);
        // As 024 does with p_expected: a detail someone changed since the form opened isn't overwritten.
        const moved = Object.keys(params.p_changes).filter(key => key in (params.p_expected ?? {}) && row[key] !== params.p_expected[key]);
        if (moved.length) return { data: null, error: { code: '40001', message: `Link #${row.id} has changed since the form opened (${moved.join(', ').replace(/_/g, ' ')}); open it again` } };
        Object.assign(row, params.p_changes);
        return { data: structuredClone(row), error: null };
    }
    const { document } = fakeDocument();
    const alerts = [];
    const context = {
        document, console: { log() {}, error() {} }, structuredClone, InvenioAuthReady: Promise.resolve(true),
        InvenioCurrentProfile: { role }, InvenioProjectScope: { activeProject: { id: P, status: projectStatus } },
        confirm: () => true, alert: text => { alerts.push(text); }, prompt: () => answer,
        supabaseClient: { rpc },
        projectSupabaseClient: createProjectScopedClient({ from: table => new Query(table) }, () => P),
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    const run = async code => { await vm.runInContext(code, context); await settle(); };
    await run('loadMaterialLinks()');
    const field = id => document.getElementById(id);
    return { server, alerts, run, field, table: () => field('linksTableBody').innerHTML,
        // A live update from the database, as the realtime subscription applies it to the list.
        live: (id, values) => { vm.runInContext(`Object.assign(state.materialLinks.find(item => item.id === ${id}), ${JSON.stringify(values)})`, context); Object.assign(server.links.find(row => row.id === id), values); },
        drop: id => { vm.runInContext(`state.materialLinks = state.materialLinks.filter(item => item.id !== ${id})`, context); server.links = server.links.filter(row => row.id !== id); },
        listed: () => [...vm.runInContext('state.materialLinks.map(link => link.id)', context)],
        writes: () => server.log.filter(request => request.action !== 'select'), row: id => server.links.find(row => row.id === id) };
}

test('only an administrator on an active project gets Edit and Delete', async () => {
    for (const [options, admin] of [[{ role: 'office_staff' }, false], [{ role: 'field_worker' }, false], [{ role: 'admin' }, true], [{ role: 'admin', projectStatus: 'completed' }, false]]) {
        const page = await openPage(options);
        assert.match(page.table(), /updateLinkStatus\(7, 'ordered'\)/, JSON.stringify(options));
        assert.equal(/editLink\(7\)/.test(page.table()), admin, `Edit: ${JSON.stringify(options)}`);
        assert.equal(/deleteLink\(7\)/.test(page.table()), admin, `Delete: ${JSON.stringify(options)}`);
    }
});

test('Delete asks why, sends the reason to the audited function, and drops the link', async () => {
    const page = await openPage({ role: 'admin', answer: '  Linked to the wrong PO  ' });
    await page.run('deleteLink(7)');
    assert.deepEqual(page.server.rpcs, [['admin_delete_material_link', { p_link_id: 7, p_reason: 'Linked to the wrong PO' }]]);
    assert.deepEqual(page.writes(), [], 'nothing deletes the row directly');
    assert.deepEqual(page.alerts, ['✓ Link #7 deleted.']);
    assert.deepEqual(page.listed(), [8]);
});

test('Delete sends nothing when cancelled or without a reason of 5 characters', async () => {
    const cancelled = await openPage({ role: 'admin', answer: null });
    await cancelled.run('deleteLink(7)');
    assert.deepEqual([cancelled.server.rpcs, cancelled.alerts], [[], []]);
    const short = await openPage({ role: 'admin', answer: 'oops' });
    await short.run('deleteLink(7)');
    assert.deepEqual(short.server.rpcs, []);
    assert.deepEqual(short.alerts, ['✗ Link not deleted: give a reason of 5 to 500 characters.']);
    assert.deepEqual(short.listed(), [7, 8]);
});

test('a delete the database refuses says why and keeps the link', async () => {
    const page = await openPage({ role: 'office_staff', answer: 'Made in error' });
    await page.run('deleteLink(7)');
    assert.deepEqual(page.alerts, ['✗ Failed to delete link: Only an administrator can delete a link']);
    assert.deepEqual(page.listed(), [7, 8]);
    assert.ok(page.row(7), 'still stored');
});

test('Edit sends only what changed, with the reason, and closes once saved', async () => {
    const page = await openPage({ role: 'admin' });
    await page.run('editLink(7)');
    const dialog = page.field('linkEditDialog');
    assert.equal(dialog.open, true);
    assert.equal(page.field('linkEdit-install_tag').value, 'V-107');
    assert.equal(page.field('linkEdit-install_discipline').value, 'Mechanical');
    page.field('linkEdit-install_tag').value = ' V-107A ';
    page.field('linkEdit-quantity').value = '3';
    page.field('linkEdit-po_description').value = '';
    page.field('linkEditReason').value = 'Tag was mistyped on the drawing';
    await page.run('saveLinkEdit(7)');
    assert.deepEqual(page.server.rpcs, [['admin_update_material_link', { p_link_id: 7, p_changes: { po_description: null, install_tag: 'V-107A', quantity: 3 },
        p_reason: 'Tag was mistyped on the drawing', p_expected: { po_description: 'Six-inch isolation valve', install_tag: 'V-107', quantity: 2 } }]]);
    assert.equal(dialog.open, false);
    assert.deepEqual(page.alerts, ['✓ Link #7 updated.']);
    assert.equal(page.row(7).install_tag, 'V-107A');
    assert.deepEqual(page.writes(), [], 'details are never written to the table directly');
});

test("details nobody touched aren't sent, even when they have stray spaces, and line breaks survive", async () => {
    const page = await openPage({ role: 'admin', links: [link(7, { uom: 'EA ', install_description: ' Valve', po_description: 'First line\nSecond line' })] });
    await page.run('editLink(7)');
    assert.equal(page.field('linkEdit-install_description').tagName, 'TEXTAREA');
    page.field('linkEdit-quantity').value = '3';
    page.field('linkEdit-install_description').value = 'Gate valve\nflanged both ends';
    page.field('linkEditReason').value = 'Counted again on site';
    await page.run('saveLinkEdit(7)');
    assert.deepEqual(page.server.rpcs[0][1].p_changes, { install_description: 'Gate valve\nflanged both ends', quantity: 3 });
    assert.deepEqual(page.server.rpcs[0][1].p_expected, { install_description: ' Valve', quantity: 2 });
});

test('a live update while the form is open is neither undone nor overwritten', async () => {
    const page = await openPage({ role: 'admin' });
    await page.run('editLink(7)');
    page.live(7, { install_tag: 'V-FIXED-ELSEWHERE' });
    page.field('linkEdit-quantity').value = '3';
    page.field('linkEditReason').value = 'Counted again on site';
    await page.run('saveLinkEdit(7)');
    assert.deepEqual(page.server.rpcs[0][1].p_changes, { quantity: 3 }, 'the other change is not sent back');
    assert.equal(page.row(7).install_tag, 'V-FIXED-ELSEWHERE');
    const clash = await openPage({ role: 'admin' });
    await clash.run('editLink(7)');
    clash.live(7, { quantity: 5 });
    clash.field('linkEdit-quantity').value = '3';
    clash.field('linkEditReason').value = 'Counted again on site';
    await clash.run('saveLinkEdit(7)');
    assert.equal(clash.field('linkEditMessage').textContent, 'Not saved: Link #7 has changed since the form opened (quantity); open it again');
    assert.equal(clash.field('linkEditDialog').open, true);
    assert.equal(clash.row(7).quantity, 5);
});

test('a description stored with CRLF line breaks is not sent back unchanged', async () => {
    const page = await openPage({ role: 'admin', links: [link(7, { po_description: 'Line one\r\nLine two' })] });
    await page.run('editLink(7)');
    // A browser's text area gives line breaks back as LF.
    page.field('linkEdit-po_description').value = 'Line one\nLine two';
    page.field('linkEdit-quantity').value = '3';
    page.field('linkEditReason').value = 'Counted again on site';
    await page.run('saveLinkEdit(7)');
    assert.deepEqual(page.server.rpcs[0][1].p_changes, { quantity: 3 });
});

test('after a "changed since" refusal the list is read again, so opening the form again starts from what is stored', async () => {
    const page = await openPage({ role: 'admin' });
    await page.run('editLink(7)');
    page.row(7).quantity = 5; // changed in the database without a live update reaching the page
    page.field('linkEdit-quantity').value = '3';
    page.field('linkEditReason').value = 'Counted again on site';
    await page.run('saveLinkEdit(7)');
    assert.match(page.field('linkEditMessage').textContent, /has changed since the form opened \(quantity\)/);
    await page.run('editLink(7)');
    assert.equal(page.field('linkEdit-quantity').value, '5');
    page.field('linkEdit-quantity').value = '3';
    page.field('linkEditReason').value = 'Counted again on site';
    await page.run('saveLinkEdit(7)');
    assert.deepEqual(page.server.rpcs[1][1].p_expected, { quantity: 5 });
    assert.deepEqual(page.alerts, ['✓ Link #7 updated.']);
    assert.equal(page.row(7).quantity, 3);
});

test('a link deleted while the form is open says so instead of doing nothing', async () => {
    const page = await openPage({ role: 'admin' });
    await page.run('editLink(7)');
    page.drop(7);
    page.field('linkEdit-quantity').value = '3';
    page.field('linkEditReason').value = 'Counted again on site';
    await page.run('saveLinkEdit(7)');
    assert.equal(page.field('linkEditMessage').textContent, 'Link #7 has been deleted.');
    assert.equal(page.field('linkEditMessage').hidden, false);
    assert.deepEqual(page.server.rpcs, []);
});

test('Edit checks the form before sending anything', async () => {
    const page = await openPage({ role: 'admin' });
    await page.run('editLink(7)');
    const message = () => page.field('linkEditMessage').textContent;
    const save = async () => { await page.run('saveLinkEdit(7)'); return message(); };
    assert.equal(await save(), 'Nothing has changed.');
    page.field('linkEdit-po_id').value = '  ';
    assert.equal(await save(), 'A link needs a PO number.');
    page.field('linkEdit-po_id').value = 'PO-20007';
    page.field('linkEdit-po_line_item').value = '1.5';
    assert.equal(await save(), 'The PO line must be a whole number, 0 or more.');
    page.field('linkEdit-po_line_item').value = '10';
    page.field('linkEdit-quantity').value = '-2';
    assert.equal(await save(), 'The quantity must be a number, 0 or more.');
    page.field('linkEdit-quantity').value = '4';
    page.field('linkEditReason').value = 'typo';
    assert.equal(await save(), 'Give a reason of 5 to 500 characters.');
    assert.deepEqual(page.server.rpcs, []);
    assert.equal(page.field('linkEditDialog').open, true);
});

test('an edit the database turns down stays open and says why', async () => {
    const page = await openPage({ role: 'admin', refuse: { code: '22023', message: 'The discipline is Civil, Electrical, Instrumentation, Mechanical or Steel' } });
    await page.run('editLink(7)');
    page.field('linkEdit-install_tag').value = 'V-200';
    page.field('linkEditReason').value = 'Renumbered on the drawing';
    await page.run('saveLinkEdit(7)');
    assert.equal(page.field('linkEditMessage').textContent, 'Not saved: The discipline is Civil, Electrical, Instrumentation, Mechanical or Steel');
    assert.equal(page.field('linkEditMessage').hidden, false);
    assert.equal(page.field('linkEditDialog').open, true);
    assert.equal(page.field('linkEditSave').disabled, false);
    assert.deepEqual(page.alerts, []);
});

test("a status change row security turns away says so, for a field worker or a project that isn't active", async () => {
    for (const options of [{ role: 'field_worker' }, { projectStatus: 'completed' }]) {
        const page = await openPage(options);
        await page.run("updateLinkStatus(7, 'ordered')");
        assert.deepEqual(page.writes().map(request => [request.action, request.values.material_status]), [['update', 'shipped']]);
        assert.deepEqual(page.alerts, ['✗ Failed to update status: only office staff can change links, and only while the project is active.'], JSON.stringify(options))
        assert.equal(page.row(7).material_status, 'ordered');
    }
    const office = await openPage();
    await office.run("updateLinkStatus(7, 'ordered')");
    assert.deepEqual(office.alerts, ['✓ Link status updated successfully!']);
    assert.equal(office.row(7).material_status, 'shipped');
});

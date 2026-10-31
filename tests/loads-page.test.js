// Runs loads.js against the fake DOM and the loads model (tests/support/loads-model.js, 022's rules and refusal
// messages), read through the real project-scoped client, so the Loads page is tested by what it does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('../js/utils/inventory-helpers');
const loadsHelpers = require('../js/utils/loads-helpers');
const { createProjectScopedClient } = require('../js/utils/project-scope');
const { emptyLoads, createModel } = require('./support/loads-model');
const { fakeDocument, assertFocus } = require('./support/fake-dom');

const source = fs.readFileSync('loads.js', 'utf8');
const P = 'p1';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LICENCE = 'D1234-5678-90';
// Objects made inside the page's vm context aren't deepEqual to this file's; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
// The page's operations reload the board and the load (several reads each), so let them all finish.
const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve));
};
const ago = days => new Date(Date.now() - days * 86400000).toISOString();

/**
 * Places, crates, items and five loads: planning (licence on file), in transit, delivered (one piece missing), closed long
 * ago, cancelled. The office planned them all.
 */
function world() {
    const place = (n, name, kind, extra = {}) => ({ id: id(n), name, kind, project_id: null, is_active: true, city: 'Freeport', state: 'TX', ...extra });
    const unit = (n, code, status, extra = {}) => ({ id: id(n), project_id: P, code, kind: 'crate', description: `${code} spares`, is_high_value: false, status, parent_id: null,
        top_unit_id: id(n), top_code: code, place_id: null, place_name: null, ...extra });
    const item = (n, tag, name) => ({ uid: id(n), project_id: P, qr_code: tag, inventory_item: name, count_status: 'counted' });
    const load = (n, number, status, extra = {}) => ({ id: id(n), project_id: P, load_number: number, status, origin_place_id: id(1), planned_date: null, truck_type: null, truck_number: null,
        trailer_number: null, bol_number: null, driver_name: null, driver_phone: null, licence_recorded_at: null, licence_override_reason: null, licence_override_at: null,
        started_in_field: false, notes: null, departed_at: null, delivered_at: null, closed_at: null, created_at: ago(10), updated_at: ago(1), ...extra });
    const stop = (n, loadN, seq, placeN, extra = {}) => ({ id: id(n), project_id: P, load_id: id(loadN), seq, place_id: id(placeN), kind: 'dropoff', planned_date: null, status: 'pending',
        arrived_at: null, completed_at: null, ...extra });
    const line = (n, loadN, tag, unitOrItem, dropoff, status, extra = {}) => ({ id: id(n), project_id: P, load_id: id(loadN), unit_id: tag.startsWith('HU-') ? id(unitOrItem) : null,
        material_id: null, inventory_uid: tag.startsWith('HU-') ? null : id(unitOrItem), tag, pickup_stop_id: null, dropoff_stop_id: id(dropoff), status, flag: null, added_in_field: false,
        unit_status_before: 'sealed', delivered_stop_id: null, delivered_place_id: null, delivered_source: null, note: null, on_at: null, off_at: null, created_at: ago(5), updated_at: ago(5), ...extra });
    return {
        places: [place(1, 'North Yard', 'yard', { project_id: P }), place(2, 'Fixture Machine Works', 'outside_shop', { city: 'Houston' }), place(3, 'Coastal Terminal', 'site'),
            place(4, 'Old Yard', 'yard', { is_active: false }), place(5, 'West Yard', 'yard', { project_id: 'p9' }), place(6, 'Gulf Valve Supply', 'vendor')],
        units: [unit(11, 'HU-AAAA11', 'sealed'), unit(12, 'HU-BBBB22', 'open', { parent_id: id(11), top_unit_id: id(11), top_code: 'HU-AAAA11' }),
            unit(15, 'HU-EEEE55', 'delivered', { place_id: id(2), place_name: 'Fixture Machine Works' }), unit(16, 'HU-HIGH01', 'on_load', { is_high_value: true, description: 'Instruments' }),
            unit(17, 'HU-FREE77', 'sealed')],
        items: [item(21, 'T-100', 'Pump'), item(22, 'T-101', 'Packed valve'), item(23, 'T-102', 'Spare gasket'), item(24, 'T-103', 'Cable drum'), item(25, 'T-104', 'Filter housing'), item(26, 'T-105', 'Junction box')],
        ...emptyLoads(),
        loads: [
            load(31, 'L-0001', 'planning', { origin_place_id: id(6), planned_date: '2026-11-03', truck_type: 'Flatbed', truck_number: 'TRK-118', trailer_number: 'TR-9', bol_number: 'BOL-1',
                driver_name: 'Dana Ruiz', driver_phone: '555-0170', licence_recorded_at: ago(2) }),
            load(32, 'L-0002', 'in_transit', { driver_name: 'Morgan Lee', departed_at: ago(1), licence_recorded_at: ago(1) }),
            load(33, 'L-0003', 'delivered', { driver_name: 'Sam Patel', departed_at: ago(13), delivered_at: ago(12) }),
            load(34, 'L-0004', 'closed', { driver_name: 'Riley Shah', closed_at: ago(100), licence_recorded_at: ago(130) }),
            load(35, 'L-0005', 'cancelled', { closed_at: ago(5) }),
        ],
        load_companies: [{ id: id(61), project_id: P, load_id: id(31), position: 1, name: 'Fixture Freight', role: 'broker', contact_name: 'Ana Gomez', phone: '555-0190' }],
        load_stops: [stop(41, 31, 1, 2), stop(42, 31, 2, 3, { kind: 'both' }), stop(43, 32, 1, 2), stop(44, 32, 2, 3, { kind: 'pickup' }),
            stop(45, 33, 1, 2, { status: 'done', arrived_at: ago(12), completed_at: ago(12) })],
        load_lines: [line(51, 31, 'HU-AAAA11', 11, 41, 'planned'), line(52, 31, 'T-100', 21, 42, 'planned'), line(53, 31, 'T-102', 23, 41, 'removed'),
            line(54, 32, 'HU-HIGH01', 16, 43, 'on_board', { on_at: ago(1) }), line(55, 32, 'T-103', 24, 43, 'on_board', { on_at: ago(1) }),
            line(56, 33, 'HU-EEEE55', 15, 45, 'delivered', { on_at: ago(13), off_at: ago(12), delivered_stop_id: id(45), delivered_place_id: id(2), delivered_source: 'scan' }),
            line(57, 33, 'T-104', 25, 45, 'missing', { on_at: ago(13) })],
        load_driver_licences: [{ load_id: id(32), project_id: P, licence_number: LICENCE, licence_state: 'TX', licence_expiry: '2028-04-30', recorded_at: ago(1), removed_at: null },
            { load_id: id(34), project_id: P, licence_number: 'R9876-5432', licence_state: 'LA', licence_expiry: null, recorded_at: ago(130), removed_at: null },
            { load_id: id(31), project_id: P, licence_number: 'K555-0001-77', licence_state: 'TX', licence_expiry: null, recorded_at: ago(2), removed_at: null }],
        driver_licence_photos: [{ id: id(71), load_id: id(32), project_id: P, storage_path: `${id(32)}/front.jpg`, created_at: ago(1), removed_at: null },
            { id: id(72), load_id: id(34), project_id: P, storage_path: `${id(34)}/front.jpg`, created_at: ago(130), removed_at: null },
            { id: id(73), load_id: id(31), project_id: P, storage_path: `${id(31)}/front.jpg`, created_at: ago(2), removed_at: null }],
        licence_objects: [`${id(32)}/front.jpg`, `${id(34)}/front.jpg`, `${id(31)}/front.jpg`],
    };
}

/** The model behind a fake Supabase client. Set `paused` to hold every request until step() lets the oldest through. */
function fakeServer(state, { role }) {
    const office = () => ['office_staff', 'admin'].includes(role);
    const model = createModel(state, { projectId: P, office, admin: () => role === 'admin', packedIn: tag => tag === 'T-101' ? 'HU-AAAA11' : null });
    const server = { state, model, log: [], paused: false, waiting: [], fail: null };
    server.step = () => server.waiting.shift()();
    const reads = { ...model.views, load_companies: () => state.load_companies, places: () => state.places, load_write_offs: () => state.load_write_offs,
        load_driver_licences: () => office() ? state.load_driver_licences : [], driver_licence_photos: () => office() ? state.driver_licence_photos : [] };
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        const attempt = run => { try { return { data: run(), error: null }; } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; } };
        if (request.rpc === 'apply_field_operation') return attempt(() => model.apply(request.args.p_action, request.args.p_payload));
        if (request.rpc) return attempt(() => model.call(request.rpc, request.args));
        if (request.storage === 'upload') { const { error } = model.storage.upload(request.path); return { data: error ? null : { path: request.path }, error }; }
        if (request.storage === 'signed') return model.storage.canRead(request.path) ? { data: { signedUrl: `signed:${request.path}` }, error: null } : { data: null, error: { message: 'Object not found' } };
        if (request.storage === 'remove') return { data: model.storage.remove(request.paths).map(name => ({ name })), error: null };
        if (request.storage === 'list') return { data: model.storage.list(request.prefix), error: null };
        const rows = reads[request.table]().filter(row => request.filters.every(([key, value]) => (row[key] ?? null) === value)).map(row => structuredClone(row));
        if (request.one) return { data: rows[0] || null, error: null };
        return { data: rows.slice(request.from, request.to + 1), error: null };
    }
    class Query {
        constructor(table) { this.request = { table, filters: [], from: 0, to: 999 }; }
        select(columns) { this.request.columns = columns; return this; }
        order() { return this; }
        range(from, to) { Object.assign(this.request, { from, to }); return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        is(key, value) { this.request.filters.push([key, value]); return this; }
        maybeSingle() { this.request.one = true; return this; }
        then(resolve, reject) { return respond(this.request).then(resolve, reject); }
    }
    server.client = {
        from: table => new Query(table), rpc: (rpc, args) => respond({ rpc, args }),
        storage: { from: bucket => ({
            upload: (path, file, options) => respond({ storage: 'upload', bucket, path, file, options }),
            createSignedUrl: (path, seconds) => respond({ storage: 'signed', bucket, path, seconds }),
            remove: paths => respond({ storage: 'remove', bucket, paths }),
            list: (prefix, options) => respond({ storage: 'list', bucket, prefix, options }),
        }) },
    };
    server.ops = () => server.log.filter(request => request.rpc === 'apply_field_operation').map(request => request.args);
    server.calls = name => server.log.filter(request => request.rpc === name);
    server.load = number => state.loads.find(load => load.load_number === number);
    return server;
}

async function openPage({ role = 'admin', projectStatus = 'active', search = '', state = world(), fail = null } = {}) {
    const server = fakeServer(state, { role }), confirms = [], opened = [];
    server.fail = fail;
    const { document, Option } = fakeDocument();
    // loads.html's drawer: a header, the fieldset of sections and a status line inside the dialog.
    const dialog = document.getElementById('loadDrawer');
    for (const part of ['loadHeader', 'loadBody', 'loadStatus']) dialog.append(document.getElementById(part));
    const context = {
        document, Option, console, setTimeout, structuredClone, Intl, URLSearchParams, crypto: globalThis.crypto, location: { search },
        confirm: text => { confirms.push(text); return context.confirmAnswer ?? true; },
        open: () => {
            if (context.blockPopups) return null;
            const printWindow = { ...fakeDocument(), closed: false, opener: 'page', printed: 0, focus() {}, print() { this.printed++; }, close() { this.closed = true; } };
            opened.push(printWindow);
            return printWindow;
        },
        InvenioAuthReady: Promise.resolve(true), InvenioInventory: inventory, InvenioLoads: loadsHelpers, InvenioCurrentProfile: { role },
        InvenioProjectScope: { getActiveProjectId: () => P, activeProject: { id: P, name: 'North Yard project', status: projectStatus } },
        supabaseClient: server.client, projectSupabaseClient: createProjectScopedClient(server.client, () => P),
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    await settle();
    const $ = id => document.getElementById(id);
    const drawer = $('loadDrawer'), body = $('loadBody');
    const columns = () => Object.fromEntries($('loadBoard').querySelectorAll('section').map(column => [column.querySelector('h2').textContent,
        column.querySelectorAll('.load-card').map(card => card.querySelector('strong').textContent)]));
    const card = number => $('loadBoard').querySelectorAll('.load-card').find(node => node.querySelector('strong').textContent === number);
    const open = async number => { card(number).click(); await settle(); };
    const section = name => body.querySelector(`[data-section="${name}"]`);
    const find = (text, within = drawer) => within.querySelectorAll('button').find(node => node.textContent === text || node.getAttribute('aria-label') === text);
    const press = async (text, within) => { find(text, within).click(); await settle(); };
    const input = id => drawer.querySelector(`[id="${id}"]`);
    const set = (id, value) => { const control = input(id); control.value = value; control.dispatch('input'); control.dispatch('change'); };
    const submit = async name => { await section(name).querySelector('form').onsubmit({ preventDefault() {} }); await settle(); };
    const status = () => $('loadStatus').textContent;
    const rows = name => section(name).querySelectorAll('tbody').flatMap(tbody => tbody.childNodes.map(row => row.childNodes.map(cell => cell.textContent)));
    return { server, document, context, $, drawer, body, columns, card, open, section, find, press, input, set, submit, status, rows, confirms, opened };
}

test('the board shows open loads by status, read through the project scope; closed and cancelled are one switch away', async () => {
    const page = await openPage();
    assert.deepEqual(plain(page.columns()), { 'Planning (1)': ['L-0001'], 'Loading (0)': [], 'In transit (1)': ['L-0002'], 'Delivered (1)': ['L-0003'] });
    const [read] = page.server.log.filter(request => request.table === 'load_overview');
    assert.deepEqual(plain(read.filters), [['project_id', P]]);
    const text = page.card('L-0001').textContent;
    for (const part of ['L-0001', 'From Gulf Valve Supply · Next: Fixture Machine Works', 'Driver Dana Ruiz', 'Planned 2']) assert.ok(text.includes(part), part);
    assert.ok(page.card('L-0002').textContent.includes('Licence on file'));
    assert.ok(page.card('L-0002').textContent.includes('On board 2'));
    assert.ok(page.card('L-0003').textContent.includes('Delivered 1 · Missing 1'));
    assert.equal(page.$('resultSummary').textContent, '3 open loads');
    page.$('showFinished').click();
    assert.deepEqual(plain(page.columns()), { 'Closed and cancelled (2)': ['L-0005', 'L-0004'] });
    assert.equal(page.$('showFinished').getAttribute('aria-pressed'), 'true');
});

test('a new load is created by load_save with a fresh load ID, then opens in full', async () => {
    const page = await openPage();
    page.$('newLoad').click(); await settle();
    assert.equal(page.drawer.open, true);
    assert.deepEqual(page.body.querySelectorAll('section').map(node => node.dataset.section), ['details']);
    assertFocus(page, page.input('origin'));
    page.set('origin', id(1)); page.set('plannedDate', '2026-11-20'); page.set('driverName', '  Kim Ito ');
    await page.submit('details');
    const [operation] = page.server.ops();
    assert.equal(operation.p_action, 'load_save');
    assert.equal(operation.p_project_id, P);
    assert.match(operation.p_operation_id, /^[0-9a-f-]{36}$/);
    assert.match(operation.p_payload.loadId, /^[0-9a-f-]{36}$/);
    assert.notEqual(operation.p_payload.loadId, operation.p_operation_id);
    assert.deepEqual(plain({ ...operation.p_payload, loadId: 'new' }), { loadId: 'new', originPlaceId: id(1), plannedDate: '2026-11-20', truckType: '', truckNumber: '', trailerNumber: '',
        bolNumber: '', driverName: 'Kim Ito', driverPhone: '', notes: '' });
    assert.equal(page.status(), 'Created L-0006.');
    assert.equal(page.drawer.querySelector('h2').textContent, 'L-0006');
    assert.deepEqual(page.body.querySelectorAll('section').map(node => node.dataset.section), ['actions', 'details', 'companies', 'stops', 'manifest', 'licence']);
    assert.deepEqual(plain(page.columns())['Planning (2)'], ['L-0006', 'L-0001']);
});

test('details save every field, so a cleared one is cleared; a refusal is shown as the database words it', async () => {
    const page = await openPage();
    await page.open('L-0001');
    assert.equal(page.input('truckNumber').value, 'TRK-118');
    page.set('truckNumber', ''); page.set('notes', 'Call before arriving');
    page.set('plannedDate', '2026-02-30');
    await page.submit('details');
    assert.equal(page.status(), 'Planned date must be a date like 2026-11-30.');
    assert.equal(page.server.ops().length, 0);
    page.set('plannedDate', '2026-11-04');
    await page.submit('details');
    assert.equal(page.server.load('L-0001').truck_number, null);
    assert.equal(page.server.load('L-0001').notes, 'Call before arriving');
    assert.equal(page.status(), "Saved L-0001's details.");
    // Fixture Machine Works is retired meanwhile, so the origin is refused with 022's reason.
    page.server.state.places[1].is_active = false;
    page.set('origin', id(2));
    await page.submit('details');
    assert.equal(page.status(), 'Could not save L-0001: That place is unavailable');
    assert.equal(page.input('origin').value, id(2), 'the form keeps what was chosen');
});

test('companies: up to 3, reordered and removed in the form, saved in order', async () => {
    const page = await openPage();
    await page.open('L-0001');
    await page.press('Add company'); await page.press('Add company');
    assert.equal(page.find('Add company').disabled, true, 'three is the most');
    page.set('companyName1', 'Example Haulage'); page.set('companyRole1', 'carrier'); page.set('companyPhone2', '555-0199');
    await page.press('Save companies');
    assert.equal(page.status(), 'Company 3 needs a name.');
    assert.equal(page.server.ops().length, 0);
    page.set('companyName2', 'Owner Ops'); page.set('companyRole2', 'other');
    await page.press('Move company 3 up');
    await page.press('Remove company 1');
    await page.press('Save companies');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload.companies), [{ name: 'Owner Ops', role: 'other', contactName: '', phone: '555-0199' },
        { name: 'Example Haulage', role: 'carrier', contactName: '', phone: '' }]);
    assert.deepEqual(page.server.state.load_companies.filter(row => row.load_id === id(31)).map(row => [row.position, row.name]), [[1, 'Owner Ops'], [2, 'Example Haulage']]);
    assert.equal(page.status(), "Saved L-0001's companies.");
});

test('stops: added with their own IDs, reordered and saved; a stop that still has pieces is refused; after departure they are a list', async () => {
    const page = await openPage();
    await page.open('L-0001');
    await page.press('Add stop');
    page.set('stopPlace2', id(1)); page.set('stopKind2', 'pickup'); page.set('stopDate2', '2026-11-05');
    await page.press('Move stop 3 up');
    await page.press('Save stops');
    const stops = page.server.ops().at(-1).p_payload.stops;
    assert.deepEqual(plain(stops.map(stop => [stop.placeId, stop.kind, stop.plannedDate])), [[id(2), 'dropoff', null], [id(1), 'pickup', '2026-11-05'], [id(3), 'both', null]]);
    assert.deepEqual([stops[0].id, stops[2].id], [id(41), id(42)], 'existing stops keep their IDs');
    assert.match(stops[1].id, /^[0-9a-f-]{36}$/);
    assert.equal(page.status(), "Saved L-0001's stops.");
    await page.press('Remove stop 1');
    await page.press('Save stops');
    assert.equal(page.status(), 'Could not save L-0001\'s stops: The stop at Fixture Machine Works still has pieces planned for it; move them to another stop first');
    assert.equal(page.section('stops').querySelectorAll('.stop-row').length, 2, 'the edit stays on screen to fix');

    await page.open('L-0002');
    assert.equal(page.find('Save stops'), undefined);
    assert.deepEqual(page.section('stops').querySelectorAll('.stop-item').map(item => item.querySelector('strong').textContent), ['1. Fixture Machine Works', '2. Coastal Terminal']);
});

test('the manifest is grouped by drop-off stop; pieces are planned by code and taken off the plan', async () => {
    const page = await openPage();
    await page.open('L-0001');
    assert.deepEqual(page.section('manifest').querySelectorAll('h4').map(node => node.textContent), ['Stop 1 · Fixture Machine Works (Drop-off)', 'Stop 2 · Coastal Terminal (Drop-off and pick-up)']);
    assert.deepEqual(page.rows('manifest').map(row => row.slice(0, 2)), [['HU-AAAA11', 'HU-AAAA11 sparesCrate'], ['T-100', 'PumpItem']], 'the removed T-102 is not listed');
    page.set('planCode', 'T-101'); page.set('planStop', id(42));
    await page.submit('manifest');
    assert.equal(page.status(), 'Could not plan T-101: T-101 is packed in HU-AAAA11; load the crate instead');
    assert.deepEqual([page.input('planCode').value, page.input('planStop').value], ['T-101', id(42)], 'what was typed stays to correct');
    page.set('planCode', 'hu-free77');
    await page.submit('manifest');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload), { loadId: id(31), add: [{ code: 'hu-free77', dropoffStopId: id(42) }] });
    assert.equal(page.status(), 'Planned hu-free77 on L-0001.');
    assert.ok(page.rows('manifest').some(row => row[0] === 'HU-FREE77'));
    assert.equal(page.input('planCode').value, '', 'cleared for the next piece');
    await page.press('Remove T-100 from the plan');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload), { loadId: id(31), remove: ['T-100'] });
    assert.ok(!page.rows('manifest').some(row => row[0] === 'T-100'));
});

test('Mark loaded and depart confirms every planned piece; Cancel load puts crates back', async () => {
    const page = await openPage();
    await page.open('L-0001');
    assert.equal(page.find("Depart with what's on board"), undefined, 'nothing has been scanned on');
    page.context.confirmAnswer = false;
    await page.press('Mark loaded and depart');
    assert.equal(page.server.ops().length, 0);
    page.context.confirmAnswer = true;
    await page.press('Mark loaded and depart');
    assert.match(page.confirms[1], /^Mark the 2 planned pieces as loaded and send L-0001 on its way\?/);
    assert.deepEqual(plain(page.server.ops()[0].p_payload), { loadId: id(31), confirmAll: true });
    assert.equal(page.status(), 'L-0001 has left with 2 pieces on board.');
    assert.equal(page.server.state.units[0].status, 'on_load');
    assert.deepEqual(plain(page.columns())['In transit (2)'].sort(), ['L-0001', 'L-0002']);

    const second = await openPage();
    second.server.state.load_lines[0].status = 'on_board';
    second.server.state.units[0].status = 'on_load';
    second.server.state.load_lines[0].on_at = ago(0);
    second.server.state.load_lines[0].unit_status_before = 'sealed';
    second.server.state.loads[0].status = 'loading';
    await second.open('L-0001');
    await second.press('Cancel load');
    assert.deepEqual(plain(second.server.ops()[0].p_payload), { loadId: id(31), cancel: true });
    assert.equal(second.server.state.units[0].status, 'sealed', 'the crate is back as it was');
    assert.equal(second.status(), 'L-0001 is cancelled.');
});

test('departing with what was scanned leaves the rest behind; the driver is needed first', async () => {
    const state = world();
    Object.assign(state.load_lines[1], { status: 'on_board', on_at: ago(0) });
    Object.assign(state.loads[0], { status: 'loading', driver_name: null });
    const page = await openPage({ state });
    await page.open('L-0001');
    assert.ok(page.section('actions').textContent.includes("Add the driver's name before the truck leaves."));
    await page.press("Depart with what's on board");
    assert.match(page.confirms[0], /with the 1 piece on board\? 1 planned piece that wasn't scanned on will stay behind\.$/);
    assert.equal(page.status(), "Could not send L-0001 on its way: Add the driver's name before load L-0001 leaves");
    page.server.state.loads[0].driver_name = 'Dana Ruiz';
    await page.press("Depart with what's on board");
    assert.equal(page.status(), 'L-0001 has left with 1 piece on board; 1 piece stayed behind.');
    assert.ok(page.rows('manifest').some(row => row[0] === 'HU-AAAA11' && row[2].startsWith('Left behind')));
});

test('per stop: Mark delivered confirms without scanning; Finish stop warns that unscanned pieces become missing; then Close load', async () => {
    const page = await openPage();
    await page.open('L-0002');
    assert.equal(page.find('Mark delivered at stop 2 at Coastal Terminal'), undefined, 'a pick-up stop has nothing to deliver');
    await page.press('Mark delivered at stop 1 at Fixture Machine Works');
    assert.equal(page.confirms[0], 'Mark the 2 pieces due at stop 1 at Fixture Machine Works as delivered without scanning them, and finish the stop?');
    assert.deepEqual(plain(page.server.ops()[0].p_payload), { loadId: id(32), stopId: id(43), confirmAll: true });
    assert.equal(page.status(), 'Finished stop 1 at Fixture Machine Works: 2 pieces delivered.');
    await page.press('Finish stop 2 at Coastal Terminal');
    assert.equal(page.confirms[1], 'Finish stop 2 at Coastal Terminal?');
    assert.deepEqual(plain(page.server.ops()[1].p_payload), { loadId: id(32), stopId: id(44) });
    assert.equal(page.status(), 'Finished stop 2 at Coastal Terminal. Every stop of L-0002 is finished.');
    await page.press('Close load');
    assert.equal(page.confirms[2], "Close L-0002? Nothing on it can change after that. Its driver's licence is removed 90 days later.");
    assert.equal(page.server.load('L-0002').status, 'closed');

    const other = await openPage();
    await other.open('L-0002');
    await other.press('Finish stop 1 at Fixture Machine Works');
    assert.equal(other.confirms[0], "Finish stop 1 at Fixture Machine Works? Pieces due here that weren't scanned off (2 pieces now) become missing.");
    assert.equal(other.status(), 'Finished stop 1 at Fixture Machine Works. 2 pieces not scanned off are now missing.');
});

test('a missing piece is marked found at a place with a note (office only)', async () => {
    const page = await openPage();
    await page.open('L-0003');
    assert.ok(page.section('actions').textContent.includes('1 piece is missing.'));
    await page.press('Mark T-104 found');
    assertFocus(page, page.input('foundPlace'));
    assert.ok(!page.input('foundPlace').options.some(option => option.textContent.includes('West Yard')), "another project's place isn't offered");
    const found = async () => { await page.section('manifest').querySelector('.found-form').onsubmit({ preventDefault() {} }); await settle(); };
    await found();
    assert.equal(page.status(), 'Choose where T-104 turned up.');
    page.set('foundPlace', id(3)); page.set('foundNote', 'On the dock');
    await found();
    assert.equal(page.status(), 'T-104 is marked found at Coastal Terminal.');
    const operation = page.server.ops().find(op => op.p_action === 'line_found');
    assert.deepEqual(plain(operation.p_payload), { lineId: id(57), placeId: id(3), note: 'On the dock' });
    const line = page.server.state.load_lines.find(row => row.id === id(57));
    assert.deepEqual([line.status, line.flag, line.note], ['delivered', 'found', 'On the dock']);
});

test('field workers plan only loads a crew started, finish stops away from shops, and never confirm without scanning, close, cancel, mark found, write off or see licences', async () => {
    const page = await openPage({ role: 'field_worker' });
    assert.equal(page.$('newLoad').hidden, false);
    assert.equal(page.server.calls('driver_licences_due_for_removal').length, 0, 'no housekeeping');
    await page.open('L-0001');
    for (const text of ['Mark loaded and depart', 'Cancel load', 'Save stops', 'Add stop', 'Add to the plan', 'Remove T-100 from the plan']) assert.equal(page.find(text), undefined, text);
    assert.ok(page.section('stops').textContent.includes('The office plans the stops of this load.'));
    assert.ok(page.section('manifest').textContent.includes('The office plans what goes on this load. Crews scan pieces on with the phone.'));
    assert.equal(page.section('licence'), null);
    assert.equal(page.server.log.filter(request => ['load_driver_licences', 'driver_licence_photos'].includes(request.table)).length, 0, 'licences are never asked for');
    await page.open('L-0002');
    assert.equal(page.find('Mark delivered at stop 1 at Fixture Machine Works'), undefined);
    assert.equal(page.find('Finish stop 1 at Fixture Machine Works'), undefined, 'at an outside shop only office staff finish the stop');
    assert.ok(page.find('Finish stop 2 at Coastal Terminal'), 'anyone working the project finishes a stop at a site');
    assert.equal(page.find('Change stops'), undefined, 'only office staff change stops after departure');
    await page.open('L-0003');
    for (const text of ['Mark T-104 found', 'Write off T-104', 'Close load']) assert.equal(page.find(text), undefined, text);
    assert.ok(page.section('actions').textContent.includes('The office marks them found or writes them off.'));
});

test('while a change saves, the drawer is disabled, a second change says so, and Escape keeps it open', async () => {
    const page = await openPage();
    await page.open('L-0001');
    page.server.paused = true;
    page.find('Save companies').click();
    await settle();
    assert.equal(page.body.disabled, true);
    page.find('Save stops').click();
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.');
    page.drawer.escape(); page.drawer.escape({ activated: false });
    assert.equal(page.drawer.open, true);
    page.find('Print manifest').click();
    assert.equal(page.opened.length, 0, 'no print-out of data about to change');
    page.server.step(); await settle();
    assert.equal(page.server.waiting.length > 0, true, 'the reload is waiting, still locked');
    page.find('Save stops').click();
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.');
    page.server.paused = false;
    while (page.server.waiting.length) page.server.step();
    await settle();
    assert.equal(page.body.disabled, false);
    assert.equal(page.server.ops().length, 1);
});

test('unsaved edits survive another section saving, and closing asks before dropping them', async () => {
    const page = await openPage();
    await page.open('L-0001');
    page.set('driverPhone', '555-9999');
    await page.press('Add company');
    page.set('companyName1', 'Example Haulage');
    await page.press('Save companies');
    assert.equal(page.status(), "Saved L-0001's companies.");
    assert.equal(page.input('driverPhone').value, '555-9999', 'the unsaved details are still there');
    page.context.confirmAnswer = false;
    page.drawer.escape();
    assert.deepEqual([page.drawer.open, page.confirms.length], [true, 1]);
    page.drawer.escape({ activated: false });
    assert.deepEqual([page.drawer.open, page.confirms.length], [true, 2], 'a forced close asks again and reopens');
    page.context.confirmAnswer = true;
    await page.press('Close');
    assert.equal(page.drawer.open, false);
    assert.equal(page.context.InvenioUnsavedChanges, false);
});

test('the licence (office only): read, saved with a new operation ID each time, never echoed in full', async () => {
    const page = await openPage();
    await page.open('L-0002');
    assert.deepEqual([page.input('licenceNumber').value, page.input('licenceState').value, page.input('licenceExpiry').value], [LICENCE, 'TX', '2028-04-30']);
    page.set('licenceNumber', 'd1');
    await page.submit('licence');
    assert.equal(page.status(), 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes.');
    page.set('licenceNumber', ' d9876  5432 ');
    await page.submit('licence');
    await page.submit('licence');
    const calls = page.server.calls('record_driver_licence');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].args.p_operation_id, calls[1].args.p_operation_id);
    assert.deepEqual(plain(calls[0].args.p_licence), { number: 'D9876 5432', state: 'TX', expiry: '2028-04-30' });
    assert.equal(page.status(), 'Saved the licence ending 5432.');
    assert.equal(page.server.ops().length, 0, 'the number never goes through apply_field_operation');
    assert.ok(!page.$('pageMessage').textContent.includes('9876'));
    assert.ok(!page.card('L-0002').textContent.includes('5432'));
});

test('licence photos: shown through 5-minute signed links, uploaded without overwriting and attached under the save lock', async () => {
    const page = await openPage();
    await page.open('L-0002');
    const signed = page.server.log.filter(request => request.storage === 'signed');
    assert.deepEqual(plain(signed.map(request => [request.bucket, request.path, request.seconds])), [['driver-licences', `${id(32)}/front.jpg`, 300]]);
    assert.equal(page.section('licence').querySelector('img').src, `signed:${id(32)}/front.jpg`);
    const file = { type: 'image/jpeg', size: 2048, name: 'IMG_0001.jpg' };
    page.server.paused = true;
    const picker = page.input('licencePhoto'); picker.files = [file]; picker.onchange();
    await settle();
    assert.equal(page.body.disabled, true, 'locked from the start of the upload');
    page.find('Save companies').click();
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.');
    page.drawer.escape(); page.drawer.escape({ activated: false });
    assert.equal(page.drawer.open, true, "the drawer can't close or switch loads mid-upload");
    page.server.paused = false;
    while (page.server.waiting.length) page.server.step();
    await settle();
    const [upload] = page.server.log.filter(request => request.storage === 'upload');
    assert.match(upload.path, new RegExp(`^${id(32)}/[0-9a-f-]{36}\\.jpg$`));
    assert.deepEqual(plain(upload.options), { contentType: 'image/jpeg', upsert: false });
    assert.equal(upload.file, file);
    assert.deepEqual(plain(page.server.calls('attach_driver_licence_photo').map(call => call.args)), [{ p_load_id: id(32), p_path: upload.path }]);
    assert.equal(page.status(), 'Added the photo.');
    assert.equal(page.section('licence').querySelectorAll('img').length, 2);
    assert.equal(page.server.ops().length, 0, 'Save companies never ran');
    page.input('licencePhoto').files = [{ type: 'image/gif', size: 10 }]; page.input('licencePhoto').onchange();
    assert.equal(page.status(), 'Choose a JPEG or PNG photo.');
    page.server.state.driver_licence_photos.push(...[1, 2].map(n => ({ id: id(80 + n), load_id: id(32), project_id: P, storage_path: `${id(32)}/x${n}.jpg`, removed_at: null })));
    await page.open('L-0002');
    assert.equal(page.input('licencePhoto'), null);
    assert.ok(page.section('licence').textContent.includes('A load keeps at most 4 photos.'));
});

test('a photo uploaded but never attached is found in the bucket and attached, so the licence can still be removed later', async () => {
    const state = world();
    state.licence_objects.push(`${id(32)}/orphan.jpg`);
    let refusals = 1;
    const page = await openPage({ state, fail: request => request.rpc === 'attach_driver_licence_photo' && refusals-- > 0
        && { code: '22023', message: 'A load keeps at most 4 licence photos' } });
    await page.open('L-0002');
    assert.ok(page.server.log.some(request => request.storage === 'list' && request.bucket === 'driver-licences' && request.prefix === id(32)), "the load's folder is listed");
    assert.ok(page.section('licence').textContent.includes('1 uploaded photo isn’t attached to this load yet.'));
    await page.press('Attach the uploaded photo');
    assert.equal(page.status(), 'The photo was uploaded but could not be attached: A load keeps at most 4 licence photos. Attach it again from this section.');
    assert.ok(page.find('Attach the uploaded photo'), 'still offered after a refusal');
    await page.press('Attach the uploaded photo');
    assert.equal(page.status(), 'Attached the uploaded photos.');
    assert.ok(page.server.state.driver_licence_photos.some(row => row.storage_path === `${id(32)}/orphan.jpg`));
    assert.equal(page.find('Attach the uploaded photo'), undefined);
});

test('the printed manifest has the load, driver, truck, companies, one section per stop and signature lines, and never the licence', async () => {
    const page = await openPage();
    await page.open('L-0001');
    page.context.blockPopups = true;
    await page.press('Print manifest');
    assert.equal(page.status(), 'Allow pop-ups for this site, then choose Print manifest again.');
    page.context.blockPopups = false;
    await page.press('Print manifest');
    const [printWindow] = page.opened, printed = printWindow.document;
    assert.equal(printWindow.opener, null);
    assert.equal(printWindow.printed, 1);
    assert.equal(printed.title, 'Manifest L-0001 — North Yard project');
    const text = printed.body.textContent;
    for (const part of ['Manifest L-0001', 'Dana Ruiz · 555-0170', 'Flatbed TRK-118', 'TR-9', 'BOL-1', 'Fixture Freight · Broker · Ana Gomez · 555-0190',
        'Shipper: name, signature and date', 'Driver: name, signature and date', 'Receiver: name, signature and date']) assert.ok(text.includes(part), part);
    assert.deepEqual(printed.body.querySelectorAll('h2').map(node => node.textContent), ['Companies', 'Stop 1: Fixture Machine Works — Houston, TX', 'Stop 2: Coastal Terminal — Freeport, TX']);
    assert.deepEqual(printed.body.querySelectorAll('.tag').map(node => node.textContent), ['HU-AAAA11', 'T-100'], 'the removed T-102 is not printed');

    // L-0002 has a licence on file and a high-value crate.
    await page.open('L-0002');
    await page.press('Print manifest');
    const second = page.opened[1].document;
    assert.ok(second.body.textContent.includes('HIGH VALUE'));
    for (const secret of [LICENCE, '5678', 'TX 2028', '2028-04-30']) assert.ok(!second.body.textContent.includes(secret) && !second.title.includes(secret), `no ${secret}`);
});

test("opening Loads removes licences 90 days after a load closed, in every project: the folder first, then the number; failures don't stop the rest", async () => {
    const state = world();
    state.loads.push({ ...state.loads[3], id: id(36), load_number: 'L-0006' }, { ...state.loads[3], id: id(37), project_id: 'p2', load_number: 'L-0001' });
    state.load_driver_licences.push({ ...state.load_driver_licences[1], load_id: id(36) }, { ...state.load_driver_licences[1], load_id: id(37), project_id: 'p2' });
    state.licence_objects.push(`${id(34)}/never-attached.jpg`);
    const page = await openPage({ state });
    const steps = page.server.log.filter(request => request.rpc === 'driver_licences_due_for_removal' || request.rpc === 'remove_driver_licence' || request.storage === 'remove')
        .map(request => request.storage ? `remove ${request.paths.join(',')}` : request.rpc);
    assert.deepEqual(steps, ['driver_licences_due_for_removal', `remove ${id(34)}/front.jpg,${id(34)}/never-attached.jpg`, 'remove_driver_licence', 'remove_driver_licence', 'remove_driver_licence'],
        "022 lists every file in the folder, the unattached photo too, or it would refuse to remove the licence");
    assert.equal(page.server.log.filter(request => request.storage === 'list').length, 0, "022's list is used as it is");
    assert.equal(page.$('housekeeping').textContent, "Removed the driver's licence of 3 loads whose 90 days were up.");
    assert.ok(page.server.state.load_driver_licences.every(row => [id(31), id(32)].includes(row.load_id) || row.licence_number === null));
    assert.equal(page.card('L-0002').textContent.includes('Licence on file'), true);
    page.$('showFinished').click();
    assert.ok(!page.card('L-0004').textContent.includes('Licence on file'), 'not once the licence has been removed');

    const failing = world();
    failing.loads.push({ ...failing.loads[3], id: id(37), project_id: 'p2', load_number: 'L-0001' });
    failing.load_driver_licences.push({ ...failing.load_driver_licences[1], load_id: id(37), project_id: 'p2' });
    failing.licence_objects.push(`${id(37)}/front.jpg`);
    const second = await openPage({ state: failing, fail: request => request.storage === 'remove' && request.paths[0].startsWith(id(37)) && { message: 'Storage is unavailable' } });
    assert.equal(second.$('housekeeping').textContent,
        "Removed the driver's licence of 1 load whose 90 days were up. Could not remove the driver's licence of L-0001 in another project (Storage is unavailable).");
    assert.deepEqual(plain(second.columns())['Planning (1)'], ['L-0001'], 'the board is there regardless');

    const third = await openPage({ fail: request => request.rpc === 'driver_licences_due_for_removal' && { code: 'PGRST301', message: 'JWT expired' } });
    assert.equal(third.$('housekeeping').textContent, "Old driver's licences could not be checked (JWT expired).");
    assert.equal(third.server.calls('remove_driver_licence').length, 0);

    // Office staff whose open project isn't active still clean up and can read licences, but not change them.
    const onHold = await openPage({ projectStatus: 'on_hold' });
    assert.equal(onHold.server.calls('remove_driver_licence').length, 1);
    await onHold.open('L-0002');
    assert.ok(onHold.section('licence').textContent.includes(`Licence number${LICENCE}`));
    assert.equal(onHold.input('licenceNumber'), null);
    assert.equal(onHold.input('licencePhoto'), null);
});

test('?load= opens that load, as Outside Shops links do', async () => {
    const page = await openPage({ search: `?load=${id(33)}` });
    assert.equal(page.drawer.open, true);
    assert.equal(page.drawer.querySelector('h2').textContent, 'L-0003');
});

test('a closed load, or any load on a project that is not active, shows its details and companies as text', async () => {
    const page = await openPage();
    page.$('showFinished').click();
    await page.open('L-0004');
    assert.equal(page.section('details').querySelector('form'), null);
    assert.ok(page.section('details').textContent.includes('Driver nameRiley Shah'));
    assert.ok(page.section('details').textContent.includes('Truck typeNot recorded'));
    assert.equal(page.find('Save companies'), undefined);
    const closedProject = await openPage({ projectStatus: 'closed' });
    assert.equal(closedProject.$('newLoad').hidden, true);
    await closedProject.open('L-0001');
    assert.equal(closedProject.body.querySelectorAll('form').length, 0, 'nothing to edit, and office actions need an active project too');
    assert.ok(closedProject.section('companies').textContent.includes('Fixture Freight · Broker · Ana Gomez · 555-0190'));
    assert.equal(closedProject.find('Mark loaded and depart'), undefined);
});

test('details send only what changed, so another change stays and a retired origin does not block saving', async () => {
    const state = world();
    state.places[5].is_active = false; // L-0001's origin, Gulf Valve Supply, is retired
    const page = await openPage({ state });
    await page.open('L-0001');
    assert.equal(page.input('origin').options.find(option => option.value === id(6)).textContent, 'Gulf Valve Supply (retired)');
    await page.submit('details');
    assert.equal(page.status(), 'Nothing has changed.');
    assert.equal(page.server.ops().length, 0);
    page.server.state.loads[0].driver_name = 'Replacement Driver'; // someone at the dock changes the driver meanwhile
    page.set('notes', 'Call before arriving');
    await page.submit('details');
    assert.deepEqual(plain(page.server.ops()[0].p_payload), { loadId: id(31), notes: 'Call before arriving' });
    assert.equal(page.status(), "Saved L-0001's details.");
    assert.deepEqual([page.server.load('L-0001').driver_name, page.server.load('L-0001').origin_place_id], ['Replacement Driver', id(6)]);
    assert.equal(page.input('driverName').value, 'Replacement Driver', 'the form now shows the saved load');
});

test('lists nobody is editing are redrawn from the latest read; an edit the truck leaving makes pointless is dropped', async () => {
    const page = await openPage();
    await page.open('L-0001');
    page.server.state.load_companies[0].name = 'Renamed Freight';
    page.set('planCode', 'HU-FREE77');
    await page.submit('manifest');
    assert.equal(page.status(), 'Planned HU-FREE77 on L-0001.');
    assert.equal(page.input('companyName0').value, 'Renamed Freight');
    assert.ok(page.section('stops').textContent.includes('2 pieces planned to come off here'));
    await page.press('Add stop');
    assert.equal(page.context.InvenioUnsavedChanges, true);
    await page.press('Mark loaded and depart');
    assert.equal(page.find('Save stops'), undefined, 'the stop edit went with the departure');
    assert.equal(page.section('stops').querySelectorAll('.stop-item').length, 2);
    assert.equal(page.context.InvenioUnsavedChanges, false);
});

test('the found form keeps its place and note after a refusal; confirm counts come from the manifest just read', async () => {
    let refusals = 1;
    const page = await openPage({ fail: request => request.rpc === 'apply_field_operation' && request.args.p_action === 'line_found' && refusals-- > 0
        && { code: '22023', message: "T-104 isn't missing" } });
    await page.open('L-0003');
    await page.press('Mark T-104 found');
    page.set('foundPlace', id(3)); page.set('foundNote', 'On the dock by bay 4');
    await page.section('manifest').querySelector('.found-form').onsubmit({ preventDefault() {} }); await settle();
    assert.equal(page.status(), "Could not mark T-104 found: T-104 isn't missing");
    assert.deepEqual([page.input('foundPlace').value, page.input('foundNote').value], [id(3), 'On the dock by bay 4']);

    const state = world();
    const extra = (n, tag, item, fields) => ({ ...state.load_lines[1], id: id(n), tag, inventory_uid: id(item), ...fields });
    const board = await openPage({ state });
    // After the board was read, one more piece is planned, and one more for a pick-up stop (confirmAll leaves those).
    state.load_lines.push(extra(58, 'T-105', 26, {}), extra(59, 'T-101', 22, { pickup_stop_id: id(42), dropoff_stop_id: id(42) }));
    await board.open('L-0001');
    await board.press('Mark loaded and depart');
    assert.match(board.confirms[0], /^Mark the 3 planned pieces as loaded/);
});

test('a load created but not read back can be saved again without an error', async () => {
    const page = await openPage();
    page.$('newLoad').click(); await settle();
    page.set('driverName', 'Kim Ito');
    page.server.fail = request => request.table === 'load_overview' && { code: 'PGRST301', message: 'JWT expired' };
    await page.submit('details');
    assert.equal(page.status(), 'Created L-0006. The page could not refresh (JWT expired). Reload it.');
    page.server.fail = null;
    page.set('driverPhone', '555-0100');
    await page.submit('details');
    const [first, second] = page.server.ops();
    assert.equal(second.p_payload.loadId, first.p_payload.loadId, 'the same load, not a second one');
    assert.equal(page.server.state.loads.length, 6);
    assert.equal(page.drawer.querySelector('h2').textContent, 'L-0006');
});

test('the drawer is named while it loads, and focus lands on Close once it is drawn', async () => {
    const page = await openPage();
    page.server.paused = true;
    page.card('L-0002').click(); await settle();
    assert.equal(page.drawer.querySelector('h2').id, 'loadTitle');
    page.server.paused = false;
    while (page.server.waiting.length) page.server.step();
    await settle();
    assertFocus(page, page.find('Close'));
    const [table] = page.section('manifest').querySelectorAll('table');
    assert.equal(table.querySelectorAll('th').at(-1).textContent, 'Actions');
});

test('confirming without scanning is offered only where nobody scans: a truck leaving, or a stop at, an outside shop or vendor', async () => {
    const state = world();
    state.loads[0].origin_place_id = id(1); // L-0001 leaves our own yard
    state.load_stops.find(stop => stop.id === id(43)).place_id = id(3); // L-0002's first stop is a site
    const page = await openPage({ state });
    await page.open('L-0001');
    assert.equal(page.find('Mark loaded and depart'), undefined);
    assert.ok(page.section('actions').textContent.includes('Pieces are marked loaded without scanning only for a truck leaving an outside shop or vendor'));
    assert.ok(page.find('Cancel load'), 'other office actions stay');
    await page.open('L-0002');
    assert.equal(page.find('Mark delivered at stop 1 at Coastal Terminal'), undefined);
    assert.ok(page.find('Finish stop 1 at Coastal Terminal'));
    const shop = await openPage();
    await shop.open('L-0001');
    assert.ok(shop.find('Mark loaded and depart'), 'from Gulf Valve Supply, a vendor');
    await shop.open('L-0002');
    assert.ok(shop.find('Mark delivered at stop 1 at Fixture Machine Works'));
});

test('the licence section says when a daily job removes it, and each photo has a caption', async () => {
    const page = await openPage();
    await page.open('L-0002');
    assert.ok(page.section('licence').textContent.includes("A daily job removes it 90 days after the load closes, or after the load's last change if it never closes. Office staff can remove it sooner."));
    const [figure] = page.section('licence').querySelectorAll('figure');
    assert.ok(figure.querySelector('figcaption').textContent.startsWith('Photo 1 · added '));
});

/** L-0001 with nothing of the driver's licence recorded, and one piece scanned on. */
function noLicence() {
    const state = world();
    state.load_driver_licences = state.load_driver_licences.filter(row => row.load_id !== id(31));
    state.driver_licence_photos = state.driver_licence_photos.filter(row => row.load_id !== id(31));
    state.licence_objects = state.licence_objects.filter(path => !path.startsWith(id(31)));
    Object.assign(state.loads[0], { status: 'loading', licence_recorded_at: null });
    Object.assign(state.load_lines[1], { status: 'on_board', on_at: ago(0) });
    return state;
}
const submitForm = async (page, section, selector) => { await page.section(section).querySelector(selector).onsubmit({ preventDefault() {} }); await settle(); };

test("the truck needs the driver's licence to leave: a crew is told why; office staff let it leave without it and say why", async () => {
    const crew = await openPage({ role: 'field_worker', state: noLicence() });
    await crew.open('L-0001');
    const depart = crew.find("Depart with what's on board");
    assert.deepEqual([depart.disabled, depart.getAttribute('aria-describedby')], [true, 'licenceNeeded']);
    assert.equal(crew.$('licenceNeeded').textContent, "No licence yet: the driver's licence number and a photo of it are needed before the truck can leave.");

    let refusals = 1;
    const page = await openPage({ state: noLicence(), fail: request => request.args?.p_action === 'load_depart' && refusals-- > 0 && { code: '22023', message: 'Nothing is on the truck yet' } });
    await page.open('L-0001');
    assert.equal(page.$('licenceNeeded').textContent, "No licence yet: record the driver's licence number and add a photo of it below, or let the truck leave without it and say why.");
    await page.press('Mark loaded and depart');
    assert.equal(page.confirms.length, 0, 'a form asks why instead');
    assertFocus(page, page.input('departReason'));
    assert.ok(page.section('actions').textContent.includes('L-0001 leaves with the 1 planned piece marked as loaded. The reason is kept on the load.'));
    page.set('departReason', 'none');
    await page.submit('actions');
    assert.equal(page.status(), 'Give a reason of at least 5 characters.');
    assert.equal(page.server.ops().length, 0);
    const reason = 'Driver left the licence at home; the carrier confirmed by phone';
    page.set('departReason', reason);
    await page.submit('actions');
    assert.equal(page.status(), 'Could not send L-0001 on its way: Nothing is on the truck yet');
    assert.equal(page.input('departReason').value, reason, 'the reason stays to send again');
    await page.submit('actions');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload), { loadId: id(31), confirmAll: true, overrideReason: reason });
    assert.equal(page.status(), "L-0001 has left without the driver's licence with 2 pieces on board.");
    assert.ok(page.section('actions').textContent.includes(`Left without the driver's licence (`));
    assert.ok(page.section('actions').textContent.includes(reason));
    assert.ok(page.card('L-0001').textContent.includes('Left without licence'));

    const cancel = await openPage({ state: noLicence() });
    await cancel.open('L-0001');
    await cancel.press("Depart with what's on board");
    assert.ok(cancel.section('actions').textContent.includes('L-0001 leaves with the 1 piece on board; 1 planned piece not scanned on will stay behind.'));
    await cancel.press('Cancel', cancel.section('actions'));
    assert.equal(cancel.input('departReason'), null);
    assert.ok(cancel.find('Mark loaded and depart'));
});

test('a load a crew started is marked on the board and listed on its own for the office; the crew plans it', async () => {
    const started = () => { const state = world(); Object.assign(state.loads[0], { started_in_field: true, created_at: ago(3) }); return state; };
    const plainBoard = await openPage();
    assert.equal(plainBoard.$('showField').hidden, true, 'no switch while no crew has started a load');
    const page = await openPage({ state: started() });
    assert.ok(page.card('L-0001').textContent.includes('Started in the field'));
    assert.deepEqual([page.$('showField').hidden, page.$('showField').textContent], [false, 'Started in the field (1)']);
    page.$('showField').click();
    assert.deepEqual(plain(page.columns()), { 'Planning (1)': ['L-0001'], 'Loading (0)': [], 'In transit (0)': [], 'Delivered (0)': [] });
    assert.equal(page.$('resultSummary').textContent, '1 open load started in the field');
    assert.deepEqual(['showOpen', 'showFinished', 'showField'].map(key => page.$(key).getAttribute('aria-pressed')), ['false', 'false', 'true']);
    await page.open('L-0001');
    assert.ok(page.drawer.querySelectorAll('.chip-info').some(node => node.textContent === 'Started in the field'), 'the drawer says so too');
    assert.ok(page.section('actions').textContent.includes('A crew started this load on '));

    const crew = await openPage({ role: 'field_worker', state: started() });
    assert.equal(crew.$('showField').hidden, true, "the review list is the office's");
    await crew.open('L-0001');
    assert.ok(crew.find('Save stops'));
    crew.set('planCode', 'HU-FREE77');
    await crew.submit('manifest');
    assert.equal(crew.status(), 'Planned HU-FREE77 on L-0001.');
    crew.$('newLoad').click(); await settle();
    crew.set('driverName', 'Kim Ito');
    await crew.submit('details');
    assert.equal(crew.server.state.loads.at(-1).started_in_field, true, "a load a crew creates here is one it started");
});

test('a piece planned on another load is moved only when asked, and can be planned for a pick-up stop', async () => {
    const state = world();
    state.loads.push({ ...state.loads[0], id: id(36), load_number: 'L-0006' });
    state.load_stops.push({ ...state.load_stops[0], id: id(46), load_id: id(36) });
    state.load_lines.push({ ...state.load_lines[0], id: id(58), load_id: id(36), unit_id: id(17), tag: 'HU-FREE77', dropoff_stop_id: id(46) });
    const page = await openPage({ state });
    await page.open('L-0001');
    page.set('planCode', 'HU-FREE77');
    await page.submit('manifest');
    assert.equal(page.status(), 'Could not plan HU-FREE77: HU-FREE77 is planned on load L-0006; move it to this load or take it off that plan first');
    const box = page.input('planMove'); box.checked = true; box.dispatch('change');
    await page.submit('manifest');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload), { loadId: id(31), add: [{ code: 'HU-FREE77', dropoffStopId: id(41), move: true }] });
    assert.equal(page.status(), 'Planned HU-FREE77 on L-0001, moved from L-0006.');
    assert.equal(page.server.state.load_lines.find(line => line.id === id(58)).status, 'removed');
    assert.equal(page.input('planMove').checked, true, 'the choice stays for the next piece');
    // Stop 2 is a drop-off and pick-up: a piece picked up there has to come off later.
    assert.deepEqual(page.input('planPickup').options.map(option => option.textContent), ['Where the truck starts', 'Stop 2 · Coastal Terminal']);
    page.set('planCode', 'HU-AAAA11'); page.set('planPickup', id(42)); page.set('planStop', id(41));
    await page.submit('manifest');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload.add), [{ code: 'HU-AAAA11', dropoffStopId: id(41), pickupStopId: id(42), move: true }]);
    assert.equal(page.status(), 'Could not plan HU-AAAA11: HU-AAAA11 has to be picked up before it comes off');
});

test('after the truck leaves, office staff change the stops it has not reached; taking off the last of them delivers the load', async () => {
    const state = world();
    Object.assign(state.load_stops.find(stop => stop.id === id(43)), { status: 'arrived', arrived_at: ago(0) });
    const page = await openPage({ state });
    await page.open('L-0002');
    assert.equal(page.find('Save stops'), undefined);
    await page.press('Change stops');
    assertFocus(page, page.input('stopPlace1'));
    assert.equal(page.input('stopPlace0'), null, 'the stop the truck reached is shown, not edited');
    assert.ok(page.section('stops').textContent.includes("The truck has left. Stops it has reached stay as they are"));
    assert.equal(page.find('Remove stop 1'), undefined);
    assert.equal(page.find('Move stop 2 up').disabled, true, "a stop can't go ahead of one the truck has reached");
    await page.press('Add stop');
    page.set('stopPlace2', id(6));
    await page.press('Save stops');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload.stops.map(stop => [stop.placeId, stop.kind])), [[id(2), 'dropoff'], [id(3), 'pickup'], [id(6), 'dropoff']]);
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload.stops.slice(0, 2).map(stop => stop.id)), [id(43), id(44)]);
    assert.equal(page.status(), "Saved L-0002's stops.");
    assert.equal(page.section('stops').querySelectorAll('.stop-item').length, 3, 'back to the list');
    await page.press('Mark delivered at stop 1 at Fixture Machine Works');
    await page.press('Change stops');
    await page.press('Remove stop 3'); await page.press('Remove stop 2');
    await page.press('Save stops');
    assert.equal(page.status(), "Saved L-0002's stops. No stops are left to reach, so L-0002 is delivered.");
    assert.equal(page.server.load('L-0002').status, 'delivered');
    assert.equal(page.find('Change stops'), undefined);

    const cancel = await openPage();
    await cancel.open('L-0002');
    await cancel.press('Change stops');
    await cancel.press('Add stop');
    cancel.context.confirmAnswer = true;
    await cancel.press('Cancel', cancel.section('stops'));
    assert.equal(cancel.confirms.at(-1), 'Discard your changes to the stops?');
    assert.deepEqual([cancel.find('Save stops'), cancel.context.InvenioUnsavedChanges], [undefined, false]);
});

test('at a shop or vendor, office staff confirm pick-ups without scanning; unconfirmed pick-ups stay behind', async () => {
    const vendorPickup = () => {
        const state = world();
        Object.assign(state.load_stops.find(stop => stop.id === id(44)), { place_id: id(6) }); // L-0002's stop 2: a pick-up at Gulf Valve Supply
        state.load_stops.push({ ...state.load_stops.find(stop => stop.id === id(43)), id: id(46), seq: 3, place_id: id(3) });
        state.load_lines.push({ ...state.load_lines[0], id: id(58), load_id: id(32), unit_id: id(17), tag: 'HU-FREE77', pickup_stop_id: id(44), dropoff_stop_id: id(46) });
        return state;
    };
    const page = await openPage({ state: vendorPickup() });
    await page.open('L-0002');
    assert.ok(page.section('stops').textContent.includes('To pick up 1'));
    await page.press('Confirm pick-ups at stop 2 at Gulf Valve Supply');
    assert.equal(page.confirms[0], 'Mark the 1 piece to pick up at stop 2 at Gulf Valve Supply as on board without scanning them, and finish the stop?');
    assert.deepEqual(plain(page.server.ops()[0].p_payload), { loadId: id(32), stopId: id(44), confirmAll: true });
    assert.equal(page.status(), 'Finished stop 2 at Gulf Valve Supply: 1 piece picked up.');
    assert.equal(page.server.state.units.find(unit => unit.id === id(17)).status, 'on_load');

    const other = await openPage({ state: vendorPickup() });
    await other.open('L-0002');
    await other.press('Finish stop 2 at Gulf Valve Supply');
    assert.equal(other.confirms[0], "Finish stop 2 at Gulf Valve Supply? Pieces to pick up here that weren't scanned on (1 piece) stay behind.");
    assert.equal(other.status(), 'Finished stop 2 at Gulf Valve Supply. 1 piece to pick up stayed behind.');
});

test('office staff write off a missing piece with a reason; the load closes once nothing is missing; an administrator can undo it', async () => {
    const page = await openPage();
    await page.open('L-0003');
    assert.equal(page.find('Close load'), undefined);
    assert.ok(page.section('actions').textContent.includes('1 piece is missing. Mark each one found or write it off in the manifest, then close the load.'));
    await page.press('Write off T-104');
    assertFocus(page, page.input('writeOffReason'));
    assert.ok(page.section('manifest').textContent.includes('An administrator can undo it.'));
    page.set('writeOffReason', 'gone');
    await submitForm(page, 'manifest', '.reason-form');
    assert.equal(page.status(), 'Give a reason of at least 5 characters.');
    page.set('writeOffReason', 'Lost in transit; carrier claim filed');
    await submitForm(page, 'manifest', '.reason-form');
    assert.deepEqual(plain(page.server.ops().at(-1).p_payload), { lineId: id(57), reason: 'Lost in transit; carrier claim filed' });
    assert.equal(page.status(), 'Wrote off T-104.');
    assert.ok(page.rows('manifest').some(row => row[0] === 'T-104' && row[2] === 'Written offLost in transit; carrier claim filed'));
    assert.ok(page.card('L-0003').textContent.includes('Written off 1'));
    await page.press('Close load');
    assert.equal(page.server.load('L-0003').status, 'closed');

    await page.press('Undo the write-off of T-104');
    assertFocus(page, page.input('undoReason'));
    assert.ok(page.section('manifest').textContent.includes('Written off: Lost in transit; carrier claim filed. T-104 becomes missing again until it is scanned or marked found. L-0003 opens again until then.'));
    page.set('undoReason', 'Found it on the dock at bay 4');
    await submitForm(page, 'manifest', '.reason-form');
    const writeOff = page.server.state.load_write_offs[0];
    assert.deepEqual(plain(page.server.ops().at(-1)), { ...plain(page.server.ops().at(-1)), p_action: 'line_write_off_undo', p_payload: { writeOffId: writeOff.id, reason: 'Found it on the dock at bay 4' } });
    assert.equal(page.status(), 'T-104 is missing again. L-0003 is open again.');
    assert.equal(page.server.load('L-0003').status, 'delivered');
    assert.ok(page.find('Mark T-104 found'));

    // Office staff who aren't administrators write off but don't undo; a crate takes what it holds with it.
    const office = await openPage({ role: 'office_staff' });
    await office.open('L-0002');
    await office.press('Finish stop 1 at Fixture Machine Works');
    await office.press('Write off HU-HIGH01');
    assert.ok(office.section('manifest').textContent.includes('This writes off the crate, every crate inside it and everything they hold.'));
    office.set('writeOffReason', 'Fell off the truck');
    await submitForm(office, 'manifest', '.reason-form');
    assert.equal(office.status(), 'Wrote off HU-HIGH01 (1 crate and 0 items).');
    assert.equal(office.server.state.units.find(unit => unit.id === id(16)).status, 'written_off');
    assert.equal(office.find('Undo the write-off of HU-HIGH01'), undefined);
});

test('office staff delete a wrong photo, or remove the whole licence early with a reason, and can record it again', async () => {
    const page = await openPage();
    await page.open('L-0001');
    page.context.confirmAnswer = false;
    await page.press('Delete photo 1');
    assert.equal(page.confirms[0], "Delete photo 1? It can't be recovered. The truck can't leave until a new photo is added, unless the office lets it leave without the licence.");
    page.context.confirmAnswer = true;
    await page.open('L-0002');
    await page.press('Delete photo 1');
    assert.equal(page.confirms[1], "Delete photo 1? It can't be recovered.");
    const steps = () => page.server.log.filter(request => request.storage === 'remove' || request.storage === 'list' || ['remove_driver_licence_photo', 'remove_driver_licence'].includes(request.rpc))
        .map(request => request.storage ? `${request.storage} ${request.paths ?? request.prefix}` : `${request.rpc} ${request.args.p_path ?? request.args.p_load_id} ${request.args.p_reason ?? ''}`.trim());
    assert.deepEqual(steps().filter(step => step.includes(id(32)) && !step.startsWith('list')), [`remove ${id(32)}/front.jpg`, `remove_driver_licence_photo ${id(32)}/front.jpg`]);
    assert.equal(page.status(), 'Deleted photo 1.');
    assert.ok(page.section('licence').textContent.includes('No photos yet.'));

    // A delete whose record failed is finished from the page later.
    let refusals = 1;
    const retry = await openPage({ fail: request => request.rpc === 'remove_driver_licence_photo' && refusals-- > 0 && { code: 'PGRST301', message: 'JWT expired' } });
    await retry.open('L-0002');
    await retry.press('Delete photo 1');
    assert.equal(retry.status(), 'Could not delete photo 1: JWT expired');
    assert.ok(retry.section('licence').textContent.includes('The file has been deleted.'));
    await retry.press('Finish removing photo 1');
    assert.equal(retry.status(), 'Deleted photo 1.');
    assert.equal(retry.server.state.driver_licence_photos.find(photo => photo.load_id === id(32)).removed_at !== null, true);

    const early = await openPage();
    await early.open('L-0002');
    await early.press('Remove the licence');
    assertFocus(early, early.input('removeLicenceReason'));
    early.set('removeLicenceReason', 'Wrong driver recorded');
    await submitForm(early, 'licence', '.reason-form');
    const calls = early.server.log.filter(request => (['list', 'remove'].includes(request.storage) || request.rpc === 'remove_driver_licence') && JSON.stringify(request).includes(id(32)));
    const removal = calls.findIndex(request => request.rpc === 'remove_driver_licence');
    const order = calls.slice(removal - 2, removal + 1).map(request => request.storage ? `${request.storage} ${request.paths ?? request.prefix}` : `${request.rpc} ${request.args.p_reason}`);
    assert.deepEqual(order, [`list ${id(32)}`, `remove ${id(32)}/front.jpg`, 'remove_driver_licence Wrong driver recorded']);
    assert.equal(early.status(), "Removed L-0002's driver's licence.");
    assert.ok(early.section('licence').textContent.includes('Removed '));
    assert.equal(early.input('licenceNumber').value, '');
    assert.ok(!early.card('L-0002').textContent.includes('Licence on file'));
    early.set('licenceNumber', 'x12');
    await early.submit('licence');
    assert.equal(early.status(), 'Saved the licence.', '022 repeats no part of a short number');
});

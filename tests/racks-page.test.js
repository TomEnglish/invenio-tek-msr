// Runs racks.js against the fake DOM and a fake database that behaves like 030 (racks belong to a project, active
// names are unique, a rack holding items or linked to an area can't be retired), so the page is tested by what it does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('../js/utils/inventory-helpers');
const setup = require('../js/utils/yard-setup');
const { createProjectScopedClient } = require('../js/utils/project-scope');
const { fakeDocument, settle, assertFocus } = require('./support/fake-dom');

const source = fs.readFileSync('racks.js', 'utf8');
const PROJECT_ID = 'p1', OTHER_PROJECT = 'p9';
const plain = value => JSON.parse(JSON.stringify(value));

const rack = (id, zone, row, name, extra = {}) => ({ id, project_id: PROJECT_ID, zone, row, rack: name, is_hold_area: false, capacity: null, is_active: true, place_id: null,
    created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-10T12:00:00Z', ...extra });
const RACKS = [
    rack('r10', 'T1', '1', '10', { place_id: 'y1' }),
    rack('r2', 'T1', '1', '2', { place_id: 'y1', capacity: 40 }),
    rack('h1', 'HOLD', '1', '1', { is_hold_area: true }),
    rack('m1', '<img src=x onerror=alert(1)>', 'A', '1', { place_id: 's1' }),
    rack('old', 'T9', '1', '1', { is_active: false, place_id: 'gone' }),
    rack('x1', 'Z', '1', '1', { project_id: OTHER_PROJECT }),
];
const PLACES = [
    { id: 'y1', name: 'Laydown Yard', kind: 'yard', project_id: PROJECT_ID, is_active: true },
    { id: 's1', name: 'Common Site', kind: 'site', project_id: null, is_active: true },
    { id: 'gone', name: 'Old Yard', kind: 'yard', project_id: PROJECT_ID, is_active: false },
    { id: 'w1', name: 'West Yard', kind: 'yard', project_id: OTHER_PROJECT, is_active: true },
    { id: 'shop', name: 'Rewind Shop', kind: 'outside_shop', project_id: null, is_active: true },
];
const AREAS = [{ location_id: 'r2', zone_id: 'z2', site_map_id: 'map1', area: 'T1 Pipe Racks › Rack 2', place_name: 'Laydown Yard' }];
const STATUS = { project_id: PROJECT_ID, is_member: true, own_yards: 1, shared_yards: 1, racks: 4, hold_racks: 1, site_plans: 0 };

/**
 * In-memory racks, like 030: office staff of the project write; names are trimmed and unique among a project's
 * active racks (23505, naming the rack); a rack in `holding` or with a linked area can't be retired (22023);
 * an update stamps updated_at. An insert of several rows adds all of them or none.
 * Set `paused` to hold every request until step() lets the oldest one through.
 */
function fakeServer({ rows = RACKS, places = PLACES, areas = AREAS, status = STATUS, role }) {
    const server = { racks: structuredClone(rows), places: structuredClone(places), areas: structuredClone(areas), status: status && { ...status },
        log: [], rpcs: [], paused: false, waiting: [], fail: null, inserted: 0, edits: 0, holding: {} };
    const office = ['office_staff', 'admin'].includes(role);
    const label = row => setup.rackLabel(row);
    const clash = row => row.is_active !== false && server.racks.some(other => other.id !== row.id && other.project_id === row.project_id && other.is_active !== false
        && ['zone', 'row', 'rack'].every(key => other[key].toLowerCase() === row[key].toLowerCase()));
    const duplicate = row => ({ code: '23505', message: `Another active rack is already called ${label(row)}` });
    function retireGuard(row) {
        const items = server.holding[row.id] || 0, area = server.areas.find(item => item.location_id === row.id);
        if (items) return { code: '22023', message: `${label(row)} can't be retired yet: it still holds ${items} ${items === 1 ? 'item' : 'items'}; move them to another rack first` };
        if (area) return { code: '22023', message: `${label(row)} can't be retired yet: it is linked to the area ${area.area}; on Site Maps, set that area to No rack first` };
        return null;
    }
    server.step = () => server.waiting.shift()();
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        const matches = row => request.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
        if (request.table === 'places') {
            return { data: server.places.filter(matches).filter(item => !item.project_id || request.or.includes(`project_id.eq.${item.project_id}`))
                .sort((a, b) => a.name.localeCompare(b.name)).map(item => structuredClone(item)), error: null };
        }
        if (request.table === 'location_areas') {
            return { data: server.racks.filter(matches).map(item => ({ location_id: item.id, project_id: item.project_id, zone_id: null, site_map_id: null, area: null, place_name: null,
                ...server.areas.find(area => area.location_id === item.id) })), error: null };
        }
        if (request.table !== 'locations') throw new Error(`unexpected table ${request.table}`);
        if (request.op === 'insert') {
            if (!office) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "locations"' } };
            const made = [];
            for (const values of request.values) {
                const row = { id: `new${server.inserted + made.length + 1}`, is_active: true, updated_at: '2026-11-16T09:00:00Z', ...structuredClone(values) };
                for (const key of ['zone', 'row', 'rack']) row[key] = row[key].trim();
                if (clash(row) || made.some(other => label(other).toLowerCase() === label(row).toLowerCase())) return { data: null, error: duplicate(row) };
                made.push(row);
            }
            server.inserted += made.length; server.racks.push(...made);
            return { data: made.map(row => ({ id: row.id })), error: null };
        }
        const matching = server.racks.filter(matches);
        if (request.op === 'update') {
            const allowed = office ? matching : [];
            for (const row of allowed) {
                const next = { ...row, ...request.values };
                if (clash(next)) return { data: null, error: duplicate(next) };
                if (row.is_active !== false && request.values.is_active === false) { const refused = retireGuard(row); if (refused) return { data: null, error: refused }; }
            }
            allowed.forEach(row => Object.assign(row, structuredClone(request.values), { updated_at: new Date(Date.UTC(2026, 10, 16, 10, 0, ++server.edits)).toISOString() }));
            return { data: allowed.map(row => ({ id: row.id })), error: null };
        }
        return { data: matching.slice(request.from, request.to + 1).map(row => structuredClone(row)), error: null };
    }
    class Query {
        constructor(table) { this.request = { table, op: 'select', filters: [], from: 0, to: 999, or: '' }; }
        select(columns) { if (this.request.op === 'select') this.request.columns = columns; else this.request.returning = columns; return this; }
        order() { return this; }
        range(from, to) { Object.assign(this.request, { from, to }); return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        in(key, values) { this.request.filters.push([key, values]); return this; }
        or(text) { this.request.or = text; return this; }
        update(values) { Object.assign(this.request, { op: 'update', values }); return this; }
        insert(values) { Object.assign(this.request, { op: 'insert', values: Array.isArray(values) ? values : [values] }); return this; }
        then(resolve, reject) { return respond(this.request).then(resolve, reject); }
    }
    server.client = {
        from: table => new Query(table),
        rpc: async (name, args) => {
            server.rpcs.push([name, args]);
            const failure = server.fail?.({ rpc: name });
            if (failure) return { data: null, error: failure };
            return { data: server.status ? [{ ...server.status }] : [], error: null };
        },
    };
    server.writes = () => server.log.filter(request => request.op !== 'select');
    server.rack = id => server.racks.find(row => row.id === id);
    return server;
}

async function openPage({ role = 'office_staff', projectStatus = 'active', prepare, ...options } = {}) {
    const server = fakeServer({ role, ...options });
    prepare?.(server);
    const confirms = [];
    const { document, Option } = fakeDocument();
    const project = { id: PROJECT_ID, name: 'North Yard', status: projectStatus };
    const context = {
        document, Option, console, setTimeout, structuredClone, Intl, URLSearchParams,
        confirm: text => { confirms.push(text); return context.confirmAnswer ?? true; },
        InvenioAuthReady: Promise.resolve(true), InvenioInventory: inventory, InvenioYardSetup: setup, InvenioCurrentProfile: { role },
        InvenioProjectScope: { availableProjects: [project], getActiveProjectId: () => PROJECT_ID, activeProject: project },
        supabaseClient: server.client,
        // The real project scope, so the page's reads and writes are checked to stay in the open project.
        projectSupabaseClient: createProjectScopedClient(server.client, () => PROJECT_ID),
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    await settle();
    const $ = id => document.getElementById(id);
    const drawer = $('rackDrawer'), content = $('rackContent');
    const names = () => $('rackRows').querySelectorAll('tr').map(row => row.querySelector('.fw-semibold')?.textContent ?? row.textContent);
    const cells = name => $('rackRows').querySelectorAll('tr').find(row => row.querySelector('.fw-semibold')?.textContent === name).querySelectorAll('td').map(cell => cell.textContent);
    const view = async name => { $('rackRows').querySelectorAll('button').find(node => node.textContent === name).click(); await settle(); };
    const action = text => content.querySelectorAll('button').find(node => node.textContent === text);
    const input = key => content.querySelector(`[id="rack_${key}"]`);
    const fill = values => { for (const [key, value] of Object.entries(values)) { if (key === 'is_hold_area') input(key).checked = value; else input(key).value = value; } };
    const submit = async () => { await content.querySelector('form').onsubmit({ preventDefault() {} }); await settle(); };
    const status = () => $('rackStatus').textContent;
    const fields = () => Object.fromEntries(content.querySelector('dl').childNodes.map(pair => [pair.childNodes[0].textContent, pair.childNodes[1].textContent]));
    const steps = () => $('setupSteps').querySelectorAll('li').map(item => ({ state: item.childNodes[0].textContent, title: item.childNodes[1].textContent, link: item.querySelector('a')?.href || null }));
    return { server, document, context, $, drawer, content, names, cells, view, action, input, fill, submit, status, fields, steps, confirms };
}

test('lists the open project\'s active racks in zone, row and rack order with their yard and area, and filters them', async () => {
    const page = await openPage();
    assert.equal(page.$('projectLine').textContent, 'Project: North Yard');
    assert.deepEqual(page.names(), ['<img src=x onerror=alert(1)> · Row A, Rack 1', 'HOLD · Row 1, Rack 1', 'T1 · Row 1, Rack 2', 'T1 · Row 1, Rack 10'],
        'rack 2 comes before rack 10; markup in a name is plain text; another project\'s rack is never read');
    assert.equal(page.$('resultSummary').textContent, '4 active racks');
    assert.deepEqual(page.cells('T1 · Row 1, Rack 2'), ['T1 · Row 1, Rack 2', 'Laydown Yard', 'T1 Pipe Racks › Rack 2', '40']);
    assert.deepEqual(page.cells('HOLD · Row 1, Rack 1'), ['HOLD · Row 1, Rack 1 Hold area', 'No yard or site yet', 'Not linked to an area', '']);
    // Every read of racks and their areas is limited to the open project.
    for (const request of page.server.log.filter(item => ['locations', 'location_areas'].includes(item.table))) {
        assert.ok(request.filters.some(([key, value]) => key === 'project_id' && value === PROJECT_ID), `${request.table} is read for this project only`);
    }
    assert.deepEqual(page.$('filterPlace').options.map(option => option.textContent), ['All yards and sites', 'No yard or site yet', 'Common Site', 'Laydown Yard', 'Old Yard (retired)'],
        'yards and sites this project can use; a retired one only while a rack is still at it; never a shop or another project\'s yard');

    page.$('filterPlace').value = 'y1'; page.$('filterPlace').onchange();
    assert.deepEqual(page.names(), ['T1 · Row 1, Rack 2', 'T1 · Row 1, Rack 10']);
    assert.equal(page.$('resultSummary').textContent, '2 of 4 active racks match');
    page.$('filterPlace').value = 'none'; page.$('filterPlace').onchange();
    assert.deepEqual(page.names(), ['HOLD · Row 1, Rack 1']);
    page.$('filterPlace').value = ''; page.$('filterSearch').value = 'pipe rack'; page.$('filterSearch').oninput();
    assert.deepEqual(page.names(), ['T1 · Row 1, Rack 2'], 'search reads the area too');
    page.$('filterSearch').value = 'hold'; page.$('filterSearch').oninput();
    assert.deepEqual(page.names(), ['HOLD · Row 1, Rack 1']);

    page.$('filterSearch').value = ''; page.$('showRetired').click();
    assert.deepEqual(page.names(), ['T9 · Row 1, Rack 1']);
    assert.equal(page.$('resultSummary').textContent, '1 retired rack');
    assert.equal(page.$('showRetired').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(page.cells('T9 · Row 1, Rack 1').slice(1, 2), ['Old Yard (retired)']);
});

test('field workers see racks and their details but no way to add, edit, retire or restore, and are not shown setup', async () => {
    const page = await openPage({ role: 'field_worker' });
    assert.equal(page.$('addRack').hidden, true);
    assert.equal(page.$('pageMessage').textContent, 'Office staff manage racks. You can view them.');
    assert.equal(page.$('setupPanel').hidden, true);
    assert.equal(page.server.rpcs.length, 0, 'the checklist is not asked for');
    await page.view('T1 · Row 1, Rack 2');
    assert.deepEqual(page.fields(), { Project: 'North Yard', 'Yard or site': 'Laydown Yard', 'Area on the site plan': 'T1 Pipe Racks › Rack 2 Open on Site Maps', Capacity: '40',
        'Last changed': new Date('2026-11-10T12:00:00Z').toLocaleString() });
    assert.equal(page.content.querySelector('a').href, 'site-maps.html?map=map1');
    assert.deepEqual(page.content.querySelectorAll('button').map(node => node.textContent), ['Close']);
    assert.equal(page.server.writes().length, 0);
});

test('a project that is not active is read-only for office staff too, and says why', async () => {
    const page = await openPage({ projectStatus: 'completed' });
    assert.equal(page.$('addRack').hidden, true);
    assert.equal(page.$('pageMessage').textContent, 'This project is read-only.');
    await page.view('T1 · Row 1, Rack 2');
    assert.deepEqual(page.content.querySelectorAll('button').map(node => node.textContent), ['Close']);
    assert.ok(page.content.textContent.includes("North Yard is not an active project, so its racks can't be changed."));
});

test('adding a rack: the form names the project, starts at its only yard, and sends a tidy row for that project', async () => {
    const page = await openPage();
    page.$('addRack').click(); await settle();
    assertFocus(page, page.input('zone'), 'a new rack starts at Zone');
    assert.ok(page.content.textContent.includes('Project: North Yard.'), 'the project is stated in the form');
    assert.deepEqual(page.input('place_id').options.map(option => option.textContent), ['No yard or site yet', 'Common Site', 'Laydown Yard'], 'active yards and sites only');
    assert.equal(page.input('place_id').value, 'y1', 'the project\'s one yard is chosen to start with');
    page.fill({ zone: '  T2 ', row: '3', rack: ' 4', is_hold_area: true, capacity: '25' });
    await page.submit();
    assert.deepEqual(plain(page.server.writes()), [{ table: 'locations', op: 'insert', filters: [], from: 0, to: 999, or: '', returning: 'id',
        values: [{ zone: 'T2', row: '3', rack: '4', place_id: 'y1', is_hold_area: true, capacity: 25, project_id: PROJECT_ID }] }]);
    assert.equal(page.$('pageMessage').textContent, 'Added T2 · Row 3, Rack 4.');
    assert.equal(page.content.querySelector('h2').textContent, 'T2 · Row 3, Rack 4', 'the drawer shows the new rack');
    assertFocus(page, page.action('Edit'), 'focus lands on Edit');
    assert.ok(page.names().includes('T2 · Row 3, Rack 4'));
    assert.equal(page.server.rpcs.length, 2, 'the checklist is read again after a change');
    assert.deepEqual(plain(page.server.rpcs[0]), ['project_setup_status', { p_project_id: PROJECT_ID }]);
});

test('adding several racks at once sends one request, keeps leading zeros, and adds all of them or none', async () => {
    const page = await openPage();
    page.$('addRack').click(); await settle();
    page.fill({ zone: 'B', row: '2', rack: '08', rack_to: '11', place_id: '' });
    await page.submit();
    const sent = page.server.writes();
    assert.equal(sent.length, 1, 'one request for the whole run');
    assert.deepEqual(sent[0].values.map(row => row.rack), ['08', '09', '10', '11']);
    assert.ok(sent[0].values.every(row => row.zone === 'B' && row.row === '2' && row.place_id === null && row.project_id === PROJECT_ID));
    assert.equal(page.$('pageMessage').textContent, 'Added 4 racks.');
    assert.equal(page.drawer.open, false, 'the drawer closes after a run');
    assert.equal(page.$('resultSummary').textContent, '8 active racks');

    // A run that meets an existing rack adds nothing and names the rack in the way.
    page.$('addRack').click(); await settle();
    page.fill({ zone: 't1', row: '1', rack: '1', rack_to: '3' });
    await page.submit();
    assert.equal(page.status(), 'Could not save: Another active rack is already called t1 · Row 1, Rack 2.');
    assert.equal(page.server.racks.length, RACKS.length + 4, 'nothing from the refused run was added');
    assert.equal(page.input('rack_to').value, '3', 'the form keeps what was typed');
});

test('a missing name, a capacity that is not a number or too long a run is caught before anything is sent', async () => {
    const page = await openPage();
    page.$('addRack').click(); await settle();
    page.fill({ zone: 'C', row: '', rack: '1' });
    await page.submit();
    assert.equal(page.status(), 'Enter the row.'); assertFocus(page, page.input('row'));
    page.fill({ row: '1', capacity: '40 pallets' });
    await page.submit();
    assert.equal(page.status(), 'Capacity must be a whole number from 1 to 1,000,000, or left blank.'); assertFocus(page, page.input('capacity'));
    page.fill({ capacity: '', rack: 'A', rack_to: '5' });
    await page.submit();
    assert.equal(page.status(), 'To add several racks at once, the first rack must be a number.');
    page.fill({ rack: '1', rack_to: '101' });
    await page.submit();
    assert.equal(page.status(), 'Add at most 100 racks at a time.'); assertFocus(page, page.input('rack_to'));
    assert.equal(page.server.writes().length, 0);
});

test("an edit lands only on the version the form was opened from, and can't be saved over someone else's change", async () => {
    const page = await openPage();
    await page.view('T1 · Row 1, Rack 2');
    page.action('Edit').click(); await settle();
    assert.equal(page.input('rack_to'), null, 'a run is only for adding');
    assert.equal(page.input('capacity').value, '40');
    page.fill({ capacity: '60', place_id: 's1' });
    await page.submit();
    assert.deepEqual(plain(page.server.writes().at(-1).filters), [['project_id', PROJECT_ID], ['id', 'r2'], ['updated_at', '2026-11-10T12:00:00Z']]);
    assert.deepEqual(plain(page.server.writes().at(-1).values), { zone: 'T1', row: '1', rack: '2', place_id: 's1', is_hold_area: false, capacity: 60 });
    assert.equal(page.$('pageMessage').textContent, 'Saved T1 · Row 1, Rack 2.');
    assert.equal(page.fields()['Yard or site'], 'Common Site');

    // Someone else changes the rack while this form is open.
    page.action('Edit').click(); await settle();
    Object.assign(page.server.rack('r2'), { capacity: 99, updated_at: '2026-11-16T11:00:00.000Z' });
    page.fill({ capacity: '70' });
    await page.submit();
    assert.equal(page.status(), 'Could not save: This rack was changed after you opened the form. Cancel to see the latest version, then make your changes again.');
    assert.equal(page.server.rack('r2').capacity, 99);
});

test("retiring asks first, shows the database's reason when stock or an area is still there, and restore explains a name clash", async () => {
    const page = await openPage({ prepare: server => { server.holding.r10 = 2; } });
    await page.view('T1 · Row 1, Rack 10');
    page.context.confirmAnswer = false;
    page.action('Retire').click(); await settle();
    assert.match(page.confirms.at(-1), /^Retire T1 · Row 1, Rack 10\? It stays on record and can be restored, but it is no longer offered for receiving or moves\.$/);
    assert.equal(page.server.writes().length, 0, 'declining sends nothing');
    page.context.confirmAnswer = true;
    page.action('Retire').click(); await settle();
    const refusal = "Could not retire T1 · Row 1, Rack 10: T1 · Row 1, Rack 10 can't be retired yet: it still holds 2 items; move them to another rack first";
    assert.equal(page.status(), refusal);
    assert.equal(page.$('pageMessage').textContent, refusal);
    assert.equal(page.server.rack('r10').is_active, true);
    assertFocus(page, page.action('Retire'), 'still active, so focus stays on Retire');

    await page.view('T1 · Row 1, Rack 2');
    page.action('Retire').click(); await settle();
    assert.equal(page.status(), "Could not retire T1 · Row 1, Rack 2: T1 · Row 1, Rack 2 can't be retired yet: it is linked to the area T1 Pipe Racks › Rack 2; on Site Maps, set that area to No rack first");

    page.server.holding.r10 = 0;
    await page.view('T1 · Row 1, Rack 10');
    page.action('Retire').click(); await settle();
    assert.deepEqual(plain(page.server.writes().at(-1)).values, { is_active: false });
    assert.equal(page.$('pageMessage').textContent, 'T1 · Row 1, Rack 10 is retired. Choose Retired above the list to find it again.');
    assertFocus(page, page.action('Restore'), 'now retired, so focus moves to Restore');
    assert.ok(!page.names().includes('T1 · Row 1, Rack 10'), 'it leaves the active list');

    // Its name is taken while it is retired; restoring says so.
    page.server.racks.push(rack('r10b', 'T1', '1', '10'));
    page.action('Restore').click(); await settle();
    assert.equal(page.status(), 'Could not restore T1 · Row 1, Rack 10: Another active rack is already called T1 · Row 1, Rack 10.');
    page.server.racks.pop();
    page.action('Restore').click(); await settle();
    assert.equal(page.$('pageMessage').textContent, 'T1 · Row 1, Rack 10 is active again.');
    assert.equal(page.server.rack('r10').is_active, true);
});

test('the setup checklist shows what the project still needs, links to the right project, and goes away when nothing is left', async () => {
    const page = await openPage({ status: { ...STATUS, own_yards: 0, shared_yards: 2, hold_racks: 0, site_plans: 0 } });
    assert.equal(page.$('setupPanel').hidden, false);
    assert.equal(page.$('setupTitle').textContent, 'Before work can start in North Yard');
    assert.deepEqual(page.steps(), [
        { state: 'To do', title: 'A yard or site', link: 'places.html?add=yard&project=p1' },
        { state: 'Done', title: 'Racks', link: null },
        { state: 'To do', title: 'A hold-area rack', link: null },
        { state: 'To do', title: 'A site plan', link: 'site-maps.html?project=p1' },
    ]);
    assert.ok(page.$('setupSteps').textContent.includes('No yard or site of its own yet. 2 shared yards or sites are available to every project.'));

    const done = await openPage({ status: { ...STATUS, site_plans: 1 } });
    assert.equal(done.$('setupPanel').hidden, true, 'nothing left: no checklist');
    // Without 030's function the racks still list; the checklist just isn't shown.
    const before = await openPage({ prepare: server => { server.fail = request => request.rpc ? { code: 'PGRST202', message: 'Could not find the function' } : null; } });
    assert.equal(before.$('setupPanel').hidden, true);
    assert.equal(before.$('resultSummary').textContent, '4 active racks');
});

test('while a save runs, another save or closing says so; the lock holds until the list has reloaded', async () => {
    const page = await openPage();
    page.$('addRack').click(); await settle();
    page.fill({ zone: 'D', row: '1', rack: '1' });
    page.server.paused = true;
    const saving = page.content.querySelector('form').onsubmit({ preventDefault() {} });
    await settle();
    await page.content.querySelector('form').onsubmit({ preventDefault() {} });
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.');
    page.action('Close').click();
    assert.equal(page.drawer.open, true, 'the drawer stays open while saving');
    page.server.paused = false;
    while (page.server.waiting.length) { page.server.step(); await settle(); }
    await saving; await settle();
    assert.equal(page.server.writes().length, 1, 'the second save was not sent');
    assert.equal(page.$('pageMessage').textContent, 'Added D · Row 1, Rack 1.');
});

test('the page never parses strings as HTML and never deletes a rack', () => {
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.doesNotMatch(source, /\.delete\(/, 'racks are retired, never deleted');
    assert.match(source, /await window\.InvenioAuthReady/);
});

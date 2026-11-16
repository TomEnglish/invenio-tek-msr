// Pure helpers behind the Racks page and the project setup checklist (migration 030).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const setup = require('../js/utils/yard-setup');
const scope = require('../js/utils/project-scope');

const input = extra => ({ zone: 'T1', row: '1', rack: '2', rack_to: '', place_id: '', is_hold_area: false, capacity: '', ...extra });

test('a rack is named the way every screen names it, and counts as active unless it says otherwise', () => {
    assert.equal(setup.rackLabel({ zone: 'T1', row: '1', rack: '2' }), 'T1 · Row 1, Rack 2');
    assert.equal(setup.isActive({}), true, 'a rack read before 030 has no flag');
    assert.equal(setup.isActive({ is_active: false }), false);
    assert.deepEqual(setup.usableRacks([{ id: 'a' }, { id: 'b', is_active: false }, { id: 'c', is_active: true }]).map(rack => rack.id), ['a', 'c']);
    assert.deepEqual(setup.usableRacks(null), []);
});

test('rack form values are trimmed and checked against 030\'s limits', () => {
    assert.deepEqual(setup.rackValues(input({ zone: ' T1 ', rack: ' 2', place_id: 'y1', is_hold_area: true, capacity: ' 40 ' })),
        { rows: [{ zone: 'T1', row: '1', rack: '2', place_id: 'y1', is_hold_area: true, capacity: 40 }] });
    assert.deepEqual(setup.rackValues(input()).rows[0], { zone: 'T1', row: '1', rack: '2', place_id: null, is_hold_area: false, capacity: null });
    assert.deepEqual(setup.rackValues(input({ zone: '  ' })), { error: 'Enter the zone.', field: 'zone' });
    assert.deepEqual(setup.rackValues(input({ rack: '' })), { error: 'Enter the rack.', field: 'rack' });
    assert.deepEqual(setup.rackValues(input({ row: 'R'.repeat(61) })), { error: 'Row is too long (60 characters at most).', field: 'row' });
    assert.ok(setup.rackValues(input({ row: 'R'.repeat(60) })).rows);
    for (const capacity of ['0', '-3', '2.5', '40 pallets', '1000001']) assert.equal(setup.rackValues(input({ capacity })).field, 'capacity', capacity);
    assert.equal(setup.rackValues(input({ capacity: '1000000' })).rows[0].capacity, 1000000);
    // The form sends the hold-area checkbox as a boolean; anything else is "no".
    assert.equal(setup.rackValues(input({ is_hold_area: 'on' })).rows[0].is_hold_area, false);
});

test('a run of racks is numbered from the first to the last, keeps leading zeros, and has a size limit', () => {
    assert.deepEqual(setup.rackValues(input({ rack: '1', rack_to: '3' })).rows.map(row => row.rack), ['1', '2', '3']);
    assert.deepEqual(setup.rackValues(input({ rack: '08', rack_to: '11' })).rows.map(row => row.rack), ['08', '09', '10', '11']);
    assert.deepEqual(setup.rackValues(input({ rack: '5', rack_to: '5' })).rows.map(row => row.rack), ['5']);
    const run = setup.rackValues(input({ rack: '1', rack_to: '100', capacity: '20', place_id: 'y1' }));
    assert.equal(run.rows.length, 100);
    assert.ok(run.rows.every(row => row.zone === 'T1' && row.row === '1' && row.capacity === 20 && row.place_id === 'y1'));
    assert.notEqual(run.rows[0], run.rows[1], 'each rack is its own row');
    assert.equal(setup.rackValues(input({ rack: '1', rack_to: '101' })).error, 'Add at most 100 racks at a time.');
    assert.deepEqual(setup.rackValues(input({ rack: 'A', rack_to: '5' })), { error: 'To add several racks at once, the first rack must be a number.', field: 'rack' });
    assert.equal(setup.rackValues(input({ rack: '3', rack_to: 'x' })).field, 'rack_to');
    assert.deepEqual(setup.rackValues(input({ rack: '7', rack_to: '3' })), { error: 'The last rack number must not be lower than the first.', field: 'rack_to' });
});

test('racks filter by yard, by retired, and by words in their name, yard or area, in natural order', () => {
    const racks = [
        { id: 'a', zone: 'T1', row: '1', rack: '10', place_id: 'y1' }, { id: 'b', zone: 'T1', row: '1', rack: '2', place_id: 'y1' },
        { id: 'c', zone: 'HOLD', row: '1', rack: '1', place_id: null }, { id: 'd', zone: 'T1', row: '2', rack: '1', place_id: 'y2', is_active: false },
    ];
    const describe = rack => rack.id === 'b' ? 'Laydown Yard T1 Pipe Racks › Rack 2' : '';
    const ids = options => setup.filterRacks(racks, { describe, ...options }).map(rack => rack.id);
    assert.deepEqual(ids({}), ['c', 'b', 'a'], 'active only; rack 2 before rack 10');
    assert.deepEqual(ids({ retired: true }), ['d']);
    assert.deepEqual(ids({ place: 'y1' }), ['b', 'a']);
    assert.deepEqual(ids({ place: 'none' }), ['c']);
    assert.deepEqual(ids({ search: 'pipe laydown' }), ['b']);
    assert.deepEqual(ids({ search: 'RACK 10' }), ['a'], 'every word must be found, whatever its capitals');
    assert.deepEqual(ids({ search: 'nothing' }), []);
});

test('the setup checklist says what a project has and lacks, and its links carry the project', () => {
    const empty = setup.setupSteps({ project_id: 'p 1', own_yards: 0, shared_yards: 0, racks: 0, hold_racks: 0, site_plans: 0 });
    assert.deepEqual(empty.map(step => [step.key, step.done]), [['yard', false], ['racks', false], ['hold', false], ['plan', false]]);
    assert.deepEqual(empty.map(step => step.href), ['places.html?add=yard&project=p%201', 'racks.html?project=p%201', 'racks.html?project=p%201', 'site-maps.html?project=p%201']);
    assert.equal(empty[0].detail, 'No yard or site yet. Crates and loads need a place to be at.');
    assert.equal(empty[1].detail, 'No racks yet. Nothing can be received until the project has a rack.');
    assert.equal(setup.setupSummary(empty), 'Setup: 4 of 4 left (yard or site, racks, hold-area rack, site plan)');
    const shared = setup.setupSteps({ project_id: 'p1', own_yards: 0, shared_yards: 1, racks: 1, hold_racks: 0, site_plans: 2 });
    assert.equal(shared[0].done, false, 'a shared yard is not the project\'s own');
    assert.equal(shared[0].detail, 'No yard or site of its own yet. 1 shared yard or site is available to every project.');
    assert.equal(shared[1].detail, '1 active rack.');
    assert.equal(shared[3].detail, '2 active site plans.');
    assert.equal(setup.setupSummary(shared), 'Setup: 2 of 4 left (yard or site, hold-area rack)');
    const ready = setup.setupSteps({ project_id: 'p1', own_yards: 2, shared_yards: 0, racks: 1200, hold_racks: 1, site_plans: 1 });
    assert.ok(ready.every(step => step.done));
    assert.equal(ready[1].detail, '1,200 active racks.');
    assert.equal(setup.setupSummary(ready), 'Set up: yard, racks and site plan');
    assert.deepEqual(setup.setupSteps(null, 'p1').map(step => step.done), [false, false, false, false], 'no answer counts as nothing set up');
});

test('database refusals read as plain language: the rack in the way, no permission, or the database\'s own reason', () => {
    assert.equal(setup.errorMessage({ code: '23505', message: 'Another active rack is already called T1 · Row 1, Rack 2' }), 'Another active rack is already called T1 · Row 1, Rack 2.');
    assert.equal(setup.errorMessage({ code: '23505', message: 'duplicate key value' }), 'Another active rack already has that zone, row and rack.');
    assert.equal(setup.errorMessage({ code: '42501', message: 'new row violates row-level security policy for table "locations"' }), 'You do not have permission to make this change in this project.');
    assert.equal(setup.errorMessage({ code: '42501', message: "A rack is at one of this project's yards or sites" }), "A rack is at one of this project's yards or sites");
    assert.equal(setup.errorMessage({ code: '22023', message: 'That place is retired; restore it or choose another' }), 'That place is retired; restore it or choose another');
    assert.equal(setup.errorMessage({ code: 'PGRST202', message: 'Could not find the function' }), 'Racks are not set up in this database yet (migration 030).');
});

test('a link can name the project to open on, but only one of this person\'s own projects', async () => {
    const projects = [{ id: 'a', name: 'A', status: 'active' }, { id: 'b', name: 'B', status: 'active' }];
    const client = { from: () => ({ select: () => ({ eq: async () => ({ data: projects.map(item => ({ project_id: item.id, projects: item })), error: null }) }) }) };
    const stored = new Map();
    const context = { URLSearchParams, localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }, location: { search: '' } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/utils/project-scope.js', 'utf8'), context);
    const open = async search => { context.location.search = search; await context.InvenioProjectScope.initializeProjectScope(client, 'u1'); return context.InvenioProjectScope.getActiveProjectId(); };
    assert.equal(await open(''), 'a', 'with nothing chosen, the first project');
    assert.equal(await open('?project=b'), 'b', 'the link opens its project');
    assert.equal(await open(''), 'b', 'and it stays chosen, as if picked in the selector');
    assert.equal(await open('?project=zz'), 'b', 'a project this person is not on is ignored');
    assert.equal(typeof scope.setActiveProjectId, 'function');
});

test('Racks is a Logistics page that loads its helpers first; racks are project-scoped and written only from that page', () => {
    const html = fs.readFileSync('racks.html', 'utf8'), sidebar = fs.readFileSync('js/utils/sidebar.js', 'utf8');
    assert.match(html, /<body>\n<section class="work-page">/, 'members can open it; office actions are gated in the script');
    assert.match(html, /<p id="pageMessage" role="status" aria-live="polite" tabindex="-1">/);
    assert.match(html, /<dialog id="rackDrawer" class="review-drawer" aria-labelledby="rackTitle">/);
    for (const id of ['addRack', 'projectLine', 'setupPanel', 'setupTitle', 'setupSteps', 'filterPlace', 'filterSearch', 'showActive', 'showRetired', 'resultSummary', 'rackRows', 'rackContent', 'rackStatus']) {
        assert.match(html, new RegExp(`id="${id}"`), `racks.html has #${id}`);
    }
    for (const script of ['js/utils/auth-guard.js', 'js/utils/project-scope.js', 'js/utils/sidebar.js', 'js/utils/inventory-helpers.js', 'js/utils/yard-setup.js', 'racks.js']) {
        assert.match(html, new RegExp(`src="${script.replaceAll('.', '\\.')}\\?v=`), `racks.html loads ${script}`);
    }
    assert.ok(html.indexOf('yard-setup.js') < html.indexOf('src="racks.js'), 'helpers load before the page script');
    assert.doesNotMatch(html, /leaflet/, 'no map on this page');
    const logisticsNav = sidebar.slice(sidebar.indexOf("section: 'Logistics'"), sidebar.indexOf("section: 'Planning'"));
    assert.match(logisticsNav, /label: 'Places', +icon: '[\w-]+', +href: 'places\.html' \},\n +\{ label: 'Racks', +icon: '[\w-]+', +href: 'racks\.html'/, 'Racks sits under Places');
    assert.match(sidebar, /'racks\.html': 'Racks'/);
    assert.equal(scope.isProjectScopedTable('locations'), true);
    assert.equal(scope.isProjectScopedTable('location_areas'), true);
    // The Projects page loads the checklist helper before its script.
    const projects = fs.readFileSync('projects.html', 'utf8');
    assert.ok(projects.indexOf('yard-setup.js') > 0 && projects.indexOf('yard-setup.js') < projects.indexOf('src="admin-pages.js'));
});

test('retired racks are not offered for receiving, rack names are shown as text, and the Data Browser no longer edits racks', () => {
    const receiving = fs.readFileSync('receiving.js', 'utf8');
    assert.match(receiving, /wizardState\.locations = \(data \|\| \[\]\)\.filter\(loc => loc\.is_active !== false\)/);
    assert.match(receiving, /<strong>\$\{locationText\(loc\.zone\)\}<\/strong> - Row \$\{locationText\(loc\.row\)\}, Rack \$\{locationText\(loc\.rack\)\}/);
    const context = { document: { addEventListener() {}, getElementById: () => null }, console };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(`${receiving.slice(receiving.indexOf('function locationText'), receiving.indexOf('function renderLocationList'))}; this.locationText = locationText;`, context);
    assert.equal(context.locationText('<img src=x onerror="a()">&\'T1'), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;T1');
    assert.equal(context.locationText(null), '');
    const admin = fs.readFileSync('admin.js', 'utf8');
    const config = admin.slice(admin.indexOf('    locations: {'), admin.indexOf('    qr_codes: {'));
    assert.match(config, /canInsert: false/);
    assert.doesNotMatch(config, /editable: true/);
    assert.match(config, /key: 'is_active', label: 'Active'/);
});

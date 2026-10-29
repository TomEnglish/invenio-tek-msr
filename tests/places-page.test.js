// Runs places.js against the fake DOM, a fake places table that behaves like 021 (active names unique, row
// security on writes) and just enough Leaflet, so the page is tested by what it does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('../js/utils/inventory-helpers');
const logistics = require('../js/utils/logistics-helpers');
const { fakeDocument, settle, assertFocus } = require('./support/fake-dom');

const source = fs.readFileSync('places.js', 'utf8');
const PROJECT_ID = 'p1', OTHER_PROJECT = 'p9';
// Arrays made inside the page's vm context aren't deepEqual to this file's; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

const place = (id, name, kind, extra = {}) => ({ id, kind, name, project_id: null, address: null, city: null, state: null, postal_code: null, latitude: null, longitude: null,
    geofence_radius_m: 300, contact_name: null, contact_phone: null, contact_email: null, secondary_contact_name: null, secondary_contact_phone: null, notes: null,
    is_active: true, updated_at: '2026-10-28T12:00:00Z', ...extra });
const PLACES = [
    place('y1', 'North Yard laydown', 'yard', { project_id: PROJECT_ID, city: 'Freeport', state: 'TX', latitude: 28.954213, longitude: -95.359671, geofence_radius_m: 400, contact_name: 'Gate office' }),
    place('s1', 'Fixture Machine Works', 'outside_shop', { city: 'Houston', state: 'TX', latitude: 29.7521, longitude: -95.3612, contact_name: 'Sam Rivera' }),
    place('v1', 'Gulf Valve Supply', 'vendor', { city: 'Pasadena', state: 'TX' }),
    place('m1', '<img src=x onerror=alert(1)> Fab Shop', 'outside_shop', { latitude: 29.7, longitude: -94.9 }),
    place('r1', 'Old Pipe Yard', 'yard', { is_active: false, latitude: 29.1, longitude: -95.4 }),
    place('w1', 'West Yard gate', 'yard', { project_id: OTHER_PROJECT, latitude: 29.04, longitude: -95.7 }),
];

/**
 * In-memory places. Like 021: active names are unique ignoring case (23505); field workers can't insert (42501);
 * an update only reaches places outside a project or in one of `assigned`, and otherwise changes nothing.
 * Set `paused` to hold every request until step() lets the oldest one through.
 */
function fakeServer(rows, { role }) {
    const server = { places: structuredClone(rows), log: [], paused: false, waiting: [], fail: null, assigned: [PROJECT_ID], inserted: 0, edits: 0 };
    const office = ['office_staff', 'admin'].includes(role);
    const reachable = row => office && (!row.project_id || server.assigned.includes(row.project_id));
    const clash = row => row.is_active !== false && server.places.some(other => other.id !== row.id && other.is_active !== false && other.name.toLowerCase() === row.name.toLowerCase());
    const duplicate = { code: '23505', message: 'duplicate key value violates unique constraint "places_active_name"' };
    server.step = () => server.waiting.shift()();
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        if (request.table !== 'places') return { data: [], error: null };
        if (request.op === 'insert') {
            if (!office) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "places"' } };
            const row = { id: `new${++server.inserted}`, is_active: true, geofence_radius_m: 300, ...structuredClone(request.values) };
            if (clash(row)) return { data: null, error: duplicate };
            server.places.push(row);
            return { data: [{ id: row.id }], error: null };
        }
        const matching = server.places.filter(row => request.filters.every(([key, value]) => row[key] === value));
        if (request.op === 'update') {
            const allowed = matching.filter(reachable);
            if (allowed.some(row => clash({ ...row, ...request.values }))) return { data: null, error: duplicate };
            allowed.forEach(row => Object.assign(row, structuredClone(request.values), { updated_at: new Date(Date.UTC(2026, 9, 29, 9, 0, ++server.edits)).toISOString() }));
            return { data: allowed.map(row => ({ id: row.id })), error: null };
        }
        return { data: matching.slice(request.from, request.to + 1).map(row => structuredClone(row)), error: null };
    }
    class Query {
        constructor(table) { this.request = { table, op: 'select', filters: [], from: 0, to: 999 }; }
        select(columns) { if (this.request.op === 'select') this.request.columns = columns; else this.request.returning = columns; return this; }
        order() { return this; }
        range(from, to) { Object.assign(this.request, { from, to }); return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        update(values) { Object.assign(this.request, { op: 'update', values }); return this; }
        insert(values) { Object.assign(this.request, { op: 'insert', values }); return this; }
        then(resolve, reject) { return respond(this.request).then(resolve, reject); }
    }
    server.client = { from: table => new Query(table) };
    server.writes = () => server.log.filter(request => request.op !== 'select');
    server.place = name => server.places.find(row => row.name === name);
    return server;
}

/** Just enough Leaflet: maps and layers that remember what was added, their options and their handlers. */
function fakeLeaflet() {
    const leaflet = { maps: [] };
    const layer = extra => ({ handlers: {}, layers: new Set(), options: {},
        on(type, handler) { (this.handlers[type] ||= []).push(handler); return this; },
        fire(type, event) { (this.handlers[type] || []).forEach(handler => handler(event)); },
        addTo(target) { target.layers.add(this); this.owner = target; return this; },
        remove() { this.owner?.layers.delete(this); this.owner = null; this.removed = true; return this; },
        bindTooltip(content) { this.tooltip = content; return this; }, setStyle(style) { Object.assign(this.options, style); return this; },
        setLatLng(latLng) { this.latLng = latLng; return this; }, getLatLng() { return this.latLng; }, setRadius(radius) { this.options.radius = radius; return this; },
        clearLayers() { this.layers.clear(); }, ...extra });
    leaflet.L = {
        map: container => {
            const map = layer({ container, setView(center, zoom) { this.view = { center, zoom }; return this; },
                fitBounds(points, options) { this.bounds = points; this.view = { center: points[0], zoom: options.maxZoom }; return this; },
                getCenter() { return { lat: this.view.center[0], lng: this.view.center[1] }; }, getZoom() { return this.view.zoom; }, invalidateSize() {} });
            leaflet.maps.push(map);
            return map;
        },
        tileLayer: (url, options) => layer({ url, options }),
        layerGroup: () => layer(),
        circle: (latLng, options) => layer({ kind: 'circle', latLng, options: { ...options } }),
        circleMarker: (latLng, options) => layer({ kind: 'marker', latLng, options: { ...options } }),
        marker: (latLng, options) => layer({ kind: 'pin', latLng, options: { ...options } }),
        divIcon: options => options,
    };
    // Everything drawn on a map, through its layer groups.
    leaflet.drawn = map => [...map.layers].flatMap(item => item.layers.size ? [...item.layers] : [item]).filter(item => item.kind);
    return leaflet;
}

async function openPage({ role = 'admin', rows = PLACES } = {}) {
    const server = fakeServer(rows, { role });
    const leaflet = fakeLeaflet(), confirms = [];
    const { document, Option } = fakeDocument();
    const context = {
        document, Option, console, setTimeout, structuredClone, Intl,
        confirm: text => { confirms.push(text); return context.confirmAnswer ?? true; }, L: leaflet.L,
        SITE_CONFIG: { LATITUDE: 28.954, LONGITUDE: -95.359 },
        InvenioAuthReady: Promise.resolve(true), InvenioInventory: inventory, InvenioLogistics: logistics, InvenioCurrentProfile: { role },
        InvenioProjectScope: { availableProjects: [{ id: PROJECT_ID, name: 'North Yard', status: 'active' }, { id: 'p2', name: 'Closed Yard', status: 'closed' }],
            getActiveProjectId: () => PROJECT_ID, activeProject: { id: PROJECT_ID, status: 'active' } },
        supabaseClient: server.client,
        projectSupabaseClient: { from: () => { throw new Error('places are shared by every project; use supabaseClient'); } },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    await settle();
    const $ = id => document.getElementById(id);
    const drawer = $('placeDrawer'), content = $('placeContent');
    const names = () => $('placeRows').querySelectorAll('tr').map(row => row.querySelector('.fw-semibold')?.textContent ?? row.textContent);
    const view = async name => { $('placeRows').querySelectorAll('button').find(node => node.textContent === name).click(); await settle(); };
    const action = text => content.querySelectorAll('button').find(node => node.textContent === text);
    const input = key => content.querySelector(`[id="place_${key}"]`);
    const fill = values => { for (const [key, value] of Object.entries(values)) { input(key).value = value; input(key).onchange?.(); input(key).oninput?.(); } };
    const submit = async () => { await content.querySelector('form').onsubmit({ preventDefault() {} }); await settle(); };
    const status = () => $('placeStatus').textContent;
    const listMap = leaflet.maps[0], formMap = () => leaflet.maps.at(-1);
    const fields = () => Object.fromEntries(content.querySelector('dl').childNodes.map(pair => [pair.childNodes[0].textContent, pair.childNodes[1].textContent]));
    return { server, document, context, $, drawer, content, names, view, action, input, fill, submit, status, leaflet, listMap, formMap, confirms, fields };
}

test('lists active places by name, filters by kind and words, switches to retired, and maps the matches', async () => {
    const page = await openPage();
    assert.deepEqual(page.names(), ['<img src=x onerror=alert(1)> Fab Shop', 'Fixture Machine Works', 'Gulf Valve Supply', 'North Yard laydown', 'West Yard gate']);
    assert.equal(page.$('resultSummary').textContent, '5 active places');
    assert.ok(page.server.log.every(request => request.table === 'places' && !request.filters.some(([key]) => key === 'project_id')), 'read unscoped');
    // Four of the five have a point: each gets a marker and an arrival circle; the markup name is a text tooltip.
    const markers = () => page.leaflet.drawn(page.listMap).filter(item => item.kind === 'marker');
    assert.equal(markers().length, 4);
    assert.deepEqual(page.leaflet.drawn(page.listMap).filter(item => item.kind === 'circle').map(item => item.options.radius).sort(), [300, 300, 300, 400]);
    const tooltip = markers().find(item => item.latLng[0] === 29.7).tooltip;
    assert.equal(tooltip.tagName, 'SPAN'); assert.equal(tooltip.textContent, '<img src=x onerror=alert(1)> Fab Shop');
    assert.match(page.$('mapNote').textContent, /1 without a map point is only in the list/);

    page.$('filterKind').value = 'outside_shop'; page.$('filterKind').onchange();
    assert.deepEqual(page.names(), ['<img src=x onerror=alert(1)> Fab Shop', 'Fixture Machine Works']);
    assert.equal(page.$('resultSummary').textContent, '2 of 5 active places match');
    page.$('filterSearch').value = 'houston sam'; page.$('filterSearch').oninput();
    assert.deepEqual(page.names(), ['Fixture Machine Works']);
    assert.deepEqual(plain(page.listMap.bounds), [[29.7521, -95.3612]], 'the map fits the matches');

    page.$('filterKind').value = ''; page.$('filterSearch').value = ''; page.$('showRetired').click();
    assert.deepEqual(page.names(), ['Old Pipe Yard']);
    assert.equal(page.$('showRetired').getAttribute('aria-pressed'), 'true');
    assert.equal(page.$('showActive').getAttribute('aria-pressed'), 'false');
    // A marker opens its place.
    markers()[0].fire('click');
    await settle();
    assert.equal(page.drawer.open, true);
    assert.equal(page.content.querySelector('h2').textContent, 'Old Pipe Yard');
});

test('field workers see details but no way to add, edit, retire or restore', async () => {
    const page = await openPage({ role: 'field_worker' });
    assert.equal(page.$('addPlace').hidden, true);
    await page.view('Fixture Machine Works');
    assert.deepEqual(page.fields(), { Address: 'Houston, TX', 'Map point': '29.752100, -95.361200', 'Arrival radius': '300 m', Contact: 'Sam Rivera', 'Last changed': new Date('2026-10-28T12:00:00Z').toLocaleString() });
    assert.deepEqual(page.content.querySelectorAll('button').map(node => node.textContent), ['Close', 'Show on map']);
    assert.ok(!page.content.textContent.includes('only staff on that project'), 'no office-only note for field workers');
    page.$('showRetired').click(); await page.view('Old Pipe Yard');
    assert.equal(page.action('Restore'), undefined);
    assert.equal(page.server.writes().length, 0);
});

test('adding a place: the map click sets the point, the pin and circle follow, and the row matches 021', async () => {
    const page = await openPage();
    page.$('addPlace').click(); await settle();
    assertFocus(page, page.input('kind'), 'a new place starts at Kind');
    const map = page.formMap();
    assert.notEqual(map, page.listMap, 'the form has its own map');
    assert.deepEqual(plain(map.view), plain(page.listMap.view), 'it starts where the list map is');
    page.fill({ kind: 'yard', name: '  Laydown B ', project_id: PROJECT_ID, city: 'Freeport', contact_email: 'gate@example.test' });
    assert.deepEqual(page.input('project_id').options.map(option => option.textContent), ['None (shared by every project)', 'North Yard'], 'only active projects');
    map.fire('click', { latlng: { lat: 28.96123456, lng: -95.35123456 } });
    assert.equal(page.input('latitude').value, '28.961235');
    assert.equal(page.input('longitude').value, '-95.351235');
    const pin = () => page.leaflet.drawn(map).find(item => item.kind === 'pin'), circle = () => page.leaflet.drawn(map).find(item => item.kind === 'circle');
    assert.equal(pin().options.draggable, true);
    assert.equal(circle().options.radius, 300);
    page.fill({ geofence_radius_m: '800' });
    assert.equal(circle().options.radius, 800);
    pin().latLng = { lat: 28.97, lng: -95.34 }; pin().fire('dragend');
    assert.deepEqual([page.input('latitude').value, page.input('longitude').value], ['28.970000', '-95.340000']);
    assert.deepEqual(plain(circle().latLng), [28.97, -95.34], 'the circle follows the pin');
    page.fill({ latitude: '28.98' });
    assert.deepEqual(plain(pin().latLng), [28.98, -95.34], 'typed coordinates move the pin');

    await page.submit();
    const [write] = page.server.writes();
    assert.equal(write.op, 'insert');
    assert.equal(write.returning, 'id');
    assert.deepEqual(write.values, { kind: 'yard', name: 'Laydown B', project_id: PROJECT_ID, address: null, city: 'Freeport', state: null, postal_code: null,
        contact_name: null, contact_phone: null, contact_email: 'gate@example.test', secondary_contact_name: null, secondary_contact_phone: null, notes: null,
        latitude: 28.98, longitude: -95.34, geofence_radius_m: 800 });
    assert.ok(page.names().includes('Laydown B'), 'the list reloaded');
    assert.equal(page.content.querySelector('h2').textContent, 'Laydown B', 'the drawer shows the saved place');
    assert.equal(page.status(), 'Saved Laydown B.');
    assertFocus(page, page.action('Edit'));
    assert.equal(map.removed, true, 'the form map is let go');
    assert.equal(page.context.InvenioUnsavedChanges, false);
});

test('a project only goes with a yard or site, and the choice hides for other kinds', async () => {
    const page = await openPage();
    page.$('addPlace').click(); await settle();
    page.fill({ kind: 'site', project_id: PROJECT_ID, name: 'Terminal' });
    assert.equal(page.input('project_id').parentNode.hidden, false);
    page.fill({ kind: 'vendor' });
    assert.equal(page.input('project_id').parentNode.hidden, true);
    await page.submit();
    assert.equal(page.server.writes()[0].values.project_id, null);
});

test('half a point, a bad radius or no name is caught before anything is sent; clearing the point saves none', async () => {
    const page = await openPage();
    await page.view('Fixture Machine Works');
    page.action('Edit').click(); await settle();
    assertFocus(page, page.input('name'), 'editing starts at the name');
    page.fill({ longitude: '' });
    assert.equal(page.leaflet.drawn(page.formMap()).length, 0, 'half a point draws nothing');
    await page.submit();
    assert.equal(page.status(), 'Enter both latitude and longitude, or clear the map point.');
    assertFocus(page, page.input('longitude'));
    page.fill({ longitude: '-95.3612', geofence_radius_m: '10' });
    await page.submit();
    assert.equal(page.status(), 'Arrival radius must be a whole number of metres from 25 to 20,000.');
    page.fill({ geofence_radius_m: '250', name: ' ' });
    await page.submit();
    assert.equal(page.status(), 'Enter a name.');
    assert.equal(page.server.writes().length, 0);
    page.fill({ name: 'Fixture Machine Works' });
    page.content.querySelectorAll('button').find(node => node.textContent === 'Clear point').click();
    assert.deepEqual([page.input('latitude').value, page.input('longitude').value], ['', '']);
    await page.submit();
    const [write] = page.server.writes();
    assert.deepEqual([write.op, write.filters, write.values.latitude, write.values.longitude, write.values.geofence_radius_m], ['update', [['id', 's1'], ['updated_at', '2026-10-28T12:00:00Z']], null, null, 250]);
    assert.equal(page.fields()['Map point'], 'Not set');
});

test('a name another active place has is refused; the form keeps what was typed and the list reloads', async () => {
    const page = await openPage();
    await page.view('Gulf Valve Supply');
    page.action('Edit').click(); await settle();
    page.fill({ name: 'fixture machine works', city: 'Deer Park' });
    const reads = page.server.log.length;
    await page.submit();
    assert.equal(page.status(), 'Could not save: Another active place is already called "fixture machine works". Choose a different name.');
    assert.equal(page.input('city').value, 'Deer Park', 'the form is still open');
    assert.equal(page.server.log.slice(reads).filter(request => request.op === 'select').length, 1, 'the list reloaded after the refusal');
    assert.equal(page.action('Save changes').disabled, false, 'Save works again');
    page.fill({ name: 'Gulf Valve Supply Co' });
    await page.submit();
    assert.equal(page.server.place('Gulf Valve Supply Co').city, 'Deer Park');
});

test('retire and restore ask first where it matters, move focus to the new switch, and explain a name clash', async () => {
    const page = await openPage();
    await page.view('Gulf Valve Supply');
    page.context.confirmAnswer = false;
    page.action('Retire').click(); await settle();
    assert.equal(page.server.writes().length, 0, 'a declined confirm changes nothing');
    page.context.confirmAnswer = true;
    page.action('Retire').click(); await settle();
    assert.match(page.confirms[1], /^Retire Gulf Valve Supply\? It stays on record and can be restored/);
    assert.equal(page.server.place('Gulf Valve Supply').is_active, false);
    assert.ok(!page.names().includes('Gulf Valve Supply'), 'gone from the active list');
    assert.ok(page.content.querySelectorAll('.chip').some(chip => chip.textContent === 'Retired'));
    assertFocus(page, page.action('Restore'), 'focus moves to Restore');
    assert.equal(page.status(), 'Gulf Valve Supply is retired. Choose Retired above the list to find it again.');

    // Meanwhile someone adds an active place with the same name, so restoring is refused.
    page.server.places.push(place('v2', 'Gulf Valve Supply', 'vendor'));
    page.action('Restore').click(); await settle();
    assert.equal(page.confirms.length, 2, 'restoring needs no confirm');
    assert.equal(page.status(), 'Could not restore Gulf Valve Supply: Another active place is already called "Gulf Valve Supply". Rename one of them, then restore this one.');
    assertFocus(page, page.action('Restore'), 'focus stays on Restore');
    assert.equal(page.$('pageMessage').textContent, page.status());
});

test('a place in a project this user is not on is read-only, and an update row security swallows is reported', async () => {
    const page = await openPage();
    await page.view('West Yard gate');
    assert.equal(page.action('Edit'), undefined);
    assert.equal(page.action('Retire'), undefined);
    assert.match(page.content.textContent, /belongs to a project you are not assigned to, so only staff on that project can change it/);
    page.drawer.close();
    // Access to North Yard ends while the form is open: the update matches nothing and must not say "Saved".
    await page.view('North Yard laydown');
    page.action('Edit').click(); await settle();
    page.server.assigned = [];
    page.fill({ city: 'Clute' });
    await page.submit();
    assert.equal(page.status(), 'Could not save: Nothing was changed. This place may belong to a project you are not assigned to; reload the page and try again.');
    assert.equal(page.server.place('North Yard laydown').city, 'Freeport');
});

test('while a save runs, another save, Cancel or closing says so; the lock holds until the list has reloaded', async () => {
    const page = await openPage();
    await page.view('Gulf Valve Supply');
    page.action('Edit').click(); await settle();
    page.fill({ city: 'Deer Park' });
    page.server.paused = true;
    const saving = page.content.querySelector('form').onsubmit({ preventDefault() {} });
    await settle();
    page.content.querySelector('form').onsubmit({ preventDefault() {} });
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.');
    page.action('Cancel').click();
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.');
    page.drawer.escape();
    assert.equal(page.drawer.open, true, 'Escape does not close it mid-save');
    page.drawer.escape({ activated: false });
    assert.equal(page.drawer.open, true, "a second Escape, which Chrome won't let a page refuse, reopens it");
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.');
    assert.ok(page.content.querySelector('form'), 'with the form as it was');
    page.server.step(); await settle();
    assert.equal(page.server.waiting.length, 1, 'the reload is now waiting');
    page.content.querySelector('form').onsubmit({ preventDefault() {} });
    assert.equal(page.status(), 'Still saving the last change. Try again in a moment.', 'still locked during the reload');
    page.server.paused = false; page.server.step(); await saving; await settle();
    assert.equal(page.server.writes().length, 1);
    assert.equal(page.status(), 'Saved Gulf Valve Supply.');
});

test('closing with unsaved changes asks once per Escape, and a forced close keeps the edits unless the user lets them go', async () => {
    const page = await openPage();
    await page.view('Gulf Valve Supply');
    page.action('Edit').click(); await settle();
    page.fill({ city: 'Deer Park' }); page.content.querySelector('form').oninput();
    page.context.confirmAnswer = false;
    page.drawer.escape();
    assert.deepEqual([page.drawer.open, page.confirms.length], [true, 1], 'one question, and No keeps the drawer');
    assert.equal(page.confirms[0], 'Discard changes to this place?');
    page.drawer.escape({ activated: false });
    assert.deepEqual([page.drawer.open, page.confirms.length], [true, 2], 'a forced close asks again and reopens');
    assert.equal(page.input('city').value, 'Deer Park', 'the edits are still there');
    assert.equal(page.context.InvenioUnsavedChanges, true);
    page.context.confirmAnswer = true;
    page.content.querySelectorAll('button').find(node => node.textContent === 'Close').click();
    assert.equal(page.drawer.open, false);
    assert.equal(page.formMap().removed, true);
    assert.equal(page.context.InvenioUnsavedChanges, false);
    assert.equal(page.server.writes().length, 0);
});

test('a radius that is not a whole number is refused, never saved as the default', async () => {
    const page = await openPage();
    await page.view('North Yard laydown');
    page.action('Edit').click(); await settle();
    assert.equal(page.input('geofence_radius_m').type, 'text', 'a number field would turn "1500m" into ""');
    page.fill({ geofence_radius_m: '1500m' });
    await page.submit();
    assert.equal(page.status(), 'Arrival radius must be a whole number of metres from 25 to 20,000.');
    assert.equal(page.server.writes().length, 0);
    assert.equal(page.server.place('North Yard laydown').geofence_radius_m, 400);
});

test("an edit doesn't overwrite a change someone else saved after the form opened", async () => {
    const page = await openPage();
    await page.view('Fixture Machine Works');
    page.action('Edit').click(); await settle();
    Object.assign(page.server.place('Fixture Machine Works'), { contact_name: 'Riley Shah', updated_at: '2026-10-29T08:30:00Z' });
    page.fill({ city: 'Pasadena' });
    await page.submit();
    assert.deepEqual(plain(page.server.writes()[0].filters), [['id', 's1'], ['updated_at', '2026-10-28T12:00:00Z']]);
    assert.equal(page.status(), 'Could not save: This place was changed after you opened the form. Cancel to see the latest version, then make your changes again.');
    assert.deepEqual([page.server.place('Fixture Machine Works').contact_name, page.server.place('Fixture Machine Works').city], ['Riley Shah', 'Houston']);
    page.action('Cancel').click(); await settle();
    page.action('Edit').click(); await settle();
    assert.equal(page.input('contact_name').value, 'Riley Shah', 'reopening shows their version');
    page.fill({ city: 'Pasadena' });
    await page.submit();
    assert.equal(page.status(), 'Saved Fixture Machine Works.');
    assert.equal(page.server.place('Fixture Machine Works').city, 'Pasadena');
});

test('retire and restore report an update that row security swallows', async () => {
    const page = await openPage();
    await page.view('North Yard laydown');
    page.server.assigned = [];
    page.action('Retire').click(); await settle();
    assert.equal(page.status(), 'Could not retire North Yard laydown: Nothing was changed. This place may belong to a project you are not assigned to; reload the page and try again.');
    assert.equal(page.server.place('North Yard laydown').is_active, true);
});

test('a retire that finishes after Edit was opened leaves the form alone', async () => {
    const page = await openPage();
    await page.view('Gulf Valve Supply');
    page.server.paused = true;
    page.action('Retire').click(); await settle();
    page.action('Edit').click(); await settle();
    page.fill({ city: 'Deer Park' });
    page.server.step(); await settle();
    page.server.paused = false; page.server.step(); await settle();
    assert.equal(page.server.place('Gulf Valve Supply').is_active, false);
    assert.equal(page.content.querySelector('h2').textContent, 'Edit Gulf Valve Supply', 'the form is still showing');
    assert.equal(page.input('city').value, 'Deer Park');
    assert.equal(page.$('pageMessage').textContent, 'Gulf Valve Supply is retired. Choose Retired above the list to find it again.');
});

test('a place tied to a closed project says so, and a map click past the antimeridian is wrapped', async () => {
    const page = await openPage({ rows: [...PLACES, place('c1', 'Closed laydown', 'yard', { project_id: 'p2' })] });
    await page.view('Closed laydown');
    assert.equal(page.action('Edit'), undefined);
    assert.match(page.content.textContent, /This place belongs to Closed Yard, which is not an active project, so it can't be changed\./);
    page.drawer.close();
    page.$('addPlace').click(); await settle();
    page.formMap().fire('click', { latlng: { lat: 29.5, lng: -455.25, wrap: () => ({ lat: 29.5, lng: -95.25 }) } });
    assert.deepEqual([page.input('latitude').value, page.input('longitude').value], ['29.500000', '-95.250000']);
});

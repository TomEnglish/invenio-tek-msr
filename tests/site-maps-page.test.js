// Runs site-maps.js against a small fake DOM and a fake Supabase, so the area list is tested by what it does.
// By default the map has no plan image; with { image: true } the plan opens in a fake Leaflet view, so drawing,
// Edit, "Add area inside…" and the area form run too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('../js/utils/inventory-helpers');
const { fakeDocument, settle, assertFocus } = require('./support/fake-dom');

const source = fs.readFileSync('site-maps.js', 'utf8');
const MAP_ID = 'm1', PROJECT_ID = 'p1';
// Arrays made inside the page's vm context aren't deepEqual to this file's; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

// Places the plan can draw (022): this project's yard, a shared site, a retired shared yard; plus places it can't.
const place = (id, name, kind, extra = {}) => ({ id, name, kind, project_id: null, is_active: true, ...extra });
const PLACES = [
    place('y1', 'North Yard laydown', 'yard', { project_id: PROJECT_ID }), place('s1', 'Coastal Terminal site', 'site'),
    place('y0', 'Old Pipe Yard', 'yard', { is_active: false }), place('w1', 'West Yard gate', 'yard', { project_id: 'p9' }),
    place('o1', 'Fixture Machine Works', 'outside_shop'),
];
const rack = (id, zone, row, number, extra = {}) => ({ id, project_id: PROJECT_ID, zone, row, rack: number, is_hold_area: false, ...extra });

/**
 * In-memory site_maps, site_map_zones, places and racks. Set `paused` to hold every request until step() lets the
 * oldest one through. Like 020's guard, a parent that would put an area inside itself is refused with 22023; like
 * 022, a rack is linked to one active area (23505 on site_map_zones_rack), location_areas lists each rack with that
 * area, and a plan draws one of this project's yards or sites (42501).
 */
function fakeServer(zones, { image = false, places = PLACES, locations = [], map = {}, otherMaps = [], fail = null } = {}) {
    const server = { zones: zones.map(zone => ({ map_id: MAP_ID, project_id: PROJECT_ID, parent_id: null, is_active: true, color: '#174fda',
        location_id: null, shape: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], ...zone })), log: [], paused: false, waiting: [], fail, inserted: 0,
        places: structuredClone(places), locations: structuredClone(locations) };
    const plan = image ? { storage_path: `${PROJECT_ID}/${MAP_ID}.png`, image_width: 1000, image_height: 1000 } : { storage_path: null };
    server.maps = [{ id: MAP_ID, project_id: PROJECT_ID, name: 'Plan', is_active: true, place_id: null, ...plan, ...map }, ...structuredClone(otherMaps)];
    const insideItself = (id, parentId) => {
        for (let node = server.zones.find(zone => zone.id === parentId), steps = 0; node && steps < 50; node = server.zones.find(zone => zone.id === node.parent_id), steps++) {
            if (node.id === id) return true;
        }
        return false;
    };
    const path = zone => zone.parent_id ? `${path(server.zones.find(other => other.id === zone.parent_id))} › ${zone.name}` : zone.name;
    const rackTaken = zone => zone.is_active !== false && zone.location_id && server.zones.some(other => other.id !== zone.id && other.is_active !== false && other.location_id === zone.location_id);
    const RACK_TAKEN = { code: '23505', message: 'duplicate key value violates unique constraint "site_map_zones_rack"', details: 'Key (location_id)=(l1) already exists.' };
    const badPlace = row => row.place_id && !server.places.some(item => item.id === row.place_id && ['yard', 'site'].includes(item.kind) && (!item.project_id || item.project_id === row.project_id));
    const PLACE_REFUSED = { code: '42501', message: "A site plan draws one of this project's yards or sites" };
    const views = {
        location_areas: () => server.locations.map(item => {
            const zone = server.zones.find(other => other.location_id === item.id && other.is_active !== false);
            const map = zone && server.maps.find(other => other.id === zone.map_id);
            return { location_id: item.id, project_id: item.project_id, rack_zone: item.zone, rack_row: item.row, rack: item.rack, is_hold_area: item.is_hold_area,
                zone_id: zone?.id || null, site_map_id: zone?.map_id || null, area: zone ? path(zone) : null, place_id: map?.place_id || null };
        }),
        // The page's .or() is "project_id is null or this project"; it orders by name.
        places: request => server.places.filter(item => !request.or || !item.project_id || request.or.includes(`project_id.eq.${item.project_id}`))
            .sort((a, b) => a.name.localeCompare(b.name)),
    };
    server.step = () => server.waiting.shift()();
    server.order = () => [...server.zones].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        const matches = row => request.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
        if (views[request.table]) return { data: views[request.table](request).filter(matches).map(row => structuredClone(row)), error: null };
        if (request.table === 'site_maps') {
            if (request.op === 'insert') {
                const row = { id: `map${++server.inserted}`, project_id: PROJECT_ID, storage_path: null, ...structuredClone(request.values) };
                if (badPlace(row)) return { data: null, error: PLACE_REFUSED };
                server.maps.push(row);
                return { data: request.single ? structuredClone(row) : [structuredClone(row)], error: null };
            }
            const matching = server.maps.filter(matches);
            if (request.op === 'update') {
                if ('place_id' in request.values && matching.some(row => badPlace({ ...row, ...request.values }))) return { data: null, error: PLACE_REFUSED };
                matching.forEach(row => Object.assign(row, structuredClone(request.values)));
                return { data: null, error: null };
            }
            return { data: matching.map(row => structuredClone(row)), error: null };
        }
        if (request.table !== 'site_map_zones') return { data: [], error: null };
        if (request.op === 'insert') {
            const row = { id: `new${++server.inserted}`, project_id: PROJECT_ID, parent_id: null, is_active: true, ...structuredClone(request.values) };
            if (rackTaken(row)) return { data: null, error: RACK_TAKEN };
            server.zones.push(row);
            return { data: null, error: null };
        }
        const matching = server.zones.filter(matches);
        if (request.op === 'update') {
            if (matching.some(zone => request.values.parent_id && insideItself(zone.id, request.values.parent_id))) return { data: null, error: { code: '22023', message: 'An area cannot be placed inside itself' } };
            if (matching.some(zone => rackTaken({ ...zone, ...request.values }))) return { data: null, error: RACK_TAKEN };
            matching.forEach(zone => Object.assign(zone, structuredClone(request.values)));
            return { data: null, error: null };
        }
        return { data: server.order().filter(zone => matching.includes(zone)).map(zone => structuredClone(zone)), error: null };
    }
    class Query {
        constructor(table) { this.request = { table, op: 'select', filters: [] }; }
        select() { return this; }
        order() { return this; }
        range() { return this; }
        single() { this.request.single = true; return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        in(key, values) { this.request.filters.push([key, [...values]]); return this; }
        or(filter) { this.request.or = filter; return this; }
        update(values) { Object.assign(this.request, { op: 'update', values }); return this; }
        insert(values) { Object.assign(this.request, { op: 'insert', values }); return this; }
        then(resolve, reject) { return respond(this.request).then(resolve, reject); }
    }
    server.client = { from: table => new Query(table) };
    server.updates = () => server.log.filter(request => request.op === 'update');
    server.writes = () => server.log.filter(request => request.op !== 'select');
    server.zone = name => server.zones.find(zone => zone.name === name);
    return server;
}

/** Just enough Leaflet for site-maps.js: layers that remember their handlers, and a map that can fire clicks. */
function fakeLeaflet() {
    const leaflet = { groups: [] };
    const layer = extra => ({ handlers: {}, on(type, handler) { (this.handlers[type] ||= []).push(handler); return this; },
        addTo(target) { target.layers.add(this); this.owner = target; return this; },
        remove() { this.owner?.layers.delete(this); this.owner = null; return this; },
        setStyle() { return this; }, setLatLngs(latLngs) { this.latLngs = latLngs; return this; }, getBounds: () => [[0, 0], [1, 1]], ...extra });
    leaflet.map = { ...layer(), layers: new Set(), fire(type, event) { (this.handlers[type] || []).forEach(handler => handler(event)); },
        fitBounds() {}, getZoom: () => 0, doubleClickZoom: { enable() {}, disable() {} } };
    leaflet.L = {
        layerGroup: () => { const group = layer({ layers: new Set() }); leaflet.groups.push(group); return group; },
        polygon: latLngs => layer({ latLngs }), polyline: latLngs => layer({ latLngs }), marker: (latLng, options) => layer({ latLng, options }),
        divIcon: options => options, DomEvent: { stopPropagation() {}, preventDefault() {} },
    };
    // The corner handles of the area being drawn or edited, in point order.
    leaflet.handles = () => [...leaflet.groups.at(-1).layers].filter(item => item.options?.draggable);
    leaflet.view = {
        map: leaflet.map, show() {}, destroy() {},
        toLatLng: point => ({ lng: point[0], lat: point[1] }), fromLatLng: latLng => [latLng.lng, latLng.lat],
    };
    return leaflet;
}


async function openPage(zones, { role = 'admin', image = false, ...data } = {}) {
    const server = fakeServer(zones, { image, ...data });
    const leaflet = fakeLeaflet(), confirms = [];
    const { document, Option } = fakeDocument();
    const context = {
        document, Option, console, setTimeout, URLSearchParams, structuredClone,
        history: { replaceState() {} }, location: { search: '' }, confirm: text => { confirms.push(text); return true; }, addEventListener() {},
        InvenioAuthReady: Promise.resolve(true), InvenioInventory: inventory, L: leaflet.L,
        InvenioSiteMapView: { signedPlanUrl: async () => 'blob:plan', create: () => leaflet.view, zonePolygon: (view, zone, options) => Object.assign(leaflet.L.polygon(zone.shape), { zone, options }) },
        InvenioProjectScope: { getActiveProjectId: () => PROJECT_ID, activeProject: { status: 'active' } },
        InvenioCurrentProfile: { role }, projectSupabaseClient: server.client, supabaseClient: server.client,
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    await settle();
    const $ = id => document.getElementById(id);
    const rows = () => $('zoneList').querySelectorAll('[role="treeitem"]');
    const names = () => rows().map(row => row.querySelector('.zone-name').textContent);
    const row = name => rows().find(item => item.querySelector('.zone-name').textContent === name);
    const control = (name, label) => row(name).querySelectorAll('[aria-label]').find(node => node.getAttribute('aria-label') === label);
    const editor = $('zoneEditor');
    const formField = id => editor.querySelector(`[id="${id}"]`);
    const choose = value => { formField('zoneParent').value = value; formField('zoneParent').onchange(); };
    const submit = async () => { await editor.querySelector('form').onsubmit({ preventDefault() {} }); await settle(); };
    const draw = async points => { for (const [x, y] of points) leaflet.map.fire('click', { latlng: { lng: x, lat: y } }); $('finishZone').click(); await settle(); };
    const status = () => editor.querySelector('[role="status"]').textContent;
    const outlineWarning = () => editor.querySelector('.zone-outline-warning').textContent;
    return { server, document, context, $, rows, names, row, control, leaflet, confirms, editor, formField, choose, submit, draw, status, outlineWarning };
}

const rootsABC = [{ id: 'a', name: 'A', sort_order: 10 }, { id: 'b', name: 'B', sort_order: 20 }, { id: 'c', name: 'C', sort_order: 30 }];

test('a reorder keeps the list locked until the reload has finished, so stale buttons do nothing', async () => {
    const page = await openPage(rootsABC);
    assert.deepEqual(page.names(), ['A', 'B', 'C']);
    const staleDownA = page.control('A', 'Move A down'), staleDownB = page.control('B', 'Move B down'), staleUpC = page.control('C', 'Move C up');
    page.server.paused = true;
    staleDownA.click();
    await settle();
    const tryStaleClicks = async () => { staleDownA.click(); staleDownB.click(); staleUpC.click(); await settle(); };
    // First write (B to 10) in flight.
    assert.equal(page.server.updates().length, 1);
    await tryStaleClicks();
    assert.equal(page.server.updates().length, 1, 'no second move while the first write is in flight');
    page.server.step(); await settle();
    assert.equal(page.server.updates().length, 2, 'second write (A to 20) in flight');
    page.server.step(); await settle();
    assert.equal(page.server.log.at(-1).op, 'select', 'the reload is in flight');
    await tryStaleClicks();
    assert.equal(page.server.updates().length, 2, 'stale buttons stay inert until the reload finishes');
    page.server.paused = false; page.server.step(); await settle();
    assert.deepEqual(page.names(), ['B', 'A', 'C']);
    assert.deepEqual(page.server.order().map(zone => [zone.name, zone.sort_order]), [['B', 10], ['A', 20], ['C', 30]]);
    assert.equal(page.$('pageMessage').textContent, 'Moved A down.');
});

test('a reorder that fails halfway reloads the list, and a retry renumbers the group without duplicates', async () => {
    const page = await openPage(rootsABC);
    page.server.fail = request => request.op === 'update' && page.server.updates().length === 2 ? { code: '08006', message: 'Connection lost' } : null;
    page.control('A', 'Move A down').click();
    await settle();
    assert.deepEqual(page.server.log.slice(-3).map(request => request.op), ['update', 'update', 'select'], 'reloaded after the failed write');
    assert.equal(page.$('pageMessage').textContent, 'Could not save: Connection lost');
    // B was saved as 10 but A kept 10: the list shows what the server has.
    assert.deepEqual(page.server.order().map(zone => zone.sort_order), [10, 10, 30]);
    assert.deepEqual(page.names(), ['A', 'B', 'C']);
    page.server.fail = null;
    page.control('A', 'Move A down').click();
    await settle();
    assert.deepEqual(page.server.order().map(zone => [zone.name, zone.sort_order]), [['B', 10], ['A', 20], ['C', 30]]);
    assert.deepEqual(page.names(), ['B', 'A', 'C']);
});

test('a refusal with the database\'s own 42501 reason shows that reason and reloads the list', async () => {
    const page = await openPage(rootsABC);
    page.server.fail = request => request.op === 'update' ? { code: '42501', message: 'A parent area must be on the same site plan' } : null;
    const selectsBefore = page.server.log.filter(request => request.op === 'select' && request.table === 'site_map_zones').length;
    page.control('B', 'Make inactive: B').click();
    await settle();
    assert.equal(page.$('pageMessage').textContent, 'Could not save: A parent area must be on the same site plan');
    assert.equal(page.server.log.filter(request => request.op === 'select' && request.table === 'site_map_zones').length, selectsBefore + 1);
    page.server.fail = () => ({ code: '42501', message: 'new row violates row-level security policy for table "site_map_zones"' });
    page.control('B', 'Make inactive: B').click();
    await settle();
    assert.match(page.$('pageMessage').textContent, /^Could not save: You do not have permission/);
});

test('order and the active switch work without a plan image; drawing and editing need one', async () => {
    const page = await openPage([...rootsABC, { id: 'a1', parent_id: 'a', name: 'A1', sort_order: 10 }]);
    const labels = page.row('A').querySelector('.zone-actions').childNodes.map(node => node.textContent);
    assert.deepEqual(labels, ['↑', '↓', 'Make inactive']);
    assert.equal(page.control('A', 'Move A up').disabled, true);
    const field = await openPage(rootsABC, { role: 'field_worker' });
    assert.deepEqual(field.row('A').querySelector('.zone-actions').childNodes, [], 'field crews only read the list');
});

test('the area list is an ARIA tree, and focus stays on the same control after collapse and move', async () => {
    const page = await openPage([...rootsABC, { id: 'a1', parent_id: 'a', name: 'A1', sort_order: 10 }]);
    const list = page.$('zoneList');
    assert.equal(list.getAttribute('role'), 'tree');
    assert.deepEqual(page.rows().map(row => [row.querySelector('.zone-name').textContent, row.getAttribute('aria-level'), row.getAttribute('aria-expanded')]),
        [['A', '1', 'true'], ['A1', '2', null], ['B', '1', null], ['C', '1', null]]);
    assert.deepEqual(page.rows().map(row => row.tabIndex), [0, -1, -1, -1], 'one tab stop for the tree');
    page.control('A', 'Collapse A').click();
    assert.deepEqual(page.names(), ['A', 'B', 'C']);
    assert.equal(page.row('A').getAttribute('aria-expanded'), 'false');
    assert.ok(list.contains(page.document.activeElement), 'focus is not lost to the page body');
    assert.equal(page.document.activeElement.getAttribute('aria-label'), 'Expand A');
    page.control('A', 'Move A down').click();
    await settle();
    assert.deepEqual(page.names(), ['B', 'A', 'C']);
    assert.equal(page.document.activeElement.getAttribute('aria-label'), 'Move A down', 'same control on the redrawn row');
    page.control('A', 'Move A down').click();
    await settle();
    assert.equal(page.control('A', 'Move A down').disabled, true);
    assertFocus(page, page.row('A'), 'a control that is now disabled hands focus to its row');
    // Keys on a focused row.
    const key = name => page.document.activeElement.dispatch('keydown', { key: name });
    key('Home');
    assertFocus(page, page.row('B'));
    key('ArrowDown'); key('ArrowDown');
    assertFocus(page, page.row('A'));
    key('ArrowRight');
    assert.deepEqual(page.names(), ['B', 'C', 'A', 'A1'], 'right opens a closed area');
    assertFocus(page, page.row('A'));
    key('ArrowRight');
    assertFocus(page, page.row('A1'), 'right again steps into it');
    key('ArrowLeft');
    assertFocus(page, page.row('A'), 'left from a leaf steps out to its parent');
    assert.deepEqual(page.rows().map(row => row.tabIndex), [-1, -1, 0, -1]);
});

test('deep trees stop indenting past level 9 and show the level instead', async () => {
    const chain = Array.from({ length: 18 }, (_, index) => ({ id: `l${index + 1}`, parent_id: index ? `l${index}` : null, name: `Level area ${index + 1}`, sort_order: 10 }));
    const page = await openPage(chain);
    assert.equal(page.row('Level area 5').style['--depth'], '4');
    assert.equal(page.row('Level area 5').querySelector('.chip'), null);
    assert.equal(page.row('Level area 18').style['--depth'], '8');
    assert.equal(page.row('Level area 18').querySelector('.chip').textContent, 'Level 18');
    assert.equal(page.row('Level area 18').getAttribute('aria-level'), '18');
});

// A plan with nested areas: T1 Pipe Racks › Rack 1 / Rack 2, and Warehouse › Bay.
const square = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const plan = [
    { id: 't1', name: 'T1 Pipe Racks', sort_order: 10, shape: square(0.1, 0.1, 0.5, 0.5) },
    { id: 'r1', parent_id: 't1', name: 'Rack 1', sort_order: 10, shape: square(0.12, 0.2, 0.28, 0.4) },
    { id: 'r2', parent_id: 't1', name: 'Rack 2', sort_order: 20, shape: square(0.3, 0.2, 0.45, 0.4) },
    { id: 'wh', name: 'Warehouse', sort_order: 20, shape: square(0.6, 0.1, 0.9, 0.5) },
    { id: 'bay', parent_id: 'wh', name: 'Bay', sort_order: 30, shape: square(0.65, 0.15, 0.8, 0.3) },
];
const levels = page => page.rows().map(row => `${row.getAttribute('aria-level')}:${row.querySelector('.zone-name').textContent}`);

test('Add area inside… draws a child, which saves at the end of its new siblings', async () => {
    const page = await openPage(plan, { image: true });
    page.control('T1 Pipe Racks', 'Draw a new area inside T1 Pipe Racks').click();
    await page.draw([[0.2, 0.42], [0.3, 0.42], [0.3, 0.48]]);
    assert.equal(page.editor.querySelector('h3').textContent, 'New area');
    assert.equal(page.formField('zoneParent').value, 't1', 'starts inside the area it was drawn in');
    assert.equal(page.outlineWarning(), '');
    page.formField('zoneName').value = 'Shelf A';
    await page.submit();
    const [insert] = page.server.writes();
    assert.equal(insert.op, 'insert');
    const { color, ...values } = JSON.parse(JSON.stringify(insert.values));
    assert.match(color, /^#[0-9a-f]{6}$/);
    assert.deepEqual(values, { name: 'Shelf A', location_id: null, parent_id: 't1', map_id: MAP_ID, sort_order: 30, shape: [[0.2, 0.42], [0.3, 0.42], [0.3, 0.48]] });
    assert.equal(page.editor.hidden, true);
    assert.equal(page.$('pageMessage').textContent, 'Saved T1 Pipe Racks › Shelf A.');
    assertFocus(page, page.$('pageMessage'));
    assert.deepEqual(levels(page), ['1:T1 Pipe Racks', '2:Rack 1', '2:Rack 2', '2:Shelf A', '1:Warehouse', '2:Bay']);
});

test('Edit renames in place, and moving to another parent puts the area at the end of its new siblings', async () => {
    const page = await openPage(plan, { image: true });
    page.control('Rack 1', 'Edit Rack 1').click();
    await settle(); // the form focuses its name field on a timer
    page.formField('zoneName').value = 'Rack 1A';
    await page.submit();
    assert.deepEqual(Object.keys(page.server.writes().at(-1).values).sort(), ['color', 'location_id', 'name', 'parent_id', 'shape'], 'same parent: order untouched');
    assert.equal(page.server.zone('Rack 1A').sort_order, 10);
    page.control('Rack 2', 'Edit Rack 2').click();
    assert.deepEqual(page.formField('zoneParent').options.map(option => option.value), ['', 't1', 'r1', 'wh', 'bay'], 'never itself');
    page.choose('wh');
    assert.equal(page.outlineWarning(), 'The outline goes outside Warehouse. You can still save it.');
    await page.submit();
    assert.deepEqual([page.server.zone('Rack 2').parent_id, page.server.zone('Rack 2').sort_order], ['wh', 40], 'after Bay (30), not its old 20');
    assert.equal(page.$('pageMessage').textContent, 'Saved Warehouse › Rack 2. The outline goes outside Warehouse.');
    assert.deepEqual(levels(page), ['1:T1 Pipe Racks', '2:Rack 1A', '1:Warehouse', '2:Bay', '2:Rack 2']);
    assert.match(page.row('Rack 2').textContent, /Outline goes outside Warehouse/);
});

test('outline warnings: a child drawn outside its parent, and a parent reshaped past its child', async () => {
    const page = await openPage(plan, { image: true });
    page.control('Warehouse', 'Draw a new area inside Warehouse').click();
    await page.draw([[0.7, 0.35], [0.95, 0.35], [0.7, 0.45]]);
    assert.equal(page.outlineWarning(), 'The outline goes outside Warehouse. You can still save it.');
    page.editor.querySelectorAll('button').find(node => node.textContent === 'Cancel').click();
    page.control('T1 Pipe Racks', 'Edit T1 Pipe Racks').click();
    assert.equal(page.outlineWarning(), '');
    // Drag the bottom-right corner in, so Rack 2's corner sticks out.
    const corner = page.leaflet.handles()[2];
    corner.handlers.drag[0]({ target: { getLatLng: () => ({ lng: 0.35, lat: 0.5 }) } });
    corner.handlers.dragend[0]();
    assert.equal(page.outlineWarning(), 'Areas inside it go outside the outline: Rack 2. You can still save it.');
    await page.submit();
    assert.equal(page.$('pageMessage').textContent, 'Saved T1 Pipe Racks. Areas inside it go outside the outline: Rack 2.');
    assert.deepEqual(page.server.zone('T1 Pipe Racks').shape[2], [0.35, 0.5]);
});

test('a refused move keeps the area where it is on retry, and both messages stay visible', async () => {
    const page = await openPage(plan, { image: true });
    page.control('Rack 2', 'Edit Rack 2').click();
    page.choose('wh');
    // Meanwhile someone else puts Warehouse inside Rack 2.
    page.server.zone('Warehouse').parent_id = 'r2';
    await page.submit();
    assert.equal(page.status(), 'Could not save: An area cannot be placed inside itself');
    assert.equal(page.formField('zoneParent').value, 't1', 'back to where Rack 2 is, not the top level');
    assert.equal(page.editor.querySelector('[aria-live="polite"]').textContent,
        'Warehouse can no longer hold this area, so it is set back to inside T1 Pipe Racks. Choose again if needed.');
    assert.deepEqual(page.formField('zoneParent').options.map(option => option.value), ['', 't1', 'r1'], 'Warehouse and Bay are inside Rack 2 now');
    await page.submit();
    assert.deepEqual([page.server.zone('Rack 2').parent_id, page.server.zone('Rack 2').sort_order], ['t1', 20]);
    assert.equal(page.server.writes().at(-1).values.sort_order, undefined, 'unchanged parent keeps its place');
    // Warehouse is inside Rack 2 now, so the save also notes that its outline sticks out.
    assert.equal(page.$('pageMessage').textContent, 'Saved T1 Pipe Racks › Rack 2. Areas inside it go outside the outline: Warehouse.');
});

test('while a save is running, other actions say so instead of asking and then doing nothing', async () => {
    const page = await openPage(plan, { image: true });
    page.server.paused = true;
    page.control('Rack 1', 'Move Rack 1 down').click();
    await settle();
    page.control('Rack 2', 'Make inactive: Rack 2').click();
    assert.deepEqual(page.confirms, [], 'no confirmation for a change that cannot run yet');
    assert.equal(page.$('pageMessage').textContent, 'Still saving the last change. Try again in a moment.');
    const groups = page.leaflet.groups.length;
    for (const [name, label] of [['Bay', 'Edit Bay'], ['Warehouse', 'Draw a new area inside Warehouse']]) {
        page.$('pageMessage').textContent = '';
        page.control(name, label).click();
        assert.equal(page.$('pageMessage').textContent, 'Still saving the last change. Try again in a moment.', label);
    }
    assert.equal(page.editor.querySelector('form'), null, 'no form opened');
    assert.equal(page.leaflet.groups.length, groups, 'nothing drawn');
    page.server.paused = false;
    while (page.server.waiting.length) { page.server.step(); await settle(); }
    assert.equal(page.server.updates().length, 2, 'only the move ran');
    assert.equal(page.$('pageMessage').textContent, 'Moved Rack 1 down.');
    page.control('Rack 2', 'Make inactive: Rack 2').click();
    await settle();
    assert.equal(page.confirms.length, 1);
    assert.equal(page.server.zone('Rack 2').is_active, false);
});

// ---- 022: the place a plan draws, and racks linked to areas ---------------------------------------------------
const mapDialog = page => {
    const content = page.$('mapDialogContent');
    const formField = id => content.querySelector(`[id="${id}"]`);
    const submit = async () => { await content.querySelector('form').onsubmit({ preventDefault() {} }); await settle(); };
    return { content, formField, submit, status: () => content.querySelector('[role="status"]').textContent };
};
const mapAction = (page, text) => page.$('mapActions').querySelectorAll('button').find(node => node.textContent === text);
const optionTexts = select => select.options.map(option => `${option.textContent}${option.disabled ? ' [disabled]' : ''}`);

test('everyone sees the place a plan draws, or that it is not tied to one yet', async () => {
    const field = await openPage(rootsABC, { role: 'field_worker', map: { place_id: 'y1' } });
    assert.equal(field.$('mapPlace').textContent, 'Place: North Yard laydown');
    assert.equal(mapAction(field, 'Name and place'), undefined, 'field crews only read it');
    const loose = await openPage(rootsABC);
    assert.equal(loose.$('mapPlace').textContent, 'Not tied to a place yet: its areas can be used at any yard or site.');
    const retired = await openPage(rootsABC, { map: { place_id: 'y0' } });
    assert.equal(retired.$('mapPlace').textContent, 'Place: Old Pipe Yard (retired)');
    // Places are shared, so they are read unscoped and narrowed to the yards and sites this project can use.
    const read = loose.server.log.find(request => request.table === 'places');
    assert.deepEqual(plain([read.filters, read.or]), [[['kind', ['yard', 'site']]], 'project_id.is.null,project_id.eq.p1']);
});

test('office staff choose the place under Name and place; only a changed place is sent', async () => {
    const page = await openPage(rootsABC, { map: { place_id: 'y0' } });
    mapAction(page, 'Name and place').click();
    const dialog = mapDialog(page);
    assert.deepEqual(optionTexts(dialog.formField('mapPlaceChoice')), ['Not tied to a place yet', 'Coastal Terminal site', 'North Yard laydown', 'Old Pipe Yard (retired)'],
        "this project's and shared yards and sites; the retired one only because the plan is on it");
    assert.equal(dialog.formField('mapPlaceChoice').value, 'y0');
    dialog.formField('mapName').value = 'Yard plan';
    await dialog.submit();
    assert.deepEqual(plain(page.server.writes().at(-1).values), { name: 'Yard plan' }, 'a rename leaves the place alone');
    mapAction(page, 'Name and place').click();
    mapDialog(page).formField('mapPlaceChoice').value = 's1';
    await mapDialog(page).submit();
    assert.deepEqual(plain(page.server.writes().at(-1).values), { name: 'Yard plan', place_id: 's1' });
    assert.equal(page.$('mapPlace').textContent, 'Place: Coastal Terminal site');
    assert.equal(page.$('pageMessage').textContent, 'Saved Yard plan.');
    mapAction(page, 'Name and place').click();
    mapDialog(page).formField('mapPlaceChoice').value = '';
    await mapDialog(page).submit();
    assert.equal(page.server.maps[0].place_id, null);
    assert.equal(page.$('mapPlace').textContent, 'Not tied to a place yet: its areas can be used at any yard or site.');
});

test("a place the database refuses for the plan shows its 42501 reason as written", async () => {
    const page = await openPage(rootsABC);
    mapAction(page, 'Name and place').click();
    const dialog = mapDialog(page);
    dialog.formField('mapPlaceChoice').value = 's1';
    // Meanwhile the site is tied to another project.
    page.server.places.find(item => item.id === 's1').project_id = 'p9';
    await dialog.submit();
    assert.equal(dialog.status(), "Could not save: A site plan draws one of this project's yards or sites");
    assert.equal(page.server.maps[0].place_id, null);
    page.server.fail = request => request.table === 'site_maps' && request.op === 'update' ? { code: '22023', message: 'This site plan is no longer in use' } : null;
    await dialog.submit();
    assert.equal(dialog.status(), 'Could not save: This site plan is no longer in use');
});

test("a new map starts on the project's own yard and saves the place with it", async () => {
    const page = await openPage([]);
    // Just enough of the browser to prepare an image that needs no resizing, and Storage to take it.
    Object.assign(page.server.client, { storage: { from: () => ({ upload: async () => ({ error: null }) }) } });
    page.$('newMap').onclick();
    const dialog = mapDialog(page);
    assert.equal(dialog.formField('mapPlaceChoice').value, 'y1', 'North Yard laydown is the only yard or site of this project');
    dialog.formField('mapName').value = 'South laydown';
    dialog.formField('mapPlaceChoice').value = 's1';
    page.context.URL = { createObjectURL: () => 'blob:upload', revokeObjectURL() {} };
    page.context.Image = class { set src(value) { setTimeout(() => this.onload()); } get naturalWidth() { return 800; } get naturalHeight() { return 600; } };
    dialog.formField('mapFile').files = [{ type: 'image/png', size: 1000 }];
    await dialog.submit();
    const insert = page.server.writes().find(request => request.table === 'site_maps' && request.op === 'insert');
    assert.deepEqual(plain(insert.values), { name: 'South laydown', is_active: true, place_id: 's1' });
    assert.equal(page.$('mapPlace').textContent, 'Place: Coastal Terminal site');
});

const RACKS = [rack('l1', 'A', '1', '1'), rack('l2', 'A', '1', '2'), rack('l3', 'B', '2', '1', { is_hold_area: true })];
const SOUTH = { id: 'm2', project_id: PROJECT_ID, name: 'South plan', is_active: true, place_id: null, storage_path: null };
// Rack 1 has rack A1; an area on another plan has A2; B1 (a hold area) has no area yet.
const racked = (extra = []) => [...plan.map(zone => zone.id === 'r1' ? { ...zone, location_id: 'l1' } : zone),
    { id: 'far', map_id: 'm2', name: 'Far bay', sort_order: 10, location_id: 'l2' }, ...extra];
const rackPanel = page => [page.$('rackStatus').querySelector('p').textContent, ...page.$('rackStatus').querySelectorAll('li').map(item => item.textContent)];

test('the area editor lists the racks, marks the ones other areas have, and the panel counts racks without an area', async () => {
    const page = await openPage(racked(), { image: true, locations: RACKS, otherMaps: [SOUTH] });
    assert.deepEqual(rackPanel(page), ['1 of 3 racks are not linked to an area yet. Edit an area to choose its rack.', 'B · Row 2, Rack 1 (hold area)']);
    assert.ok(page.server.log.some(request => request.table === 'location_areas'));
    assert.equal(require('../js/utils/project-scope').isProjectScopedTable('location_areas'), true, 'location_areas is read through the project scope');
    page.control('Rack 2', 'Edit Rack 2').click();
    assert.deepEqual(optionTexts(page.formField('zoneLocation')), ['No rack', 'A · Row 1, Rack 1: linked to T1 Pipe Racks › Rack 1 [disabled]',
        'A · Row 1, Rack 2: linked to Far bay on South plan [disabled]', 'B · Row 2, Rack 1 (hold area)']);
    assert.equal(page.formField('zoneLocation').value, '');
    page.formField('zoneLocation').value = 'l3';
    await page.submit();
    assert.equal(page.server.writes().at(-1).values.location_id, 'l3');
    assert.equal(page.$('pageMessage').textContent, 'Saved T1 Pipe Racks › Rack 2.');
    assert.deepEqual(rackPanel(page), ['All 3 racks are linked to an area.']);
    assert.match(page.row('Rack 2').textContent, /B · Row 2, Rack 1/);
    // An area's own rack is its choice, not marked as taken.
    page.control('Rack 1', 'Edit Rack 1').click();
    assert.equal(page.formField('zoneLocation').value, 'l1');
    assert.equal(page.formField('zoneLocation').options[1].disabled, false);
});

test('a rack linked elsewhere meanwhile is refused with that reason, told apart from a name clash', async () => {
    const page = await openPage(racked(), { image: true, locations: RACKS, otherMaps: [SOUTH] });
    page.control('Rack 2', 'Edit Rack 2').click();
    page.formField('zoneLocation').value = 'l3';
    page.server.zone('Bay').location_id = 'l3';
    await page.submit();
    assert.equal(page.status(), 'Could not save: That rack is already linked to another area.');
    assert.equal(page.server.zone('Rack 2').location_id, null);
    assert.equal(page.formField('zoneLocation').value, 'l3', 'the choice is kept');
    assert.equal(page.formField('zoneLocation').options.at(-1).textContent, 'B · Row 2, Rack 1 (hold area): linked to Warehouse › Bay', 'and now shows who has it');
    assert.deepEqual(rackPanel(page), ['All 3 racks are linked to an area.']);
    page.formField('zoneLocation').value = '';
    page.server.fail = request => request.op === 'update' ? { code: '23505', message: 'duplicate key value violates unique constraint "site_map_zones_sibling_name"' } : null;
    await page.submit();
    assert.equal(page.status(), 'Could not save: Another active area inside T1 Pipe Racks is already named Rack 2.');
});

test('making an area active again when another area has its rack says so, and the rack list reloads', async () => {
    const page = await openPage([...rootsABC, { id: 'old', name: 'Old bay', sort_order: 40, is_active: false, location_id: 'l1' }, { id: 'new', name: 'New bay', sort_order: 50, location_id: 'l1' }],
        { locations: RACKS });
    const reads = () => page.server.log.filter(request => request.table === 'location_areas').length;
    const before = reads();
    page.control('Old bay', 'Make active: Old bay').click();
    await settle();
    assert.equal(page.$('pageMessage').textContent, 'Could not save: That rack is already linked to another area.');
    assert.equal(page.server.zone('Old bay').is_active, false);
    page.control('New bay', 'Make inactive: New bay').click();
    await settle();
    assert.equal(reads(), before + 2, 'racks reload after each switch');
    assert.deepEqual(rackPanel(page).slice(0, 1), ['3 of 3 racks are not linked to an area yet. Edit an area to choose its rack.']);
});

test('field crews see no rack panel; a rack list that fails to load says why to the office', async () => {
    const field = await openPage(rootsABC, { role: 'field_worker', locations: RACKS });
    assert.equal(field.$('rackStatus').hidden, true);
    const none = await openPage(rootsABC);
    assert.equal(none.$('rackStatus').hidden, true, 'nothing to show for a project without racks');
    const failed = await openPage(rootsABC, { locations: RACKS, fail: request => request.table === 'location_areas' ? { code: '08006', message: 'Connection lost' } : null });
    assert.equal(failed.$('rackStatus').querySelector('p').textContent, 'Racks could not be loaded: Connection lost');
    const missing = await openPage(rootsABC, { locations: RACKS, fail: request => request.table === 'location_areas' ? { code: 'PGRST205', message: 'Could not find the table' } : null });
    assert.equal(missing.$('rackStatus').querySelector('p').textContent, 'Rack links need migration 022 in this database.');
});

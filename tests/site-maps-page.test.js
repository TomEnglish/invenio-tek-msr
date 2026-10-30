// Runs site-maps.js against a small fake DOM and a fake Supabase, so the area list is tested by what it does.
// By default the map has no plan image; with { image: true } the plan opens in a fake Leaflet view, so drawing,
// Edit, "Add area inside…" and the area form run too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('../js/utils/inventory-helpers');

const source = fs.readFileSync('site-maps.js', 'utf8');
const MAP_ID = 'm1', PROJECT_ID = 'p1';

class FakeElement {
    constructor(document, tagName) {
        Object.assign(this, { ownerDocument: document, tagName: tagName.toUpperCase(), childNodes: [], parentNode: null, attributes: new Map(),
            dataset: {}, listeners: {}, hidden: false, disabled: false, className: '', ownText: '' });
        this.style = { setProperty: (name, value) => { this.style[name] = String(value); } };
        this.classList = { add: () => {}, remove: () => {} };
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get tabIndex() { return Number(this.getAttribute('tabindex') ?? (this.tagName === 'BUTTON' ? 0 : -1)); }
    set tabIndex(value) { this.setAttribute('tabindex', value); }
    get options() { return this.childNodes.filter(node => node.tagName === 'OPTION'); }
    // A select's value is its chosen option's; choosing a value no option has leaves it empty, as in a browser.
    get value() { return this.tagName === 'SELECT' ? this.selected ?? this.options[0]?.value ?? '' : this.ownValue ?? ''; }
    set value(value) {
        if (this.tagName === 'SELECT') this.selected = this.options.some(option => option.value === value) ? value : '';
        else this.ownValue = value;
    }
    get textContent() { return this.ownText + this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this.ownText = String(value ?? ''); }
    append(...nodes) {
        for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.childNodes.push(node); }
    }
    replaceChildren(...nodes) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = []; this.ownText = ''; this.selected = undefined; this.append(...nodes);
    }
    removeChild(node) { this.childNodes = this.childNodes.filter(child => child !== node); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) {
        if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-(\w)/g, (_, letter) => letter.toUpperCase())] ?? null;
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
    // Enough selector support for the page and tests: tag, [attr], [attr="value"] and .class.
    matches(selector) {
        const tag = /^[a-z][a-z0-9]*/.exec(selector)?.[0];
        return (!tag || this.tagName === tag.toUpperCase()) && [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]|\.([\w-]+)/g)].every(([, name, value, className]) =>
            className ? this.className.split(/\s+/).includes(className) : value === undefined ? this.getAttribute(name) !== null : this.getAttribute(name) === value);
    }
    closest(selector) { for (let node = this; node instanceof FakeElement; node = node.parentNode) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
        const found = [];
        const walk = node => node.childNodes.forEach(child => { if (child.matches(selector)) found.push(child); walk(child); });
        walk(this);
        return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, extra = {}) {
        const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
        for (let node = this; node; node = node.parentNode) (node.listeners[type] || []).forEach(listener => listener(event));
        return event;
    }
    focus() { this.ownerDocument.activeElement = this; this.dispatch('focusin'); }
    click() { if (this.disabled) return; this.focus(); this.onclick?.({ type: 'click', target: this }); }
}

/**
 * In-memory site_map_zones. Set `paused` to hold every request until step() lets the oldest one through.
 * Like 020's guard, a parent that would put an area inside itself is refused with 22023.
 */
function fakeServer(zones, { image = false } = {}) {
    const server = { zones: zones.map(zone => ({ map_id: MAP_ID, project_id: PROJECT_ID, parent_id: null, is_active: true, color: '#174fda',
        location_id: null, shape: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], ...zone })), log: [], paused: false, waiting: [], fail: null, inserted: 0 };
    const plan = image ? { storage_path: `${PROJECT_ID}/${MAP_ID}.png`, image_width: 1000, image_height: 1000 } : { storage_path: null };
    const insideItself = (id, parentId) => {
        for (let node = server.zones.find(zone => zone.id === parentId), steps = 0; node && steps < 50; node = server.zones.find(zone => zone.id === node.parent_id), steps++) {
            if (node.id === id) return true;
        }
        return false;
    };
    server.step = () => server.waiting.shift()();
    server.order = () => [...server.zones].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        if (request.table === 'site_maps') return { data: [{ id: MAP_ID, project_id: PROJECT_ID, name: 'Plan', is_active: true, ...plan }], error: null };
        if (request.table !== 'site_map_zones') return { data: [], error: null };
        if (request.op === 'insert') {
            server.zones.push({ id: `new${++server.inserted}`, project_id: PROJECT_ID, parent_id: null, is_active: true, ...structuredClone(request.values) });
            return { data: null, error: null };
        }
        const matching = server.zones.filter(zone => request.filters.every(([key, value]) => zone[key] === value));
        if (request.op === 'update') {
            if (matching.some(zone => request.values.parent_id && insideItself(zone.id, request.values.parent_id))) return { data: null, error: { code: '22023', message: 'An area cannot be placed inside itself' } };
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
        eq(key, value) { this.request.filters.push([key, value]); return this; }
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

// Lets pending requests, renders and the page's own zero-delay timers (the form's focus) run.
const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
};
// Compare by identity and name the element on failure (printing a fake DOM node would walk the whole page).
const describe = node => node ? `${node.tagName} ${node.getAttribute('aria-label') || node.id || node.textContent.slice(0, 40)}` : String(node);
const assertFocus = (page, expected, message) => assert.ok(page.document.activeElement === expected, `${message || 'focus'}: on ${describe(page.document.activeElement)}, expected ${describe(expected)}`);

async function openPage(zones, { role = 'admin', image = false } = {}) {
    const server = fakeServer(zones, { image });
    const leaflet = fakeLeaflet(), confirms = [];
    const elements = new Map();
    const document = {
        readyState: 'complete', listeners: {},
        createElement: tag => new FakeElement(document, tag),
        getElementById: id => { if (!elements.has(id)) { const node = new FakeElement(document, 'div'); node.id = id; document.body.append(node); elements.set(id, node); } return elements.get(id); },
        addEventListener() {},
    };
    document.body = new FakeElement(document, 'body');
    document.activeElement = document.body;
    class Option extends FakeElement {
        constructor(text = '', value = '') { super(document, 'option'); this.textContent = text; this.value = value; }
    }
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
    return { server, document, $, rows, names, row, control, leaflet, confirms, editor, formField, choose, submit, draw, status, outlineWarning };
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

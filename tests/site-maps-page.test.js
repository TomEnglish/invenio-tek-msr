// Runs site-maps.js against a small fake DOM and a fake Supabase, so the area list is tested by what it does.
// The map has no plan image, so Leaflet is never needed.
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
    get textContent() { return this.ownText + this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this.ownText = String(value ?? ''); }
    append(...nodes) {
        for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.childNodes.push(node); }
    }
    replaceChildren(...nodes) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = []; this.ownText = ''; this.append(...nodes);
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
    // Enough selector support for the page: [attr], [attr="value"] and .class.
    matches(selector) {
        return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]|\.([\w-]+)/g)].every(([, name, value, className]) =>
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

/** In-memory site_map_zones. Set `paused` to hold every request until step() lets the oldest one through. */
function fakeServer(zones) {
    const server = { zones: zones.map(zone => ({ map_id: MAP_ID, project_id: PROJECT_ID, parent_id: null, is_active: true, color: '#174fda',
        location_id: null, shape: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], ...zone })), log: [], paused: false, waiting: [], fail: null };
    server.step = () => server.waiting.shift()();
    server.order = () => [...server.zones].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        if (request.table === 'site_maps') return { data: [{ id: MAP_ID, project_id: PROJECT_ID, name: 'Plan', is_active: true, storage_path: null }], error: null };
        if (request.table !== 'site_map_zones') return { data: [], error: null };
        const matching = server.zones.filter(zone => request.filters.every(([key, value]) => zone[key] === value));
        if (request.op === 'update') { matching.forEach(zone => Object.assign(zone, request.values)); return { data: null, error: null }; }
        return { data: server.order().filter(zone => matching.includes(zone)).map(zone => structuredClone(zone)), error: null };
    }
    class Query {
        constructor(table) { this.request = { table, op: 'select', filters: [] }; }
        select() { return this; }
        order() { return this; }
        range() { return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        update(values) { Object.assign(this.request, { op: 'update', values }); return this; }
        then(resolve, reject) { return respond(this.request).then(resolve, reject); }
    }
    server.client = { from: table => new Query(table) };
    server.updates = () => server.log.filter(request => request.op === 'update');
    return server;
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

async function openPage(zones, { role = 'admin' } = {}) {
    const server = fakeServer(zones);
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
        history: { replaceState() {} }, location: { search: '' }, confirm: () => true, addEventListener() {},
        InvenioAuthReady: Promise.resolve(true), InvenioInventory: inventory,
        InvenioSiteMapView: { signedPlanUrl: async () => { throw new Error('no image in this fixture'); } },
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
    return { server, document, $, rows, names, row, control };
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
    assert.equal(page.document.activeElement, page.row('A'), 'a control that is now disabled hands focus to its row');
    // Keys on a focused row.
    const key = name => page.document.activeElement.dispatch('keydown', { key: name });
    key('Home');
    assert.equal(page.document.activeElement, page.row('B'));
    key('ArrowDown'); key('ArrowDown');
    assert.equal(page.document.activeElement, page.row('A'));
    key('ArrowRight');
    assert.deepEqual(page.names(), ['B', 'C', 'A', 'A1'], 'right opens a closed area');
    assert.equal(page.document.activeElement, page.row('A'));
    key('ArrowRight');
    assert.equal(page.document.activeElement, page.row('A1'), 'right again steps into it');
    key('ArrowLeft');
    assert.equal(page.document.activeElement, page.row('A'), 'left from a leaf steps out to its parent');
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

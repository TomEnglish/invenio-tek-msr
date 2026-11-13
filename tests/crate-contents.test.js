// The shared "what is inside a crate" view (js/utils/crate-contents.js), on its own: links, wording, the order and
// scope of each level's reads, and what it does when a read is slow, fails or is overtaken. The Crates and Loads page
// tests cover it in place.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const contents = require('../js/utils/crate-contents');
const logistics = require('../js/utils/logistics-helpers');
const { fakeDocument, settle } = require('./support/fake-dom');

const unit = (id, code, extra = {}) => ({ id, code, kind: 'crate', description: null, is_high_value: false, status: 'sealed', parent_id: null, item_count: 0, unit_count: 0, ...extra });
const item = (unitId, tag, extra = {}) => ({ id: `${unitId}-${tag}`, unit_id: unitId, tag, name: `Item ${tag}`, quantity: 1, uom: 'EA', material_id: null, inventory_uid: null,
    packed_at: '2026-11-10T15:00:00Z', ...extra });

/** handling_unit_overview and handling_unit_items rows; `hold` keeps every read waiting until `release()`. */
function fakeClient(units, items) {
    const client = { log: [], held: [], hold: false, fail: null };
    class Query {
        constructor(table) { this.request = { table, filters: [], from: 0, to: 999 }; }
        select(columns) { this.request.columns = columns; return this; }
        order(column) { this.request.order = column; return this; }
        range(from, to) { Object.assign(this.request, { from, to }); return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        async then(resolve, reject) {
            client.log.push(this.request);
            if (client.hold) await new Promise(go => client.held.push(go));
            const failure = client.fail?.(this.request);
            if (failure) return Promise.resolve({ data: null, error: failure }).then(resolve, reject);
            const rows = { handling_unit_overview: units, handling_unit_items: items }[this.request.table];
            const data = rows.filter(row => this.request.filters.every(([key, value]) => row[key] === value)).slice(this.request.from, this.request.to + 1);
            return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve, reject);
        }
    }
    client.from = table => new Query(table);
    client.release = () => { while (client.held.length) client.held.shift()(); };
    return client;
}

function mount(units, items, options = {}) {
    const { document } = fakeDocument();
    const client = fakeClient(units, items), state = contents.newState(), opened = [];
    const view = contents.view({ document, client, state, logistics, openCrate: options.links ? null : unit => opened.push(unit.code) });
    const box = document.createElement('div');
    document.body.append(box);
    view.render(box, 'top');
    const toggle = code => box.querySelectorAll('button').find(node => node.className.split(/\s+/).includes('crate-tree-toggle') && node.textContent === code);
    const tags = () => box.querySelectorAll('table').map(table => table.querySelector('tbody').childNodes.map(row => row.childNodes[0].textContent));
    return { document, client, state, view, box, toggle, tags, opened };
}

test('an item links to its material record when received, to Initial Inventory when only counted, and to nothing otherwise', () => {
    assert.equal(contents.itemHref({ material_id: 'm 1/2', inventory_uid: 'u-1' }), 'record.html?type=materials&id=m%201%2F2', 'received wins, and the id is escaped');
    assert.equal(contents.itemHref({ material_id: null, inventory_uid: 'u-1' }), 'initial-inventory.html?item=u-1');
    assert.equal(contents.itemHref({ material_id: null, inventory_uid: null }), null);
    assert.equal(contents.crateHref('a&b'), 'handling-units.html?unit=a%26b');
});

test('quantities read as US numbers with their unit, and a missing quantity is just the unit', () => {
    assert.equal(contents.quantityText({ quantity: 1250.5, uom: 'FT' }), '1,250.5 FT');
    assert.equal(contents.quantityText({ quantity: '0.3333333', uom: 'M' }), '0.333 M');
    assert.equal(contents.quantityText({ quantity: null, uom: 'EA' }), 'EA');
    assert.equal(contents.quantityText({ quantity: 2, uom: null }), '2');
});

test('one level is read at a time, in two scoped reads, sorted with numbers by value', async () => {
    const units = [unit('c10', 'HU-C10', { parent_id: 'top' }), unit('c2', 'HU-C2', { parent_id: 'top', kind: 'container', description: 'Valve trim', item_count: 1 }),
        unit('elsewhere', 'HU-ELSE', { parent_id: 'other' })];
    const items = [item('top', 'T-10'), item('top', 'T-2', { material_id: 'm-2' }), item('c2', 'V-1', { inventory_uid: 'u-1' })];
    const page = mount(units, items);
    assert.match(page.box.textContent, /Loading what is inside…/);
    await settle();
    assert.deepEqual(page.client.log.map(request => [request.table, request.filters, request.columns]), [
        ['handling_unit_overview', [['parent_id', 'top']], contents.UNIT_COLUMNS], ['handling_unit_items', [['unit_id', 'top']], contents.ITEM_COLUMNS]]);
    assert.deepEqual(page.box.querySelectorAll('li').map(row => row.querySelector('.mono')?.textContent ?? row.textContent.slice(0, 7)), ['HU-C2', 'HU-C10']);
    assert.deepEqual(page.tags(), [['T-2', 'T-10']]);
    assert.ok(page.box.textContent.includes('Container · Valve trim · 1 item'), 'a container says so, with what it holds');
    // HU-C10 holds nothing, so it can't be opened out: its code is plain text.
    assert.equal(page.toggle('HU-C10'), undefined);
    page.toggle('HU-C2').click();
    assert.match(page.box.textContent, /Loading what is inside…/);
    await settle();
    assert.deepEqual(page.client.log.slice(2).map(request => request.filters), [[['parent_id', 'c2']], [['unit_id', 'c2']]]);
    assert.deepEqual(page.tags(), [['V-1'], ['T-2', 'T-10']]);
    assert.deepEqual(page.state.open, new Set(['c2']));
    page.box.querySelectorAll('button').find(node => node.getAttribute('aria-label') === 'Open HU-C2').click();
    assert.deepEqual(page.opened, ['HU-C2']);
});

test('without an Open handler each crate inside links to the Crates page', async () => {
    const page = mount([unit('c1', 'HU-C1', { parent_id: 'top', item_count: 2 })], [], { links: true });
    await settle();
    const link = page.box.querySelector('a');
    assert.equal(link.href, 'handling-units.html?unit=c1');
    assert.equal(link.getAttribute('aria-label'), 'Open HU-C1 on the Crates page');
});

test('a level read after the page cleared what it had read is dropped; the new read fills in', async () => {
    const page = mount([], [item('top', 'OLD-1')]);
    page.client.hold = true;
    await settle();
    page.client.release();
    await settle();
    assert.deepEqual(page.tags(), [['OLD-1']]);
    page.client.hold = true;
    page.state.levels.clear();
    page.view.render(page.box, 'top');
    page.state.levels.clear();
    page.view.render(page.box, 'top');
    await settle();
    page.client.release();
    await settle();
    assert.deepEqual(page.tags(), [['OLD-1']]);
    assert.equal(page.box.querySelectorAll('table').length, 1, 'shown once, by the read still wanted');
});

test('a failed level says why and Try again reads it again', async () => {
    const page = mount([], [item('top', 'T-1')]);
    page.state.levels.clear();
    page.client.fail = () => ({ code: '42501', message: 'permission denied for view handling_unit_items' });
    page.view.render(page.box, 'top');
    await settle();
    assert.equal(page.box.textContent, 'What is inside could not be loaded (You do not have permission to make this change.).Try again');
    page.client.fail = null;
    page.box.querySelector('button').click();
    await settle();
    assert.deepEqual(page.tags(), [['T-1']]);
});

test('markup in codes, names and tags stays text, and a loop in the data stops at the depth limit', async () => {
    const deep = Array.from({ length: contents.MAX_DEPTH + 2 }, (_, n) => unit(`d${n}`, `HU-D${n}`, { parent_id: n ? `d${n - 1}` : 'top', unit_count: 1 }));
    const page = mount(deep, [item('top', '<b>T</b>', { name: '<img src=x onerror=alert(1)>' })]);
    await settle();
    assert.deepEqual(page.tags(), [['<b>T</b>']]);
    assert.equal(page.box.querySelector('tbody').childNodes[0].childNodes[1].textContent, '<img src=x onerror=alert(1)>');
    for (let n = 0; n < contents.MAX_DEPTH; n++) { page.toggle(`HU-D${n}`).click(); await settle(); }
    assert.equal(page.toggle(`HU-D${contents.MAX_DEPTH}`), undefined, 'the level past the limit lists its crate but opens no further');
    assert.ok(page.box.textContent.includes(`HU-D${contents.MAX_DEPTH}`));
    assert.doesNotMatch(fs.readFileSync('js/utils/crate-contents.js', 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'never parses strings as HTML');
});

test('both crate pages load the shared view before their own script, and a counted item opens from its link', () => {
    for (const [file, script] of [['handling-units.html', 'handling-units.js'], ['loads.html', 'loads.js']]) {
        const html = fs.readFileSync(file, 'utf8');
        for (const helper of ['js/utils/logistics-helpers.js', 'js/utils/crate-contents.js']) {
            assert.match(html, new RegExp(`src="${helper.replaceAll('.', '\\.')}\\?v=`), `${file} loads ${helper}`);
            assert.ok(html.indexOf(helper) < html.indexOf(`src="${script}`), `${file}: ${helper} loads before ${script}`);
        }
    }
    const js = fs.readFileSync('initial-inventory.js', 'utf8');
    assert.match(js, /new URLSearchParams\(location\.search\)\.get\('item'\)/);
    assert.match(js, /records\.find\(row => row\.uid === linked\)/);
});

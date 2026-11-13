// Runs the Yard Inventory page's own script (inventory.html) with the photo viewer, against the fake DOM and a
// fake Supabase: each item's photos from its count and its receipt, the Photos column, and its button.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { FakeElement, fakeDocument, settle } = require('./support/fake-dom');

const viewer = fs.readFileSync('js/utils/photo-viewer.js', 'utf8');
const page = [...fs.readFileSync('inventory.html', 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const plain = value => JSON.parse(JSON.stringify(value));
FakeElement.prototype.appendChild ||= function (node) { this.append(node); return node; };

async function openInventory(tables, { failing = [] } = {}) {
    const { document } = fakeDocument();
    let ready;
    document.addEventListener = (type, listener) => { if (type === 'DOMContentLoaded') ready = listener; };
    document.querySelectorAll = selector => document.body.querySelectorAll(selector);
    // No unit is chosen: every item shows.
    document.querySelector = selector => selector === 'input[name="unitFilter"]:checked' ? { value: '' } : document.body.querySelector(selector);
    // The item checklist writes one checkbox as markup and then finds it by its ID.
    const create = document.createElement;
    document.createElement = tag => {
        const node = create(tag);
        let markup = '';
        // Markup that was set reads back as set; otherwise it is the text, escaped, as the page's escapeHtml expects.
        Object.defineProperty(node, 'innerHTML', { get: () => markup || node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), set(value) {
            markup = value;
            node.replaceChildren();
            for (const [, id] of String(value).matchAll(/id="([^"]+)"/g)) { const child = create('input'); child.id = id; node.append(child); }
        } });
        return node;
    };
    const queries = [];
    class Query {
        constructor(table) { this.request = { table, calls: [] }; queries.push(this.request); }
        then(resolve, reject) {
            if (failing.includes(this.request.table)) return Promise.resolve({ data: null, error: { message: 'Fixture failure' } }).then(resolve, reject);
            let rows = (tables[this.request.table] || []).map(row => ({ ...row }));
            for (const [name, key, value] of this.request.calls) if (name === 'in') rows = rows.filter(row => value.map(String).includes(String(row[key])));
            const range = this.request.calls.find(([name]) => name === 'range');
            if (range) rows = rows.slice(range[1], range[2] + 1);
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
    }
    for (const name of ['select', 'order', 'range', 'eq', 'in']) Query.prototype[name] = function (...args) { this.request.calls.push([name, ...args]); return this; };
    const storage = { from: bucket => ({ createSignedUrl: async path => ({ data: { signedUrl: `https://files.test/${bucket}/${path}` }, error: null }) }) };
    const client = { from: table => new Query(table), storage };
    const context = { document, console: { log() {}, error() {}, warn() {} }, InvenioAuthReady: Promise.resolve(true), supabaseClient: client, projectSupabaseClient: client,
        InvenioProjectScope: { getActiveProjectId: () => 'project-1' } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(viewer, context);
    vm.runInContext(page, context);
    await ready();
    await settle();
    const tbody = document.getElementById('inventoryTableBody');
    return { document, context, queries, tbody, query: table => queries.filter(request => request.table === table) };
}

const records = [
    { id: 1, uid: 'u1', qr_code: 'GT2-LO-001', inventory_item: 'Lube oil cooler', unit: 'Gas Turbine 2', location: 'T1 Pipe Racks', status: 'Counted', receiving_record_id: 'r9' },
    { id: 2, uid: 'u2', qr_code: 'GT2-LO-002', inventory_item: 'Lube oil filter', unit: 'Gas Turbine 2', location: null, status: 'Expected', receiving_record_id: null },
];
const photos = {
    inventory_photos: [{ inventory_uid: 'u1', storage_path: 'u1/op-1.jpg', created_at: '2026-10-26T15:00:00Z' }],
    inspection_photos: [{ receiving_record_id: 'r9', storage_path: 'r9/op-0-damage.jpg', photo_type: 'damage', created_at: '2026-10-27T09:00:00Z' }],
};

test('each item shows how many photos it has, from its count and its receipt; requests grow with the items, not the project\'s photos', async () => {
    const inventory = await openInventory({ inventory_records: records, ...photos });
    const rows = inventory.tbody.innerHTML.split('</tr>').filter(row => row.includes('<tr>'));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /<td><button type="button" class="photo-chip" data-photo-index="0" aria-label="Open 2 photos">/);
    assert.match(rows[1], /<td><span class="text-muted">-<\/span><\/td>$/, 'no button without photos');
    // However many items: pages of every photo in the project, until a page comes back empty.
    const counts = inventory.query('inventory_photos');
    assert.deepEqual(counts.map(request => plain(request.calls.find(([name]) => name === 'range').slice(1))), [[0, 999], [1, 1000]]);
    const receipts = inventory.query('inspection_photos');
    assert.equal(receipts.length, 1);
    assert.deepEqual(plain(receipts[0].calls.find(([name]) => name === 'in')), ['in', 'receiving_record_id', ['r9']], 'receiving photos only for the items listed that were received');
});

test('the button opens that item\'s photos, oldest first', async () => {
    const inventory = await openInventory({ inventory_records: records, ...photos });
    const chip = inventory.document.createElement('button');
    chip.dataset.photoIndex = '0';
    inventory.document.body.append(chip);
    inventory.tbody.listeners.click[0]({ target: chip });
    await settle();
    const viewer = inventory.document.body.querySelector('.photo-viewer');
    assert.ok(viewer);
    assert.match(viewer.querySelector('.photo-viewer-caption').textContent, /^Count photo · Oct 26, 2026, .* · 1 of 2$/);
    assert.equal(viewer.querySelector('.photo-viewer-image').src, 'https://files.test/inventory-photos/u1/op-1.jpg');
    // A click elsewhere in the table opens nothing.
    inventory.context.InvenioPhotos.close();
    inventory.tbody.listeners.click[0]({ target: inventory.document.createElement('td') });
    assert.equal(inventory.document.body.querySelector('.photo-viewer'), null);
});

test('photos that cannot be loaded leave the items listed and say so', async () => {
    const inventory = await openInventory({ inventory_records: records, ...photos }, { failing: ['inventory_photos'] });
    assert.match(inventory.tbody.innerHTML, /Lube oil cooler/);
    assert.equal(inventory.tbody.innerHTML.match(/<td class="text-muted">Unavailable<\/td>/g).length, 2);
});

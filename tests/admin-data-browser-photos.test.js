// Runs admin.js (the Data Browser) with the photo viewer against the fake DOM and a fake Supabase that records
// each query: the newer tables, license details kept out, each row's photos, and the record's link and photos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { FakeElement, fakeDocument, settle } = require('./support/fake-dom');

const viewer = fs.readFileSync('js/utils/photo-viewer.js', 'utf8');
const source = fs.readFileSync('admin.js', 'utf8');
const PROJECT = 'b1111111-1111-4111-8111-111111111111';
const plain = value => JSON.parse(JSON.stringify(value));
// The table list is built with appendChild and prepend, which the fake DOM leaves out.
FakeElement.prototype.appendChild ||= function (node) { this.append(node); return node; };
FakeElement.prototype.prepend ||= function (node) { this.append(node); this.childNodes.unshift(this.childNodes.pop()); };

function openBrowser(tables = {}) {
    const { document } = fakeDocument();
    const queries = [], made = [], downloads = [];
    class Query {
        constructor(table) { this.request = { table, calls: [] }; queries.push(this.request); }
        then(resolve, reject) {
            let rows = (tables[this.request.table] || []).map(row => ({ ...row }));
            for (const [name, key, value] of this.request.calls) if (name === 'in') rows = rows.filter(row => value.map(String).includes(String(row[key])));
            return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
        }
    }
    for (const name of ['select', 'order', 'or', 'range', 'eq', 'neq', 'in']) Query.prototype[name] = function (...args) { this.request.calls.push([name, ...args]); return this; };
    const storage = { from: bucket => ({
        createSignedUrl: async path => ({ data: { signedUrl: `https://files.test/${bucket}/${path}` }, error: null }),
        createSignedUrls: async paths => ({ data: paths.map(path => ({ path, error: null, signedUrl: `https://files.test/${bucket}/${path}` })), error: null }),
    }) };
    const createElement = document.createElement;
    document.createElement = tag => { const node = createElement(tag); made.push(node); return node; };
    const client = { from: table => new Query(table), storage };
    const context = { document, console: { ...console, warn() {} }, Promise, crypto: globalThis.crypto,
        bootstrap: { Modal: class { show() {} hide() {} } }, InvenioProjectScope: { getActiveProjectId: () => PROJECT },
        supabaseClient: client, projectSupabaseClient: client,
        Blob: class { constructor(parts) { this.text = parts.join(''); } },
        URL: { createObjectURL: blob => { downloads.push(blob.text); return 'blob:export'; }, revokeObjectURL() {} } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(viewer, context);
    vm.runInContext(source, context);
    const run = code => vm.runInContext(code, context);
    const open = async table => { run(`state.currentTable = ${JSON.stringify(table)}; state.page = 0; loadData();`); await settle(); };
    const html = id => document.getElementById(id).innerHTML;
    return { document, context, queries, made, downloads, run, open, html, query: table => queries.filter(request => request.table === table).at(-1) };
}

const NEW_TABLES = ['inspection_photos', 'inventory_photos', 'inventory_records', 'inventory_categories', 'site_maps', 'site_map_zones', 'places',
    'handling_unit_overview', 'handling_unit_items', 'load_overview', 'load_stop_overview', 'load_line_overview', 'load_companies', 'samsara_trackers'];

test('the table list offers the newer data, read-only, grouped in order, and no license table or column', () => {
    const page = openBrowser();
    const config = page.run('TABLE_CONFIG');
    for (const table of NEW_TABLES) {
        assert.ok(config[table], `${table} is offered`);
        assert.equal(config[table].canInsert, false, `${table}: nothing is added here`);
        assert.equal(config[table].canDelete, false, `${table}: nothing is deleted here`);
        assert.ok(config[table].columns.every(column => !column.editable), `${table}: nothing is changed here`);
    }
    assert.deepEqual(Object.keys(config).filter(table => /licen[cs]e|holds/.test(table)), []);
    const licenseColumns = Object.entries(config).flatMap(([table, settings]) =>
        [...settings.columns.map(column => `${column.key} ${column.label}`), settings.select || ''].filter(text => /licen[cs]e/i.test(text)).map(text => `${table}: ${text}`));
    assert.deepEqual(licenseColumns, []);
    page.run('buildTableSelector()');
    const groups = page.document.getElementById('tableSelect').childNodes.filter(node => node.tagName === 'OPTGROUP');
    assert.deepEqual(groups.map(group => group.label), ['Inventory', 'Photos', 'Initial Count', 'Logistics', 'Tracking', 'Procurement', 'Reference']);
    assert.deepEqual(groups[1].childNodes.map(option => option.textContent), ['Receiving Photos', 'Count Photos']);
    assert.deepEqual(groups[3].childNodes.map(option => option.textContent), ['Places', 'Crates', 'Crate Contents', 'Loads', 'Load Stops', 'Load Manifest', 'Load Companies']);
});

test('loads are asked for by named columns, so license details are neither fetched, shown nor exported', async () => {
    const page = openBrowser({ load_overview: [{ id: 'l1', load_number: 'L-0001', status: 'in_transit', driver_name: 'Pat Example', licence_override_reason: 'should never appear' }] });
    await page.open('load_overview');
    const select = page.query('load_overview').calls.find(([name]) => name === 'select')[1];
    assert.match(select, /^id,load_number,status,/);
    assert.doesNotMatch(select, /licen|\*/);
    assert.match(page.html('tableBody'), /L-0001/);
    assert.match(page.html('tableBody'), /in transit/);
    page.run('exportCSV()');
    assert.doesNotMatch(page.downloads.at(-1), /licen|should never appear/i);
    assert.equal(page.made.find(node => node.tagName === 'A').download, 'load_overview_export.csv');
});

test('receiving records show how many photos each has; the button opens them, and the rest of the row opens the record', async () => {
    const page = openBrowser({
        receiving_records: [{ id: 'r1', material_type: 'Steel Pipe', status: 'accepted' }, { id: 'r2', material_type: 'Valve', status: 'pending' }],
        inspection_photos: [
            { receiving_record_id: 'r1', storage_path: 'r1/op-1-damage.jpg', photo_type: 'damage', created_at: '2026-09-08T12:00:00Z' },
            { receiving_record_id: 'r1', storage_path: 'r1/op-2-general.jpg', photo_type: 'general', created_at: '2026-09-08T12:01:00Z' },
        ],
    });
    await page.open('receiving_records');
    assert.match(page.html('tableHead'), /<th>Photos<\/th><\/tr>$/);
    const body = page.html('tableBody');
    assert.match(body, /<tr onclick="rowClicked\(event, 0\)">.*data-photo-index="0" aria-label="Open 2 photos"/s);
    assert.doesNotMatch(body, /data-photo-index="1"/, 'no button without photos');
    assert.deepEqual(plain(page.query('inspection_photos').calls.find(([name]) => name === 'in')), ['in', 'receiving_record_id', ['r1', 'r2']]);

    const chip = page.document.createElement('button');
    chip.dataset.photoIndex = '0';
    page.document.body.append(chip);
    page.context.rowClicked({ target: chip }, 0);
    await settle();
    const viewer = page.document.body.querySelector('.photo-viewer');
    assert.ok(viewer, 'the button opens the photos');
    assert.match(viewer.querySelector('.photo-viewer-caption').textContent, /^Receiving photo: Damage · .* · 1 of 2$/);
    assert.equal(page.run('state.editRecord'), null, 'and not the record');
    page.context.InvenioPhotos.close();

    page.context.rowClicked({ target: page.document.createElement('td') }, 0);
    await settle();
    assert.equal(page.run('state.editRecord.id'), 'r1');
    assert.match(page.html('editModalBody'), /<a class="btn btn-outline-primary btn-sm" href="record\.html\?type=receiving_records&amp;id=r1">/);
    const strip = page.document.getElementById('recordPhotoStrip');
    assert.deepEqual(strip.querySelectorAll('button').map(button => button.getAttribute('aria-label')),
        ['Open photo 1 of 2: Receiving photo: Damage', 'Open photo 2 of 2: Receiving photo: General']);
    assert.equal(strip.querySelectorAll('img')[1].src, 'https://files.test/inspection-photos/r1/op-2-general.jpg');
});

test('count records name their category, with photos from the count and from receiving', async () => {
    const page = openBrowser({
        inventory_records: [
            { id: 1, uid: 'u1', qr_code: 'GT2-LO-001', inventory_item: 'Lube oil cooler', category_id: 'c3', receiving_record_id: 'r9', count_status: 'received' },
            { id: 2, uid: 'u2', qr_code: 'GT2-LO-002', inventory_item: 'Lube oil filter', category_id: null, count_status: 'expected' },
        ],
        inventory_categories: [{ id: 'c3', name: '<b>Cooler</b>' }],
        inventory_photos: [{ inventory_uid: 'u1', storage_path: 'u1/op-1.jpg', created_at: '2026-10-26T15:00:00Z' }],
        inspection_photos: [{ receiving_record_id: 'r9', storage_path: 'r9/op-0-general.jpg', photo_type: 'general', created_at: '2026-10-27T09:00:00Z' }],
    });
    await page.open('inventory_records');
    assert.deepEqual(plain(page.query('inventory_categories').calls.find(([name]) => name === 'in')), ['in', 'id', ['c3']], 'only the categories shown');
    const body = page.html('tableBody');
    assert.match(body, /<td>&lt;b&gt;Cooler&lt;\/b&gt;<\/td>/, 'a looked-up name is text');
    assert.match(body, /data-photo-index="0" aria-label="Open 2 photos"/);
    assert.match(page.html('tableHead'), /<th>Category<\/th>/, 'a looked-up column is not sorted by the server');
    assert.deepEqual(plain(page.run('state.photos.map(list => list.map(photo => photo.label))')), [['Count photo', 'Receiving photo: General'], []]);
    page.run('exportCSV()');
    assert.match(page.downloads.at(-1), /"<b>Cooler<\/b>"/, 'the export has the name, not the ID');
});

test('receiving photos are asked for through their receipts in the active project, and page through every photo shown', async () => {
    const page = openBrowser({
        receiving_records: [{ id: 'r1', material_type: 'Steel Pipe', po_number: 'PO-100' }, { id: 'r2', material_type: 'Valve', po_number: '4500012345' }],
        inspection_photos: [
            { id: 'ip2', receiving_record_id: 'r2', storage_path: 'r2/op-1-general.jpg', photo_type: 'general', created_at: '2026-09-09T08:00:00Z' },
            { id: 'ip1', receiving_record_id: 'r1', storage_path: 'r1/op-1-damage.jpg', photo_type: 'damage', created_at: '2026-09-08T12:00:00Z' },
        ],
    });
    await page.open('inspection_photos');
    const request = page.query('inspection_photos');
    assert.equal(request.calls.find(([name]) => name === 'select')[1], '*,receiving_records!inner(project_id)');
    assert.deepEqual(plain(request.calls.find(([name, key]) => name === 'eq' && key === 'receiving_records.project_id')), ['eq', 'receiving_records.project_id', PROJECT]);
    const body = page.html('tableBody');
    assert.match(body, /<td>Valve · PO 4500012345<\/td>/);
    assert.match(body, /<td>Steel Pipe · PO-100<\/td>/);
    const chip = page.document.createElement('button');
    chip.dataset.photoIndex = '1';
    page.document.body.append(chip);
    page.context.rowClicked({ target: chip }, 1);
    await settle();
    assert.match(page.document.body.querySelector('.photo-viewer-caption').textContent, /^Receiving photo: Damage · .* · 2 of 2$/, 'starts at its own photo, among all on the page');
    page.context.InvenioPhotos.close();
    page.context.rowClicked({ target: page.document.createElement('td') }, 1);
    await settle();
    assert.match(page.html('editModalBody'), /href="record\.html\?type=receiving_records&amp;id=r1"/, 'opens the receipt it belongs to');
    assert.equal(page.document.getElementById('recordPhotoStrip').querySelectorAll('button').length, 1, 'the record shows its own photo');
});

test('GPS trackers leave the supplier\'s link out and export under a plain name', async () => {
    const page = openBrowser({ samsara_trackers: [{ id: 'gps-1', name: 'Yard A', last_latitude: 29.735512, last_longitude: -94.977412 }] });
    await page.open('samsara_trackers');
    const select = page.query('samsara_trackers').calls.find(([name]) => name === 'select')[1];
    assert.doesNotMatch(select, /share_link|\*/);
    assert.match(page.html('tableBody'), /29\.735512.*-94\.977412/s, 'coordinates in full');
    page.run('exportCSV()');
    assert.equal(page.made.find(node => node.tagName === 'A').download, 'gps_trackers_export.csv');
});

test('a table replaced before it loads is not shown, and values are escaped in cells and form fields', async () => {
    const page = openBrowser({
        receiving_records: [{ id: 'r1', material_type: 'Steel Pipe' }],
        load_overview: [{ id: 'l1', load_number: 'L-0001', status: 'planning' }],
        materials: [{ id: 'm1', material_type: '"><script>alert(1)</script>', status: '<b>odd</b>' }],
    });
    page.run('state.currentTable = "receiving_records"; loadData(); state.currentTable = "load_overview"; loadData();');
    await settle();
    assert.match(page.html('tableTitle'), /Loads$/);
    assert.equal(page.run('state.data.length && state.data[0].load_number'), 'L-0001');
    await page.open('materials');
    assert.match(page.html('tableBody'), /&lt;b&gt;odd&lt;\/b&gt;/);
    page.context.rowClicked({ target: page.document.createElement('td') }, 0);
    await settle();
    assert.match(page.html('editModalBody'), /value="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
});

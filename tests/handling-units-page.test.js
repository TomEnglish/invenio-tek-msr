// Runs handling-units.js against the fake DOM and fake crate views, read through the real project-scoped client,
// with a fake print window and QR library, so the Crates page is tested by what it does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const logistics = require('../js/utils/logistics-helpers');
const { createProjectScopedClient } = require('../js/utils/project-scope');
const { fakeDocument, settle, assertFocus } = require('./support/fake-dom');

const source = fs.readFileSync('handling-units.js', 'utf8');
const PROJECT_ID = 'p1';
// Objects made inside the page's vm context aren't deepEqual to this file's; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

const unit = (code, extra = {}) => ({ id: code.toLowerCase(), project_id: PROJECT_ID, code, kind: 'crate', description: null, is_high_value: false, status: 'open',
    parent_id: null, parent_code: null, top_unit_id: code.toLowerCase(), top_code: code, place_name: null, location: null, item_count: 0, unit_count: 0,
    sealed_at: null, created_at: '2026-10-28T14:00:00Z', ...extra });
const nestedIn = { top_unit_id: 'hu-aaaa11', top_code: 'HU-AAAA11', place_name: 'North Yard laydown', location: 'T1 Pipe Racks › Rack 2' };
const UNITS = [
    unit('HU-AAAA11', { ...nestedIn, description: 'Lube oil spares', status: 'sealed', item_count: 2, unit_count: 1, sealed_at: '2026-10-28T16:00:00Z' }),
    unit('HU-BBBB22', { ...nestedIn, kind: 'basket', parent_id: 'hu-aaaa11', parent_code: 'HU-AAAA11', item_count: 1, unit_count: 1 }),
    unit('HU-CCCC33', { ...nestedIn, parent_id: 'hu-bbbb22', parent_code: 'HU-BBBB22', item_count: 1 }),
    unit('HU-DDDD44', { kind: 'skid', description: 'Turbine instruments', is_high_value: true, status: 'on_load', place_name: 'North Yard laydown', item_count: 1 }),
    unit('HU-FFFF66', { status: 'unpacked' }),
    unit('HU-GGGG77', { description: '<img src=x onerror=alert(1)> crate', item_count: 1 }),
    unit('HU-ZZZZ99', { project_id: 'p2', description: 'Another project' }),
];
const item = (unitCode, tag, name, quantity = 1, uom = 'EA') => ({ id: `${unitCode}-${tag}`, project_id: PROJECT_ID, unit_id: unitCode.toLowerCase(), tag, name, quantity, uom, packed_at: '2026-10-28T15:00:00Z' });
const ITEMS = [item('HU-AAAA11', 'GT2-LO-010', 'Lube oil cooler'), item('HU-AAAA11', 'GT2-LO-002', 'Cable drum 240 m', 3), item('HU-BBBB22', 'GT2-LO-003', 'Lube oil pump'),
    item('HU-CCCC33', 'GT2-FS-011', 'Fuel filter set', 4), item('HU-GGGG77', 'X-<i>1</i>', '<img src=x onerror=alert(1)>', 1.5, 'M')];

/** The two crate views and the label RPC. Set `paused` to hold every request until step() lets the oldest one through. */
function fakeServer(units = UNITS) {
    const server = { units: structuredClone(units), items: structuredClone(ITEMS), log: [], paused: false, waiting: [], fail: null, reserved: 0 };
    server.step = () => server.waiting.shift()();
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        if (request.rpc === 'reserve_handling_unit_labels') {
            const codes = Array.from({ length: request.args.p_count }, () => ({ code: `HU-T${String(++server.reserved).padStart(5, '0')}` }));
            return { data: codes, error: null };
        }
        const rows = { handling_unit_overview: server.units, handling_unit_items: server.items }[request.table] || [];
        const matching = rows.filter(row => request.filters.every(([key, value]) => row[key] === value));
        return { data: matching.slice(request.from, request.to + 1).map(row => structuredClone(row)), error: null };
    }
    class Query {
        constructor(table) { this.request = { table, filters: [], from: 0, to: 999 }; }
        select(columns) { this.request.columns = columns; return this; }
        order() { return this; }
        range(from, to) { Object.assign(this.request, { from, to }); return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        then(resolve, reject) { return respond(this.request).then(resolve, reject); }
    }
    server.client = { from: table => new Query(table), rpc: (rpc, args) => respond({ rpc, args }) };
    server.reads = table => server.log.filter(request => request.table === table);
    server.rpcs = () => server.log.filter(request => request.rpc);
    return server;
}

/** qrcode-generator's shape: a code is "made", then answers getModuleCount and isDark. Records what it was asked. */
function fakeQrLibrary(calls) {
    return (typeNumber, level) => {
        const qr = { data: '', addData(text) { this.data = text; }, make() { calls.push({ typeNumber, level, data: this.data }); },
            getModuleCount: () => 21, isDark: (row, column) => (row + column) % 3 === 0 };
        return qr;
    };
}

async function openPage({ role = 'admin', projectStatus = 'active', units } = {}) {
    const server = fakeServer(units), qrCalls = [], opened = [];
    const { document, Option } = fakeDocument();
    const context = {
        document, Option, console, setTimeout, structuredClone, Intl,
        InvenioAuthReady: Promise.resolve(true), InvenioLogistics: logistics, InvenioCurrentProfile: { role },
        InvenioProjectScope: { getActiveProjectId: () => PROJECT_ID, activeProject: { id: PROJECT_ID, name: 'North Yard', status: projectStatus } },
        projectSupabaseClient: createProjectScopedClient(server.client, () => PROJECT_ID), supabaseClient: server.client,
        qrcode: fakeQrLibrary(qrCalls),
        // Each print window is a fresh fake document; set blockPopups to have window.open return null.
        open: () => {
            server.log.push({ open: true });
            if (context.blockPopups) return null;
            const printWindow = { ...fakeDocument(), closed: false, opener: 'page', printed: 0, focus() {}, print() { this.printed++; }, close() { this.closed = true; } };
            opened.push(printWindow);
            return printWindow;
        },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    await settle();
    const $ = id => document.getElementById(id);
    const drawer = $('unitDrawer'), content = $('unitContent'), labels = $('labelContent');
    const codes = () => $('unitRows').querySelectorAll('tr').map(row => row.querySelector('.mono')?.textContent ?? row.textContent);
    const view = async code => { $('unitRows').querySelectorAll('button').find(node => node.textContent === code).click(); await settle(); };
    const open = async code => { content.querySelectorAll('button').find(node => node.getAttribute('aria-label') === `Open ${code}`).click(); await settle(); };
    const fields = () => Object.fromEntries(content.querySelector('dl').childNodes.map(pair => [pair.childNodes[0].textContent, pair.childNodes[1].textContent]));
    // The fake DOM has no descendant selectors: the items table is the drawer's only tbody.
    const itemRows = () => (content.querySelector('tbody')?.childNodes || []).map(row => row.childNodes.map(cell => cell.textContent));
    const filter = (status, search = '') => { $('filterStatus').value = status; $('filterSearch').value = search; $('filterStatus').onchange(); };
    const print = async (count, { wait = true } = {}) => {
        labels.querySelector('[id="labelCount"]').value = count;
        const done = labels.querySelector('form').onsubmit({ preventDefault() {} });
        if (wait) await settle();
        return done;
    };
    const labelStatus = () => labels.querySelector('[role="status"]').textContent;
    return { server, document, context, $, drawer, content, labels, codes, view, open, fields, itemRows, filter, print, labelStatus, qrCalls, opened };
}

test('lists only this project\'s crates by code, with status counts, search and where each one is', async () => {
    const page = await openPage();
    const [read] = page.server.reads('handling_unit_overview');
    assert.deepEqual(read.filters, [['project_id', PROJECT_ID]], 'the overview is read through the project scope');
    assert.deepEqual(page.codes(), ['HU-AAAA11', 'HU-BBBB22', 'HU-CCCC33', 'HU-DDDD44', 'HU-FFFF66', 'HU-GGGG77']);
    assert.equal(page.$('resultSummary').textContent, '6 crates');
    assert.deepEqual(page.$('filterStatus').options.map(option => option.textContent),
        ['All statuses (6)', 'Open (3)', 'Sealed (1)', 'On a load (1)', 'Delivered (0)', 'Unpacked (1)', 'Missing (0)', 'Written off (0)']);
    const row = code => page.$('unitRows').querySelectorAll('tr').find(item => item.querySelector('.mono').textContent === code);
    const cells = code => row(code).childNodes.map(cell => cell.textContent);
    assert.deepEqual(cells('HU-AAAA11').slice(1, 5), ['Lube oil spares', 'Sealed', 'North Yard laydown · T1 Pipe Racks › Rack 2', '2 items, 1 crate']);
    assert.deepEqual(cells('HU-BBBB22').slice(2, 5), ['Open', 'Inside HU-AAAA11North Yard laydown · T1 Pipe Racks › Rack 2', '1 item, 1 crate']);
    assert.equal(cells('HU-FFFF66')[3], 'Not recorded');
    assert.ok(cells('HU-DDDD44')[0].includes('High value'));
    assert.equal(cells('HU-GGGG77')[1], '<img src=x onerror=alert(1)> crate', 'markup is text');

    page.filter('open');
    assert.deepEqual(page.codes(), ['HU-BBBB22', 'HU-CCCC33', 'HU-GGGG77']);
    assert.equal(page.$('resultSummary').textContent, '3 of 6 crates match');
    page.filter('', ' hu-cccc 33 ');
    assert.deepEqual(page.codes(), ['HU-CCCC33']);
    page.filter('sealed', 'bbbb');
    assert.equal(page.$('unitRows').textContent, 'No crates match these filters.');
});

test('the drawer shows a crate\'s items and the crates inside it, and links up and down the nesting', async () => {
    const page = await openPage();
    await page.view('HU-AAAA11');
    assert.equal(page.drawer.open, true);
    assert.equal(page.content.querySelector('h2').textContent, 'HU-AAAA11');
    assertFocus(page, page.content.querySelectorAll('button').find(node => node.textContent === 'Close'));
    const [itemsRead] = page.server.reads('handling_unit_items');
    assert.deepEqual(itemsRead.filters, [['project_id', PROJECT_ID], ['unit_id', 'hu-aaaa11']], 'items are read for this crate, in this project');
    assert.deepEqual(page.itemRows(), [['GT2-LO-002', 'Cable drum 240 m', '3 EA', new Date('2026-10-28T15:00:00Z').toLocaleDateString()],
        ['GT2-LO-010', 'Lube oil cooler', '1 EA', new Date('2026-10-28T15:00:00Z').toLocaleDateString()]], 'by tag, numbers by value');
    assert.ok(page.content.textContent.includes('Crates inside (1)'));
    assert.deepEqual(page.fields(), { Description: 'Lube oil spares', Place: 'North Yard laydown', Area: 'T1 Pipe Racks › Rack 2',
        Sealed: new Date('2026-10-28T16:00:00Z').toLocaleString(), 'First packed': new Date('2026-10-28T14:00:00Z').toLocaleString() });

    await page.open('HU-BBBB22');
    assert.equal(page.content.querySelector('h2').textContent, 'HU-BBBB22');
    assertFocus(page, page.content.querySelector('h2'), 'moving to another crate focuses its title');
    assert.equal(page.fields().Inside, 'HU-AAAA11');
    await page.open('HU-CCCC33');
    assert.deepEqual([page.fields().Inside, page.fields()['Outermost crate']], ['HU-BBBB22', 'HU-AAAA11']);
    assert.match(page.content.textContent, /A crate inside another crate is wherever its outermost crate is\./);
    assert.deepEqual(page.itemRows(), [['GT2-FS-011', 'Fuel filter set', '4 EA', new Date('2026-10-28T15:00:00Z').toLocaleDateString()]]);
    await page.open('HU-AAAA11');
    assert.equal(page.content.querySelector('h2').textContent, 'HU-AAAA11');

    page.drawer.close(); await page.view('HU-FFFF66');
    assert.ok(page.content.textContent.includes('No items packed.'));
    assert.equal(page.server.reads('handling_unit_items').length, 4, 'an empty crate asks for no items');
    page.drawer.close(); await page.view('HU-GGGG77');
    assert.deepEqual(page.itemRows()[0].slice(0, 3), ['X-<i>1</i>', '<img src=x onerror=alert(1)>', '1.5 M']);
});

test('items that arrive after another crate was opened are dropped', async () => {
    const page = await openPage();
    page.server.paused = true;
    await page.view('HU-AAAA11');
    await page.open('HU-BBBB22');
    page.server.step(); await settle();
    assert.ok(!page.content.textContent.includes('Lube oil cooler'), "the first crate's items don't land in the second's drawer");
    assert.ok(page.content.textContent.includes('Loading items…'));
    page.server.step(); await settle();
    assert.deepEqual(page.itemRows().map(row => row[0]), ['GT2-LO-003']);
});

test('items that fail to load say so in the drawer', async () => {
    const page = await openPage();
    page.server.fail = request => request.table === 'handling_unit_items' && { code: '42501', message: 'permission denied for view handling_unit_items' };
    await page.view('HU-AAAA11');
    assert.ok(page.content.textContent.includes('Items could not be loaded (You do not have permission to make this change.). Close and reopen to retry.'));
});

test('only office staff on an active project can print labels', async () => {
    assert.equal((await openPage({ role: 'field_worker' })).$('printLabels').hidden, true);
    assert.equal((await openPage({ role: 'office_staff', projectStatus: 'closed' })).$('printLabels').hidden, true);
    assert.equal((await openPage({ role: 'office_staff' })).$('printLabels').hidden, false);
});

test('a label count outside 1 to 500 is caught before any window opens or code is reserved', async () => {
    const page = await openPage();
    page.$('printLabels').click();
    assert.equal(page.labels.querySelector('[id="labelCount"]').value, '6');
    for (const count of ['0', '501', 'ten', '2.5']) {
        await page.print(count);
        assert.equal(page.labelStatus(), 'Enter a whole number of labels from 1 to 500.', count);
    }
    assert.equal(page.opened.length, 0);
    assert.equal(page.server.rpcs().length, 0);
});

test('printing opens the window first, reserves the codes, then prints big QR labels six to a page', async () => {
    const page = await openPage();
    page.$('printLabels').click();
    await page.print('7');
    assert.deepEqual(page.server.log.filter(entry => entry.open || entry.rpc).map(entry => entry.open ? 'open' : entry.rpc), ['open', 'reserve_handling_unit_labels'],
        'the window opens during the click, before waiting on the database');
    assert.deepEqual(plain(page.server.rpcs()[0].args), { p_project_id: PROJECT_ID, p_count: 7 });
    const [printWindow] = page.opened;
    assert.equal(printWindow.opener, null);
    assert.equal(printWindow.printed, 1);
    const { document: printed } = printWindow;
    assert.equal(printed.title, 'Crate labels — North Yard');
    assert.match(printed.head.querySelector('style').textContent, /@page \{ size: letter;/);
    const pages = printed.body.querySelectorAll('.page');
    assert.deepEqual(pages.map(sheet => sheet.querySelectorAll('.label').length), [6, 1]);
    const expected = Array.from({ length: 7 }, (_, index) => `HU-T${String(index + 1).padStart(5, '0')}`);
    assert.deepEqual(printed.body.querySelectorAll('.code').map(node => node.textContent), expected);
    assert.deepEqual(page.qrCalls.map(call => [call.data, call.typeNumber, call.level]), expected.map(code => [code, 0, 'H']), 'each QR holds just the code, high error correction');
    const svg = printed.body.querySelector('svg');
    assert.equal(svg.getAttribute('viewBox'), '0 0 29 29', '21 modules plus the quiet zone');
    assert.equal(svg.getAttribute('aria-label'), 'QR code for HU-T00001');
    assert.equal(svg.querySelector('path').getAttribute('d'), logistics.qrPath({ getModuleCount: () => 21, isDark: (row, column) => (row + column) % 3 === 0 }).path);
    assert.equal(page.labelStatus(), 'Reserved 7 labels (HU-T00001 to HU-T00007). They become crates when a field crew packs them.');
    assert.equal(page.$('pageMessage').textContent, page.labelStatus());
    printed.body.querySelector('button').onclick();
    assert.equal(printWindow.printed, 2, 'the window has its own Print button');
});

test('print again reuses the last codes without reserving more', async () => {
    const page = await openPage();
    page.$('printLabels').click();
    await page.print('2');
    page.$('labelDialog').close();
    page.$('printLabels').click();
    page.labels.querySelectorAll('button').find(node => node.textContent === 'Print the last 2 labels again').click();
    assert.equal(page.server.rpcs().length, 1);
    assert.deepEqual(page.opened[1].document.body.querySelectorAll('.code').map(node => node.textContent), ['HU-T00001', 'HU-T00002']);
    assert.equal(page.labelStatus(), 'Opened 2 labels to print again. No new codes were reserved.');
});

test('a blocked pop-up reserves nothing; a refusal closes the window and says why', async () => {
    const page = await openPage();
    page.$('printLabels').click();
    page.context.blockPopups = true;
    await page.print('3');
    assert.equal(page.labelStatus(), 'Allow pop-ups for this site, then try again. No labels were reserved.');
    assert.equal(page.server.rpcs().length, 0);
    page.context.blockPopups = false;
    page.server.fail = request => request.rpc && { code: '42501', message: 'Office access to an active project is required' };
    await page.print('3');
    assert.equal(page.opened[0].closed, true);
    assert.equal(page.labelStatus(), 'Could not reserve labels: Office access to an active project is required. Nothing was printed.');
    assert.equal(page.$('pageMessage').textContent, page.labelStatus(), 'also on the page, in case the dialog was closed');
    assert.equal(page.labels.querySelectorAll('button').find(node => node.textContent === 'Reserve and print').disabled, false);
});

test('a second request while codes are being reserved reserves nothing more', async () => {
    const page = await openPage();
    page.$('printLabels').click();
    page.server.paused = true;
    const first = page.print('4', { wait: false });
    await page.print('4');
    assert.equal(page.labelStatus(), 'Still preparing the last labels. Try again in a moment.');
    page.$('labelDialog').escape();
    page.$('labelDialog').escape({ activated: false });
    assert.equal(page.$('labelDialog').open, true, 'Escape, even a forced one, leaves it open mid-reservation');
    page.server.step(); await first; await settle();
    assert.equal(page.server.rpcs().length, 1);
    assert.equal(page.opened.length, 1);
});

test('without the QR library nothing is reserved', async () => {
    const page = await openPage();
    delete page.context.qrcode;
    page.$('printLabels').click();
    await page.print('6');
    assert.equal(page.labelStatus(), 'The QR code library did not load. Check the connection and reload the page. No labels were reserved.');
    assert.equal(page.opened.length + page.server.rpcs().length, 0);
});

test('a print window closed while codes were reserved, or a sheet that fails to draw, still says the codes are reserved', async () => {
    const page = await openPage();
    page.$('printLabels').click();
    page.server.paused = true;
    const done = page.print('2', { wait: false });
    await settle();
    page.opened[0].closed = true;
    page.server.step(); await done; await settle();
    assert.equal(page.opened[0].printed, 0);
    assert.equal(page.labelStatus(), 'Reserved 2 labels (HU-T00001 to HU-T00002), but the print window was closed. Close this and choose Print crate labels, then Print the last labels again.');
    page.server.paused = false;
    page.context.qrcode = () => { throw new Error('QR data too long'); };
    await page.print('1');
    assert.equal(page.opened[1].closed, true, 'the half-drawn window is closed');
    assert.equal(page.labelStatus(), 'Reserved 1 label (HU-T00003), but the label sheet could not be drawn (QR data too long). Close this and choose Print crate labels, then Print the last labels again.');
    assert.equal(page.$('pageMessage').textContent, page.labelStatus());
    page.$('labelDialog').close();
    page.$('printLabels').click();
    assert.ok(page.labels.querySelectorAll('button').some(node => node.textContent === 'Print the last label again'));
});

test('typing a label count does not leave the page marked as having unsaved work', async () => {
    const page = await openPage();
    page.$('printLabels').click();
    page.context.InvenioUnsavedChanges = true; // what the shared shell sets when a form inside the page gets input
    await page.print('1');
    page.$('labelDialog').close();
    assert.equal(page.context.InvenioUnsavedChanges, false);
});

test('022: a crate on a load says which load, and a missing one has its own status', async () => {
    const page = await openPage({ units: [
        unit('HU-LOAD01', { status: 'on_load', load_id: 'l1', load_number: 'L-0002', load_line_status: 'on_board' }),
        unit('HU-PLAN01', { status: 'sealed', load_id: 'l1', load_number: 'L-0001', load_line_status: 'planned', place_name: 'North Yard laydown' }),
        unit('HU-MISS01', { status: 'missing', load_id: 'l3', load_number: 'L-0003', load_line_status: 'missing' }),
    ] });
    const where = code => page.$('unitRows').querySelectorAll('tr').find(row => row.querySelector('.mono').textContent === code).childNodes[3].textContent;
    assert.equal(where('HU-LOAD01'), 'On load L-0002');
    assert.equal(where('HU-PLAN01'), 'North Yard laydownPlanned on load L-0001');
    assert.equal(where('HU-MISS01'), 'Missing from load L-0003');
    assert.ok(page.$('filterStatus').options.some(option => option.textContent === 'Missing (1)'));
    page.filter('missing');
    assert.deepEqual(page.codes(), ['HU-MISS01']);
});

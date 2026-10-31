// Runs outside-shops.js against the fake DOM and the loads model, so the rebuilt Outside Shops page is tested by what
// it shows after real load operations put pieces at a shop.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const loadsHelpers = require('../js/utils/loads-helpers');
const { createProjectScopedClient } = require('../js/utils/project-scope');
const { emptyLoads, createModel } = require('./support/loads-model');
const { fakeDocument, settle } = require('./support/fake-dom');

const source = fs.readFileSync('outside-shops.js', 'utf8');
const P = 'p1';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Two shops (one retired), a yard, crates and items; then two loads deliver pieces to the first shop. */
function world() {
    const place = (n, name, kind, extra = {}) => ({ id: id(n), name, kind, project_id: null, is_active: true, city: 'Houston', state: 'TX', contact_name: null, contact_phone: null, ...extra });
    const unit = (n, code, extra = {}) => ({ id: id(n), project_id: P, code, kind: 'crate', description: `${code} valves`, is_high_value: false, status: 'sealed', parent_id: null,
        top_unit_id: id(n), top_code: code, place_id: null, place_name: null, ...extra });
    return {
        places: [place(1, 'North Yard', 'yard', { project_id: P }), place(2, 'Fixture Machine Works', 'outside_shop', { contact_name: 'Sam Rivera', contact_phone: '555-0142' }),
            place(3, 'Old Shop', 'outside_shop', { is_active: false }), place(4, '<img src=x onerror=alert(1)> Fab', 'outside_shop'), place(5, 'Gulf Valve Supply', 'vendor')],
        units: [unit(11, 'HU-AAAA11', { is_high_value: true }), unit(12, 'HU-BBBB22'), unit(13, 'HU-INNER1', { parent_id: id(11), top_unit_id: id(11), top_code: 'HU-AAAA11' }),
            unit(14, 'HU-OTHER1', { project_id: 'p2' })],
        items: [{ uid: id(21), project_id: P, qr_code: 'T-100', inventory_item: 'Pump', count_status: 'counted' }, { uid: id(22), project_id: P, qr_code: 'T-101', inventory_item: 'Gasket', count_status: 'counted' }],
        ...emptyLoads(),
    };
}

/**
 * Plans pieces on a new load from a vendor to one stop, sends it off and marks the stop delivered (or not), as the office
 * would where nobody scans (022 confirms without scanning only at shops and vendors).
 */
function deliver(model, loadN, stopN, placeN, codes, { confirmAll = true } = {}) {
    model.apply('load_save', { loadId: id(loadN), originPlaceId: id(5), driverName: 'Dana', stops: [{ id: id(stopN), placeId: id(placeN) }] });
    model.apply('load_plan', { loadId: id(loadN), add: codes.map(code => ({ code, dropoffStopId: id(stopN) })) });
    model.apply('load_depart', { loadId: id(loadN), confirmAll: true, overrideReason: 'Fixture load: no licence' });
    model.apply('stop_complete', { loadId: id(loadN), stopId: id(stopN), confirmAll });
}

async function openPage(prepare = () => {}) {
    const state = world(), log = [];
    const model = createModel(state, { projectId: P, office: () => true });
    prepare(model, state);
    const reads = { places: () => state.places, handling_unit_overview: model.views.handling_unit_overview, load_line_overview: model.views.load_line_overview };
    class Query {
        constructor(table) { this.request = { table, filters: [], from: 0, to: 999 }; log.push(this.request); }
        select() { return this; }
        order() { return this; }
        range(from, to) { Object.assign(this.request, { from, to }); return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        is(key, value) { this.request.filters.push([key, value]); return this; }
        then(resolve, reject) {
            const rows = reads[this.request.table]().filter(row => this.request.filters.every(([key, value]) => (row[key] ?? null) === value)).map(row => structuredClone(row));
            return Promise.resolve({ data: rows.slice(this.request.from, this.request.to + 1), error: null }).then(resolve, reject);
        }
    }
    const client = { from: table => new Query(table) };
    const { document, Option } = fakeDocument();
    const context = { document, Option, console, setTimeout, structuredClone, Intl, InvenioAuthReady: Promise.resolve(true), InvenioLoads: loadsHelpers,
        supabaseClient: client, projectSupabaseClient: createProjectScopedClient(client, () => P) };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    await settle();
    const $ = id => document.getElementById(id);
    const shops = () => $('shopSections').querySelectorAll('section').map(section => ({
        name: section.querySelector('h2').textContent, summary: section.querySelector('.card-header').childNodes[1].textContent,
        rows: (section.querySelector('tbody')?.childNodes || []).map(row => row.childNodes.map(cell => cell.textContent)),
        links: section.querySelectorAll('a').map(link => [link.textContent, link.href]) }));
    return { $, shops, log, state, model };
}

test('each outside shop lists the crates and loose items a load delivered there, how long ago and by which load', async () => {
    const page = await openPage(model => {
        deliver(model, 31, 41, 2, ['HU-AAAA11', 'T-100']);
        deliver(model, 32, 42, 2, ['HU-BBBB22'], { confirmAll: false }); // never scanned off: missing, so not at the shop
    });
    const [first, ...rest] = page.shops();
    assert.equal(first.name, 'Fixture Machine Works');
    assert.equal(first.summary, '1 crate, 1 item');
    assert.deepEqual(first.rows.map(row => [row[0], row[1], row[3]]), [['HU-AAAA11', 'HU-AAAA11 valvesCrateHigh value', 'L-0001'], ['T-100', 'PumpItem', 'L-0001']]);
    assert.ok(first.rows[0][2].endsWith('today'));
    assert.deepEqual(first.links[0], ['L-0001', `loads.html?load=${encodeURIComponent(id(31))}`]);
    assert.ok(!first.rows.some(row => row[0] === 'HU-INNER1'), 'a crate inside another travels with it and is not listed on its own');
    assert.deepEqual(rest.map(shop => [shop.name, shop.summary]), [['<img src=x onerror=alert(1)> Fab', 'Nothing here now']], 'the retired shop with nothing there is left out');
    assert.equal(page.$('resultSummary').textContent, '2 pieces at 1 of 2 shops');
    const reads = page.log.map(request => [request.table, request.filters]);
    assert.deepEqual(JSON.parse(JSON.stringify(reads)), [
        ['places', [['kind', 'outside_shop']]],
        ['handling_unit_overview', [['project_id', P], ['status', 'delivered'], ['parent_id', null]]],
        ['load_line_overview', [['project_id', P], ['status', 'delivered'], ['is_current_position', true]]],
    ]);
});

test('a piece that moves on is no longer at the shop, and a retired shop still holding something is listed', async () => {
    const page = await openPage((model, state) => {
        deliver(model, 31, 41, 2, ['T-100', 'T-101']);
        deliver(model, 32, 42, 4, ['T-101']); // T-101 goes on to another shop
        deliver(model, 33, 43, 2, ['HU-BBBB22']);
        state.places[1].is_active = false; // the shop is retired afterwards
    });
    const [shop] = page.shops();
    assert.equal(shop.name, 'Fixture Machine Works');
    assert.deepEqual(shop.rows.map(row => [row[0], row[3]]), [['HU-BBBB22', 'L-0003'], ['T-100', 'L-0001']]);
    assert.deepEqual(page.$('filterShop').options.map(option => option.textContent), ['All shops', 'Fixture Machine Works (retired)', '<img src=x onerror=alert(1)> Fab']);
});

test('filters by shop and by code, tag or name', async () => {
    const page = await openPage(model => { deliver(model, 31, 41, 2, ['HU-AAAA11', 'T-100']); deliver(model, 32, 42, 4, ['T-101']); });
    page.$('filterSearch').value = 'pump'; page.$('filterSearch').oninput();
    assert.deepEqual(page.shops().map(shop => [shop.name, shop.rows.map(row => row[0])]), [['Fixture Machine Works', ['T-100']]]);
    page.$('filterSearch').value = ''; page.$('filterShop').value = id(4); page.$('filterShop').onchange();
    assert.deepEqual(page.shops().map(shop => [shop.name, shop.rows.map(row => row[0])]), [['<img src=x onerror=alert(1)> Fab', ['T-101']]]);
    page.$('filterSearch').value = 'nothing like this'; page.$('filterSearch').oninput();
    assert.equal(page.$('shopSections').textContent, 'Nothing matches these filters.');
});

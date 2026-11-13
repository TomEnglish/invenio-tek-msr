// The GPS Tracking page opened from a Shipments link (?tracker=<id>, 026): runs samsara-tracking.js against the fake
// DOM and calls its focus step with made-up trackers, a stand-in marker cluster and the page's own filters; and the
// shipment each tracker rides with, in the tracker list, its filter and the notice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fakeDocument } = require('./support/fake-dom');

const source = fs.readFileSync('samsara-tracking.js', 'utf8');

function openPage(search, { hidden = [], stubFilters = true } = {}) {
    const { document } = fakeDocument();
    const context = { document, URLSearchParams, InvenioShipmentLocation: require('../js/utils/shipment-location'), console: { log() {} }, location: { search }, SITE_CONFIG: { LATITUDE: 28.95, LONGITUDE: -95.36, RADIUS_METERS: 500 } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    const $ = id => document.getElementById(id);
    $('trackerFocus').hidden = true;
    $('hideUnknown').checked = true;
    $('searchBox').value = 'yard';
    const zoomed = [], opened = [];
    const marker = id => ({ openPopup: () => opened.push(id) });
    const trackers = [{ id: 'gps-1', name: 'Houston Yard A', last_seen_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() },
        { id: 'gps-2', name: 'Unknown', last_seen_at: null }, { id: 'gps-3', name: 'Spare Tag', last_seen_at: null },
        { id: 'gps-4', name: 'Old Tag', last_seen_at: new Date(Date.now() - 10 * 86400 * 1000).toISOString() }];
    context.fixture = { trackers, hidden, markers: { 'gps-1': marker('gps-1'), 'gps-2': marker('gps-2'), 'gps-4': marker('gps-4') }, zoomed };
    vm.runInContext(`state.trackers = fixture.trackers; state.filteredTrackers = fixture.trackers.filter(t => !fixture.hidden.includes(t.id));
        state.markers = fixture.markers; state.markerCluster = { zoomToShowLayer: (marker, done) => { fixture.zoomed.push(marker); done(); } };`, context);
    // The page's own filters would redraw the map; here they just show every tracker again.
    let refiltered = 0;
    if (stubFilters) context.applyFilters = () => { refiltered++; vm.runInContext('state.filteredTrackers = state.trackers', context); };
    else context.updateMap = () => {};
    return { $, context, zoomed, opened, refiltered: () => refiltered, focus: () => vm.runInContext('focusLinkedTracker()', context) };
}

test('a tracker the link names is zoomed to with its popup open, and the page says which it is', () => {
    const page = openPage('?tracker=gps-1');
    page.focus();
    assert.deepEqual(page.opened, ['gps-1']);
    assert.equal(page.zoomed.length, 1);
    assert.equal(page.$('trackerFocus').hidden, false);
    assert.equal(page.$('trackerFocus').textContent, 'Showing Houston Yard A, last seen 2 hours ago.');
    assert.equal(page.refiltered(), 0, 'filters that already show it are left alone');
    assert.deepEqual([page.$('searchBox').value, page.$('hideUnknown').checked], ['yard', true]);
});

test('an older position says how many days ago, whatever the browser\'s locale', () => {
    const page = openPage('?tracker=gps-4');
    page.focus();
    assert.equal(page.$('trackerFocus').textContent, 'Showing Old Tag, last seen 10 days ago.');
});

test('filters that hide it are cleared first', () => {
    const page = openPage('?tracker=gps-2', { hidden: ['gps-2'] });
    page.focus();
    assert.equal(page.refiltered(), 1);
    assert.deepEqual([page.$('searchBox').value, page.$('filterStatus').value, page.$('filterLinked').value, page.$('hideUnknown').checked], ['', '', '', false]);
    assert.deepEqual(page.opened, ['gps-2']);
    assert.equal(page.$('trackerFocus').textContent, 'Showing Unknown, last seen at an unknown time.');
});

test('a tracker with no position, or one not on this project, is explained instead', () => {
    const unplaced = openPage('?tracker=gps-3');
    unplaced.focus();
    assert.deepEqual([unplaced.opened, unplaced.$('trackerFocus').textContent], [[], 'Spare Tag hasn\'t reported a GPS position yet.']);
    const unknown = openPage('?tracker=gps-404');
    unknown.focus();
    assert.equal(unknown.$('trackerFocus').textContent, 'That tracker isn\'t one of this project\'s trackers, or it hasn\'t been synced yet.');
    const plain = openPage('');
    plain.focus();
    assert.equal(plain.$('trackerFocus').hidden, true, 'without a link the page is as before');
});

test('the page focuses once, after the first load, and the notice is in the page', () => {
    const js = fs.readFileSync('samsara-tracking.js', 'utf8'), html = fs.readFileSync('samsara-tracking.html', 'utf8');
    assert.match(js, /await loadTrackers\(\);\n\n {4}\/\/ Show the tracker a Shipments page link names, if any\n {4}focusLinkedTracker\(\);/);
    assert.equal((js.match(/focusLinkedTracker\(\)/g) || []).length, 2, 'defined once and called once');
    const focus = js.slice(js.indexOf('function focusLinkedTracker'), js.indexOf('// ====', js.indexOf('function focusLinkedTracker')));
    assert.doesNotMatch(focus, /innerHTML|insertAdjacentHTML/, 'the notice is text');
    assert.match(html, /<p id="trackerFocus" class="alert alert-info" role="status" aria-live="polite" hidden><\/p>/);
    assert.ok(html.indexOf('id="trackerFocus"') < html.indexOf('id="map"'), 'above the map');
});

// A stand-in for the project-scoped client: active links, and shipments read by id.
function fakeClient({ links = [], shipments = [], fail = () => null } = {}) {
    const log = [];
    class Query {
        constructor(table) { this.request = { table, filters: [] }; log.push(this.request); }
        select(columns) { this.request.columns = columns; return this; }
        is(key, value) { this.request.filters.push(['is', key, value]); return this; }
        in(key, values) { this.request.filters.push(['in', key, [...values]]); return this; }
        then(resolve, reject) {
            const error = fail(this.request.table);
            const rows = this.request.table === 'shipment_trackers' ? links
                : shipments.filter(row => this.request.filters.every(([op, key, values]) => op !== 'in' || values.includes(row[key])));
            return Promise.resolve(error ? { data: null, error } : { data: structuredClone(rows), error: null }).then(resolve, reject);
        }
    }
    return { from: table => new Query(table), log };
}

async function withLinks(page, client) {
    page.context.projectSupabaseClient = client;
    await vm.runInContext('(async () => { state.shipmentByTracker = await loadShipmentLinks(); })()', page.context);
    // Arrays made inside the page's vm context aren't deepEqual to this file's; compare plain copies.
    return JSON.parse(JSON.stringify(vm.runInContext('[...state.shipmentByTracker]', page.context)));
}

test('the shipment each tracker rides with is read with the trackers and shown, escaped, in Linked To', async () => {
    const page = openPage('', { stubFilters: false });
    const client = fakeClient({ links: [{ tracker_id: 'gps-1', shipment_id: 2 }, { tracker_id: 'gps-3', shipment_id: 9 }],
        shipments: [{ id: 2, shipment_number: 'SHIP-20' }, { id: 9, shipment_number: '<b>SHIP</b>' }, { id: 7, shipment_number: 'SHIP-70' }] });
    assert.deepEqual(await withLinks(page, client), [['gps-1', 'SHIP-20'], ['gps-3', '<b>SHIP</b>']]);
    assert.deepEqual(JSON.parse(JSON.stringify(client.log.map(request => [request.table, request.columns, request.filters]))), [
        ['shipment_trackers', 'tracker_id,shipment_id', [['is', 'ended_at', null]]], ['shipments', 'id,shipment_number', [['in', 'id', [2, 9]]]]]);
    vm.runInContext("Object.assign(state.trackers[1], { po_id: 'PO-1', install_tag: 'V-<1>', linked_material_id: 5 }); state.filteredTrackers = state.trackers; renderTrackers();", page.context);
    const html = page.$('trackerTableBody').innerHTML;
    assert.match(html, /<td>Shipment SHIP-20<\/td>/);
    assert.match(html, /<td>PO: PO-1 → V-&lt;1&gt;<\/td>/, 'material links as before, now escaped too');
    assert.match(html, /<td>Shipment &lt;b&gt;SHIP&lt;\/b&gt;<\/td>/, 'imported shipment numbers are escaped');
    assert.doesNotMatch(html, /<b>SHIP/);
});

test('the Linked filter and the search count shipment links', async () => {
    const page = openPage('', { stubFilters: false });
    await withLinks(page, fakeClient({ links: [{ tracker_id: 'gps-1', shipment_id: 2 }], shipments: [{ id: 2, shipment_number: 'SHIP-20' }] }));
    vm.runInContext("state.trackers[1].linked_material_id = 5;", page.context);
    const filtered = (linked, search = '') => {
        page.$('filterLinked').value = linked; page.$('searchBox').value = search; page.$('filterStatus').value = ''; page.$('hideUnknown').checked = false;
        return vm.runInContext('applyFilters(); state.filteredTrackers.map(t => t.id)', page.context);
    };
    assert.deepEqual([...filtered('linked')], ['gps-1', 'gps-2'], 'on a shipment or a material');
    assert.deepEqual([...filtered('unlinked')], ['gps-3', 'gps-4']);
    assert.deepEqual([...filtered('', 'ship-20')], ['gps-1']);
});

test('before 026, or when the read fails, the page shows material links only', async () => {
    const missing = openPage('');
    assert.deepEqual(await withLinks(missing, fakeClient({ fail: table => table === 'shipment_trackers' ? { code: 'PGRST205', message: 'Could not find the table' } : null })), []);
    const unread = openPage('');
    assert.deepEqual(await withLinks(unread, fakeClient({ links: [{ tracker_id: 'gps-1', shipment_id: 2 }], fail: table => table === 'shipments' ? { message: 'down' } : null })), []);
    const none = openPage('');
    const client = fakeClient();
    assert.deepEqual(await withLinks(none, client), []);
    assert.equal(client.log.length, 1, 'no links: no shipment read');
});

test('the notice names the shipment a tracker rides with', async () => {
    const page = openPage('?tracker=gps-1');
    await withLinks(page, fakeClient({ links: [{ tracker_id: 'gps-1', shipment_id: 2 }], shipments: [{ id: 2, shipment_number: 'SHIP-20' }] }));
    page.focus();
    assert.equal(page.$('trackerFocus').textContent, 'Showing Houston Yard A, on shipment SHIP-20, last seen 2 hours ago.');
});

test('the export keeps Linked Material as it was and adds the shipment as a last column', async () => {
    const page = openPage('', { stubFilters: false });
    await withLinks(page, fakeClient({ links: [{ tracker_id: 'gps-1', shipment_id: 2 }], shipments: [{ id: 2, shipment_number: 'SHIP "20"' }] }));
    let written = null;
    Object.assign(page.context, { Blob: class { constructor(parts) { written = parts.join(''); } }, showSuccess: () => {} });
    page.context.window.URL = { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => {} };
    vm.runInContext("Object.assign(state.trackers[1], { po_id: 'PO-1', install_tag: 'V-1' }); state.filteredTrackers = state.trackers; exportToCSV();", page.context);
    const lines = written.split('\n');
    assert.equal(lines[0], '"Name","Status","Latitude","Longitude","Distance (km)","Last Seen","Linked Material","Shipment"');
    assert.ok(lines[1].startsWith('"Houston Yard A",') && lines[1].endsWith(',"","SHIP ""20"""'), `quotes inside a value are doubled: ${lines[1]}`);
    assert.ok(lines[2].startsWith('"Unknown",') && lines[2].endsWith(',"PO: PO-1 -> V-1",""'), `Linked Material reads as before: ${lines[2]}`);
});

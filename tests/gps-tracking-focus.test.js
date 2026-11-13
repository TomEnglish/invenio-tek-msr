// The GPS Tracking page opened from a Shipments link (?tracker=<id>, 026): runs samsara-tracking.js against the fake
// DOM and calls its focus step with made-up trackers, a stand-in marker cluster and the page's own filters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fakeDocument } = require('./support/fake-dom');

const source = fs.readFileSync('samsara-tracking.js', 'utf8');

function openPage(search, { hidden = [] } = {}) {
    const { document } = fakeDocument();
    const context = { document, URLSearchParams, console: { log() {} }, location: { search }, SITE_CONFIG: { LATITUDE: 28.95, LONGITUDE: -95.36, RADIUS_METERS: 500 } };
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
        { id: 'gps-2', name: 'Unknown', last_seen_at: null }, { id: 'gps-3', name: 'Spare Tag', last_seen_at: null }];
    context.fixture = { trackers, hidden, markers: { 'gps-1': marker('gps-1'), 'gps-2': marker('gps-2') }, zoomed };
    vm.runInContext(`state.trackers = fixture.trackers; state.filteredTrackers = fixture.trackers.filter(t => !fixture.hidden.includes(t.id));
        state.markers = fixture.markers; state.markerCluster = { zoomToShowLayer: (marker, done) => { fixture.zoomed.push(marker); done(); } };`, context);
    // The page's own filters would redraw the map; here they just show every tracker again.
    let refiltered = 0;
    context.applyFilters = () => { refiltered++; vm.runInContext('state.filteredTrackers = state.trackers', context); };
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

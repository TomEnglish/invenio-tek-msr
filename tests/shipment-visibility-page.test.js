// Runs shipment-visibility.js against the fake DOM and a fake database that keeps 026's rules for tracker links, so
// the Shipments page is tested by what it shows and what it sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const where = require('../js/utils/shipment-location');
const { createProjectScopedClient, isProjectScopedTable } = require('../js/utils/project-scope');
const { fakeDocument, settle, assertFocus } = require('./support/fake-dom');

const source = fs.readFileSync('shipment-visibility.js', 'utf8');
const P = 'p1';
const search = text => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
const hoursAgo = hours => new Date(Date.now() - hours * 3600 * 1000).toISOString();

/** Made-up shipments, places and trackers: one shipment of each kind, and one on another project. */
function world() {
    const shipment = (id, status, extra = {}) => ({ id, project_id: P, shipment_number: `SHP-${id}`, cargo_description: `Cargo ${id}`, mode: 'ROAD', ship_type: 'DIRECT SHIP',
        origin: 'Port Arthur, TX', destination: 'Freeport, TX', ship_from: null, ship_to: null, storage_location: null, status, rts_date: '2026-10-31', delivery_date: null, ...extra });
    const place = (id, name, extra = {}) => ({ id, name, project_id: null, is_active: true, address: null, city: null, state: null, postal_code: null, latitude: null, longitude: null, ...extra });
    const tracker = (id, name, extra = {}) => ({ id, project_id: P, name, last_latitude: 29.88, last_longitude: -93.94, last_seen_at: hoursAgo(2), ...extra });
    return {
        shipments: [
            shipment(1, 'Not RTS', { origin: 'Nederland, TX' }),
            shipment(2, 'RTS', { origin: 'IMTT BAYONNE', cargo_description: '<img src=x onerror=alert(1)> crate' }),
            shipment(3, 'In Transit', { cargo_description: 'MCC Crates', ship_type: 'OUTSIDE SHOP' }),
            shipment(4, 'In Transit', { cargo_description: 'Fuel pump skid' }),
            shipment(5, 'Delivered', { destination: 'Sulzer Grayson', storage_location: 'Laydown Area A' }),
            shipment(6, 'Delivered', { destination: 'Freeport, TX', cargo_description: 'Valve crate' }),
            shipment(9, 'In Transit', { project_id: 'p2', cargo_description: 'Another project' }),
        ],
        places: [place('pl1', 'IMTT Bayonne', { latitude: 40.6539, longitude: -74.1027 }), place('pl2', 'SULZER GRAYSON', { city: 'La Porte', state: 'TX' }),
            place('pl3', 'Freeport, TX', { is_active: false, latitude: 28.95, longitude: -95.36 })],
        trackers: [tracker('trk-1', 'Tracker One'), tracker('trk-2', 'Tracker Two', { last_seen_at: hoursAgo(240) }), tracker('trk-3', 'Tracker Three', { last_latitude: null, last_longitude: null, last_seen_at: null }),
            tracker('trk-9', 'Other Tracker', { project_id: 'p2' })],
        links: [{ id: 'l1', project_id: P, shipment_id: 3, tracker_id: 'trk-1', linked_at: hoursAgo(5), ended_at: null },
            { id: 'l2', project_id: P, shipment_id: 6, tracker_id: 'trk-2', linked_at: hoursAgo(300), ended_at: null },
            { id: 'l0', project_id: P, shipment_id: 4, tracker_id: 'trk-3', linked_at: hoursAgo(400), ended_at: hoursAgo(390) }],
    };
}

/**
 * The fake database. Reads follow the filters the page sends; link_shipment_tracker and unlink_shipment_tracker keep
 * 026's rules: office staff only, a tracker on another shipment moves only with p_move, and unlinking names the tracker.
 * `fail` can refuse any request; `paused` holds every call until step() lets it through.
 */
function fakeServer(state, { role }) {
    const server = { state, log: [], calls: [], fail: null, paused: false, waiting: [], step: () => server.waiting.shift()() };
    const views = { shipments: () => state.shipments, places: () => state.places, vw_active_samsara_trackers: () => state.trackers, shipment_trackers: () => state.links };
    const active = () => state.links.filter(link => !link.ended_at);
    const number = id => state.shipments.find(row => row.id === id)?.shipment_number;
    function rpc(name, args) {
        if (!['office_staff', 'admin'].includes(role)) return { code: '42501', message: 'Only office staff can link a tracker to a shipment' };
        const current = active().find(link => link.shipment_id === args.p_shipment_id);
        const end = (link, reason) => Object.assign(link, { ended_at: new Date().toISOString(), ended_reason: reason });
        if (name === 'link_shipment_tracker') {
            if (current?.tracker_id === args.p_tracker_id) return { data: current };
            const other = active().find(link => link.tracker_id === args.p_tracker_id);
            if (other && !args.p_move) {
                const tracker = state.trackers.find(row => row.id === args.p_tracker_id);
                return { code: '23505', message: `Tracker ${tracker.name} is on shipment ${number(other.shipment_id)}. Move it to this shipment?` };
            }
            if (other) end(other, 'moved');
            if (current) end(current, 'replaced');
            const link = { id: `l${state.links.length + 1}`, project_id: P, shipment_id: args.p_shipment_id, tracker_id: args.p_tracker_id, linked_at: new Date().toISOString(), ended_at: null };
            state.links.push(link);
            return { data: link };
        }
        if (!current) return { code: '22023', message: 'No tracker is linked to this shipment' };
        if (current.tracker_id !== args.p_tracker_id) return { code: '40001', message: `The tracker on shipment ${number(args.p_shipment_id)} has changed since you opened it; open it again` };
        return { data: end(current, 'unlinked') };
    }
    async function respond(request) {
        server.log.push(request);
        if (server.paused) await new Promise(resolve => server.waiting.push(resolve));
        const failure = server.fail?.(request);
        if (failure) return { data: null, error: failure };
        if (request.rpc) {
            server.calls.push([request.rpc, request.args]);
            const result = rpc(request.rpc, request.args);
            return result.code ? { data: null, error: result } : { data: structuredClone(result.data), error: null };
        }
        const rows = views[request.table]().filter(row => request.filters.every(([key, value]) => (row[key] ?? null) === value));
        return { data: rows.slice(request.from, request.to + 1).map(row => structuredClone(row)), error: null };
    }
    class Query {
        constructor(table) { this.request = { table, filters: [], from: 0, to: 999 }; }
        select(columns) { this.request.columns = columns; return this; }
        order() { return this; }
        range(from, to) { Object.assign(this.request, { from, to }); return this; }
        eq(key, value) { this.request.filters.push([key, value]); return this; }
        is(key, value) { this.request.filters.push([key, value]); return this; }
        then(resolve, reject) { return respond(this.request).then(resolve, reject); }
    }
    server.client = { from: table => new Query(table), rpc: (name, args) => respond({ rpc: name, args: structuredClone(args) }) };
    return server;
}

async function openPage({ role = 'office_staff', projectStatus = 'active', prepare = () => {} } = {}) {
    const state = world();
    const server = fakeServer(state, { role });
    prepare(server);
    const { document, Option } = fakeDocument();
    const context = { document, Option, console, setTimeout, structuredClone, Intl, InvenioAuthReady: Promise.resolve(true), InvenioShipmentLocation: where,
        InvenioCurrentProfile: { id: 'u1', role }, InvenioProjectScope: { getActiveProjectId: () => P, activeProject: { id: P, status: projectStatus } },
        supabaseClient: server.client, projectSupabaseClient: createProjectScopedClient(server.client, () => P) };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    await settle();
    const $ = id => document.getElementById(id);
    const rows = () => $('cargoTableBody').childNodes.map(row => row.childNodes.map(cell => cell.textContent));
    // Each row's Location cell: its link (text and target) or text, its caption lines and its tracker button.
    const location = number => {
        const cargo = state.shipments.find(shipment => shipment.shipment_number === number).cargo_description;
        const row = $('cargoTableBody').childNodes.find(node => node.childNodes[0].textContent === cargo);
        const cell = row.childNodes[7], link = cell.querySelector('a');
        return { link: link && [link.textContent, link.href, link.target, link.rel], text: cell.childNodes[0].textContent,
            notes: cell.querySelectorAll('div').map(node => node.textContent), button: cell.querySelector('button') };
    };
    return { $, document, rows, location, server, state };
}

test('each shipment\'s location links by its status: loading location, tracker GPS or delivery location', async () => {
    const page = await openPage({ role: 'field_worker' });
    assert.deepEqual(page.rows().map(row => row.slice(0, 7)), [
        ['Cargo 1', 'ROAD', 'DIRECT SHIP', 'Nederland, TX', 'Freeport, TX', 'Oct 31, 2026', 'Not RTS'],
        ['<img src=x onerror=alert(1)> crate', 'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'Freeport, TX', 'Oct 31, 2026', 'RTS'],
        ['MCC Crates', 'ROAD', 'OUTSIDE SHOP', 'Port Arthur, TX', 'Freeport, TX', 'Oct 31, 2026', 'In Transit'],
        ['Fuel pump skid', 'ROAD', 'DIRECT SHIP', 'Port Arthur, TX', 'Freeport, TX', 'Oct 31, 2026', 'In Transit'],
        ['Cargo 5', 'ROAD', 'DIRECT SHIP', 'Port Arthur, TX', 'Sulzer Grayson', 'Oct 31, 2026', 'Delivered'],
        ['Valve crate', 'ROAD', 'DIRECT SHIP', 'Port Arthur, TX', 'Freeport, TX', 'Oct 31, 2026', 'Delivered'],
    ], 'markup in imported text shows as text, the other project\'s shipment isn\'t read, and a date stays the date it is');
    assert.deepEqual(page.location('SHP-1'), { link: ['Nederland, TX', search('Nederland, TX'), '_blank', 'noopener noreferrer'], text: 'Nederland, TX', notes: ['Loading location'], button: null });
    assert.deepEqual(page.location('SHP-2').link, ['IMTT BAYONNE', search('40.6539,-74.1027'), '_blank', 'noopener noreferrer'], 'a place with a map point opens at its point');
    assert.deepEqual(page.location('SHP-3'), { link: ['Tracker One', 'samsara-tracking.html?tracker=trk-1', '_blank', 'noopener noreferrer'], text: 'Tracker One',
        notes: ['Live GPS · seen 2 hours ago'], button: null });
    assert.deepEqual(page.location('SHP-4'), { link: null, text: 'No tracker linked', notes: ['On the way to Freeport, TX'], button: null }, 'an ended link is no link');
    assert.deepEqual(page.location('SHP-5'), { link: ['Sulzer Grayson', search('SULZER GRAYSON, La Porte, TX'), '_blank', 'noopener noreferrer'], text: 'Sulzer Grayson',
        notes: ['Delivery location · Laydown Area A'], button: null }, 'a place without a point is searched by its address');
    assert.deepEqual(page.location('SHP-6'), { link: ['Freeport, TX', search('Freeport, TX'), '_blank', 'noopener noreferrer'], text: 'Freeport, TX',
        notes: ['Delivery location', 'Tracker: Tracker Two'], button: null }, 'a retired place isn\'t used, and a tracker still on a delivered shipment is named');
    assert.equal(page.document.body.querySelectorAll('button').filter(node => node.className.includes('shipment-tracker-action')).length, 0, 'field workers change no links');
    assert.deepEqual(['kpiTotal', 'kpiNotShipped', 'kpiInTransit', 'kpiDelivered', 'rowCount'].map(id => page.$(id).textContent), ['6', '2', '2', '2', '6 records']);
    assert.deepEqual(JSON.parse(JSON.stringify(page.server.log.map(request => [request.table, request.filters]))), [
        ['shipments', [['project_id', P]]], ['places', [['is_active', true]]], ['vw_active_samsara_trackers', [['project_id', P]]], ['shipment_trackers', [['project_id', P], ['ended_at', null]]],
    ], 'places are shared, so read without the project scope; the rest through it');
    assert.equal(page.$('pageMessage').textContent, '');
});

test('filters narrow the table and the totals', async () => {
    const page = await openPage();
    page.$('filterStatus').value = 'Delivered'; page.$('filterStatus').dispatch('change');
    assert.deepEqual(page.rows().map(row => row[0]), ['Cargo 5', 'Valve crate']);
    assert.deepEqual(['kpiTotal', 'kpiNotShipped', 'kpiDelivered', 'rowCount'].map(id => page.$(id).textContent), ['2', '0', '2', '2 records']);
    page.$('filterStatus').value = ''; page.$('filterSearch').value = 'PUMP'; page.$('filterSearch').dispatch('input');
    assert.deepEqual(page.rows().map(row => row[0]), ['Fuel pump skid']);
    page.$('filterSearch').value = 'nothing like this'; page.$('filterSearch').dispatch('input');
    assert.deepEqual(page.rows(), [['No shipments match the current filters.']]);
    assert.equal(page.$('rowCount').textContent, '0 records');
});

test('office staff link a tracker to a shipment that is ready or on its way, and a tracker on another shipment moves only when they say so', async () => {
    const page = await openPage();
    assert.equal(page.location('SHP-1').button, null, 'not ready to ship: no tracker yet');
    assert.equal(page.location('SHP-2').button.textContent, 'Link tracker');
    assert.equal(page.location('SHP-3').button.textContent, 'Change tracker');
    assert.equal(page.location('SHP-5').button, null, 'delivered with no tracker: nothing to change');
    assert.equal(page.location('SHP-6').button.textContent, 'Change tracker', 'a tracker still on a delivered shipment can be taken off');
    const opener = page.location('SHP-4').button;
    assert.equal(opener.getAttribute('aria-label'), 'Link a tracker to shipment SHP-4');
    opener.click();
    await settle();
    const dialog = page.$('trackerDialog'), choice = page.$('trackerChoice');
    assert.equal(dialog.open, true);
    assertFocus(page, choice, 'the tracker list has focus');
    assert.equal(page.$('trackerTitle').textContent, 'Tracker for shipment SHP-4');
    assert.deepEqual(choice.options.map(option => option.textContent), ['Choose a tracker', 'Tracker One · seen 2 hours ago · on SHP-3', 'Tracker Three · not seen yet',
        'Tracker Two · seen 10 days ago · on SHP-6'], 'only this project\'s trackers, each saying where it is');
    assert.equal(page.$('trackerSave').disabled, true, 'nothing chosen yet');
    choice.value = 'trk-1'; choice.dispatch('change');
    assert.equal(page.$('trackerMoveNote').textContent, 'Tracker One is on SHP-3. Linking it here takes it off that shipment.');
    assert.equal(page.$('trackerSave').textContent, 'Move tracker here');
    page.$('trackerSave').click();
    await settle();
    assert.deepEqual(page.server.calls, [['link_shipment_tracker', { p_shipment_id: 4, p_tracker_id: 'trk-1', p_move: true }]]);
    assert.equal(dialog.open, false);
    assert.equal(page.$('pageMessage').textContent, 'Tracker One is linked to shipment SHP-4, and no longer to SHP-3.');
    assert.deepEqual(page.location('SHP-4').link, ['Tracker One', 'samsara-tracking.html?tracker=trk-1', '_blank', 'noopener noreferrer']);
    assert.deepEqual([page.location('SHP-3').text, page.location('SHP-3').button.textContent], ['No tracker linked', 'Link tracker']);
    assertFocus(page, page.location('SHP-4').button, 'focus returns to the shipment\'s button');
    // A free tracker links without a move.
    page.location('SHP-2').button.click();
    await settle();
    page.$('trackerChoice').value = 'trk-3'; page.$('trackerChoice').dispatch('change');
    assert.deepEqual([page.$('trackerMoveNote').hidden, page.$('trackerSave').textContent], [true, 'Link tracker']);
    page.$('trackerSave').click();
    await settle();
    assert.deepEqual(page.server.calls[1], ['link_shipment_tracker', { p_shipment_id: 2, p_tracker_id: 'trk-3', p_move: false }]);
    assert.deepEqual(page.location('SHP-2').notes, ['Loading location', 'Tracker: Tracker Three'], 'ready to ship: still at its loading location, with its tracker named');
});

test('a tracker someone else linked meanwhile: the refusal re-reads the links and offers the move', async () => {
    const page = await openPage();
    page.location('SHP-4').button.click();
    await settle();
    page.$('trackerChoice').value = 'trk-3'; page.$('trackerChoice').dispatch('change');
    // Meanwhile, another office user puts Tracker Three on SHP-2.
    page.state.links.push({ id: 'lx', project_id: P, shipment_id: 2, tracker_id: 'trk-3', linked_at: new Date().toISOString(), ended_at: null });
    page.$('trackerSave').click();
    await settle();
    assert.deepEqual(page.server.calls, [['link_shipment_tracker', { p_shipment_id: 4, p_tracker_id: 'trk-3', p_move: false }]]);
    assert.equal(page.$('trackerDialog').open, true);
    assert.equal(page.$('trackerStatus').textContent, 'Tracker Tracker Three is on shipment SHP-2. Move it to this shipment?');
    assert.deepEqual([page.$('trackerChoice').value, page.$('trackerSave').textContent, page.$('trackerMoveNote').textContent],
        ['trk-3', 'Move tracker here', 'Tracker Three is on SHP-2. Linking it here takes it off that shipment.'], 'the choice is kept and the move is offered');
    assert.deepEqual(page.location('SHP-2').notes, ['Loading location', 'Tracker: Tracker Three'], 'the table shows the link that was made meanwhile');
    page.$('trackerSave').click();
    await settle();
    assert.deepEqual(page.server.calls[1], ['link_shipment_tracker', { p_shipment_id: 4, p_tracker_id: 'trk-3', p_move: true }]);
    assert.equal(page.location('SHP-4').text, 'Tracker Three');
    assert.deepEqual(page.location('SHP-4').notes, ['No GPS position yet'], 'a tracker that hasn\'t reported isn\'t a link');
});

test('unlinking names the tracker the page showed; the dialog stays open while it saves', async () => {
    const page = await openPage({ prepare: server => { server.paused = true; } });
    for (let i = 0; i < 4; i++) { page.server.step(); await settle(); }
    page.server.paused = false;
    page.location('SHP-6').button.click();
    await settle();
    assert.equal(page.$('trackerContent').querySelector('p').textContent, 'Valve crate · Delivered');
    const unlink = page.$('trackerContent').querySelectorAll('button').find(node => node.textContent === 'Unlink tracker');
    page.server.paused = true;
    unlink.click();
    await settle();
    page.$('trackerDialog').escape();
    page.$('trackerDialog').escape({ activated: false });
    assert.equal(page.$('trackerDialog').open, true, 'Escape doesn\'t close it mid-save');
    assert.equal(page.$('trackerStatus').textContent, 'Still saving. Try again in a moment.');
    assert.ok(page.$('trackerContent').querySelectorAll('button').every(node => node.disabled), 'its buttons wait too');
    page.server.paused = false;
    page.server.step();
    await settle();
    assert.deepEqual(page.server.calls, [['unlink_shipment_tracker', { p_shipment_id: 6, p_tracker_id: 'trk-2' }]]);
    assert.equal(page.$('trackerDialog').open, false);
    assert.equal(page.$('pageMessage').textContent, 'Tracker Two is no longer linked to shipment SHP-6.');
    assert.deepEqual(page.location('SHP-6').notes, ['Delivery location']);
    assert.equal(page.location('SHP-6').button, null);
});

test('a refused unlink says why and shows the tracker now on the shipment', async () => {
    const page = await openPage();
    page.location('SHP-3').button.click();
    await settle();
    // Meanwhile, Tracker Three replaces Tracker One on SHP-3.
    Object.assign(page.state.links[0], { ended_at: new Date().toISOString() });
    page.state.links.push({ id: 'lx', project_id: P, shipment_id: 3, tracker_id: 'trk-3', linked_at: new Date().toISOString(), ended_at: null });
    page.$('trackerContent').querySelectorAll('button').find(node => node.textContent === 'Unlink tracker').click();
    await settle();
    assert.equal(page.$('trackerStatus').textContent, 'The tracker on shipment SHP-3 has changed since you opened it; open it again');
    assert.match(page.$('trackerContent').querySelectorAll('p')[1].textContent, /^Linked now: Tracker Three, since /);
});

test('without migration 026 the locations still work, and no one is offered a tracker link', async () => {
    const page = await openPage({ prepare: server => {
        server.fail = request => request.table === 'shipment_trackers' ? { code: 'PGRST205', message: 'Could not find the table public.shipment_trackers in the schema cache' } : null;
    } });
    assert.equal(page.$('pageMessage').textContent, 'Tracker links couldn\'t be loaded: Tracker links are not set up in this database yet (migration 026).');
    assert.deepEqual(page.location('SHP-3'), { link: null, text: 'Tracker link unavailable', notes: [], button: null }, 'unread links aren\'t "no tracker"');
    assert.deepEqual(page.location('SHP-1').link, ['Nederland, TX', search('Nederland, TX'), '_blank', 'noopener noreferrer']);
    assert.equal(page.document.body.querySelectorAll('button').filter(node => node.className.includes('shipment-tracker-action')).length, 0);
});

test('a failed read of tracker positions still links to the GPS map; a failed read of shipments says so', async () => {
    const page = await openPage({ prepare: server => { server.fail = request => request.table === 'vw_active_samsara_trackers' ? { message: 'Fixture source unavailable' } : null; } });
    assert.equal(page.$('pageMessage').textContent, 'Tracker positions couldn’t be loaded; GPS links still open the GPS Tracking map.');
    assert.deepEqual(page.location('SHP-3').link, ['trk-1', 'samsara-tracking.html?tracker=trk-1', '_blank', 'noopener noreferrer']);
    const broken = await openPage({ prepare: server => { server.fail = request => request.table === 'shipments' ? { message: 'Fixture source unavailable' } : null; } });
    assert.deepEqual(broken.rows(), [['Failed to load shipment data.']]);
});

test('on a completed project, office staff see the links but change none', async () => {
    const page = await openPage({ projectStatus: 'completed' });
    assert.equal(page.location('SHP-3').text, 'Tracker One');
    assert.equal(page.document.body.querySelectorAll('button').filter(node => node.className.includes('shipment-tracker-action')).length, 0);
});

test('the page loads its helper first, scopes tracker links to the project and never parses HTML', () => {
    const html = fs.readFileSync('shipment-visibility.html', 'utf8');
    assert.ok(html.indexOf('js/utils/shipment-location.js?v=') > 0 && html.indexOf('js/utils/shipment-location.js?v=') < html.indexOf('src="shipment-visibility.js?v='), 'helper before the page script');
    assert.match(html, /<th>Status<\/th>\s*<th>Location<\/th>/);
    assert.match(html, /<dialog id="trackerDialog" class="review-drawer" aria-labelledby="trackerTitle">/);
    assert.match(html, /<p id="pageMessage" class="small" role="status" aria-live="polite" tabindex="-1">/);
    assert.equal((html.match(/<script>/g) || []).length, 1, 'only the shared theme snippet is inline');
    for (const file of ['shipment-visibility.js', 'js/utils/shipment-location.js']) {
        const js = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, `${file} never parses strings as HTML`);
        assert.doesNotMatch(js, /console\./, `${file} logs nothing`);
    }
    const js = fs.readFileSync('shipment-visibility.js', 'utf8');
    assert.doesNotMatch(js, /\.(insert|update|upsert|delete)\(/, 'links change only through the two functions');
    assert.match(js, /rpc\('link_shipment_tracker', \{ p_shipment_id: shipment\.id, p_tracker_id: choice\.id, p_move: Boolean\(choice\.elsewhere\) \}\)/);
    assert.match(js, /rpc\('unlink_shipment_tracker', \{ p_shipment_id: shipment\.id, p_tracker_id: linked\.tracker_id \}\)/);
    assert.equal(isProjectScopedTable('shipment_trackers'), true);
    assert.doesNotMatch(fs.readFileSync('js/utils/shipment-location.js', 'utf8').replace(/^.*MAP_SEARCH = .*$/m, ''), /google/i, 'the map is named in one place only');
});

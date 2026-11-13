const test = require('node:test');
const assert = require('node:assert/strict');
const where = require('../js/utils/shipment-location');

const NOW = Date.parse('2026-11-13T18:00:00Z');
const ago = hours => new Date(NOW - hours * 3600 * 1000).toISOString();
const search = text => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
const place = (name, extra = {}) => ({ id: name, name, project_id: null, is_active: true, address: null, city: null, state: null, postal_code: null, latitude: null, longitude: null, ...extra });
const PLACES = [
    place('Fixture Machine Works', { address: '48 Example Ave', city: 'Houston', state: 'TX', postal_code: '77002', latitude: 29.7521, longitude: -95.3612 }),
    place('Gulf Valve Supply', { city: 'Pasadena', state: 'TX' }),
    place('Bare Shop'),
    place('Old Pipe Yard', { is_active: false, latitude: 29.1, longitude: -95.4 }),
    place('North Yard', { project_id: 'p1', latitude: 28.95, longitude: -95.36 }),
    place('West Yard', { project_id: 'p9', latitude: 29.04, longitude: -95.7 }),
];
const byName = where.placesByName(PLACES, 'p1');

test('statuses from the shipment log sort into loading, on the way and delivered, whatever their capitals and spacing', () => {
    assert.deepEqual(['Not RTS', ' rts ', 'In  Transit', 'DELIVERED', 'Not Ready', '', null].map(where.stageOf),
        ['loading', 'loading', 'transit', 'delivered', null, null, null]);
    assert.deepEqual(['RTS', 'in transit', 'Not RTS', 'Delivered', ''].map(where.linkable), [true, true, false, false, false],
        'a tracker is linked once a shipment is ready to ship, or on its way');
});

test('map links show a point or search for text, through one map', () => {
    assert.equal(where.mapUrl({ latitude: 29.7521, longitude: -95.3612 }), search('29.7521,-95.3612'));
    assert.equal(where.mapUrl({ latitude: '0', longitude: 0 }), search('0,0'), 'zero is a coordinate');
    assert.equal(where.mapUrl({ latitude: 29.7, longitude: null, query: 'Nederland, TX' }), search('Nederland, TX'), 'half a point is no point');
    assert.equal(where.mapUrl({ query: '  Port   Arthur, TX & co ' }), search('Port Arthur, TX & co'));
    assert.equal(where.mapUrl({ query: ' ' }), null);
});

test('places match by name ignoring case and spacing; retired places and other projects\' yards are left out', () => {
    assert.equal(byName.get('fixture machine works').id, 'Fixture Machine Works');
    assert.equal(byName.get('north yard').id, 'North Yard', 'this project\'s own yard');
    assert.ok(!byName.has('old pipe yard') && !byName.has('west yard'));
    assert.deepEqual(where.fixedLocation('  FIXTURE   machine works ', byName), { label: 'FIXTURE machine works', href: search('29.7521,-95.3612'), exact: true,
        title: 'Open FIXTURE machine works on a map (new tab)' }, 'a place with a map point opens at its point, named as the shipment log has it');
    assert.equal(where.fixedLocation('Gulf Valve Supply', byName).href, search('Gulf Valve Supply, Pasadena, TX'), 'without a point, its address is searched');
    assert.equal(where.fixedLocation('Bare Shop', byName).href, search('Bare Shop'), 'with neither, its name');
    assert.deepEqual(where.fixedLocation('Nederland, TX', byName), { label: 'Nederland, TX', href: search('Nederland, TX'), exact: false,
        title: 'Search a map for Nederland, TX (new tab)' }, 'text that is no place is searched as written');
    assert.equal(where.fixedLocation('Old Pipe Yard', byName).href, search('Old Pipe Yard'), 'a retired place\'s point isn\'t used');
    assert.equal(where.fixedLocation('   ', byName), null);
});

test('before a shipment leaves, it is at its loading location; once delivered, at its delivery location and storage area', () => {
    const at = shipment => where.shipmentLocation(shipment, { byName, now: NOW });
    assert.deepEqual(at({ status: 'Not RTS', origin: 'Nederland, TX', destination: 'Freeport, TX' }), { stage: 'loading', kind: 'place', label: 'Nederland, TX',
        href: search('Nederland, TX'), external: true, exact: false, caption: 'Loading location', tone: '', title: 'Search a map for Nederland, TX (new tab)' });
    assert.equal(at({ status: 'RTS', origin: null, ship_from: 'Fixture Machine Works' }).href, search('29.7521,-95.3612'), 'ship_from when there is no origin');
    const delivered = at({ status: 'Delivered', origin: 'Mobile, AL', destination: 'North Yard', storage_location: ' Laydown  Area A ' });
    assert.deepEqual([delivered.label, delivered.href, delivered.caption, delivered.exact], ['North Yard', search('28.95,-95.36'), 'Delivery location · Laydown Area A', true]);
    assert.equal(at({ status: 'Delivered', destination: '', ship_to: 'Freeport, TX' }).caption, 'Delivery location', 'ship_to when there is no destination');
    assert.deepEqual(at({ status: 'Delivered', destination: ' ' }), { stage: 'delivered', kind: 'none', label: 'No delivery location recorded', href: null, external: false,
        caption: '', tone: 'muted', title: '' });
    assert.equal(at({ status: 'Not RTS' }).label, 'No loading location recorded');
    assert.equal(at({ status: 'On hold', origin: 'Tulsa, OK' }).label, '—', 'a status the page doesn\'t know claims no location');
});

test('on the way, it is where its linked tracker last reported', () => {
    const link = { shipment_id: 1, tracker_id: 'trk 1/A' };
    const tracker = (hours, extra = {}) => ({ id: 'trk 1/A', name: 'Tracker One', last_latitude: 29.88, last_longitude: -93.94, last_seen_at: hours === null ? null : ago(hours), ...extra });
    const at = (options, shipment = { status: 'In Transit', origin: 'Port Arthur, TX', destination: 'Freeport, TX' }) => where.shipmentLocation(shipment, { byName, now: NOW, ...options });
    assert.deepEqual(at({}), { stage: 'transit', kind: 'none', label: 'No tracker linked', href: null, external: false, caption: 'On the way to Freeport, TX', tone: 'muted', title: '' });
    assert.equal(at({}, { status: 'In Transit', ship_to: 'Freeport, TX' }).caption, 'On the way to Freeport, TX');
    assert.equal(at({}, { status: 'In Transit' }).caption, '');
    const live = at({ link, tracker: tracker(2) });
    assert.deepEqual(live, { stage: 'transit', kind: 'gps', label: 'Tracker One', href: 'samsara-tracking.html?tracker=trk%201%2FA', external: false, trackerId: 'trk 1/A',
        tone: '', title: 'Show Tracker One on the GPS Tracking map (new tab)', caption: 'Live GPS · seen 2 hours ago' });
    assert.deepEqual([at({ link, tracker: tracker(72) }).caption, at({ link, tracker: tracker(72) }).tone], ['GPS · last seen 3 days ago', '']);
    assert.deepEqual([at({ link, tracker: tracker(9 * 24) }).caption, at({ link, tracker: tracker(9 * 24) }).tone], ['GPS · last seen 9 days ago', 'warn'],
        'a tracker not heard from in 7 days is flagged, as on the GPS Tracking page');
    assert.deepEqual([at({ link, tracker: tracker(null) }).caption, at({ link, tracker: tracker(null) }).tone], ['GPS · time unknown', 'warn']);
    const unplaced = at({ link, tracker: tracker(1, { last_latitude: null, last_longitude: null }) });
    assert.deepEqual([unplaced.label, unplaced.href, unplaced.caption, unplaced.tone], ['Tracker One', null, 'No GPS position yet', 'muted']);
    const unread = at({ link, tracker: null });
    assert.deepEqual([unread.label, unread.href, unread.caption], ['trk 1/A', 'samsara-tracking.html?tracker=trk%201%2FA', 'GPS'], 'unread tracker rows still link to the GPS map');
});

test('ages read as people say them', () => {
    const age = minutes => where.ageText(new Date(NOW - minutes * 60000).toISOString(), NOW);
    assert.deepEqual([0.2, 1, 59, 60, 89, 91, 23 * 60, 24 * 60, 36 * 60, 9 * 24 * 60, -5].map(age),
        ['just now', '1 minute ago', '59 minutes ago', '1 hour ago', '1 hour ago', '2 hours ago', '23 hours ago', '1 day ago', '2 days ago', '9 days ago', 'just now']);
    assert.equal(where.ageText('not a time', NOW), '');
});

test('the tracker list is in name order and says when each was seen and which shipment has it', () => {
    const trackers = [{ id: 't10', name: 'Tracker 10', last_seen_at: ago(1) }, { id: 't2', name: 'Tracker 2', last_seen_at: null }, { id: 'tx', name: ' ', last_seen_at: ago(50) },
        { id: 't3', name: 'tracker 3', last_seen_at: ago(0) }];
    const links = [{ shipment_id: 7, tracker_id: 't10' }, { shipment_id: 8, tracker_id: 't3' }, { shipment_id: 9, tracker_id: 'tx' }];
    const choices = where.trackerChoices(trackers, links, new Map([[7, 'SHP-7'], [8, 'SHP-8']]), 8, NOW);
    assert.deepEqual(choices.map(choice => [choice.id, choice.text, choice.here, choice.elsewhere]), [
        ['t2', 'Tracker 2 · not seen yet', false, null],
        ['t3', 'tracker 3 · seen just now · on this shipment', true, null],
        ['t10', 'Tracker 10 · seen 1 hour ago · on SHP-7', false, 'SHP-7'],
        ['tx', 'tx · seen 2 days ago · on shipment #9', false, 'shipment #9'],
    ]);
});

test('errors say what to do', () => {
    for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) assert.equal(where.errorMessage({ code, message: 'x' }), 'Tracker links are not set up in this database yet (migration 026).');
    assert.equal(where.errorMessage({ code: '42501', message: 'permission denied for table shipment_trackers' }), 'You do not have permission to make this change.');
    assert.equal(where.errorMessage({ code: '42501', message: 'Only office staff can link a tracker to a shipment' }), 'Only office staff can link a tracker to a shipment');
    assert.equal(where.errorMessage({ code: '23505', message: 'Tracker Two is on shipment SHP-1. Move it to this shipment?' }), 'Tracker Two is on shipment SHP-1. Move it to this shipment?');
    assert.equal(where.errorMessage(new Error('Network down')), 'Network down');
});

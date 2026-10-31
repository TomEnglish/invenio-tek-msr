const test = require('node:test');
const assert = require('node:assert/strict');
const logistics = require('../js/utils/logistics-helpers');

const form = values => ({ kind: 'yard', name: 'Laydown', project_id: '', address: '', city: '', state: '', postal_code: '', latitude: '', longitude: '',
    geofence_radius_m: '', contact_name: '', contact_phone: '', contact_email: '', secondary_contact_name: '', secondary_contact_phone: '', notes: '', ...values });

test('place values: trimmed, empty optional text is null, and the radius defaults to 300', () => {
    const { values } = logistics.placeValues(form({ name: '  Laydown B ', city: ' Freeport ', notes: '   ' }));
    assert.deepEqual(values, { kind: 'yard', name: 'Laydown B', project_id: null, address: null, city: 'Freeport', state: null, postal_code: null,
        contact_name: null, contact_phone: null, contact_email: null, secondary_contact_name: null, secondary_contact_phone: null, notes: null,
        latitude: null, longitude: null, geofence_radius_m: 300 });
});

test('place values: only a yard or site keeps its project', () => {
    assert.equal(logistics.placeValues(form({ kind: 'site', project_id: 'p1' })).values.project_id, 'p1');
    for (const kind of ['outside_shop', 'vendor', 'other']) assert.equal(logistics.placeValues(form({ kind, project_id: 'p1' })).values.project_id, null, kind);
});

test('place values: a point needs both coordinates, in range, rounded to 6 places', () => {
    assert.deepEqual(logistics.placeValues(form({ latitude: '28.9542134', longitude: '-95.3596716' })).values,
        { ...logistics.placeValues(form()).values, latitude: 28.954213, longitude: -95.359672 });
    assert.deepEqual(logistics.placeValues(form({ latitude: '28.95' })), { error: 'Enter both latitude and longitude, or clear the map point.', field: 'longitude' });
    assert.equal(logistics.placeValues(form({ longitude: '-95' })).field, 'latitude');
    assert.equal(logistics.placeValues(form({ latitude: '91', longitude: '0' })).field, 'latitude');
    assert.equal(logistics.placeValues(form({ latitude: '0', longitude: '-180.5' })).field, 'longitude');
    assert.equal(logistics.placeValues(form({ latitude: 'north', longitude: '0' })).field, 'latitude');
    assert.deepEqual(logistics.placeValues(form({ latitude: '-90', longitude: '180' })).values.latitude, -90);
});

test('place values: the radius is a whole number of metres from 25 to 20,000', () => {
    for (const ok of ['25', '20000', ' 800 ']) assert.equal(logistics.placeValues(form({ geofence_radius_m: ok })).values.geofence_radius_m, Number(ok), ok);
    for (const bad of ['24', '20001', '12.5', 'wide', '-300']) {
        assert.deepEqual(logistics.placeValues(form({ geofence_radius_m: bad })), { error: 'Arrival radius must be a whole number of metres from 25 to 20,000.', field: 'geofence_radius_m' }, bad);
    }
});

test('place values: kind and name are required, and text keeps to 021\'s column limits', () => {
    assert.equal(logistics.placeValues(form({ kind: '' })).field, 'kind');
    assert.equal(logistics.placeValues(form({ kind: 'warehouse' })).field, 'kind');
    assert.deepEqual(logistics.placeValues(form({ name: '   ' })), { error: 'Enter a name.', field: 'name' });
    assert.equal(logistics.placeValues(form({ name: 'x'.repeat(120) })).values.name.length, 120);
    assert.equal(logistics.placeValues(form({ name: 'x'.repeat(121) })).field, 'name');
    for (const [key, [, max]] of Object.entries(logistics.PLACE_TEXT)) {
        const value = key === 'contact_email' ? `${'a'.repeat(max - 12)}@example.com` : 'x'.repeat(max);
        assert.equal(logistics.placeValues(form({ [key]: value })).values[key], value, `${key} at ${max}`);
        assert.equal(logistics.placeValues(form({ [key]: value + 'x' })).field, key, `${key} over ${max}`);
    }
    assert.deepEqual(logistics.placeValues(form({ contact_email: 'sam at shop' })), { error: 'Enter a contact email like name@example.com.', field: 'contact_email' });
});

test('places filter by kind, active or retired, and words in the name, address or contacts', () => {
    const places = [
        { id: 1, name: 'b Yard', kind: 'yard', city: 'Freeport', is_active: true },
        { id: 2, name: 'A shop', kind: 'outside_shop', city: 'Houston', contact_name: 'Sam Rivera', is_active: true },
        { id: 3, name: 'Old yard', kind: 'yard', is_active: false },
        { id: 4, name: 'C vendor', kind: 'vendor', secondary_contact_name: 'Lee Chen' },
    ];
    const ids = options => logistics.filterPlaces(places, options).map(place => place.id);
    assert.deepEqual(ids(), [2, 1, 4], 'active, by name ignoring case; no is_active counts as active');
    assert.deepEqual(ids({ retired: true }), [3]);
    assert.deepEqual(ids({ kind: 'yard' }), [1]);
    assert.deepEqual(ids({ search: 'houston sam' }), [2]);
    assert.deepEqual(ids({ search: 'CHEN' }), [4]);
    assert.deepEqual(ids({ search: 'freeport', kind: 'vendor' }), []);
    assert.equal(logistics.placeAddress({ address: '1 Main St', city: 'Freeport', state: 'TX', postal_code: '77541' }), '1 Main St, Freeport, TX 77541');
    assert.equal(logistics.placeAddress({ postal_code: '77541' }), '77541');
    assert.equal(logistics.hasPoint({ latitude: 0, longitude: 0 }), true, 'zero is a coordinate');
    assert.equal(logistics.hasPoint({ latitude: null, longitude: null }), false);
});

test('crates filter by status and by code typed any way, or by description', () => {
    const units = [{ code: 'HU-7K3QX9', status: 'open', description: 'Pump spares' }, { code: 'HU-22AB', status: 'sealed' }, { code: 'HU-10AB', status: 'open' }];
    const codes = options => logistics.filterUnits(units, options).map(unit => unit.code);
    assert.deepEqual(codes(), ['HU-7K3QX9', 'HU-10AB', 'HU-22AB'], 'by code, numbers by value');
    assert.deepEqual(codes({ status: 'open' }), ['HU-7K3QX9', 'HU-10AB']);
    for (const search of ['7k3', ' hu-7k3qx9 ', 'HU-7K3 QX9', 'pump']) assert.deepEqual(codes({ search }), ['HU-7K3QX9'], search);
    assert.deepEqual(codes({ search: 'ab', status: 'sealed' }), ['HU-22AB']);
    assert.equal(logistics.normaliseCode(' hu-7k3 qx9 '), 'HU-7K3QX9');
});

test('crate text: where it is, and what it holds', () => {
    assert.equal(logistics.unitWhere({ place_name: 'North Yard', location: 'T1 › Rack 2' }), 'North Yard · T1 › Rack 2');
    assert.equal(logistics.unitWhere({ place_name: null, location: null }), '');
    assert.equal(logistics.contentsText({ item_count: 1, unit_count: 0 }), '1 item');
    assert.equal(logistics.contentsText({ item_count: 2, unit_count: 1 }), '2 items, 1 crate');
    assert.equal(logistics.contentsText({ item_count: 0, unit_count: 3 }), '3 crates');
    assert.equal(logistics.contentsText({ item_count: 0, unit_count: 0 }), 'Empty');
    assert.deepEqual(Object.keys(logistics.UNIT_STATUS), ['open', 'sealed', 'on_load', 'delivered', 'unpacked', 'missing'], '021 statuses, and 022\'s missing');
    assert.deepEqual(Object.keys(logistics.UNIT_KINDS), ['crate', 'skid', 'bundle', 'basket', 'container', 'other'], '021 kinds');
    assert.deepEqual(Object.keys(logistics.PLACE_KINDS), ['yard', 'site', 'outside_shop', 'vendor', 'other'], '021 kinds');
});

test('label count is a whole number from 1 to 500, as reserve_handling_unit_labels allows', () => {
    for (const [text, count] of [['1', 1], [' 6 ', 6], ['500', 500]]) assert.deepEqual(logistics.labelCount(text), { count }, text);
    for (const text of ['0', '501', '2.5', '-1', '', 'ten', '1e2']) assert.deepEqual(logistics.labelCount(text), { error: 'Enter a whole number of labels from 1 to 500.' }, text);
});

test('QR path: one unit square per dark module, columns across and rows down, inside a 4-module quiet zone', () => {
    // A 3×3 code with dark modules at (row 0, column 2) and (row 2, column 0).
    const dark = new Set(['0,2', '2,0']);
    const { size, path } = logistics.qrPath({ getModuleCount: () => 3, isDark: (row, column) => dark.has(`${row},${column}`) });
    assert.equal(size, 11);
    assert.equal(path, 'M6 4h1v1h-1zM4 6h1v1h-1z');
    assert.equal(logistics.qrPath({ getModuleCount: () => 2, isDark: () => true }, 0).path, 'M0 0h1v1h-1zM1 0h1v1h-1zM0 1h1v1h-1zM1 1h1v1h-1z');
});

test('error text names migration 021 when it is missing and keeps the database\'s own reasons', () => {
    assert.equal(logistics.errorMessage({ code: 'PGRST205', message: 'Could not find the table' }), 'Places and crates are not set up in this database yet (migration 021).');
    assert.equal(logistics.errorMessage({ code: '23505', message: 'duplicate key' }, 'Taken.'), 'Taken.');
    assert.equal(logistics.errorMessage({ code: '42501', message: 'new row violates row-level security policy for table "places"' }), 'You do not have permission to make this change.');
    assert.equal(logistics.errorMessage({ code: '42501', message: 'Office access to an active project is required' }), 'Office access to an active project is required');
    assert.equal(logistics.errorMessage(new Error('Network down')), 'Network down');
});

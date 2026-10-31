const test = require('node:test');
const assert = require('node:assert/strict');
const loads = require('../js/utils/loads-helpers');

const load = (number, status, extra = {}) => ({ load_number: number, status, planned_date: null, planned_count: 0, on_board_count: 0, delivered_count: 0, missing_count: 0, ...extra });

test('the board has a column per open status, newest planned first; closed and cancelled are a separate list', () => {
    const rows = [load('L-0001', 'planning', { planned_date: '2026-11-01' }), load('L-0002', 'planning', { planned_date: '2026-11-05' }), load('L-0003', 'in_transit'),
        load('L-0004', 'closed'), load('L-0005', 'cancelled'), load('L-0006', 'delivered'), load('L-0007', 'planning')];
    const board = loads.boardGroups(rows);
    assert.deepEqual(board.map(group => [group.status, group.label, group.loads.map(row => row.load_number)]), [
        ['planning', 'Planning', ['L-0002', 'L-0001', 'L-0007']], ['loading', 'Loading', []], ['in_transit', 'In transit', ['L-0003']], ['delivered', 'Delivered', ['L-0006']]]);
    assert.deepEqual(loads.boardGroups(rows, { finished: true }).map(group => group.loads.map(row => row.load_number)), [['L-0005', 'L-0004']]);
});

test('a card lists the piece counts that are not zero', () => {
    assert.deepEqual(loads.cardCounts(load('L-1', 'in_transit', { on_board_count: 3, delivered_count: 1200, missing_count: 1 })), ['On board 3', 'Delivered 1,200', 'Missing 1']);
    assert.deepEqual(loads.cardCounts(load('L-1', 'planning')), []);
});

test('details: every key is sent trimmed, so clearing a field clears it; dates and 022 limits are checked', () => {
    const { payload } = loads.detailsPayload({ originPlaceId: 'p1', plannedDate: '2026-11-30', truckType: ' Flatbed ', driverName: 'Dana', notes: '' });
    assert.deepEqual(payload, { originPlaceId: 'p1', plannedDate: '2026-11-30', truckType: 'Flatbed', truckNumber: '', trailerNumber: '', bolNumber: '', driverName: 'Dana', driverPhone: '', notes: '' });
    assert.deepEqual(loads.detailsPayload({ plannedDate: '2026-02-30' }), { error: 'Planned date must be a date like 2026-11-30.', field: 'plannedDate' });
    assert.deepEqual(loads.detailsPayload({ driverPhone: 'x'.repeat(41) }), { error: 'Driver phone is too long (at most 40 characters).', field: 'driverPhone' });
    for (const [key, , , max] of loads.LOAD_TEXT) {
        assert.equal(loads.detailsPayload({ [key]: 'x'.repeat(max) }).payload[key].length, max, key);
        assert.equal(loads.detailsPayload({ [key]: 'x'.repeat(max + 1) }).field, key, key);
    }
});

test('companies: empty rows drop out, a row with anything needs a name, roles are 022\'s, at most 3', () => {
    const row = (name, extra = {}) => ({ name, role: 'carrier', contactName: '', phone: '', ...extra });
    assert.deepEqual(loads.companiesPayload([row(' Haul Co '), row(''), row('Brokers', { role: 'broker', phone: ' 555 ' })]).companies,
        [{ name: 'Haul Co', role: 'carrier', contactName: '', phone: '' }, { name: 'Brokers', role: 'broker', contactName: '', phone: '555' }]);
    assert.deepEqual(loads.companiesPayload([row('A'), row('', { phone: '555' })]), { error: 'Company 2 needs a name.', index: 1, field: 'name' });
    assert.equal(loads.companiesPayload([row('A', { role: 'owner' })]).field, 'role');
    assert.deepEqual(loads.companiesPayload([row('A'), row('B'), row('C'), row('D')]), { error: 'Add up to 3 companies.' });
});

test('stops keep their own IDs, need a place, and have a kind and an optional date', () => {
    assert.deepEqual(loads.stopsPayload([{ id: 's1', placeId: 'p1', kind: 'both', plannedDate: '2026-11-30' }, { id: 's2', placeId: 'p2', kind: '', plannedDate: '' }]).stops,
        [{ id: 's1', placeId: 'p1', kind: 'both', plannedDate: '2026-11-30' }, { id: 's2', placeId: 'p2', kind: 'dropoff', plannedDate: null }]);
    assert.deepEqual(loads.stopsPayload([{ id: 's1', placeId: '' }]), { error: 'Choose a place for stop 1.', index: 0, field: 'placeId' });
    assert.equal(loads.stopsPayload([{ id: 's1', placeId: 'p1', kind: 'drop' }]).field, 'kind');
    assert.equal(loads.stopsPayload([{ id: 's1', placeId: 'p1', plannedDate: '30/11/2026' }]).field, 'plannedDate');
    assert.deepEqual(loads.stopsPayload(Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, placeId: 'p' }))), { error: 'A load can have at most 20 stops.' });
    assert.deepEqual(loads.moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
    assert.deepEqual(loads.moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
    assert.deepEqual(loads.moveItem(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
});

test('the manifest groups lines by drop-off stop in stop order, leaves out removed pieces, and keeps lines of cancelled stops', () => {
    const stops = [{ id: 's2', seq: 2 }, { id: 's1', seq: 1 }];
    const lines = [{ tag: 'B-10', dropoff_stop_id: 's1', status: 'planned' }, { tag: 'B-9', dropoff_stop_id: 's1', status: 'missing' }, { tag: 'A', dropoff_stop_id: 's2', status: 'removed' },
        { tag: 'C', dropoff_stop_id: 'gone', status: 'not_loaded' }];
    assert.deepEqual(loads.manifestByStop(stops, lines).map(group => [group.stop?.id ?? null, group.lines.map(line => line.tag)]), [['s1', ['B-9', 'B-10']], ['s2', []], [null, ['C']]]);
    assert.deepEqual(lines.filter(loads.printable).map(line => line.tag), ['B-10', 'B-9']);
});

test('licence values are normalised and checked as 022 stores them', () => {
    assert.deepEqual(loads.licenceValues({ number: ' d123  4567 ', state: ' TX ', expiry: '2028-04-30' }), { licence: { number: 'D123 4567', state: 'TX', expiry: '2028-04-30' } });
    assert.deepEqual(loads.licenceValues({ number: 'D1' }), { error: 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes.', field: 'number' });
    for (const bad of ['-D123', 'D12/34', 'x'.repeat(41)]) assert.equal(loads.licenceValues({ number: bad }).field, 'number', bad);
    assert.equal(loads.licenceValues({ number: 'D123', state: 'x'.repeat(41) }).field, 'state');
    assert.equal(loads.licenceValues({ number: 'D123', expiry: '2028-13-01' }).field, 'expiry');
    assert.deepEqual(loads.licenceValues({ number: 'D123' }).licence, { number: 'D123', state: null, expiry: null });
});

test('a licence photo goes to <load id>/<new id>.jpg or .png, up to 10 MB', () => {
    assert.deepEqual(loads.licencePhotoPath('L1', { type: 'image/jpeg', size: 10 }, 'n1'), { path: 'L1/n1.jpg' });
    assert.deepEqual(loads.licencePhotoPath('L1', { type: 'image/png', size: 10 }, 'n1'), { path: 'L1/n1.png' });
    assert.deepEqual(loads.licencePhotoPath('L1', { type: 'image/heic', size: 10 }, 'n1'), { error: 'Choose a JPEG or PNG photo.' });
    assert.deepEqual(loads.licencePhotoPath('L1', { type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }, 'n1'), { error: 'That photo is over 10 MB. Choose a smaller one.' });
});

test('outside shops hold top-level delivered crates there and loose items whose current line delivered them there', () => {
    const shops = [{ id: 'shop1' }, { id: 'shop2' }];
    const units = [{ id: 'u1', code: 'HU-B', parent_id: null, status: 'delivered', place_id: 'shop1', description: 'Valves', is_high_value: true },
        { id: 'u2', code: 'HU-C', parent_id: 'u1', status: 'delivered', place_id: 'shop1' }, { id: 'u3', code: 'HU-D', parent_id: null, status: 'on_load', place_id: 'shop1' },
        { id: 'u4', code: 'HU-E', parent_id: null, status: 'delivered', place_id: 'yard' }];
    const lines = [{ unit_id: 'u1', piece_kind: 'crate', status: 'delivered', is_current_position: true, delivered_place_id: 'shop1', load_number: 'L-0003', off_at: '2026-10-19T00:00:00Z' },
        { unit_id: null, piece_kind: 'item', tag: 'T-1', name: 'Pump', status: 'delivered', is_current_position: true, delivered_place_id: 'shop1', load_number: 'L-0003' },
        { unit_id: null, piece_kind: 'item', tag: 'T-2', status: 'delivered', is_current_position: false, delivered_place_id: 'shop1' },
        { unit_id: null, piece_kind: 'item', tag: 'T-3', status: 'delivered', is_current_position: true, delivered_place_id: 'shop2' }];
    const [first, second] = loads.shopContents(shops, units, lines);
    assert.deepEqual(first.pieces.map(piece => [piece.kind, piece.code, piece.name, Boolean(piece.isHighValue), piece.line?.load_number ?? null]),
        [['crate', 'HU-B', 'Valves', true, 'L-0003'], ['item', 'T-1', 'Pump', false, 'L-0003']]);
    assert.deepEqual(second.pieces.map(piece => piece.code), ['T-3']);
    const now = Date.parse('2026-10-31T12:00:00Z');
    assert.equal(loads.daysSince('2026-10-19T00:00:00Z', now), 12);
    assert.deepEqual([0, 1, 12, null].map(loads.daysText), ['today', '1 day', '12 days', '']);
});

test('error text names migration 022 when it is missing and shows 022\'s refusals as they are', () => {
    assert.equal(loads.errorMessage({ code: 'PGRST205', message: 'Could not find the table' }), 'Loads are not set up in this database yet (migration 022).');
    assert.equal(loads.errorMessage({ code: '22023', message: 'Load L-0001 has left; its stops can\'t change' }), 'Load L-0001 has left; its stops can\'t change');
    assert.equal(loads.errorMessage({ code: '42501', message: 'Only office staff can close or cancel a load' }), 'Only office staff can close or cancel a load');
    assert.equal(loads.errorMessage({ code: '42501', message: 'permission denied for function apply_field_operation' }), 'You do not have permission to make this change.');
});

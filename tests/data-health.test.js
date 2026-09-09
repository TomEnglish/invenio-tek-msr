const test = require('node:test');
const assert = require('node:assert/strict');
const { freshness, procurementSummary, loadAllRows } = require('../js/utils/data-health.js');

test('freshness distinguishes missing, invalid, future, old and recent timestamps', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    assert.equal(freshness(null, now).status, 'missing');
    assert.equal(freshness('invalid', now).status, 'unknown');
    assert.equal(freshness('2026-09-10T12:00:00Z', now).status, 'unknown');
    assert.equal(freshness('2026-09-08T12:00:00Z', now).status, 'stale');
    assert.equal(freshness('2026-09-09T11:59:00Z', now).status, 'recent');
});

test('procurement totals count unique POs and all line values without depending on cached metrics', () => {
    const summary = procurementSummary([
        { purchase_order_id: 'PO-1', net_value: '150.25', status: 'Sent' },
        { purchase_order_id: 'PO-1', net_value: 50, status: 'Sent' },
        { purchase_order_id: 'PO-2', net_value: null, status: null },
    ], [{ status: 'Delivered' }, { status: 'In Transit' }, { status: 'Not Ready' }]);
    assert.equal(summary.procurement.total_pos, 2);
    assert.equal(summary.procurement.total_po_value, 200.25);
    assert.equal(summary.procurement.total_shipments, 3);
    assert.equal(summary.procurement.delivered_shipments, 1);
    assert.deepEqual(summary.status_counts.po_status, { Sent: 2, Unknown: 1 });
    assert.equal(procurementSummary([], []).procurement.total_pos, 0);
});

test('records beyond the API page limit are included; a failed page never returns partial totals', async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const client = {
        from() { return {
            select() { return this; }, order() { return this; },
            range(start, end) { return Promise.resolve({ data: rows.slice(start, end + 1), error: null }); },
        }; },
    };
    assert.equal((await loadAllRows(client, 'purchase_orders')).length, 1201);
    client.from = () => ({ select() { return this; }, order() { return this; },
        range(start, end) { return Promise.resolve(start ? { error: new Error('Page unavailable') } : { data: rows.slice(start, end + 1) }); },
    });
    await assert.rejects(loadAllRows(client, 'purchase_orders'), /Page unavailable/);
});

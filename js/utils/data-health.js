/* Shared record loading and data-age rules for MSR. */
(function (global) {
    const DAY_MS = 24 * 60 * 60 * 1000;

    function freshness(timestamp, now = Date.now()) {
        if (!timestamp) return { status: 'missing', label: 'No refresh recorded' };
        const age = now - Date.parse(timestamp);
        if (!Number.isFinite(age) || age < -5 * 60 * 1000) return { status: 'unknown', label: 'Check timestamp' };
        return age >= DAY_MS
            ? { status: 'stale', label: 'Older than 24 hours' }
            : { status: 'recent', label: 'Within 24 hours' };
    }

    async function loadAllRows(client, table, columns = '*') {
        const rows = [];
        const pageSize = 500;
        // Never silently report a partial total when a project exceeds this bound.
        for (let start = 0; start <= 10000; start += pageSize) {
            const { data, error } = await client.from(table).select(columns).order('id').range(start, start + pageSize - 1);
            if (error) throw error;
            rows.push(...(data || []));
            if (rows.length > 10000) throw new Error('This project exceeds the 10,000-record dashboard limit.');
            if (!data || data.length < pageSize) return rows;
        }
        throw new Error('Unable to load the complete project records.');
    }

    function statusCounts(rows) {
        const counts = new Map();
        for (const row of rows) {
            const status = row.status?.trim() || 'Unknown';
            counts.set(status, (counts.get(status) || 0) + 1);
        }
        return Object.fromEntries(counts);
    }

    function procurementSummary(purchaseOrders, shipments) {
        return {
            procurement: {
                total_pos: new Set(purchaseOrders.map(row => row.purchase_order_id).filter(Boolean)).size,
                total_po_value: purchaseOrders.reduce((sum, row) => sum + (Number(row.net_value) || 0), 0),
                total_shipments: shipments.length,
                delivered_shipments: shipments.filter(row => row.status?.trim().toLowerCase() === 'delivered').length,
            },
            status_counts: { po_status: statusCounts(purchaseOrders), shipment_status: statusCounts(shipments) },
        };
    }

    const api = { freshness, loadAllRows, procurementSummary };
    global.InvenioDataHealth = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

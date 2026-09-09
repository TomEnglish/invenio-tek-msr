/** Shared calendar and exception semantics for the dashboard and Work Inbox. */
(function (root) {
    const filters = ['open', 'mine', 'overdue', 'unassigned', 'all'];
    function localDate(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function validDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T12:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
    function applyInboxFilter(query, filter, userId, today = localDate()) {
        query = query.eq('has_exception', true);
        if (filter !== 'all') query = query.eq('exception_resolved', false);
        if (filter === 'mine') query = query.eq('exception_owner_id', userId);
        if (filter === 'overdue') query = query.lt('exception_due_date', today);
        if (filter === 'unassigned') query = query.is('exception_owner_id', null);
        return query;
    }
    function exceptionSummary(records, userId, today = localDate()) {
        const items = records.filter(r => r.has_exception === true && r.exception_resolved === false)
            .sort((a, b) => (a.exception_due_date || '9999').localeCompare(b.exception_due_date || '9999')
                || (a.created_at || '').localeCompare(b.created_at || '') || String(a.id).localeCompare(String(b.id)));
        return { items, counts: {
            open: items.length,
            mine: items.filter(r => r.exception_owner_id === userId).length,
            overdue: items.filter(r => validDate(r.exception_due_date) && r.exception_due_date < today).length,
            unassigned: items.filter(r => r.exception_owner_id == null).length,
        } };
    }
    function arrivalSummary(records, today = localDate()) {
        const end = new Date(`${today}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 7);
        const through = end.toISOString().slice(0, 10);
        const pending = records.filter(r => !['delivered', 'cancelled', 'canceled'].includes(String(r.status || '').trim().toLowerCase()));
        const dated = pending.filter(r => validDate(r.eta));
        return { through, counts: {
            late: dated.filter(r => r.eta < today).length,
            upcoming: dated.filter(r => r.eta >= today && r.eta <= through).length,
            undated: pending.length - dated.length,
        }, items: dated.filter(r => r.eta <= through).sort((a, b) => a.eta.localeCompare(b.eta) || String(a.id).localeCompare(String(b.id))) };
    }
    const api = { filters, localDate, applyInboxFilter, exceptionSummary, arrivalSummary };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.InvenioWorkSummary = api;
})(typeof window !== 'undefined' ? window : globalThis);

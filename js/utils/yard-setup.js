/**
 * Pure helpers for the Racks page and the project setup checklist (migration 030). No DOM or Supabase here, so node
 * tests can load it.
 */
(function (root) {
    // Limits from 030, with the words the form uses.
    const RACK_TEXT = { zone: 'Zone', row: 'Row', rack: 'Rack' };
    const RACK_TEXT_MAX = 60, CAPACITY_MAX = 1000000, MAX_RUN = 100;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    /** "T1 · Row 1, Rack 2", as every screen names a rack. */
    const rackLabel = rack => `${rack.zone} · Row ${rack.row}, Rack ${rack.rack}`;
    /** A rack is active unless it says otherwise, so racks read before 030 still count. */
    const isActive = rack => rack.is_active !== false;
    /** Racks that can still take stock: what a picker offers. */
    const usableRacks = racks => (racks || []).filter(isActive);

    function errorMessage(error, conflict = 'Another active rack already has that zone, row and rack.') {
        const code = error?.code, text = error?.message || String(error ?? 'Unknown error');
        if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)) return 'Racks are not set up in this database yet (migration 030).';
        // 030's own check names the rack; a plain index clash doesn't.
        if (code === '23505') return /^Another active rack/.test(text) ? `${text}.` : conflict;
        // A policy or grant refusal means "no permission"; the database's own checks say why.
        if (code === '42501') return !error?.message || /row-level security|permission denied/i.test(text) ? 'You do not have permission to make this change in this project.' : text;
        return text;
    }

    /**
     * Form text → the rows to save, or { error, field } for the first problem. One row, or a run when `rack_to` is
     * given: racks numbered from `rack` through `rack_to`, keeping any leading zeros ("01" through "12").
     */
    function rackValues(input) {
        const text = key => String(input[key] ?? '').trim();
        const base = {};
        for (const [key, label] of Object.entries(RACK_TEXT)) {
            const value = text(key);
            if (!value) return { error: `Enter the ${label.toLowerCase()}.`, field: key };
            if (value.length > RACK_TEXT_MAX) return { error: `${label} is too long (${RACK_TEXT_MAX} characters at most).`, field: key };
            base[key] = value;
        }
        base.place_id = text('place_id') || null;
        base.is_hold_area = input.is_hold_area === true;
        const capacity = text('capacity');
        base.capacity = null;
        if (capacity) {
            if (!/^\d+$/.test(capacity) || Number(capacity) < 1 || Number(capacity) > CAPACITY_MAX) {
                return { error: `Capacity must be a whole number from 1 to ${CAPACITY_MAX.toLocaleString('en-US')}, or left blank.`, field: 'capacity' };
            }
            base.capacity = Number(capacity);
        }
        const last = text('rack_to');
        if (!last) return { rows: [base] };
        if (!/^\d+$/.test(base.rack)) return { error: 'To add several racks at once, the first rack must be a number.', field: 'rack' };
        if (!/^\d+$/.test(last)) return { error: 'Enter the last rack number, or leave it blank to add one rack.', field: 'rack_to' };
        const from = Number(base.rack), to = Number(last);
        if (to < from) return { error: 'The last rack number must not be lower than the first.', field: 'rack_to' };
        if (to - from + 1 > MAX_RUN) return { error: `Add at most ${MAX_RUN} racks at a time.`, field: 'rack_to' };
        const width = /^0\d/.test(base.rack) ? base.rack.length : 0;
        const rows = [];
        for (let number = from; number <= to; number++) rows.push({ ...base, rack: String(number).padStart(width, '0') });
        return { rows };
    }

    /**
     * Racks at one yard (`place`: an id, 'none' for racks with no yard yet, or '' for all), active or retired,
     * whose name, yard or area contains every search word, in zone, row and rack order.
     */
    function filterRacks(racks, { place = '', retired = false, search = '', describe = () => '' } = {}) {
        const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return racks.filter(rack => !isActive(rack) === retired
            && (!place || (place === 'none' ? !rack.place_id : rack.place_id === place))
            && words.every(word => `${rackLabel(rack)} ${describe(rack)}`.toLowerCase().includes(word)))
            .sort((a, b) => collator.compare(a.zone, b.zone) || collator.compare(a.row, b.row) || collator.compare(a.rack, b.rack));
    }

    const plural = (count, one, many) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

    /**
     * What a project has of what it needs before work can start, from 030's project_setup_status row: four steps,
     * each { key, done, title, detail, href, action }. Links carry the project, so they open on the right one.
     */
    function setupSteps(status, projectId = status?.project_id) {
        const count = key => Number(status?.[key]) || 0;
        const to = page => `${page}${page.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectId || '')}`;
        const own = count('own_yards'), shared = count('shared_yards'), racks = count('racks'), hold = count('hold_racks'), plans = count('site_plans');
        return [
            { key: 'yard', done: own > 0, title: 'A yard or site',
                detail: own ? `${plural(own, 'yard or site', 'yards or sites')} of its own.`
                    : shared ? `No yard or site of its own yet. ${plural(shared, 'shared yard or site is', 'shared yards or sites are')} available to every project.`
                        : 'No yard or site yet. Crates and loads need a place to be at.',
                href: to('places.html?add=yard'), action: 'Add a yard or site' },
            { key: 'racks', done: racks > 0, title: 'Racks',
                detail: racks ? `${plural(racks, 'active rack', 'active racks')}.` : 'No racks yet. Nothing can be received until the project has a rack.',
                href: to('racks.html'), action: 'Add racks' },
            { key: 'hold', done: hold > 0, title: 'A hold-area rack',
                detail: hold ? `${plural(hold, 'hold-area rack', 'hold-area racks')}.` : 'No hold-area rack yet. Stock put on hold needs one to go to.',
                href: to('racks.html'), action: 'Add a hold-area rack' },
            { key: 'plan', done: plans > 0, title: 'A site plan',
                detail: plans ? `${plural(plans, 'active site plan', 'active site plans')}.` : 'No site plan yet. Crews choose its areas when they count and place crates.',
                href: to('site-maps.html'), action: 'Add a site plan' },
        ];
    }

    /** One line for a project's setup: what is left, or that it is ready. */
    function setupSummary(steps) {
        const left = steps.filter(step => !step.done);
        return left.length ? `Setup: ${left.length} of ${steps.length} left (${left.map(step => step.title.replace(/^A /, '').toLowerCase()).join(', ')})` : 'Set up: yard, racks and site plan';
    }

    const api = { RACK_TEXT, RACK_TEXT_MAX, CAPACITY_MAX, MAX_RUN, rackLabel, isActive, usableRacks, errorMessage, rackValues, filterRacks, setupSteps, setupSummary };
    root.InvenioYardSetup = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

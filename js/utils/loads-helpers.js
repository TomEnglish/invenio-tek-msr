/**
 * Pure helpers for the Loads and Outside Shops pages (migration 022). No DOM or Supabase here, so node tests can load it.
 */
(function (root) {
    const LOAD_STATUS = {
        planning: { label: 'Planning', chip: 'chip-muted' }, loading: { label: 'Loading', chip: 'chip-info' }, in_transit: { label: 'In transit', chip: 'chip-warn' },
        delivered: { label: 'Delivered', chip: 'chip-success' }, closed: { label: 'Closed', chip: 'chip-primary' }, cancelled: { label: 'Cancelled', chip: 'chip-muted' },
    };
    const BOARD_COLUMNS = ['planning', 'loading', 'in_transit', 'delivered'];
    const FINISHED = new Set(['closed', 'cancelled']);
    const LINE_STATUS = {
        planned: { label: 'Planned', chip: 'chip-muted' }, on_board: { label: 'On board', chip: 'chip-info' }, delivered: { label: 'Delivered', chip: 'chip-success' },
        missing: { label: 'Missing', chip: 'chip-danger' }, not_loaded: { label: 'Left behind', chip: 'chip-warn' }, removed: { label: 'Removed', chip: 'chip-muted' },
    };
    const LINE_FLAGS = { extra: 'Extra', wrong_stop: 'Wrong stop', found: 'Found' };
    const STOP_KINDS = { dropoff: 'Drop-off', pickup: 'Pick-up', both: 'Drop-off and pick-up' };
    const STOP_STATUS = { pending: { label: 'Pending', chip: 'chip-muted' }, arrived: { label: 'Arrived', chip: 'chip-info' }, done: { label: 'Done', chip: 'chip-success' } };
    const COMPANY_ROLES = { broker: 'Broker', carrier: 'Carrier', dispatcher: 'Dispatcher', other: 'Other' };
    // Column limits from 022, with the payload key, the form's words and the limit.
    const LOAD_TEXT = [
        ['truckType', 'truck_type', 'Truck type', 60], ['truckNumber', 'truck_number', 'Truck number', 40], ['trailerNumber', 'trailer_number', 'Trailer number', 40],
        ['bolNumber', 'bol_number', 'Bill of lading number', 60], ['driverName', 'driver_name', 'Driver name', 120], ['driverPhone', 'driver_phone', 'Driver phone', 40],
        ['notes', 'notes', 'Notes', 2000],
    ];
    const MAX_COMPANIES = 3, MAX_STOPS = 20, MAX_LICENCE_PHOTOS = 4, PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' }, MAX_PHOTO_BYTES = 10 * 1024 * 1024;
    const DAY = 24 * 60 * 60 * 1000;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    function errorMessage(error) {
        const code = error?.code, text = error?.message || String(error ?? 'Unknown error');
        if (['42P01', 'PGRST202', 'PGRST205'].includes(code)) return 'Loads are not set up in this database yet (migration 022).';
        // 22023 messages are written to be shown as they are; so are the database's own 42501 reasons.
        if (code === '42501') return !error?.message || /row-level security|permission denied/i.test(text) ? 'You do not have permission to make this change.' : text;
        return text;
    }

    const isFinished = load => FINISHED.has(load.status);
    // Stops and the plan can change only until the truck leaves.
    const beforeDeparture = load => load.status === 'planning' || load.status === 'loading';
    const isDate = text => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);

    /** Board columns for open loads by status, or one list of closed and cancelled loads; newest planned first within each. */
    function boardGroups(loads, { finished = false } = {}) {
        const order = (a, b) => String(b.planned_date || '').localeCompare(String(a.planned_date || '')) || collator.compare(b.load_number, a.load_number);
        if (finished) return [{ status: 'finished', label: 'Closed and cancelled', loads: loads.filter(isFinished).sort(order) }];
        return BOARD_COLUMNS.map(status => ({ status, label: LOAD_STATUS[status].label, loads: loads.filter(load => load.status === status).sort(order) }));
    }

    /** The counts a board card shows, leaving out the ones that are zero. */
    function cardCounts(load) {
        return [['On board', load.on_board_count], ['Planned', load.planned_count], ['Delivered', load.delivered_count], ['Missing', load.missing_count]]
            .filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count.toLocaleString('en-US')}`);
    }

    /** Details form text → the load_save keys, or { error, field }. Every key is sent, so clearing a field clears it. */
    function detailsPayload(input) {
        const payload = { originPlaceId: String(input.originPlaceId || '').trim(), plannedDate: String(input.plannedDate || '').trim() };
        if (payload.plannedDate && !isDate(payload.plannedDate)) return { error: 'Planned date must be a date like 2026-11-30.', field: 'plannedDate' };
        for (const [key, , label, max] of LOAD_TEXT) {
            const value = String(input[key] ?? '').trim();
            if (value.length > max) return { error: `${label} is too long (at most ${max.toLocaleString('en-US')} characters).`, field: key };
            payload[key] = value;
        }
        return { payload };
    }

    /** The keys whose value differs from what the form showed: load_save changes only the keys it is sent. */
    const changedKeys = (payload, shown) => Object.fromEntries(Object.entries(payload).filter(([key, value]) => value !== shown[key]));

    /**
     * Whether a licence can still be on file. 022 keeps licence_recorded_at after removing a licence 90 days past the
     * load's close, so the board stops saying so then.
     */
    const licenceOnFile = (load, now = Date.now()) => Boolean(load.licence_recorded_at) && !(load.closed_at && Date.parse(load.closed_at) < now - 90 * DAY);

    /** Company rows → load_save companies. Empty rows are dropped; a row with anything in it needs a name. */
    function companiesPayload(rows) {
        const companies = [];
        for (const [index, row] of rows.entries()) {
            const value = { name: String(row.name || '').trim(), role: row.role || 'carrier', contactName: String(row.contactName || '').trim(), phone: String(row.phone || '').trim() };
            if (!value.name && !value.contactName && !value.phone) continue;
            if (!value.name) return { error: `Company ${index + 1} needs a name.`, index, field: 'name' };
            if (!COMPANY_ROLES[value.role]) return { error: `Company ${index + 1}'s role is broker, carrier, dispatcher or other.`, index, field: 'role' };
            for (const [key, label, max] of [['name', 'name', 120], ['contactName', 'contact name', 120], ['phone', 'phone', 40]]) {
                if (value[key].length > max) return { error: `Company ${index + 1}'s ${label} is too long (at most ${max} characters).`, index, field: key };
            }
            companies.push(value);
        }
        if (companies.length > MAX_COMPANIES) return { error: `Add up to ${MAX_COMPANIES} companies.` };
        return { companies };
    }

    /** Stop rows (in order) → load_save stops. Each keeps its own ID, so pieces planned for it stay with it. */
    function stopsPayload(rows) {
        if (rows.length > MAX_STOPS) return { error: `A load can have at most ${MAX_STOPS} stops.` };
        const stops = [];
        for (const [index, row] of rows.entries()) {
            if (!row.placeId) return { error: `Choose a place for stop ${index + 1}.`, index, field: 'placeId' };
            if (!STOP_KINDS[row.kind || 'dropoff']) return { error: `Stop ${index + 1} is a drop-off, a pick-up or both.`, index, field: 'kind' };
            const plannedDate = String(row.plannedDate || '').trim();
            if (plannedDate && !isDate(plannedDate)) return { error: `Stop ${index + 1}'s date must be a date like 2026-11-30.`, index, field: 'plannedDate' };
            stops.push({ id: row.id, placeId: row.placeId, kind: row.kind || 'dropoff', plannedDate: plannedDate || null });
        }
        return { stops };
    }

    /** A copy of the list with one entry moved up (-1) or down (+1); unchanged at either end. */
    function moveItem(list, index, delta) {
        const target = index + delta, copy = [...list];
        if (target < 0 || target >= copy.length) return copy;
        [copy[index], copy[target]] = [copy[target], copy[index]];
        return copy;
    }

    /**
     * Manifest lines grouped by drop-off stop, in stop order, each sorted by tag. Pieces taken off the plan are
     * left out. Lines whose stop isn't in the list (it was cancelled) come last under "Other stops".
     */
    function manifestByStop(stops, lines) {
        const shown = lines.filter(line => line.status !== 'removed').sort((a, b) => collator.compare(a.tag, b.tag));
        const ordered = [...stops].sort((a, b) => a.seq - b.seq);
        const groups = ordered.map(stop => ({ stop, lines: shown.filter(line => line.dropoff_stop_id === stop.id) }));
        const known = new Set(ordered.map(stop => stop.id));
        const others = shown.filter(line => !known.has(line.dropoff_stop_id));
        if (others.length) groups.push({ stop: null, lines: others });
        return groups;
    }

    /** What the print-out lists for a stop: pieces still meant to travel or already moved, not ones left behind. */
    const printable = line => ['planned', 'on_board', 'delivered', 'missing'].includes(line.status);

    /** The licence form → record_driver_licence's p_licence, normalised as 022 stores it, or { error, field }. */
    function licenceValues(input) {
        const number = String(input.number || '').trim().replace(/\s+/g, ' ').toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9 -]{2,39}$/.test(number)) return { error: 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes.', field: 'number' };
        const state = String(input.state || '').trim(), expiry = String(input.expiry || '').trim();
        if (state.length > 40) return { error: 'Issuing state is too long (at most 40 characters).', field: 'state' };
        if (expiry && !isDate(expiry)) return { error: 'Expiry date must be a date like 2026-11-30.', field: 'expiry' };
        return { licence: { number, state: state || null, expiry: expiry || null } };
    }

    /** Where a licence photo goes: <load id>/<new id>.<jpg|png>, as attach_driver_licence_photo accepts. */
    function licencePhotoPath(loadId, file, id) {
        const extension = PHOTO_TYPES[file?.type];
        if (!extension) return { error: 'Choose a JPEG or PNG photo.' };
        if (file.size > MAX_PHOTO_BYTES) return { error: 'That photo is over 10 MB. Choose a smaller one.' };
        return { path: `${loadId}/${id}.${extension}` };
    }

    /** Whole days from a time until now, for "there for 12 days". */
    const daysSince = (time, now = Date.now()) => time ? Math.max(0, Math.floor((now - new Date(time).getTime()) / DAY)) : null;
    const daysText = days => days === null ? '' : days === 0 ? 'today' : days === 1 ? '1 day' : `${days.toLocaleString('en-US')} days`;

    /**
     * What sits at each outside shop now: top-level delivered crates with the shop as their place, and loose items whose
     * current-position line delivered them there. Each piece carries the line that brought it, for "since" and the load.
     */
    function shopContents(shops, units, lines) {
        const current = lines.filter(line => line.is_current_position && line.status === 'delivered');
        const lineFor = unit => current.find(line => line.unit_id === unit.id);
        return shops.map(shop => {
            const crates = units.filter(unit => !unit.parent_id && unit.status === 'delivered' && unit.place_id === shop.id)
                .map(unit => ({ kind: 'crate', code: unit.code, name: unit.description || '', isHighValue: unit.is_high_value, line: lineFor(unit) || null, unit }));
            const items = current.filter(line => line.piece_kind === 'item' && line.delivered_place_id === shop.id)
                .map(line => ({ kind: 'item', code: line.tag, name: line.name || '', isHighValue: line.is_high_value, line }));
            const pieces = [...crates, ...items].sort((a, b) => collator.compare(a.code, b.code));
            return { shop, pieces };
        });
    }

    const api = {
        LOAD_STATUS, BOARD_COLUMNS, LINE_STATUS, LINE_FLAGS, STOP_KINDS, STOP_STATUS, COMPANY_ROLES, LOAD_TEXT, MAX_COMPANIES, MAX_STOPS, MAX_LICENCE_PHOTOS,
        errorMessage, isFinished, beforeDeparture, isDate, boardGroups, cardCounts, detailsPayload, changedKeys, licenceOnFile, companiesPayload, stopsPayload, moveItem,
        manifestByStop, printable, licenceValues, licencePhotoPath, daysSince, daysText, shopContents,
    };
    root.InvenioLoads = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

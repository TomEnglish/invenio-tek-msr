/**
 * Pure helpers for the Places and Crates pages (migration 021). No DOM or Supabase here, so node tests can load it.
 */
(function (root) {
    const PLACE_KINDS = { yard: 'Yard', site: 'Site', outside_shop: 'Outside shop', vendor: 'Vendor', other: 'Other' };
    // Only our own yards and sites can belong to a project.
    const PROJECT_KINDS = new Set(['yard', 'site']);
    const RADIUS = { min: 25, max: 20000, standard: 300 };
    // Column limits from 021, with the words the form uses.
    const PLACE_TEXT = {
        address: ['Street address', 200], city: ['City', 80], state: ['State', 40], postal_code: ['Postal code', 20],
        contact_name: ['Contact name', 120], contact_phone: ['Contact phone', 40], contact_email: ['Contact email', 200],
        secondary_contact_name: ['Second contact name', 120], secondary_contact_phone: ['Second contact phone', 40], notes: ['Notes', 2000],
    };
    const UNIT_STATUS = {
        open: { label: 'Open', chip: 'chip-info' }, sealed: { label: 'Sealed', chip: 'chip-success' }, on_load: { label: 'On a load', chip: 'chip-warn' },
        delivered: { label: 'Delivered', chip: 'chip-primary' }, unpacked: { label: 'Unpacked', chip: 'chip-muted' },
        // 022: on a truck but not unloaded where it was due, until the office marks it found or writes it off.
        missing: { label: 'Missing', chip: 'chip-danger' }, written_off: { label: 'Written off', chip: 'chip-muted' },
    };
    const UNIT_KINDS = { crate: 'Crate', skid: 'Skid', bundle: 'Bundle', basket: 'Basket', container: 'Container', other: 'Other' };
    const MAX_LABELS = 500;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    function errorMessage(error, conflict = 'That name is already used by another active place.') {
        const code = error?.code, text = error?.message || String(error ?? 'Unknown error');
        if (['42P01', 'PGRST202', 'PGRST205'].includes(code)) return 'Places and crates are not set up in this database yet (migration 021).';
        if (code === '23505') return conflict;
        // As on the inventory pages: a policy or grant refusal means "no permission"; the database's own checks say why.
        if (code === '42501') return !error?.message || /row-level security|permission denied/i.test(text) ? 'You do not have permission to make this change.' : text;
        return text;
    }

    /**
     * Form text → the row to save, or { error, field } for the first problem. Text is trimmed and empty optional
     * text becomes null; a point needs both coordinates (rounded to the 6 places the database keeps) or neither.
     */
    function placeValues(input) {
        const text = key => String(input[key] ?? '').trim();
        const kind = text('kind');
        if (!PLACE_KINDS[kind]) return { error: 'Choose what kind of place this is.', field: 'kind' };
        const name = text('name');
        if (!name) return { error: 'Enter a name.', field: 'name' };
        if (name.length > 120) return { error: 'Name is too long (120 characters at most).', field: 'name' };
        const values = { kind, name, project_id: PROJECT_KINDS.has(kind) ? text('project_id') || null : null };
        for (const [key, [label, max]] of Object.entries(PLACE_TEXT)) {
            const value = text(key);
            if (value.length > max) return { error: `${label} is too long (${max.toLocaleString('en-US')} characters at most).`, field: key };
            values[key] = value || null;
        }
        if (values.contact_email && !/^[^\s@]+@[^\s@]+$/.test(values.contact_email)) return { error: 'Enter a contact email like name@example.com.', field: 'contact_email' };
        const lat = text('latitude'), lng = text('longitude');
        if (!lat !== !lng) return { error: 'Enter both latitude and longitude, or clear the map point.', field: lat ? 'longitude' : 'latitude' };
        values.latitude = values.longitude = null;
        if (lat) {
            const latitude = Number(lat), longitude = Number(lng);
            if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return { error: 'Latitude must be a number from -90 to 90.', field: 'latitude' };
            if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return { error: 'Longitude must be a number from -180 to 180.', field: 'longitude' };
            values.latitude = Math.round(latitude * 1e6) / 1e6; values.longitude = Math.round(longitude * 1e6) / 1e6;
        }
        const radius = text('geofence_radius_m');
        values.geofence_radius_m = radius ? Number(radius) : RADIUS.standard;
        if (!Number.isInteger(values.geofence_radius_m) || values.geofence_radius_m < RADIUS.min || values.geofence_radius_m > RADIUS.max) {
            return { error: `Arrival radius must be a whole number of metres from ${RADIUS.min} to ${RADIUS.max.toLocaleString('en-US')}.`, field: 'geofence_radius_m' };
        }
        return { values };
    }

    const placeAddress = place => [place.address, place.city, [place.state, place.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const hasPoint = place => place.latitude !== null && place.latitude !== undefined && place.longitude !== null && place.longitude !== undefined;

    /** Places of one kind (or all), active or retired, matching the search in name, address or contact, by name. */
    function filterPlaces(places, { kind = '', retired = false, search = '' } = {}) {
        const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return places.filter(place => (!kind || place.kind === kind) && (place.is_active === false) === retired && words.every(word =>
            [place.name, placeAddress(place), place.contact_name, place.secondary_contact_name].some(value => String(value || '').toLowerCase().includes(word))))
            .sort((a, b) => collator.compare(a.name, b.name));
    }

    // Codes are stored upper case; people type them any way, with or without "HU-".
    const normaliseCode = text => String(text || '').trim().toUpperCase().replace(/\s+/g, '');

    /** Crates with a status (or any) whose code or description contains the search, by code. */
    function filterUnits(units, { status = '', search = '' } = {}) {
        const code = normaliseCode(search), words = search.trim().toLowerCase();
        return units.filter(unit => (!status || unit.status === status)
            && (!code || unit.code.includes(code) || String(unit.description || '').toLowerCase().includes(words)))
            .sort((a, b) => collator.compare(a.code, b.code));
    }

    /** Where a crate is: its outermost crate's place and area, as the overview gives them. */
    const unitWhere = unit => [unit.place_name, unit.location].filter(Boolean).join(' · ');

    function contentsText(unit) {
        const parts = [];
        if (unit.item_count) parts.push(`${unit.item_count.toLocaleString('en-US')} ${unit.item_count === 1 ? 'item' : 'items'}`);
        if (unit.unit_count) parts.push(`${unit.unit_count.toLocaleString('en-US')} ${unit.unit_count === 1 ? 'crate' : 'crates'}`);
        return parts.join(', ') || 'Empty';
    }

    function labelCount(text) {
        const value = String(text ?? '').trim();
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_LABELS) return { error: `Enter a whole number of labels from 1 to ${MAX_LABELS}.` };
        return { count: Number(value) };
    }

    /**
     * An SVG path for a made QR code (anything with getModuleCount and isDark, as qrcode-generator gives), one
     * unit per module, with the 4-module quiet zone scanners need. Returns the full size and the path data.
     */
    function qrPath(qr, quiet = 4) {
        const count = qr.getModuleCount();
        let path = '';
        for (let row = 0; row < count; row++) {
            for (let column = 0; column < count; column++) if (qr.isDark(row, column)) path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
        }
        return { size: count + quiet * 2, path };
    }

    const api = {
        PLACE_KINDS, PROJECT_KINDS, RADIUS, PLACE_TEXT, UNIT_STATUS, UNIT_KINDS, MAX_LABELS,
        errorMessage, placeValues, placeAddress, hasPoint, filterPlaces, normaliseCode, filterUnits, unitWhere, contentsText, labelCount, qrPath,
    };
    root.InvenioLogistics = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

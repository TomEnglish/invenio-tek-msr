/**
 * A small in-memory model of migration 022 for tests and the browser fixture: the load operations the office pages
 * call, the licence functions, the driver-licences bucket and the three load views. It follows 022's rules and
 * refusal messages for what the pages exercise; it is not a second implementation of everything (no load_on or
 * load_off, which only the phones send). State is plain data, so the browser fixture can keep it in sessionStorage.
 */
(function (root) {
    const DAY = 24 * 60 * 60 * 1000;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const refuse = (message, code = '22023') => { throw Object.assign(new Error(message), { code }); };
    const uuid = () => root.crypto.randomUUID();

    /** Empty load tables beside the caller's places, crates (handling_unit_overview rows) and items. */
    function emptyLoads() {
        return { loads: [], load_companies: [], load_stops: [], load_lines: [], load_driver_licences: [], driver_licence_photos: [], licence_objects: [] };
    }

    // Like now() in separate transactions, this clock never repeats, so "the latest line" is never a tie.
    function clock() {
        let last = 0;
        return () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString(); };
    }

    function createModel(state, { projectId, office, canWork = () => true, now = clock(), packedIn = () => null }) {
        const text = (object, key, max, label) => {
            const value = object[key];
            if (value !== undefined && value !== null && !['string', 'number'].includes(typeof value)) refuse(`${label} must be text`);
            const trimmed = String(value ?? '').trim() || null;
            if (trimmed && trimmed.length > max) refuse(`${label} is too long (at most ${max} characters)`);
            return trimmed;
        };
        const date = (object, key, label) => {
            const value = String(object[key] ?? '').trim();
            if (!value) return null;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) refuse(`${label} must be a date like 2026-11-30`);
            if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) refuse(`${label} isn't a real date`);
            return value;
        };
        const id = (object, key, label) => {
            const value = String(object[key] ?? '').trim();
            if (!value) return null;
            if (!UUID.test(value)) refuse(`${label} isn't a valid ID`);
            return value;
        };
        const flag = (object, key, label) => {
            if (object[key] !== undefined && object[key] !== null && typeof object[key] !== 'boolean') refuse(`${label} must be true or false`);
            return object[key] === true;
        };
        const list = (object, key, label) => {
            if (object[key] === undefined || object[key] === null) return [];
            if (!Array.isArray(object[key])) refuse(`Send ${label} as a list`);
            return object[key];
        };
        const code = value => /^HU-/i.test(String(value || '').trim()) ? String(value).trim().toUpperCase() : String(value ?? '').trim();
        const load = loadId => {
            if (!loadId) refuse('Choose a load');
            const found = state.loads.find(row => row.id === loadId);
            if (!found || found.project_id !== projectId) refuse("That load isn't in this project", '42501');
            return found;
        };
        const place = placeId => {
            if (!placeId) refuse('Choose a place');
            const found = state.places.find(row => row.id === placeId);
            if (!found || found.is_active === false || (found.project_id && found.project_id !== projectId)) refuse('That place is unavailable', '42501');
            return found;
        };
        const stop = (theLoad, stopId, what) => {
            if (!stopId) refuse(`Choose ${what}`);
            const found = state.load_stops.find(row => row.id === stopId && row.load_id === theLoad.id && row.status !== 'cancelled');
            if (!found) refuse(`That stop isn't on load ${theLoad.load_number}`);
            return found;
        };
        const stopName = theStop => `Stop ${theStop.seq ?? '(cancelled)'} (${state.places.find(row => row.id === theStop.place_id)?.name})`;
        const open = new Set(['planned', 'on_board', 'missing']);
        const samePiece = (a, b) => (a.unit_id && a.unit_id === b.unit_id) || (a.inventory_uid && a.inventory_uid === b.inventory_uid);
        const unitById = unitId => state.units.find(row => row.id === unitId);

        // What a code is: a top-level crate, or a counted item not packed in a crate.
        function piece(value) {
            const tag = code(value);
            if (tag.length < 1 || tag.length > 120) refuse('Tag numbers must be 1 to 120 characters');
            if (/^HU-/.test(tag)) {
                const unit = state.units.find(row => row.code === tag);
                if (!unit || unit.project_id !== projectId) refuse(`Crate ${tag} isn't in this project`, '42501');
                if (unit.parent_id) refuse(`${tag} is inside ${unit.top_code}; a crate travels with the crate it's in`);
                return { unit_id: unit.id, inventory_uid: null, tag, unit_status: unit.status };
            }
            const item = state.items.find(row => row.project_id === projectId && String(row.qr_code).trim() === tag);
            if (!item || item.count_status !== 'counted') refuse(`${tag} isn't a crate label or a received or counted item in this project`);
            const holder = packedIn(tag);
            if (holder) refuse(`${tag} is packed in ${holder}; load the crate instead`);
            return { unit_id: null, inventory_uid: item.uid, tag, unit_status: null };
        }
        const setUnit = (unitId, values) => { const unit = unitById(unitId); if (unit) Object.assign(unit, values); };
        const deliverUnit = (unitId, theplace) => setUnit(unitId, { status: 'delivered', place_id: theplace.id, place_name: theplace.name, location: null, zone_id: null, site_map_id: null });

        const operations = {
            load_save(payload) {
                const loadId = id(payload, 'loadId', 'Load');
                if (!loadId) refuse('A load ID is required');
                const origin = String(payload.originPlaceId ?? '') ? place(id(payload, 'originPlaceId', 'Origin')).id : null;
                const values = { origin_place_id: origin, planned_date: date(payload, 'plannedDate', 'Planned date'), truck_type: text(payload, 'truckType', 60, 'Truck type'),
                    truck_number: text(payload, 'truckNumber', 40, 'Truck number'), trailer_number: text(payload, 'trailerNumber', 40, 'Trailer number'),
                    bol_number: text(payload, 'bolNumber', 60, 'Bill of lading number'), notes: text(payload, 'notes', 2000, 'Notes'),
                    driver_name: text(payload, 'driverName', 120, 'Driver name'), driver_phone: text(payload, 'driverPhone', 40, 'Driver phone') };
                const keys = { originPlaceId: 'origin_place_id', plannedDate: 'planned_date', truckType: 'truck_type', truckNumber: 'truck_number', trailerNumber: 'trailer_number',
                    bolNumber: 'bol_number', notes: 'notes', driverName: 'driver_name', driverPhone: 'driver_phone' };
                let theLoad = state.loads.find(row => row.id === loadId), created = false;
                if (!theLoad) {
                    const number = Math.max(0, ...state.loads.filter(row => row.project_id === projectId).map(row => Number(row.load_number.slice(2)))) + 1;
                    theLoad = { id: loadId, project_id: projectId, load_number: `L-${String(number).padStart(4, '0')}`, status: 'planning', licence_recorded_at: null,
                        departed_at: null, delivered_at: null, closed_at: null, created_at: now(), updated_at: now(), ...values };
                    state.loads.push(theLoad); created = true;
                } else {
                    if (theLoad.project_id !== projectId) refuse("That load isn't in this project", '42501');
                    if (['closed', 'cancelled'].includes(theLoad.status)) refuse(`Load ${theLoad.load_number} is ${theLoad.status}; it can't change`);
                    for (const [key, column] of Object.entries(keys)) if (key in payload) theLoad[column] = values[column];
                    theLoad.updated_at = now();
                }
                if ('companies' in payload) {
                    const companies = list(payload, 'companies', 'companies');
                    if (companies.length > 3) refuse('Add up to 3 companies');
                    const rows = companies.map((company, index) => {
                        const name = text(company, 'name', 120, 'Company name');
                        if (!name) refuse('Each company needs a name');
                        const role = company.role || 'carrier';
                        if (!['broker', 'carrier', 'dispatcher', 'other'].includes(role)) refuse("A company's role is broker, carrier, dispatcher or other");
                        return { id: uuid(), project_id: projectId, load_id: theLoad.id, position: index + 1, name, role,
                            contact_name: text(company, 'contactName', 120, 'Contact name'), phone: text(company, 'phone', 40, 'Company phone') };
                    });
                    state.load_companies = state.load_companies.filter(row => row.load_id !== theLoad.id).concat(rows);
                }
                if ('stops' in payload) {
                    if (!['planning', 'loading'].includes(theLoad.status)) refuse(`Load ${theLoad.load_number} has left; its stops can't change`);
                    const stops = list(payload, 'stops', 'stops');
                    if (stops.length > 20) refuse('A load can have at most 20 stops');
                    const ids = [];
                    stops.forEach((item, index) => {
                        const stopId = id(item, 'id', 'Stop ID');
                        if (!stopId) refuse('Each stop needs an ID');
                        if (ids.includes(stopId)) refuse('Two stops share one ID');
                        ids.push(stopId);
                        const where = place(id(item, 'placeId', 'Place'));
                        const kind = item.kind || 'dropoff';
                        if (!['dropoff', 'pickup', 'both'].includes(kind)) refuse('A stop is a drop-off, a pick-up or both');
                        const values = { seq: index + 1, place_id: where.id, kind, planned_date: date(item, 'plannedDate', 'Stop date'), status: 'pending' };
                        const existing = state.load_stops.find(row => row.id === stopId);
                        if (existing && existing.load_id !== theLoad.id) refuse('That stop belongs to another load', '42501');
                        if (existing) Object.assign(existing, values);
                        else state.load_stops.push({ id: stopId, project_id: projectId, load_id: theLoad.id, arrived_at: null, completed_at: null, ...values });
                    });
                    for (const left of state.load_stops.filter(row => row.load_id === theLoad.id && row.status !== 'cancelled' && !ids.includes(row.id))) {
                        if (state.load_lines.some(line => open.has(line.status) && [line.pickup_stop_id, line.dropoff_stop_id].includes(left.id))) {
                            refuse(`The stop at ${state.places.find(row => row.id === left.place_id)?.name} still has pieces planned for it; move them to another stop first`);
                        }
                        Object.assign(left, { status: 'cancelled', seq: null });
                    }
                    if (state.load_lines.some(line => line.load_id === theLoad.id && ['planned', 'on_board'].includes(line.status)
                        && state.load_stops.find(row => row.id === line.dropoff_stop_id)?.kind === 'pickup')) {
                        refuse('Every planned piece needs a drop-off stop after its pick-up stop');
                    }
                }
                return { id: theLoad.id, load_number: theLoad.load_number, status: theLoad.status, created };
            },
            load_plan(payload) {
                const theLoad = load(id(payload, 'loadId', 'Load'));
                if (!['planning', 'loading'].includes(theLoad.status)) refuse(`Load ${theLoad.load_number} has left; its plan can't change`);
                for (const value of list(payload, 'remove', 'pieces to take off the plan')) {
                    const tag = code(value);
                    const line = state.load_lines.find(row => row.load_id === theLoad.id && row.tag === tag && ['planned', 'on_board'].includes(row.status));
                    if (!line) refuse(`${tag} isn't planned on load ${theLoad.load_number}`);
                    if (line.status === 'on_board') refuse(`${tag} is on the truck; take it off the truck first`);
                    line.status = 'removed';
                }
                for (const item of list(payload, 'add', 'pieces to plan')) {
                    if (!item || typeof item !== 'object') refuse('Each piece to plan needs a code and a drop-off stop');
                    const found = piece(item.code);
                    const drop = stop(theLoad, id(item, 'dropoffStopId', 'Drop-off stop'), `where ${found.tag} comes off`);
                    if (drop.kind === 'pickup') refuse(`${stopName(drop)} is a pick-up stop; choose where ${found.tag} comes off`);
                    const line = state.load_lines.find(row => row.load_id === theLoad.id && ['planned', 'on_board'].includes(row.status) && samePiece(row, found));
                    if (line) { line.dropoff_stop_id = drop.id; continue; }
                    const other = state.load_lines.find(row => row.load_id !== theLoad.id && open.has(row.status) && samePiece(row, found));
                    if (other) refuse(`${found.tag} is already on load ${state.loads.find(row => row.id === other.load_id).load_number}`);
                    if (found.unit_id && !['open', 'sealed', 'delivered'].includes(found.unit_status)) refuse(`${found.tag} is ${found.unit_status.replace('_', ' ')}; it can't go on a load`);
                    state.load_lines.push({ id: uuid(), project_id: projectId, load_id: theLoad.id, unit_id: found.unit_id, material_id: null, inventory_uid: found.inventory_uid,
                        tag: found.tag, pickup_stop_id: null, dropoff_stop_id: drop.id, status: 'planned', flag: null, added_in_field: false, unit_status_before: null,
                        delivered_stop_id: null, delivered_place_id: null, delivered_source: null, note: null, on_at: null, off_at: null, created_at: now(), updated_at: now() });
                }
                return summary(theLoad);
            },
            load_depart(payload) {
                const theLoad = load(id(payload, 'loadId', 'Load'));
                if (!['planning', 'loading'].includes(theLoad.status)) refuse(`Load ${theLoad.load_number} has already left`);
                const confirmAll = flag(payload, 'confirmAll', 'Confirm all');
                if (confirmAll && !office()) refuse('Only office staff can mark pieces loaded without scanning them', '42501');
                if (!theLoad.driver_name) refuse(`Add the driver's name before load ${theLoad.load_number} leaves`);
                const lines = state.load_lines.filter(row => row.load_id === theLoad.id);
                if (confirmAll) {
                    for (const line of lines.filter(row => row.status === 'planned' && !row.pickup_stop_id)) {
                        Object.assign(line, { status: 'on_board', unit_status_before: line.unit_id ? unitById(line.unit_id)?.status : null, on_at: now() });
                        if (line.unit_id) setUnit(line.unit_id, { status: 'on_load' });
                    }
                }
                if (!lines.some(row => row.status === 'on_board')) refuse('Nothing is on the truck yet');
                const left = lines.filter(row => row.status === 'planned' && !row.pickup_stop_id);
                left.forEach(row => { row.status = 'not_loaded'; });
                Object.assign(theLoad, { status: 'in_transit', departed_at: now() });
                return { ...summary(theLoad), not_loaded: left.length };
            },
            stop_complete(payload) {
                const theLoad = load(id(payload, 'loadId', 'Load'));
                if (theLoad.status !== 'in_transit') refuse(`Load ${theLoad.load_number} isn't on the road`);
                const theStop = stop(theLoad, id(payload, 'stopId', 'Stop'), 'the stop to finish');
                if (theStop.status === 'done') refuse(`${stopName(theStop)} is already done`);
                const confirmAll = flag(payload, 'confirmAll', 'Confirm all');
                if (confirmAll && !office()) refuse('Only office staff can mark pieces delivered without scanning them', '42501');
                const where = state.places.find(row => row.id === theStop.place_id);
                let delivered = 0, missing = 0;
                for (const line of state.load_lines.filter(row => row.dropoff_stop_id === theStop.id && row.status === 'on_board')) {
                    if (confirmAll) {
                        Object.assign(line, { status: 'delivered', delivered_stop_id: theStop.id, delivered_place_id: where.id, delivered_source: 'office', off_at: now() });
                        if (line.unit_id) deliverUnit(line.unit_id, where);
                        delivered++;
                    } else {
                        line.status = 'missing';
                        if (line.unit_id) setUnit(line.unit_id, { status: 'missing' });
                        missing++;
                    }
                }
                Object.assign(theStop, { status: 'done', arrived_at: theStop.arrived_at || now(), completed_at: now() });
                if (!state.load_stops.some(row => row.load_id === theLoad.id && ['pending', 'arrived'].includes(row.status))) Object.assign(theLoad, { status: 'delivered', delivered_at: now() });
                return { ...summary(theLoad), stop_id: theStop.id, stop_delivered: delivered, stop_missing: missing };
            },
            load_close(payload) {
                if (!office()) refuse('Only office staff can close or cancel a load', '42501');
                const theLoad = load(id(payload, 'loadId', 'Load'));
                if (flag(payload, 'cancel', 'Cancel')) {
                    if (!['planning', 'loading'].includes(theLoad.status)) refuse("Only a load that hasn't left can be cancelled");
                    for (const line of state.load_lines.filter(row => row.load_id === theLoad.id && ['planned', 'on_board'].includes(row.status))) {
                        if (line.status === 'on_board' && line.unit_id) setUnit(line.unit_id, { status: line.unit_status_before || 'sealed' });
                        line.status = 'removed';
                    }
                    Object.assign(theLoad, { status: 'cancelled', closed_at: now() });
                } else {
                    if (theLoad.status !== 'delivered') refuse(`Finish every stop of load ${theLoad.load_number} before closing it`);
                    Object.assign(theLoad, { status: 'closed', closed_at: now() });
                }
                return summary(theLoad);
            },
            line_found(payload) {
                if (!office()) refuse('Only office staff can mark a missing piece found', '42501');
                const line = state.load_lines.find(row => row.id === id(payload, 'lineId', 'Piece'));
                if (!line || line.project_id !== projectId) refuse("That piece isn't on a load in this project", '42501');
                if (line.status !== 'missing') refuse(`${line.tag} isn't missing`);
                const where = place(id(payload, 'placeId', 'Place'));
                const note = text(payload, 'note', 500, 'Note');
                const atStop = state.load_stops.filter(row => row.load_id === line.load_id && row.place_id === where.id && row.status !== 'cancelled').sort((a, b) => a.seq - b.seq)[0];
                Object.assign(line, { status: 'delivered', flag: 'found', delivered_stop_id: atStop?.id || null, delivered_place_id: where.id, delivered_source: 'office',
                    note: note ?? line.note, off_at: now() });
                if (line.unit_id) deliverUnit(line.unit_id, where);
                return { line_id: line.id, tag: line.tag, status: 'delivered', place_id: where.id };
            },
        };
        function summary(theLoad) {
            const lines = state.load_lines.filter(row => row.load_id === theLoad.id);
            const count = status => lines.filter(row => row.status === status).length;
            return { load_id: theLoad.id, load_number: theLoad.load_number, status: theLoad.status, planned: count('planned'), on_board: count('on_board'), delivered: count('delivered'), missing: count('missing') };
        }

        // ---- Licences -------------------------------------------------------------------------
        const closedLongAgo = theLoad => theLoad.closed_at && Date.parse(theLoad.closed_at) < Date.parse(now()) - 90 * DAY;
        const licenceLoad = loadId => {
            const theLoad = state.loads.find(row => row.id === loadId);
            if (!theLoad || !canWork()) refuse("That load isn't in your projects", '42501');
            return theLoad;
        };
        const rpc = {
            record_driver_licence({ p_operation_id: operationId, p_load_id: loadId, p_licence: licence }) {
                if (!operationId || !licence || typeof licence !== 'object') refuse('Operation ID and licence details are required');
                const theLoad = licenceLoad(loadId);
                const row = state.load_driver_licences.find(item => item.load_id === loadId);
                if (row && row.last_operation_id === operationId) return { load_id: loadId, recorded: true, last4: row.licence_number.slice(-4) };
                if (row?.removed_at) refuse('This licence was removed after the 90-day retention period');
                if (['closed', 'cancelled'].includes(theLoad.status) && !office()) refuse(`Load ${theLoad.load_number} is closed; the office can still correct its licence`);
                const number = String(licence.number || '').trim().replace(/\s+/g, ' ').toUpperCase();
                if (!/^[A-Z0-9][A-Z0-9 -]{2,39}$/.test(number)) refuse('Enter the licence number: 3 to 40 letters, numbers, spaces or dashes');
                const values = { licence_number: number, licence_state: text(licence, 'state', 40, 'Issuing state'), licence_expiry: date(licence, 'expiry', 'Expiry date'),
                    recorded_at: now(), last_operation_id: operationId, removed_at: null };
                if (row) Object.assign(row, values); else state.load_driver_licences.push({ load_id: loadId, project_id: theLoad.project_id, ...values });
                theLoad.licence_recorded_at = now();
                return { load_id: loadId, recorded: true, last4: number.slice(-4) };
            },
            attach_driver_licence_photo({ p_load_id: loadId, p_path: path }) {
                const theLoad = state.loads.find(row => row.id === loadId);
                if (!theLoad || !canWork() || (['closed', 'cancelled'].includes(theLoad.status) && !office())) refuse("Licence photos can't be added to that load", '42501');
                if (!new RegExp(`^${loadId}/[A-Za-z0-9_-]{1,80}\\.(jpg|jpeg|png)$`).test(path || '')) refuse('Licence photos are stored as <load id>/<name>.jpg');
                if (!state.licence_objects.includes(path)) refuse('Upload the photo before attaching it');
                if (state.driver_licence_photos.some(row => row.storage_path === path)) return null;
                if (state.driver_licence_photos.filter(row => row.load_id === loadId && !row.removed_at).length >= 4) refuse('A load keeps at most 4 licence photos');
                state.driver_licence_photos.push({ id: uuid(), load_id: loadId, project_id: theLoad.project_id, storage_path: path, created_at: now(), removed_at: null });
                theLoad.licence_recorded_at ||= now();
                return null;
            },
            // Like 022, every project the user can see, not only the open one.
            driver_licences_due_for_removal() {
                if (!office()) return [];
                return state.loads.filter(closedLongAgo).map(theLoad => ({
                    load_id: theLoad.id, load_number: theLoad.load_number, licence: state.load_driver_licences.some(row => row.load_id === theLoad.id && !row.removed_at),
                    storage_paths: state.driver_licence_photos.filter(row => row.load_id === theLoad.id && !row.removed_at).map(row => row.storage_path),
                })).filter(row => row.licence || row.storage_paths.length).map(({ licence, ...row }) => row);
            },
            remove_driver_licence({ p_load_id: loadId }) {
                const theLoad = state.loads.find(row => row.id === loadId);
                if (!theLoad || !office()) refuse("Only office staff on the load's project can remove its licence", '42501');
                if (!closedLongAgo(theLoad)) refuse('Licences are kept until 90 days after the load closes');
                if (state.licence_objects.some(path => path.startsWith(`${loadId}/`))) refuse('Delete the licence photos from storage first');
                const photos = state.driver_licence_photos.filter(row => row.load_id === loadId && !row.removed_at);
                photos.forEach(row => { row.removed_at = now(); });
                const licence = state.load_driver_licences.find(row => row.load_id === loadId && !row.removed_at);
                if (licence) Object.assign(licence, { licence_number: null, licence_state: null, licence_expiry: null, removed_at: now() });
                return { load_id: loadId, photos_removed: photos.length, licence_removed: Boolean(licence) };
            },
        };
        // The private bucket: writing while the load is open (office any time), reading and (after 90 days) deleting for office only.
        const storage = {
            upload(path) {
                const theLoad = state.loads.find(row => row.id === path.split('/')[0]);
                if (!theLoad || !canWork() || (['closed', 'cancelled'].includes(theLoad.status) && !office())) return { error: { statusCode: '403', message: 'new row violates row-level security policy' } };
                if (state.licence_objects.includes(path)) return { error: { statusCode: '409', message: 'The resource already exists' } };
                state.licence_objects.push(path);
                return { error: null };
            },
            canRead: path => office() && state.licence_objects.includes(path),
            // Names in a load's folder, as Storage lists them; office staff only, like reading.
            list: prefix => office() ? state.licence_objects.filter(path => path.startsWith(`${prefix}/`)).map(path => ({ name: path.slice(prefix.length + 1) })) : [],
            remove(paths) {
                const removable = paths.filter(path => office() && closedLongAgo(state.loads.find(row => row.id === path.split('/')[0]) || {}) && state.licence_objects.includes(path));
                state.licence_objects = state.licence_objects.filter(path => !removable.includes(path));
                return removable;
            },
        };

        // ---- Views ----------------------------------------------------------------------------
        const placeName = placeId => state.places.find(row => row.id === placeId)?.name ?? null;
        const views = {
            load_overview: () => state.loads.map(theLoad => {
                const lines = state.load_lines.filter(row => row.load_id === theLoad.id), stops = state.load_stops.filter(row => row.load_id === theLoad.id && row.status !== 'cancelled');
                const next = stops.filter(row => ['pending', 'arrived'].includes(row.status)).sort((a, b) => a.seq - b.seq)[0];
                const count = status => lines.filter(row => row.status === status).length;
                return { ...theLoad, origin_name: placeName(theLoad.origin_place_id), company_count: state.load_companies.filter(row => row.load_id === theLoad.id).length,
                    stop_count: stops.length, stops_done: stops.filter(row => row.status === 'done').length, next_stop: next ? placeName(next.place_id) : null,
                    planned_count: count('planned'), on_board_count: count('on_board'), delivered_count: count('delivered'), missing_count: count('missing'),
                    flagged_count: lines.filter(row => row.flag).length };
            }),
            load_stop_overview: () => state.load_stops.filter(row => row.status !== 'cancelled').map(theStop => {
                const where = state.places.find(row => row.id === theStop.place_id) || {}, lines = state.load_lines.filter(row => row.load_id === theStop.load_id);
                return { ...theStop, place_name: where.name, place_kind: where.kind, city: where.city ?? null, state: where.state ?? null,
                    due_count: lines.filter(row => row.dropoff_stop_id === theStop.id && ['planned', 'on_board'].includes(row.status)).length,
                    delivered_count: lines.filter(row => row.delivered_stop_id === theStop.id && row.status === 'delivered').length,
                    missing_count: lines.filter(row => row.dropoff_stop_id === theStop.id && row.status === 'missing').length };
            }),
            load_line_overview: () => state.load_lines.map(line => {
                const theLoad = state.loads.find(row => row.id === line.load_id), unit = line.unit_id ? unitById(line.unit_id) : null;
                const item = line.inventory_uid ? state.items.find(row => row.uid === line.inventory_uid) : null;
                const stopOf = stopId => state.load_stops.find(row => row.id === stopId);
                const moved = row => ['on_board', 'delivered', 'missing'].includes(row.status);
                const when = row => row.off_at || row.on_at || row.updated_at;
                const current = moved(line) && !state.load_lines.some(other => other.id !== line.id && moved(other) && samePiece(other, line)
                    && (when(other) > when(line) || (when(other) === when(line) && other.id > line.id)));
                return { ...line, load_number: theLoad.load_number, load_status: theLoad.status, piece_kind: unit ? 'crate' : 'item',
                    name: unit ? unit.description || unit.kind : item?.inventory_item || line.tag, is_high_value: Boolean(unit?.is_high_value),
                    pickup_seq: stopOf(line.pickup_stop_id)?.seq ?? null, pickup_place: placeName(stopOf(line.pickup_stop_id)?.place_id),
                    dropoff_seq: stopOf(line.dropoff_stop_id)?.seq ?? null, dropoff_place: placeName(stopOf(line.dropoff_stop_id)?.place_id),
                    delivered_place: placeName(line.delivered_place_id), is_current_position: current };
            }),
            // handling_unit_overview's 022 columns: the load the crate is planned for, on board or missing from.
            handling_unit_overview: () => state.units.map(unit => {
                const line = state.load_lines.filter(row => row.unit_id === (unit.top_unit_id || unit.id) && open.has(row.status))
                    .sort((a, b) => ['on_board', 'missing', 'planned'].indexOf(a.status) - ['on_board', 'missing', 'planned'].indexOf(b.status))[0];
                return { ...unit, top_status: unitById(unit.top_unit_id || unit.id)?.status ?? unit.status, load_id: line?.load_id ?? null,
                    load_number: line ? state.loads.find(row => row.id === line.load_id).load_number : null, load_line_status: line?.status ?? null };
            }),
        };

        // Like the database's transaction: a refusal part-way through leaves nothing changed.
        const TABLES = ['loads', 'load_companies', 'load_stops', 'load_lines', 'load_driver_licences', 'driver_licence_photos', 'licence_objects'];
        function atomically(run) {
            const before = JSON.parse(JSON.stringify({ tables: TABLES.map(key => state[key]), units: state.units }));
            try { return run(); } catch (error) {
                TABLES.forEach((key, index) => { state[key] = before.tables[index]; });
                state.units.forEach((unit, index) => { for (const key of Object.keys(unit)) delete unit[key]; Object.assign(unit, before.units[index]); });
                throw error;
            }
        }
        function apply(action, payload) {
            if (!canWork()) refuse('An active account and assignment to an active project are required', '42501');
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) refuse('Operation ID and object payload are required');
            if (!operations[action]) refuse('Unsupported operation');
            return atomically(() => operations[action](payload));
        }
        const call = (name, args) => { if (!rpc[name]) refuse(`Unknown function ${name}`, 'PGRST202'); return atomically(() => rpc[name](args || {})); };
        return { apply, call, storage, views };
    }

    const api = { emptyLoads, createModel };
    root.InvenioLoadsModel = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * A small in-memory model of migration 022 for tests and the browser fixture: the load operations the office pages
 * call (with write-offs), the licence functions, the driver-licences bucket and the load views. It follows 022's rules
 * and refusal messages for what the pages exercise; it is not a second implementation of everything (no load_on,
 * load_off or partial lists, which only the phones send). State is plain data, so the browser fixture can keep it in
 * sessionStorage.
 */
(function (root) {
    const DAY = 24 * 60 * 60 * 1000;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const refuse = (message, code = '22023') => { throw Object.assign(new Error(message), { code }); };
    const uuid = () => root.crypto.randomUUID();

    /** Empty load tables beside the caller's places, crates (handling_unit_overview rows) and items. */
    function emptyLoads() {
        return { loads: [], load_companies: [], load_stops: [], load_lines: [], load_write_offs: [], load_driver_licences: [], driver_licence_photos: [], licence_objects: [],
            licence_operations: [] };
    }

    // Like now() in separate transactions, this clock never repeats, so "the latest line" is never a tie.
    function clock() {
        let last = 0;
        return () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString(); };
    }

    function createModel(state, { projectId, office, admin = () => false, canWork = () => true, now = clock(), packedIn = () => null }) {
        for (const key of ['load_write_offs', 'licence_operations']) state[key] ||= [];
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
        const reached = theStop => ['arrived', 'done'].includes(theStop.status);
        const loadNumber = loadId => state.loads.find(row => row.id === loadId)?.load_number;
        const unscanned = placeId => ['outside_shop', 'vendor'].includes(state.places.find(row => row.id === placeId)?.kind);
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
                if (unit.status === 'written_off') refuse(`${tag} was written off; an administrator can undo that`);
                return { unit_id: unit.id, inventory_uid: null, tag, unit_status: unit.status };
            }
            const item = state.items.find(row => row.project_id === projectId && String(row.qr_code).trim() === tag);
            if (!item || item.count_status !== 'counted') refuse(`${tag} isn't a crate label or a received or counted item in this project`);
            if (item.written_off_at) refuse(`${tag} was written off; an administrator can undo that`);
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
                        licence_override_reason: null, licence_override_at: null, started_in_field: !office(), departed_at: null, delivered_at: null, closed_at: null,
                        created_at: now(), updated_at: now(), edited_at: now(), ...values };
                    state.loads.push(theLoad); created = true;
                } else {
                    if (theLoad.project_id !== projectId) refuse("That load isn't in this project", '42501');
                    if (['closed', 'cancelled'].includes(theLoad.status)) refuse(`Load ${theLoad.load_number} is ${theLoad.status}; it can't change`);
                    for (const [key, column] of Object.entries(keys)) if (key in payload) theLoad[column] = values[column];
                    theLoad.updated_at = theLoad.edited_at = now();
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
                    const number = theLoad.load_number;
                    if (['planning', 'loading'].includes(theLoad.status)) {
                        if (!office() && !theLoad.started_in_field) refuse(`The office plans the stops of load ${number}`, '42501');
                    } else if (theLoad.status === 'in_transit') {
                        if (!office()) refuse(`Load ${number} has left; only office staff can change its stops`, '42501');
                    } else refuse(`Load ${number} has been delivered; its stops can't change`);
                    const stops = list(payload, 'stops', 'stops');
                    if (stops.length > 20) refuse('A load can have at most 20 stops');
                    const ids = [];
                    stops.forEach((item, index) => {
                        const stopId = id(item, 'id', 'Stop ID');
                        if (!stopId) refuse('Each stop needs an ID');
                        if (ids.includes(stopId)) refuse('Two stops share one ID');
                        ids.push(stopId);
                        const placeId = id(item, 'placeId', 'Place');
                        const kind = item.kind || 'dropoff';
                        if (!['dropoff', 'pickup', 'both'].includes(kind)) refuse('A stop is a drop-off, a pick-up or both');
                        const plannedDate = date(item, 'plannedDate', 'Stop date');
                        const existing = state.load_stops.find(row => row.id === stopId);
                        if (existing && existing.load_id !== theLoad.id) refuse('That stop belongs to another load', '42501');
                        if (existing && reached(existing) && (existing.place_id !== placeId || existing.kind !== kind)) refuse(`${stopName(existing)} has been reached; its place and kind can't change`);
                        if (!existing || existing.place_id !== placeId) place(placeId);
                        const values = { seq: index + 1, place_id: placeId, kind, planned_date: plannedDate };
                        if (existing) Object.assign(existing, values, { status: existing.status === 'cancelled' ? 'pending' : existing.status });
                        else state.load_stops.push({ id: stopId, project_id: projectId, load_id: theLoad.id, arrived_at: null, completed_at: null, status: 'pending', ...values });
                    });
                    for (const left of state.load_stops.filter(row => row.load_id === theLoad.id && row.status !== 'cancelled' && !ids.includes(row.id))) {
                        if (reached(left)) refuse(`${stopName(left)} has been reached; it stays on the load`);
                        if (state.load_lines.some(line => open.has(line.status) && [line.pickup_stop_id, line.dropoff_stop_id].includes(left.id))) {
                            refuse(`The stop at ${state.places.find(row => row.id === left.place_id)?.name} still has pieces planned for it; move them to another stop first`);
                        }
                        Object.assign(left, { status: 'cancelled', seq: null });
                    }
                    const stopOf = stopId => state.load_stops.find(row => row.id === stopId);
                    if (state.load_lines.some(line => line.load_id === theLoad.id && ['planned', 'on_board'].includes(line.status) && (stopOf(line.dropoff_stop_id)?.kind === 'pickup'
                        || (line.pickup_stop_id && (stopOf(line.pickup_stop_id).kind === 'dropoff' || stopOf(line.pickup_stop_id).seq >= stopOf(line.dropoff_stop_id).seq))))) {
                        refuse('Every planned piece needs a drop-off stop after its pick-up stop');
                    }
                    if (theLoad.status === 'in_transit' && !state.load_stops.some(row => row.load_id === theLoad.id && ['pending', 'arrived'].includes(row.status))) {
                        Object.assign(theLoad, { status: 'delivered', delivered_at: now() });
                    }
                }
                return { id: theLoad.id, load_number: theLoad.load_number, status: theLoad.status, created, started_in_field: theLoad.started_in_field };
            },
            load_plan(payload) {
                const theLoad = load(id(payload, 'loadId', 'Load'));
                if (!['planning', 'loading'].includes(theLoad.status)) refuse(`Load ${theLoad.load_number} has left; its plan can't change`);
                if (!office() && !theLoad.started_in_field) refuse(`The office plans what goes on load ${theLoad.load_number}`, '42501');
                const moved = [];
                for (const value of list(payload, 'remove', 'pieces to take off the plan')) {
                    const tag = code(value);
                    const line = state.load_lines.find(row => row.load_id === theLoad.id && row.tag.toLowerCase() === tag.toLowerCase() && ['planned', 'on_board'].includes(row.status));
                    if (!line) refuse(`${tag} isn't planned on load ${theLoad.load_number}`);
                    if (line.status === 'on_board') refuse(`${tag} is on the truck; take it off the truck first`);
                    line.status = 'removed';
                }
                for (const item of list(payload, 'add', 'pieces to plan')) {
                    if (!item || typeof item !== 'object') refuse('Each piece to plan needs a code and a drop-off stop');
                    const found = piece(item.code);
                    const drop = stop(theLoad, id(item, 'dropoffStopId', 'Drop-off stop'), `where ${found.tag} comes off`);
                    if (drop.kind === 'pickup') refuse(`${stopName(drop)} is a pick-up stop; choose where ${found.tag} comes off`);
                    let pick = null;
                    if (String(item.pickupStopId ?? '')) {
                        pick = stop(theLoad, id(item, 'pickupStopId', 'Pick-up stop'), `where ${found.tag} is picked up`);
                        if (pick.kind === 'dropoff') refuse(`${stopName(pick)} is a drop-off stop; nothing is picked up there`);
                        if (pick.seq >= drop.seq) refuse(`${found.tag} has to be picked up before it comes off`);
                    }
                    const line = state.load_lines.find(row => row.load_id === theLoad.id && ['planned', 'on_board'].includes(row.status) && samePiece(row, found));
                    if (line) { Object.assign(line, { dropoff_stop_id: drop.id, pickup_stop_id: pick?.id ?? null }); continue; }
                    if (found.unit_id && !['open', 'sealed', 'delivered'].includes(found.unit_status)) refuse(`${found.tag} is ${found.unit_status.replace('_', ' ')}; it can't go on a load`);
                    // 022's logistics_take_piece: a piece only planned on a load that hasn't left can be moved here.
                    const other = state.load_lines.find(row => row.load_id !== theLoad.id && open.has(row.status) && samePiece(row, found));
                    if (other) {
                        const otherLoad = state.loads.find(row => row.id === other.load_id);
                        if (other.status === 'missing') refuse(`${found.tag} is missing from load ${otherLoad.load_number}; scan it there or the office marks it found first`);
                        if (other.status === 'on_board' || !['planning', 'loading'].includes(otherLoad.status)) refuse(`${found.tag} is already on load ${otherLoad.load_number}`);
                        if (!flag(item, 'move', 'Move')) refuse(`${found.tag} is planned on load ${otherLoad.load_number}; move it to this load or take it off that plan first`);
                        if (!otherLoad.started_in_field && !office()) refuse(`The office planned ${found.tag} on load ${otherLoad.load_number}; ask the office to move it`, '42501');
                        Object.assign(other, { status: 'removed', note: `${other.note ? `${other.note} ` : ''}Moved to another load.` });
                        moved.push({ code: found.tag, from: otherLoad.load_number });
                    }
                    state.load_lines.push({ id: uuid(), project_id: projectId, load_id: theLoad.id, unit_id: found.unit_id, material_id: null, inventory_uid: found.inventory_uid,
                        tag: found.tag, pickup_stop_id: pick?.id ?? null, dropoff_stop_id: drop.id, status: 'planned', flag: null, added_in_field: false, unit_status_before: null,
                        delivered_stop_id: null, delivered_place_id: null, delivered_source: null, note: null, on_at: null, off_at: null, created_at: now(), updated_at: now() });
                }
                return { ...summary(theLoad), refused: [], moved };
            },
            load_depart(payload) {
                const theLoad = load(id(payload, 'loadId', 'Load'));
                if (!['planning', 'loading'].includes(theLoad.status)) refuse(`Load ${theLoad.load_number} has already left`);
                const confirmAll = flag(payload, 'confirmAll', 'Confirm all');
                if (confirmAll) {
                    if (!office()) refuse('Only office staff can mark pieces loaded without scanning them', '42501');
                    if (!unscanned(theLoad.origin_place_id)) refuse('Confirm without scanning is only for a load leaving an outside shop or vendor; at our yards and sites the crew scans');
                }
                if (!theLoad.driver_name) refuse(`Add the driver's name before load ${theLoad.load_number} leaves`);
                let reason = null;
                if (!licenceReady(theLoad.id)) {
                    reason = text(payload, 'overrideReason', 500, 'Reason');
                    if (!reason) refuse(`Record the driver's licence number and a photo of it before load ${theLoad.load_number} leaves`);
                    if (!office()) refuse("Only office staff can let a load leave without the driver's licence", '42501');
                    if (reason.length < 5) refuse('Give a reason of at least 5 characters');
                }
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
                Object.assign(theLoad, { status: 'in_transit', departed_at: now(), licence_override_reason: reason, licence_override_at: reason ? now() : null });
                return { ...summary(theLoad), not_loaded: left.length };
            },
            stop_complete(payload) {
                const theLoad = load(id(payload, 'loadId', 'Load'));
                if (theLoad.status !== 'in_transit') refuse(`Load ${theLoad.load_number} isn't on the road`);
                const theStop = stop(theLoad, id(payload, 'stopId', 'Stop'), 'the stop to finish');
                if (theStop.status === 'done') refuse(`${stopName(theStop)} is already done`);
                const confirmAll = flag(payload, 'confirmAll', 'Confirm all');
                const atShop = unscanned(theStop.place_id);
                if (atShop && !office()) refuse('Office staff finish stops at outside shops and vendors', '42501');
                if (confirmAll) {
                    if (!office()) refuse('Only office staff can mark pieces delivered without scanning them', '42501');
                    if (!atShop) refuse('Confirm without scanning is only for outside shops and vendors; here the crew scans pieces off');
                }
                const where = state.places.find(row => row.id === theStop.place_id);
                let delivered = 0, missing = 0, boarded = 0, behind = 0;
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
                // Pieces to be picked up here: on board when the office confirms, otherwise they stay behind.
                for (const line of state.load_lines.filter(row => row.pickup_stop_id === theStop.id && row.status === 'planned')) {
                    if (confirmAll) {
                        const drop = state.load_stops.find(row => row.id === line.dropoff_stop_id);
                        if (drop.status === 'done') refuse(`${line.tag} was due off at ${stopName(drop)}, which is already done; change where it comes off first`);
                        const unitStatus = line.unit_id ? unitById(line.unit_id)?.status : null;
                        if (line.unit_id && !['open', 'sealed', 'delivered'].includes(unitStatus)) refuse(`${line.tag} is ${unitStatus.replace('_', ' ')}; it can't go on a load`);
                        Object.assign(line, { status: 'on_board', unit_status_before: unitStatus, on_at: now() });
                        if (line.unit_id) setUnit(line.unit_id, { status: 'on_load' });
                        boarded++;
                    } else {
                        line.status = 'not_loaded';
                        behind++;
                    }
                }
                Object.assign(theStop, { status: 'done', arrived_at: theStop.arrived_at || now(), completed_at: now() });
                if (!state.load_stops.some(row => row.load_id === theLoad.id && ['pending', 'arrived'].includes(row.status))) Object.assign(theLoad, { status: 'delivered', delivered_at: now() });
                return { ...summary(theLoad), stop_id: theStop.id, stop_delivered: delivered, stop_missing: missing, picked_up: boarded, not_picked_up: behind };
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
                    const left = state.load_lines.filter(row => row.load_id === theLoad.id && ['on_board', 'missing'].includes(row.status)).length;
                    if (left) refuse(`Load ${theLoad.load_number} still has missing pieces (${left}); scan them, mark them found or write them off first`);
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
            line_write_off(payload) {
                if (!office()) refuse('Only office staff can write off a missing piece', '42501');
                const line = state.load_lines.find(row => row.id === id(payload, 'lineId', 'Piece'));
                if (!line || line.project_id !== projectId) refuse("That piece isn't on a load in this project", '42501');
                if (line.status !== 'missing') refuse(`${line.tag} isn't missing; only a missing piece can be written off`);
                const reason = text(payload, 'reason', 500, 'Reason');
                if (!reason || reason.length < 5) refuse('Give a reason of at least 5 characters');
                // The crate and every crate inside it; a loose item is its count record.
                const units = [];
                const collect = unitId => { const unit = unitById(unitId); if (!unit) return; units.push({ id: unit.id, code: unit.code, status: unit.status }); state.units.filter(row => row.parent_id === unitId).forEach(row => collect(row.id)); };
                if (line.unit_id) collect(line.unit_id);
                const items = line.inventory_uid ? [{ uid: line.inventory_uid, tag: line.tag }] : [];
                units.forEach(unit => setUnit(unit.id, { status: 'written_off' }));
                items.forEach(item => Object.assign(state.items.find(row => row.uid === item.uid) || {}, { written_off_at: now() }));
                Object.assign(line, { status: 'written_off', note: reason, off_at: now() });
                const writeOff = { id: uuid(), project_id: projectId, load_id: line.load_id, line_id: line.id, reason, affected: { units, materials: [], items },
                    written_off_at: now(), undone_at: null, undo_reason: null };
                state.load_write_offs.push(writeOff);
                return { write_off_id: writeOff.id, line_id: line.id, tag: line.tag, status: 'written_off', units: units.length, materials: 0, items: items.length };
            },
            line_write_off_undo(payload) {
                if (!admin()) refuse('Only an administrator can undo a write-off', '42501');
                const writeOff = state.load_write_offs.find(row => row.id === id(payload, 'writeOffId', 'Write-off'));
                if (!writeOff || writeOff.project_id !== projectId) refuse("That write-off isn't in this project", '42501');
                if (writeOff.undone_at) refuse('That write-off was already undone');
                const reason = text(payload, 'reason', 500, 'Reason');
                if (!reason || reason.length < 5) refuse('Give a reason of at least 5 characters');
                const line = state.load_lines.find(row => row.id === writeOff.line_id);
                const other = state.load_lines.find(row => row.id !== line.id && open.has(row.status) && samePiece(row, line));
                if (other) refuse(`${line.tag} is on load ${loadNumber(other.load_id)} now; take it off that load first`);
                line.status = 'missing';
                const theLoad = state.loads.find(row => row.id === line.load_id);
                if (theLoad.status === 'closed') Object.assign(theLoad, { status: 'delivered', closed_at: null });
                writeOff.affected.units.forEach(unit => { if (unitById(unit.id)?.status === 'written_off') setUnit(unit.id, { status: unit.status }); });
                writeOff.affected.items.forEach(item => Object.assign(state.items.find(row => row.uid === item.uid) || {}, { written_off_at: null }));
                Object.assign(writeOff, { undone_at: now(), undo_reason: reason });
                return { write_off_id: writeOff.id, line_id: line.id, tag: line.tag, status: 'missing' };
            },
        };
        // 022: a licence number and at least one photo still kept.
        const licenceReady = loadId => state.load_driver_licences.some(row => row.load_id === loadId && row.licence_number)
            && state.driver_licence_photos.some(row => row.load_id === loadId && !row.removed_at);
        function summary(theLoad) {
            const lines = state.load_lines.filter(row => row.load_id === theLoad.id);
            const count = status => lines.filter(row => row.status === status).length;
            return { load_id: theLoad.id, load_number: theLoad.load_number, status: theLoad.status, planned: count('planned'), on_board: count('on_board'), delivered: count('delivered'),
                missing: count('missing'), written_off: count('written_off') };
        }

        // ---- Licences -------------------------------------------------------------------------
        // 022's driver_licence_due_at: 90 days after the load closes or is cancelled, or after its last activity.
        const dueAt = theLoad => {
            const latest = theLoad.closed_at || [theLoad.updated_at, ...state.load_lines.filter(row => row.load_id === theLoad.id).map(row => row.updated_at),
                ...state.driver_licence_photos.filter(row => row.load_id === theLoad.id).map(row => row.created_at)].filter(Boolean).sort().at(-1);
            return Date.parse(latest) + 90 * DAY;
        };
        const isDue = theLoad => dueAt(theLoad) < Date.parse(now());
        const folder = loadId => state.licence_objects.filter(path => path.startsWith(`${loadId}/`)).sort();
        const licenceLoad = loadId => {
            const theLoad = state.loads.find(row => row.id === loadId);
            if (!theLoad || !canWork()) refuse("That load isn't in your projects", '42501');
            return theLoad;
        };
        function clearLicence(theLoad) {
            if (folder(theLoad.id).length) refuse('Delete the licence photos from storage first');
            const photos = state.driver_licence_photos.filter(row => row.load_id === theLoad.id && !row.removed_at);
            photos.forEach(row => { row.removed_at = now(); });
            const licence = state.load_driver_licences.find(row => row.load_id === theLoad.id && !row.removed_at);
            if (licence) Object.assign(licence, { licence_number: null, licence_state: null, licence_expiry: null, removed_at: now() });
            theLoad.licence_recorded_at = null;
            return { load_id: theLoad.id, photos_removed: photos.length, licence_removed: Boolean(licence) };
        }
        const rpc = {
            record_driver_licence({ p_operation_id: operationId, p_load_id: loadId, p_licence: licence }) {
                if (!operationId || !licence || typeof licence !== 'object') refuse('Operation ID and licence details are required');
                const theLoad = licenceLoad(loadId);
                if (state.licence_operations.includes(operationId)) return { load_id: loadId, recorded: true };
                if (['closed', 'cancelled'].includes(theLoad.status) && !office()) refuse(`Load ${theLoad.load_number} is closed; the office can still correct its licence`);
                if (isDue(theLoad)) refuse(`Load ${theLoad.load_number} is past its 90-day licence retention period`);
                const number = String(licence.number || '').trim().replace(/\s+/g, ' ').toUpperCase();
                if (!/^[A-Z0-9][A-Z0-9 -]{2,39}$/.test(number)) refuse('Enter the licence number: 3 to 40 letters, numbers, spaces or dashes');
                // Only a long number's last four characters are ever repeated back.
                const plain = number.replace(/[^A-Z0-9]/g, ''), last4 = plain.length > 6 ? plain.slice(-4) : null;
                const values = { licence_number: number, licence_state: text(licence, 'state', 40, 'Issuing state'), licence_expiry: date(licence, 'expiry', 'Expiry date'),
                    recorded_at: now(), removed_at: null };
                const row = state.load_driver_licences.find(item => item.load_id === loadId);
                if (row) Object.assign(row, values); else state.load_driver_licences.push({ load_id: loadId, project_id: theLoad.project_id, ...values });
                state.licence_operations.push(operationId);
                theLoad.licence_recorded_at = now();
                return { load_id: loadId, recorded: true, last4 };
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
            remove_driver_licence_photo({ p_path: path }) {
                const photo = state.driver_licence_photos.find(row => row.storage_path === path);
                if (!photo || !office()) refuse("Only office staff on the load's project can remove its licence photos", '42501');
                if (photo.removed_at) return null;
                if (state.licence_objects.includes(path)) refuse('Delete the photo from storage first');
                photo.removed_at = now();
                return null;
            },
            // Like 022, every project the user can see, not only the open one, with every file in each folder.
            driver_licences_due_for_removal() {
                if (!office()) return [];
                return state.loads.filter(isDue).filter(theLoad => state.load_driver_licences.some(row => row.load_id === theLoad.id && !row.removed_at)
                    || state.driver_licence_photos.some(row => row.load_id === theLoad.id && !row.removed_at) || folder(theLoad.id).length)
                    .map(theLoad => ({ load_id: theLoad.id, load_number: theLoad.load_number, storage_paths: folder(theLoad.id) }));
            },
            remove_driver_licence({ p_load_id: loadId, p_reason: given }) {
                const theLoad = state.loads.find(row => row.id === loadId);
                if (!theLoad || !office()) refuse("Only office staff on the load's project can remove its licence", '42501');
                const reason = String(given ?? '').trim();
                if (reason.length > 500) refuse('Reason is too long (at most 500 characters)');
                if (!isDue(theLoad) && reason.length < 5) refuse('Give a reason to remove the licence before it is due');
                return clearLicence(theLoad);
            },
        };
        // The private bucket: <load id>/<name>.jpg|jpeg|png, at most four files a folder; writing while the load is open
        // (office any time), reading and deleting for office only.
        const storage = {
            upload(path) {
                const theLoad = state.loads.find(row => row.id === path.split('/')[0]);
                const denied = { error: { statusCode: '403', message: 'new row violates row-level security policy' } };
                if (!theLoad || !canWork() || (['closed', 'cancelled'].includes(theLoad.status) && !office())) return denied;
                if (!new RegExp(`^${theLoad.id}/[A-Za-z0-9_-]{1,80}\\.(jpg|jpeg|png)$`).test(path)) return denied;
                if (state.licence_objects.includes(path)) return { error: { statusCode: '409', message: 'The resource already exists' } };
                if (folder(theLoad.id).length >= 4) return denied;
                state.licence_objects.push(path);
                return { error: null };
            },
            canRead: path => office() && state.licence_objects.includes(path),
            // Names in a load's folder, as Storage lists them; office staff only, like reading.
            list: prefix => office() ? folder(prefix).map(path => ({ name: path.slice(prefix.length + 1) })) : [],
            // Like Storage, a delete the policy refuses removes nothing and isn't an error.
            remove(paths) {
                const removable = paths.filter(path => office() && state.licence_objects.includes(path));
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
                return { ...theLoad, origin_name: placeName(theLoad.origin_place_id), origin_kind: state.places.find(row => row.id === theLoad.origin_place_id)?.kind ?? null, company_count: state.load_companies.filter(row => row.load_id === theLoad.id).length,
                    stop_count: stops.length, stops_done: stops.filter(row => row.status === 'done').length, next_stop: next ? placeName(next.place_id) : null,
                    planned_count: count('planned'), on_board_count: count('on_board'), delivered_count: count('delivered'), missing_count: count('missing'),
                    written_off_count: count('written_off'), flagged_count: lines.filter(row => row.flag).length };
            }),
            load_stop_overview: () => state.load_stops.filter(row => row.status !== 'cancelled').map(theStop => {
                const where = state.places.find(row => row.id === theStop.place_id) || {}, lines = state.load_lines.filter(row => row.load_id === theStop.load_id);
                return { ...theStop, place_name: where.name, place_kind: where.kind, city: where.city ?? null, state: where.state ?? null,
                    due_count: lines.filter(row => row.dropoff_stop_id === theStop.id && ['planned', 'on_board'].includes(row.status)).length,
                    delivered_count: lines.filter(row => row.delivered_stop_id === theStop.id && row.status === 'delivered').length,
                    missing_count: lines.filter(row => row.dropoff_stop_id === theStop.id && row.status === 'missing').length,
                    pickup_count: lines.filter(row => row.pickup_stop_id === theStop.id && row.status === 'planned').length };
            }),
            load_line_overview: () => state.load_lines.map(line => {
                const theLoad = state.loads.find(row => row.id === line.load_id), unit = line.unit_id ? unitById(line.unit_id) : null;
                const item = line.inventory_uid ? state.items.find(row => row.uid === line.inventory_uid) : null;
                const stopOf = stopId => state.load_stops.find(row => row.id === stopId);
                const moved = row => ['on_board', 'delivered', 'missing', 'written_off'].includes(row.status);
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
            load_write_offs: () => state.load_write_offs,
        };

        // Like the database's transaction: a refusal part-way through leaves nothing changed.
        const TABLES = ['loads', 'load_companies', 'load_stops', 'load_lines', 'load_write_offs', 'load_driver_licences', 'driver_licence_photos', 'licence_objects', 'licence_operations'];
        function atomically(run) {
            const before = JSON.parse(JSON.stringify({ tables: TABLES.map(key => state[key]), units: state.units, items: state.items }));
            try { return run(); } catch (error) {
                TABLES.forEach((key, index) => { state[key] = before.tables[index]; });
                // Crates and items are shared with the caller's own lists, so they are put back in place.
                for (const key of ['units', 'items']) state[key].forEach((row, index) => { for (const field of Object.keys(row)) delete row[field]; Object.assign(row, before[key][index]); });
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

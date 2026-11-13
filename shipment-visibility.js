/**
 * Shipments: the PO & Shipment Log with its totals and filters, and where each shipment is now (026). The location
 * links to the loading location before a shipment leaves, to its tracker's GPS position on the way, and to the
 * delivery location once it is delivered. Office staff link a tracker to a shipment that is ready to ship or on its
 * way; everyone on the project sees the links.
 */
(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const where = InvenioShipmentLocation;
    const projectId = InvenioProjectScope.getActiveProjectId();
    const office = ['office_staff', 'admin'].includes(InvenioCurrentProfile.role) && InvenioProjectScope.activeProject?.status === 'active';
    const lock = { busy: false };
    const STILL_SAVING = 'Still saving. Try again in a moment.';
    const message = text => { $('pageMessage').textContent = text; };
    function el(tag, text = '', className = '') {
        const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    function button(text, className, onclick) {
        const node = el('button', text, className); node.type = 'button'; node.onclick = onclick; return node;
    }
    function icon(name) {
        const node = el('i', '', `fas ${name} me-1`); node.setAttribute('aria-hidden', 'true'); return node;
    }
    // Shipment dates are calendar dates: show them without a time-zone shift.
    function formatDate(value) {
        if (!value) return '—';
        const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    function timeText(value) {
        const date = new Date(value);
        if (!value || Number.isNaN(date.getTime())) return 'an unknown time';
        const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
        return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year, hour: 'numeric', minute: '2-digit' });
    }
    const numberOf = shipment => shipment.shipment_number || `#${shipment.id}`;

    async function fetchAll(client, table, columns, filter = query => query) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await filter(client.from(table).select(columns)).order('id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) return rows;
        }
    }

    const data = { shipments: [], byName: new Map(), trackers: [], trackerById: new Map(), trackersReady: false, links: [], linkByShipment: new Map(), linksReady: false };
    const fetchLinks = () => fetchAll(projectSupabaseClient, 'shipment_trackers', 'id,shipment_id,tracker_id,linked_at', query => query.is('ended_at', null));
    function setLinks(links) {
        data.links = links; data.linkByShipment = new Map(links.map(link => [link.shipment_id, link])); data.linksReady = true;
    }

    async function load() {
        const [shipments, places, trackers, links] = await Promise.allSettled([
            fetchAll(projectSupabaseClient, 'shipments', 'id,shipment_number,cargo_description,mode,ship_type,origin,destination,ship_from,ship_to,storage_location,status,rts_date,delivery_date'),
            // Places are shared by every project, so they are read without the project scope.
            fetchAll(supabaseClient, 'places', 'id,name,project_id,is_active,address,city,state,postal_code,latitude,longitude', query => query.eq('is_active', true)),
            fetchAll(projectSupabaseClient, 'vw_active_samsara_trackers', 'id,name,last_latitude,last_longitude,last_seen_at'),
            fetchLinks(),
        ]);
        if (shipments.status === 'rejected') {
            const row = el('tr'), cell = el('td', 'Failed to load shipment data.', 'text-center py-5 text-danger');
            cell.colSpan = 8; row.append(cell); $('cargoTableBody').replaceChildren(row);
            return;
        }
        data.shipments = shipments.value;
        if (places.status === 'fulfilled') data.byName = where.placesByName(places.value, projectId);
        if (trackers.status === 'fulfilled') {
            data.trackers = trackers.value; data.trackerById = new Map(trackers.value.map(tracker => [tracker.id, tracker])); data.trackersReady = true;
        }
        if (links.status === 'fulfilled') setLinks(links.value);
        const notes = [];
        if (links.status === 'rejected') notes.push(`Tracker links couldn't be loaded: ${where.errorMessage(links.reason)}`);
        if (trackers.status === 'rejected') notes.push("Tracker positions couldn't be loaded; GPS links still open the GPS Tracking map.");
        if (places.status === 'rejected') notes.push("Saved places couldn't be loaded, so every location opens as a map search.");
        message(notes.join(' '));
        applyFilters();
    }

    // Statuses come from the shipment log as typed: the totals, badges, filter and location all ignore capitals and spacing.
    function applyFilters() {
        const search = $('filterSearch').value.toLowerCase().trim();
        const shipType = $('filterShipType').value, mode = $('filterMode').value, status = where.statusKey($('filterStatus').value);
        const filtered = data.shipments.filter(row => (!search || (row.cargo_description || '').toLowerCase().includes(search))
            && (!shipType || row.ship_type === shipType) && (!mode || row.mode === mode) && (!status || where.statusKey(row.status) === status));
        updateKPIs(filtered);
        renderTable(filtered);
    }

    function updateKPIs(rows) {
        const count = stage => rows.filter(row => where.stageOf(row.status) === stage).length.toLocaleString('en-US');
        $('kpiTotal').textContent = rows.length.toLocaleString('en-US');
        $('kpiNotShipped').textContent = count('loading');
        $('kpiInTransit').textContent = count('transit');
        $('kpiDelivered').textContent = count('delivered');
    }

    const BADGES = { delivered: 'bg-success', 'in transit': 'bg-warning text-dark', 'not rts': 'bg-secondary', rts: 'bg-info text-dark' };
    function statusCell(status) {
        const cell = el('td');
        cell.append(el('span', status || '—', `badge ${BADGES[where.statusKey(status)] || 'bg-secondary'}`));
        return cell;
    }

    const trackerName = link => data.trackerById.get(link.tracker_id)?.name || link.tracker_id;

    function locationCell(shipment) {
        const cell = el('td', '', 'shipment-location');
        const link = data.linkByShipment.get(shipment.id) || null;
        const stage = where.stageOf(shipment.status);
        // Unread links aren't "no tracker": say so rather than guess.
        const spot = stage === 'transit' && !data.linksReady
            ? { kind: 'none', label: 'Tracker link unavailable', href: null, caption: '', tone: 'muted' }
            : where.shipmentLocation(shipment, { byName: data.byName, link, tracker: link ? data.trackerById.get(link.tracker_id) || null : null, now: Date.now() });
        if (spot.href) {
            const anchor = el('a', '', 'shipment-location-link');
            anchor.href = spot.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
            anchor.title = spot.title; anchor.setAttribute('aria-label', spot.title);
            anchor.append(icon(spot.kind === 'gps' ? 'fa-satellite-dish' : 'fa-map-marker-alt'), spot.label);
            cell.append(anchor);
        } else {
            cell.append(el('span', spot.label, spot.tone === 'muted' ? 'text-muted' : ''));
        }
        if (spot.caption) cell.append(el('div', spot.caption, `small ${spot.tone === 'warn' ? 'shipment-location-warn' : 'text-muted'}`));
        // A tracker still on a shipment that isn't on its way: say which, so it can be taken off for reuse.
        if (link && stage !== 'transit') cell.append(el('div', `Tracker: ${trackerName(link)}`, 'small text-muted'));
        if (office && data.linksReady && (link || where.linkable(shipment.status))) {
            const text = link ? 'Change tracker' : 'Link tracker';
            const action = button(text, 'btn btn-link btn-sm p-0 shipment-tracker-action', () => openTrackerDialog(shipment));
            action.dataset.shipmentId = String(shipment.id);
            // The accessible name starts with the words on the button.
            action.setAttribute('aria-label', `${text} ${link ? 'on' : 'to'} shipment ${numberOf(shipment)}`);
            cell.append(action);
        }
        return cell;
    }

    function renderTable(rows) {
        $('rowCount').textContent = `${rows.length.toLocaleString('en-US')} record${rows.length !== 1 ? 's' : ''}`;
        if (!rows.length) {
            const row = el('tr'), cell = el('td', 'No shipments match the current filters.', 'text-center py-4 text-muted');
            cell.colSpan = 8; row.append(cell); $('cargoTableBody').replaceChildren(row);
            return;
        }
        $('cargoTableBody').replaceChildren(...rows.map(shipment => {
            const row = el('tr');
            row.append(...[shipment.cargo_description, shipment.mode, shipment.ship_type, shipment.origin, shipment.destination].map(value => el('td', value || '—')),
                el('td', formatDate(shipment.rts_date)), statusCell(shipment.status), locationCell(shipment));
            return row;
        }));
    }

    // ---- Linking a tracker (office staff) ---------------------------------------------------------
    const dialog = $('trackerDialog'), dialogStatus = $('trackerStatus');
    // shipment: the one being changed; choice: the tracker chosen; move: a tracker the database said is on another
    // shipment, so the next try moves it.
    let current = null;
    dialog.addEventListener('cancel', event => {
        if (lock.busy && event.cancelable) { event.preventDefault(); dialogStatus.textContent = STILL_SAVING; }
    });
    dialog.addEventListener('close', () => {
        // A second Escape closes the dialog whatever the page does; keep it open until the save and the re-read finish.
        if (lock.busy) { dialog.showModal(); dialogStatus.textContent = STILL_SAVING; return; }
        const shipmentId = current?.shipment.id;
        current = null;
        const opener = $('cargoTableBody').querySelector(`button[data-shipment-id="${shipmentId}"]`);
        (opener || $('pageMessage')).focus();
    });
    const focusDialog = () => ($('trackerChoice') || $('trackerTitle')).focus();

    function openTrackerDialog(shipment) {
        if (lock.busy) return;
        current = { shipment, choice: '', move: null };
        dialogStatus.textContent = '';
        renderDialog();
        dialog.showModal();
        focusDialog();
    }

    function choicesFor(shipment) {
        const numbers = new Map(data.shipments.map(row => [row.id, numberOf(row)]));
        return where.trackerChoices(data.trackers, data.links, numbers, shipment.id, Date.now());
    }
    const moving = choice => Boolean(choice && (choice.elsewhere || current.move === choice.id));

    function renderDialog() {
        const { shipment } = current;
        const linked = data.linkByShipment.get(shipment.id) || null;
        const choices = choicesFor(shipment);
        const title = el('h2', `Tracker for shipment ${numberOf(shipment)}`, 'h5');
        title.id = 'trackerTitle'; title.tabIndex = -1;
        const parts = [title, el('p', [shipment.cargo_description, shipment.status].filter(Boolean).join(' · '), 'text-muted'),
            el('p', linked ? `Linked now: ${trackerName(linked)}, since ${timeText(linked.linked_at)}.` : 'No tracker is linked to this shipment.')];
        const actions = el('div', '', 'd-flex flex-wrap gap-2 mt-3');
        if (choices.length) {
            const label = el('label', 'Tracker', 'form-label'); label.htmlFor = 'trackerChoice';
            const select = el('select', '', 'form-select'); select.id = 'trackerChoice';
            select.append(new Option('Choose a tracker', ''), ...choices.map(choice => new Option(choice.text, choice.id)));
            select.value = current.choice;
            const note = el('p', '', 'small shipment-location-warn mt-2'); note.id = 'trackerMoveNote';
            const save = button('Link tracker', 'btn btn-primary', () => linkTracker());
            save.id = 'trackerSave';
            const update = () => {
                const choice = choices.find(item => item.id === select.value);
                current.choice = select.value;
                note.textContent = !moving(choice) ? '' : `${choice.name} is on ${choice.elsewhere || 'another shipment'}. Linking it here takes it off that shipment.`;
                note.hidden = !note.textContent;
                save.textContent = moving(choice) ? 'Move tracker here' : 'Link tracker';
                save.disabled = !choice || choice.here;
            };
            select.addEventListener('change', update);
            parts.push(label, select, note);
            actions.append(save);
            update();
        } else {
            parts.push(el('p', data.trackersReady ? 'This project has no trackers yet.' : "The trackers couldn't be loaded, so none can be linked right now.", 'text-muted'));
        }
        if (linked) actions.append(button('Unlink tracker', 'btn btn-outline-danger', () => unlinkTracker(linked)));
        actions.append(button('Cancel', 'btn btn-outline-secondary', () => dialog.close()));
        $('trackerContent').replaceChildren(...parts, actions);
    }

    function setBusy(busy) {
        lock.busy = busy;
        for (const control of $('trackerContent').querySelectorAll('button')) control.disabled = busy;
        const select = $('trackerChoice');
        if (select) select.disabled = busy;
    }

    // After a change, or a refusal that means the links changed meanwhile: read them again and redraw. Says whether it could.
    async function refreshLinks() {
        let read = true;
        try { setLinks(await fetchLinks()); } catch (error) { read = false; }
        applyFilters();
        return read;
    }
    const NOT_REFRESHED = " The list couldn't be refreshed, so other recent changes may not show; reload the page to see them.";

    // A refused change: re-read the links, then show the dialog again with the reason. The dialog stays busy until then.
    async function refused(error) {
        const read = await refreshLinks();
        setBusy(false);
        renderDialog();
        dialogStatus.textContent = where.errorMessage(error) + (read ? '' : NOT_REFRESHED);
        focusDialog();
    }

    async function linkTracker() {
        if (lock.busy || !current) return;
        const { shipment } = current;
        const choice = choicesFor(shipment).find(item => item.id === current.choice);
        if (!choice || choice.here) return;
        const move = moving(choice);
        setBusy(true);
        dialogStatus.textContent = 'Saving…';
        const { data: link, error } = await supabaseClient.rpc('link_shipment_tracker', { p_shipment_id: shipment.id, p_tracker_id: choice.id, p_move: move });
        if (error) {
            // The database says the tracker is on another shipment this page didn't know of: offer to move it.
            if (error.code === '23505') current.move = choice.id;
            await refused(error);
            return;
        }
        const read = await refreshLinks();
        if (!read && link) { setLinks([...data.links.filter(row => row.shipment_id !== shipment.id && row.tracker_id !== choice.id), link]); applyFilters(); }
        setBusy(false);
        message(`${choice.name} is linked to shipment ${numberOf(shipment)}${choice.elsewhere ? `, and no longer to ${choice.elsewhere}` : ''}.${read ? '' : NOT_REFRESHED}`);
        dialog.close();
    }

    async function unlinkTracker(linked) {
        if (lock.busy || !current) return;
        const { shipment } = current, name = trackerName(linked);
        setBusy(true);
        dialogStatus.textContent = 'Saving…';
        const { error } = await supabaseClient.rpc('unlink_shipment_tracker', { p_shipment_id: shipment.id, p_tracker_id: linked.tracker_id });
        if (error) { await refused(error); return; }
        const read = await refreshLinks();
        if (!read) { setLinks(data.links.filter(row => row.shipment_id !== shipment.id)); applyFilters(); }
        setBusy(false);
        message(`${name} is no longer linked to shipment ${numberOf(shipment)}.${read ? '' : NOT_REFRESHED}`);
        dialog.close();
    }

    for (const id of ['filterShipType', 'filterMode', 'filterStatus']) $(id).addEventListener('change', applyFilters);
    $('filterSearch').addEventListener('input', applyFilters);
    await load();
})();

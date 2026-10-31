(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const logistics = InvenioLogistics, inv = InvenioInventory, L = window.L;
    const profile = InvenioCurrentProfile;
    // Places belong to no single project, so office staff manage them whichever project is open. A yard or site
    // can be tied to a project they can work in (an active one); a place tied to any other project is read-only.
    const office = ['office_staff', 'admin'].includes(profile.role);
    const workable = InvenioProjectScope.availableProjects.filter(project => project.status === 'active');
    const canChange = place => office && (!place.project_id || workable.some(project => project.id === place.project_id));
    const projectName = id => InvenioProjectScope.availableProjects.find(project => project.id === id)?.name || 'Another project';
    const lockedReason = place => InvenioProjectScope.availableProjects.some(project => project.id === place.project_id)
        ? `This place belongs to ${projectName(place.project_id)}, which is not an active project, so it can't be changed.`
        : 'This place belongs to a project you are not assigned to, so only staff on that project can change it.';
    const lock = { busy: false };
    const STILL_SAVING = 'Still saving the last change. Try again in a moment.';
    const NOT_SAVED = 'Nothing was changed. This place may belong to a project you are not assigned to; reload the page and try again.';
    const CHANGED = 'This place was changed after you opened the form. Cancel to see the latest version, then make your changes again.';
    const KIND_COLOURS = { yard: '#174fda', site: '#059669', outside_shop: '#d97706', vendor: '#7c3aed', other: '#64748b' };
    const HOME = [[SITE_CONFIG.LATITUDE, SITE_CONFIG.LONGITUDE], 9];
    const message = text => { $('pageMessage').textContent = text; };
    function el(tag, text = '', className = '') {
        const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    function button(text, className, onclick, label) {
        const node = el('button', text, className); node.type = 'button'; node.onclick = onclick;
        if (label) node.setAttribute('aria-label', label);
        return node;
    }
    function field(container, labelText, control, id) {
        const label = el('label', labelText, 'form-label'); label.htmlFor = id; control.id = id;
        const wrap = el('div', '', 'mb-3'); wrap.append(label, control); container.append(wrap); return control;
    }
    const textNode = text => el('span', text);
    function kindChip(place) {
        const chip = el('span', '', 'chip chip-muted'), dot = el('span', '', 'place-dot');
        dot.style.background = KIND_COLOURS[place.kind] || KIND_COLOURS.other;
        chip.append(dot, el('span', logistics.PLACE_KINDS[place.kind] || place.kind));
        return chip;
    }
    // The same OpenStreetMap setup as GPS Tracking.
    function baseMap(container, center, zoom) {
        const map = L.map(container).setView(center, zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
        return map;
    }

    let places = [], filtered = [], retired = false, listMap = null, listLayer = null, form = null;

    async function load() {
        // Shared by every project, so read with the unscoped client.
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabaseClient.from('places').select('*').order('id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) break;
        }
        places = rows;
        applyFilters();
    }

    function applyFilters() {
        filtered = logistics.filterPlaces(places, { kind: $('filterKind').value, retired, search: $('filterSearch').value });
        const pool = places.filter(place => (place.is_active === false) === retired).length, state = retired ? 'retired' : 'active';
        $('resultSummary').textContent = filtered.length === pool ? `${pool.toLocaleString()} ${state} ${pool === 1 ? 'place' : 'places'}`
            : `${filtered.length.toLocaleString()} of ${pool.toLocaleString()} ${state} places match`;
        renderTable(); renderMap();
    }

    function renderTable() {
        const body = $('placeRows'); body.replaceChildren();
        if (!filtered.length) {
            const pool = places.some(place => (place.is_active === false) === retired);
            const row = el('tr'), cell = el('td', pool ? 'No places match these filters.' : retired ? 'No retired places.'
                : office ? 'No places yet. Add your yards and sites, outside shops and vendors.' : 'No places yet.', 'text-muted');
            cell.colSpan = 5; row.append(cell); body.append(row);
        }
        for (const place of filtered) {
            const row = el('tr'), name = el('td'), kind = el('td'), contact = el('td');
            // The name opens the place, so a phone needn't scroll the table sideways to reach a button.
            name.append(button(place.name, 'btn btn-link p-0 text-start fw-semibold row-open', () => openPlace(place.id)));
            if (place.project_id) name.append(el('div', projectName(place.project_id), 'small text-muted'));
            kind.append(kindChip(place));
            if (place.contact_name) contact.append(el('div', place.contact_name));
            if (place.contact_phone) contact.append(el('div', place.contact_phone, 'small text-muted'));
            const point = logistics.hasPoint(place);
            row.append(name, kind, el('td', logistics.placeAddress(place), 'small'),
                el('td', point ? `${place.geofence_radius_m.toLocaleString()} m` : 'No map point', point ? 'num' : 'small text-muted'), contact);
            body.append(row);
        }
    }

    function renderMap() {
        if (!listMap) { listMap = baseMap($('placesMap'), ...HOME); listLayer = L.layerGroup().addTo(listMap); }
        listLayer.clearLayers();
        const points = [];
        for (const place of filtered) {
            if (!logistics.hasPoint(place)) continue;
            const at = [Number(place.latitude), Number(place.longitude)], colour = KIND_COLOURS[place.kind] || KIND_COLOURS.other;
            L.circle(at, { radius: place.geofence_radius_m, color: colour, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(listLayer);
            L.circleMarker(at, { radius: 7, color: '#ffffff', weight: 2, fillColor: colour, fillOpacity: 1 })
                .bindTooltip(textNode(place.name)).on('click', () => openPlace(place.id)).addTo(listLayer);
            points.push(at);
        }
        if (points.length) listMap.fitBounds(points, { padding: [30, 30], maxZoom: 14 }); else listMap.setView(...HOME);
        const missing = filtered.length - points.length;
        $('mapNote').textContent = !filtered.length ? '' : !points.length ? 'None of these places has a map point yet.'
            : `Circles show each place's arrival radius. Select a marker for details.${missing ? ` ${missing.toLocaleString()} without a map point ${missing === 1 ? 'is' : 'are'} only in the list.` : ''}`;
    }

    // ---- Drawer: a place's details, or the form to add or edit one ------------------------------
    const drawer = $('placeDrawer'), drawerStatus = $('placeStatus');
    // shown counts what the drawer has displayed, so a late result doesn't replace something opened since.
    let closing = false, shown = 0;
    // Escape asks first. Chrome lets a page refuse Escape only once per user action, so a second Escape closes the
    // drawer regardless; the close handler then reopens it while a save runs, or if the user keeps their changes.
    drawer.addEventListener('cancel', event => { if (event.cancelable) { event.preventDefault(); closeDrawer(); } });
    drawer.addEventListener('close', () => {
        if (!closing && (lock.busy || (form?.dirty && !confirm('Discard changes to this place?')))) {
            drawer.showModal();
            if (lock.busy) drawerStatus.textContent = STILL_SAVING;
            return;
        }
        closing = false;
        form?.map?.remove(); form = null; window.InvenioUnsavedChanges = false;
    });
    function shut() {
        if (!drawer.open) return;
        closing = true; drawer.close();
    }
    function closeDrawer() {
        if (lock.busy) { drawerStatus.textContent = STILL_SAVING; return; }
        if (form?.dirty && !confirm('Discard changes to this place?')) return;
        shut();
    }
    function drawerHeader(text) {
        const header = el('div', '', 'work-page-header'), title = el('h2', text);
        title.id = 'placeTitle'; title.tabIndex = -1;
        const close = button('Close', 'btn btn-outline-secondary', closeDrawer); close.dataset.focusKey = 'close';
        header.append(title, close);
        return header;
    }

    /** Shows a place read-only, with Edit and Retire or Restore for office staff who may change it. */
    function openPlace(id, { focus = 'close', note = '' } = {}) {
        const place = places.find(item => item.id === id);
        if (!place) { shut(); return; }
        shown++;
        form?.map?.remove(); form = null; window.InvenioUnsavedChanges = false;
        const content = $('placeContent'); content.replaceChildren();
        const badges = el('p', '', 'd-flex flex-wrap gap-2 align-items-center');
        badges.append(kindChip(place));
        if (place.is_active === false) badges.append(el('span', 'Retired', 'chip chip-warn'));
        content.append(drawerHeader(place.name), badges);
        const point = logistics.hasPoint(place);
        const fields = [
            ['Project', place.project_id ? projectName(place.project_id) : ''], ['Address', logistics.placeAddress(place)],
            ['Map point', point ? `${Number(place.latitude).toFixed(6)}, ${Number(place.longitude).toFixed(6)}` : 'Not set'],
            ['Arrival radius', point ? `${place.geofence_radius_m.toLocaleString()} m` : ''],
            ['Contact', [place.contact_name, place.contact_phone, place.contact_email].filter(Boolean).join('\n')],
            ['Second contact', [place.secondary_contact_name, place.secondary_contact_phone].filter(Boolean).join('\n')],
            ['Notes', place.notes], ['Last changed', place.updated_at ? new Date(place.updated_at).toLocaleString() : ''],
        ];
        const list = el('dl', '', 'record-fields');
        for (const [label, value] of fields) {
            if (!value) continue;
            const pair = el('div'); pair.append(el('dt', label), el('dd', value)); list.append(pair);
        }
        const section = el('section', '', 'record-section mb-3'); section.append(el('h3', 'Details', 'h6'), list);
        content.append(section);
        const actions = el('div', '', 'd-flex flex-wrap gap-2');
        if (canChange(place)) {
            const edit = button('Edit', 'btn btn-primary', () => openForm(place)); edit.dataset.focusKey = 'edit';
            const toggle = place.is_active === false ? button('Restore', 'btn btn-outline', () => setActive(place, true)) : button('Retire', 'btn btn-outline', () => setActive(place, false));
            toggle.dataset.focusKey = place.is_active === false ? 'restore' : 'retire';
            actions.append(edit, toggle);
        }
        if (point) {
            actions.append(button('Show on map', 'btn btn-outline', () => {
                shut(); listMap.setView([Number(place.latitude), Number(place.longitude)], 15); $('placesMap').scrollIntoView?.({ block: 'center' });
            }));
        }
        content.append(actions);
        if (office && !canChange(place)) content.append(el('p', lockedReason(place), 'small text-muted mt-2'));
        if (!drawer.open) drawer.showModal();
        // The status line stays in the drawer between views, so screen readers announce what changes in it.
        drawerStatus.textContent = note;
        (content.querySelector(`[data-focus-key="${focus}"]`) || content.querySelector('[data-focus-key="close"]')).focus();
    }

    async function setActive(place, active) {
        if (lock.busy) { drawerStatus.textContent = STILL_SAVING; return; }
        if (!active && !confirm(`Retire ${place.name}? It stays on record and can be restored, but it is no longer offered for new crates and loads.`)) return;
        drawerStatus.textContent = active ? 'Restoring…' : 'Retiring…';
        const view = shown;
        const result = await inv.writeThenReload(lock, [async () => {
            const { data, error } = await supabaseClient.from('places').update({ is_active: active }).eq('id', place.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error(NOT_SAVED);
        }], load);
        const verb = active ? 'restore' : 'retire';
        const text = result.error
            ? `Could not ${verb} ${place.name}: ${logistics.errorMessage(result.error, `Another active place is already called "${place.name}". Rename one of them, then restore this one.`)}`
            : active ? `${place.name} is active again.` : `${place.name} is retired. Choose Retired above the list to find it again.`;
        const stale = result.reloadError ? ` The list could not refresh (${logistics.errorMessage(result.reloadError)}). Reload the page.` : '';
        message(text + stale);
        if (!drawer.open || shown !== view) return;
        // Focus goes to whichever of Retire or Restore the place now shows.
        const nowActive = result.error ? !active : active;
        openPlace(place.id, { focus: nowActive ? 'retire' : 'restore', note: text + stale });
    }

    function openForm(place) {
        shown++;
        form?.map?.remove();
        const state = form = { place, dirty: false, map: null, marker: null, circle: null };
        const markDirty = () => { state.dirty = true; window.InvenioUnsavedChanges = true; };
        const content = $('placeContent'); content.replaceChildren();
        const node = el('form'); node.noValidate = true;
        const inputs = {};
        const add = (key, label, control, container = node) => { inputs[key] = field(container, label, control, `place_${key}`); return inputs[key]; };
        const text = (key, label, container, type = 'text') => {
            const input = add(key, label, el('input', '', 'form-control'), container);
            input.type = type; input.maxLength = logistics.PLACE_TEXT[key]?.[1] || 120; input.autocomplete = 'off'; input.value = place?.[key] ?? '';
            return input;
        };
        const kind = add('kind', 'Kind', el('select', '', 'form-select'));
        kind.append(new Option('Choose a kind', ''), ...Object.entries(logistics.PLACE_KINDS).map(([value, label]) => new Option(label, value)));
        kind.value = place?.kind || '';
        text('name', 'Name').required = true;
        const project = add('project_id', 'Project', el('select', '', 'form-select'));
        project.append(new Option('None (shared by every project)', ''), ...workable.map(item => new Option(item.name, item.id)));
        project.value = place?.project_id || '';
        const showProject = () => { project.parentNode.hidden = !logistics.PROJECT_KINDS.has(kind.value); };
        kind.onchange = () => { showProject(); state.circle?.setStyle({ color: KIND_COLOURS[kind.value] || KIND_COLOURS.other }); markDirty(); };
        showProject();

        const address = el('fieldset', '', 'place-form-grid'); address.append(el('legend', 'Address', 'h6'));
        text('address', 'Street address', address).parentNode.className = 'mb-3 span-2';
        text('city', 'City', address); text('state', 'State', address); text('postal_code', 'Postal code', address);
        node.append(address);

        const where = el('fieldset', '', 'place-form-grid'); where.append(el('legend', 'Map point', 'h6'));
        const hint = el('p', 'Click the map to set the point, then drag the pin to adjust it. You can also type the coordinates.', 'small text-muted span-2');
        const mapBox = el('div', '', 'place-form-map span-2'); mapBox.setAttribute('role', 'region'); mapBox.setAttribute('aria-label', 'Map for choosing the point');
        where.append(hint, mapBox);
        const latitude = text('latitude', 'Latitude', where), longitude = text('longitude', 'Longitude', where);
        latitude.inputMode = longitude.inputMode = 'decimal';
        latitude.value = place && logistics.hasPoint(place) ? Number(place.latitude).toFixed(6) : '';
        longitude.value = place && logistics.hasPoint(place) ? Number(place.longitude).toFixed(6) : '';
        // Text, not type="number": a number field turns "1500m" into "" and that would quietly save the 300 m default.
        const radius = add('geofence_radius_m', 'Arrival radius (metres)', el('input', '', 'form-control'), where);
        Object.assign(radius, { type: 'text', inputMode: 'numeric', autocomplete: 'off', maxLength: 6, value: String(place?.geofence_radius_m ?? logistics.RADIUS.standard) });
        const clear = button('Clear point', 'btn btn-sm btn-ghost', () => { latitude.value = longitude.value = ''; markDirty(); syncPoint(); });
        const clearWrap = el('div', '', 'mb-3 d-flex align-items-end'); clearWrap.append(clear); where.append(clearWrap);
        where.append(el('p', `A tracker inside this circle counts as arrived. ${logistics.RADIUS.min} to ${logistics.RADIUS.max.toLocaleString()} metres; ${logistics.RADIUS.standard} if left blank.`, 'small text-muted span-2'));
        node.append(where);

        const contacts = el('fieldset', '', 'place-form-grid'); contacts.append(el('legend', 'Contacts', 'h6'));
        text('contact_name', 'Contact name', contacts); text('contact_phone', 'Contact phone', contacts, 'tel');
        text('contact_email', 'Contact email', contacts, 'email').parentNode.className = 'mb-3 span-2';
        text('secondary_contact_name', 'Second contact name', contacts); text('secondary_contact_phone', 'Second contact phone', contacts, 'tel');
        node.append(contacts);
        const notes = add('notes', 'Notes', el('textarea', '', 'form-control'));
        notes.rows = 3; notes.maxLength = logistics.PLACE_TEXT.notes[1]; notes.value = place?.notes || '';

        const actions = el('div', '', 'd-flex gap-2');
        const save = el('button', place ? 'Save changes' : 'Add place', 'btn btn-primary'); save.type = 'submit';
        actions.append(save, button('Cancel', 'btn btn-ghost', () => {
            if (lock.busy) { status.textContent = STILL_SAVING; return; }
            if (state.dirty && !confirm('Discard changes to this place?')) return;
            window.InvenioUnsavedChanges = false;
            if (place) openPlace(place.id, { focus: 'edit' }); else shut();
        }));
        const status = drawerStatus; status.textContent = '';
        node.append(actions);
        node.oninput = markDirty;
        content.append(drawerHeader(place ? `Edit ${place.name}` : 'Add place'), node);

        // The pin and circle follow whatever coordinates and radius are typed, when they make sense.
        function typedPoint() {
            const lat = Number(latitude.value), lng = Number(longitude.value);
            return latitude.value.trim() && longitude.value.trim() && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
        }
        function typedRadius() {
            const value = Number(radius.value);
            return Number.isInteger(value) && value >= logistics.RADIUS.min && value <= logistics.RADIUS.max ? value : logistics.RADIUS.standard;
        }
        function syncPoint() {
            if (!state.map) return;
            const at = typedPoint();
            if (!at) { state.marker?.remove(); state.circle?.remove(); state.marker = state.circle = null; return; }
            if (!state.marker) {
                state.marker = L.marker(at, { draggable: true, icon: L.divIcon({ className: 'place-pin', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(state.map);
                state.marker.on('dragend', () => setPoint(state.marker.getLatLng()));
                state.circle = L.circle(at, { radius: typedRadius(), color: KIND_COLOURS[kind.value] || KIND_COLOURS.other, weight: 1, fillOpacity: 0.1, interactive: false }).addTo(state.map);
            } else { state.marker.setLatLng(at); state.circle.setLatLng(at); }
            state.circle.setRadius(typedRadius());
        }
        function setPoint(latLng) {
            // After panning round the world Leaflet reports longitudes past ±180; bring them back.
            const point = latLng.wrap?.() || latLng;
            latitude.value = point.lat.toFixed(6); longitude.value = point.lng.toFixed(6);
            markDirty(); syncPoint();
        }
        latitude.oninput = longitude.oninput = radius.oninput = syncPoint;

        node.onsubmit = async event => {
            event.preventDefault();
            if (lock.busy) { status.textContent = STILL_SAVING; return; }
            const result = logistics.placeValues(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])));
            if (result.error) { status.textContent = result.error; inputs[result.field]?.focus(); return; }
            const values = result.values;
            let savedId = place?.id;
            save.disabled = true; status.textContent = 'Saving…';
            // Saved or refused, the list is reloaded: a refusal often means it was out of date.
            // An edit only lands on the version the form was opened from, so two people can't overwrite each other.
            const outcome = await inv.writeThenReload(lock, [async () => {
                const request = place ? supabaseClient.from('places').update(values).eq('id', place.id).eq('updated_at', place.updated_at) : supabaseClient.from('places').insert(values);
                const { data, error } = await request.select('id');
                if (error) throw error;
                // Nothing matched: row security hid the place, or it changed after the form opened.
                if (!data?.length) throw new Error(NOT_SAVED);
                savedId = data[0].id;
            }], load);
            const changed = outcome.error?.message === NOT_SAVED && place && places.find(item => item.id === place.id)?.updated_at !== place.updated_at;
            const reason = outcome.error && (changed ? CHANGED : logistics.errorMessage(outcome.error, `Another active place is already called "${values.name}". Choose a different name.`));
            if (form !== state) { message(reason ? `Could not save ${values.name}: ${reason}` : `Saved ${values.name}.`); return; }
            save.disabled = false;
            if (reason) { status.textContent = `Could not save: ${reason}`; return; }
            state.dirty = false; window.InvenioUnsavedChanges = false;
            if (outcome.reloadError) {
                shut();
                message(`Saved ${values.name}, but the list could not refresh (${logistics.errorMessage(outcome.reloadError)}). Reload the page.`);
                return;
            }
            message(`Saved ${values.name}.`);
            openPlace(savedId, { focus: 'edit', note: `Saved ${values.name}.` });
        };

        if (!drawer.open) drawer.showModal();
        // Leaflet measures its box, so the map starts once the drawer is open.
        const center = typedPoint() || (listMap ? [listMap.getCenter().lat, listMap.getCenter().lng] : HOME[0]);
        state.map = baseMap(mapBox, center, typedPoint() ? 15 : listMap?.getZoom() ?? HOME[1]);
        state.map.on('click', event => setPoint(event.latlng));
        setTimeout(() => state.map?.invalidateSize(), 0);
        syncPoint();
        (place ? inputs.name : kind).focus();
    }

    // ---- Wiring -----------------------------------------------------------------------------
    $('filterKind').append(new Option('All kinds', ''), ...Object.entries(logistics.PLACE_KINDS).map(([value, label]) => new Option(label, value)));
    for (const [kind, label] of Object.entries(logistics.PLACE_KINDS)) {
        const dot = el('span', '', 'legend-dot'); dot.style.background = KIND_COLOURS[kind];
        $('mapLegend').append(dot, el('span', label));
    }
    $('filterKind').onchange = applyFilters;
    $('filterSearch').oninput = applyFilters;
    const setRetired = value => {
        retired = value;
        $('showActive').setAttribute('aria-pressed', String(!value)); $('showRetired').setAttribute('aria-pressed', String(value));
        applyFilters();
    };
    $('showActive').onclick = () => setRetired(false);
    $('showRetired').onclick = () => setRetired(true);
    $('addPlace').hidden = !office;
    $('addPlace').onclick = () => openForm(null);
    try { await load(); }
    catch (error) { message(`Could not load places: ${logistics.errorMessage(error)}`); }
})();

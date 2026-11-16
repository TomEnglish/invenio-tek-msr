(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const setup = InvenioYardSetup, inv = InvenioInventory;
    const profile = InvenioCurrentProfile, project = InvenioProjectScope.activeProject, projectId = InvenioProjectScope.getActiveProjectId();
    // Racks belong to one project: the one open now, named on the page and in the form. Office staff and
    // administrators manage them while the project is active; everyone else on the project reads them.
    const officeRole = ['office_staff', 'admin'].includes(profile.role);
    const office = officeRole && project.status === 'active';
    const lock = { busy: false };
    const STILL_SAVING = 'Still saving the last change. Try again in a moment.';
    const NOT_SAVED = 'Nothing was changed. Reload the page and try again.';
    const CHANGED = 'This rack was changed after you opened the form. Cancel to see the latest version, then make your changes again.';
    const message = text => { $('pageMessage').textContent = text; };
    function el(tag, text = '', className = '') {
        const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    function button(text, className, onclick, label) {
        const node = el('button', text, className); node.type = 'button'; node.onclick = onclick;
        if (label) node.setAttribute('aria-label', label);
        return node;
    }
    function link(text, href, className = '') {
        const node = el('a', text, className); node.href = href; return node;
    }
    function field(container, labelText, control, id) {
        const label = el('label', labelText, 'form-label'); label.htmlFor = id; control.id = id;
        const wrap = el('div', '', 'mb-3'); wrap.append(label, control); container.append(wrap); return control;
    }

    let racks = [], areas = new Map(), areasError = null, places = [], placesError = null, filtered = [], retired = false, form = null;
    const placeOf = id => places.find(item => item.id === id);
    const placeName = id => { const place = placeOf(id); return place ? `${place.name}${place.is_active === false ? ' (retired)' : ''}` : id ? 'Unavailable' : ''; };
    const areaOf = rack => areas.get(rack.id) || null;
    const describe = rack => `${placeName(rack.place_id)} ${areaOf(rack)?.area || ''} ${rack.is_hold_area ? 'hold area' : ''}`;

    async function fetchAll(table, columns) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await projectSupabaseClient.from(table).select(columns).order(table === 'locations' ? 'id' : 'location_id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) break;
        }
        return rows;
    }
    // The racks are the page; their areas, the yards and the checklist are extras that may each fail on their own.
    async function load() {
        const [rackRows, areaRows, placeRows, status] = await Promise.all([
            fetchAll('locations', '*'),
            fetchAll('location_areas', 'location_id,zone_id,site_map_id,area,place_name').then(data => ({ data }), error => ({ error })),
            supabaseClient.from('places').select('id,name,kind,project_id,is_active').in('kind', ['yard', 'site'])
                .or(`project_id.is.null,project_id.eq.${projectId}`).order('name'),
            officeRole ? supabaseClient.rpc('project_setup_status', { p_project_id: projectId }) : { data: [] },
        ]);
        racks = rackRows;
        areasError = areaRows.error || null;
        areas = new Map((areaRows.data || []).filter(row => row.zone_id).map(row => [row.location_id, row]));
        places = placeRows.data || []; placesError = placeRows.error || null;
        renderSetup(status.error ? null : status.data?.[0] || null);
        renderPlaceFilter();
        applyFilters();
    }

    // ---- What the project still needs before work can start -------------------------------------
    function renderSetup(status) {
        const panel = $('setupPanel'), list = $('setupSteps');
        const steps = status ? setup.setupSteps(status, projectId) : [];
        panel.hidden = !steps.some(step => !step.done);
        list.replaceChildren();
        if (panel.hidden) return;
        $('setupTitle').textContent = `Before work can start in ${project.name}`;
        for (const step of steps) {
            const item = el('li', '', step.done ? 'setup-step is-done' : 'setup-step');
            item.append(el('span', step.done ? 'Done' : 'To do', step.done ? 'chip chip-success' : 'chip chip-warn'), el('strong', step.title), el('span', step.detail, 'small text-muted'));
            // This page is where racks are added, so its own steps point at the button above.
            if (!step.done && office && !step.href.startsWith('racks.html')) item.append(link(step.action, step.href, 'small'));
            list.append(item);
        }
    }

    function renderPlaceFilter() {
        const select = $('filterPlace'), wanted = select.value;
        const used = new Set(racks.map(rack => rack.place_id).filter(Boolean));
        select.replaceChildren(new Option('All yards and sites', ''), new Option('No yard or site yet', 'none'),
            ...places.filter(place => place.is_active !== false || used.has(place.id)).map(place => new Option(placeName(place.id), place.id)));
        select.value = wanted;
    }

    function applyFilters() {
        filtered = setup.filterRacks(racks, { place: $('filterPlace').value, retired, search: $('filterSearch').value, describe });
        const pool = racks.filter(rack => !setup.isActive(rack) === retired).length, state = retired ? 'retired' : 'active';
        $('resultSummary').textContent = filtered.length === pool ? `${pool.toLocaleString()} ${state} ${pool === 1 ? 'rack' : 'racks'}`
            : `${filtered.length.toLocaleString()} of ${pool.toLocaleString()} ${state} racks match`;
        renderTable();
    }

    function renderTable() {
        const body = $('rackRows'); body.replaceChildren();
        if (!filtered.length) {
            const pool = racks.some(rack => !setup.isActive(rack) === retired);
            const row = el('tr'), cell = el('td', pool ? 'No racks match these filters.' : retired ? 'No retired racks.'
                : office ? 'No racks yet. Choose Add rack to make the first one.' : 'No racks yet.', 'text-muted');
            cell.colSpan = 4; row.append(cell); body.append(row);
        }
        for (const rack of filtered) {
            const row = el('tr'), name = el('td'), area = areaOf(rack);
            // The name opens the rack, so a phone needn't scroll the table sideways to reach a button.
            name.append(button(setup.rackLabel(rack), 'btn btn-link p-0 text-start fw-semibold row-open', () => openRack(rack.id)));
            if (rack.is_hold_area) name.append(' ', el('span', 'Hold area', 'chip chip-warn'));
            row.append(name, el('td', placeName(rack.place_id) || 'No yard or site yet', rack.place_id ? '' : 'small text-muted'),
                el('td', area ? area.area : areasError ? 'Could not be loaded' : 'Not linked to an area', area ? '' : 'small text-muted'),
                el('td', rack.capacity ? rack.capacity.toLocaleString() : '', 'num'));
            body.append(row);
        }
    }

    // ---- Drawer: a rack's details, or the form to add or edit one --------------------------------
    const drawer = $('rackDrawer'), drawerStatus = $('rackStatus');
    // shown counts what the drawer has displayed, so a late result doesn't replace something opened since.
    let closing = false, shown = 0;
    // Escape asks first. Chrome lets a page refuse Escape only once per user action, so a second Escape closes the
    // drawer regardless; the close handler then reopens it while a save runs, or if the user keeps their changes.
    drawer.addEventListener('cancel', event => { if (event.cancelable) { event.preventDefault(); closeDrawer(); } });
    drawer.addEventListener('close', () => {
        if (!closing && (lock.busy || (form?.dirty && !confirm('Discard changes to this rack?')))) {
            drawer.showModal();
            if (lock.busy) drawerStatus.textContent = STILL_SAVING;
            return;
        }
        closing = false; form = null; window.InvenioUnsavedChanges = false;
    });
    function shut() {
        if (!drawer.open) return;
        closing = true; drawer.close();
    }
    function closeDrawer() {
        if (lock.busy) { drawerStatus.textContent = STILL_SAVING; return; }
        if (form?.dirty && !confirm('Discard changes to this rack?')) return;
        shut();
    }
    function drawerHeader(text) {
        const header = el('div', '', 'work-page-header'), title = el('h2', text);
        title.id = 'rackTitle'; title.tabIndex = -1;
        const close = button('Close', 'btn btn-outline-secondary', closeDrawer); close.dataset.focusKey = 'close';
        header.append(title, close);
        return header;
    }

    /** Shows a rack read-only, with Edit and Retire or Restore for office staff. */
    function openRack(id, { focus = 'close', note = '' } = {}) {
        const rack = racks.find(item => item.id === id);
        if (!rack) { shut(); return; }
        shown++;
        form = null; window.InvenioUnsavedChanges = false;
        const content = $('rackContent'); content.replaceChildren();
        const active = setup.isActive(rack), area = areaOf(rack);
        const badges = el('p', '', 'd-flex flex-wrap gap-2 align-items-center');
        if (rack.is_hold_area) badges.append(el('span', 'Hold area', 'chip chip-warn'));
        badges.append(el('span', active ? 'Active' : 'Retired', active ? 'chip chip-success' : 'chip chip-muted'));
        content.append(drawerHeader(setup.rackLabel(rack)), badges);
        const list = el('dl', '', 'record-fields');
        const pair = (label, ...value) => { const item = el('div'), dd = el('dd'); dd.append(...value); item.append(el('dt', label), dd); list.append(item); };
        pair('Project', project.name);
        pair('Yard or site', placeName(rack.place_id) || 'Not set yet');
        if (area) pair('Area on the site plan', area.area, ' ', link('Open on Site Maps', `site-maps.html?map=${encodeURIComponent(area.site_map_id)}`, 'small'));
        else pair('Area on the site plan', areasError ? 'Could not be loaded' : 'Not linked to an area yet');
        if (rack.capacity) pair('Capacity', rack.capacity.toLocaleString());
        if (rack.updated_at) pair('Last changed', new Date(rack.updated_at).toLocaleString());
        const section = el('section', '', 'record-section mb-3'); section.append(el('h3', 'Details', 'h6'), list);
        content.append(section);
        const actions = el('div', '', 'd-flex flex-wrap gap-2');
        if (office) {
            const edit = button('Edit', 'btn btn-primary', () => openForm(rack)); edit.dataset.focusKey = 'edit';
            const toggle = active ? button('Retire', 'btn btn-outline', () => setActive(rack, false)) : button('Restore', 'btn btn-outline', () => setActive(rack, true));
            toggle.dataset.focusKey = active ? 'retire' : 'restore';
            actions.append(edit, toggle);
        }
        content.append(actions);
        if (officeRole && !office) content.append(el('p', `${project.name} is not an active project, so its racks can't be changed.`, 'small text-muted mt-2'));
        if (!drawer.open) drawer.showModal();
        // The status line stays in the drawer between views, so screen readers announce what changes in it.
        drawerStatus.textContent = note;
        (content.querySelector(`[data-focus-key="${focus}"]`) || content.querySelector('[data-focus-key="close"]')).focus();
    }

    async function setActive(rack, active) {
        if (lock.busy) { drawerStatus.textContent = STILL_SAVING; return; }
        const label = setup.rackLabel(rack);
        if (!active && !confirm(`Retire ${label}? It stays on record and can be restored, but it is no longer offered for receiving or moves.`)) return;
        drawerStatus.textContent = active ? 'Restoring…' : 'Retiring…';
        const view = shown;
        const result = await inv.writeThenReload(lock, [async () => {
            const { data, error } = await projectSupabaseClient.from('locations').update({ is_active: active }).eq('id', rack.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error(NOT_SAVED);
        }], load);
        const verb = active ? 'restore' : 'retire';
        const text = result.error ? `Could not ${verb} ${label}: ${setup.errorMessage(result.error, `Another active rack is already called ${label}. Rename one of them, then restore this one.`)}`
            : active ? `${label} is active again.` : `${label} is retired. Choose Retired above the list to find it again.`;
        const stale = result.reloadError ? ` The list could not refresh (${setup.errorMessage(result.reloadError)}). Reload the page.` : '';
        message(text + stale);
        if (!drawer.open || shown !== view) return;
        // Focus goes to whichever of Retire or Restore the rack now shows.
        const nowActive = result.error ? !active : active;
        openRack(rack.id, { focus: nowActive ? 'retire' : 'restore', note: text + stale });
    }

    function openForm(rack) {
        shown++;
        const state = form = { rack, dirty: false };
        const markDirty = () => { state.dirty = true; window.InvenioUnsavedChanges = true; };
        const content = $('rackContent'); content.replaceChildren();
        const node = el('form'); node.noValidate = true;
        const inputs = {};
        const add = (key, label, control, container = node) => { inputs[key] = field(container, label, control, `rack_${key}`); return inputs[key]; };
        const text = (key, label, container) => {
            const input = add(key, label, el('input', '', 'form-control'), container);
            input.type = 'text'; input.maxLength = setup.RACK_TEXT_MAX; input.autocomplete = 'off'; input.value = rack?.[key] ?? '';
            return input;
        };
        // The project is stated, never guessed: a rack goes to the project that is open.
        node.append(el('p', `Project: ${project.name}. To work on another project's racks, switch project at the top of the page first.`, 'small text-muted'));
        const names = el('fieldset', '', 'place-form-grid'); names.append(el('legend', 'Where it is', 'h6'));
        text('zone', 'Zone', names).parentNode.className = 'mb-3 span-2';
        text('row', 'Row', names); text('rack', rack ? 'Rack' : 'Rack (or first rack number)', names);
        if (!rack) {
            const last = add('rack_to', 'Through rack number (optional)', el('input', '', 'form-control'), names);
            Object.assign(last, { type: 'text', inputMode: 'numeric', autocomplete: 'off', maxLength: 9 });
            last.parentNode.className = 'mb-3 span-2';
            names.append(el('p', `To add several racks at once, enter the last rack number: Rack 1 through 10 adds ten racks, ${setup.MAX_RUN} at most.`, 'small text-muted span-2'));
        }
        node.append(names);
        // Yards and sites this project can use. A retired one stays listed only for the rack already at it.
        const place = add('place_id', 'Yard or site', el('select', '', 'form-select'));
        const choices = places.filter(item => item.is_active !== false || item.id === rack?.place_id);
        place.append(new Option('No yard or site yet', ''), ...choices.map(item => new Option(placeName(item.id), item.id)));
        if (rack?.place_id && !placeOf(rack.place_id)) place.append(new Option('Current place (unavailable)', rack.place_id));
        // A new rack starts at the project's own yard or site when it has just one.
        const own = choices.filter(item => item.project_id === projectId && item.is_active !== false);
        place.value = rack ? rack.place_id || '' : own.length === 1 ? own[0].id : '';
        node.append(el('p', placesError ? `Yards and sites could not be loaded (${setup.errorMessage(placesError)}). Reload the page to choose one.`
            : choices.length ? 'Add yards and sites on the Places page.' : 'No yards or sites yet. Add this project\'s yard on the Places page, then choose it here.', 'small text-muted'));
        const holdWrap = el('div', '', 'form-check mb-3'), hold = el('input', '', 'form-check-input'), holdLabel = el('label', 'Hold area: stock put on hold can be kept here', 'form-check-label');
        hold.type = 'checkbox'; hold.id = 'rack_is_hold_area'; hold.checked = rack?.is_hold_area === true; holdLabel.htmlFor = hold.id;
        hold.onchange = markDirty;
        holdWrap.append(hold, holdLabel); node.append(holdWrap); inputs.is_hold_area = hold;
        // Text, not type="number": a number field turns "40 pallets" into "" and that would quietly save no capacity.
        const capacity = add('capacity', 'Capacity (optional)', el('input', '', 'form-control'));
        Object.assign(capacity, { type: 'text', inputMode: 'numeric', autocomplete: 'off', maxLength: 9, value: rack?.capacity ? String(rack.capacity) : '' });

        const actions = el('div', '', 'd-flex gap-2');
        const save = el('button', rack ? 'Save changes' : 'Add rack', 'btn btn-primary'); save.type = 'submit';
        const status = drawerStatus; status.textContent = '';
        actions.append(save, button('Cancel', 'btn btn-ghost', () => {
            if (lock.busy) { status.textContent = STILL_SAVING; return; }
            if (state.dirty && !confirm('Discard changes to this rack?')) return;
            window.InvenioUnsavedChanges = false;
            if (rack) openRack(rack.id, { focus: 'edit' }); else shut();
        }));
        node.append(actions);
        node.oninput = markDirty;
        content.append(drawerHeader(rack ? `Edit ${setup.rackLabel(rack)}` : 'Add rack'), node);

        node.onsubmit = async event => {
            event.preventDefault();
            if (lock.busy) { status.textContent = STILL_SAVING; return; }
            const result = setup.rackValues({ ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])), is_hold_area: hold.checked });
            if (result.error) { status.textContent = result.error; inputs[result.field]?.focus(); return; }
            const rows = result.rows, label = rows.length === 1 ? setup.rackLabel(rows[0]) : `${rows.length} racks`;
            let savedId = rack?.id;
            save.disabled = true; status.textContent = 'Saving…';
            // Saved or refused, the list is reloaded: a refusal often means it was out of date. An edit only lands on
            // the version the form was opened from, so two people can't overwrite each other. A run is one request,
            // so either every rack in it is added or none is.
            const outcome = await inv.writeThenReload(lock, [async () => {
                let request;
                if (rack) {
                    request = projectSupabaseClient.from('locations').update(rows[0]).eq('id', rack.id);
                    if (rack.updated_at) request = request.eq('updated_at', rack.updated_at);
                } else request = projectSupabaseClient.from('locations').insert(rows);
                const { data, error } = await request.select('id');
                if (error) throw error;
                // Nothing matched: row security hid the rack, or it changed after the form opened.
                if (!data?.length) throw new Error(NOT_SAVED);
                savedId = data[0].id;
            }], load);
            const changed = outcome.error?.message === NOT_SAVED && rack && racks.find(item => item.id === rack.id)?.updated_at !== rack.updated_at;
            const reason = outcome.error && (changed ? CHANGED : setup.errorMessage(outcome.error));
            if (form !== state) { message(reason ? `Could not save ${label}: ${reason}` : `Saved ${label}.`); return; }
            save.disabled = false;
            if (reason) { status.textContent = `Could not save: ${reason}`; return; }
            state.dirty = false; window.InvenioUnsavedChanges = false;
            const done = rack ? `Saved ${label}.` : `Added ${label}.`;
            if (outcome.reloadError) {
                shut();
                message(`${done.slice(0, -1)}, but the list could not refresh (${setup.errorMessage(outcome.reloadError)}). Reload the page.`);
                return;
            }
            message(done);
            if (rows.length > 1) { shut(); $('pageMessage').focus(); return; }
            openRack(savedId, { focus: 'edit', note: done });
        };

        if (!drawer.open) drawer.showModal();
        inputs.zone.focus();
    }

    // ---- Wiring -----------------------------------------------------------------------------
    $('projectLine').textContent = `Project: ${project.name}`;
    $('filterPlace').onchange = applyFilters;
    $('filterSearch').oninput = applyFilters;
    const setRetired = value => {
        retired = value;
        $('showActive').setAttribute('aria-pressed', String(!value)); $('showRetired').setAttribute('aria-pressed', String(value));
        applyFilters();
    };
    $('showActive').onclick = () => setRetired(false);
    $('showRetired').onclick = () => setRetired(true);
    $('addRack').hidden = !office;
    $('addRack').onclick = () => openForm(null);
    if (!office) message(project.status === 'active' ? 'Office staff manage racks. You can view them.' : 'This project is read-only.');
    try { await load(); }
    catch (error) { message(`Could not load racks: ${setup.errorMessage(error)}`); }
})();

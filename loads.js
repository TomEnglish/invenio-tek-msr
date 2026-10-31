(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const loadsApi = InvenioLoads, inv = InvenioInventory;
    const projectId = InvenioProjectScope.getActiveProjectId();
    const profile = InvenioCurrentProfile;
    // 022: office staff plan loads, and a crew plans only a load it started. Anyone working an active project finishes
    // stops at our yards and sites; confirming without scanning, stops at shops and vendors, closing, cancelling,
    // marking found, writing off and the driver's licence are for office staff, and undoing a write-off for
    // administrators. Office staff can read licences on any project they can see, active or not.
    const working = InvenioProjectScope.activeProject.status === 'active';
    const officeRole = ['office_staff', 'admin'].includes(profile.role), office = officeRole && working, admin = profile.role === 'admin' && working;
    const roles = { office, working };
    const PHOTO_NAME = /^[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png)$/;
    const lock = { busy: false };
    const STILL_SAVING = 'Still saving the last change. Try again in a moment.';
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
    function select(options, value) {
        const node = el('select', '', 'form-select');
        node.append(...options.map(([optionValue, text]) => new Option(text, optionValue)));
        node.value = value ?? '';
        return node;
    }
    const chip = (config, fallback) => el('span', config?.label || fallback, `chip ${config?.chip || 'chip-muted'}`);
    // Planned dates are calendar dates; show them without a time-zone shift.
    const dayText = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString() : '';
    const timeText = value => value ? new Date(value).toLocaleString() : '';
    const plural = (count, one, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

    async function fetchAll(table, columns, filter = query => query) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await filter(projectSupabaseClient.from(table).select(columns)).order('id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) return rows;
        }
    }

    let loads = [], places = [], view = 'open', current = null;

    // Places this project can use (shared ones and its own), for the origin, the stops and "found at".
    async function loadPlaces() {
        const { data, error } = await supabaseClient.from('places').select('id,name,kind,project_id,is_active,city,state').order('name');
        if (error) throw error;
        places = data.filter(place => !place.project_id || place.project_id === projectId);
    }
    const placeOptions = (keep, blank) => [...(blank ? [['', blank]] : []),
        ...places.filter(place => place.is_active !== false || place.id === keep).map(place => [place.id, `${place.name}${place.is_active === false ? ' (retired)' : ''}`])];

    // ---- Board ------------------------------------------------------------------------------
    async function loadBoard() {
        loads = await fetchAll('load_overview', '*');
        renderBoard();
    }

    function card(load) {
        const node = button('', 'load-card', () => openLoad(load.id));
        const top = el('span', '', 'load-card-top');
        top.append(el('strong', load.load_number, 'mono'), el('span', dayText(load.planned_date), 'small text-muted'));
        node.append(top);
        if (loadsApi.isFinished(load)) node.append(chip(loadsApi.LOAD_STATUS[load.status], load.status));
        const route = [load.origin_name && `From ${load.origin_name}`, load.next_stop && `Next: ${load.next_stop}`].filter(Boolean).join(' · ');
        if (route) node.append(el('span', route, 'small'));
        node.append(el('span', load.driver_name ? `Driver ${load.driver_name}` : 'No driver yet', `small${load.driver_name ? '' : ' text-muted'}`));
        const counts = loadsApi.cardCounts(load);
        node.append(el('span', counts.length ? counts.join(' · ') : 'Nothing planned', 'small text-muted'));
        const badges = el('span', '', 'load-card-badges');
        if (load.flagged_count) badges.append(el('span', `${plural(load.flagged_count, 'flag')}`, 'chip chip-warn'));
        if (load.started_in_field) badges.append(el('span', 'Started in the field', 'chip chip-info'));
        if (load.licence_override_at) badges.append(el('span', 'Left without licence', 'chip chip-warn'));
        // 022 clears licence_recorded_at when the licence is removed.
        if (load.licence_recorded_at) badges.append(el('span', 'Licence on file', 'chip chip-success'));
        if (badges.childNodes.length) node.append(badges);
        return node;
    }

    function renderBoard() {
        const groups = loadsApi.boardGroups(loads, { view });
        const board = $('loadBoard'); board.className = `load-board${view === 'finished' ? ' is-finished' : ''}`;
        board.replaceChildren(...groups.map(group => {
            const column = el('section', '', 'load-column'), heading = el('h2', `${group.label} (${group.loads.length.toLocaleString()})`);
            heading.id = `column-${group.status}`; column.setAttribute('aria-labelledby', heading.id);
            column.append(heading);
            if (!group.loads.length) column.append(el('p', 'No loads.', 'small text-muted mb-0'));
            else {
                const list = el('ul', '', 'load-cards');
                for (const load of group.loads) { const item = el('li'); item.append(card(load)); list.append(item); }
                column.append(list);
            }
            return column;
        }));
        const open = loads.filter(load => !loadsApi.isFinished(load)).length, fromField = loads.filter(loadsApi.startedInField).length;
        // Loads a crew started, for the office to check and plan; the switch shows office staff only, when there are some.
        const fieldSwitch = $('showField');
        fieldSwitch.textContent = `Started in the field (${fromField.toLocaleString()})`; fieldSwitch.hidden = !officeRole || (!fromField && view !== 'field');
        $('resultSummary').textContent = view === 'finished' ? plural(loads.length - open, 'closed or cancelled load')
            : view === 'field' ? plural(fromField, 'open load started in the field', 'open loads started in the field') : plural(open, 'open load');
    }

    // ---- Drawer -----------------------------------------------------------------------------
    const drawer = $('loadDrawer'), body = $('loadBody'), drawerStatus = $('loadStatus');
    const status = text => { drawerStatus.textContent = text; };
    const dirty = () => current && Object.values(current.dirty).some(Boolean);
    let closing = false;
    // Escape asks first. Chrome lets a page refuse Escape only once per user action, so a second Escape closes the
    // drawer regardless; the close handler then reopens it while a change is saving, or if the user keeps their edits.
    drawer.addEventListener('cancel', event => { if (event.cancelable) { event.preventDefault(); closeDrawer(); } });
    drawer.addEventListener('close', () => {
        if (!closing && (lock.busy || (dirty() && !confirm('Discard your unsaved changes to this load?')))) {
            drawer.showModal();
            if (lock.busy) status(STILL_SAVING);
            return;
        }
        closing = false; current = null; window.InvenioUnsavedChanges = false;
    });
    function closeDrawer() {
        if (lock.busy) { status(STILL_SAVING); return; }
        if (dirty() && !confirm('Discard your unsaved changes to this load?')) return;
        if (drawer.open) { closing = true; drawer.close(); }
    }
    const markDirty = section => () => { if (current) { current.dirty[section] = true; window.InvenioUnsavedChanges = true; } };

    async function loadDetail(state) {
        const id = state.id;
        const [companies, stops, lines, writeOffs, licence, photos, listed] = await Promise.all([
            fetchAll('load_companies', 'id,position,name,role,contact_name,phone', query => query.eq('load_id', id)),
            fetchAll('load_stop_overview', '*', query => query.eq('load_id', id)),
            fetchAll('load_line_overview', '*', query => query.eq('load_id', id)),
            fetchAll('load_write_offs', 'id,line_id,reason,written_off_at,undone_at', query => query.eq('load_id', id)),
            // Only office staff can read licences; nobody else asks.
            officeRole ? projectSupabaseClient.from('load_driver_licences').select('licence_number,licence_state,licence_expiry,recorded_at,removed_at').eq('load_id', id).maybeSingle() : { data: null },
            officeRole ? fetchAll('driver_licence_photos', 'id,storage_path,created_at', query => query.eq('load_id', id).is('removed_at', null)) : [],
            // What is in the load's folder, to find a photo that uploaded but was never attached.
            officeRole ? supabaseClient.storage.from('driver-licences').list(id, { limit: 100 }) : { data: [] },
        ]);
        if (licence.error) throw licence.error;
        // null when the folder couldn't be listed: nothing is then offered or flagged from it.
        const stored = listed.error ? null : (listed.data || []).filter(object => PHOTO_NAME.test(object.name)).map(object => `${id}/${object.name}`);
        Object.assign(state, { load: loads.find(load => load.id === id) || state.load, companies: companies.sort((a, b) => a.position - b.position),
            stops: stops.sort((a, b) => a.seq - b.seq), lines, writeOffs, licence: licence.data, photos, stored,
            unattached: (stored || []).filter(path => !photos.some(photo => photo.storage_path === path)) });
    }

    async function openLoad(id) {
        const state = { id, isNew: false, load: loads.find(load => load.id === id), dirty: {}, companyDraft: null, stopDraft: null, found: null, unattached: [], writeOffs: [] };
        if (!state.load) { message('That load is not in this project.'); return; }
        current = state;
        const heading = el('h2', state.load.load_number); heading.id = 'loadTitle';
        $('loadHeader').replaceChildren(heading);
        body.replaceChildren(el('p', 'Loading…', 'text-muted'));
        status('');
        if (!drawer.open) drawer.showModal();
        try { await loadDetail(state); }
        catch (error) { if (current === state) body.replaceChildren(el('p', `Could not load ${state.load.load_number}: ${loadsApi.errorMessage(error)}`, 'text-danger')); return; }
        if (current === state) renderDrawer({ focus: 'close' });
    }

    function openNew() {
        current = { id: crypto.randomUUID(), isNew: true, load: null, companies: [], stops: [], lines: [], writeOffs: [], licence: null, photos: [], stored: [], unattached: [],
            dirty: {}, companyDraft: null, stopDraft: null };
        status('');
        renderDrawer();
        if (!drawer.open) drawer.showModal();
        $('origin').focus();
    }

    /** Draws every section, except forms with unsaved edits, which keep what was typed. */
    function renderDrawer({ focus } = {}) {
        const state = current, load = state.load;
        const header = el('div', '', 'work-page-header'), titleWrap = el('div', '', 'd-flex flex-wrap gap-2 align-items-center');
        const title = el('h2', load ? load.load_number : 'New load', load ? 'mono mb-0' : 'mb-0'); title.id = 'loadTitle'; title.tabIndex = -1;
        titleWrap.append(title);
        if (load) titleWrap.append(chip(loadsApi.LOAD_STATUS[load.status], load.status));
        if (load?.started_in_field) titleWrap.append(el('span', 'Started in the field', 'chip chip-info'));
        const tools = el('div', '', 'd-flex flex-wrap gap-2');
        if (load) tools.append(button('Print manifest', 'btn btn-outline', printManifest));
        const close = button('Close', 'btn btn-outline-secondary', closeDrawer); close.dataset.focusKey = 'close';
        tools.append(close);
        header.append(titleWrap, tools);
        $('loadHeader').replaceChildren(header);
        // An edit kept across a redraw must still be possible: stops are edited before departure by whoever plans the
        // load, and after it only in the office's "Change stops" editor until no stop is left to reach; nothing changes
        // on a finished load. Lists nobody is editing are rebuilt from what was just read.
        const stopsOpen = load && (loadsApi.canPlan(load, roles) || (state.editStops && loadsApi.canEditStops(load, roles)));
        if (load && !stopsOpen) state.dirty.stops = state.editStops = false;
        if (load && !loadsApi.beforeDeparture(load)) state.depart = null;
        if (load && loadsApi.isFinished(load)) state.dirty.details = state.dirty.companies = false;
        if (!state.dirty.companies) state.companyDraft = null;
        if (!state.dirty.stops) state.stopDraft = null;
        window.InvenioUnsavedChanges = dirty();
        const sections = state.isNew ? ['details'] : ['actions', 'details', 'companies', 'stops', 'manifest', ...(officeRole ? ['licence'] : [])];
        const renderers = { actions: renderActions, details: renderDetails, companies: renderCompanies, stops: renderStops, manifest: renderManifest, licence: renderLicence };
        const kept = new Map([...body.childNodes].filter(node => node.dataset?.section).map(node => [node.dataset.section, node]));
        body.replaceChildren(...sections.map(name => {
            if (state.dirty[name] && kept.has(name)) return kept.get(name);
            const section = el('section', '', 'load-section'); section.dataset.section = name;
            renderers[name](section);
            return section;
        }));
        if (focus) (body.querySelector(`[data-focus-key="${focus}"]`) || $('loadHeader').querySelector(`[data-focus-key="${focus}"]`) || title).focus();
    }

    /** The open load and the board again, after any change. */
    async function refresh() {
        await loadBoard();
        // A new load is read in full once its first save has created it.
        if (current && loads.some(load => load.id === current.id)) await loadDetail(current);
    }

    /**
     * Runs one field operation with its own ID. The drawer's controls are disabled until it and the reload finish;
     * saved or refused, the load reloads, because a refusal often means the screen was out of date.
     */
    async function operate(action, payload, { done, failed, focus }) {
        if (lock.busy) { status(STILL_SAVING); return false; }
        body.disabled = true; status('Saving…');
        const state = current;
        let result = null;
        const outcome = await inv.writeThenReload(lock, [async () => {
            const { data, error } = await supabaseClient.rpc('apply_field_operation', { p_operation_id: crypto.randomUUID(), p_project_id: projectId, p_action: action, p_payload: payload });
            if (error) throw error;
            result = data;
        }], refresh);
        body.disabled = false;
        const text = outcome.error ? `${failed}: ${loadsApi.errorMessage(outcome.error)}` : done(result);
        const stale = outcome.reloadError ? ` The page could not refresh (${loadsApi.errorMessage(outcome.reloadError)}). Reload it.` : '';
        message(text + stale);
        if (current !== state) return !outcome.error;
        // A load is no longer new once the board has it; if the reload failed, saving again updates the same load.
        const saved = loads.find(load => load.id === state.id);
        if (saved) { state.load = saved; state.isNew = false; }
        renderDrawer({ focus });
        status(text + stale);
        return !outcome.error;
    }

    // ---- Status actions ---------------------------------------------------------------------
    function renderActions(section) {
        const load = current.load, number = load.load_number, actions = el('div', '', 'd-flex flex-wrap gap-2');
        section.append(el('h3', 'Status', 'h6'));
        const notes = [];
        // Counted from the manifest just read: the board row may be older, and confirmAll leaves pick-up pieces alone.
        const planned = current.lines.filter(line => line.status === 'planned' && !line.pickup_stop_id).length;
        const onBoard = current.lines.filter(line => line.status === 'on_board').length;
        const missing = current.lines.filter(line => line.status === 'missing').length;
        let licenceNote = null, departing = null;
        if (loadsApi.beforeDeparture(load)) {
            if (office && load.started_in_field) notes.push(`A crew started this load${load.created_at ? ` on ${new Date(load.created_at).toLocaleDateString()}` : ''}. Check its details, companies and stops, and plan the rest.`);
            if (!load.driver_name) notes.push("Add the driver's name before the truck leaves.");
            // 022 needs the licence number and a photo before the truck leaves, unless office staff let it leave without
            // them and say why. Only office staff can read the licence; for others the load says whether one is recorded.
            const ready = officeRole ? loadsApi.licenceReady(current.licence, current.photos) : Boolean(load.licence_recorded_at);
            if (!ready) {
                licenceNote = el('p', office ? "No licence yet: record the driver's licence number and add a photo of it below, or let the truck leave without it and say why."
                    : "No licence yet: the driver's licence number and a photo of it are needed before the truck can leave.", 'small mb-2');
                licenceNote.id = 'licenceNeeded';
            }
            const fromShop = loadsApi.unscannedPlace(load.origin_kind);
            if (office && !fromShop && planned) notes.push('Pieces are marked loaded without scanning only for a truck leaving an outside shop or vendor; elsewhere a crew scans them on.');
            // Office staff without the licence get a form asking why instead of the confirm box.
            const leave = (confirmAll, question) => () => {
                if (!ready && office) { current.depart = { confirmAll, reason: '' }; renderDrawer(); $('departReason')?.focus(); return; }
                if (!confirm(question)) return;
                void operate('load_depart', { loadId: load.id, ...(confirmAll ? { confirmAll: true } : {}) }, { failed: `Could not send ${number} on its way`, focus: 'actions',
                    done: result => departedText(number, result) });
            };
            if (current.depart && office) departing = departForm(load, { planned, onBoard });
            else {
                if (office && fromShop) {
                    const depart = button('Mark loaded and depart', 'btn btn-primary', leave(true,
                        `Mark the ${plural(planned, 'planned piece')} as loaded and send ${number} on its way? Use this for a truck leaving a place where nobody scans.`));
                    depart.dataset.focusKey = 'actions';
                    actions.append(depart);
                }
                if (working && onBoard) {
                    const left = planned ? ` ${plural(planned, 'planned piece')} that ${planned === 1 ? "wasn't" : "weren't"} scanned on will stay behind.` : '';
                    const depart = button("Depart with what's on board", 'btn btn-outline', leave(false, `Send ${number} on its way with the ${plural(onBoard, 'piece')} on board?${left}`));
                    // Field staff can't let it leave without the licence: the button says why it is off.
                    if (!ready && !office) { depart.disabled = true; depart.setAttribute('aria-describedby', 'licenceNeeded'); }
                    actions.append(depart);
                }
                if (office) {
                    actions.append(button('Cancel load', 'btn btn-outline-danger', () => {
                        if (!confirm(`Cancel ${number}? Crates already on the truck go back to how they were. This can't be undone.`)) return;
                        void operate('load_close', { loadId: load.id, cancel: true }, { failed: `Could not cancel ${number}`, done: () => `${number} is cancelled.` });
                    }));
                }
            }
        } else if (load.status === 'in_transit') {
            notes.push('On the road. Finish each stop below when the truck has been there.');
        } else if (load.status === 'delivered') {
            notes.push('Every stop is finished.');
            // 022 closes a load only once nothing on it is missing.
            if (office && !missing) {
                const close = button('Close load', 'btn btn-primary', () => {
                    if (!confirm(`Close ${number}? Nothing on it can change after that. Its driver's licence is removed 90 days later.`)) return;
                    void operate('load_close', { loadId: load.id }, { failed: `Could not close ${number}`, done: () => `${number} is closed.` });
                });
                close.dataset.focusKey = 'actions';
                actions.append(close);
            }
        } else notes.push(`${load.status === 'closed' ? 'Closed' : 'Cancelled'} ${timeText(load.closed_at)}.`);
        if (load.licence_override_at) notes.push(`Left without the driver's licence (${timeText(load.licence_override_at)}): ${load.licence_override_reason}`);
        if (missing) {
            notes.push(`${plural(missing, 'piece is', 'pieces are')} missing. ${office ? `Mark each one found or write it off in the manifest${load.status === 'delivered' ? ', then close the load' : ''}.`
                : 'The office marks them found or writes them off.'}`);
        }
        for (const note of notes) section.append(el('p', note, 'small mb-2'));
        if (licenceNote) section.append(licenceNote);
        if (departing) section.append(departing);
        if (actions.childNodes.length) section.append(actions);
    }

    const departedText = (number, result, without = false) => `${number} has left${without ? " without the driver's licence" : ''} with ${plural(result.on_board, 'piece')} on board${result.not_loaded ? `; ${plural(result.not_loaded, 'piece')} stayed behind` : ''}.`;

    /** An inline form asking why (022: 5 to 500 characters). What was typed survives a refusal and the redraw after it. */
    function reasonForm({ id, heading, intro, label, placeholder = '', submit, draft, cancel, send }) {
        const form = el('form', '', 'reason-form');
        form.noValidate = true;
        if (heading) form.append(el('h4', heading, 'h6'));
        if (intro) form.append(el('p', intro, 'small mb-2'));
        const reason = field(form, label, el('textarea', '', 'form-control'), id);
        Object.assign(reason, { rows: 2, maxLength: loadsApi.REASON_MAX, value: draft.reason || '', placeholder });
        reason.oninput = () => { draft.reason = reason.value; };
        const save = el('button', submit, 'btn btn-sm btn-primary'); save.type = 'submit';
        const buttons = el('div', '', 'd-flex flex-wrap gap-2');
        buttons.append(save, button('Cancel', 'btn btn-sm btn-ghost', cancel));
        form.append(buttons);
        form.onsubmit = event => {
            event.preventDefault();
            const result = loadsApi.reasonText(reason.value);
            if (result.error) { status(result.error); reason.focus(); return; }
            send(result.reason);
        };
        return form;
    }

    function departForm(load, { planned, onBoard }) {
        const state = current, draft = state.depart, number = load.load_number;
        const what = draft.confirmAll ? `the ${plural(planned, 'planned piece')} marked as loaded`
            : `the ${plural(onBoard, 'piece')} on board${planned ? `; ${plural(planned, 'planned piece')} not scanned on will stay behind` : ''}`;
        return reasonForm({ id: 'departReason', heading: 'Let it leave without the licence', label: 'Why it can leave without the licence', submit: 'Leave without the licence',
            intro: `${number} leaves with ${what}. The reason is kept on the load.`, placeholder: 'For example: the driver had no licence with them; the carrier confirmed by phone',
            draft, cancel: () => { state.depart = null; renderDrawer({ focus: 'actions' }); },
            send: reason => void operate('load_depart', { loadId: load.id, ...(draft.confirmAll ? { confirmAll: true } : {}), overrideReason: reason }, { focus: 'actions',
                failed: `Could not send ${number} on its way`, done: result => { state.depart = null; return departedText(number, result, true); } }) });
    }

    // ---- Details ----------------------------------------------------------------------------
    // A finished load, or one on a project that isn't active, is shown as text: disabled fields are hard to read.
    function factList(pairs) {
        const list = el('dl', '', 'record-fields');
        for (const [label, value] of pairs) { const pair = el('div'); pair.append(el('dt', label), el('dd', value || 'Not recorded', value ? '' : 'text-muted')); list.append(pair); }
        return list;
    }

    function renderDetails(section) {
        const load = current.load || {}, editable = working && !loadsApi.isFinished(load);
        section.append(el('h3', 'Details', 'h6'));
        if (!editable) {
            section.append(factList([['Origin', load.origin_name], ['Planned date', dayText(load.planned_date)], ...loadsApi.LOAD_TEXT.map(([, column, label]) => [label, load[column]])]));
            return;
        }
        const form = el('form'), grid = el('div', '', 'load-grid'), inputs = {};
        form.noValidate = true;
        inputs.originPlaceId = field(grid, 'Origin', select(placeOptions(load.origin_place_id, 'Not set'), load.origin_place_id), 'origin');
        const planned = field(grid, 'Planned date', el('input', '', 'form-control'), 'plannedDate');
        planned.type = 'date'; planned.value = load.planned_date || ''; inputs.plannedDate = planned;
        for (const [key, column, label, max] of loadsApi.LOAD_TEXT) {
            const control = key === 'notes' ? el('textarea', '', 'form-control') : el('input', '', 'form-control');
            if (key === 'notes') control.rows = 2; else { control.type = key === 'driverPhone' ? 'tel' : 'text'; control.autocomplete = 'off'; }
            control.maxLength = max; control.value = load[column] || '';
            inputs[key] = field(grid, label, control, key);
            if (key === 'notes') control.parentNode.className = 'mb-3 span-all';
        }
        form.append(grid);
        const save = el('button', current.isNew ? 'Create load' : 'Save details', 'btn btn-primary'); save.type = 'submit'; save.dataset.focusKey = 'details';
        form.append(save);
        form.oninput = markDirty('details');
        // load_save changes only the keys it is sent, so only what was changed here is sent: someone else's change to
        // another field stays, and an origin since retired doesn't block saving the rest.
        const shown = loadsApi.detailsPayload(Object.fromEntries(Object.entries(inputs).map(([key, control]) => [key, control.value]))).payload;
        form.onsubmit = event => {
            event.preventDefault();
            const result = loadsApi.detailsPayload(Object.fromEntries(Object.entries(inputs).map(([key, control]) => [key, control.value])));
            if (result.error) { status(result.error); inputs[result.field]?.focus(); return; }
            const state = current, creating = state.isNew;
            const changes = creating ? result.payload : loadsApi.changedKeys(result.payload, shown);
            if (!Object.keys(changes).length) { status('Nothing has changed.'); return; }
            void operate('load_save', { loadId: state.id, ...changes }, { focus: 'details',
                failed: creating ? 'Could not create the load' : `Could not save ${state.load.load_number}`,
                done: saved => { state.dirty.details = false; window.InvenioUnsavedChanges = dirty(); return creating ? `Created ${saved.load_number}.` : `Saved ${saved.load_number}'s details.`; } });
        };
        section.append(form);
    }

    // ---- Companies --------------------------------------------------------------------------
    function renderCompanies(section) {
        const load = current.load, editable = working && !loadsApi.isFinished(load);
        current.companyDraft ||= current.companies.map(company => ({ name: company.name, role: company.role, contactName: company.contact_name || '', phone: company.phone || '' }));
        const draft = current.companyDraft;
        section.append(el('h3', 'Companies', 'h6'));
        if (!editable) {
            if (!current.companies.length) { section.append(el('p', 'No companies.', 'small text-muted')); return; }
            const list = el('ol', '', 'mb-0');
            for (const company of current.companies) {
                list.append(el('li', [company.name, loadsApi.COMPANY_ROLES[company.role] || company.role, company.contact_name, company.phone].filter(Boolean).join(' · ')));
            }
            section.append(list);
            return;
        }
        section.append(el('p', 'Up to 3, in order from the one we hired to the one whose truck it is.', 'small text-muted'));
        const rows = el('ol', '', 'load-rows');
        const touched = markDirty('companies');
        const redraw = () => { section.replaceChildren(); renderCompanies(section); };
        draft.forEach((company, index) => {
            const row = el('li', '', 'load-row company-row');
            row.append(el('span', String(index + 1), 'load-row-number'));
            const name = field(row, 'Company', el('input', '', 'form-control'), `companyName${index}`); name.value = company.name; name.maxLength = 120;
            const role = field(row, 'Role', select(Object.entries(loadsApi.COMPANY_ROLES), company.role), `companyRole${index}`);
            const contact = field(row, 'Contact', el('input', '', 'form-control'), `companyContact${index}`); contact.value = company.contactName; contact.maxLength = 120;
            const phone = field(row, 'Phone', el('input', '', 'form-control'), `companyPhone${index}`); phone.type = 'tel'; phone.value = company.phone; phone.maxLength = 40;
            name.oninput = () => { company.name = name.value; touched(); };
            role.onchange = () => { company.role = role.value; touched(); };
            contact.oninput = () => { company.contactName = contact.value; touched(); };
            phone.oninput = () => { company.phone = phone.value; touched(); };
            row.append(rowTools(draft, index, `company ${index + 1}`, () => { touched(); redraw(); }));
            rows.append(row);
        });
        if (draft.length) section.append(rows); else section.append(el('p', 'No companies yet.', 'small text-muted'));
        const actions = el('div', '', 'd-flex flex-wrap gap-2');
        const add = button('Add company', 'btn btn-sm btn-outline', () => { draft.push({ name: '', role: 'carrier', contactName: '', phone: '' }); touched(); redraw(); $(`companyName${draft.length - 1}`)?.focus(); });
        add.disabled = draft.length >= loadsApi.MAX_COMPANIES;
        const save = button('Save companies', 'btn btn-sm btn-primary', () => {
            const result = loadsApi.companiesPayload(draft);
            if (result.error) { status(result.error); if (result.index !== undefined) $(`company${result.field === 'name' ? 'Name' : 'Role'}${result.index}`)?.focus(); return; }
            const state = current;
            void operate('load_save', { loadId: state.id, companies: result.companies }, { focus: 'companies', failed: `Could not save ${state.load.load_number}'s companies`,
                done: () => { state.dirty.companies = false; state.companyDraft = null; window.InvenioUnsavedChanges = dirty(); return `Saved ${state.load.load_number}'s companies.`; } });
        });
        save.dataset.focusKey = 'companies';
        actions.append(add, save);
        section.append(actions);
    }

    /** Up, down and remove buttons for a draft row; changes reorder the draft and redraw. Rows marked fixed don't move. */
    function rowTools(draft, index, name, changed) {
        const tools = el('div', '', 'load-row-tools');
        const move = delta => () => { draft.splice(0, draft.length, ...loadsApi.moveItem(draft, index, delta)); changed(); };
        const up = button('↑', 'btn btn-sm btn-outline', move(-1), `Move ${name} up`); up.disabled = index === 0 || Boolean(draft[index - 1].fixed);
        const down = button('↓', 'btn btn-sm btn-outline', move(1), `Move ${name} down`); down.disabled = index === draft.length - 1 || Boolean(draft[index + 1].fixed);
        tools.append(up, down, button('Remove', 'btn btn-sm btn-ghost', () => { draft.splice(index, 1); changed(); }, `Remove ${name}`));
        return tools;
    }

    // ---- Stops ------------------------------------------------------------------------------
    function renderStops(section) {
        const load = current.load;
        section.append(el('h3', 'Stops', 'h6'));
        if (loadsApi.canPlan(load, roles) || current.editStops) return renderStopEditor(section);
        if (loadsApi.beforeDeparture(load) && working) section.append(el('p', 'The office plans the stops of this load.', 'small text-muted'));
        if (!current.stops.length) section.append(el('p', 'No stops.', 'small text-muted'));
        else {
            const list = el('ol', '', 'stop-list');
            for (const stop of current.stops) {
                const item = el('li', '', 'stop-item'), head = el('div', '', 'd-flex flex-wrap gap-2 align-items-center');
                head.append(el('strong', `${stop.seq}. ${stop.place_name}`), el('span', loadsApi.STOP_KINDS[stop.kind], 'chip chip-muted'), chip(loadsApi.STOP_STATUS[stop.status], stop.status));
                if (stop.planned_date) head.append(el('span', dayText(stop.planned_date), 'small text-muted'));
                const counts = `Due ${stop.due_count} · Delivered ${stop.delivered_count} · Missing ${stop.missing_count}${stop.pickup_count ? ` · To pick up ${stop.pickup_count}` : ''}`;
                item.append(head, el('div', `${counts}${stop.arrived_at ? ` · Arrived ${timeText(stop.arrived_at)}` : ''}`, 'small text-muted'));
                if (load.status === 'in_transit' && stop.status !== 'done') item.append(stopActions(load, stop));
                list.append(item);
            }
            section.append(list);
        }
        // Office staff can still change the stops the truck hasn't reached.
        if (load.status === 'in_transit' && office) {
            const change = button('Change stops', 'btn btn-sm btn-outline mt-2', () => {
                current.editStops = true; renderDrawer();
                $(`stopPlace${current.stopDraft.findIndex(stop => !stop.fixed)}`)?.focus();
            });
            change.dataset.focusKey = 'stops';
            section.append(change);
        }
    }

    function stopActions(load, stop) {
        const actions = el('div', '', 'd-flex flex-wrap gap-2 mt-1'), where = `stop ${stop.seq} at ${stop.place_name}`;
        const due = stop.due_count, pickups = stop.pickup_count || 0, finishedAll = result => result.status === 'delivered' ? ` Every stop of ${load.load_number} is finished.` : '';
        // At an outside shop or vendor nobody scans: office staff confirm what came off and what was picked up, or
        // finish the stop.
        const atShop = loadsApi.unscannedPlace(stop.place_kind);
        if (office && atShop) {
            const label = { dropoff: 'Mark delivered', pickup: 'Confirm pick-ups', both: 'Mark delivered and picked up' }[stop.kind];
            const confirmed = button(label, 'btn btn-sm btn-primary', () => {
                const what = [stop.kind !== 'pickup' && `the ${plural(due, 'piece')} due at ${where} as delivered`,
                    stop.kind !== 'dropoff' && `the ${plural(pickups, 'piece')} to pick up ${stop.kind === 'pickup' ? `at ${where}` : 'there'} as on board`];
                if (!confirm(`Mark ${what.filter(Boolean).join(' and ')} without scanning them, and finish the stop?`)) return;
                void operate('stop_complete', { loadId: load.id, stopId: stop.id, confirmAll: true }, { focus: `stop-${stop.id}`, failed: `Could not finish ${where}`,
                    done: result => `Finished ${where}: ${[stop.kind !== 'pickup' && `${plural(result.stop_delivered, 'piece')} delivered`,
                        stop.kind !== 'dropoff' && `${plural(result.picked_up, 'piece')} picked up`].filter(Boolean).join(', ')}.${finishedAll(result)}` });
            }, `${label} at ${where}`);
            confirmed.dataset.focusKey = `stop-${stop.id}`;
            actions.append(confirmed);
        }
        if (atShop ? office : working) {
            actions.append(button('Finish stop', 'btn btn-sm btn-outline', () => {
                const warnings = [due && `Pieces due here that weren't scanned off (${plural(due, 'piece')} now) become missing.`,
                    pickups && `Pieces to pick up here that weren't scanned on (${plural(pickups, 'piece')}) stay behind.`].filter(Boolean);
                if (!confirm(`Finish ${where}?${warnings.length ? ` ${warnings.join(' ')}` : ''}`)) return;
                void operate('stop_complete', { loadId: load.id, stopId: stop.id }, { focus: 'actions', failed: `Could not finish ${where}`,
                    done: result => `Finished ${where}.${result.stop_missing ? ` ${plural(result.stop_missing, 'piece')} not scanned off ${result.stop_missing === 1 ? 'is' : 'are'} now missing.` : ''}${
                        result.not_picked_up ? ` ${plural(result.not_picked_up, 'piece')} to pick up stayed behind.` : ''}${finishedAll(result)}` });
            }, `Finish ${where}`));
        }
        return actions;
    }

    function renderStopEditor(section) {
        const load = current.load, leaving = load.status === 'in_transit';
        // A stop the truck has reached keeps its place and kind and stays on the load (022); it is shown, not edited.
        current.stopDraft ||= current.stops.map(stop => ({ id: stop.id, placeId: stop.place_id, kind: stop.kind, plannedDate: stop.planned_date || '', due: stop.due_count,
            fixed: loadsApi.stopReached(stop), placeName: stop.place_name, status: stop.status }));
        const draft = current.stopDraft, touched = markDirty('stops');
        const redraw = () => { section.replaceChildren(); renderStops(section); };
        section.append(el('p', leaving ? "The truck has left. Stops it has reached stay as they are; the others can change, move or come off the load."
            : 'Where the truck goes after it leaves, in order.', 'small text-muted'));
        const rows = el('ol', '', 'load-rows');
        draft.forEach((stop, index) => {
            const row = el('li', '', 'load-row stop-row');
            row.append(el('span', String(index + 1), 'load-row-number'));
            if (stop.fixed) {
                const fixed = el('div', '', 'span-all d-flex flex-wrap gap-2 align-items-center');
                fixed.append(el('strong', stop.placeName), el('span', loadsApi.STOP_KINDS[stop.kind], 'chip chip-muted'), chip(loadsApi.STOP_STATUS[stop.status], stop.status));
                row.append(fixed);
                rows.append(row);
                return;
            }
            const where = field(row, 'Place', select(placeOptions(stop.placeId, 'Choose a place'), stop.placeId), `stopPlace${index}`);
            const kind = field(row, 'Kind', select(Object.entries(loadsApi.STOP_KINDS), stop.kind), `stopKind${index}`);
            const date = field(row, 'Date', el('input', '', 'form-control'), `stopDate${index}`); date.type = 'date'; date.value = stop.plannedDate;
            where.onchange = () => { stop.placeId = where.value; touched(); };
            kind.onchange = () => { stop.kind = kind.value; touched(); };
            date.oninput = () => { stop.plannedDate = date.value; touched(); };
            row.append(rowTools(draft, index, `stop ${index + 1}`, () => { touched(); redraw(); }));
            if (stop.due) row.append(el('span', `${plural(stop.due, 'piece')} planned to come off here`, 'small text-muted span-all'));
            rows.append(row);
        });
        if (draft.length) section.append(rows); else section.append(el('p', 'No stops yet. Add the places the truck goes to.', 'small text-muted'));
        const actions = el('div', '', 'd-flex flex-wrap gap-2');
        const add = button('Add stop', 'btn btn-sm btn-outline', () => {
            draft.push({ id: crypto.randomUUID(), placeId: '', kind: 'dropoff', plannedDate: '', due: 0 }); touched(); redraw(); $(`stopPlace${draft.length - 1}`)?.focus();
        });
        add.disabled = draft.length >= loadsApi.MAX_STOPS;
        const save = button('Save stops', 'btn btn-sm btn-primary', () => {
            const result = loadsApi.stopsPayload(draft);
            if (result.error) { status(result.error); if (result.index !== undefined) $(`stop${{ placeId: 'Place', kind: 'Kind', plannedDate: 'Date' }[result.field]}${result.index}`)?.focus(); return; }
            const state = current, number = state.load.load_number;
            void operate('load_save', { loadId: state.id, stops: result.stops }, { focus: 'stops', failed: `Could not save ${number}'s stops`,
                done: saved => {
                    Object.assign(state, { editStops: false, stopDraft: null }); state.dirty.stops = false; window.InvenioUnsavedChanges = dirty();
                    return `Saved ${number}'s stops.${leaving && saved.status === 'delivered' ? ` No stops are left to reach, so ${number} is delivered.` : ''}`;
                } });
        });
        save.dataset.focusKey = 'stops';
        actions.append(add, save);
        if (leaving) {
            actions.append(button('Cancel', 'btn btn-sm btn-ghost', () => {
                if (current.dirty.stops && !confirm('Discard your changes to the stops?')) return;
                Object.assign(current, { editStops: false, stopDraft: null }); current.dirty.stops = false; window.InvenioUnsavedChanges = dirty();
                renderDrawer({ focus: 'stops' });
            }));
        }
        section.append(actions);
    }

    // ---- Manifest ---------------------------------------------------------------------------
    function renderManifest(section) {
        const load = current.load, planning = loadsApi.canPlan(load, roles);
        const counts = loadsApi.cardCounts(load);
        section.append(el('h3', 'Manifest', 'h6'), el('p', counts.length ? counts.join(' · ') : 'Nothing planned yet.', 'small text-muted'));
        if (planning) section.append(planForm(load));
        else if (working && loadsApi.beforeDeparture(load)) section.append(el('p', 'The office plans what goes on this load. Crews scan pieces on with the phone.', 'small text-muted'));
        for (const group of loadsApi.manifestByStop(current.stops, current.lines)) {
            if (!group.lines.length) continue;
            const stop = group.stop;
            section.append(el('h4', stop ? `Stop ${stop.seq} · ${stop.place_name} (${loadsApi.STOP_KINDS[stop.kind]})` : 'Other stops', 'h6 mt-3'));
            const table = el('table', '', 'table table-sm'), head = el('tr'), rows = el('tbody');
            for (const label of ['Tag', 'Piece', 'Status']) { const cell = el('th', label); cell.scope = 'col'; head.append(cell); }
            const actionsHead = el('th'); actionsHead.scope = 'col'; actionsHead.append(el('span', 'Actions', 'visually-hidden')); head.append(actionsHead);
            const thead = el('thead'); thead.append(head);
            for (const line of group.lines) rows.append(manifestRow(load, line, planning));
            table.append(thead, rows);
            const wrap = el('div', '', 'table-responsive'); wrap.append(table);
            section.append(wrap);
        }
    }

    function planForm(load) {
        const form = el('form', '', 'plan-form'), dropoffs = current.stops.filter(stop => stop.kind !== 'pickup'), pickups = current.stops.filter(stop => stop.kind !== 'dropoff');
        form.noValidate = true;
        if (!dropoffs.length) { form.append(el('p', 'Add and save a drop-off stop, then plan pieces for it.', 'small text-muted')); return form; }
        // What was typed survives a refusal and the redraw after it.
        const draft = current.plan ||= { code: '', stopId: '', pickupId: '', move: false };
        if (!dropoffs.some(item => item.id === draft.stopId)) draft.stopId = dropoffs[0].id;
        if (!pickups.some(item => item.id === draft.pickupId)) draft.pickupId = '';
        const row = el('div', '', 'load-grid');
        const code = field(row, 'Crate code or item tag', el('input', '', 'form-control'), 'planCode'); code.autocomplete = 'off'; code.maxLength = 120; code.value = draft.code;
        const stopName = item => `Stop ${item.seq} · ${item.place_name}`;
        const stop = field(row, 'Comes off at', select(dropoffs.map(item => [item.id, stopName(item)]), draft.stopId), 'planStop');
        code.oninput = () => { draft.code = code.value; };
        stop.onchange = () => { draft.stopId = stop.value; };
        // A piece can be collected on the way, at a pick-up stop before the one it comes off at.
        let pickup = null;
        if (pickups.length) {
            pickup = field(row, 'Picked up at', select([['', 'Where the truck starts'], ...pickups.map(item => [item.id, stopName(item)])], draft.pickupId), 'planPickup');
            pickup.onchange = () => { draft.pickupId = pickup.value; };
        }
        const add = el('button', 'Add to the plan', 'btn btn-primary'); add.type = 'submit'; add.dataset.focusKey = 'plan';
        const wrap = el('div', '', 'mb-3 d-flex align-items-end'); wrap.append(add); row.append(wrap);
        form.append(row);
        // 022 moves a piece planned on another load only when asked, and only while that load hasn't left.
        const moveWrap = el('div', '', 'form-check mb-2'), move = el('input', '', 'form-check-input');
        Object.assign(move, { type: 'checkbox', id: 'planMove', checked: draft.move });
        move.onchange = () => { draft.move = move.checked; };
        const moveLabel = el('label', "If it's planned on another load that hasn't left, move it here", 'form-check-label'); moveLabel.htmlFor = 'planMove';
        moveWrap.append(move, moveLabel);
        form.append(moveWrap);
        if (current.dirty.stops) form.append(el('p', 'Save the stops to plan pieces for new ones.', 'small text-muted'));
        form.onsubmit = event => {
            event.preventDefault();
            const value = code.value.trim();
            if (!value) { status('Enter a crate code (HU-…) or an item tag.'); code.focus(); return; }
            const piece = { code: value, dropoffStopId: stop.value, ...(pickup?.value ? { pickupStopId: pickup.value } : {}), ...(move.checked ? { move: true } : {}) };
            void operate('load_plan', { loadId: load.id, add: [piece] }, { focus: 'plan', failed: `Could not plan ${value}`,
                done: result => { draft.code = ''; const from = result?.moved?.[0]?.from; return `Planned ${value} on ${load.load_number}${from ? `, moved from ${from}` : ''}.`; } })
                .then(() => $('planCode')?.focus());
        };
        return form;
    }

    function manifestRow(load, line, planning) {
        const row = el('tr'), piece = el('td'), state = el('td'), actions = el('td');
        piece.append(el('div', line.name || ''), el('div', line.piece_kind === 'crate' ? 'Crate' : 'Item', 'small text-muted'));
        state.append(chip(loadsApi.LINE_STATUS[line.status], line.status));
        if (line.is_high_value) state.append(el('span', 'High value', 'chip chip-danger'));
        if (line.flag) state.append(el('span', loadsApi.LINE_FLAGS[line.flag] || line.flag, 'chip chip-warn'));
        if (line.status === 'delivered' && line.delivered_place && (line.flag || line.delivered_stop_id !== line.dropoff_stop_id)) state.append(el('div', `Came off at ${line.delivered_place}`, 'small text-muted'));
        if (line.note) state.append(el('div', line.note, 'small text-muted'));
        if (planning && line.status === 'planned') {
            actions.append(button('Remove', 'btn btn-sm btn-ghost', () => {
                void operate('load_plan', { loadId: load.id, remove: [line.tag] }, { focus: 'plan', failed: `Could not take ${line.tag} off the plan`, done: () => `Took ${line.tag} off the plan.` });
            }, `Remove ${line.tag} from the plan`));
        }
        if (office && line.status === 'missing') {
            if (current.found?.lineId === line.id) actions.append(foundForm(line));
            else if (current.writeOff?.lineId === line.id) actions.append(writeOffForm(line));
            else {
                const tools = el('div', '', 'd-flex flex-wrap gap-2');
                const found = button('Mark found', 'btn btn-sm btn-outline', () => { Object.assign(current, { found: { lineId: line.id, placeId: '', note: '' }, writeOff: null }); renderDrawer(); $('foundPlace')?.focus(); }, `Mark ${line.tag} found`);
                found.dataset.focusKey = `found-${line.id}`;
                tools.append(found, button('Write off', 'btn btn-sm btn-ghost', () => {
                    Object.assign(current, { writeOff: { lineId: line.id, reason: '' }, found: null }); renderDrawer(); $('writeOffReason')?.focus();
                }, `Write off ${line.tag}`));
                actions.append(tools);
            }
        }
        // An administrator can put a written-off piece back as missing (022 opens a closed load again for it).
        const writeOff = line.status === 'written_off' && current.writeOffs.find(row => row.line_id === line.id && !row.undone_at);
        if (admin && writeOff) {
            if (current.undo?.writeOffId === writeOff.id) actions.append(undoForm(line, writeOff));
            else {
                const undo = button('Undo write-off', 'btn btn-sm btn-ghost', () => { current.undo = { writeOffId: writeOff.id, reason: '' }; renderDrawer(); $('undoReason')?.focus(); }, `Undo the write-off of ${line.tag}`);
                undo.dataset.focusKey = `undo-${line.id}`;
                actions.append(undo);
            }
        }
        row.append(el('td', line.tag, 'mono'), piece, state, actions);
        return row;
    }

    function foundForm(line) {
        // What was chosen and typed survives a refusal and the redraw after it.
        const draft = current.found, form = el('form', '', 'found-form');
        form.noValidate = true;
        const where = field(form, 'Found at', select(placeOptions(null, 'Choose a place'), draft.placeId), 'foundPlace');
        const note = field(form, 'Note (optional)', el('input', '', 'form-control'), 'foundNote'); note.maxLength = 500; note.value = draft.note;
        where.onchange = () => { draft.placeId = where.value; };
        note.oninput = () => { draft.note = note.value; };
        const save = el('button', 'Save', 'btn btn-sm btn-primary'); save.type = 'submit';
        const actions = el('div', '', 'd-flex gap-2');
        actions.append(save, button('Cancel', 'btn btn-sm btn-ghost', () => { current.found = null; renderDrawer({ focus: `found-${line.id}` }); }));
        form.append(actions);
        form.onsubmit = event => {
            event.preventDefault();
            if (!where.value) { status(`Choose where ${line.tag} turned up.`); where.focus(); return; }
            const state = current;
            void operate('line_found', { lineId: line.id, placeId: where.value, note: note.value.trim() }, { focus: 'actions', failed: `Could not mark ${line.tag} found`,
                done: () => { state.found = null; return `${line.tag} is marked found at ${places.find(place => place.id === where.value)?.name}.`; } });
        };
        return form;
    }

    function writeOffForm(line) {
        const state = current;
        return reasonForm({ id: 'writeOffReason', label: `Why ${line.tag} is written off`, submit: 'Write off', draft: state.writeOff,
            intro: line.piece_kind === 'crate' ? 'This writes off the crate, every crate inside it and everything they hold. An administrator can undo it.' : 'An administrator can undo it.',
            cancel: () => { state.writeOff = null; renderDrawer({ focus: `found-${line.id}` }); },
            send: reason => void operate('line_write_off', { lineId: line.id, reason }, { focus: 'actions', failed: `Could not write off ${line.tag}`,
                done: result => {
                    state.writeOff = null;
                    const held = line.piece_kind === 'crate' ? ` (${plural(result.units, 'crate')} and ${plural(result.materials + result.items, 'item')})` : '';
                    return `Wrote off ${line.tag}${held}.`;
                } }) });
    }

    function undoForm(line, writeOff) {
        const state = current, number = state.load.load_number, reopens = state.load.status === 'closed';
        return reasonForm({ id: 'undoReason', label: `Why ${line.tag} is put back`, submit: 'Undo write-off', draft: state.undo,
            intro: `Written off: ${writeOff.reason}. ${line.tag} becomes missing again until it is scanned or marked found.${reopens ? ` ${number} opens again until then.` : ''}`,
            cancel: () => { state.undo = null; renderDrawer({ focus: `undo-${line.id}` }); },
            send: reason => void operate('line_write_off_undo', { writeOffId: writeOff.id, reason }, { focus: 'actions', failed: `Could not undo the write-off of ${line.tag}`,
                done: () => { state.undo = null; return `${line.tag} is missing again.${reopens ? ` ${number} is open again.` : ''}`; } }) });
    }

    // ---- Driver's licence (office only) -----------------------------------------------------
    function renderLicence(section) {
        const load = current.load, licence = current.licence, number = load.load_number;
        section.append(el('h3', "Driver's licence", 'h6'), el('p', "Office staff only and never printed. A daily job removes it 90 days after the load closes, or after the load's last change if it never closes. Office staff can remove it sooner.", 'small text-muted'));
        if (licence?.removed_at) section.append(el('p', `Removed ${timeText(licence.removed_at)}.`, 'small'));
        // Changing it needs an active project (022's calls do); reading doesn't. Once the load is past its 90 days a
        // licence can't be recorded again.
        if (office && !loadsApi.licencePastRetention(load)) {
            const form = el('form'), grid = el('div', '', 'load-grid');
            form.noValidate = true;
            const numberInput = field(grid, 'Licence number', el('input', '', 'form-control'), 'licenceNumber');
            Object.assign(numberInput, { autocomplete: 'off', spellcheck: false, maxLength: 40, value: licence?.licence_number || '' });
            const issuer = field(grid, 'Issuing state', el('input', '', 'form-control'), 'licenceState'); issuer.maxLength = 40; issuer.value = licence?.licence_state || '';
            const expiry = field(grid, 'Expiry date', el('input', '', 'form-control'), 'licenceExpiry'); expiry.type = 'date'; expiry.value = licence?.licence_expiry || '';
            form.append(grid);
            if (licence?.licence_number) form.append(el('p', `Recorded ${timeText(licence.recorded_at)}.`, 'small text-muted'));
            const save = el('button', 'Save licence', 'btn btn-primary'); save.type = 'submit'; save.dataset.focusKey = 'licence';
            form.append(save);
            form.oninput = markDirty('licence');
            form.onsubmit = event => {
                event.preventDefault();
                const result = loadsApi.licenceValues({ number: numberInput.value, state: issuer.value, expiry: expiry.value });
                if (result.error) { status(result.error); ({ number: numberInput, state: issuer, expiry })[result.field]?.focus(); return; }
                const state = current;
                void licenceWrite(async () => {
                    // The number goes only to record_driver_licence, which keeps it out of field_operations and the audit log.
                    const { data, error } = await supabaseClient.rpc('record_driver_licence', { p_operation_id: crypto.randomUUID(), p_load_id: load.id, p_licence: result.licence });
                    if (error) throw error;
                    return data;
                }, { failed: 'Could not save the licence', done: data => { state.dirty.licence = false; return `Saved the licence${data?.last4 ? ` ending ${data.last4}` : ''}.`; } });
            };
            section.append(form);
        } else if (licence?.licence_number) {
            section.append(factList([['Licence number', licence.licence_number], ['Issuing state', licence.licence_state], ['Expiry date', dayText(licence.licence_expiry)]]));
        } else if (!licence?.removed_at) section.append(el('p', 'No licence recorded.', 'small text-muted'));

        const photos = el('div', '', 'licence-photos');
        section.append(el('h4', 'Photos', 'h6 mt-3'), photos);
        if (!current.photos.length) photos.append(el('p', 'No photos yet.', 'small text-muted mb-0'));
        // Each photo is a figure; its caption carries the actions for that photo.
        current.photos.forEach((photo, index) => {
            const figure = el('figure', '', 'licence-photo'), image = el('img'), caption = el('figcaption', `Photo ${index + 1} · added ${timeText(photo.created_at)}`, 'small text-muted');
            image.alt = `Driver's licence photo ${index + 1}`;
            figure.append(image, caption);
            photos.append(figure);
            // A photo whose file is already gone (a delete that wasn't recorded) is finished off rather than shown.
            const gone = current.stored && !current.stored.includes(photo.storage_path);
            if (gone) image.replaceWith(el('p', 'The file has been deleted.', 'small text-muted mb-0'));
            else {
                // Short-lived links: a signed URL works for five minutes.
                void supabaseClient.storage.from('driver-licences').createSignedUrl(photo.storage_path, 300).then(({ data, error }) => {
                    if (error || !data?.signedUrl) image.replaceWith(el('p', 'This photo could not be shown.', 'small text-danger mb-0'));
                    else image.src = data.signedUrl;
                });
            }
            if (office) {
                caption.append(' ', button(gone ? 'Finish removing' : 'Delete photo', 'btn btn-sm btn-ghost', () => void deletePhoto(load, photo, index, gone),
                    `${gone ? 'Finish removing' : 'Delete'} photo ${index + 1}`));
            }
        });
        if (!office) return;
        // A photo in the load's folder that was never attached (an attach that failed, here or on a phone) is offered
        // for attaching.
        if (current.unattached.length) {
            section.append(el('p', `${plural(current.unattached.length, 'uploaded photo isn’t', 'uploaded photos aren’t')} attached to this load yet.`, 'small zone-warning mt-2'),
                button(current.unattached.length === 1 ? 'Attach the uploaded photo' : `Attach the ${current.unattached.length} uploaded photos`, 'btn btn-sm btn-outline',
                    () => void savePhoto(load, null, current.unattached)));
        }
        // Storage takes at most four files in a load's folder, attached or not.
        const inFolder = current.stored ? current.stored.length : current.photos.length;
        if (inFolder < loadsApi.MAX_LICENCE_PHOTOS && current.photos.length < loadsApi.MAX_LICENCE_PHOTOS) {
            const label = el('label', 'Add a photo (JPEG or PNG, up to 10 MB)', 'form-label mt-2'); label.htmlFor = 'licencePhoto';
            const input = el('input', '', 'form-control'); Object.assign(input, { id: 'licencePhoto', type: 'file', accept: 'image/jpeg,image/png' });
            input.onchange = () => { const file = input.files?.[0]; input.value = ''; if (file) void savePhoto(load, file, []); };
            section.append(label, input);
        } else section.append(el('p', `A load keeps at most ${loadsApi.MAX_LICENCE_PHOTOS} photos.`, 'small text-muted mt-2'));
        // Office staff can remove a wrong licence at any time; before it is due, 022 asks why.
        const onFile = licence?.licence_number || current.photos.length || current.unattached.length;
        if (!onFile) return;
        if (current.removeLicence) {
            const state = current;
            section.append(reasonForm({ id: 'removeLicenceReason', heading: 'Remove the licence', label: 'Why it is removed now', submit: 'Remove the licence', draft: state.removeLicence,
                intro: "This deletes the licence number and every photo of it. It can't be recovered.",
                cancel: () => { state.removeLicence = null; renderDrawer({ focus: 'removeLicence' }); },
                send: reason => void licenceWrite(async () => {
                    // remove_driver_licence refuses while any file is left in the load's folder, so all of them go first.
                    const listed = await supabaseClient.storage.from('driver-licences').list(load.id, { limit: 100 });
                    if (listed.error) throw listed.error;
                    const paths = (listed.data || []).map(object => `${load.id}/${object.name}`);
                    if (paths.length) {
                        const { error } = await supabaseClient.storage.from('driver-licences').remove(paths);
                        if (error) throw error;
                    }
                    const { error } = await supabaseClient.rpc('remove_driver_licence', { p_load_id: load.id, p_reason: reason });
                    if (error) throw error;
                }, { failed: "Could not remove the driver's licence", done: () => { state.removeLicence = null; state.dirty.licence = false; return `Removed ${number}'s driver's licence.`; } }) }));
        } else {
            const remove = button('Remove the licence', 'btn btn-sm btn-outline-danger mt-3', () => { current.removeLicence = { reason: '' }; renderDrawer(); $('removeLicenceReason')?.focus(); });
            remove.dataset.focusKey = 'removeLicence';
            section.append(remove);
        }
    }

    /** One licence change under the save lock, then the load again; like operate, for the licence's own functions. */
    async function licenceWrite(write, { done, failed, focus = 'licence' }) {
        if (lock.busy) { status(STILL_SAVING); return false; }
        body.disabled = true; status('Saving…');
        const state = current;
        let result = null;
        const outcome = await inv.writeThenReload(lock, [async () => { result = await write(); }], refresh);
        body.disabled = false;
        const text = (outcome.error ? `${failed}: ${loadsApi.errorMessage(outcome.error)}` : done(result))
            + (outcome.reloadError ? ` The page could not refresh (${loadsApi.errorMessage(outcome.reloadError)}). Reload it.` : '');
        if (current === state) { renderDrawer({ focus }); status(text); } else message(text);
        return !outcome.error;
    }

    /** Deletes a wrong photo: the file through Storage, then 022's record of it. A file already gone is only recorded. */
    function deletePhoto(load, photo, index, gone) {
        const last = current.photos.length === 1 && loadsApi.beforeDeparture(load);
        if (!gone && !confirm(`Delete photo ${index + 1}? It can't be recovered.${last ? " The truck can't leave until a new photo is added, unless the office lets it leave without the licence." : ''}`)) return;
        return licenceWrite(async () => {
            if (!gone) {
                const { error } = await supabaseClient.storage.from('driver-licences').remove([photo.storage_path]);
                if (error) throw error;
            }
            const { error } = await supabaseClient.rpc('remove_driver_licence_photo', { p_path: photo.storage_path });
            if (error) throw error;
        }, { failed: `Could not delete photo ${index + 1}`, done: () => `Deleted photo ${index + 1}.` });
    }

    /**
     * Uploads a new photo without overwriting, then attaches it (and any earlier uploads still unattached), all under
     * the save lock, so nothing else runs in between and the drawer can't close or switch loads part-way.
     */
    async function savePhoto(load, file, earlier) {
        const target = file ? loadsApi.licencePhotoPath(load.id, file, crypto.randomUUID()) : { path: null };
        if (target.error) { status(target.error); return; }
        if (lock.busy) { status(STILL_SAVING); return; }
        body.disabled = true; status(file ? 'Uploading the photo…' : 'Attaching…');
        const state = current;
        let uploaded = !file;
        const outcome = await inv.writeThenReload(lock, [async () => {
            if (file) {
                const { error } = await supabaseClient.storage.from('driver-licences').upload(target.path, file, { contentType: file.type, upsert: false });
                // "Already exists" means an earlier try of this same upload landed.
                if (error && !/already exists/i.test(error.message || '')) throw error;
                uploaded = true;
            }
            for (const path of [...earlier, ...(target.path ? [target.path] : [])]) {
                const { error } = await supabaseClient.rpc('attach_driver_licence_photo', { p_load_id: load.id, p_path: path });
                if (error) throw error;
            }
        }], refresh);
        body.disabled = false;
        const text = !outcome.error ? (file ? 'Added the photo.' : 'Attached the uploaded photos.')
            : uploaded ? `The photo was uploaded but could not be attached: ${loadsApi.errorMessage(outcome.error)}. Attach it again from this section.`
            : `Could not upload the photo: ${loadsApi.errorMessage(outcome.error)}`;
        if (current === state) { renderDrawer(); status(text); } else message(text);
    }

    // ---- Printable manifest -----------------------------------------------------------------
    const PRINT_CSS = `@page { size: letter; margin: 0.6in; }
* { box-sizing: border-box; }
body { margin: 0; font: 11pt/1.4 Arial, Helvetica, sans-serif; color: #000; background: #fff; }
.controls { display: flex; gap: 12px; align-items: center; padding: 12px 0; font-size: 14px; }
h1 { font-size: 20pt; margin: 0 0 4px; }
h2 { font-size: 13pt; margin: 18px 0 6px; border-bottom: 2px solid #000; padding-bottom: 2px; }
.facts { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 2px 12px; margin: 8px 0; }
.facts dt { font-weight: 700; }
.facts dd { margin: 0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #999; vertical-align: top; }
.tag { font-family: "Courier New", monospace; font-weight: 700; }
.box { width: 14px; height: 14px; border: 1px solid #000; display: inline-block; }
.signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 36px; break-inside: avoid; }
.signature div { border-bottom: 1px solid #000; height: 28px; margin-bottom: 4px; }
.small { font-size: 9pt; color: #333; }
section { break-inside: avoid-page; }
@media print { .controls { display: none; } }`;

    /** A manifest and packing list per stop, from what the drawer shows. It is never given the licence. */
    function printManifest() {
        const state = current;
        if (!state?.load) return;
        if (lock.busy) { status(STILL_SAVING); return; }
        const printWindow = window.open('', '_blank');
        if (!printWindow) { status('Allow pop-ups for this site, then choose Print manifest again.'); return; }
        printWindow.opener = null;
        try { writeManifest(printWindow, { load: state.load, companies: state.companies, stops: state.stops, lines: state.lines }); }
        catch (error) { printWindow.close(); status(`The manifest could not be drawn (${loadsApi.errorMessage(error)}).`); return; }
        status(`Opened ${state.load.load_number}'s manifest to print.`);
    }

    function writeManifest(printWindow, { load, companies, stops, lines }) {
        const doc = printWindow.document, project = InvenioProjectScope.activeProject.name;
        const make = (tag, text = '', className = '') => { const node = doc.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
        doc.title = `Manifest ${load.load_number} — ${project}`;
        const style = doc.createElement('style'); style.textContent = PRINT_CSS;
        doc.head.append(style);
        const controls = make('div', '', 'controls'), print = make('button', 'Print');
        print.type = 'button'; print.onclick = () => printWindow.print();
        controls.append(print, make('span', `${load.load_number} for ${project}`));
        const facts = make('dl', '', 'facts');
        const fact = (label, value) => { if (value) facts.append(make('dt', label), make('dd', value)); };
        fact('Planned', dayText(load.planned_date)); fact('Origin', load.origin_name);
        fact('Driver', [load.driver_name, load.driver_phone].filter(Boolean).join(' · ')); fact('Truck', [load.truck_type, load.truck_number].filter(Boolean).join(' '));
        fact('Trailer', load.trailer_number); fact('Bill of lading', load.bol_number);
        const companyList = make('ol');
        for (const company of companies) {
            companyList.append(make('li', [company.name, loadsApi.COMPANY_ROLES[company.role] || company.role, company.contact_name, company.phone].filter(Boolean).join(' · ')));
        }
        const parts = [controls, make('h1', `Manifest ${load.load_number}`), make('p', project, 'small'), facts];
        if (companies.length) parts.push(make('h2', 'Companies'), companyList);
        for (const group of loadsApi.manifestByStop(stops, lines.filter(loadsApi.printable))) {
            if (!group.lines.length) continue;
            const section = make('section'), stop = group.stop;
            section.append(make('h2', stop ? `Stop ${stop.seq}: ${[stop.place_name, [stop.city, stop.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ')}` : 'Other stops'));
            if (stop) section.append(make('p', [loadsApi.STOP_KINDS[stop.kind], dayText(stop.planned_date)].filter(Boolean).join(' · '), 'small'));
            const table = make('table'), head = make('tr'), rows = make('tbody');
            for (const label of ['Tag', 'Piece', 'High value', 'Checked']) head.append(make('th', label));
            const thead = make('thead'); thead.append(head);
            for (const line of group.lines) {
                const row = make('tr'), check = make('td');
                check.append(make('span', '', 'box'));
                row.append(make('td', line.tag, 'tag'), make('td', line.name || ''), make('td', line.is_high_value ? 'HIGH VALUE' : ''), check);
                rows.append(row);
            }
            table.append(thead, rows);
            section.append(table, make('p', `${group.lines.length} ${group.lines.length === 1 ? 'piece' : 'pieces'}`, 'small'));
            parts.push(section);
        }
        const signatures = make('div', '', 'signatures');
        for (const who of ['Shipper', 'Driver', 'Receiver']) {
            const block = make('div', '', 'signature');
            block.append(make('div'), make('span', `${who}: name, signature and date`, 'small'));
            signatures.append(block);
        }
        parts.push(signatures, make('p', `Printed ${new Date().toLocaleString()}`, 'small'));
        doc.body.replaceChildren(...parts);
        printWindow.focus();
        printWindow.print();
    }

    // ---- Licence housekeeping ---------------------------------------------------------------
    // A daily job removes licences once their 90 days are up. This is its backup: when office staff open Loads, any
    // licence on their projects that is due is removed here too, every file in its folder first, then the record. It
    // runs in the background and never blocks the board.
    async function removeOldLicences() {
        const note = $('housekeeping');
        const { data, error } = await supabaseClient.rpc('driver_licences_due_for_removal');
        if (error) { note.hidden = false; note.textContent = `Old driver's licences could not be checked (${loadsApi.errorMessage(error)}).`; return; }
        let removed = 0;
        const failed = [];
        for (const row of data || []) {
            try {
                // 022 lists every file in the load's folder, attached or not; remove_driver_licence refuses while any is left.
                if (row.storage_paths?.length) {
                    const { error: storageError } = await supabaseClient.storage.from('driver-licences').remove(row.storage_paths);
                    if (storageError) throw storageError;
                }
                const { error: removeError } = await supabaseClient.rpc('remove_driver_licence', { p_load_id: row.load_id });
                if (removeError) throw removeError;
                removed++;
            } catch (failure) {
                // The list covers every project this user can see; say when a load isn't in the open one.
                const name = loads.some(load => load.id === row.load_id) ? row.load_number : `${row.load_number} in another project`;
                failed.push(`${name} (${loadsApi.errorMessage(failure)})`);
            }
        }
        const parts = [];
        if (removed) parts.push(`Removed the driver's licence of ${plural(removed, 'load')} whose 90 days were up.`);
        if (failed.length) parts.push(`Could not remove the driver's licence of ${failed.join(', ')}.`);
        note.hidden = !parts.length;
        note.textContent = parts.join(' ');
        // Removal clears the load's "licence on file"; if the board can't be read again it keeps what it showed.
        if (removed) await loadBoard().catch(() => {});
    }

    // ---- Wiring -----------------------------------------------------------------------------
    const VIEWS = { showOpen: 'open', showFinished: 'finished', showField: 'field' };
    for (const [id, name] of Object.entries(VIEWS)) {
        $(id).onclick = () => {
            view = name;
            for (const [other, otherName] of Object.entries(VIEWS)) $(other).setAttribute('aria-pressed', String(otherName === view));
            renderBoard();
        };
    }
    $('newLoad').hidden = !working;
    $('newLoad').onclick = openNew;
    try { await Promise.all([loadBoard(), loadPlaces()]); }
    catch (error) { message(`Could not load loads: ${loadsApi.errorMessage(error)}`); return; }
    if (officeRole) void removeOldLicences();
    // Outside Shops links to a load with ?load=<id>.
    const linked = new URLSearchParams(location.search).get('load');
    if (linked) void openLoad(linked);
})();

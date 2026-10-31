(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const loadsApi = InvenioLoads, inv = InvenioInventory;
    const projectId = InvenioProjectScope.getActiveProjectId();
    const profile = InvenioCurrentProfile;
    // 022: anyone working an active project can plan loads and finish stops; confirming without scanning, closing,
    // cancelling, marking found and the driver's licence are for office staff.
    const working = InvenioProjectScope.activeProject.status === 'active';
    const office = ['office_staff', 'admin'].includes(profile.role) && working;
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

    let loads = [], places = [], finished = false, current = null;

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
        const top = el('div', '', 'load-card-top');
        top.append(el('strong', load.load_number, 'mono'), el('span', dayText(load.planned_date), 'small text-muted'));
        node.append(top);
        if (loadsApi.isFinished(load)) node.append(chip(loadsApi.LOAD_STATUS[load.status], load.status));
        const route = [load.origin_name && `From ${load.origin_name}`, load.next_stop && `Next: ${load.next_stop}`].filter(Boolean).join(' · ');
        if (route) node.append(el('div', route, 'small'));
        node.append(el('div', load.driver_name ? `Driver ${load.driver_name}` : 'No driver yet', `small${load.driver_name ? '' : ' text-muted'}`));
        const counts = loadsApi.cardCounts(load);
        node.append(el('div', counts.length ? counts.join(' · ') : 'Nothing planned', 'small text-muted'));
        const badges = el('div', '', 'load-card-badges');
        if (load.flagged_count) badges.append(el('span', `${plural(load.flagged_count, 'flag')}`, 'chip chip-warn'));
        if (load.licence_recorded_at) badges.append(el('span', 'Licence on file', 'chip chip-success'));
        if (badges.childNodes.length) node.append(badges);
        return node;
    }

    function renderBoard() {
        const groups = loadsApi.boardGroups(loads, { finished });
        const board = $('loadBoard'); board.className = `load-board${finished ? ' is-finished' : ''}`;
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
        const open = loads.filter(load => !loadsApi.isFinished(load)).length;
        $('resultSummary').textContent = finished ? plural(loads.length - open, 'closed or cancelled load') : plural(open, 'open load');
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
        const [companies, stops, lines, licence, photos] = await Promise.all([
            fetchAll('load_companies', 'id,position,name,role,contact_name,phone', query => query.eq('load_id', id)),
            fetchAll('load_stop_overview', '*', query => query.eq('load_id', id)),
            fetchAll('load_line_overview', '*', query => query.eq('load_id', id)),
            // Only office staff can read licences; nobody else asks.
            office ? projectSupabaseClient.from('load_driver_licences').select('licence_number,licence_state,licence_expiry,recorded_at,removed_at').eq('load_id', id).maybeSingle() : { data: null },
            office ? fetchAll('driver_licence_photos', 'id,storage_path,created_at', query => query.eq('load_id', id).is('removed_at', null)) : [],
        ]);
        if (licence.error) throw licence.error;
        Object.assign(state, { load: loads.find(load => load.id === id) || state.load, companies: companies.sort((a, b) => a.position - b.position),
            stops: stops.sort((a, b) => a.seq - b.seq), lines, licence: licence.data, photos });
    }

    async function openLoad(id) {
        const state = { id, isNew: false, load: loads.find(load => load.id === id), dirty: {}, companyDraft: null, stopDraft: null, finding: null, pendingPhoto: null };
        if (!state.load) { message('That load is not in this project.'); return; }
        current = state;
        $('loadHeader').replaceChildren(el('h2', state.load.load_number));
        body.replaceChildren(el('p', 'Loading…', 'text-muted'));
        status('');
        if (!drawer.open) drawer.showModal();
        try { await loadDetail(state); }
        catch (error) { if (current === state) body.replaceChildren(el('p', `Could not load ${state.load.load_number}: ${loadsApi.errorMessage(error)}`, 'text-danger')); return; }
        if (current === state) renderDrawer();
    }

    function openNew() {
        current = { id: crypto.randomUUID(), isNew: true, load: null, companies: [], stops: [], lines: [], licence: null, photos: [], dirty: {}, companyDraft: null, stopDraft: null };
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
        const tools = el('div', '', 'd-flex flex-wrap gap-2');
        if (load) tools.append(button('Print manifest', 'btn btn-outline', printManifest));
        const close = button('Close', 'btn btn-outline-secondary', closeDrawer); close.dataset.focusKey = 'close';
        tools.append(close);
        header.append(titleWrap, tools);
        $('loadHeader').replaceChildren(header);
        const sections = state.isNew ? ['details'] : ['actions', 'details', 'companies', 'stops', 'manifest', ...(office ? ['licence'] : [])];
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
        if (!outcome.error && state.isNew) state.isNew = false;
        if (!outcome.error) state.load = loads.find(load => load.id === state.id) || state.load;
        if (state.load) renderDrawer({ focus });
        status(text + stale);
        return !outcome.error;
    }

    // ---- Status actions ---------------------------------------------------------------------
    function renderActions(section) {
        const load = current.load, number = load.load_number, actions = el('div', '', 'd-flex flex-wrap gap-2');
        section.append(el('h3', 'Status', 'h6'));
        const notes = [];
        if (loadsApi.beforeDeparture(load)) {
            if (!load.driver_name) notes.push("Add the driver's name before the truck leaves.");
            if (office) {
                const depart = button('Mark loaded and depart', 'btn btn-primary', () => {
                    if (!confirm(`Mark the ${plural(load.planned_count, 'planned piece')} as loaded and send ${number} on its way? Use this for a truck leaving a place where nobody scans.`)) return;
                    void operate('load_depart', { loadId: load.id, confirmAll: true }, { failed: `Could not send ${number} on its way`, focus: 'actions',
                        done: result => `${number} has left with ${plural(result.on_board, 'piece')} on board.` });
                });
                depart.dataset.focusKey = 'actions';
                actions.append(depart);
            }
            if (working && load.on_board_count) {
                actions.append(button("Depart with what's on board", 'btn btn-outline', () => {
                    const left = load.planned_count ? ` ${plural(load.planned_count, 'planned piece')} that ${load.planned_count === 1 ? "wasn't" : "weren't"} scanned on will stay behind.` : '';
                    if (!confirm(`Send ${number} on its way with the ${plural(load.on_board_count, 'piece')} on board?${left}`)) return;
                    void operate('load_depart', { loadId: load.id }, { failed: `Could not send ${number} on its way`, focus: 'actions',
                        done: result => `${number} has left with ${plural(result.on_board, 'piece')} on board${result.not_loaded ? `; ${plural(result.not_loaded, 'piece')} stayed behind` : ''}.` });
                }));
            }
            if (office) {
                actions.append(button('Cancel load', 'btn btn-outline-danger', () => {
                    if (!confirm(`Cancel ${number}? Crates already on the truck go back to how they were. This can't be undone.`)) return;
                    void operate('load_close', { loadId: load.id, cancel: true }, { failed: `Could not cancel ${number}`, done: () => `${number} is cancelled.` });
                }));
            }
        } else if (load.status === 'in_transit') {
            notes.push('On the road. Finish each stop below when the truck has been there.');
        } else if (load.status === 'delivered') {
            notes.push('Every stop is finished.');
            if (office) {
                const close = button('Close load', 'btn btn-primary', () => {
                    if (!confirm(`Close ${number}? Nothing on it can change after that, and its driver's licence is removed 90 days later.`)) return;
                    void operate('load_close', { loadId: load.id }, { failed: `Could not close ${number}`, done: () => `${number} is closed.` });
                });
                close.dataset.focusKey = 'actions';
                actions.append(close);
            }
        } else notes.push(`${load.status === 'closed' ? 'Closed' : 'Cancelled'} ${timeText(load.closed_at)}.`);
        if (load.missing_count) notes.push(`${plural(load.missing_count, 'piece is', 'pieces are')} missing. ${office ? 'Mark each one found in the manifest when it turns up.' : 'The office marks them found when they turn up.'}`);
        for (const note of notes) section.append(el('p', note, 'small mb-2'));
        if (actions.childNodes.length) section.append(actions);
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
        form.onsubmit = event => {
            event.preventDefault();
            const result = loadsApi.detailsPayload(Object.fromEntries(Object.entries(inputs).map(([key, control]) => [key, control.value])));
            if (result.error) { status(result.error); inputs[result.field]?.focus(); return; }
            const state = current, creating = state.isNew;
            void operate('load_save', { loadId: state.id, ...result.payload }, { focus: 'details',
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

    /** Up, down and remove buttons for a draft row; changes reorder the draft and redraw. */
    function rowTools(draft, index, name, changed) {
        const tools = el('div', '', 'load-row-tools');
        const move = delta => () => { draft.splice(0, draft.length, ...loadsApi.moveItem(draft, index, delta)); changed(); };
        const up = button('↑', 'btn btn-sm btn-outline', move(-1), `Move ${name} up`); up.disabled = index === 0;
        const down = button('↓', 'btn btn-sm btn-outline', move(1), `Move ${name} down`); down.disabled = index === draft.length - 1;
        tools.append(up, down, button('Remove', 'btn btn-sm btn-ghost', () => { draft.splice(index, 1); changed(); }, `Remove ${name}`));
        return tools;
    }

    // ---- Stops ------------------------------------------------------------------------------
    function renderStops(section) {
        const load = current.load;
        section.append(el('h3', 'Stops', 'h6'));
        if (working && loadsApi.beforeDeparture(load)) return renderStopEditor(section);
        if (!current.stops.length) { section.append(el('p', 'No stops.', 'small text-muted')); return; }
        if (loadsApi.beforeDeparture(load)) section.append(el('p', 'Stops can change only until the truck leaves.', 'small text-muted'));
        const list = el('ol', '', 'stop-list');
        for (const stop of current.stops) {
            const item = el('li', '', 'stop-item'), head = el('div', '', 'd-flex flex-wrap gap-2 align-items-center');
            head.append(el('strong', `${stop.seq}. ${stop.place_name}`), el('span', loadsApi.STOP_KINDS[stop.kind], 'chip chip-muted'), chip(loadsApi.STOP_STATUS[stop.status], stop.status));
            if (stop.planned_date) head.append(el('span', dayText(stop.planned_date), 'small text-muted'));
            item.append(head, el('div', `Due ${stop.due_count} · Delivered ${stop.delivered_count} · Missing ${stop.missing_count}${stop.arrived_at ? ` · Arrived ${timeText(stop.arrived_at)}` : ''}`, 'small text-muted'));
            if (load.status === 'in_transit' && stop.status !== 'done') item.append(stopActions(load, stop));
            list.append(item);
        }
        section.append(list);
    }

    function stopActions(load, stop) {
        const actions = el('div', '', 'd-flex flex-wrap gap-2 mt-1'), where = `stop ${stop.seq} at ${stop.place_name}`;
        if (office && stop.kind !== 'pickup') {
            const deliver = button('Mark delivered', 'btn btn-sm btn-primary', () => {
                if (!confirm(`Mark the ${plural(stop.due_count, 'piece')} due at ${where} as delivered without scanning them?`)) return;
                void operate('stop_complete', { loadId: load.id, stopId: stop.id, confirmAll: true }, { focus: `stop-${stop.id}`, failed: `Could not finish ${where}`,
                    done: result => `Finished ${where}: ${plural(result.stop_delivered, 'piece')} delivered.${result.status === 'delivered' ? ` Every stop of ${load.load_number} is finished.` : ''}` });
            }, `Mark delivered at ${where}`);
            deliver.dataset.focusKey = `stop-${stop.id}`;
            actions.append(deliver);
        }
        if (working) {
            actions.append(button('Finish stop', 'btn btn-sm btn-outline', () => {
                const warning = stop.due_count ? ` Pieces due here that weren't scanned off (${plural(stop.due_count, 'piece')} now) become missing.` : '';
                if (!confirm(`Finish ${where}?${warning}`)) return;
                void operate('stop_complete', { loadId: load.id, stopId: stop.id }, { focus: 'actions', failed: `Could not finish ${where}`,
                    done: result => `Finished ${where}.${result.stop_missing ? ` ${plural(result.stop_missing, 'piece')} not scanned off ${result.stop_missing === 1 ? 'is' : 'are'} now missing.` : ''}${result.status === 'delivered' ? ` Every stop of ${load.load_number} is finished.` : ''}` });
            }, `Finish ${where}`));
        }
        return actions;
    }

    function renderStopEditor(section) {
        current.stopDraft ||= current.stops.map(stop => ({ id: stop.id, placeId: stop.place_id, kind: stop.kind, plannedDate: stop.planned_date || '', due: stop.due_count }));
        const draft = current.stopDraft, touched = markDirty('stops');
        const redraw = () => { section.replaceChildren(); renderStops(section); };
        section.append(el('p', 'Where the truck goes after it leaves, in order. Stops can change until it leaves.', 'small text-muted'));
        const rows = el('ol', '', 'load-rows');
        draft.forEach((stop, index) => {
            const row = el('li', '', 'load-row stop-row');
            row.append(el('span', String(index + 1), 'load-row-number'));
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
            const state = current;
            void operate('load_save', { loadId: state.id, stops: result.stops }, { focus: 'stops', failed: `Could not save ${state.load.load_number}'s stops`,
                done: () => { state.dirty.stops = false; state.stopDraft = null; window.InvenioUnsavedChanges = dirty(); return `Saved ${state.load.load_number}'s stops.`; } });
        });
        save.dataset.focusKey = 'stops';
        actions.append(add, save);
        section.append(actions);
    }

    // ---- Manifest ---------------------------------------------------------------------------
    function renderManifest(section) {
        const load = current.load, planning = working && loadsApi.beforeDeparture(load);
        const counts = loadsApi.cardCounts(load);
        section.append(el('h3', 'Manifest', 'h6'), el('p', counts.length ? counts.join(' · ') : 'Nothing planned yet.', 'small text-muted'));
        if (planning) section.append(planForm(load));
        for (const group of loadsApi.manifestByStop(current.stops, current.lines)) {
            if (!group.lines.length) continue;
            const stop = group.stop;
            section.append(el('h4', stop ? `Stop ${stop.seq} · ${stop.place_name} (${loadsApi.STOP_KINDS[stop.kind]})` : 'Other stops', 'h6 mt-3'));
            const table = el('table', '', 'table table-sm'), head = el('tr'), rows = el('tbody');
            for (const label of ['Tag', 'Piece', 'Status', '']) { const cell = el('th', label); cell.scope = 'col'; head.append(cell); }
            const thead = el('thead'); thead.append(head);
            for (const line of group.lines) rows.append(manifestRow(load, line, planning));
            table.append(thead, rows);
            const wrap = el('div', '', 'table-responsive'); wrap.append(table);
            section.append(wrap);
        }
    }

    function planForm(load) {
        const form = el('form', '', 'plan-form'), dropoffs = current.stops.filter(stop => stop.kind !== 'pickup');
        form.noValidate = true;
        if (!dropoffs.length) { form.append(el('p', 'Add and save a drop-off stop, then plan pieces for it.', 'small text-muted')); return form; }
        // What was typed survives a refusal and the redraw after it.
        const draft = current.plan ||= { code: '', stopId: '' };
        if (!dropoffs.some(item => item.id === draft.stopId)) draft.stopId = dropoffs[0].id;
        const row = el('div', '', 'load-grid');
        const code = field(row, 'Crate code or item tag', el('input', '', 'form-control'), 'planCode'); code.autocomplete = 'off'; code.maxLength = 120; code.value = draft.code;
        const stop = field(row, 'Comes off at', select(dropoffs.map(item => [item.id, `Stop ${item.seq} · ${item.place_name}`]), draft.stopId), 'planStop');
        code.oninput = () => { draft.code = code.value; };
        stop.onchange = () => { draft.stopId = stop.value; };
        const add = el('button', 'Add to the plan', 'btn btn-primary'); add.type = 'submit'; add.dataset.focusKey = 'plan';
        const wrap = el('div', '', 'mb-3 d-flex align-items-end'); wrap.append(add); row.append(wrap);
        form.append(row);
        if (current.dirty.stops) form.append(el('p', 'Save the stops to plan pieces for new ones.', 'small text-muted'));
        form.onsubmit = event => {
            event.preventDefault();
            const value = code.value.trim();
            if (!value) { status('Enter a crate code (HU-…) or an item tag.'); code.focus(); return; }
            void operate('load_plan', { loadId: load.id, add: [{ code: value, dropoffStopId: stop.value }] }, { focus: 'plan', failed: `Could not plan ${value}`,
                done: () => { draft.code = ''; return `Planned ${value} on ${load.load_number}.`; } }).then(() => $('planCode')?.focus());
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
            if (current.finding === line.id) actions.append(foundForm(line));
            else {
                const found = button('Mark found', 'btn btn-sm btn-outline', () => { current.finding = line.id; renderDrawer(); $('foundPlace')?.focus(); }, `Mark ${line.tag} found`);
                found.dataset.focusKey = `found-${line.id}`;
                actions.append(found);
            }
        }
        row.append(el('td', line.tag, 'mono'), piece, state, actions);
        return row;
    }

    function foundForm(line) {
        const form = el('form', '', 'found-form');
        form.noValidate = true;
        const where = field(form, 'Found at', select(placeOptions(null, 'Choose a place')), 'foundPlace');
        const note = field(form, 'Note (optional)', el('input', '', 'form-control'), 'foundNote'); note.maxLength = 500;
        const save = el('button', 'Save', 'btn btn-sm btn-primary'); save.type = 'submit';
        const actions = el('div', '', 'd-flex gap-2');
        actions.append(save, button('Cancel', 'btn btn-sm btn-ghost', () => { current.finding = null; renderDrawer({ focus: `found-${line.id}` }); }));
        form.append(actions);
        form.onsubmit = event => {
            event.preventDefault();
            if (!where.value) { status(`Choose where ${line.tag} turned up.`); where.focus(); return; }
            const state = current;
            void operate('line_found', { lineId: line.id, placeId: where.value, note: note.value.trim() }, { focus: 'actions', failed: `Could not mark ${line.tag} found`,
                done: () => { state.finding = null; return `${line.tag} is marked found at ${places.find(place => place.id === where.value)?.name}.`; } });
        };
        return form;
    }

    // ---- Driver's licence (office only) -----------------------------------------------------
    function renderLicence(section) {
        const load = current.load, licence = current.licence;
        section.append(el('h3', "Driver's licence", 'h6'), el('p', 'Office staff only. Never printed, and removed 90 days after the load closes.', 'small text-muted'));
        if (licence?.removed_at) { section.append(el('p', `Removed ${timeText(licence.removed_at)}, 90 days after the load closed.`, 'small')); return; }
        const form = el('form'), grid = el('div', '', 'load-grid');
        form.noValidate = true;
        const number = field(grid, 'Licence number', el('input', '', 'form-control'), 'licenceNumber');
        Object.assign(number, { autocomplete: 'off', spellcheck: false, maxLength: 40, value: licence?.licence_number || '' });
        const issuer = field(grid, 'Issuing state', el('input', '', 'form-control'), 'licenceState'); issuer.maxLength = 40; issuer.value = licence?.licence_state || '';
        const expiry = field(grid, 'Expiry date', el('input', '', 'form-control'), 'licenceExpiry'); expiry.type = 'date'; expiry.value = licence?.licence_expiry || '';
        form.append(grid);
        if (licence?.recorded_at) form.append(el('p', `Recorded ${timeText(licence.recorded_at)}.`, 'small text-muted'));
        const save = el('button', 'Save licence', 'btn btn-primary'); save.type = 'submit'; save.dataset.focusKey = 'licence';
        form.append(save);
        form.oninput = markDirty('licence');
        form.onsubmit = event => {
            event.preventDefault();
            const result = loadsApi.licenceValues({ number: number.value, state: issuer.value, expiry: expiry.value });
            if (result.error) { status(result.error); ({ number, state: issuer, expiry })[result.field]?.focus(); return; }
            void saveLicence(load, result.licence);
        };
        section.append(form);

        const photos = el('div', '', 'licence-photos');
        section.append(el('h4', 'Photos', 'h6 mt-3'), photos);
        if (!current.photos.length) photos.append(el('p', 'No photos yet.', 'small text-muted mb-0'));
        current.photos.forEach((photo, index) => {
            const image = el('img'); image.alt = `Driver's licence photo ${index + 1}`;
            photos.append(image);
            // Short-lived links: a signed URL works for five minutes.
            void supabaseClient.storage.from('driver-licences').createSignedUrl(photo.storage_path, 300).then(({ data, error }) => {
                if (error || !data?.signedUrl) image.replaceWith(el('p', 'This photo could not be shown.', 'small text-danger mb-0'));
                else image.src = data.signedUrl;
            });
        });
        if (current.pendingPhoto) {
            section.append(button('Try attaching the photo again', 'btn btn-sm btn-outline mt-2', () => void attachPhoto(load, current.pendingPhoto)));
        } else if (current.photos.length < loadsApi.MAX_LICENCE_PHOTOS) {
            const label = el('label', 'Add a photo (JPEG or PNG, up to 10 MB)', 'form-label mt-2'); label.htmlFor = 'licencePhoto';
            const input = el('input', '', 'form-control'); Object.assign(input, { id: 'licencePhoto', type: 'file', accept: 'image/jpeg,image/png' });
            input.onchange = () => { const file = input.files?.[0]; input.value = ''; if (file) void addPhoto(load, file); };
            section.append(label, input);
        } else section.append(el('p', `A load keeps at most ${loadsApi.MAX_LICENCE_PHOTOS} photos.`, 'small text-muted mt-2'));
    }

    // The number goes only to record_driver_licence, which keeps it out of field_operations and the audit log.
    async function saveLicence(load, licence) {
        if (lock.busy) { status(STILL_SAVING); return; }
        body.disabled = true; status('Saving…');
        const state = current;
        let last4 = '';
        const outcome = await inv.writeThenReload(lock, [async () => {
            const { data, error } = await supabaseClient.rpc('record_driver_licence', { p_operation_id: crypto.randomUUID(), p_load_id: load.id, p_licence: licence });
            if (error) throw error;
            last4 = data?.last4 || '';
        }], refresh);
        body.disabled = false;
        if (!outcome.error) state.dirty.licence = false;
        window.InvenioUnsavedChanges = dirty();
        const text = outcome.error ? `Could not save the licence: ${loadsApi.errorMessage(outcome.error)}` : `Saved the licence${last4 ? ` ending ${last4}` : ''}.`;
        if (current === state) { renderDrawer({ focus: 'licence' }); status(text); }
    }

    // Upload without overwriting, then attach. If attaching fails, the uploaded photo can be attached again later.
    async function addPhoto(load, file) {
        const target = loadsApi.licencePhotoPath(load.id, file, crypto.randomUUID());
        if (target.error) { status(target.error); return; }
        if (lock.busy) { status(STILL_SAVING); return; }
        status('Uploading the photo…');
        const { error } = await supabaseClient.storage.from('driver-licences').upload(target.path, file, { contentType: file.type, upsert: false });
        if (error && !/already exists/i.test(error.message || '')) { status(`Could not upload the photo: ${loadsApi.errorMessage(error)}`); return; }
        await attachPhoto(load, target.path);
    }

    async function attachPhoto(load, path) {
        if (lock.busy) { status(STILL_SAVING); return; }
        body.disabled = true;
        const state = current;
        const outcome = await inv.writeThenReload(lock, [async () => {
            const { error } = await supabaseClient.rpc('attach_driver_licence_photo', { p_load_id: load.id, p_path: path });
            if (error) throw error;
        }], refresh);
        body.disabled = false;
        state.pendingPhoto = outcome.error ? path : null;
        if (current === state) {
            renderDrawer();
            status(outcome.error ? `The photo was uploaded but could not be attached: ${loadsApi.errorMessage(outcome.error)}` : 'Added the photo.');
        }
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
    // When office staff open Loads, licences of loads closed more than 90 days ago are removed: photos first,
    // then the number. It runs in the background and never blocks the board.
    async function removeOldLicences() {
        const note = $('housekeeping');
        const { data, error } = await supabaseClient.rpc('driver_licences_due_for_removal');
        if (error) { note.hidden = false; note.textContent = `Old driver's licences could not be checked (${loadsApi.errorMessage(error)}).`; return; }
        let removed = 0;
        const failed = [];
        for (const row of data || []) {
            try {
                if (row.storage_paths?.length) {
                    const { error: storageError } = await supabaseClient.storage.from('driver-licences').remove(row.storage_paths);
                    if (storageError) throw storageError;
                }
                const { error: removeError } = await supabaseClient.rpc('remove_driver_licence', { p_load_id: row.load_id });
                if (removeError) throw removeError;
                removed++;
            } catch (failure) { failed.push(`${row.load_number} (${loadsApi.errorMessage(failure)})`); }
        }
        const parts = [];
        if (removed) parts.push(`Removed the driver's licence of ${plural(removed, 'load')} closed more than 90 days ago.`);
        if (failed.length) parts.push(`Could not remove the driver's licence of ${failed.join(', ')}.`);
        note.hidden = !parts.length;
        note.textContent = parts.join(' ');
    }

    // ---- Wiring -----------------------------------------------------------------------------
    const setFinished = value => {
        finished = value;
        $('showOpen').setAttribute('aria-pressed', String(!value)); $('showFinished').setAttribute('aria-pressed', String(value));
        renderBoard();
    };
    $('showOpen').onclick = () => setFinished(false);
    $('showFinished').onclick = () => setFinished(true);
    $('newLoad').hidden = !working;
    $('newLoad').onclick = openNew;
    try { await Promise.all([loadBoard(), loadPlaces()]); }
    catch (error) { message(`Could not load loads: ${loadsApi.errorMessage(error)}`); return; }
    if (office) void removeOldLicences();
    // Outside Shops links to a load with ?load=<id>.
    const linked = new URLSearchParams(location.search).get('load');
    if (linked) void openLoad(linked);
})();

(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const logistics = InvenioLogistics;
    const projectId = InvenioProjectScope.getActiveProjectId();
    const profile = InvenioCurrentProfile;
    const office = ['office_staff', 'admin'].includes(profile.role) && InvenioProjectScope.activeProject.status === 'active';
    const PAGE_SIZE = 250, LABELS_PER_PAGE = 6;
    const COLUMNS = 'id,code,kind,description,is_high_value,status,parent_id,parent_code,top_unit_id,top_code,place_name,location,item_count,unit_count,sealed_at,created_at';
    const message = text => { $('pageMessage').textContent = text; };
    function el(tag, text = '', className = '') {
        const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    function button(text, className, onclick, label) {
        const node = el('button', text, className); node.type = 'button'; node.onclick = onclick;
        if (label) node.setAttribute('aria-label', label);
        return node;
    }
    // Crates are read-only here: the field packs and unpacks them through apply_field_operation.
    async function fetchAll(table, columns, filter = query => query) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await filter(projectSupabaseClient.from(table).select(columns)).order('id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) return rows;
        }
    }
    const dateText = value => value ? new Date(value).toLocaleDateString() : '';
    const statusChip = unit => { const status = logistics.UNIT_STATUS[unit.status] || { label: unit.status, chip: 'chip-muted' }; return el('span', status.label, `chip ${status.chip}`); };
    const kindText = unit => logistics.UNIT_KINDS[unit.kind] || unit.kind;

    let units = [], byId = new Map(), filtered = [], shown = PAGE_SIZE, lastBatch = null, printing = false;

    async function load() {
        units = await fetchAll('handling_unit_overview', COLUMNS);
        byId = new Map(units.map(unit => [unit.id, unit]));
        renderStatusOptions(); applyFilters();
    }

    function renderStatusOptions() {
        const select = $('filterStatus'), keep = select.value;
        const count = status => units.filter(unit => unit.status === status).length;
        select.replaceChildren(new Option(`All statuses (${units.length.toLocaleString()})`, ''),
            ...Object.entries(logistics.UNIT_STATUS).map(([status, { label }]) => new Option(`${label} (${count(status).toLocaleString()})`, status)));
        select.value = keep;
    }

    function applyFilters() {
        filtered = logistics.filterUnits(units, { status: $('filterStatus').value, search: $('filterSearch').value });
        shown = PAGE_SIZE;
        $('resultSummary').textContent = filtered.length === units.length
            ? `${units.length.toLocaleString()} ${units.length === 1 ? 'crate' : 'crates'}`
            : `${filtered.length.toLocaleString()} of ${units.length.toLocaleString()} crates match`;
        renderTable();
    }

    function whereCell(unit) {
        const cell = el('td'), where = logistics.unitWhere(unit);
        if (unit.parent_code) cell.append(el('div', `Inside ${unit.parent_code}`, 'mono'));
        if (where) cell.append(el('div', where, unit.parent_code ? 'small text-muted' : ''));
        if (!cell.childNodes.length) cell.append(el('span', 'Not recorded', 'small text-muted'));
        return cell;
    }

    function renderTable() {
        const body = $('unitRows'); body.replaceChildren();
        if (!filtered.length) {
            const row = el('tr'), cell = el('td', units.length ? 'No crates match these filters.'
                : office ? 'No crates yet. Print labels; each becomes a crate when a field crew packs it.' : 'No crates yet.', 'text-muted');
            cell.colSpan = 6; row.append(cell); body.append(row);
        }
        for (const unit of filtered.slice(0, shown)) {
            const row = el('tr'), code = el('td'), status = el('td');
            // The code opens the crate, so a phone needn't scroll the table sideways to reach a button.
            code.append(button(unit.code, 'btn btn-link p-0 mono row-open', () => openUnit(unit.id)), el('div', kindText(unit), 'small text-muted'));
            if (unit.is_high_value) code.append(el('span', 'High value', 'chip chip-danger'));
            status.append(statusChip(unit));
            row.append(code, el('td', unit.description || ''), status, whereCell(unit), el('td', logistics.contentsText(unit), 'small'), el('td', dateText(unit.sealed_at)));
            body.append(row);
        }
        $('tableFooter').hidden = filtered.length <= shown;
        $('tableMore').textContent = `Show more (${(filtered.length - shown).toLocaleString()} left)`;
    }

    // ---- Crate drawer: details, the items packed in it and the crates inside it ---------------
    const drawer = $('unitDrawer');
    function openUnit(id) {
        const unit = byId.get(id);
        if (!unit) return;
        const content = $('unitContent'); content.replaceChildren();
        const header = el('div', '', 'work-page-header'), title = el('h2', unit.code, 'mono');
        title.id = 'unitTitle'; title.tabIndex = -1;
        const close = button('Close', 'btn btn-outline-secondary', () => drawer.close());
        header.append(title, close);
        const badges = el('p', '', 'd-flex flex-wrap gap-2 align-items-center');
        badges.append(statusChip(unit), el('span', kindText(unit), 'chip chip-muted'));
        if (unit.is_high_value) badges.append(el('span', 'High value', 'chip chip-danger'));
        content.append(header, badges);

        const list = el('dl', '', 'record-fields');
        const pair = (label, value) => { const row = el('div'), detail = el('dd'); detail.append(value); row.append(el('dt', label), detail); list.append(row); };
        const link = other => button(other.code, 'btn btn-sm btn-outline mono', () => openUnit(other.id), `Open ${other.code}`);
        if (unit.description) pair('Description', unit.description);
        if (unit.parent_id) pair('Inside', byId.has(unit.parent_id) ? link(byId.get(unit.parent_id)) : unit.parent_code || '');
        if (unit.top_unit_id && unit.top_unit_id !== unit.id && unit.top_unit_id !== unit.parent_id) {
            pair('Outermost crate', byId.has(unit.top_unit_id) ? link(byId.get(unit.top_unit_id)) : unit.top_code || '');
        }
        if (unit.place_name) pair('Place', unit.place_name);
        if (unit.location) pair('Area', unit.location);
        if (unit.sealed_at) pair('Sealed', new Date(unit.sealed_at).toLocaleString());
        if (unit.created_at) pair('First packed', new Date(unit.created_at).toLocaleString());
        const details = el('section', '', 'record-section mb-3'); details.append(el('h3', 'Details', 'h6'), list);
        if (unit.parent_id) details.append(el('p', 'A crate inside another crate is wherever its outermost crate is.', 'small text-muted mb-0'));
        content.append(details);

        const items = el('section', '', 'record-section mb-3'), itemBody = el('div');
        items.append(el('h3', `Items (${unit.item_count.toLocaleString()})`, 'h6'), itemBody);
        itemBody.append(el('p', unit.item_count ? 'Loading items…' : 'No items packed.', 'text-muted mb-0'));
        content.append(items);

        const inside = units.filter(other => other.parent_id === unit.id).sort((a, b) => a.code.localeCompare(b.code));
        const nested = el('section', '', 'record-section');
        nested.append(el('h3', `Crates inside (${inside.length.toLocaleString()})`, 'h6'));
        if (!inside.length) nested.append(el('p', 'No crates inside.', 'text-muted mb-0'));
        else {
            const rows = el('ul', '', 'unit-children');
            for (const child of inside) {
                const row = el('li');
                row.append(link(child), statusChip(child), el('span', `${kindText(child)} · ${logistics.contentsText(child)}`, 'small text-muted'));
                rows.append(row);
            }
            nested.append(rows);
        }
        content.append(nested);
        if (drawer.open) title.focus(); else { drawer.showModal(); close.focus(); }
        if (unit.item_count) void loadItems(unit, itemBody);
    }

    // Each opening builds a new container, so items that arrive after another crate was opened land nowhere.
    async function loadItems(unit, container) {
        let rows;
        try { rows = await fetchAll('handling_unit_items', 'id,tag,name,quantity,uom,packed_at', query => query.eq('unit_id', unit.id)); }
        catch (error) {
            container.replaceChildren(el('p', `Items could not be loaded (${logistics.errorMessage(error)}). Close and reopen to retry.`, 'text-danger mb-0'));
            return;
        }
        if (!rows.length) { container.replaceChildren(el('p', 'No items packed.', 'text-muted mb-0')); return; }
        rows.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
        const table = el('table', '', 'table table-sm'), head = el('tr'), body = el('tbody');
        for (const label of ['Tag', 'Item', 'Quantity', 'Packed']) { const cell = el('th', label); cell.scope = 'col'; head.append(cell); }
        const thead = el('thead'); thead.append(head);
        for (const item of rows) {
            const row = el('tr');
            row.append(el('td', item.tag, 'mono'), el('td', item.name || ''), el('td', `${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${item.uom || ''}`.trim(), 'num'), el('td', dateText(item.packed_at)));
            body.append(row);
        }
        table.append(thead, body);
        const wrap = el('div', '', 'table-responsive'); wrap.append(table);
        container.replaceChildren(wrap);
    }

    // ---- Crate labels -----------------------------------------------------------------------
    const labelDialog = $('labelDialog');
    // While codes are being reserved the dialog stays open: Chrome closes it on a second Escape regardless, so it reopens.
    labelDialog.addEventListener('cancel', event => { if (printing) event.preventDefault(); });
    labelDialog.addEventListener('close', () => {
        if (printing) { labelDialog.showModal(); return; }
        window.InvenioUnsavedChanges = false;
    });
    function openLabels() {
        const content = $('labelContent'); content.replaceChildren();
        const header = el('div', '', 'work-page-header'), title = el('h2', 'Print crate labels'); title.id = 'labelTitle';
        header.append(title, button('Close', 'btn btn-outline-secondary', () => { if (!printing) labelDialog.close(); }));
        const form = el('form');
        form.append(el('p', `Each label gets a new code for ${InvenioProjectScope.activeProject.name}. A label becomes a crate the first time a field crew packs it; labels you don't use stay unused.`));
        const label = el('label', 'How many labels?', 'form-label'); label.htmlFor = 'labelCount';
        const count = el('input', '', 'form-control'); count.id = 'labelCount';
        Object.assign(count, { type: 'number', min: 1, max: logistics.MAX_LABELS, step: 1, value: String(LABELS_PER_PAGE), required: true });
        const wrap = el('div', '', 'mb-3'); wrap.append(label, count, el('p', `${LABELS_PER_PAGE} labels fit on a letter page. Up to ${logistics.MAX_LABELS} at a time.`, 'small text-muted mb-0'));
        const submit = el('button', 'Reserve and print', 'btn btn-primary'); submit.type = 'submit';
        const actions = el('div', '', 'd-flex flex-wrap gap-2'); actions.append(submit);
        if (lastBatch) actions.append(button(`Print the last ${lastBatch.length === 1 ? 'label' : `${lastBatch.length} labels`} again`, 'btn btn-outline', () => reprint(status)));
        const status = el('p', '', 'small mt-2'); status.setAttribute('role', 'status');
        form.append(wrap, actions, status);
        form.onsubmit = event => { event.preventDefault(); void printLabels(count.value, status, submit); };
        content.append(header, form);
        labelDialog.showModal(); count.focus();
    }

    async function printLabels(text, status, submit) {
        if (printing) { status.textContent = 'Still preparing the last labels. Try again in a moment.'; return; }
        const parsed = logistics.labelCount(text);
        if (parsed.error) { status.textContent = parsed.error; return; }
        if (typeof window.qrcode !== 'function') { status.textContent = 'The QR code library did not load. Check the connection and reload the page. No labels were reserved.'; return; }
        // Open the window during the click, before any waiting, or the browser blocks it as a pop-up.
        const printWindow = window.open('', '_blank');
        if (!printWindow) { status.textContent = 'Allow pop-ups for this site, then try again. No labels were reserved.'; return; }
        printWindow.opener = null;
        printWindow.document.title = 'Preparing crate labels';
        printWindow.document.body.textContent = 'Reserving labels…';
        printing = true; submit.disabled = true; status.textContent = 'Reserving labels…';
        const report = text => { status.textContent = text; message(text); };
        try {
            const { data, error } = await supabaseClient.rpc('reserve_handling_unit_labels', { p_project_id: projectId, p_count: parsed.count });
            if (error) throw error;
            lastBatch = data.map(row => row.code);
        } catch (error) {
            if (!printWindow.closed) printWindow.close();
            report(`Could not reserve labels: ${logistics.errorMessage(error)}. Nothing was printed.`);
            return;
        } finally {
            printing = false; submit.disabled = false;
        }
        // The codes are reserved now, whatever happens to the print sheet; the last batch can always be printed again.
        const reserved = `Reserved ${lastBatch.length} ${lastBatch.length === 1 ? 'label' : 'labels'} (${lastBatch.length === 1 ? lastBatch[0] : `${lastBatch[0]} to ${lastBatch.at(-1)}`})`;
        const again = 'Close this and choose Print crate labels, then Print the last labels again.';
        if (printWindow.closed) { report(`${reserved}, but the print window was closed. ${again}`); return; }
        try { writeLabels(printWindow, lastBatch); }
        catch (error) {
            if (!printWindow.closed) printWindow.close();
            report(`${reserved}, but the label sheet could not be drawn (${logistics.errorMessage(error)}). ${again}`);
            return;
        }
        report(`${reserved}. They become crates when a field crew packs them.`);
    }

    function reprint(status) {
        const printWindow = window.open('', '_blank');
        if (!printWindow) { status.textContent = 'Allow pop-ups for this site, then try again.'; return; }
        printWindow.opener = null;
        try { writeLabels(printWindow, lastBatch); }
        catch (error) { printWindow.close(); status.textContent = `The label sheet could not be drawn (${logistics.errorMessage(error)}).`; return; }
        status.textContent = `Opened ${lastBatch.length} ${lastBatch.length === 1 ? 'label' : 'labels'} to print again. No new codes were reserved.`;
    }

    const LABEL_CSS = `@page { size: letter; margin: 0.5in; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px; font-size: 14px; }
.page { display: grid; grid-template-columns: repeat(2, 3.75in); grid-auto-rows: 3.3in; justify-content: center; break-after: page; }
.page:last-child { break-after: auto; }
.label { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.08in; border: 1px dashed #bbb; padding: 0.15in; break-inside: avoid; }
.label svg { width: 2.4in; height: 2.4in; }
.code { font: 700 28pt/1 "Courier New", monospace; letter-spacing: 0.04em; }
.project { font-size: 9pt; color: #333; }
@media print { .controls { display: none; } .label { border-color: #ddd; } }`;

    /** Fills the print window: big QR codes holding just the code (what the field app scans), with the code in text. */
    function writeLabels(printWindow, codes) {
        const doc = printWindow.document, svgNS = 'http://www.w3.org/2000/svg';
        const make = (tag, text, className) => { const node = doc.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
        doc.title = `Crate labels — ${InvenioProjectScope.activeProject.name}`;
        const style = doc.createElement('style'); style.textContent = LABEL_CSS;
        doc.head.append(style);
        const controls = make('div', '', 'controls'), print = make('button', 'Print');
        print.type = 'button'; print.onclick = () => printWindow.print();
        controls.append(print, make('span', `${codes.length} ${codes.length === 1 ? 'label' : 'labels'} for ${InvenioProjectScope.activeProject.name}`));
        const pages = [];
        for (let start = 0; start < codes.length; start += LABELS_PER_PAGE) {
            const page = make('section', '', 'page');
            for (const code of codes.slice(start, start + LABELS_PER_PAGE)) {
                // High error correction, so a scuffed label still scans.
                const qr = window.qrcode(0, 'H'); qr.addData(code); qr.make();
                const { size, path } = logistics.qrPath(qr);
                const svg = doc.createElementNS(svgNS, 'svg');
                svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('shape-rendering', 'crispEdges');
                svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `QR code for ${code}`);
                const back = doc.createElementNS(svgNS, 'rect'); back.setAttribute('width', size); back.setAttribute('height', size); back.setAttribute('fill', '#fff');
                const dots = doc.createElementNS(svgNS, 'path'); dots.setAttribute('d', path); dots.setAttribute('fill', '#000');
                svg.append(back, dots);
                const label = make('div', '', 'label');
                label.append(svg, make('div', code, 'code'), make('div', InvenioProjectScope.activeProject.name, 'project'));
                page.append(label);
            }
            pages.push(page);
        }
        doc.body.replaceChildren(controls, ...pages);
        printWindow.focus();
        printWindow.print();
    }

    // ---- Wiring -----------------------------------------------------------------------------
    $('filterStatus').onchange = applyFilters;
    $('filterSearch').oninput = applyFilters;
    $('tableMore').onclick = () => { shown += PAGE_SIZE; renderTable(); };
    $('printLabels').hidden = !office;
    $('printLabels').onclick = openLabels;
    try { await load(); }
    catch (error) { message(`Could not load crates: ${logistics.errorMessage(error)}`); }
})();

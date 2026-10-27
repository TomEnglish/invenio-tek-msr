(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const inv = InvenioInventory, siteMapView = InvenioSiteMapView;
    const projectId = InvenioProjectScope.getActiveProjectId();
    const profile = InvenioCurrentProfile;
    const office = ['office_staff', 'admin'].includes(profile.role) && InvenioProjectScope.activeProject.status === 'active';
    const message = text => { $('pageMessage').textContent = text; };
    function el(tag, text = '', className = '') {
        const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    function button(text, className, onclick, label) {
        const node = el('button', text, className); node.type = 'button'; node.onclick = onclick;
        if (label) node.setAttribute('aria-label', label);
        return node;
    }
    async function fetchAll(table, columns) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await projectSupabaseClient.from(table).select(columns).order('id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) return rows;
        }
    }
    // SheetJS is only on cdnjs up to 0.18.5; it loads on demand and only for .xlsx files (CSV is parsed here).
    const SHEETJS = { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', integrity: 'sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==' };
    const PAGE_SIZE = 250, PREVIEW_ROWS = 300, MAX_FILE_BYTES = 20 * 1024 * 1024;
    const RECORD_COLUMNS = 'id,uid,qr_code,inventory_item,item_description,part_number,category_id,quantity,uom,condition,count_status,source,site_map_id,pin_x,pin_y,zone_id,location,scanner_comments,counted_at,last_scanned_by,receiving_record_id';

    let records = [], categories = new Map(), categoryTree = null, maps = [], zones = new Map(), filtered = [], shown = PAGE_SIZE;
    let mapView = null, mapViewId = null, pinLayer = null, zoneLayer = null;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    async function load() {
        const [recordRows, categoryRows, mapResult, zoneRows] = await Promise.all([
            fetchAll('inventory_records', RECORD_COLUMNS),
            fetchAll('inventory_categories', 'id,parent_id,name,status,sort_order'),
            projectSupabaseClient.from('site_maps').select('id,name,storage_path,image_width,image_height,is_active').order('name'),
            fetchAll('site_map_zones', 'id,map_id,name,color,shape'),
        ]);
        if (mapResult.error) throw mapResult.error;
        records = recordRows.sort((a, b) => collator.compare(String(a.qr_code).trim(), String(b.qr_code).trim()));
        categories = new Map(categoryRows.map(category => [category.id, category]));
        categoryTree = inv.buildCategoryTree(categoryRows, { includeArchived: true });
        maps = mapResult.data.sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name));
        zones = new Map(zoneRows.map(zone => [zone.id, zone]));
        renderProgress(); renderFilterOptions(); applyFilters();
    }

    const categoryText = id => id ? inv.categoryPath(categories, id).join(' › ') : '';
    const zoneName = id => zones.get(id)?.name || '';
    const mapName = id => maps.find(map => map.id === id)?.name || '';
    const quantityText = record => `${Number(record.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${record.uom || ''}`.trim();
    const dateText = value => value ? new Date(value).toLocaleDateString() : '';
    function statusChip(record) {
        const status = inv.STATUS[record.count_status] || { label: record.count_status || 'Unknown', chip: '' };
        return el('span', status.label, `chip ${status.chip}`);
    }

    function renderProgress() {
        const progress = inv.countProgress(records);
        $('kpiExpected').textContent = progress.expected.toLocaleString();
        $('kpiExpectedSub').textContent = progress.imported ? `Still to find · ${progress.importedFound.toLocaleString()} of ${progress.imported.toLocaleString()} imported tags found` : 'Still to find · nothing imported yet';
        $('kpiCounted').textContent = progress.counted.toLocaleString();
        $('kpiReceived').textContent = progress.received.toLocaleString();
        $('kpiNew').textContent = progress.newTags.toLocaleString();
    }

    function renderFilterOptions() {
        const category = $('filterCategory'), zone = $('filterZone');
        const keepCategory = category.value, keepZone = zone.value;
        category.replaceChildren(new Option('All categories', ''), new Option('No category', 'none'));
        for (const { node, depth } of inv.flattenTree(categoryTree.roots)) {
            category.append(new Option(`${'   '.repeat(depth)}${node.name}${node.status === 'archived' ? ' (archived)' : node.status === 'proposed' ? ' (proposed)' : ''}`, node.id));
        }
        zone.replaceChildren(new Option('All zones', ''), new Option('No zone', 'none'));
        for (const map of maps) {
            const mapZones = [...zones.values()].filter(item => item.map_id === map.id).sort((a, b) => collator.compare(a.name, b.name));
            if (!mapZones.length) continue;
            const group = document.createElement('optgroup'); group.label = map.name;
            group.append(...mapZones.map(item => new Option(item.name, item.id)));
            zone.append(group);
        }
        category.value = [...category.options].some(option => option.value === keepCategory) ? keepCategory : '';
        zone.value = [...zone.options].some(option => option.value === keepZone) ? keepZone : '';
        const mapSelect = $('viewMapSelect'), keepMap = mapSelect.value;
        mapSelect.replaceChildren(...maps.filter(map => map.storage_path && map.image_width).map(map => new Option(`${map.name}${map.is_active ? '' : ' (inactive)'}`, map.id)));
        if ([...mapSelect.options].some(option => option.value === keepMap)) mapSelect.value = keepMap;
    }

    function currentFilters() {
        const category = $('filterCategory').value;
        return {
            categoryIds: !category ? null : category === 'none' ? new Set([null]) : inv.descendantIds(categoryTree.byId, category),
            zoneId: $('filterZone').value, status: $('filterStatus').value, search: $('filterSearch').value,
        };
    }

    function applyFilters() {
        filtered = inv.filterRecords(records, currentFilters());
        shown = PAGE_SIZE;
        $('resultSummary').textContent = filtered.length === records.length
            ? `${records.length.toLocaleString()} ${records.length === 1 ? 'item' : 'items'}`
            : `${filtered.length.toLocaleString()} of ${records.length.toLocaleString()} items match`;
        renderTable();
        if (!$('mapView').hidden) void renderMap().catch(error => message(error.message));
    }

    function renderTable() {
        const body = $('itemRows'); body.replaceChildren();
        if (!filtered.length) {
            const row = el('tr'), cell = el('td', records.length ? 'No items match these filters.' : office ? 'No items yet. Import expected tags, or wait for field crews to count.' : 'No items yet.', 'text-muted');
            cell.colSpan = 8; row.append(cell); body.append(row);
        }
        for (const record of filtered.slice(0, shown)) {
            const row = el('tr');
            const item = el('td');
            item.append(el('div', record.inventory_item || ''));
            if (record.part_number) item.append(el('div', `Part ${record.part_number}`, 'small text-muted'));
            const status = el('td'); status.append(statusChip(record));
            const action = el('td'); action.append(button('View', 'btn btn-sm btn-outline', () => openItem(record), `View ${record.qr_code}`));
            row.append(el('td', record.qr_code, 'mono'), item, el('td', categoryText(record.category_id), 'small'), el('td', quantityText(record), 'num'),
                el('td', zoneName(record.zone_id)), status, el('td', dateText(record.counted_at)), action);
            body.append(row);
        }
        $('tableFooter').hidden = filtered.length <= shown;
        $('tableMore').textContent = `Show more (${(filtered.length - shown).toLocaleString()} left)`;
    }

    // ---- Map view -----------------------------------------------------------------------------
    let mapLoading = null;
    /** One Leaflet view per chosen map; concurrent callers share the same load. */
    function ensureMapView(siteMap) {
        if (mapView && mapViewId === siteMap.id) return Promise.resolve(mapView);
        if (mapLoading?.id === siteMap.id) return mapLoading.promise;
        if (mapView) { mapView.destroy(); mapView = null; mapViewId = null; }
        const promise = siteMapView.signedPlanUrl(siteMap.storage_path).then(url => {
            if (mapLoading?.id !== siteMap.id) return null;
            mapView = siteMapView.create($('inventoryMap'), siteMap, url); mapViewId = siteMap.id;
            zoneLayer = window.L.layerGroup().addTo(mapView.map);
            pinLayer = window.L.layerGroup().addTo(mapView.map);
            return mapView;
        }).finally(() => { if (mapLoading?.id === siteMap.id) mapLoading = null; });
        mapLoading = { id: siteMap.id, promise };
        return promise;
    }

    async function renderMap() {
        const select = $('viewMapSelect');
        if (!select.options.length) {
            if (mapView) { mapView.destroy(); mapView = null; mapViewId = null; }
            $('inventoryMap').hidden = true;
            $('mapNote').replaceChildren(el('span', 'No site map has a plan image yet. '));
            if (office) { const link = el('a', 'Upload one on Site Maps.'); link.href = 'site-maps.html'; $('mapNote').append(link); }
            return;
        }
        $('inventoryMap').hidden = false;
        const siteMap = maps.find(map => map.id === select.value);
        if (await ensureMapView(siteMap) !== mapView || !mapView) return;
        if (!$('mapView').hidden) mapView.show();
        zoneLayer.clearLayers(); pinLayer.clearLayers();
        for (const zone of zones.values()) {
            if (zone.map_id === siteMap.id) siteMapView.zonePolygon(mapView, zone, { interactive: false, fillOpacity: 0.08 }, { permanentLabel: true }).addTo(zoneLayer);
        }
        const colours = Object.fromEntries(Object.entries(inv.STATUS).map(([status, config]) => [status, siteMapView.cssToken(config.token, '#174fda')]));
        let pinned = 0;
        for (const record of filtered) {
            if (record.site_map_id !== siteMap.id || record.pin_x === null || record.pin_y === null) continue;
            pinned++;
            window.L.circleMarker(mapView.toLatLng([Number(record.pin_x), Number(record.pin_y)]), {
                radius: 7, color: '#ffffff', weight: 2, fillColor: colours[record.count_status] || colours.counted, fillOpacity: 1,
            }).bindTooltip(siteMapView.textNode(`${record.qr_code} · ${record.inventory_item || ''}`)).on('click', () => openItem(record)).addTo(pinLayer);
        }
        const elsewhere = filtered.filter(record => record.site_map_id && record.site_map_id !== siteMap.id).length;
        const unpinned = filtered.filter(record => !record.site_map_id || record.pin_x === null).length;
        $('mapNote').textContent = [`${pinned.toLocaleString()} matching ${pinned === 1 ? 'item has a pin' : 'items have pins'} on this map. Select a pin for details.`,
            elsewhere ? `${elsewhere.toLocaleString()} more on other maps.` : '', unpinned ? `${unpinned.toLocaleString()} without a pin (the table lists every item).` : ''].filter(Boolean).join(' ');
    }

    function setView(name) {
        const map = name === 'map';
        $('tableView').hidden = map; $('mapView').hidden = !map;
        $('showTable').setAttribute('aria-pressed', String(!map)); $('showMap').setAttribute('aria-pressed', String(map));
        if (map) void renderMap().catch(error => message(error.message));
    }

    // ---- Item drawer --------------------------------------------------------------------------
    const drawer = $('itemDrawer');
    async function openItem(record) {
        const content = $('itemContent'); content.replaceChildren();
        const header = el('div', '', 'work-page-header');
        const title = el('h2', record.inventory_item || record.qr_code); title.id = 'itemTitle';
        const close = button('Close', 'btn btn-outline-secondary', () => drawer.close()); close.autofocus = true;
        header.append(title, close);
        const badges = el('p', '', 'd-flex flex-wrap gap-2 align-items-center');
        badges.append(el('span', record.qr_code, 'mono'), statusChip(record));
        content.append(header, badges);
        const fields = [
            ['Category', categoryText(record.category_id)], ['Quantity', quantityText(record)], ['Part number', record.part_number],
            ['Description', record.item_description], ['Condition', record.condition], ['Site map', mapName(record.site_map_id)],
            ['Zone', zoneName(record.zone_id)], ['Location', record.location !== zoneName(record.zone_id) ? record.location : ''],
            ['Source', inv.SOURCE_LABELS[record.source] || record.source], ['Counted', record.counted_at ? new Date(record.counted_at).toLocaleString() : ''],
            ['Counted by', record.counted_at ? record.last_scanned_by : ''], ['Notes', record.scanner_comments],
        ];
        const list = el('dl', '', 'record-fields');
        for (const [label, value] of fields) {
            if (value === null || value === undefined || value === '') continue;
            const pair = el('div'); pair.append(el('dt', label), el('dd', String(value))); list.append(pair);
        }
        const section = el('section', '', 'record-section mb-3'); section.append(el('h3', 'Details', 'h6'), list);
        content.append(section);
        const actions = el('div', '', 'd-flex flex-wrap gap-2 mb-3');
        if (record.receiving_record_id) {
            const link = el('a', 'View receiving record', 'btn btn-outline');
            link.href = `record.html?type=receiving_records&id=${encodeURIComponent(record.receiving_record_id)}`; actions.append(link);
        }
        if (record.site_map_id && record.pin_x !== null && maps.some(map => map.id === record.site_map_id && map.storage_path)) {
            actions.append(button('Show on map', 'btn btn-outline', async () => {
                drawer.close(); $('viewMapSelect').value = record.site_map_id; setView('map');
                await renderMap();
                mapView?.map.setView(mapView.toLatLng([Number(record.pin_x), Number(record.pin_y)]), Math.max(mapView.map.getZoom(), mapView.map.getMinZoom() + 2));
            }));
        }
        if (actions.children.length) content.append(actions);
        const photos = el('section', '', 'record-section'); photos.append(el('h3', 'Photos', 'h6'));
        const gallery = el('div', '', 'record-photos'); gallery.append(el('p', 'Loading photos…', 'text-muted mb-0'));
        photos.append(gallery); content.append(photos);
        drawer.showModal();
        const { data, error } = await projectSupabaseClient.from('inventory_photos').select('storage_path,created_at').eq('inventory_uid', record.uid).order('created_at');
        gallery.replaceChildren();
        if (error) { gallery.append(el('p', 'Photos could not be loaded. Close and reopen to retry.', 'text-danger mb-0')); return; }
        if (!data.length) { gallery.append(el('p', 'No photos attached.', 'text-muted mb-0')); return; }
        for (const [index, photo] of data.entries()) {
            const { data: signed, error: signError } = await supabaseClient.storage.from('inventory-photos').createSignedUrl(photo.storage_path, 300);
            if (signError) { gallery.append(el('p', `Photo ${index + 1} is unavailable.`, 'text-muted')); continue; }
            const img = el('img', '', 'record-photo'); img.src = signed.signedUrl; img.alt = `Photo ${index + 1} of ${record.qr_code}`; img.loading = 'lazy';
            gallery.append(img);
        }
    }

    // ---- CSV export ---------------------------------------------------------------------------
    function exportCsv() {
        const headers = ['tag', 'name', 'description', 'category_path', 'part_number', 'quantity', 'uom', 'count_status', 'source', 'condition', 'site_map', 'zone', 'pin_x', 'pin_y', 'counted_at', 'counted_by', 'notes'];
        const rows = filtered.map(record => [record.qr_code, record.inventory_item, record.item_description, inv.categoryPath(categories, record.category_id).join(' > '),
            record.part_number, record.quantity, record.uom, record.count_status, record.source, record.condition, mapName(record.site_map_id), zoneName(record.zone_id),
            record.pin_x, record.pin_y, record.counted_at, record.counted_at ? record.last_scanned_by : '', record.scanner_comments]);
        const blob = new Blob(['﻿' + inv.toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `initial-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        message(`Exported ${rows.length.toLocaleString()} ${rows.length === 1 ? 'item' : 'items'}.`);
    }

    // ---- Import -------------------------------------------------------------------------------
    const importDialog = $('importDialog');
    // importRun changes whenever the file, sheet or mapping changes, so a late response for an older choice is dropped.
    let sheet = null, workbook = null, importBusy = false, preview = null, importRun = 0;
    const lockImport = locked => { for (const control of $('importContent').querySelectorAll('input, select')) control.disabled = locked; };
    let sheetJs = null;
    function loadSheetJs() {
        sheetJs ||= new Promise((resolve, reject) => {
            if (window.XLSX) { resolve(window.XLSX); return; }
            const script = document.createElement('script');
            Object.assign(script, { src: SHEETJS.src, integrity: SHEETJS.integrity, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' });
            script.onload = () => resolve(window.XLSX);
            script.onerror = () => { sheetJs = null; reject(new Error('The spreadsheet reader could not be loaded. Check your connection, or save the sheet as CSV.')); };
            document.head.append(script);
        });
        return sheetJs;
    }
    function closeImport() {
        if (importBusy) return;
        if (sheet && !confirm('Close the import? The file and column choices will be cleared.')) return;
        sheet = null; workbook = null; preview = null; window.InvenioUnsavedChanges = false; importDialog.close();
    }
    importDialog.addEventListener('cancel', event => { event.preventDefault(); closeImport(); });

    function openImport() {
        sheet = null; workbook = null; preview = null;
        const content = $('importContent'); content.replaceChildren();
        const header = el('div', '', 'work-page-header');
        const title = el('h2', 'Import expected tags'); title.id = 'importTitle';
        header.append(title, button('Close', 'btn btn-outline-secondary', closeImport));
        content.append(header, el('p', 'Add the tags field crews should find. New tags become Expected. Tags already counted or received are never changed. Missing categories in a path such as "Gas Turbine 2 > Lube Oil > Cooler" are created.', 'text-muted'));
        const step1 = el('section', '', 'import-step'); step1.append(el('h3', '1. Choose a file', 'h6'));
        const fileLabel = el('label', 'CSV or Excel (.xlsx) file', 'form-label'); fileLabel.htmlFor = 'importFile';
        const file = el('input', '', 'form-control'); file.type = 'file'; file.id = 'importFile';
        file.accept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const sheetWrap = el('div', '', 'mt-2'); sheetWrap.hidden = true;
        const sheetLabel = el('label', 'Sheet', 'form-label'); sheetLabel.htmlFor = 'importSheet';
        const sheetSelect = el('select', '', 'form-select'); sheetSelect.id = 'importSheet';
        sheetWrap.append(sheetLabel, sheetSelect);
        const fileStatus = el('p', '', 'small mt-2'); fileStatus.setAttribute('role', 'status');
        step1.append(fileLabel, file, sheetWrap, fileStatus);
        const step2 = el('section', '', 'import-step'); step2.hidden = true;
        const step3 = el('section', '', 'import-step'); step3.hidden = true;
        content.append(step1, step2, step3);

        function useSheet(rows) {
            importRun++;
            sheet = inv.splitHeader(rows);
            preview = null; step3.hidden = true; window.InvenioUnsavedChanges = true;
            if (!sheet.headers.length) { fileStatus.textContent = 'This sheet is empty.'; step2.hidden = true; return; }
            const dataRows = sheet.rows.filter(row => row.some(cell => String(cell ?? '').trim())).length;
            if (!dataRows) { fileStatus.textContent = 'No data rows found below the header row.'; step2.hidden = true; return; }
            fileStatus.textContent = `${dataRows.toLocaleString()} ${dataRows === 1 ? 'row' : 'rows'} below the header row (line ${sheet.firstLine - 1}).`;
            renderMapping(step2, step3);
        }
        file.onchange = async () => {
            const chosen = file.files[0], run = ++importRun;
            sheet = null; workbook = null; preview = null; step2.hidden = true; step3.hidden = true; sheetWrap.hidden = true;
            if (!chosen) return;
            if (chosen.size > MAX_FILE_BYTES) { fileStatus.textContent = 'This file is over 20 MB. Split it into smaller files.'; return; }
            fileStatus.textContent = 'Reading file…';
            try {
                if (/\.csv$/i.test(chosen.name) || chosen.type === 'text/csv') {
                    const text = await chosen.text();
                    if (run === importRun) useSheet(inv.parseCsv(text));
                    return;
                }
                if (!/\.xlsx$/i.test(chosen.name)) throw new Error('Choose a .csv or .xlsx file.');
                const XLSX = await loadSheetJs(), buffer = await chosen.arrayBuffer();
                if (run !== importRun) return;
                workbook = XLSX.read(buffer, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, cellNF: true });
                const readSheet = name => inv.sheetToRows(workbook.Sheets[name]);
                sheetSelect.replaceChildren(...workbook.SheetNames.map(name => new Option(name, name)));
                sheetWrap.hidden = workbook.SheetNames.length < 2;
                sheetSelect.onchange = () => useSheet(readSheet(sheetSelect.value));
                useSheet(readSheet(workbook.SheetNames[0]));
            } catch (error) { if (run === importRun) fileStatus.textContent = `Could not read this file: ${error.message}`; }
        };
        importDialog.showModal();
    }

    function renderMapping(step2, step3) {
        const mapping = inv.guessColumnMapping(sheet.headers);
        step2.replaceChildren(el('h3', '2. Match the columns', 'h6'), el('p', 'Tag is required. Leave a column as Not imported to skip it; quantity defaults to 1 and unit to EA.', 'small text-muted'));
        const grid = el('div', '', 'import-mapping');
        for (const fieldName of inv.IMPORT_FIELDS) {
            const label = el('label', inv.IMPORT_LABELS[fieldName] + (fieldName === 'tag' ? ' (required)' : ''), 'form-label'); label.htmlFor = `map-${fieldName}`;
            const select = el('select', '', 'form-select'); select.id = `map-${fieldName}`;
            select.append(new Option('Not imported', ''), ...sheet.headers.map((header, index) => new Option(`${inv.columnLetter(index)}: ${header || '(no header)'}`, String(index))));
            select.value = mapping[fieldName] === null ? '' : String(mapping[fieldName]);
            select.onchange = () => { importRun++; mapping[fieldName] = select.value === '' ? null : Number(select.value); preview = null; step3.hidden = true; renderSample(); };
            const wrap = el('div'); wrap.append(label, select); grid.append(wrap);
        }
        const sample = el('div', '', 'table-responsive mt-3');
        function renderSample() {
            const { items } = inv.rowsToItems(sheet.rows.slice(0, 5), mapping, sheet.firstLine);
            const table = el('table', '', 'table density-compact'), head = el('tr');
            table.append(el('caption', 'First rows as they will be imported', 'small'));
            inv.IMPORT_FIELDS.forEach(name => { const th = el('th', inv.IMPORT_LABELS[name]); th.scope = 'col'; head.append(th); });
            const thead = el('thead'); thead.append(head); const tbody = el('tbody');
            for (const item of items) { const row = el('tr'); inv.IMPORT_FIELDS.forEach(name => row.append(el('td', item[name] || ''))); tbody.append(row); }
            table.append(thead, tbody); sample.replaceChildren(table);
        }
        renderSample();
        const check = el('button', 'Preview import', 'btn btn-primary mt-3'); check.type = 'button';
        const status = el('p', '', 'small mt-2'); status.setAttribute('role', 'status');
        check.onclick = async () => {
            if (importBusy) return;
            if (mapping.tag === null) { status.textContent = 'Choose the column that holds the tag number.'; return; }
            const prepared = inv.rowsToItems(sheet.rows, mapping, sheet.firstLine);
            if (!prepared.items.length) { status.textContent = 'No rows to import.'; return; }
            if (prepared.items.length > inv.MAX_IMPORT_ROWS) { status.textContent = `This sheet has ${prepared.items.length.toLocaleString()} rows. Import at most ${inv.MAX_IMPORT_ROWS.toLocaleString()} at a time; split the file.`; return; }
            const run = importRun;
            importBusy = true; check.disabled = true; lockImport(true); status.textContent = 'Checking every row…';
            try {
                const { data, error } = await supabaseClient.rpc('import_inventory_items', { p_project_id: projectId, p_items: prepared.items, p_dry_run: true });
                if (error) throw error;
                if (run !== importRun) return;
                preview = { ...prepared, result: data };
                status.textContent = '';
                renderPreview(step3);
            } catch (error) { if (run === importRun) status.textContent = `Could not check the file: ${inv.errorMessage(error)}`; }
            finally { importBusy = false; check.disabled = false; lockImport(false); }
        };
        step2.append(grid, sample, check, status);
        step2.hidden = false;
    }

    function renderPreview(step3) {
        const { result, lines, items } = preview;
        const lineOf = row => row ? lines[row - 1] : null;
        step3.replaceChildren(el('h3', '3. Review and apply', 'h6'));
        const summary = el('p', '', 'd-flex flex-wrap gap-2');
        summary.append(el('span', `${result.created} new`, 'chip chip-primary'), el('span', `${result.updated} refreshed`, 'chip chip-info'),
            el('span', `${result.skipped} skipped`, 'chip chip-muted'), el('span', `${result.new_categories} new ${result.new_categories === 1 ? 'category' : 'categories'}`, 'chip chip-success'));
        if (result.errors.length) summary.append(el('span', `${result.errors.length} ${result.errors.length === 1 ? 'problem' : 'problems'}`, 'chip chip-danger'));
        step3.append(summary);
        if (result.errors.length) {
            step3.append(el('p', 'Nothing will be imported until every problem is fixed. Correct the file and choose it again.', 'source-warning'));
            const list = el('ul', '', 'import-errors');
            for (const problem of result.errors.slice(0, PREVIEW_ROWS)) {
                const line = lineOf(problem.row);
                list.append(el('li', `${line ? `Line ${line}` : 'File'}${problem.tag ? ` (tag ${problem.tag})` : ''}: ${problem.message}`));
            }
            if (result.errors.length > PREVIEW_ROWS) list.append(el('li', `…and ${(result.errors.length - PREVIEW_ROWS).toLocaleString()} more.`));
            step3.append(list);
        } else {
            const table = el('table', '', 'table density-compact'), head = el('tr');
            ['Line', 'Tag', 'Name', 'Category', 'What happens'].forEach(text => { const th = el('th', text); th.scope = 'col'; head.append(th); });
            const thead = el('thead'); thead.append(head);
            const tbody = el('tbody');
            for (const row of result.rows.slice(0, PREVIEW_ROWS)) {
                const item = items[row.row - 1] || {}, tr = el('tr');
                tr.append(el('td', String(lineOf(row.row) ?? '')), el('td', row.tag, 'mono'), el('td', item.name || item.description || ''), el('td', item.category_path || '', 'small'), el('td', inv.IMPORT_ACTIONS[row.action] || row.action));
                tbody.append(tr);
            }
            table.append(thead, tbody);
            const wrap = el('div', '', 'table-responsive import-preview'); wrap.append(table);
            step3.append(wrap);
            if (result.rows.length > PREVIEW_ROWS) step3.append(el('p', `Showing the first ${PREVIEW_ROWS} of ${result.rows.length.toLocaleString()} rows.`, 'small text-muted'));
            const apply = el('button', 'Apply import', 'btn btn-primary'); apply.type = 'button';
            apply.disabled = !result.created && !result.updated;
            const status = el('p', '', 'small mt-2'); status.setAttribute('role', 'status');
            if (apply.disabled) status.textContent = 'Every tag in this file is already counted or received. There is nothing to import.';
            apply.onclick = async () => {
                if (importBusy || !preview) return;
                importBusy = true; apply.disabled = true; lockImport(true); status.textContent = 'Importing…';
                let data;
                try {
                    const result = await supabaseClient.rpc('import_inventory_items', { p_project_id: projectId, p_items: preview.items, p_dry_run: false });
                    if (result.error) throw result.error;
                    data = result.data;
                } catch (error) { status.textContent = `Could not import: ${inv.errorMessage(error)}. Nothing was changed.`; apply.disabled = false; return; }
                finally { importBusy = false; lockImport(false); }
                if (data.errors?.length) { preview = { ...preview, result: data }; renderPreview(step3); return; }
                sheet = null; preview = null; window.InvenioUnsavedChanges = false; importDialog.close();
                message(`Import applied: ${data.created} new, ${data.updated} refreshed, ${data.skipped} skipped, ${data.new_categories} new ${data.new_categories === 1 ? 'category' : 'categories'}.`);
                $('pageMessage').focus();
                try { await load(); }
                catch (error) { message(`${$('pageMessage').textContent} The list could not refresh (${inv.errorMessage(error)}). Reload the page.`); }
            };
            step3.append(apply, status);
        }
        step3.hidden = false;
        step3.scrollIntoView({ block: 'start' });
    }

    for (const id of ['filterCategory', 'filterZone', 'filterStatus']) $(id).onchange = applyFilters;
    let searchTimer;
    $('filterSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 200); };
    $('tableMore').onclick = () => { shown += PAGE_SIZE; renderTable(); };
    $('showTable').onclick = () => setView('table');
    $('showMap').onclick = () => setView('map');
    $('viewMapSelect').onchange = () => { void renderMap().catch(error => message(error.message)); };
    $('exportCsv').onclick = exportCsv;
    $('openImport').hidden = !office;
    $('openImport').onclick = openImport;
    for (const dot of document.querySelectorAll('.legend-dot')) dot.style.backgroundColor = siteMapView.cssToken(inv.STATUS[dot.dataset.status].token, '#174fda');
    try { await load(); }
    catch (error) { message(`Could not load the inventory: ${inv.errorMessage(error)}`); }
})().catch(error => { const message = document.getElementById('pageMessage'); if (message) message.textContent = error.message; });

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
    function field(container, labelText, control, id) {
        const label = el('label', labelText, 'form-label'); label.htmlFor = id; control.id = id;
        const wrap = el('div', '', 'mb-3'); wrap.append(label, control); container.append(wrap); return control;
    }
    // Bucket limit is 15 MB; anything larger after downscaling is re-encoded as JPEG.
    const MAX_UPLOAD_BYTES = 15 * 1024 * 1024, MAX_SOURCE_BYTES = 60 * 1024 * 1024;
    const PALETTE = ['#174fda', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed'];

    let maps = [], current = null, zones = [], locations = [], view = null, zoneLayers = new Map(), editor = null, busy = false, showRequest = 0;
    const dialog = $('mapDialog');
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

    async function loadMaps() {
        const { data, error } = await projectSupabaseClient.from('site_maps').select('*').order('name');
        if (error) throw error;
        maps = data.sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name));
    }
    async function fetchZones(mapId) {
        const { data, error } = await projectSupabaseClient.from('site_map_zones').select('*').eq('map_id', mapId).order('sort_order').order('name');
        if (error) throw error;
        return data;
    }
    async function loadLocations() {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await projectSupabaseClient.from('locations').select('id,zone,row,rack').order('id').range(from, from + 999);
            if (error) { locations = []; return; }
            rows.push(...data);
            if (data.length < 1000) break;
        }
        const collator = new Intl.Collator(undefined, { numeric: true });
        locations = rows.sort((a, b) => collator.compare(a.zone, b.zone) || collator.compare(a.row, b.row) || collator.compare(a.rack, b.rack));
    }
    const locationLabel = id => { const l = locations.find(item => item.id === id); return l ? `${l.zone} · Row ${l.row}, Rack ${l.rack}` : id ? 'Linked location' : ''; };

    function renderMapSelect() {
        const select = $('mapSelect'); select.replaceChildren();
        for (const map of maps) select.append(new Option(`${map.name}${map.is_active ? '' : ' (inactive)'}${map.storage_path ? '' : ' (no image)'}`, map.id));
        $('mapSelectLabel').hidden = maps.length < 2;
        $('newMap').hidden = !office;
        $('mapWorkspace').hidden = !maps.length;
        if (!maps.length) message(office ? 'No site maps yet. Choose New map to upload a site plan.' : 'No site maps yet. Office staff upload site plans here.');
    }

    async function showMap(id) {
        if (editor && !confirm('Discard the area you are editing?')) { $('mapSelect').value = current.id; return; }
        closeEditor();
        current = maps.find(map => map.id === id) || maps[0];
        if (!current) { renderMapSelect(); return; }
        $('mapSelect').value = current.id;
        history.replaceState(null, '', `site-maps.html?map=${encodeURIComponent(current.id)}`);
        $('mapTitle').textContent = current.name;
        // Only the latest request may draw: a slower earlier load must not leave its zones or view behind.
        const request = ++showRequest, siteMap = current;
        if (view) { view.destroy(); view = null; }
        zones = []; renderMapActions(); renderZones();
        $('zoneList').replaceChildren(el('li', 'Loading areas…', 'text-muted'));
        $('drawZone').hidden = true;
        const hasImage = Boolean(siteMap.storage_path && siteMap.image_width && siteMap.image_height);
        const [zoneResult, imageResult] = await Promise.all([
            fetchZones(siteMap.id).then(data => ({ data }), error => ({ error })),
            hasImage ? siteMapView.signedPlanUrl(siteMap.storage_path).then(url => ({ url }), error => ({ error })) : {},
        ]);
        if (request !== showRequest) return;
        zones = zoneResult.data || [];
        const showImage = Boolean(imageResult.url);
        $('siteMap').hidden = !showImage; $('mapEmpty').hidden = showImage;
        $('mapEmptyText').textContent = imageResult.error ? 'The plan image could not be loaded. Reload the page to retry.' : 'This map has no plan image yet.';
        if (showImage) {
            view = siteMapView.create($('siteMap'), siteMap, imageResult.url);
            view.map.on('click', event => { if (editor?.drawing) { editor.points.push(view.fromLatLng(event.latlng)); drawEditor(); } });
        }
        $('drawZone').hidden = !office || !view || Boolean(zoneResult.error);
        renderZones();
        if (zoneResult.error) $('zoneList').replaceChildren(el('li', `Areas could not be loaded: ${inv.errorMessage(zoneResult.error)}`, 'text-danger'));
        if (imageResult.error) message(imageResult.error.message);
    }

    function renderMeta() {
        $('mapMeta').textContent = [current.image_width ? `${current.image_width} × ${current.image_height} px` : 'No image',
            `${zones.length} ${zones.length === 1 ? 'area' : 'areas'}`, current.is_active ? 'Active' : 'Inactive: hidden from field crews'].join(' · ');
    }

    function renderMapActions() {
        const actions = $('mapActions'); actions.replaceChildren();
        if (!office) return;
        actions.append(
            button(current.storage_path ? 'Replace image' : 'Upload image', 'btn btn-sm btn-outline', () => openMapForm('image')),
            button('Rename', 'btn btn-sm btn-outline', () => openMapForm('rename')),
            button(current.is_active ? 'Make inactive' : 'Make active', 'btn btn-sm btn-ghost', toggleActive));
    }

    // Areas nest (Training Yard › T1 Pipe Racks › Rack 2); the list and the plan show the same tree.
    let tree = inv.buildTree([]);
    const collapsed = new Set();
    const zoneById = id => tree.byId.get(id);
    const outsideParent = (shape, parentId) => Boolean(parentId && zoneById(parentId) && inv.outlineOutside(shape, zoneById(parentId).shape));

    function renderZones() {
        for (const layer of zoneLayers.values()) layer.remove();
        zoneLayers = new Map();
        tree = inv.buildTree(zones);
        const list = $('zoneList'); list.replaceChildren();
        renderMeta();
        if (!zones.length) list.append(el('li', view && office ? 'No areas yet. Choose Draw area, then click the plan to place each corner.' : 'No areas yet.', 'text-muted'));
        // Parents are drawn first so the areas inside them sit on top and receive clicks.
        if (view) for (const { node } of inv.flattenTree(tree.roots)) {
            const hidden = inv.inactiveAncestor(tree.byId, node.id);
            const polygon = siteMapView.zonePolygon(view, node, hidden ? { dashArray: '4 6', opacity: 0.5, fillOpacity: 0.04 } : {}).addTo(view.map);
            polygon.on('click', event => { if (editor) return; window.L.DomEvent.stopPropagation(event); if (office) editZone(node); });
            zoneLayers.set(node.id, polygon);
        }
        for (const { node, depth, hasChildren } of inv.flattenTree(tree.roots, collapsed)) list.append(zoneRow(node, depth, hasChildren));
    }

    function zoneRow(zone, depth, hasChildren) {
        const hiddenBy = inv.inactiveAncestor(tree.byId, zone.id);
        const row = el('li', '', `zone-row${hiddenBy ? ' is-inactive' : ''}`);
        row.style.setProperty('--depth', depth);
        if (hasChildren) {
            const open = !collapsed.has(zone.id);
            const toggle = button(open ? '▾' : '▸', 'category-toggle', () => { open ? collapsed.add(zone.id) : collapsed.delete(zone.id); renderZones(); }, `${open ? 'Collapse' : 'Expand'} ${zone.name}`);
            toggle.setAttribute('aria-expanded', String(open));
            row.append(toggle);
        } else row.append(el('span', '', 'category-toggle'));
        const swatch = el('span', '', 'zone-swatch'); swatch.style.backgroundColor = zone.color || PALETTE[0];
        const text = el('span', '', 'zone-text');
        text.append(el('span', zone.name, 'zone-name'));
        if (zone.location_id) text.append(el('span', locationLabel(zone.location_id), 'small text-muted'));
        if (zone.is_active === false) text.append(el('span', 'Inactive: hidden from field crews', 'chip chip-muted'));
        else if (hiddenBy) text.append(el('span', `Hidden from field crews: ${hiddenBy.name} is inactive`, 'chip chip-muted'));
        if (outsideParent(zone.shape, zone.parent_id)) text.append(el('span', `Outline goes outside ${zoneById(zone.parent_id).name}`, 'small zone-warning'));
        row.append(swatch, text);
        const actions = el('span', '', 'zone-actions');
        if (view) actions.append(button('Show', 'btn btn-sm btn-ghost', () => view.map.fitBounds(zoneLayers.get(zone.id).getBounds(), { maxZoom: view.map.getZoom() + 2 }), `Show ${zone.name} on the plan`));
        if (office && view) {
            const siblings = zoneById(zone.parent_id)?.children || tree.roots;
            const index = siblings.findIndex(sibling => sibling.id === zone.id);
            const up = button('↑', 'btn btn-sm btn-ghost', () => moveZone(zone, siblings, -1), `Move ${zone.name} up`); up.disabled = index <= 0;
            const down = button('↓', 'btn btn-sm btn-ghost', () => moveZone(zone, siblings, 1), `Move ${zone.name} down`); down.disabled = index >= siblings.length - 1;
            actions.append(
                button('Edit', 'btn btn-sm btn-outline', () => editZone(zone), `Edit ${zone.name}`),
                button('Add area inside…', 'btn btn-sm btn-ghost', () => startDraw(zone), `Draw a new area inside ${zone.name}`),
                up, down,
                button(zone.is_active === false ? 'Make active' : 'Make inactive', 'btn btn-sm btn-ghost', () => toggleZoneActive(zone), `${zone.is_active === false ? 'Make active' : 'Make inactive'}: ${zone.name}`));
        }
        row.append(actions);
        return row;
    }

    async function saveZoneChanges(changes, success, conflict) {
        if (editor) { message('Finish or cancel the area you are drawing first.'); return; }
        if (busy) return;
        busy = true;
        const mapId = current.id;
        try {
            for (const { id, values } of changes) {
                const { error } = await projectSupabaseClient.from('site_map_zones').update(values).eq('id', id);
                if (error) throw error;
            }
        } catch (error) { message(`Could not save: ${inv.errorMessage(error, conflict)}`); return; }
        finally { busy = false; }
        message(success);
        try {
            const data = await fetchZones(mapId);
            if (current?.id === mapId) { zones = data; renderZones(); }
        } catch (error) { message(`${success} The area list could not refresh (${inv.errorMessage(error)}). Reload the page.`); }
    }

    function moveZone(zone, siblings, offset) {
        const updates = inv.reorderSiblings(siblings, zone.id, offset);
        if (updates.length) void saveZoneChanges(updates.map(({ id, sort_order }) => ({ id, values: { sort_order } })), `Moved ${zone.name} ${offset < 0 ? 'up' : 'down'}.`);
    }

    function toggleZoneActive(zone) {
        if (zone.is_active === false) {
            const hiddenBy = inv.inactiveAncestor(tree.byId, zone.parent_id);
            void saveZoneChanges([{ id: zone.id, values: { is_active: true } }],
                hiddenBy ? `${zone.name} is active, but stays hidden from field crews until ${hiddenBy.name} is active.` : `${zone.name} is active.`,
                `Another active area at this level is already named ${zone.name}. Rename one of them first.`);
            return;
        }
        const inside = inv.descendantIds(tree.byId, zone.id).size - 1;
        if (!confirm(`Make ${zone.name} inactive? Field crews will no longer see it${inside ? ` or the ${inside} ${inside === 1 ? 'area' : 'areas'} inside it` : ''}. Items already counted there keep their location.`)) return;
        void saveZoneChanges([{ id: zone.id, values: { is_active: false } }], `${zone.name} is inactive.`);
    }

    // ---- Zone drawing and editing -------------------------------------------------------------
    function handleIcon(className) { return window.L.divIcon({ className, iconSize: className.includes('mid') ? [10, 10] : [14, 14] }); }

    function drawEditor() {
        editor.layers?.remove();
        const L = window.L, latLngs = editor.points.map(view.toLatLng);
        editor.layers = L.layerGroup().addTo(view.map);
        const style = { color: editor.color, weight: 2, fillColor: editor.color, fillOpacity: 0.25 };
        updateOutsideWarning();
        editor.shape = (editor.drawing ? L.polyline(latLngs, { ...style, dashArray: '6 4' }) : L.polygon(latLngs, style)).addTo(editor.layers);
        editor.points.forEach((point, index) => {
            const handle = L.marker(view.toLatLng(point), { icon: handleIcon('zone-handle'), draggable: !editor.drawing, keyboard: false,
                title: editor.drawing ? (index === 0 ? 'Click to finish the zone' : `Point ${index + 1}`) : 'Drag to move. Right-click to remove.' }).addTo(editor.layers);
            if (editor.drawing) { if (index === 0) handle.on('click', finishDraw); return; }
            handle.on('drag', event => { editor.points[index] = view.fromLatLng(event.target.getLatLng()); editor.shape.setLatLngs(editor.points.map(view.toLatLng)); markDirty(); });
            handle.on('dragend', drawEditor);
            handle.on('contextmenu', event => {
                L.DomEvent.preventDefault(event.originalEvent);
                if (editor.points.length <= 3) { editorStatus('An area needs at least three points.'); return; }
                editor.points.splice(index, 1); markDirty(); drawEditor();
            });
        });
        if (!editor.drawing) editor.points.forEach((point, index) => {
            const next = editor.points[(index + 1) % editor.points.length];
            const middle = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
            L.marker(view.toLatLng(middle), { icon: handleIcon('zone-handle zone-handle-mid'), keyboard: false, title: 'Click to add a point here' })
                .on('click', () => { if (editor.points.length >= 200) return; editor.points.splice(index + 1, 0, middle); markDirty(); drawEditor(); })
                .addTo(editor.layers);
        });
        const count = editor.points.length;
        $('drawHint').textContent = editor.drawing
            ? (count < 3 ? `Click the plan to place each corner (${count} placed, at least 3 needed).` : `${count} points. Click the first point or Finish area to close it.`)
            : '';
        $('undoPoint').disabled = !count; $('finishZone').disabled = count < 3;
    }
    const markDirty = () => { if (editor) { editor.dirty = true; window.InvenioUnsavedChanges = true; } };
    const editorStatus = text => { const status = $('zoneEditor').querySelector('[role="status"]'); if (status) status.textContent = text; };
    // A warning, not a block: outlines are hand-drawn and need not sit fully inside their parent.
    function updateOutsideWarning() {
        const warning = $('zoneEditor').querySelector('.zone-warning');
        if (!warning || !editor) return;
        const parent = zoneById(editor.parentId);
        warning.textContent = outsideParent(editor.points, editor.parentId) ? `This outline goes outside ${parent.name}. You can still save it.` : '';
    }

    /** Start drawing a new area, at the top level or inside `parent`. */
    function startDraw(parent = null) {
        if (editor || !view || busy) return;
        editor = { zone: null, parentId: parent?.id || null, points: [], drawing: true, dirty: false, color: PALETTE[zones.length % PALETTE.length] };
        if (parent) { collapsed.delete(parent.id); view.map.fitBounds(zoneLayers.get(parent.id).getBounds(), { maxZoom: view.map.getZoom() + 2 }); }
        view.map.doubleClickZoom.disable();
        $('siteMap').classList.add('is-drawing');
        $('drawBar').hidden = false; $('drawZone').disabled = true;
        drawEditor();
        message(parent ? `Drawing a new area inside ${parent.name}. Press Escape to cancel.` : 'Drawing a new area. Press Escape to cancel.');
    }
    function finishDraw() {
        if (!editor?.drawing || editor.points.length < 3) return;
        editor.drawing = false; editor.dirty = true; window.InvenioUnsavedChanges = true;
        view.map.doubleClickZoom.enable();
        $('siteMap').classList.remove('is-drawing'); $('drawBar').hidden = true;
        drawEditor(); openZoneForm();
        message('Name the new area and save it. You can still drag its points.');
    }
    function editZone(zone) {
        if (busy) return;
        if (editor) { if (editor.zone?.id === zone.id) return; if (editor.dirty && !confirm('Discard the area you are editing?')) return; closeEditor(); }
        editor = { zone, parentId: zone.parent_id || null, points: zone.shape.map(point => [...point]), drawing: false, dirty: false, color: zone.color || PALETTE[0] };
        zoneLayers.get(zone.id)?.remove();
        $('drawZone').disabled = true;
        drawEditor(); openZoneForm();
    }
    function closeEditor() {
        if (!editor) return;
        editor.layers?.remove();
        if (editor.zone && view) zoneLayers.get(editor.zone.id)?.addTo(view.map);
        if (editor.drawing && view) view.map.doubleClickZoom.enable();
        editor = null; window.InvenioUnsavedChanges = false;
        $('siteMap').classList.remove('is-drawing'); $('drawBar').hidden = true;
        $('zoneEditor').hidden = true; $('zoneEditor').replaceChildren(); $('zoneList').hidden = false; $('drawZone').disabled = false;
    }

    function openZoneForm() {
        const zone = editor.zone, panel = $('zoneEditor');
        panel.replaceChildren(); $('zoneList').hidden = true; panel.hidden = false;
        const form = el('form');
        form.append(el('h3', zone ? `Edit ${zone.name}` : 'New area', 'h6'));
        const name = field(form, 'Area name', el('input', '', 'form-control'), 'zoneName');
        name.required = true; name.maxLength = 120; name.autocomplete = 'off'; name.value = zone?.name || '';
        const color = field(form, 'Colour', el('input', '', 'form-control form-control-color'), 'zoneColor');
        color.type = 'color'; color.value = editor.color;
        color.oninput = () => { editor.color = color.value; editor.shape.setStyle({ color: color.value, fillColor: color.value }); markDirty(); };
        const parent = field(form, 'Inside', el('select', '', 'form-select'), 'zoneParent');
        parent.append(new Option('Top level of this plan', ''), ...inv.parentChoices(zones, current.id, zone?.id).map(({ node, depth }) =>
            new Option(`${'\u00a0\u00a0\u00a0'.repeat(depth)}${node.name}${node.is_active === false ? ' (inactive)' : ''}`, node.id)));
        parent.value = editor.parentId || '';
        parent.onchange = () => { editor.parentId = parent.value || null; markDirty(); updateOutsideWarning(); };
        form.append(el('p', '', 'small zone-warning'));
        const location = field(form, 'Rack location (optional)', el('select', '', 'form-select'), 'zoneLocation');
        location.append(new Option('Not linked', ''), ...locations.map(item => new Option(locationLabel(item.id), item.id)));
        if (zone?.location_id && !locations.some(item => item.id === zone.location_id)) location.append(new Option('Linked location (unavailable)', zone.location_id));
        location.value = zone?.location_id || '';
        form.append(el('p', 'Drag a point to move it, click a small midpoint to add one, or right-click a point to remove it. Areas cannot be deleted; make one inactive to hide it from field crews.', 'small text-muted'));
        const actions = el('div', '', 'd-flex gap-2');
        const save = el('button', 'Save area', 'btn btn-primary'); save.type = 'submit';
        actions.append(save, button('Cancel', 'btn btn-ghost', () => { if (!editor.dirty || confirm('Discard changes to this area?')) closeEditor(); }));
        const status = el('p', '', 'small mt-2'); status.setAttribute('role', 'status');
        form.append(actions, status);
        form.oninput = markDirty;
        form.onsubmit = async event => {
            event.preventDefault();
            if (busy) return;
            const values = { name: name.value.trim(), color: color.value, location_id: location.value || null, parent_id: parent.value || null, shape: editor.points };
            if (!values.name) { status.textContent = 'Enter an area name.'; name.focus(); return; }
            if (!inv.validZoneShape(values.shape)) { status.textContent = 'An area needs 3 to 200 points inside the plan.'; return; }
            // A new area, or one moved to another parent, goes to the end of its new siblings.
            const siblings = zones.filter(other => (other.parent_id || null) === values.parent_id && other.id !== zone?.id);
            if (!zone || (zone.parent_id || null) !== values.parent_id) values.sort_order = inv.nextSortOrder(siblings);
            const outside = outsideParent(values.shape, values.parent_id);
            busy = true; save.disabled = true; status.textContent = 'Saving…';
            const mapId = current.id;
            try {
                const query = zone
                    ? projectSupabaseClient.from('site_map_zones').update(values).eq('id', zone.id)
                    : projectSupabaseClient.from('site_map_zones').insert({ ...values, map_id: mapId });
                const { error } = await query;
                if (error) throw error;
            } catch (error) {
                status.textContent = `Could not save: ${inv.errorMessage(error, `Another active area ${values.parent_id ? `inside ${zoneById(values.parent_id)?.name || 'this area'}` : 'at the top level'} is already named ${values.name}.`)}`;
                save.disabled = false;
                return;
            } finally { busy = false; }
            closeEditor();
            const saved = `Saved ${values.parent_id ? inv.pathLabel(tree.byId, values.parent_id) + ' › ' : ''}${values.name}.${outside ? ' Its outline goes outside the area it is in.' : ''}`;
            message(saved);
            if (values.parent_id) collapsed.delete(values.parent_id);
            try {
                const data = await fetchZones(mapId);
                if (current?.id === mapId) { zones = data; renderZones(); }
            } catch (error) { message(`${saved} The area list could not refresh (${inv.errorMessage(error)}). Reload the page.`); }
        };
        panel.append(form);
        updateOutsideWarning();
        setTimeout(() => name.focus());
    }

    // ---- Map records and plan images ----------------------------------------------------------
    async function prepareImage(file) {
        if (!inv.SITE_PLAN_TYPES[file.type]) throw new Error('Choose a PNG, JPG or WEBP image. Export PDF plans to an image first.');
        if (file.size > MAX_SOURCE_BYTES) throw new Error('This image is over 60 MB. Export a smaller copy first.');
        // Load through <img> so photo orientation matches what the map shows later. (image.decode() can
        // stall while the tab is in the background, so wait for the load event instead.)
        const url = URL.createObjectURL(file), image = new Image();
        try {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error('This image could not be read. Try exporting it again as PNG or JPG.'));
                image.src = url;
            });
            const size = inv.fitWithin(image.naturalWidth, image.naturalHeight, 4000);
            const encode = (type, quality) => {
                const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
                const context = canvas.getContext('2d');
                if (type === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height); }
                context.drawImage(image, 0, 0, size.width, size.height);
                return new Promise(resolve => canvas.toBlob(resolve, type, quality));
            };
            let blob = size.scaled ? await encode(file.type, 0.9) : file;
            if (blob && blob.size > MAX_UPLOAD_BYTES) blob = await encode('image/jpeg', 0.85);
            if (!blob || !inv.SITE_PLAN_TYPES[blob.type]) throw new Error('This browser could not prepare the image. Try a JPG.');
            if (blob.size > MAX_UPLOAD_BYTES) throw new Error('The image is still over 15 MB after resizing. Export a smaller copy.');
            return { blob, type: blob.type, width: size.width, height: size.height, scaled: size.scaled };
        } finally { URL.revokeObjectURL(url); }
    }

    async function uploadPlan(map, prepared) {
        const path = inv.sitePlanPath(projectId, map.id, prepared.type);
        const { error: uploadError } = await supabaseClient.storage.from('site-plans').upload(path, prepared.blob, { contentType: prepared.type, upsert: true, cacheControl: '60' });
        if (uploadError) throw uploadError;
        // The new image is live from here; until the size is saved, zones and pins would stretch. Retry once.
        const saveSize = () => projectSupabaseClient.from('site_maps').update({ storage_path: path, image_width: prepared.width, image_height: prepared.height }).eq('id', map.id);
        let { error } = await saveSize();
        if (error) ({ error } = await saveSize());
        if (error) throw new Error(`The image was uploaded, but the map was not updated (${inv.errorMessage(error)}). Upload it again so zones line up.`);
    }

    function openMapForm(mode) {
        const map = mode === 'new' ? null : current;
        const content = $('mapDialogContent'); content.replaceChildren();
        const header = el('div', '', 'work-page-header');
        const heading = el('h2', mode === 'new' ? 'New site map' : mode === 'rename' ? `Rename ${map.name}` : `${map.storage_path ? 'Replace' : 'Upload'} the plan for ${map.name}`);
        heading.id = 'mapDialogTitle';
        header.append(heading, button('Close', 'btn btn-outline-secondary', () => { if (!busy) dialog.close(); }));
        const form = el('form');
        let name, file;
        if (mode !== 'image') {
            name = field(form, 'Map name', el('input', '', 'form-control'), 'mapName');
            name.required = true; name.maxLength = 120; name.autocomplete = 'off'; name.value = map?.name || '';
        }
        if (mode !== 'rename') {
            file = field(form, 'Plan image', el('input', '', 'form-control'), 'mapFile');
            file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.required = true;
            form.append(el('p', 'PNG, JPG or WEBP. Large plans are resized in your browser to 4000 px on the long side before upload.', 'small text-muted'));
            if (map?.storage_path) form.append(el('p', 'Zones are stored relative to the image. Use a plan with the same framing so they stay in place.', 'small text-muted'));
        }
        const save = el('button', mode === 'new' ? 'Create map' : mode === 'rename' ? 'Save name' : 'Upload', 'btn btn-primary'); save.type = 'submit';
        const status = el('p', '', 'small mt-2'); status.setAttribute('role', 'status');
        form.append(save, status);
        form.onsubmit = async event => {
            event.preventDefault();
            if (busy) return;
            const newName = name?.value.trim();
            if (name && !newName) { status.textContent = 'Enter a map name.'; return; }
            busy = true; save.disabled = true;
            let target = map, prepared = null, reason = null;
            try {
                if (file) {
                    if (!file.files[0]) throw new Error('Choose an image.');
                    status.textContent = 'Preparing image…';
                    prepared = await prepareImage(file.files[0]);
                    if (map?.image_width && zones.length) {
                        const before = map.image_width / map.image_height, after = prepared.width / prepared.height;
                        if (Math.abs(after - before) / before > 0.01 && !confirm('This image has a different shape from the current plan, so existing zones will stretch. Upload it anyway?')) throw new Error('Upload cancelled.');
                    }
                }
                status.textContent = 'Saving…';
                if (mode === 'new') {
                    const { data, error } = await projectSupabaseClient.from('site_maps').insert({ name: newName, is_active: true }).select('*').single();
                    if (error) throw error;
                    target = data;
                } else if (mode === 'rename') {
                    const { error } = await projectSupabaseClient.from('site_maps').update({ name: newName }).eq('id', map.id);
                    if (error) throw error;
                }
                if (prepared) { status.textContent = 'Uploading image…'; await uploadPlan(target, prepared); }
            } catch (error) {
                reason = error.message === 'Upload cancelled.' ? error.message : `Could not save: ${inv.errorMessage(error)}`;
            } finally { busy = false; save.disabled = false; }
            // A new map whose image failed still exists; show it so a retry uploads to it rather than creating another map.
            if (reason && !(mode === 'new' && target)) { status.textContent = reason; return; }
            dialog.close();
            try { await loadMaps(); renderMapSelect(); await showMap(target.id); }
            catch (error) { message(`Saved, but the page could not refresh (${inv.errorMessage(error)}). Reload the page.`); return; }
            message(reason ? `Created ${target.name}, but the image was not saved. ${reason} Choose Upload image to try again.`
                : mode === 'rename' ? `Renamed to ${newName}.` : `Saved ${target.name}${prepared?.scaled ? `, resized to ${prepared.width} × ${prepared.height} px` : ''}.`);
        };
        content.append(header, form);
        dialog.showModal();
    }

    async function toggleActive() {
        if (busy) return;
        const next = !current.is_active;
        if (!next && !confirm(`Make ${current.name} inactive? Field crews will no longer see it when they count.`)) return;
        busy = true;
        try {
            const { error } = await projectSupabaseClient.from('site_maps').update({ is_active: next }).eq('id', current.id);
            if (error) throw error;
            const id = current.id; await loadMaps(); renderMapSelect();
            current = maps.find(map => map.id === id); $('mapSelect').value = id; renderMapActions(); renderZones();
            message(`${current.name} is now ${next ? 'active' : 'inactive'}.`);
        } catch (error) { message(`Could not save: ${inv.errorMessage(error)}`); }
        finally { busy = false; }
    }

    $('newMap').onclick = () => openMapForm('new');
    $('mapSelect').onchange = () => { void showMap($('mapSelect').value).catch(error => message(error.message)); };
    $('drawZone').onclick = () => startDraw();
    $('finishZone').onclick = finishDraw;
    $('undoPoint').onclick = () => { if (editor?.drawing) { editor.points.pop(); drawEditor(); } };
    $('cancelDraw').onclick = () => { closeEditor(); message('Drawing cancelled.'); };
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && editor?.drawing && !dialog.open) { closeEditor(); message('Drawing cancelled.'); } });
    window.addEventListener('beforeunload', event => { if (editor?.dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
    if (!office) message(InvenioProjectScope.activeProject.status === 'active' ? 'Office staff manage site maps. You can view plans and zones.' : 'This project is read-only.');
    try {
        await Promise.all([loadMaps(), loadLocations()]);
        renderMapSelect();
        if (maps.length) await showMap(new URLSearchParams(location.search).get('map'));
    } catch (error) { message(`Could not load site maps: ${inv.errorMessage(error)}`); }
})().catch(error => { const message = document.getElementById('pageMessage'); if (message) message.textContent = error.message; });

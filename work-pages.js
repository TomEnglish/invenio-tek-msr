(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const projectId = InvenioProjectScope.getActiveProjectId();
    const profile = InvenioCurrentProfile;
    const office = ['office_staff', 'admin'].includes(profile.role) && InvenioProjectScope.activeProject.status === 'active';
    const message = text => { $('pageMessage').textContent = text; };
    function el(tag, text = '', className = '') {
        const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    function recordLink(table, record, label) {
        const link = el('a', label); link.href = `record.html?type=${encodeURIComponent(table)}&id=${encodeURIComponent(record.id)}`; return link;
    }
    const recordTypes = {
        materials: { label: 'Materials', fields: 'material_type,size,grade,spec', title: r => `${r.material_type} · ${r.current_quantity} available` },
        receiving_records: { label: 'Receiving', fields: 'material_type,po_number,vendor,delivery_ticket', title: r => `${r.material_type} · ${r.po_number || r.status}` },
        purchase_orders: { label: 'Purchase orders', fields: 'purchase_order_id,item_description,supplier', title: r => `${r.purchase_order_id || 'PO'} · ${r.item_description || r.supplier || ''}` },
        shipments: { label: 'Shipments', fields: 'shipment_number,po_number,supplier,part_description', title: r => `${r.shipment_number || 'Shipment'} · ${r.supplier || r.status || ''}` },
        qr_codes: { label: 'QR codes', fields: 'code_value', title: r => r.code_value },
    };
    if ($('recordSearch')) {
        const query = new URLSearchParams(location.search).get('q') || '';
        $('searchQuery').value = query;
        let requestId = 0;
        async function search(raw) {
            const thisRequest = ++requestId;
            const safe = raw.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').trim().slice(0,100);
            $('searchResults').replaceChildren();
            if (safe.length < 2) { message('Enter at least two letters or numbers.'); return; }
            message('Searching this project...');
            const results = await Promise.all(Object.entries(recordTypes).map(async ([table, config]) => {
                const { data, error } = await projectSupabaseClient.from(table).select('*').or(config.fields.split(',').map(field => `${field}.ilike.%${safe}%`).join(',')).limit(21);
                return { table, config, data: data || [], error };
            }));
            if (thisRequest !== requestId) return;
            let count = 0;
            for (const { table, config, data, error } of results) {
                const section = el('section', '', 'border-bottom py-3'); section.append(el('h2', config.label, 'h5'));
                if (error) section.append(el('p', `Could not load ${config.label.toLowerCase()}. Retry your search.`, 'text-danger'));
                else if (!data.length) section.append(el('p', 'No matching records.', 'text-muted'));
                for (const record of data.slice(0,20)) {
                    const row = el('div', '', 'py-2'); row.append(recordLink(table, record, config.title(record))); section.append(row); count++;
                }
                if (data.length > 20) section.append(el('p', 'Showing the first 20 matches. Narrow your search for more specific results.', 'small text-muted'));
                $('searchResults').append(section);
            }
            message(`${count} matching records shown in ${InvenioProjectScope.activeProject.name}.`);
        }
        $('recordSearch').onsubmit = event => { event.preventDefault(); history.replaceState(null, '', `search.html?q=${encodeURIComponent($('searchQuery').value)}`); void search($('searchQuery').value).catch(e => message(e.message)); };
        if (query) await search(query);
    }
    if ($('recordDetails')) {
        const params = new URLSearchParams(location.search), table = params.get('type'), id = params.get('id');
        if (!recordTypes[table] || !id || !/^[a-z0-9-]+$/i.test(id)) { message('Invalid record link.'); return; }
        const { data: record, error } = await projectSupabaseClient.from(table).select('*').eq('id', id).maybeSingle();
        if (error || !record) { message('This record is unavailable in the selected project.'); return; }
        $('recordTitle').textContent = recordTypes[table].title(record);
        $('recordKind').textContent = recordTypes[table].label;
        $('recordSubtitle').textContent = `${InvenioProjectScope.activeProject.name}${record.status ? ` · ${String(record.status).replaceAll('_', ' ')}` : ''}`;
        let locationName = record.location_id ? 'Location unavailable' : null;
        if (record.location_id) {
            const { data } = await projectSupabaseClient.from('locations').select('zone,row,rack').eq('id', record.location_id).maybeSingle();
            if (data) locationName = `${data.zone} · Row ${data.row}, Rack ${data.rack}`;
        }
        let ownerName = record.exception_owner_id ? 'Assigned; name unavailable' : 'Unassigned';
        if (record.has_exception && record.exception_owner_id) {
            const { data } = await supabaseClient.rpc('project_staff', { p_project_id: projectId });
            ownerName = (data || []).find(s => s.id === record.exception_owner_id)?.full_name || ownerName;
        }
        const groups = [
            ['Material & purchase order', { material_type:'Material', size:'Size', grade:'Grade', spec:'Specification', description:'Description', po_number:'Purchase order', purchase_order_id:'Purchase order', po_description:'PO description', item_description:'Item description', vendor:'Vendor', supplier:'Supplier', code_value:'QR code', entity_type:'Label type' }],
            ['Quantities', { qty:'Delivered', accepted_qty:'Accepted', current_quantity:'Available', ordered_quantity:'Ordered', num_pieces:'Pieces', weight:'Weight', base_uom:'Unit' }],
            ['Delivery & location', { shipment_number:'Shipment', part_description:'Part description', delivery_ticket:'Delivery ticket', carrier:'Carrier', eta:'Recorded ETA', delivery_date:'Delivery date', location_name:'Storage location' }],
            ['Inspection', { condition:'Condition', inspection_pass:'Inspection passed', damage_notes:'Inspection notes' }],
            ['Decisions & record history', { has_exception:'Exception flagged', exception_type:'Exception', exception_owner_name:'Owner', exception_due_date:'Decision due', exception_resolved:'Exception closed', exception_resolution:'Decision', exception_notes:'Decision notes', created_at:'Recorded', updated_at:'Last updated' }],
        ];
        const values = { ...record, location_name:locationName, exception_owner_name:record.has_exception ? ownerName : null };
        for (const [title, fields] of groups) {
            const section = el('section', '', 'record-section'), list = el('dl', '', 'record-fields');
            for (const [field, label] of Object.entries(fields)) {
                const value = values[field];
                if (value === null || value === undefined || value === '') continue;
                const formatted = field === 'exception_type' ? InvenioWorkSummary.exceptionLabel(value) : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : ['created_at','updated_at'].includes(field) ? new Date(value).toLocaleString() : String(value).replaceAll('_', ' ');
                const pair = el('div'); pair.append(el('dt',label),el('dd',formatted)); list.append(pair);
            }
            if (list.children.length) { section.append(el('h2',title),list); $('recordDetails').append(section); }
        }
        function related(table, id, label) {
            if (!id) return;
            const link = recordLink(table, {id}, label); link.className = 'btn btn-outline-primary'; $('recordActions').append(link);
        }
        if (table === 'qr_codes') {
            const { data: materials, error: materialError } = await projectSupabaseClient.from('materials').select('id,receiving_record_id').eq('qr_code_id', record.id).limit(1);
            const material = materials?.[0];
            if (material) {
                related('materials', material.id, 'View yard inventory');
                related('receiving_records', material.receiving_record_id, 'View receiving record');
            } else {
                const { data: receipts, error: receiptError } = await projectSupabaseClient.from('receiving_records').select('id').eq('qr_code_id', record.id).order('created_at', {ascending:false}).limit(1);
                if (receipts?.[0]) related('receiving_records', receipts[0].id, 'View receiving record');
                if (materialError || receiptError) message('Linked records could not be fully loaded. Refresh to retry.');
            }
        }
        if (table === 'materials') related('receiving_records', record.receiving_record_id, 'View receiving record');
        if (table === 'receiving_records' && record.has_exception) {
            const link = el('a', office ? 'Review exception' : 'View exception', 'btn btn-primary');
            link.href = `work-inbox.html?filter=all&record=${encodeURIComponent(record.id)}`; $('recordActions').append(link);
        }
        if (table === 'receiving_records') {
            const { data: photos, error: photoError } = await supabaseClient.from('inspection_photos').select('storage_path,photo_type').eq('receiving_record_id', id);
            $('photoSection').hidden = false;
            if (photoError) message('Photo references could not be loaded. Refresh to retry.');
            else if (!photos?.length) $('recordPhotos').append(el('p', 'No inspection photos attached.', 'text-muted mb-0'));
            for (const photo of photos || []) {
                const { data, error: signError } = await supabaseClient.storage.from('inspection-photos').createSignedUrl(photo.storage_path, 300);
                if (signError) { message('Some photos are unavailable. Refresh to retry.'); continue; }
                const img = el('img'); img.src = data.signedUrl; img.alt = photo.photo_type.replaceAll('_', ' '); img.loading = 'lazy'; img.className = 'record-photo'; $('recordPhotos').append(img);
            }
        }
    }
    if ($('inboxEntries')) {
        let offset = 0, busy = false, staff = [], staffUnavailable = false, operationIds = new Map();
        const requestedFilter = new URLSearchParams(location.search).get('filter');
        if (InvenioWorkSummary.filters.includes(requestedFilter)) $('inboxFilter').value = requestedFilter;
        {
            const result = await supabaseClient.rpc('project_staff', { p_project_id: projectId });
            if (result.error) { staffUnavailable = true; $('staffMessage').hidden = false; }
            else staff = result.data || [];
        }
        async function load(append = false) {
            if (busy) return;
            busy = true; $('inboxMore').disabled = true; $('inboxFilter').disabled = true;
            if (!append) { offset = 0; $('inboxEntries').replaceChildren(); }
            try {
                const filter = $('inboxFilter').value;
                const query = InvenioWorkSummary.applyInboxFilter(
                    projectSupabaseClient.from('receiving_records').select('*'), filter, profile.id)
                    .order('created_at', { ascending: false }).order('id').range(offset, offset + 24);
                const { data, error } = await query;
                if (error) throw error;
                for (const record of data) render(record);
                offset += data.length;
                $('inboxMore').hidden = data.length < 25;
                message(offset ? `${offset} exceptions shown.` : 'No exceptions match this view.');
            } catch (error) { message(`Could not load exceptions: ${error.message}`); }
            finally { busy = false; $('inboxMore').disabled = false; $('inboxFilter').disabled = false; }
        }
        const dialog = $('exceptionReview');
        let dirty = false, saving = false;
        function closeReview() {
            if (saving || (dirty && !confirm('Discard unsaved decision changes?'))) return;
            dirty = false; window.InvenioUnsavedChanges = false; dialog.close();
        }
        dialog.addEventListener('cancel', event => { event.preventDefault(); closeReview(); });
        window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
        function ownerName(record) { return staff.find(s => s.id === record.exception_owner_id)?.full_name || (record.exception_owner_id ? 'Assigned' : 'Unassigned'); }
        function stateLabel(record) { return record.exception_resolved ? 'Closed' : record.exception_resolution === 'hold' ? 'On hold' : 'Open'; }
        function render(record) {
            const card = el('article', '', 'inbox-row');
            const identity = el('div', '', 'inbox-identity');
            identity.append(el('h2', record.material_type || 'Receiving record'), el('p', `${InvenioWorkSummary.exceptionLabel(record.exception_type)} · ${InvenioWorkSummary.poLabel(record.po_number)} · ${record.vendor || 'Vendor not recorded'}`, 'mb-0 text-muted'));
            const ownership = el('div', '', 'inbox-owner');
            ownership.append(el('span', 'Owner', 'eyebrow'), el('span', ownerName(record)));
            const deadline = el('div', '', 'inbox-due');
            const overdue = !record.exception_resolved && InvenioWorkSummary.validDate(record.exception_due_date) && record.exception_due_date < InvenioWorkSummary.localDate();
            deadline.append(el('span', 'Due date', 'eyebrow'), el('span', record.exception_due_date || 'Not set'), ...(overdue ? [el('span', 'Overdue', 'work-badge work-badge-warning')] : []));
            const status = el('span', stateLabel(record), 'work-badge');
            const review = el('button', 'Review', 'btn btn-outline-primary'); review.type = 'button'; review.setAttribute('aria-label', `Review ${record.material_type || 'receiving record'} · ${InvenioWorkSummary.poLabel(record.po_number)}`); review.onclick = () => openReview(record);
            card.append(identity, ownership, deadline, status, review); $('inboxEntries').append(card);
        }
        function openReview(record) {
            const content = $('reviewContent'); content.replaceChildren(); dirty = false;
            const header = el('div', '', 'work-page-header');
            const title = el('h2', record.material_type || 'Receiving record'); title.id = 'reviewTitle';
            const close = el('button', 'Close', 'btn btn-outline-secondary'); close.type = 'button'; close.autofocus = true; close.onclick = closeReview;
            header.append(title, close); content.append(header);
            content.append(el('p', `${InvenioWorkSummary.exceptionLabel(record.exception_type)} · ${stateLabel(record)}`, 'work-badge'));
            content.append(el('p', `${InvenioWorkSummary.poLabel(record.po_number)} · ${record.vendor || 'Vendor not recorded'}`, 'text-muted'));
            if (record.damage_notes) { content.append(el('h3','Inspection notes','h6'), el('p',record.damage_notes)); }
            if (record.exception_notes) { content.append(el('h3','Last decision notes','h6'), el('p',record.exception_notes)); }
            const fullRecord = recordLink('receiving_records', record, 'View full record & photos');
            fullRecord.onclick = event => { if (dirty && !confirm('Leave without saving these decision changes?')) event.preventDefault(); else { dirty=false; window.InvenioUnsavedChanges=false; } };
            content.append(fullRecord);
            if (office) {
                const form = el('form', '', 'mt-4');
                const fields = el('fieldset', '', 'row g-3'); form.append(fields);
                fields.append(el('legend', 'Next decision', 'h5'));
                const field = (label, control) => {
                    control.id = `review-${label.replaceAll(' ', '-')}`;
                    const wrap = el('div', '', 'col-12'); const text = el('label', label, 'form-label'); text.htmlFor = control.id; wrap.append(text, control); fields.append(wrap); return control;
                };
                const owner = field('Owner', el('select', '', 'form-select'));
                owner.append(new Option('Unassigned', ''), ...staff.map(s => new Option(s.full_name, s.id)));
                if (record.exception_owner_id && !staff.some(s => s.id === record.exception_owner_id)) owner.append(new Option('Currently assigned (not available for new assignments)', record.exception_owner_id));
                owner.value = record.exception_owner_id || '';
                owner.disabled = staffUnavailable;
                if (staffUnavailable) { const warning = el('p', 'Owner choices are unavailable. The current assignment will be kept. Reload this page to retry.', 'small source-warning'); fields.append(warning); }
                const due = field('Due date', el('input', '', 'form-control')); due.type = 'date'; due.value = record.exception_due_date || '';
                const resolution = field('Decision', el('select', '', 'form-select'));
                resolution.append(new Option('Hold — keep open', 'hold'), new Option('Returned to vendor — close', 'return_to_vendor'), new Option('Released — close', 'released'));
                resolution.value = record.exception_resolution || 'hold';
                const notes = field('Decision notes', el('textarea', record.exception_notes || '', 'form-control')); notes.maxLength = 2000; notes.rows = 4;
                fields.append(el('p', 'Saving Hold keeps this exception open. Returning or releasing it closes the exception.', 'small text-muted'));
                const footer = el('div', '', 'col-12'); const save = el('button', 'Save decision', 'btn btn-primary'); save.type = 'submit'; footer.append(save); fields.append(footer);
                const status = el('p', '', 'small mt-2'); status.setAttribute('role','status'); form.append(status);
                form.oninput = () => { dirty=true; window.InvenioUnsavedChanges=true; };
                form.onchange = form.oninput;
                form.onsubmit = async event => {
                    event.preventDefault(); if (saving) return;
                    saving=true; fields.disabled=true; close.disabled=true; status.textContent='Saving decision…';
                    const payload = { id: record.id, ownerId: owner.value || null, dueDate: due.value || null, resolution: resolution.value, notes: notes.value };
                    const key = JSON.stringify(payload); if (!operationIds.has(key)) operationIds.set(key, crypto.randomUUID());
                    try {
                        const { error } = await supabaseClient.rpc('apply_field_operation', { p_operation_id: operationIds.get(key), p_project_id: projectId, p_action: 'exception', p_payload: payload });
                        if (error) throw error;
                        operationIds.delete(key); dirty=false; window.InvenioUnsavedChanges=false; dialog.close(); await load();
                        message(`Decision saved for ${record.material_type || 'receiving record'}. ${$('pageMessage').textContent}`); $('pageMessage').focus();
                    } catch (error) { status.textContent = `Could not save: ${error.message}. Your changes are still here.`; }
                    finally { saving=false; fields.disabled=false; close.disabled=false; }
                };
                content.append(form);
            } else content.append(el('p', `Owner: ${ownerName(record)} · Due: ${record.exception_due_date || 'Not set'}. ${InvenioProjectScope.activeProject.status === 'active' ? 'Office staff manage exception decisions.' : 'This project is read-only.'}`, 'mt-4 text-muted'));
            dialog.showModal();
        }
        $('inboxFilter').onchange = () => { history.replaceState(null, '', `work-inbox.html?filter=${encodeURIComponent($('inboxFilter').value)}`); void load(); }; $('inboxMore').onclick = () => load(true); await load();
        const target = new URLSearchParams(location.search).get('record');
        if (target && /^[a-z0-9-]+$/i.test(target)) {
            const { data, error } = await projectSupabaseClient.from('receiving_records').select('*').eq('id', target).eq('has_exception', true).maybeSingle();
            if (error || !data) message('This exception is unavailable in the selected project.');
            else openReview(data);
        }
    }
})().catch(error => { const message = document.getElementById('pageMessage'); if (message) message.textContent = error.message; });

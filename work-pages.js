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
        const fields = {
            material_type: 'Material', qty: 'Delivered quantity', accepted_qty: 'Accepted quantity', current_quantity: 'Available quantity',
            size: 'Size', grade: 'Grade', weight: 'Weight', spec: 'Specification', description: 'Description', status: 'Status',
            code_value: 'QR code', entity_type: 'Label type', po_number: 'Purchase order', purchase_order_id: 'Purchase order',
            po_description: 'PO description', item_description: 'Item description', ordered_quantity: 'Ordered quantity', base_uom: 'Unit',
            vendor: 'Vendor', supplier: 'Supplier', shipment_number: 'Shipment', part_description: 'Part description', num_pieces: 'Pieces',
            delivery_ticket: 'Delivery ticket', carrier: 'Carrier', eta: 'Expected arrival', delivery_date: 'Delivery date',
            condition: 'Condition', damage_notes: 'Inspection notes', inspection_pass: 'Inspection passed', has_exception: 'Exception flagged',
            exception_resolved: 'Exception closed', exception_resolution: 'Exception decision', exception_due_date: 'Decision due', exception_notes: 'Decision notes',
            created_at: 'Recorded',
        };
        for (const [field, label] of Object.entries(fields)) {
            const value = record[field];
            if (value === null || value === undefined || value === '') continue;
            const formatted = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : field === 'created_at' ? new Date(value).toLocaleString() : String(value).replaceAll('_', ' ');
            $('recordDetails').append(el('dt', label, 'col-sm-4'), el('dd', formatted, 'col-sm-8 text-break'));
        }
        if (table === 'qr_codes' && record.entity_id) $('recordDetails').append(recordLink('receiving_records', { id: record.entity_id }, 'View receiving record'));
        if (table === 'materials') $('recordDetails').append(recordLink('receiving_records', { id: record.receiving_record_id }, 'View receiving record'));
        if (table === 'receiving_records') {
            const { data: photos, error: photoError } = await supabaseClient.from('inspection_photos').select('storage_path,photo_type').eq('receiving_record_id', id);
            if (photoError) message('Photo references could not be loaded.');
            for (const photo of photos || []) {
                const { data, error: signError } = await supabaseClient.storage.from('inspection-photos').createSignedUrl(photo.storage_path, 300);
                if (signError) { message('Some photos are unavailable. Refresh to retry.'); continue; }
                const img = el('img'); img.src = data.signedUrl; img.alt = photo.photo_type.replaceAll('_', ' '); img.loading = 'lazy'; img.style.cssText = 'max-width:100%;width:320px;object-fit:contain'; $('recordPhotos').append(img);
            }
        }
    }
    if ($('inboxEntries')) {
        let offset = 0, busy = false, staff = [], operationIds = new Map();
        if (office) {
            const result = await supabaseClient.rpc('project_staff', { p_project_id: projectId });
            if (result.error) message('Staff choices could not be loaded; refresh to retry.');
            else staff = result.data || [];
        }
        async function load(append = false) {
            if (busy) return;
            busy = true; $('inboxMore').disabled = true;
            if (!append) { offset = 0; $('inboxEntries').replaceChildren(); }
            try {
                let query = projectSupabaseClient.from('receiving_records').select('*').eq('has_exception', true).order('created_at', { ascending: false }).range(offset, offset + 24);
                const filter = $('inboxFilter').value;
                if (filter !== 'all') query = query.eq('exception_resolved', false);
                if (filter === 'mine') query = query.eq('exception_owner_id', profile.id);
                if (filter === 'overdue') query = query.lt('exception_due_date', new Date().toLocaleDateString('en-CA'));
                const { data, error } = await query;
                if (error) throw error;
                for (const record of data) render(record);
                offset += data.length;
                $('inboxMore').hidden = data.length < 25;
                message(offset ? `${offset} exceptions shown.` : 'No exceptions match this view.');
            } catch (error) { message(`Could not load exceptions: ${error.message}`); }
            finally { busy = false; $('inboxMore').disabled = false; }
        }
        function render(record) {
            const card = el('article', '', 'border-bottom py-4');
            const heading = el('h2', '', 'h5'); heading.append(recordLink('receiving_records', record, `${record.material_type} · ${record.exception_type || 'Inspection exception'}`)); card.append(heading);
            card.append(el('p', `${record.exception_resolved ? 'Closed' : record.exception_resolution === 'hold' ? 'On hold · open' : 'Open'} · ${record.vendor || 'No vendor'} · PO ${record.po_number || 'unspecified'}`, 'text-muted'));
            if (record.damage_notes) card.append(el('p', record.damage_notes));
            if (record.exception_notes) card.append(el('p', record.exception_notes));
            card.append(el('p', `Owner: ${staff.find(s => s.id === record.exception_owner_id)?.full_name || (record.exception_owner_id ? 'Assigned' : 'Unassigned')} · Due: ${record.exception_due_date || 'Not set'}`, 'small'));
            if (office) {
                const form = el('form', '', 'row g-3');
                const field = (label, control) => {
                    control.id = `${record.id}-${label.replaceAll(' ', '-')}`;
                    const wrap = el('div', '', 'col-12 col-md-6'); const text = el('label', label, 'form-label'); text.htmlFor = control.id; wrap.append(text, control); form.append(wrap); return control;
                };
                const owner = field('Owner', el('select', '', 'form-select'));
                owner.append(new Option('Unassigned', ''), ...staff.map(s => new Option(s.full_name, s.id))); owner.value = record.exception_owner_id || '';
                const due = field('Due date', el('input', '', 'form-control')); due.type = 'date'; due.value = record.exception_due_date || '';
                const resolution = field('Decision', el('select', '', 'form-select'));
                resolution.append(new Option('Hold — keep open', 'hold'), new Option('Returned to vendor — close', 'return_to_vendor'), new Option('Released — close', 'released'));
                resolution.value = record.exception_resolution || 'hold';
                const notes = field('Decision notes', el('textarea', record.exception_notes || '', 'form-control')); notes.maxLength = 2000;
                const footer = el('div', '', 'col-12'); const save = el('button', 'Save decision', 'btn btn-primary'); footer.append(save); form.append(footer);
                const status = el('p', '', 'small'); status.setAttribute('role','status'); form.append(status);
                form.onsubmit = async event => {
                    event.preventDefault(); save.disabled = true;
                    const payload = { id: record.id, ownerId: owner.value || null, dueDate: due.value || null, resolution: resolution.value, notes: notes.value };
                    const key = JSON.stringify(payload); if (!operationIds.has(key)) operationIds.set(key, crypto.randomUUID());
                    try {
                        const { error } = await supabaseClient.rpc('apply_field_operation', { p_operation_id: operationIds.get(key), p_project_id: projectId, p_action: 'exception', p_payload: payload });
                        if (error) throw error;
                        operationIds.delete(key); window.InvenioUnsavedChanges = false; await load();
                    } catch (error) { status.textContent = error.message; }
                    finally { save.disabled = false; }
                };
                card.append(form);
            }
            $('inboxEntries').append(card);
        }
        $('inboxFilter').onchange = () => load(); $('inboxMore').onclick = () => load(true); await load();
    }
})().catch(error => { const message = document.getElementById('pageMessage'); if (message) message.textContent = error.message; });

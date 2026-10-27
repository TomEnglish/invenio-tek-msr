(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const inv = InvenioInventory;
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

    let categories = [], itemCounts = new Map(), proposers = new Map(), busy = false;
    const collapsed = new Set();
    const dialog = $('categoryDialog');
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

    async function load() {
        const [rows, items] = await Promise.all([
            fetchAll('inventory_categories', 'id,parent_id,name,status,sort_order,proposed_by,created_at'),
            fetchAll('inventory_records', 'id,category_id'),
        ]);
        categories = rows;
        itemCounts = new Map();
        for (const item of items) if (item.category_id) itemCounts.set(item.category_id, (itemCounts.get(item.category_id) || 0) + 1);
        const ids = [...new Set(rows.map(row => row.proposed_by).filter(id => id && !proposers.has(id)))];
        if (ids.length) {
            const { data } = await supabaseClient.from('users').select('id,full_name').in('id', ids);
            for (const user of data || []) proposers.set(user.id, user.full_name);
        }
        render();
    }

    const allById = () => new Map(categories.map(category => [category.id, category]));
    const pathText = id => inv.categoryPath(allById(), id).join(' › ');
    const itemsLabel = count => `${count} ${count === 1 ? 'item' : 'items'}`;

    function render() {
        const active = inv.buildCategoryTree(categories);
        const view = inv.buildCategoryTree(categories, { includeArchived: $('showArchived').checked });
        renderProposals(active);
        const list = $('categoryTree'); list.replaceChildren();
        const rows = inv.flattenTree(view.roots, collapsed);
        if (!rows.length) list.append(el('li', office ? 'No categories yet. Add a top-level category, or import expected tags with category paths on the Initial Inventory page.' : 'No categories yet.', 'text-muted'));
        for (const { node, depth, hasChildren } of rows) {
            const row = el('li', '', `category-row${node.status === 'archived' ? ' is-archived' : ''}`);
            row.style.setProperty('--depth', depth);
            if (hasChildren) {
                const open = !collapsed.has(node.id);
                const toggle = button(open ? '▾' : '▸', 'category-toggle', () => { open ? collapsed.add(node.id) : collapsed.delete(node.id); render(); }, `${open ? 'Collapse' : 'Expand'} ${node.name}`);
                toggle.setAttribute('aria-expanded', String(open));
                row.append(toggle);
            } else row.append(el('span', '', 'category-toggle'));
            const label = el('span', '', 'category-label');
            label.append(el('span', node.name, 'category-name'));
            if (node.status !== 'active') label.append(el('span', node.status === 'proposed' ? 'Proposed' : 'Archived', `chip ${node.status === 'proposed' ? 'chip-warn' : 'chip-muted'}`));
            const count = itemCounts.get(node.id) || 0;
            if (count) label.append(el('span', itemsLabel(count), 'small text-muted'));
            row.append(label);
            if (office) row.append(rowActions(node, active));
            list.append(row);
        }
        $('addRootCategory').hidden = !office;
    }

    function rowActions(node, active) {
        const actions = el('span', '', 'category-actions');
        if (node.status === 'archived') {
            actions.append(button('Restore', 'btn btn-sm btn-ghost', () => restore(node), `Restore ${node.name}`));
            return actions;
        }
        const siblings = active.byId.get(node.parent_id)?.children || active.roots;
        const index = siblings.findIndex(sibling => sibling.id === node.id);
        const up = button('↑', 'btn btn-sm btn-ghost', () => move(node, siblings, -1), `Move ${node.name} up`); up.disabled = index <= 0;
        const down = button('↓', 'btn btn-sm btn-ghost', () => move(node, siblings, 1), `Move ${node.name} down`); down.disabled = index < 0 || index >= siblings.length - 1;
        actions.append(
            button('Add subcategory', 'btn btn-sm btn-ghost', () => openNameForm({ parent: node }), `Add a subcategory under ${node.name}`),
            button('Rename', 'btn btn-sm btn-ghost', () => openNameForm({ category: node }), `Rename ${node.name}`),
            up, down,
            button('Merge…', 'btn btn-sm btn-ghost', () => openMergeForm(node, active), `Merge ${node.name} into another category`),
            button('Archive', 'btn btn-sm btn-ghost', () => archive(node, active), `Archive ${node.name}`));
        return actions;
    }

    function renderProposals(active) {
        const proposals = categories.filter(category => category.status === 'proposed')
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        $('proposedCount').textContent = String(proposals.length);
        $('proposedCount').className = `chip ${proposals.length ? 'chip-warn' : 'chip-muted'}`;
        const list = $('proposedList'); list.replaceChildren();
        if (!proposals.length) { list.append(el('p', 'No proposals waiting.', 'text-muted mb-0')); return; }
        for (const proposal of proposals) {
            const row = el('article', '', 'proposal-row');
            const identity = el('div', '', 'proposal-identity');
            identity.append(el('h3', proposal.name, 'h6 mb-1'));
            const parent = proposal.parent_id ? `Under ${pathText(proposal.parent_id)}` : 'At the top level';
            const count = itemCounts.get(proposal.id) || 0;
            const when = proposal.created_at ? new Date(proposal.created_at).toLocaleDateString() : '';
            identity.append(el('p', [parent, `Proposed by ${proposers.get(proposal.proposed_by) || 'a field user'}${when ? ` on ${when}` : ''}`, itemsLabel(count)].join(' · '), 'small text-muted mb-0'));
            row.append(identity);
            if (office) {
                const actions = el('div', '', 'proposal-actions');
                actions.append(
                    button('Approve', 'btn btn-sm btn-primary', () => approve(proposal), `Approve ${proposal.name}`),
                    button('Rename', 'btn btn-sm btn-outline', () => openNameForm({ category: proposal }), `Rename ${proposal.name}`),
                    button('Merge into…', 'btn btn-sm btn-outline', () => openMergeForm(proposal, active), `Merge ${proposal.name} into another category`));
                row.append(actions);
            }
            list.append(row);
        }
    }

    async function run(action, success, conflict) {
        if (busy) return false;
        busy = true; document.body.setAttribute('aria-busy', 'true');
        try {
            try { await action(); }
            catch (error) { message(`Could not save: ${inv.errorMessage(error, conflict)}`); $('pageMessage').focus(); return false; }
            const text = typeof success === 'function' ? success() : success;
            message(text); $('pageMessage').focus();
            try { await load(); }
            catch (error) { message(`${text} The tree could not refresh (${inv.errorMessage(error)}). Reload the page.`); }
            return true;
        } finally { busy = false; document.body.removeAttribute('aria-busy'); }
    }
    async function update(id, values) {
        const { error } = await projectSupabaseClient.from('inventory_categories').update(values).eq('id', id);
        if (error) throw error;
    }

    function openDialog(title, build) {
        const content = $('categoryDialogContent'); content.replaceChildren();
        const header = el('div', '', 'work-page-header');
        const heading = el('h2', title); heading.id = 'categoryDialogTitle';
        header.append(heading, button('Close', 'btn btn-outline-secondary', () => { if (!busy) dialog.close(); }));
        content.append(header);
        build(content);
        dialog.showModal();
    }

    function openNameForm({ category = null, parent = null }) {
        openDialog(category ? `Rename ${category.name}` : parent ? `Add a subcategory under ${parent.name}` : 'Add a top-level category', content => {
            if (parent) content.append(el('p', `Inside ${pathText(parent.id)}`, 'text-muted'));
            const form = el('form'), status = el('p', '', 'small mt-2'); status.setAttribute('role', 'status');
            const label = el('label', 'Category name', 'form-label'); label.htmlFor = 'categoryName';
            const input = el('input', '', 'form-control'); input.id = 'categoryName'; input.required = true; input.maxLength = 120; input.autocomplete = 'off';
            input.value = category?.name || '';
            const save = el('button', category ? 'Save name' : 'Add category', 'btn btn-primary mt-3'); save.type = 'submit';
            form.append(label, input, save, status);
            form.onsubmit = async event => {
                event.preventDefault();
                const name = input.value.trim();
                if (!name) { status.textContent = 'Enter a name.'; return; }
                save.disabled = true; status.textContent = 'Saving…';
                const siblings = categories.filter(c => c.status !== 'archived' && (c.parent_id || null) === (parent?.id || null));
                const ok = await run(category
                    ? () => update(category.id, { name })
                    : async () => {
                        const { error } = await projectSupabaseClient.from('inventory_categories')
                            .insert({ parent_id: parent?.id || null, name, status: 'active', sort_order: inv.nextSortOrder(siblings) });
                        if (error) throw error;
                    }, category ? `Renamed to ${name}.` : `Added ${name}.`, `A category named ${name} already exists at this level.`);
                if (ok) { dialog.close(); if (parent) { collapsed.delete(parent.id); render(); } }
                else { status.textContent = $('pageMessage').textContent; save.disabled = false; input.focus(); }
            };
            content.append(form);
            setTimeout(() => input.focus());
        });
    }

    function openMergeForm(source, active) {
        openDialog(`Merge ${source.name}`, content => {
            content.append(el('p', `Items and subcategories in ${source.name} move to the category you choose. ${source.name} is then archived.`, 'text-muted'));
            const excluded = inv.descendantIds(active.byId, source.id);
            const form = el('form'), status = el('p', '', 'small mt-2'); status.setAttribute('role', 'status');
            const label = el('label', 'Merge into', 'form-label'); label.htmlFor = 'mergeTarget';
            const select = el('select', '', 'form-select'); select.id = 'mergeTarget'; select.required = true;
            select.append(new Option('Choose a category', ''));
            for (const { node } of inv.flattenTree(active.roots)) {
                if (!excluded.has(node.id)) select.append(new Option(pathText(node.id) + (node.status === 'proposed' ? ' (proposed)' : ''), node.id));
            }
            const save = el('button', 'Merge', 'btn btn-primary mt-3'); save.type = 'submit';
            form.append(label, select, save, status);
            form.onsubmit = async event => {
                event.preventDefault();
                if (!select.value) { status.textContent = 'Choose a category to merge into.'; return; }
                const target = pathText(select.value);
                if (!confirm(`Merge ${source.name} into ${target}? This moves its items and subcategories and archives ${source.name}.`)) return;
                save.disabled = true; status.textContent = 'Merging…';
                let result;
                const ok = await run(async () => {
                    const { data, error } = await supabaseClient.rpc('merge_inventory_category', { p_from: source.id, p_into: select.value });
                    if (error) throw error;
                    result = data;
                }, () => `Merged ${source.name} into ${target}: moved ${itemsLabel(result?.items_moved || 0)} and ${result?.children_moved || 0} subcategories.`,
                'Both categories have a subcategory with the same name. Merge or rename those first.');
                if (ok) dialog.close();
                else { status.textContent = $('pageMessage').textContent; save.disabled = false; }
            };
            content.append(form);
        });
    }

    function move(node, siblings, offset) {
        const updates = inv.reorderSiblings(siblings, node.id, offset);
        if (!updates.length) return;
        void run(async () => { for (const change of updates) await update(change.id, { sort_order: change.sort_order }); },
            `Moved ${node.name} ${offset < 0 ? 'up' : 'down'}.`);
    }

    function archive(node, active) {
        const children = active.byId.get(node.id)?.children || [];
        if (children.length) { message(`${node.name} has subcategories. Archive or merge them first, or use Merge to fold ${node.name} and everything in it into another category.`); $('pageMessage').focus(); return; }
        const count = itemCounts.get(node.id) || 0;
        const warning = count ? ` Its ${itemsLabel(count)} will stay in this archived category. To move them, cancel and use Merge instead.` : '';
        if (!confirm(`Archive ${node.name}? Field crews will no longer be able to choose it.${warning}`)) return;
        void run(() => update(node.id, { status: 'archived' }), `Archived ${node.name}.`);
    }

    function restore(node) {
        const parent = categories.find(category => category.id === node.parent_id);
        if (parent?.status === 'archived') { message(`Restore ${parent.name} first; ${node.name} sits inside it.`); $('pageMessage').focus(); return; }
        void run(() => update(node.id, { status: 'active' }), `Restored ${node.name}.`, `Another current category at this level is already named ${node.name}. Rename one of them first.`);
    }

    function approve(proposal) {
        void run(() => update(proposal.id, { status: 'active' }), `Approved ${proposal.name}.`, `Another category at this level is already named ${proposal.name}. Merge it instead.`);
    }

    $('addRootCategory').onclick = () => openNameForm({});
    $('showArchived').onchange = render;
    $('expandAll').onclick = () => { collapsed.clear(); render(); };
    $('collapseAll').onclick = () => { for (const category of categories) collapsed.add(category.id); render(); };
    if (!office) message(InvenioProjectScope.activeProject.status === 'active' ? 'Office staff manage categories. You can view the tree.' : 'This project is read-only.');
    try { await load(); }
    catch (error) { message(`Could not load categories: ${inv.errorMessage(error)}`); }
})().catch(error => { const message = document.getElementById('pageMessage'); if (message) message.textContent = error.message; });

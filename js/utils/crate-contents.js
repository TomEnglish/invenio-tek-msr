/**
 * What is inside a crate, for the Crates and Loads pages: the units inside it (crates, containers, skids, bundles,
 * baskets), each of which opens out in turn to show its own contents, and the items packed in it, each linking to its
 * record. A level is read from handling_unit_overview and handling_unit_items (021/022) the first time it is shown and
 * kept in `state`, which the page holds, so what is open survives a redraw. Uses the project-scoped client.
 */
(function (root) {
    const UNIT_COLUMNS = 'id,code,kind,description,is_high_value,status,parent_id,item_count,unit_count';
    const ITEM_COLUMNS = 'id,unit_id,tag,name,quantity,uom,material_id,inventory_uid,packed_at';
    // 021 stops a crate going inside itself; this only bounds a runaway if the data ever looped.
    const MAX_DEPTH = 12;
    const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

    /** A received item opens its material record; one counted but not yet received, its row on Initial Inventory. */
    function itemHref(item) {
        if (item.material_id) return `record.html?type=materials&id=${encodeURIComponent(item.material_id)}`;
        if (item.inventory_uid) return `initial-inventory.html?item=${encodeURIComponent(item.inventory_uid)}`;
        return null;
    }
    const crateHref = unitId => `handling-units.html?unit=${encodeURIComponent(unitId)}`;
    function quantityText(item) {
        const amount = item.quantity === null || item.quantity === undefined || item.quantity === '' ? '' : Number(item.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 });
        return [amount, item.uom || ''].filter(Boolean).join(' ');
    }
    /** What is open (unit ids) and each level read so far, by unit id. */
    const newState = () => ({ open: new Set(), levels: new Map() });
    /** Opens a unit out, or folds it away again; says whether it is now open. */
    function toggleOpen(state, unitId) {
        if (state.open.has(unitId)) { state.open.delete(unitId); return false; }
        state.open.add(unitId);
        return true;
    }

    async function readAll(client, table, columns, filter) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await filter(client.from(table).select(columns)).order('id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) return rows;
        }
    }
    /** One level: the units directly inside a unit, by code, and the items packed in it, by tag. */
    async function readLevel(client, unitId) {
        const [units, items] = await Promise.all([
            readAll(client, 'handling_unit_overview', UNIT_COLUMNS, query => query.eq('parent_id', unitId)),
            readAll(client, 'handling_unit_items', ITEM_COLUMNS, query => query.eq('unit_id', unitId)),
        ]);
        units.sort((a, b) => collator.compare(a.code, b.code));
        items.sort((a, b) => collator.compare(String(a.tag), String(b.tag)));
        return { units, items };
    }

    /**
     * A view over `state`. `render(container, unitId)` shows what is inside that unit. With `openCrate`, each unit
     * inside has an Open button that calls it; without, an Open link to the unit on the Crates page.
     */
    function view({ document: doc = root.document, client, state, logistics, openCrate = null }) {
        let serial = 0;
        // Placeholders shown while a level is read, by unit id; each is replaced when the read finishes.
        const waiting = new Map();
        function el(tag, text = '', className = '') {
            const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
        }
        function button(text, className, onclick, label) {
            const node = el('button', text, className); node.type = 'button'; node.onclick = onclick;
            if (label) node.setAttribute('aria-label', label);
            return node;
        }
        const kindText = unit => logistics.UNIT_KINDS[unit.kind] || unit.kind;
        function statusChip(unit) {
            const status = logistics.UNIT_STATUS[unit.status] || { label: unit.status, chip: 'chip-muted' };
            return el('span', status.label, `chip ${status.chip}`);
        }
        const dateText = value => value ? new Date(value).toLocaleDateString('en-US') : '';

        function read(unitId) {
            const entry = { status: 'loading' };
            state.levels.set(unitId, entry);
            readLevel(client, unitId).then(result => ({ status: 'ready', ...result }), error => ({ status: 'error', error })).then(done => {
                // Dropped if the page has since cleared what it read (after a change, say); the new read fills in.
                if (state.levels.get(unitId) !== entry) return;
                state.levels.set(unitId, done);
                const nodes = waiting.get(unitId) || new Set();
                waiting.delete(unitId);
                for (const node of nodes) if (node.parentNode) node.replaceWith(level(unitId, Number(node.dataset.depth)));
            });
        }

        function level(unitId, depth) {
            if (!state.levels.has(unitId)) read(unitId);
            const entry = state.levels.get(unitId);
            if (entry.status === 'loading') {
                const node = el('p', 'Loading what is inside…', 'small text-muted mb-0');
                node.dataset.depth = String(depth);
                if (!waiting.has(unitId)) waiting.set(unitId, new Set());
                waiting.get(unitId).add(node);
                return node;
            }
            if (entry.status === 'error') {
                const node = el('div', '', 'crate-tree-error');
                node.append(el('p', `What is inside could not be loaded (${logistics.errorMessage(entry.error)}).`, 'small text-danger mb-1'),
                    button('Try again', 'btn btn-sm btn-outline', () => { state.levels.delete(unitId); node.replaceWith(level(unitId, depth)); }));
                return node;
            }
            const wrap = el('div', '', 'crate-tree-level');
            if (!entry.units.length && !entry.items.length) { wrap.append(el('p', 'Nothing inside.', 'small text-muted mb-0')); return wrap; }
            if (entry.units.length) {
                const list = el('ul', '', 'unit-children crate-tree');
                for (const unit of entry.units) list.append(unitRow(unit, depth));
                wrap.append(list);
            }
            if (entry.items.length) wrap.append(itemTable(entry.items));
            return wrap;
        }

        function unitRow(unit, depth) {
            const row = el('li', '', 'crate-tree-unit'), head = el('div', '', 'crate-tree-head');
            row.append(head);
            const inside = Number(unit.item_count || 0) + Number(unit.unit_count || 0);
            if (inside && depth < MAX_DEPTH) {
                // A disclosure button: its name is the code, and aria-expanded says whether its contents show below.
                const toggle = el('button', '', 'btn btn-link p-0 mono crate-tree-toggle'), icon = el('i', '', 'fas fa-caret-right');
                toggle.type = 'button'; icon.setAttribute('aria-hidden', 'true');
                toggle.append(icon, unit.code);
                const nested = el('div', '', 'crate-tree-nested');
                nested.id = `crate-tree-${++serial}`;
                toggle.setAttribute('aria-controls', nested.id);
                const show = open => {
                    toggle.setAttribute('aria-expanded', String(open));
                    icon.className = open ? 'fas fa-caret-down' : 'fas fa-caret-right';
                    if (open && !nested.childNodes.length) nested.append(level(unit.id, depth + 1));
                    nested.hidden = !open;
                };
                toggle.onclick = () => show(toggleOpen(state, unit.id));
                head.append(toggle);
                row.append(nested);
                show(state.open.has(unit.id));
            } else head.append(el('span', unit.code, 'mono'));
            head.append(statusChip(unit));
            if (unit.is_high_value) head.append(el('span', 'High value', 'chip chip-danger'));
            head.append(el('span', [kindText(unit), unit.description, logistics.contentsText(unit)].filter(Boolean).join(' · '), 'small text-muted'));
            if (openCrate) head.append(button('Open', 'btn btn-sm btn-outline', () => openCrate(unit), `Open ${unit.code}`));
            else {
                const link = el('a', 'Open', 'btn btn-sm btn-outline'); link.href = crateHref(unit.id);
                link.setAttribute('aria-label', `Open ${unit.code} on the Crates page`);
                head.append(link);
            }
            return row;
        }

        function itemTable(items) {
            const table = el('table', '', 'table table-sm crate-tree-items'), head = el('tr'), body = el('tbody');
            for (const label of ['Tag', 'Item', 'Quantity', 'Packed']) { const cell = el('th', label); cell.scope = 'col'; head.append(cell); }
            const thead = el('thead'); thead.append(head);
            for (const item of items) {
                const row = el('tr'), tag = el('td', '', 'mono'), href = itemHref(item);
                if (href) {
                    const link = el('a', item.tag); link.href = href;
                    link.title = item.material_id ? 'Open its record' : 'Open it on Initial Inventory';
                    tag.append(link);
                } else tag.textContent = item.tag;
                row.append(tag, el('td', item.name || ''), el('td', quantityText(item), 'num'), el('td', dateText(item.packed_at)));
                body.append(row);
            }
            table.append(thead, body);
            const wrap = el('div', '', 'table-responsive'); wrap.append(table);
            return wrap;
        }

        return { render(container, unitId) { container.replaceChildren(level(unitId, 0)); } };
    }

    const api = { UNIT_COLUMNS, ITEM_COLUMNS, MAX_DEPTH, itemHref, crateHref, quantityText, newState, toggleOpen, readLevel, view };
    root.InvenioCrateContents = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

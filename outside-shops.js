(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const $ = id => document.getElementById(id);
    const loadsApi = InvenioLoads;
    const message = text => { $('pageMessage').textContent = text; };
    function el(tag, text = '', className = '') {
        const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    async function fetchAll(table, columns, filter) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await filter(projectSupabaseClient.from(table).select(columns)).order('id').range(from, from + 999);
            if (error) throw error;
            rows.push(...data);
            if (data.length < 1000) return rows;
        }
    }

    let contents = [];

    // Shops are shared places; crates and lines are this project's. The old outside_shop_inventory table is no
    // longer read here: what a shop holds now comes from where loads delivered pieces.
    async function load() {
        const [shopResult, units, lines] = await Promise.all([
            supabaseClient.from('places').select('id,name,is_active,city,state,contact_name,contact_phone').eq('kind', 'outside_shop').order('name'),
            fetchAll('handling_unit_overview', 'id,code,description,is_high_value,status,parent_id,place_id', query => query.eq('status', 'delivered').is('parent_id', null)),
            fetchAll('load_line_overview', 'id,load_id,load_number,tag,name,is_high_value,piece_kind,unit_id,status,delivered_place_id,off_at,is_current_position',
                query => query.eq('status', 'delivered').eq('is_current_position', true)),
        ]);
        if (shopResult.error) throw shopResult.error;
        // A retired shop is listed only while something is still there.
        contents = loadsApi.shopContents(shopResult.data, units, lines).filter(entry => entry.shop.is_active !== false || entry.pieces.length);
        const select = $('filterShop'), keep = select.value;
        select.replaceChildren(new Option('All shops', ''), ...contents.map(entry => new Option(`${entry.shop.name}${entry.shop.is_active === false ? ' (retired)' : ''}`, entry.shop.id)));
        select.value = keep;
        render();
    }

    function matches(piece, words) {
        return words.every(word => [piece.code, piece.name].some(value => String(value || '').toLowerCase().includes(word)));
    }

    function render() {
        const shopId = $('filterShop').value, words = $('filterSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const shown = contents.filter(entry => !shopId || entry.shop.id === shopId)
            .map(entry => ({ ...entry, pieces: entry.pieces.filter(piece => matches(piece, words)) }))
            .filter(entry => entry.pieces.length || !words.length)
            // Shops holding something first.
            .sort((a, b) => Number(!a.pieces.length) - Number(!b.pieces.length));
        const total = shown.reduce((sum, entry) => sum + entry.pieces.length, 0);
        $('resultSummary').textContent = `${total.toLocaleString()} ${total === 1 ? 'piece' : 'pieces'} at ${shown.filter(entry => entry.pieces.length).length.toLocaleString()} of ${contents.length.toLocaleString()} shops`;
        const sections = $('shopSections');
        if (!contents.length) { sections.replaceChildren(el('p', 'No outside shops yet. Add them on the Places page.', 'text-muted')); return; }
        if (!shown.length) { sections.replaceChildren(el('p', 'Nothing matches these filters.', 'text-muted')); return; }
        sections.replaceChildren(...shown.map(renderShop));
    }

    function renderShop({ shop, pieces }) {
        const section = el('section', '', 'card mb-3'), header = el('div', '', 'card-header'), heading = el('h2', shop.name, 'h6 mb-0');
        heading.id = `shop-${shop.id}`; section.setAttribute('aria-labelledby', heading.id);
        const about = el('div', [[shop.city, shop.state].filter(Boolean).join(', '), [shop.contact_name, shop.contact_phone].filter(Boolean).join(' · ')].filter(Boolean).join(' — '), 'small text-muted');
        const titles = el('div'); titles.append(heading, about);
        const crates = pieces.filter(piece => piece.kind === 'crate').length, items = pieces.length - crates;
        header.append(titles, el('span', pieces.length ? `${crates} ${crates === 1 ? 'crate' : 'crates'}, ${items} ${items === 1 ? 'item' : 'items'}` : 'Nothing here now', 'small text-muted'));
        section.append(header);
        if (!pieces.length) return section;
        const table = el('table', '', 'table mb-0'), head = el('tr'), rows = el('tbody');
        for (const label of ['Code or tag', 'Piece', 'There since', 'Brought by']) { const cell = el('th', label); cell.scope = 'col'; head.append(cell); }
        const thead = el('thead'); thead.append(head);
        for (const piece of pieces) {
            const row = el('tr'), what = el('td'), since = el('td'), brought = el('td');
            what.append(el('div', piece.name), el('span', piece.kind === 'crate' ? 'Crate' : 'Item', 'small text-muted'));
            if (piece.isHighValue) what.append(el('span', 'High value', 'chip chip-danger ms-2'));
            const offAt = piece.line?.off_at;
            if (offAt) since.append(el('div', new Date(offAt).toLocaleDateString()), el('div', loadsApi.daysText(loadsApi.daysSince(offAt)), 'small text-muted'));
            else since.append(el('span', 'Not recorded', 'small text-muted'));
            if (piece.line) {
                const link = el('a', piece.line.load_number, 'mono'); link.href = `loads.html?load=${encodeURIComponent(piece.line.load_id)}`;
                brought.append(link);
            } else brought.append(el('span', 'Not recorded', 'small text-muted'));
            row.append(el('td', piece.code, 'mono'), what, since, brought);
            rows.append(row);
        }
        table.append(thead, rows);
        const wrap = el('div', '', 'table-responsive'); wrap.append(table);
        section.append(wrap);
        return section;
    }

    $('filterShop').onchange = render;
    $('filterSearch').oninput = render;
    try { await load(); }
    catch (error) { message(`Could not load the outside shops: ${loadsApi.errorMessage(error)}`); }
})();

/** Pure helpers for the initial inventory office pages: category tree, import mapping, map maths and CSV. */
(function (root) {
    const IMPORT_FIELDS = ['tag', 'name', 'description', 'category_path', 'part_number', 'quantity', 'uom'];
    const IMPORT_LABELS = { tag: 'Tag', name: 'Name', description: 'Description', category_path: 'Category path', part_number: 'Part number', quantity: 'Quantity', uom: 'Unit' };
    // "Unit" is deliberately absent: on these sites it usually means the plant unit (Generator 1), not a unit of measure.
    const IMPORT_SYNONYMS = {
        tag: ['tag', 'tag number', 'tag no', 'tag #', 'tag id', 'qr', 'qr code', 'qr value', 'barcode', 'asset tag'],
        name: ['name', 'item', 'item name', 'inventory item', 'title'],
        description: ['description', 'desc', 'item description', 'details'],
        category_path: ['category path', 'category', 'categories', 'path'],
        part_number: ['part number', 'part no', 'part #', 'part', 'pn', 'p n', 'mfr part number', 'manufacturer part number'],
        quantity: ['quantity', 'qty', 'count', 'amount'],
        uom: ['uom', 'u m', 'um', 'unit of measure', 'units'],
    };
    const MAX_IMPORT_ROWS = 5000;
    const SITE_PLAN_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    const STATUS = {
        expected: { label: 'Expected', chip: 'chip-warn', token: '--warn' },
        counted: { label: 'Counted', chip: 'chip-primary', token: '--primary' },
        received: { label: 'Received', chip: 'chip-success', token: '--success' },
    };
    const SOURCE_LABELS = { import: 'Imported', field: 'Found in the field', legacy: 'Before counting started' };
    const IMPORT_ACTIONS = { create: 'New expected tag', update: 'Refresh expected tag', skip_counted: 'Skip: already counted', skip_received: 'Skip: already received' };

    const byOrder = (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
        || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id));

    /** Nest categories under their parents; archived ones are left out unless asked for. Orphans become roots. */
    function buildCategoryTree(categories, { includeArchived = false } = {}) {
        const byId = new Map();
        for (const category of categories) {
            if (includeArchived || category.status !== 'archived') byId.set(category.id, { ...category, children: [] });
        }
        const roots = [];
        for (const node of byId.values()) {
            const parent = node.parent_id && node.parent_id !== node.id ? byId.get(node.parent_id) : null;
            (parent ? parent.children : roots).push(node);
        }
        const sort = nodes => { nodes.sort(byOrder); nodes.forEach(node => sort(node.children)); };
        sort(roots);
        return { roots, byId };
    }

    /** Depth-first rows for an indented list, skipping the children of collapsed nodes. */
    function flattenTree(roots, collapsed = new Set()) {
        const rows = [], seen = new Set();
        const walk = (nodes, depth) => {
            for (const node of nodes) {
                if (seen.has(node.id)) continue;
                seen.add(node.id);
                rows.push({ node, depth, hasChildren: node.children.length > 0 });
                if (!collapsed.has(node.id)) walk(node.children, depth + 1);
            }
        };
        walk(roots, 0);
        return rows;
    }

    /** Names from the root down to this category, using any lookup with { name, parent_id }. */
    function categoryPath(byId, id) {
        const names = [], seen = new Set();
        let node = byId.get(id);
        while (node && !seen.has(node.id)) { seen.add(node.id); names.unshift(node.name); node = node.parent_id ? byId.get(node.parent_id) : null; }
        return names;
    }

    /** The category and everything below it, as a Set of ids (used for subtree filters and merge targets). */
    function descendantIds(byId, id) {
        const ids = new Set(), stack = [byId.get(id)];
        while (stack.length) {
            const node = stack.pop();
            if (!node || ids.has(node.id)) continue;
            ids.add(node.id);
            stack.push(...node.children);
        }
        return ids;
    }

    /** Move one sibling up (-1) or down (+1); returns only the sort_order updates that change. */
    function reorderSiblings(siblings, id, offset) {
        const ordered = [...siblings].sort(byOrder);
        const from = ordered.findIndex(node => node.id === id), to = from + offset;
        if (from < 0 || to < 0 || to >= ordered.length) return [];
        const [moved] = ordered.splice(from, 1);
        ordered.splice(to, 0, moved);
        return ordered.map((node, index) => ({ id: node.id, sort_order: (index + 1) * 10 }))
            .filter((update, index) => ordered[index].sort_order !== update.sort_order);
    }

    function nextSortOrder(siblings) {
        return siblings.reduce((max, node) => Math.max(max, node.sort_order || 0), 0) + 10;
    }

    const normaliseHeader = header => String(header ?? '').toLowerCase().replace(/[_\-./:]+/g, ' ').replace(/\s+/g, ' ').trim();

    /** Best guess of which spreadsheet column feeds each import field: { tag: 0, name: 2, ... } or null. */
    function guessColumnMapping(headers) {
        const normalised = headers.map(normaliseHeader), used = new Set(), mapping = {};
        for (const field of IMPORT_FIELDS) {
            mapping[field] = null;
            for (const synonym of IMPORT_SYNONYMS[field]) {
                const index = normalised.findIndex((header, i) => !used.has(i) && header === synonym);
                if (index >= 0) { mapping[field] = index; used.add(index); break; }
            }
        }
        // Second pass, whole words, longest match first: "Item description / notes" is a description, not a name.
        const candidates = [];
        IMPORT_FIELDS.forEach((field, order) => {
            if (mapping[field] !== null) return;
            for (const synonym of IMPORT_SYNONYMS[field].filter(s => s.length > 3)) {
                normalised.forEach((header, index) => {
                    if (!used.has(index) && ` ${header.replace(/[()[\]]/g, ' ')} `.includes(` ${synonym} `)) candidates.push({ field, index, order, length: synonym.length });
                });
            }
        });
        candidates.sort((a, b) => b.length - a.length || a.order - b.order || a.index - b.index);
        for (const { field, index } of candidates) {
            if (mapping[field] === null && !used.has(index)) { mapping[field] = index; used.add(index); }
        }
        return mapping;
    }

    const blank = value => value === null || value === undefined || String(value).trim() === '';

    /** Spreadsheet quantities arrive as numbers or text; send the database a plain decimal string. */
    function normaliseQuantity(value) {
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) return String(value);
            const rounded = Math.round(value * 1000) / 1000;
            return Math.abs(rounded - value) < 1e-9 ? String(rounded) : String(value);
        }
        const text = String(value).trim();
        return /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replaceAll(',', '') : text;
    }

    function normaliseCategoryPath(value) {
        return String(value).split(/[>›»]/).map(part => part.trim()).filter(Boolean).join(' > ');
    }

    /**
     * Turn data rows (arrays of cells) into import items with only the mapped keys.
     * Blank rows are dropped; lines[i] is the 1-based sheet line of items[i] for error messages.
     */
    function rowsToItems(rows, mapping, firstLine = 2) {
        const items = [], lines = [];
        rows.forEach((row, index) => {
            const item = {};
            for (const field of IMPORT_FIELDS) {
                const column = mapping[field];
                if (column === null || column === undefined || blank(row[column])) continue;
                const value = row[column];
                item[field] = field === 'quantity' ? normaliseQuantity(value)
                    : field === 'category_path' ? normaliseCategoryPath(value) : String(value).trim();
            }
            if (Object.keys(item).length) { items.push(item); lines.push(firstLine + index); }
        });
        return { items, lines };
    }

    /** RFC 4180 CSV with quoted fields; the delimiter (comma, semicolon or tab) is the most common one in the first lines. */
    function parseCsv(text) {
        const source = String(text).replace(/^﻿/, '');
        const sample = source.split(/\r?\n/, 20).join('\n').replace(/"[^"]*"/g, '');
        const delimiter = [',', ';', '\t'].map(d => [d, sample.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
        const rows = [];
        let row = [], field = '', quoted = false;
        for (let i = 0; i < source.length; i++) {
            const char = source[i];
            if (quoted) {
                if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
                else if (char === '"') quoted = false;
                else field += char;
            } else if (char === '"' && field === '') quoted = true;
            else if (char === delimiter) { row.push(field); field = ''; }
            else if (char === '\n' || char === '\r') {
                if (char === '\r' && source[i + 1] === '\n') i++;
                row.push(field); rows.push(row); row = []; field = '';
            } else field += char;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        return rows;
    }

    /**
     * SheetJS worksheet (read with cellNF) to rows of cells, positioned from A1 so line numbers and column
     * letters match the sheet. Numbers keep every digit unless a zero-padded or text format shows them
     * differently ("00123" stays a tag, not 123).
     */
    function sheetToRows(sheet) {
        const value = cell => {
            if (!cell) return '';
            if (cell.t === 'n') return typeof cell.w === 'string' && (cell.z === '@' || /^0{2,}$/.test(cell.z || '')) ? cell.w : cell.v;
            if (cell.t === 's' || cell.t === 'b') return cell.v;
            if (cell.t === 'd') return cell.w ?? String(cell.v);
            return '';
        };
        const rows = [];
        for (const [address, cell] of Object.entries(sheet || {})) {
            const match = /^([A-Z]{1,3})(\d+)$/.exec(address);
            if (!match) continue;
            const column = [...match[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
            (rows[Number(match[2]) - 1] ||= [])[column] = value(cell);
        }
        return Array.from(rows, row => Array.from(row || [], cell => cell ?? ''));
    }

    /** Spreadsheet column name for a 0-based index: 0 → A, 25 → Z, 26 → AA. */
    function columnLetter(index) {
        let name = '';
        for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
        return name;
    }

    /**
     * Find the header row, skipping title lines above it: the first of the top 20 rows with a recognisable
     * tag column, otherwise the first row with the most filled cells. Returns headers, data rows and the
     * 1-based sheet line of the first data row.
     */
    function splitHeader(rows) {
        const top = rows.slice(0, 20), filled = row => row.filter(cell => !blank(cell)).length;
        if (!top.some(row => filled(row))) return { headers: [], rows: [], firstLine: 1 };
        let index = top.findIndex(row => filled(row) && guessColumnMapping(row).tag !== null);
        if (index < 0) { const most = Math.max(...top.map(filled)); index = top.findIndex(row => filled(row) === most); }
        return { headers: rows[index].map(cell => String(cell ?? '').trim()), rows: rows.slice(index + 1), firstLine: index + 2 };
    }

    const clampUnit = value => Math.min(1, Math.max(0, value));
    const round6 = value => Math.round(value * 1e6) / 1e6;

    /** Normalised [x, y] (0-1, origin top-left) to a Leaflet CRS.Simple [lat, lng] on an image of width x height. */
    function toLatLng(point, width, height) {
        return [(1 - point[1]) * height, point[0] * width];
    }

    /** Leaflet { lat, lng } back to normalised [x, y], clamped onto the image and rounded for numeric(7,6). */
    function fromLatLng(latLng, width, height) {
        return [round6(clampUnit(latLng.lng / width)), round6(clampUnit(1 - latLng.lat / height))];
    }

    /** Matches the database check: 3-200 [x, y] pairs, every coordinate a number in 0-1. */
    function validZoneShape(points) {
        return Array.isArray(points) && points.length >= 3 && points.length <= 200 && points.every(point =>
            Array.isArray(point) && point.length === 2 && point.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1));
    }

    /** Scale an image down (never up) so its long side is at most max pixels. */
    function fitWithin(width, height, max = 4000) {
        const scale = Math.min(1, max / Math.max(width, height));
        return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: scale < 1 };
    }

    function sitePlanPath(projectId, mapId, mimeType) {
        const extension = SITE_PLAN_TYPES[mimeType];
        if (!extension) throw new Error('Use a PNG, JPG or WEBP image.');
        return `${projectId}/${mapId}.${extension}`;
    }

    function countProgress(records) {
        const progress = { expected: 0, counted: 0, received: 0, newTags: 0, imported: 0, importedFound: 0, total: records.length };
        for (const record of records) {
            if (record.count_status in STATUS) progress[record.count_status]++;
            if (record.source === 'field') progress.newTags++;
            if (record.source === 'import') {
                progress.imported++;
                if (record.count_status !== 'expected') progress.importedFound++;
            }
        }
        return progress;
    }

    /** Filters: categoryIds (Set or null), zoneId ('' any, 'none' unzoned), status ('' any, 'new' for field-found tags), search text. */
    function filterRecords(records, { categoryIds = null, zoneId = '', status = '', search = '' } = {}) {
        const needle = search.trim().toLowerCase();
        return records.filter(record =>
            (!categoryIds || categoryIds.has(record.category_id))
            && (!zoneId || (zoneId === 'none' ? !record.zone_id : record.zone_id === zoneId))
            && (!status || (status === 'new' ? record.source === 'field' : record.count_status === status))
            && (!needle || [record.qr_code, record.inventory_item, record.item_description, record.part_number]
                .some(value => value && String(value).toLowerCase().includes(needle))));
    }

    /** One CSV cell, quoted when needed; cells that a spreadsheet would run as a formula are prefixed with '. */
    function csvCell(value) {
        let text = value === null || value === undefined ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }

    function toCsv(headers, rows) {
        return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    }

    /** Plain-language text for Supabase errors on these pages. */
    function errorMessage(error, conflict = 'That name is already used at this level.') {
        const code = error?.code, text = error?.message || String(error ?? 'Unknown error');
        if (['42P01', 'PGRST202', 'PGRST205'].includes(code)) return 'Initial inventory is not set up in this database yet (migration 019).';
        if (code === '23505') return conflict;
        if (code === '42501') return 'You do not have permission to make this change in this project.';
        return text;
    }

    const api = {
        IMPORT_FIELDS, IMPORT_LABELS, MAX_IMPORT_ROWS, SITE_PLAN_TYPES, STATUS, SOURCE_LABELS, IMPORT_ACTIONS, errorMessage,
        buildCategoryTree, flattenTree, categoryPath, descendantIds, reorderSiblings, nextSortOrder,
        guessColumnMapping, normaliseQuantity, normaliseCategoryPath, rowsToItems, parseCsv, sheetToRows, splitHeader, columnLetter,
        toLatLng, fromLatLng, validZoneShape, fitWithin, sitePlanPath,
        countProgress, filterRecords, csvCell, toCsv,
    };
    root.InvenioInventory = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

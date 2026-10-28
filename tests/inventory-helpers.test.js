const test = require('node:test');
const assert = require('node:assert/strict');
const inv = require('../js/utils/inventory-helpers.js');

const categories = [
    { id: 'gt2', parent_id: null, name: 'Gas Turbine 2', status: 'active', sort_order: 20 },
    { id: 'elec', parent_id: null, name: 'electrical', status: 'active', sort_order: 20 },
    { id: 'lube', parent_id: 'gt2', name: 'Lube Oil', status: 'active', sort_order: 10 },
    { id: 'cool', parent_id: 'lube', name: 'Cooler', status: 'active', sort_order: 10 },
    { id: 'valve', parent_id: 'lube', name: 'Pressure Valve', status: 'proposed', sort_order: 20 },
    { id: 'old', parent_id: null, name: 'Old Laydown', status: 'archived', sort_order: 5 },
    { id: 'orphan', parent_id: 'old', name: 'Left behind', status: 'active', sort_order: 0 },
];

test('category tree nests by parent, sorts by sort_order then name, and leaves archived out unless asked', () => {
    const { roots, byId } = inv.buildCategoryTree(categories);
    assert.deepEqual(roots.map(node => node.id), ['orphan', 'elec', 'gt2']);
    assert.deepEqual(byId.get('lube').children.map(node => node.id), ['cool', 'valve']);
    assert.equal(byId.has('old'), false);
    const all = inv.buildCategoryTree(categories, { includeArchived: true });
    assert.deepEqual(all.roots.map(node => node.id), ['old', 'elec', 'gt2']);
    assert.deepEqual(all.byId.get('old').children.map(node => node.id), ['orphan']);
    assert.equal(categories[0].children, undefined, 'input rows are not mutated');
});

test('flattened rows carry depth and skip collapsed children; paths and subtrees follow the tree', () => {
    const { roots, byId } = inv.buildCategoryTree(categories);
    assert.deepEqual(inv.flattenTree(roots).map(row => `${row.depth}:${row.node.id}`), ['0:orphan', '0:elec', '0:gt2', '1:lube', '2:cool', '2:valve']);
    assert.deepEqual(inv.flattenTree(roots, new Set(['lube'])).map(row => row.node.id), ['orphan', 'elec', 'gt2', 'lube']);
    assert.equal(inv.flattenTree(roots).find(row => row.node.id === 'lube').hasChildren, true);
    const lookup = new Map(categories.map(category => [category.id, category]));
    assert.deepEqual(inv.categoryPath(lookup, 'valve'), ['Gas Turbine 2', 'Lube Oil', 'Pressure Valve']);
    assert.deepEqual(inv.categoryPath(lookup, 'missing'), []);
    const looped = new Map([['a', { id: 'a', parent_id: 'b', name: 'A' }], ['b', { id: 'b', parent_id: 'a', name: 'B' }]]);
    assert.deepEqual(inv.categoryPath(looped, 'a'), ['B', 'A'], 'a loop in bad data cannot hang the page');
    assert.deepEqual([...inv.descendantIds(byId, 'gt2')].sort(), ['cool', 'gt2', 'lube', 'valve']);
    assert.deepEqual([...inv.descendantIds(byId, 'missing')], []);
});

test('reordering returns only the sort_order changes, and refuses moves off either end', () => {
    const siblings = [{ id: 'a', name: 'A', sort_order: 10 }, { id: 'b', name: 'B', sort_order: 20 }, { id: 'c', name: 'C', sort_order: 30 }];
    assert.deepEqual(inv.reorderSiblings(siblings, 'c', -1), [{ id: 'c', sort_order: 20 }, { id: 'b', sort_order: 30 }]);
    assert.deepEqual(inv.reorderSiblings(siblings, 'a', 1), [{ id: 'b', sort_order: 10 }, { id: 'a', sort_order: 20 }]);
    assert.deepEqual(inv.reorderSiblings(siblings, 'a', -1), []);
    assert.deepEqual(inv.reorderSiblings(siblings, 'c', 1), []);
    assert.deepEqual(inv.reorderSiblings(siblings, 'missing', 1), []);
    const tied = [{ id: 'x', name: 'X', sort_order: 0 }, { id: 'y', name: 'Y', sort_order: 0 }];
    assert.deepEqual(inv.reorderSiblings(tied, 'y', -1), [{ id: 'y', sort_order: 10 }, { id: 'x', sort_order: 20 }]);
    assert.equal(inv.nextSortOrder(siblings), 40);
    assert.equal(inv.nextSortOrder([]), 10);
});

test('column guesses use exact header names first, then whole words, and never reuse a column', () => {
    assert.deepEqual(inv.guessColumnMapping(['Tag Number', 'Item Name', 'Category', 'Qty', 'UoM', 'Part #', 'Description']),
        { tag: 0, name: 1, description: 6, category_path: 2, part_number: 5, quantity: 3, uom: 4 });
    assert.deepEqual(inv.guessColumnMapping(['QR code value', 'Item description / notes', 'Quantity (each)']),
        { tag: 0, name: null, description: 1, category_path: null, part_number: null, quantity: 2, uom: null });
    assert.equal(inv.guessColumnMapping(['Tag', 'Unit']).uom, null, 'Unit means the plant unit here, not a unit of measure');
    assert.equal(inv.guessColumnMapping(['Department', 'Tag']).part_number, null, 'part is matched as a whole word only');
    assert.deepEqual(inv.guessColumnMapping([]), { tag: null, name: null, description: null, category_path: null, part_number: null, quantity: null, uom: null });
    assert.deepEqual(inv.guessColumnMapping(['tag', 'TAG']).tag, 0);
});

test('rows become import items with only mapped, non-blank, trimmed fields and their sheet lines', () => {
    const mapping = { tag: 0, name: 1, description: null, category_path: 2, part_number: 3, quantity: 4, uom: null };
    const rows = [
        [' GT2-LO-001 ', 'Cooler', 'Gas Turbine 2 › Lube Oil ›  Cooler', 'LOC-77', 2],
        ['', '', '', '', ''],
        ['GT2-LO-002', '', 'A >> B', '', '1,500.5'],
        ['N-1', 'Gate valve', '', 123456789012, 0.1 + 0.2],
    ];
    const { items, lines } = inv.rowsToItems(rows, mapping, 4);
    assert.deepEqual(items, [
        { tag: 'GT2-LO-001', name: 'Cooler', category_path: 'Gas Turbine 2 > Lube Oil > Cooler', part_number: 'LOC-77', quantity: '2' },
        { tag: 'GT2-LO-002', category_path: 'A > B', quantity: '1500.5' },
        { tag: 'N-1', name: 'Gate valve', part_number: '123456789012', quantity: '0.3' },
    ]);
    assert.deepEqual(lines, [4, 6, 7]);
    for (const item of items) assert.deepEqual(Object.keys(item).filter(key => !inv.IMPORT_FIELDS.includes(key)), []);
});

test('quantities are normalised to plain decimals without hiding real precision problems', () => {
    assert.equal(inv.normaliseQuantity(3), '3');
    assert.equal(inv.normaliseQuantity(1.25), '1.25');
    assert.equal(inv.normaliseQuantity(0.1 + 0.2), '0.3');
    assert.equal(inv.normaliseQuantity(1.23456), '1.23456', 'the database rejects more than 3 decimals and reports the row');
    assert.equal(inv.normaliseQuantity(' 12,000 '), '12000');
    assert.equal(inv.normaliseQuantity('1,5'), '1,5', 'a decimal comma is left for the database to reject');
    assert.equal(inv.normaliseQuantity('abc'), 'abc');
});

test('CSV parsing handles quotes, embedded delimiters and newlines, CRLF, BOM, and semicolon or tab files', () => {
    assert.deepEqual(inv.parseCsv('﻿Tag,Name\r\nA-1,"Valve, 6"" gate"\r\nA-2,"two\nlines"\r\n'),
        [['Tag', 'Name'], ['A-1', 'Valve, 6" gate'], ['A-2', 'two\nlines']]);
    assert.deepEqual(inv.parseCsv('Export title\n\nTag;Qty\nA;1,5\n'), [['Export title'], [''], ['Tag', 'Qty'], ['A', '1,5']]);
    assert.deepEqual(inv.parseCsv('Tag\tQty\nA\t2'), [['Tag', 'Qty'], ['A', '2']]);
    assert.deepEqual(inv.parseCsv('a,b\n1,'), [['a', 'b'], ['1', '']]);
    assert.deepEqual(inv.parseCsv(''), []);
});

test('XLSX cells keep their sheet position, padded tags and full-precision numbers', () => {
    const sheet = {
        '!ref': 'B2:D4', '!merges': [],
        B2: { t: 's', v: 'Tag' }, C2: { t: 's', v: 'Qty' },
        B3: { t: 'n', v: 123, w: '00123', z: '00000' }, C3: { t: 'n', v: 2.5, w: '3', z: '0' },
        B4: { t: 'n', v: 123456789012, w: '1.23457E+11', z: 'General' }, C4: { t: 'b', v: true }, D4: { t: 'e', v: 7, w: '#DIV/0!' },
        B5: { t: 'n', v: 42, w: '42', z: '@' }, C5: { t: 'd', v: new Date('2026-10-27T00:00:00Z'), w: '10/27/26' },
    };
    const rows = inv.sheetToRows(sheet);
    assert.deepEqual(rows, [[], ['', 'Tag', 'Qty'], ['', '00123', 2.5], ['', 123456789012, true, ''], ['', '42', '10/27/26']]);
    const split = inv.splitHeader(rows);
    assert.deepEqual([split.headers, split.firstLine], [['', 'Tag', 'Qty'], 3]);
    assert.equal(inv.columnLetter(inv.guessColumnMapping(split.headers).tag), 'B');
    const { items, lines } = inv.rowsToItems(split.rows, { tag: 1, quantity: 2 }, split.firstLine);
    assert.deepEqual(items, [{ tag: '00123', quantity: '2.5' }, { tag: '123456789012', quantity: 'true' }, { tag: '42', quantity: '10/27/26' }]);
    assert.deepEqual(lines, [3, 4, 5]);
    assert.deepEqual(inv.sheetToRows({}), []);
    assert.deepEqual(inv.sheetToRows(undefined), []);
});

test('the header row is found below title lines, and data lines are numbered as in the sheet', () => {
    const split = inv.splitHeader([['Expected tags for North Yard'], [], ['Tag', 'Name'], ['A-1', 'Pump']]);
    assert.deepEqual(split, { headers: ['Tag', 'Name'], rows: [['A-1', 'Pump']], firstLine: 4 });
    assert.deepEqual(inv.splitHeader([['', ''], ['Code', 'Item', 'Count'], ['1', '2', '3']]).headers, ['Code', 'Item', 'Count']);
    assert.deepEqual(inv.splitHeader([[], ['']]), { headers: [], rows: [], firstLine: 1 });
    assert.deepEqual([0, 25, 26, 27, 701, 702].map(inv.columnLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
});

test('map points convert between normalised top-left coordinates and Leaflet CRS.Simple', () => {
    assert.deepEqual(inv.toLatLng([0, 0], 1600, 1000), [1000, 0], 'top-left of the image');
    assert.deepEqual(inv.toLatLng([1, 1], 1600, 1000), [0, 1600], 'bottom-right of the image');
    assert.deepEqual(inv.toLatLng([0.25, 0.5], 1600, 1000), [500, 400]);
    assert.deepEqual(inv.fromLatLng({ lat: 500, lng: 400 }, 1600, 1000), [0.25, 0.5]);
    assert.deepEqual(inv.fromLatLng({ lat: -20, lng: 2000 }, 1600, 1000), [1, 1], 'points off the image are clamped onto it');
    assert.deepEqual(inv.fromLatLng({ lat: 1000 / 3, lng: 1600 / 3 }, 1600, 1000), [0.333333, 0.666667], 'six decimals, as stored');
    for (const point of [[0.42, 0.61], [0.123456, 0.987654]]) {
        const [lat, lng] = inv.toLatLng(point, 4000, 2250);
        assert.deepEqual(inv.fromLatLng({ lat, lng }, 4000, 2250), point);
    }
});

test('zone shapes match the database rule and plan images scale down to 4000 px', () => {
    assert.equal(inv.validZoneShape([[0, 0], [1, 0], [1, 1]]), true);
    assert.equal(inv.validZoneShape([[0, 0], [1, 0]]), false);
    assert.equal(inv.validZoneShape([[0, 0], [1, 0], [1.01, 1]]), false);
    assert.equal(inv.validZoneShape([[0, 0], [1, 0], ['1', 1]]), false);
    assert.equal(inv.validZoneShape([[0, 0], [1, 0], [NaN, 1]]), false);
    assert.equal(inv.validZoneShape(Array.from({ length: 201 }, () => [0.5, 0.5])), false);
    assert.equal(inv.validZoneShape(null), false);
    assert.deepEqual(inv.fitWithin(8000, 4500), { width: 4000, height: 2250, scaled: true });
    assert.deepEqual(inv.fitWithin(3000, 9000), { width: 1333, height: 4000, scaled: true });
    assert.deepEqual(inv.fitWithin(4000, 1000), { width: 4000, height: 1000, scaled: false });
    assert.deepEqual(inv.fitWithin(800, 600), { width: 800, height: 600, scaled: false }, 'small plans are never enlarged');
    assert.equal(inv.sitePlanPath('p-1', 'm-1', 'image/jpeg'), 'p-1/m-1.jpg');
    assert.equal(inv.sitePlanPath('p-1', 'm-1', 'image/webp'), 'p-1/m-1.webp');
    assert.throws(() => inv.sitePlanPath('p-1', 'm-1', 'application/pdf'), /PNG, JPG or WEBP/);
});

test('progress and filters follow count status, source, category subtree, zone and search', () => {
    const records = [
        { id: 1, qr_code: 'GT2-1', inventory_item: 'Cooler', count_status: 'expected', source: 'import', category_id: 'cool', zone_id: null },
        { id: 2, qr_code: 'GT2-2', inventory_item: 'Filter', part_number: 'LOF-220', count_status: 'counted', source: 'import', category_id: 'lube', zone_id: 'z1' },
        { id: 3, qr_code: 'EL-1', inventory_item: 'Drum', count_status: 'counted', source: 'field', category_id: 'elec', zone_id: 'z2' },
        { id: 4, qr_code: 'GT2-3', inventory_item: 'Skid', count_status: 'received', source: 'import', category_id: null, zone_id: 'z1' },
        { id: 5, qr_code: 'OLD-1', inventory_item: 'Legacy pipe', count_status: 'counted', source: 'legacy', category_id: 'elec', zone_id: null },
    ];
    assert.deepEqual(inv.countProgress(records), { expected: 1, counted: 3, received: 1, newTags: 1, imported: 3, importedFound: 2, total: 5 });
    const ids = filters => inv.filterRecords(records, filters).map(record => record.id);
    const { byId } = inv.buildCategoryTree(categories);
    assert.deepEqual(ids({ categoryIds: inv.descendantIds(byId, 'lube') }), [1, 2]);
    assert.deepEqual(ids({ categoryIds: new Set([null]) }), [4]);
    assert.deepEqual(ids({ zoneIds: new Set(['z1']) }), [2, 4]);
    assert.deepEqual(ids({ zoneIds: new Set(['z1', 'z2']) }), [2, 3, 4]);
    assert.deepEqual(ids({ zoneIds: new Set([null]) }), [1, 5]);
    assert.deepEqual(ids({ status: 'new' }), [3]);
    assert.deepEqual(ids({ status: 'counted', zoneIds: new Set(['z1']) }), [2]);
    assert.deepEqual(ids({ search: ' lof ' }), [2]);
    assert.deepEqual(ids({ search: 'gt2' }), [1, 2, 4]);
    assert.deepEqual(ids({}), [1, 2, 3, 4, 5]);
});

test('CSV export quotes where needed and defuses cells a spreadsheet would run as formulas', () => {
    assert.equal(inv.csvCell('plain'), 'plain');
    assert.equal(inv.csvCell(null), '');
    assert.equal(inv.csvCell(1.5), '1.5');
    assert.equal(inv.csvCell('Valve, 6" gate'), '"Valve, 6"" gate"');
    assert.equal(inv.csvCell('two\nlines'), '"two\nlines"');
    assert.equal(inv.csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
    for (const risky of ['+1', '-1', '@SUM(A1)']) assert.equal(inv.csvCell(risky)[0], "'");
    assert.equal(inv.toCsv(['tag', 'name'], [['A-1', 'Pump, small']]), 'tag,name\r\nA-1,"Pump, small"\r\n');
    const roundTrip = inv.parseCsv(inv.toCsv(['tag', 'name'], [['A-1', 'Valve, 6" gate']]));
    assert.deepEqual(roundTrip, [['tag', 'name'], ['A-1', 'Valve, 6" gate']], 'an export can be imported again');
});

test('database errors become plain messages', () => {
    assert.match(inv.errorMessage({ code: 'PGRST205', message: 'Could not find the table' }), /migration 019/);
    assert.match(inv.errorMessage({ code: '42P01' }), /migration 019/);
    assert.equal(inv.errorMessage({ code: '23505' }, 'Name taken.'), 'Name taken.');
    assert.match(inv.errorMessage({ code: '42501' }), /permission/);
    assert.equal(inv.errorMessage({ code: '22023', message: 'Pin must be on the map' }), 'Pin must be on the map');
    assert.equal(inv.errorMessage(new Error('offline')), 'offline');
});

const areas = [
    { id: 'yard', map_id: 'm1', parent_id: null, name: 'T1 Pipe Racks', sort_order: 10, is_active: true, shape: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]] },
    { id: 'rack2', map_id: 'm1', parent_id: 'yard', name: 'Rack 2', sort_order: 20, is_active: true, shape: [[0.3, 0.2], [0.5, 0.2], [0.5, 0.4], [0.3, 0.4]] },
    { id: 'rack1', map_id: 'm1', parent_id: 'yard', name: 'Rack 1', sort_order: 10, is_active: true, shape: [[0.12, 0.2], [0.28, 0.2], [0.28, 0.4], [0.12, 0.4]] },
    { id: 'shelf', map_id: 'm1', parent_id: 'rack2', name: 'Shelf A', sort_order: 10, is_active: true, shape: [[0.32, 0.22], [0.4, 0.22], [0.4, 0.3]] },
    { id: 'old', map_id: 'm1', parent_id: null, name: 'Old Bay', sort_order: 30, is_active: false, shape: [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9]] },
    { id: 'oldA', map_id: 'm1', parent_id: 'old', name: 'Old Bay A', sort_order: 10, is_active: true, shape: [[0.7, 0.7], [0.8, 0.7], [0.8, 0.8]] },
    { id: 'other', map_id: 'm2', parent_id: null, name: 'South Laydown', sort_order: 10, is_active: true, shape: [[0, 0], [1, 0], [1, 1]] },
];

test('map areas nest into one tree with full path labels and sub-area filters', () => {
    const { roots, byId } = inv.buildTree(areas);
    assert.deepEqual(roots.map(node => node.id), ['other', 'yard', 'old'], 'same sort_order falls back to name');
    assert.deepEqual(byId.get('yard').children.map(node => node.id), ['rack1', 'rack2'], 'siblings follow sort_order');
    assert.equal(inv.pathLabel(byId, 'shelf'), 'T1 Pipe Racks › Rack 2 › Shelf A');
    assert.equal(inv.pathLabel(byId, 'missing'), '');
    assert.deepEqual([...inv.descendantIds(byId, 'yard')].sort(), ['rack1', 'rack2', 'shelf', 'yard']);
    assert.deepEqual(inv.flattenTree(roots, new Set(['yard'])).map(row => row.node.id), ['other', 'yard', 'old', 'oldA']);
    assert.deepEqual(inv.buildCategoryTree([{ id: 'a', name: 'A', status: 'archived' }, { id: 'b', name: 'B', status: 'active' }]).roots.map(node => node.id), ['b'],
        'categories still leave archived rows out by default');
});

test('an inactive area hides itself and everything inside it from field crews', () => {
    const { byId } = inv.buildTree(areas);
    assert.equal(inv.inactiveAncestor(byId, 'old').id, 'old');
    assert.equal(inv.inactiveAncestor(byId, 'oldA').id, 'old');
    assert.equal(inv.inactiveAncestor(byId, 'shelf'), null);
    assert.equal(inv.inactiveAncestor(byId, null), null);
    assert.equal(inv.inactiveAncestor(new Map([['x', { id: 'x', name: 'X' }]]), 'x'), null, 'rows without is_active (before 020) count as active');
});

test('parent choices stay on the same map and never include the area itself or its sub-areas', () => {
    const choices = (zoneId, mapId = 'm1') => inv.parentChoices(areas, mapId, zoneId).map(row => `${row.depth}:${row.node.id}`);
    assert.deepEqual(choices(null), ['0:yard', '1:rack1', '1:rack2', '2:shelf', '0:old', '1:oldA']);
    assert.deepEqual(choices('rack2'), ['0:yard', '1:rack1', '0:old', '1:oldA']);
    assert.deepEqual(choices('yard'), ['0:old', '1:oldA']);
    assert.deepEqual(choices(null, 'm2'), ['0:other']);
});

test('outline checks warn when a child leaves its parent but accept shared edges', () => {
    const square = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]];
    assert.equal(inv.pointInPolygon([0.3, 0.3], square), true);
    assert.equal(inv.pointInPolygon([0.6, 0.3], square), false);
    assert.equal(inv.outlineOutside([[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]], square), false);
    assert.equal(inv.outlineOutside([[0.3, 0.2], [0.5, 0.2], [0.5, 0.4], [0.3, 0.4]], square), false, 'drawn against the parent edge');
    assert.equal(inv.outlineOutside([[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]], square), false, 'sharing the parent corner');
    assert.equal(inv.outlineOutside([[0.4, 0.2], [0.6, 0.2], [0.6, 0.4], [0.4, 0.4]], square), true, 'two corners outside');
    const notch = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.3, 0.3], [0.1, 0.5]];
    assert.equal(inv.outlineOutside([[0.2, 0.35], [0.4, 0.35], [0.4, 0.45], [0.2, 0.45]], notch), true, 'all corners inside, but an edge crosses the notch');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isProjectScopedTable } = require('../js/utils/project-scope');

const sidebar = fs.readFileSync('js/utils/sidebar.js', 'utf8');
const pages = {
    'inventory-categories.html': { script: 'inventory-categories.js', title: 'Inventory Categories', ids: ['categoryTree', 'proposedList', 'addRootCategory', 'categoryDialog'] },
    'site-maps.html': { script: 'site-maps.js', title: 'Site Maps', ids: ['siteMap', 'zoneList', 'zoneEditor', 'mapDialog'], leaflet: true },
    'initial-inventory.html': { script: 'initial-inventory.js', title: 'Initial Inventory', ids: ['kpiExpected', 'filterCategory', 'itemRows', 'inventoryMap', 'itemDrawer', 'importDialog'], leaflet: true },
};

test('each office page uses the shared shell, is open to project members, and is in the sidebar', () => {
    for (const [file, page] of Object.entries(pages)) {
        const html = fs.readFileSync(file, 'utf8');
        assert.match(html, /<body>\n<section class="work-page">/, `${file}: members can open it; office actions are gated in the script`);
        assert.match(html, /<p id="pageMessage" role="status" aria-live="polite" tabindex="-1">/, file);
        assert.match(html, /<dialog id="\w+" class="review-drawer[^"]*" aria-labelledby="\w+">/, file);
        for (const script of ['js/utils/auth-guard.js', 'js/utils/project-scope.js', 'js/utils/sidebar.js', 'js/utils/inventory-helpers.js', page.script]) {
            assert.match(html, new RegExp(`src="${script.replaceAll('.', '\\.')}\\?v=`), `${file} loads ${script}`);
        }
        for (const id of page.ids) assert.match(html, new RegExp(`id="${id}"`), `${file} has #${id}`);
        assert.ok(html.indexOf('inventory-helpers.js') < html.indexOf(`src="${page.script}`), `${file}: helpers load before the page script`);
        assert.match(sidebar, new RegExp(`href: '${file.replace('.', '\\.')}'`), `${file} is in NAV_ITEMS`);
        assert.match(sidebar, new RegExp(`'${file.replace('.', '\\.')}': '${page.title}'`), `${file} is in PAGE_TITLES`);
        if (page.leaflet) {
            assert.match(html, /unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/, `${file} uses the Leaflet already on GPS Tracking`);
            assert.match(html, /unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/, file);
            assert.ok(html.indexOf('leaflet.js') < html.indexOf('site-map-view.js'), `${file}: Leaflet loads before the map view`);
        }
    }
    assert.match(fs.readFileSync('samsara-tracking.html', 'utf8'), /leaflet@1\.9\.4/, 'same Leaflet version as GPS Tracking');
});

test('page scripts gate office actions, build text with textContent, and give Leaflet only text nodes', () => {
    for (const file of ['inventory-categories.js', 'site-maps.js', 'initial-inventory.js', 'js/utils/site-map-view.js', 'js/utils/inventory-helpers.js']) {
        const js = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, `${file} never parses strings as HTML`);
        assert.doesNotMatch(js, /bindTooltip\((?!textNode\(|siteMapView\.textNode\()/, `${file}: Leaflet tooltips get DOM nodes, not HTML strings`);
        assert.doesNotMatch(js, /bindPopup\(/, `${file}: no HTML popups`);
    }
    for (const file of ['inventory-categories.js', 'site-maps.js', 'initial-inventory.js']) {
        const js = fs.readFileSync(file, 'utf8');
        assert.match(js, /await window\.InvenioAuthReady/, file);
        assert.match(js, /const office = \['office_staff', 'admin'\]\.includes\(profile\.role\) && InvenioProjectScope\.activeProject\.status === 'active';/, file);
    }
});

test('initial inventory uses the contract functions and a pinned, integrity-checked SheetJS', () => {
    const js = fs.readFileSync('initial-inventory.js', 'utf8');
    assert.match(js, /src: 'https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\/xlsx\.full\.min\.js', integrity: 'sha512-[A-Za-z0-9+/=]{88}'/);
    assert.match(js, /crossOrigin: 'anonymous'/);
    assert.match(js, /rpc\('import_inventory_items', \{ p_project_id: projectId, p_items: prepared\.items, p_dry_run: true \}\)/);
    assert.match(js, /rpc\('import_inventory_items', \{ p_project_id: projectId, p_items: preview\.items, p_dry_run: false \}\)/);
    assert.match(js, /storage\.from\('inventory-photos'\)\.createSignedUrl\(/);
    assert.match(fs.readFileSync('inventory-categories.js', 'utf8'), /rpc\('merge_inventory_category', \{ p_from: source\.id, p_into: select\.value \}\)/);
    const maps = fs.readFileSync('site-maps.js', 'utf8');
    assert.match(maps, /storage\.from\('site-plans'\)\.upload\(path, prepared\.blob/);
    assert.match(maps, /inv\.fitWithin\(image\.naturalWidth, image\.naturalHeight, 4000\)/);
});

test('new inventory tables are project scoped for reads and writes', () => {
    for (const table of ['inventory_categories', 'site_maps', 'site_map_zones', 'inventory_photos', 'inventory_records', 'locations']) {
        assert.equal(isProjectScopedTable(table), true, table);
    }
});

test('Yard Inventory builds item checkboxes without markup', () => {
    const page = fs.readFileSync('inventory.html', 'utf8');
    assert.doesNotMatch(page, /value="' \+ item \+ '"/);
    assert.match(page, /input\.value = item;/);
    assert.match(page, /label\.textContent = item;/);
});

test('site maps never delete areas (the database refuses; they are made inactive instead)', () => {
    const js = fs.readFileSync('site-maps.js', 'utf8');
    assert.doesNotMatch(js, /\.delete\(\)/);
    assert.match(js, /is_active: false/);
});

test('initial inventory filters by area subtree and shows full area paths', () => {
    const js = fs.readFileSync('initial-inventory.js', 'utf8');
    assert.match(js, /zoneIds: !zone \? null : zone === 'none' \? new Set\(\[null\]\) : inv\.descendantIds\(zoneTree\.byId, zone\)/);
    assert.match(js, /const zoneName = id => id \? inv\.pathLabel\(zoneTree\.byId, id\) : ''/);
    assert.match(js, /fetchAll\('site_map_zones', '\*'\)/, 'works before and after the nested-area columns exist');
    assert.match(fs.readFileSync('initial-inventory.html', 'utf8'), /<label for="filterZone">Area<select/);
    assert.match(js, /'site_map', 'zone', 'pin_x'/, 'the CSV keeps its zone column (now the full path) for existing spreadsheets');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isProjectScopedTable } = require('../js/utils/project-scope');

const sidebar = fs.readFileSync('js/utils/sidebar.js', 'utf8');
const pages = {
    'places.html': { script: 'places.js', title: 'Places', ids: ['addPlace', 'filterKind', 'filterSearch', 'showActive', 'showRetired', 'placeRows', 'placesMap', 'placeDrawer'], leaflet: true },
    'handling-units.html': { script: 'handling-units.js', title: 'Crates', ids: ['printLabels', 'filterStatus', 'filterSearch', 'unitRows', 'unitDrawer', 'labelDialog'] },
};

test('Places and Crates use the shared shell, load their helpers first, and are under Logistics in the sidebar', () => {
    for (const [file, page] of Object.entries(pages)) {
        const html = fs.readFileSync(file, 'utf8');
        assert.match(html, /<body>\n<section class="work-page">/, `${file}: members can open it; office actions are gated in the script`);
        assert.match(html, /<p id="pageMessage" role="status" aria-live="polite" tabindex="-1">/, file);
        assert.match(html, /<dialog id="\w+" class="review-drawer" aria-labelledby="\w+">/, file);
        for (const script of ['js/utils/auth-guard.js', 'js/utils/project-scope.js', 'js/utils/sidebar.js', 'js/utils/logistics-helpers.js', page.script]) {
            assert.match(html, new RegExp(`src="${script.replaceAll('.', '\\.')}\\?v=`), `${file} loads ${script}`);
        }
        for (const id of page.ids) assert.match(html, new RegExp(`id="${id}"`), `${file} has #${id}`);
        assert.ok(html.indexOf('logistics-helpers.js') < html.indexOf(`src="${page.script}`), `${file}: helpers load before the page script`);
        assert.match(sidebar, new RegExp(`'${file.replace('.', '\\.')}': '${page.title}'`), `${file} is in PAGE_TITLES`);
        assert.equal(/leaflet@1\.9\.4\/dist\/leaflet\.js/.test(html), Boolean(page.leaflet), `${file}: Leaflet only where there is a map`);
    }
    assert.ok(fs.readFileSync('places.html', 'utf8').indexOf('inventory-helpers.js') < fs.readFileSync('places.html', 'utf8').indexOf('src="places.js'), 'Places uses the shared save lock');
    const logisticsNav = sidebar.slice(sidebar.indexOf("section: 'Logistics'"), sidebar.indexOf("section: 'Planning'"));
    assert.match(logisticsNav, /label: 'Outside Shops', +icon: '[\w-]+', +href: 'outside-shop-inventory\.html'/, 'Outside Shops stays');
    assert.match(logisticsNav, /label: 'Places', +icon: '[\w-]+', +href: 'places\.html'/);
    assert.match(logisticsNav, /label: 'Crates', +icon: '[\w-]+', +href: 'handling-units\.html'/);
    assert.doesNotMatch(sidebar, /href: 'shop-contacts\.html'/, 'Places replaces Shop Contacts in the sidebar');
    assert.ok(fs.existsSync('shop-contacts.html'), 'the old page itself is left alone');
});

test('the QR library is an exact cdnjs version with an integrity hash', () => {
    const html = fs.readFileSync('handling-units.html', 'utf8');
    assert.match(html, /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\/1\.4\.4\/qrcode\.min\.js" integrity="sha512-[A-Za-z0-9+/]{86}==" crossorigin="anonymous" referrerpolicy="no-referrer"><\/script>/);
});

test('page scripts never parse strings as HTML and give Leaflet only text nodes', () => {
    for (const file of ['places.js', 'handling-units.js', 'js/utils/logistics-helpers.js']) {
        const js = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, `${file} never parses strings as HTML`);
        assert.doesNotMatch(js, /bindTooltip\((?!textNode\()/, `${file}: Leaflet tooltips get DOM nodes`);
        assert.doesNotMatch(js, /bindPopup\(|divIcon\(\{[^}]*html:/, `${file}: no HTML popups or icons`);
    }
    for (const file of ['places.js', 'handling-units.js']) assert.match(fs.readFileSync(file, 'utf8'), /await window\.InvenioAuthReady/, file);
});

test('places are read and written with the unscoped client; crates through the project scope', () => {
    const places = fs.readFileSync('places.js', 'utf8'), crates = fs.readFileSync('handling-units.js', 'utf8');
    assert.match(places, /supabaseClient\.from\('places'\)/);
    assert.doesNotMatch(places, /projectSupabaseClient/);
    assert.doesNotMatch(places, /\.delete\(/, 'places are retired, never deleted');
    assert.match(crates, /projectSupabaseClient\.from\(table\)/);
    assert.doesNotMatch(crates, /\.(insert|update|upsert|delete)\(/, 'crates are read-only here; the field packs them');
    assert.match(crates, /rpc\('reserve_handling_unit_labels', \{ p_project_id: projectId, p_count: parsed\.count \}\)/);
    for (const table of ['handling_units', 'handling_unit_contents', 'handling_unit_overview', 'handling_unit_items']) assert.equal(isProjectScopedTable(table), true, table);
    assert.equal(isProjectScopedTable('places'), false, 'places are shared by every project');
});

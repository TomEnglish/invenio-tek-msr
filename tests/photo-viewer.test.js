// Runs js/utils/photo-viewer.js against the fake DOM and a fake Supabase that records each request:
// which photos a record has, the button and thumbnails, and the viewer's links, keys and focus.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fakeDocument, settle, assertFocus } = require('./support/fake-dom');

const source = fs.readFileSync('js/utils/photo-viewer.js', 'utf8');
const RECEIPT = 'c1111111-1111-4111-8111-111111111111';
// Values made inside the page's context, as plain data that compares with this file's.
const plain = value => JSON.parse(JSON.stringify(value));
const ITEM = 'a1000000-0000-4000-8000-000000000000';

function fakeSupabase(tables = {}, { failing = new Set(), slow = false } = {}) {
    const requests = [], signing = [], flight = { now: 0, most: 0 };
    class Query {
        constructor(table, scoped) { Object.assign(this, { table, scoped, calls: [] }); requests.push(this); }
        then(resolve, reject) {
            let rows = tables[this.table] || [];
            for (const [name, key, values] of this.calls) if (name === 'in') rows = rows.filter(row => values.includes(String(row[key])));
            const range = this.calls.find(([name]) => name === 'range');
            if (range) rows = rows.slice(range[1], range[2] + 1);
            const answer = { data: rows.map(row => ({ ...row })), error: null };
            if (!slow) return Promise.resolve(answer).then(resolve, reject);
            flight.now++; flight.most = Math.max(flight.most, flight.now);
            return new Promise(done => setTimeout(() => { flight.now--; done(answer); }, 2)).then(resolve, reject);
        }
    }
    for (const name of ['select', 'in', 'eq', 'order', 'range']) Query.prototype[name] = function (...args) { this.calls.push([name, ...args]); return this; };
    let n = 0;
    const link = (bucket, path) => `https://files.test/${bucket}/${path}?link=${++n}`;
    const storage = {
        from: bucket => ({
            createSignedUrl: async (path, seconds) => {
                signing.push({ bucket, paths: [path], seconds });
                return failing.has(path) ? { data: null, error: { message: 'Object not found' } } : { data: { signedUrl: link(bucket, path) }, error: null };
            },
            createSignedUrls: async (paths, seconds) => {
                signing.push({ bucket, paths, seconds });
                // In reverse, so a page that relied on the order would show the wrong photo.
                return { data: [...paths].reverse().map(path => failing.has(path) ? { path, error: 'Object not found', signedUrl: null } : { path, error: null, signedUrl: link(bucket, path) }), error: null };
            },
        }),
    };
    return {
        requests, signing, flight,
        raw: { from: table => new Query(table, false), storage },
        scoped: { from: table => { const query = new Query(table, true); query.calls.push(['eq', 'project_id', 'project-1']); return query; } },
    };
}

function setup(tables, options) {
    const { document } = fakeDocument();
    const fake = fakeSupabase(tables, options);
    const context = { document, console, supabaseClient: fake.raw, projectSupabaseClient: fake.scoped,
        InvenioProjectScope: { getActiveProjectId: () => 'project-1' } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    return { document, context, photos: context.InvenioPhotos, fake };
}

const receiptRow = (n, type, at, receipt = RECEIPT) => ({ receiving_record_id: receipt, storage_path: `${receipt}/op-${n}-${type}.jpg`, photo_type: type, created_at: at });
const countRow = (n, at, uid = ITEM) => ({ inventory_uid: uid, storage_path: `${uid}/op-${n}.jpg`, created_at: at });
const overlay = page => page.document.body.querySelector('.photo-viewer');

test('a receipt\'s photos are found by its ID and labeled by type; count photos are asked for in the active project', async () => {
    const page = setup({
        inspection_photos: [receiptRow(1, 'damage', '2026-09-08T12:05:00Z'), receiptRow(0, 'general', '2026-09-08T12:04:00Z'), receiptRow(2, 'general', '2026-09-08T12:00:00Z', 'other')],
        inventory_photos: [countRow(1, '2026-10-26T15:00:00Z')],
    });
    const receipts = await page.photos.load('receipt', [RECEIPT, null, '', RECEIPT]);
    const [request] = page.fake.requests;
    assert.equal(request.table, 'inspection_photos');
    assert.equal(request.scoped, false, 'receiving photos have no project of their own');
    assert.deepEqual(plain(request.calls.find(([name]) => name === 'in')), ['in', 'receiving_record_id', [RECEIPT]], 'each ID once, empty ones left out');
    assert.deepEqual([...receipts.keys()], [RECEIPT]);
    assert.deepEqual(plain(receipts.get(RECEIPT).map(photo => [photo.bucket, photo.label])),
        [['inspection-photos', 'Receiving photo: General'], ['inspection-photos', 'Receiving photo: Damage']], 'oldest first, whatever order they came in');

    const counts = await page.photos.load('count', [ITEM]);
    const countRequest = page.fake.requests.at(-1);
    assert.equal(countRequest.scoped, true);
    assert.deepEqual(plain(counts.get(ITEM).map(photo => [photo.bucket, photo.path, photo.label])), [['inventory-photos', `${ITEM}/op-1.jpg`, 'Count photo']]);
    // merge: every source, each photo once, oldest first by the moment taken (not by the text).
    const merged = page.photos.merge(receipts.get(RECEIPT), counts.get(ITEM), counts.get(ITEM));
    assert.deepEqual(plain(merged.map(photo => photo.takenAt)), ['2026-09-08T12:04:00Z', '2026-09-08T12:05:00Z', '2026-10-26T15:00:00Z']);
    const second = [{ takenAt: '2026-10-27T19:05:00.5+00:00', bucket: 'b', path: 'later' }, { takenAt: '2026-10-27T19:05:00+00:00', bucket: 'b', path: 'first' }, { takenAt: null, bucket: 'b', path: 'none' }];
    assert.deepEqual(plain(page.photos.merge(second).map(photo => photo.path)), ['first', 'later', 'none']);
});

test('a receipt\'s photos include the count photos of an item counted before it was received', async () => {
    const page = setup({
        inspection_photos: [receiptRow(0, 'damage', '2026-09-08T12:04:00Z')],
        inventory_records: [{ uid: ITEM, receiving_record_id: RECEIPT }, { uid: 'other', receiving_record_id: 'another' }],
        inventory_photos: [countRow(1, '2026-09-01T09:00:00Z'), countRow(2, '2026-09-02T09:00:00Z', 'other')],
    });
    const found = await page.photos.loadForReceipts([RECEIPT, 'no-photos']);
    assert.deepEqual([...found.keys()], [RECEIPT], 'a receipt with no photos is left out');
    assert.deepEqual(plain(found.get(RECEIPT).map(photo => photo.label)), ['Count photo', 'Receiving photo: Damage']);
    const counted = page.fake.requests.find(request => request.table === 'inventory_records');
    assert.equal(counted.scoped, true, 'items are asked for in the active project');
    assert.deepEqual(plain(counted.calls.find(([name]) => name === 'in')), ['in', 'receiving_record_id', [RECEIPT, 'no-photos']]);
});

test('many IDs are asked for 100 at a time, four requests at most at once; whole-project photos page until one comes back empty', async () => {
    const uids = Array.from({ length: 1000 }, (_, i) => `uid-${i}`);
    const rows = Array.from({ length: 1001 }, (_, i) => countRow(i, `2026-10-26T15:00:${String(i % 60).padStart(2, '0')}Z`, `uid-${i % 250}`));
    const page = setup({ inventory_photos: rows }, { slow: true });
    const found = await page.photos.load('count', uids);
    assert.equal(page.fake.requests.length, 10);
    assert.ok(page.fake.requests.every(request => request.calls.find(([name]) => name === 'in')[2].length === 100));
    assert.equal(page.fake.flight.most, 4, 'no more than four at a time');
    assert.equal([...found.values()].flat().length, 1001);
    page.fake.requests.length = 0;
    const all = await page.photos.loadAll('count');
    assert.deepEqual(page.fake.requests.map(request => plain(request.calls.find(([name]) => name === 'range').slice(1))), [[0, 999], [1000, 1999], [1001, 2000]]);
    assert.deepEqual(plain(page.fake.requests[0].calls.filter(([name]) => name === 'order').map(([, key]) => key)), ['created_at', 'id'], 'a fixed order across pages');
    assert.ok(page.fake.requests.every(request => request.scoped), 'in the active project only');
    assert.equal([...all.values()].flat().length, 1001);

    const receipts = setup({ inspection_photos: [receiptRow(0, 'general', '2026-09-08T12:00:00Z')] });
    const byReceipt = await receipts.photos.loadAll('receipt');
    const first = receipts.fake.requests[0];
    assert.equal(first.calls.find(([name]) => name === 'select')[1], 'id,receiving_record_id,storage_path,photo_type,created_at,receiving_records!inner(project_id)');
    assert.deepEqual(plain(first.calls.find(([name]) => name === 'eq')), ['eq', 'receiving_records.project_id', 'project-1'], 'through the receipt\'s project');
    assert.deepEqual([...byReceipt.keys()], [RECEIPT]);
});

test('the photo button says how many and carries only numbers into the markup', () => {
    const page = setup();
    assert.equal(page.photos.chipHtml(1, 4), '<button type="button" class="photo-chip" data-photo-index="4" aria-label="Open 1 photo"><i class="fas fa-camera" aria-hidden="true"></i> 1</button>');
    assert.match(page.photos.chipHtml(3, 0), /aria-label="Open 3 photos"/);
    assert.doesNotMatch(page.photos.chipHtml('<img>', '"><b>'), /<img|<b>/);
});

test('thumbnails get their links in one request per storage area, matched by path; one that fails says so', async () => {
    const photos = [receiptRow(0, 'general', '2026-09-08T12:00:00Z'), receiptRow(1, 'damage', '2026-09-08T12:01:00Z')];
    const page = setup({}, { failing: new Set([photos[1].storage_path]) });
    const list = [...photos.map(row => page.photos.fromRow('receipt', row)), page.photos.fromRow('count', countRow(1, '2026-10-26T15:00:00Z'))];
    const container = page.document.createElement('div');
    await page.photos.strip(container, list);
    assert.deepEqual(page.fake.signing.map(call => [call.bucket, call.paths.length, call.seconds]), [['inspection-photos', 2, 300], ['inventory-photos', 1, 300]]);
    const thumbs = container.querySelectorAll('button');
    assert.equal(thumbs.length, 3);
    assert.match(thumbs[0].querySelector('img').src, new RegExp(`/inspection-photos/${RECEIPT}/op-0-general.jpg`), 'its own photo, whatever order the links came back in');
    assert.equal(thumbs[1].querySelector('img'), null);
    assert.equal(thumbs[1].querySelector('.photo-thumb-missing').textContent, 'Unavailable');
    assert.equal(thumbs[2].getAttribute('aria-label'), 'Open photo 3 of 3: Count photo');

    // A link that has lapsed by the time the thumbnail loads: a new one is asked for once, then it says so.
    const before = page.fake.signing.length;
    const image = thumbs[0].querySelector('img');
    image.dispatch('error');
    await settle();
    assert.equal(page.fake.signing.length, before + 1);
    assert.match(image.src, /op-0-general\.jpg\?link=\d+$/);
    image.dispatch('error');
    await settle();
    assert.equal(thumbs[0].querySelector('img'), null);
    assert.equal(thumbs[0].querySelector('.photo-thumb-missing').textContent, 'Unavailable');

    const large = page.document.createElement('div');
    await page.photos.strip(large, list.slice(0, 1), { large: true });
    assert.match(large.querySelector('.photo-thumb-caption').textContent, /^Receiving photo: General · Sep 8, 2026, \d{1,2}:00 (AM|PM)$/);
    const empty = page.document.createElement('div');
    await page.photos.strip(empty, []);
    assert.equal(empty.textContent, 'No photos attached.');
});

test('the viewer opens each photo through a fresh link, pages with buttons and arrow keys, keeps focus, and returns it', async () => {
    const page = setup();
    const list = [receiptRow(0, 'damage', '2026-09-08T12:00:00Z'), receiptRow(1, 'delivery_ticket', '2026-09-08T12:01:00Z')].map(row => page.photos.fromRow('receipt', row));
    const trigger = page.document.createElement('button');
    page.document.body.append(trigger);
    page.photos.open(list, 1, trigger);
    await settle();
    const viewer = overlay(page);
    assert.equal(viewer.getAttribute('role'), 'dialog');
    assert.equal(viewer.getAttribute('aria-modal'), 'true');
    const close = viewer.querySelector('.photo-viewer-close');
    assertFocus(page, close, 'focus starts on Close');
    assert.match(viewer.querySelector('.photo-viewer-caption').textContent, /^Receiving photo: Delivery ticket · Sep 8, 2026, .* · 2 of 2$/);
    const image = viewer.querySelector('.photo-viewer-image');
    assert.equal(image.hidden, false);
    assert.match(image.src, /op-1-delivery_ticket\.jpg\?link=1$/);
    assert.equal(image.alt, 'Receiving photo: Delivery ticket');
    const full = viewer.querySelector('a');
    assert.equal(full.href, image.src);
    assert.equal(full.rel, 'noopener');

    const [previous, next] = viewer.querySelector('.photo-viewer-nav').querySelectorAll('button');
    next.dispatch('click');
    await settle();
    assert.match(image.src, /op-0-damage\.jpg\?link=2$/, 'Next wraps to the first photo with a new link');
    close.dispatch('keydown', { key: 'ArrowLeft' });
    await settle();
    assert.match(image.src, /op-1-delivery_ticket\.jpg\?link=3$/);
    assert.equal(page.fake.signing.length, 3, 'one link per photo shown');
    assert.ok(previous);

    // Tab from the last control wraps to Close; Shift+Tab from Close goes to the last.
    full.focus();
    full.dispatch('keydown', { key: 'Tab' });
    assertFocus(page, close, 'Tab wraps inside the viewer');
    close.dispatch('keydown', { key: 'Tab', shiftKey: true });
    assertFocus(page, full, 'Shift+Tab wraps back');
    // Paging from Open full size hides it while the next photo loads: focus stays in the viewer.
    full.dispatch('keydown', { key: 'ArrowRight' });
    assertFocus(page, viewer, 'focus moves to the viewer, not out of it');
    assert.equal(viewer.getAttribute('tabindex'), '-1', 'a click on the photo focuses the viewer');
    await settle();
    viewer.dispatch('keydown', { key: 'ArrowRight' });
    await settle();
    assert.match(viewer.querySelector('.photo-viewer-caption').textContent, / · 2 of 2$/, 'keys work with focus on the viewer itself');
    viewer.dispatch('keydown', { key: 'Tab' });
    assertFocus(page, close, 'Tab from the viewer goes to Close');

    close.dispatch('keydown', { key: 'Escape' });
    assert.equal(overlay(page), null);
    assertFocus(page, trigger, 'focus returns to what opened it');
});

test('a photo that cannot be opened says so, and the viewer sits inside an open dialog so the dialog keeps focus', async () => {
    const page = setup({}, { failing: new Set([`${RECEIPT}/op-0-damage.jpg`]) });
    const modal = page.document.createElement('div');
    modal.className = 'modal show';
    const trigger = page.document.createElement('button');
    modal.append(trigger);
    page.document.body.append(modal);
    page.photos.open([page.photos.fromRow('receipt', receiptRow(0, 'damage', null))], 0, trigger);
    await settle();
    const viewer = modal.querySelector('.photo-viewer');
    assert.ok(viewer, 'inside the open dialog');
    assert.equal(viewer.querySelector('.photo-viewer-caption').textContent, 'Receiving photo: Damage', 'one photo: no position, and no time when none was recorded');
    assert.equal(viewer.querySelector('.photo-viewer-nav').querySelectorAll('button').length, 0, 'no paging for one photo');
    assert.equal(viewer.querySelector('.photo-viewer-image').hidden, true);
    assert.match(viewer.querySelector('.photo-viewer-status').textContent, /could not be opened/);
    // A click on the dimmed area outside the photo closes it.
    viewer.dispatch('click');
    assert.equal(modal.querySelector('.photo-viewer'), null);
    // The dialog closing closes the viewer in it, so it can't show over the next record.
    page.photos.open([page.photos.fromRow('receipt', receiptRow(1, 'general', null))], 0, trigger);
    await settle();
    assert.ok(modal.querySelector('.photo-viewer'));
    modal.dispatch('hide.bs.modal');
    assert.equal(modal.querySelector('.photo-viewer'), null);
    // An image that fails to load after its link was given says so.
    page.photos.open([page.photos.fromRow('receipt', receiptRow(2, 'general', null))], 0, trigger);
    await settle();
    const shown = modal.querySelector('.photo-viewer-image');
    assert.equal(shown.hidden, false);
    shown.dispatch('error');
    assert.equal(shown.hidden, true);
    assert.match(modal.querySelector('.photo-viewer-status').textContent, /could not be opened/);
    page.photos.close();
    page.photos.open([], 0, trigger);
    assert.equal(page.document.body.querySelector('.photo-viewer'), null, 'nothing to show, nothing opens');
});

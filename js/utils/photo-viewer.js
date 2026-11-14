/**
 * Item photos on office pages: which photos a receipt or counted item has, a
 * button that says how many, a row of thumbnails, and a viewer that opens them
 * large. Photos are kept in private storage, so each one opens through its own
 * link that stops working after 5 minutes; the viewer asks for a fresh link
 * every time it shows a photo, and a thumbnail whose link has lapsed asks again.
 */
(function initInvenioPhotos(global) {
    'use strict';

    const LINK_SECONDS = 300;
    // IDs per request: short enough for the request line, whatever the page holds.
    const CHUNK = 100;
    // Requests at a time, however many items a page lists.
    const AT_ONCE = 4;
    const PAGE = 1000;
    const TYPE_LABELS = { general: 'General', damage: 'Damage', delivery_ticket: 'Delivery ticket' };
    // receipt: taken while receiving, by receiving record. count: taken while counting, by the item's uid.
    const KINDS = {
        receipt: { bucket: 'inspection-photos', table: 'inspection_photos', key: 'receiving_record_id', columns: 'id,receiving_record_id,storage_path,photo_type,created_at' },
        count: { bucket: 'inventory-photos', table: 'inventory_photos', key: 'inventory_uid', columns: 'id,inventory_uid,storage_path,created_at', scoped: true },
    };
    const TAKEN_FORMAT = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };

    function takenText(value) {
        const date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('en-US', TAKEN_FORMAT) : '';
    }

    /** One photo, from an inspection_photos ('receipt') or inventory_photos ('count') row. */
    function fromRow(kind, row) {
        const spec = KINDS[kind];
        return {
            kind,
            bucket: spec.bucket,
            path: row.storage_path,
            key: String(row[spec.key] ?? ''),
            label: kind === 'receipt' ? `Receiving photo: ${TYPE_LABELS[row.photo_type] || 'Photo'}` : 'Count photo',
            takenAt: row.created_at || null,
        };
    }

    const rawClient = () => global.supabaseClient;
    // Count photos carry their project, so they are also asked for in the active project only.
    const clientFor = spec => (spec.scoped && global.projectSupabaseClient) || rawClient();

    // Runs the requests a few at a time and returns their answers in order.
    async function inTurn(tasks) {
        const answers = new Array(tasks.length);
        let next = 0;
        const worker = async () => { while (next < tasks.length) { const at = next++; answers[at] = await tasks[at](); } };
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, tasks.length) }, worker));
        return answers;
    }

    function group(kind, rows, found = new Map()) {
        for (const row of rows || []) {
            if (!row || !row.storage_path) continue;
            const photo = fromRow(kind, row);
            if (!found.has(photo.key)) found.set(photo.key, []);
            found.get(photo.key).push(photo);
        }
        return found;
    }

    const keysOf = keys => [...new Set((keys || []).filter(key => key !== null && key !== undefined && key !== '').map(String))];

    /**
     * Photos for these receipts (kind 'receipt') or counted items (kind 'count'),
     * as a Map from receiving record ID or item uid to its photos, oldest first.
     */
    async function load(kind, keys) {
        const spec = KINDS[kind];
        if (!spec) throw new Error(`Unknown photo kind: ${kind}`);
        const unique = keysOf(keys);
        const chunks = [];
        for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));
        const results = await inTurn(chunks.map(chunk => () =>
            clientFor(spec).from(spec.table).select(spec.columns).in(spec.key, chunk).order('created_at', { ascending: true })));
        const found = new Map();
        for (const { data, error } of results) {
            if (error) throw error;
            group(kind, data, found);
        }
        for (const photos of found.values()) photos.sort(byTaken);
        return found;
    }

    /**
     * Everything an item received on these receipts looks like: the receipt's
     * photos and, for an item counted before it was received, its count photos.
     * A Map from receiving record ID to photos, oldest first. Record details and
     * the Data Browser use this, so both show the same photos for a record.
     */
    async function loadForReceipts(receiptIds) {
        const ids = keysOf(receiptIds);
        if (!ids.length) return new Map();
        const chunks = [];
        for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
        const counted = await inTurn(chunks.map(chunk => () =>
            (global.projectSupabaseClient || rawClient()).from('inventory_records').select('uid,receiving_record_id').in('receiving_record_id', chunk)));
        const receiptOf = new Map();
        for (const { data, error } of counted) {
            if (error) throw error;
            for (const item of data || []) if (item && item.uid) receiptOf.set(String(item.uid), String(item.receiving_record_id));
        }
        const [receipts, counts] = await Promise.all([load('receipt', ids), load('count', [...receiptOf.keys()])]);
        const found = new Map();
        for (const id of ids) {
            const fromCounts = [...receiptOf].filter(([, receipt]) => receipt === id).flatMap(([uid]) => counts.get(uid) || []);
            const photos = merge(receipts.get(id) || [], fromCounts);
            if (photos.length) found.set(id, photos);
        }
        return found;
    }

    /**
     * Every photo of one kind in the active project, grouped as load() does: for
     * a page that lists all its items, where asking item by item would take many
     * requests. Receiving photos are asked for through their receipt's project.
     * Pages are read in a fixed order until one comes back empty, so a server
     * that returns fewer rows a page than asked still gives them all.
     */
    async function loadAll(kind) {
        const spec = KINDS[kind];
        if (!spec) throw new Error(`Unknown photo kind: ${kind}`);
        const projectId = global.InvenioProjectScope && global.InvenioProjectScope.getActiveProjectId && global.InvenioProjectScope.getActiveProjectId();
        const found = new Map();
        for (let from = 0; ;) {
            let query = kind === 'receipt'
                ? rawClient().from(spec.table).select(`${spec.columns},receiving_records!inner(project_id)`).eq('receiving_records.project_id', projectId)
                : clientFor(spec).from(spec.table).select(spec.columns);
            query = query.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
            const { data, error } = await query;
            if (error) throw error;
            if (!data || !data.length) break;
            group(kind, data, found);
            from += data.length;
        }
        return found;
    }

    // Oldest first by the moment taken; a photo with no time goes last.
    function taken(photo) {
        const at = photo && photo.takenAt ? Date.parse(photo.takenAt) : NaN;
        return Number.isNaN(at) ? Infinity : at;
    }
    function byTaken(a, b) {
        const x = taken(a), y = taken(b);
        return x === y ? 0 : x < y ? -1 : 1;
    }

    /** All the photos one record has, from each source, each once, oldest first. */
    function merge(...groups) {
        const seen = new Set();
        return groups.flat().filter(photo => {
            if (!photo) return false;
            const id = `${photo.bucket}/${photo.path}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        }).sort(byTaken);
    }

    async function signedUrl(photo) {
        const { data, error } = await rawClient().storage.from(photo.bucket).createSignedUrl(photo.path, LINK_SECONDS);
        if (error || !data || !data.signedUrl) throw error || new Error('No link was returned for this photo.');
        return data.signedUrl;
    }

    /** Links for many photos, one request per storage area; a photo with no link gets null. */
    async function signedUrls(photos) {
        const byBucket = new Map();
        photos.forEach(photo => {
            if (!byBucket.has(photo.bucket)) byBucket.set(photo.bucket, new Set());
            byBucket.get(photo.bucket).add(photo.path);
        });
        const links = new Map();
        await Promise.all([...byBucket].map(async ([bucket, paths]) => {
            try {
                const { data, error } = await rawClient().storage.from(bucket).createSignedUrls([...paths], LINK_SECONDS);
                if (error) return;
                for (const entry of data || []) {
                    if (entry && !entry.error && entry.signedUrl && entry.path) links.set(`${bucket}/${entry.path}`, entry.signedUrl);
                }
            } catch (_) { /* Shown as unavailable. */ }
        }));
        return photos.map(photo => links.get(`${photo.bucket}/${photo.path}`) || null);
    }

    /** Markup for a button that opens a row's photos; count and index are numbers. */
    function chipHtml(count, index) {
        const total = Number(count) || 0;
        const at = Number(index) || 0;
        const label = total === 1 ? 'Open 1 photo' : `Open ${total} photos`;
        return `<button type="button" class="photo-chip" data-photo-index="${at}" aria-label="${label}">`
            + `<i class="fas fa-camera" aria-hidden="true"></i> ${total}</button>`;
    }

    function el(tag, className, text) {
        const node = global.document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(className, label, text) {
        const node = el('button', className, text);
        node.type = 'button';
        node.setAttribute('aria-label', label);
        return node;
    }

    /**
     * Thumbnails for these photos in a container, each opening the viewer. The
     * links are asked for together. A thumbnail that can't get a link, or whose
     * image doesn't load even with a fresh one (a link lapses after 5 minutes,
     * and a thumbnail lower down may load later), says so in its place. Large
     * ones (the record page) show each photo's label and time under it.
     */
    async function strip(container, photos, { emptyText = 'No photos attached.', large = false } = {}) {
        container.replaceChildren();
        if (!photos || !photos.length) {
            container.append(el('p', 'text-muted mb-0', emptyText));
            return;
        }
        const missing = () => el('span', 'photo-thumb-missing', 'Unavailable');
        const images = photos.map((photo, index) => {
            const thumb = button(large ? 'photo-thumb photo-thumb-large' : 'photo-thumb', `Open photo ${index + 1} of ${photos.length}: ${photo.label}`);
            thumb.addEventListener('click', () => open(photos, index, thumb));
            const image = el('img', 'photo-thumb-image');
            image.alt = '';
            image.loading = 'lazy';
            let retried = false;
            image.addEventListener('error', async () => {
                if (!image.parentNode) return;
                if (retried) { image.replaceWith(missing()); return; }
                retried = true;
                try { image.src = await signedUrl(photo); } catch (_) { if (image.parentNode) image.replaceWith(missing()); }
            });
            thumb.append(image);
            if (large) thumb.append(el('span', 'photo-thumb-caption', [photo.label, takenText(photo.takenAt)].filter(Boolean).join(' · ')));
            container.append(thumb);
            return image;
        });
        const links = await signedUrls(photos);
        links.forEach((link, index) => {
            if (link) images[index].src = link;
            else images[index].replaceWith(missing());
        });
    }

    let current = null;

    /**
     * Opens photos large, starting at one; Escape, Close or a click outside the
     * photo closes it. Focus stays in the viewer while it is open: a click on the
     * photo focuses the viewer itself, so the keys keep working.
     */
    function open(photos, start = 0, trigger) {
        if (!photos || !photos.length) return;
        close();
        const doc = global.document;
        const returnFocus = trigger || doc.activeElement;
        // Inside an open dialog the viewer goes in that dialog, so the dialog keeps focus in it and
        // Escape closes the viewer rather than the dialog behind it; if the dialog closes, so does the viewer.
        const host = (returnFocus && typeof returnFocus.closest === 'function' && returnFocus.closest('.modal.show')) || doc.body;

        const overlay = el('div', 'photo-viewer');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Photos');
        overlay.tabIndex = -1;
        const frame = el('div', 'photo-viewer-frame');
        const bar = el('div', 'photo-viewer-bar');
        const caption = el('p', 'photo-viewer-caption');
        const closeButton = button('photo-viewer-close', 'Close photos', '×');
        bar.append(caption, closeButton);
        const stage = el('div', 'photo-viewer-stage');
        const image = el('img', 'photo-viewer-image');
        image.alt = '';
        image.hidden = true;
        const status = el('p', 'photo-viewer-status');
        status.setAttribute('role', 'status');
        stage.append(image, status);
        const nav = el('div', 'photo-viewer-nav');
        const previous = button('btn btn-outline-secondary btn-sm', 'Previous photo', '‹ Previous');
        const next = button('btn btn-outline-secondary btn-sm', 'Next photo', 'Next ›');
        const full = el('a', 'btn btn-outline-primary btn-sm', 'Open full size');
        full.target = '_blank';
        full.rel = 'noopener';
        full.hidden = true;
        if (photos.length > 1) nav.append(previous, next);
        nav.append(full);
        frame.append(bar, stage, nav);
        overlay.append(frame);

        let index = 0;
        let showing = 0;
        async function show(at) {
            index = ((at % photos.length) + photos.length) % photos.length;
            const photo = photos[index];
            caption.textContent = [photo.label, takenText(photo.takenAt), photos.length > 1 ? `${index + 1} of ${photos.length}` : '']
                .filter(Boolean).join(' · ');
            image.hidden = true;
            image.removeAttribute('src');
            // The link is hidden while the next photo loads; focus on it moves to the viewer, not out of it.
            if (doc.activeElement === full) overlay.focus();
            full.hidden = true;
            status.textContent = 'Loading photo…';
            const mine = ++showing;
            try {
                const link = await signedUrl(photo);
                if (mine !== showing || !current || current.overlay !== overlay) return;
                image.src = link;
                image.alt = photo.label;
                image.hidden = false;
                full.href = link;
                full.hidden = false;
                status.textContent = '';
            } catch (_) {
                if (mine === showing) status.textContent = 'This photo could not be opened. Check the connection and try again.';
            }
        }
        image.addEventListener('error', () => {
            if (image.hidden) return;
            image.hidden = true;
            if (doc.activeElement === full) overlay.focus();
            full.hidden = true;
            status.textContent = 'This photo could not be opened. Check the connection and try again.';
        });

        const focusable = () => [closeButton, ...(photos.length > 1 ? [previous, next] : []), ...(full.hidden ? [] : [full])];
        previous.addEventListener('click', () => show(index - 1));
        next.addEventListener('click', () => show(index + 1));
        closeButton.addEventListener('click', () => close());
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (event.stopPropagation) event.stopPropagation();
                close();
            } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && photos.length > 1) {
                event.preventDefault();
                show(index + (event.key === 'ArrowLeft' ? -1 : 1));
            } else if (event.key === 'Tab') {
                // Focus stays in the viewer while it is open.
                const items = focusable();
                const at = items.indexOf(doc.activeElement);
                const to = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === -1 || at === items.length - 1 ? 0 : at + 1);
                event.preventDefault();
                items[to].focus();
            }
        });
        // Focus that leaves the viewer while it is open (a click elsewhere, another script) comes back to it.
        const keepFocus = event => { if (current && current.overlay === overlay && !overlay.contains(event.target)) closeButton.focus(); };
        const hostClosing = () => close();
        doc.addEventListener('focusin', keepFocus, true);
        if (host !== doc.body) host.addEventListener('hide.bs.modal', hostClosing);

        host.append(overlay);
        current = {
            overlay, returnFocus,
            stop: () => {
                doc.removeEventListener('focusin', keepFocus, true);
                if (host !== doc.body) host.removeEventListener('hide.bs.modal', hostClosing);
            },
        };
        closeButton.focus();
        show(start);
        return overlay;
    }

    function close() {
        if (!current) return;
        const { overlay, returnFocus, stop } = current;
        current = null;
        stop();
        overlay.remove();
        if (returnFocus && typeof returnFocus.focus === 'function' && global.document.body.contains(returnFocus)) returnFocus.focus();
    }

    global.InvenioPhotos = {
        LINK_SECONDS, KINDS, TYPE_LABELS, takenText, fromRow, load, loadForReceipts, loadAll, merge,
        signedUrl, signedUrls, chipHtml, strip, open, close,
    };
})(typeof window !== 'undefined' ? window : globalThis);

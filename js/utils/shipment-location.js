/**
 * Where a shipment is now, for the Shipments page (026). Pure: no DOM or Supabase here, so node tests can load it.
 *
 * Not yet shipped (Not RTS, RTS): its loading location, the origin. In transit: the GPS position of the tracker
 * linked to it, on our GPS Tracking map. Delivered: its delivery location, the destination, with the storage area
 * when one is recorded. A fixed location opens on a map: the matching place's point when the Places page has one,
 * else that place's address, else the text as the shipment log has it.
 */
(function (root) {
    const STAGES = { 'not rts': 'loading', rts: 'loading', 'in transit': 'transit', delivered: 'delivered' };
    const HOUR = 3600 * 1000;
    // As vw_active_samsara_trackers: a tracker not heard from in 7 days is stale.
    const STALE_AFTER = 7 * 24 * HOUR;
    const LIVE_WITHIN = 24 * HOUR;
    const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

    const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const nameKey = value => clean(value).toLowerCase();
    const stageOf = status => STAGES[nameKey(status)] || null;
    // Office staff link a tracker once a shipment is ready to ship, or while it is on its way.
    const linkable = status => ['rts', 'in transit'].includes(nameKey(status));
    const present = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const hasPoint = (latitude, longitude) => present(latitude) && present(longitude);

    // The one map every fixed location opens on. Change it here and every location link follows.
    const MAP_SEARCH = 'https://www.google.com/maps/search/?api=1&query=';
    /** A map link to a point, or a map search for text; null when there is neither. */
    function mapUrl({ latitude, longitude, query } = {}) {
        if (hasPoint(latitude, longitude)) return MAP_SEARCH + encodeURIComponent(`${Number(latitude)},${Number(longitude)}`);
        const text = clean(query);
        return text ? MAP_SEARCH + encodeURIComponent(text) : null;
    }

    /** Active places this project can use (shared ones and its own yards and sites), by name ignoring case and spacing. */
    function placesByName(places, projectId) {
        const byName = new Map();
        for (const place of places || []) {
            if (place.is_active === false || (place.project_id && place.project_id !== projectId)) continue;
            const key = nameKey(place.name);
            if (key && !byName.has(key)) byName.set(key, place);
        }
        return byName;
    }

    const addressOf = place => [place.address, place.city, [place.state, place.postal_code].map(clean).filter(Boolean).join(' ')].map(clean).filter(Boolean).join(', ');

    /**
     * A fixed location, as the shipment log names it: { label, href, exact, title }, or null when none is recorded.
     * exact: the link is a place's map point rather than a search.
     */
    function fixedLocation(text, byName) {
        const label = clean(text);
        if (!label) return null;
        const place = byName?.get(nameKey(label)) || null;
        if (place && hasPoint(place.latitude, place.longitude)) {
            return { label, href: mapUrl(place), exact: true, title: `Open ${label} on a map (new tab)` };
        }
        const address = place ? addressOf(place) : '';
        const query = address ? `${clean(place.name)}, ${address}` : label;
        return { label, href: mapUrl({ query }), exact: false, title: `Search a map for ${query} (new tab)` };
    }

    /** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
    function ageText(iso, now = Date.now()) {
        const seen = Date.parse(iso);
        if (!Number.isFinite(seen)) return '';
        const minutes = Math.max(0, Math.round((now - seen) / 60000));
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
        const days = Math.round(hours / 24);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    }

    const gpsHref = trackerId => `samsara-tracking.html?tracker=${encodeURIComponent(trackerId)}`;

    /**
     * Where the shipment is now, for its Location cell:
     * { stage: 'loading'|'transit'|'delivered'|null, kind: 'place'|'gps'|'none', label, href, external, caption,
     *   tone: ''|'muted'|'warn', title }.
     * link is the shipment's active tracker link, tracker that tracker's row from vw_active_samsara_trackers.
     */
    function shipmentLocation(shipment, { byName = new Map(), link = null, tracker = null, now = Date.now() } = {}) {
        const stage = stageOf(shipment.status);
        const none = (label, caption = '') => ({ stage, kind: 'none', label, href: null, external: false, caption, tone: 'muted', title: '' });
        if (stage === 'loading' || stage === 'delivered') {
            const loading = stage === 'loading';
            // A blank origin or destination falls back to ship_from or ship_to.
            const where = fixedLocation(loading ? clean(shipment.origin) || shipment.ship_from : clean(shipment.destination) || shipment.ship_to, byName);
            if (!where) return none(loading ? 'No loading location recorded' : 'No delivery location recorded');
            const area = loading ? '' : clean(shipment.storage_location);
            return { stage, kind: 'place', label: where.label, href: where.href, external: true, exact: where.exact,
                caption: [loading ? 'Loading location' : 'Delivery location', area].filter(Boolean).join(' · '), tone: '', title: where.title };
        }
        if (stage === 'transit') {
            const heading = clean(shipment.destination) || clean(shipment.ship_to);
            if (!link) return none('No tracker linked', heading ? `On the way to ${heading}` : '');
            const name = clean(tracker?.name) || link.tracker_id;
            const gps = { stage, kind: 'gps', label: name, href: gpsHref(link.tracker_id), external: false, trackerId: link.tracker_id,
                tone: '', title: `Show ${name} on the GPS Tracking map (new tab)` };
            // Without the tracker's row (it couldn't be read), the GPS map still finds it.
            if (!tracker) return { ...gps, caption: 'GPS' };
            if (!hasPoint(tracker.last_latitude, tracker.last_longitude)) return { ...gps, href: null, caption: 'No GPS position yet', tone: 'muted', title: '' };
            const seen = Date.parse(tracker.last_seen_at);
            if (!Number.isFinite(seen)) return { ...gps, caption: 'GPS · time unknown', tone: 'warn' };
            const age = now - seen;
            if (age <= LIVE_WITHIN) return { ...gps, caption: `Live GPS · seen ${ageText(tracker.last_seen_at, now)}` };
            return { ...gps, caption: `GPS · last seen ${ageText(tracker.last_seen_at, now)}`, tone: age > STALE_AFTER ? 'warn' : '' };
        }
        return none('—');
    }

    /**
     * The tracker list for linking one shipment: every tracker by name, each saying when it was last seen and which
     * shipment has it. shipmentNumbers maps a shipment's id to its number.
     */
    function trackerChoices(trackers, links, shipmentNumbers, shipmentId, now = Date.now()) {
        const byTracker = new Map((links || []).map(link => [link.tracker_id, link]));
        const name = tracker => clean(tracker.name) || tracker.id;
        return [...(trackers || [])].sort((a, b) => collator.compare(name(a), name(b)) || collator.compare(a.id, b.id)).map(tracker => {
            const link = byTracker.get(tracker.id);
            const here = Boolean(link) && link.shipment_id === shipmentId;
            const elsewhere = link && !here ? shipmentNumbers.get(link.shipment_id) || `shipment #${link.shipment_id}` : null;
            const seen = tracker.last_seen_at ? `seen ${ageText(tracker.last_seen_at, now)}` : 'not seen yet';
            return { id: tracker.id, name: name(tracker), here, elsewhere,
                text: [name(tracker), seen, here ? 'on this shipment' : elsewhere ? `on ${elsewhere}` : ''].filter(Boolean).join(' · ') };
        });
    }

    function errorMessage(error) {
        const code = error?.code, text = error?.message || String(error ?? 'Unknown error');
        if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) return 'Tracker links are not set up in this database yet (migration 026).';
        if (code === '40P01') return 'Someone else changed these trackers at the same moment. Try again.';
        // A policy or grant refusal means "no permission"; the database's own checks say why.
        if (code === '42501') return !error?.message || /row-level security|permission denied/i.test(text) ? 'You do not have permission to make this change.' : text;
        return text;
    }

    const api = { STAGES, statusKey: nameKey, stageOf, linkable, mapUrl, placesByName, fixedLocation, ageText, gpsHref, shipmentLocation, trackerChoices, errorMessage };
    root.InvenioShipmentLocation = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/** Leaflet view of an uploaded site plan (CRS.Simple + imageOverlay), shared by Site Maps and Initial Inventory. */
(function (root) {
    const { toLatLng, fromLatLng } = root.InvenioInventory;
    // Leaflet focuses the map on mousedown and restores only the window's scroll. Inside the app's own
    // scrolling main area that jump moves the plan under the pointer, so the first click of a zone lands
    // in the wrong place. Focus without scrolling instead.
    root.L.Map.Keyboard.prototype._onMouseDown = function () {
        if (!this._focused) this._map.getContainer().focus({ preventScroll: true });
    };

    function textNode(text) {
        const span = document.createElement('span'); span.textContent = text; return span;
    }

    async function signedPlanUrl(storagePath) {
        const { data, error } = await root.supabaseClient.storage.from('site-plans').createSignedUrl(storagePath, 3600);
        if (error) throw new Error(`The site plan image could not be loaded: ${error.message}`);
        return data.signedUrl;
    }

    /** Leaflet measures the container to fit the image; if it is hidden now, call show() once it is visible. */
    function create(container, siteMap, imageUrl) {
        const width = siteMap.image_width, height = siteMap.image_height;
        const bounds = root.L.latLngBounds([0, 0], [height, width]);
        const map = root.L.map(container, { crs: root.L.CRS.Simple, minZoom: -6, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
        root.L.imageOverlay(imageUrl, bounds, { alt: `Site plan: ${siteMap.name}` }).addTo(map);
        map.setMaxBounds(bounds.pad(0.25));
        const view = {
            map, bounds, fitted: false,
            toLatLng: point => toLatLng(point, width, height),
            fromLatLng: latLng => fromLatLng(latLng, width, height),
            show() {
                map.invalidateSize();
                if (view.fitted || !container.clientWidth) return;
                map.setMinZoom(-6); map.fitBounds(bounds, { animate: false }); map.setMinZoom(map.getZoom() - 1);
                view.fitted = true;
            },
            destroy() { map.remove(); },
        };
        if (container.clientWidth) view.show(); else map.setView(bounds.getCenter(), 0);
        return view;
    }

    /** A zone polygon with a text-only label (Leaflet treats string tooltips as HTML). */
    function zonePolygon(view, zone, options = {}, { permanentLabel = false } = {}) {
        const color = zone.color || '#174fda';
        const polygon = root.L.polygon(zone.shape.map(view.toLatLng), { color, weight: 2, fillColor: color, fillOpacity: 0.15, ...options });
        polygon.bindTooltip(textNode(zone.name), permanentLabel ? { permanent: true, direction: 'center', className: 'zone-label' } : { sticky: true });
        return polygon;
    }

    function cssToken(name, fallback) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }

    root.InvenioSiteMapView = { signedPlanUrl, create, zonePolygon, textNode, cssToken };
})(window);

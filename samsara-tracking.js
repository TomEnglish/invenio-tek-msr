// Samsara Tracker Dashboard - JavaScript
// Displays tracker locations on map and in table
// Uses shared utilities from js/utils/

// Site coordinates (from shared constants)
const SITE_LAT = SITE_CONFIG.LATITUDE;
const SITE_LON = SITE_CONFIG.LONGITUDE;
const SITE_RADIUS_M = SITE_CONFIG.RADIUS_METERS;

// Supabase client is initialized by js/utils/supabase-client.js

// ============================================================================
// APPLICATION STATE
// ============================================================================
let state = {
    trackers: [],
    filteredTrackers: [],
    map: null,
    markers: {},
    siteMarker: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Samsara Tracker Dashboard initializing...');

    // Initialize map
    initializeMap();

    // Load tracker data
    await loadTrackers();

    // Setup event listeners
    setupEventListeners();

    // Setup real-time subscriptions
    setupRealtimeSubscriptions();
});

// ============================================================================
// MAP INITIALIZATION
// ============================================================================
function initializeMap() {
    // Create map centered on Greenfield LNG Terminal site
    state.map = L.map('map').setView([SITE_LAT, SITE_LON], 10);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(state.map);

    // Add site marker
    const siteIcon = L.divIcon({
        className: 'site-marker',
        html: '<div style="background-color: #d4b896; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    state.siteMarker = L.marker([SITE_LAT, SITE_LON], { icon: siteIcon })
        .addTo(state.map)
        .bindPopup('<b>Greenfield LNG Terminal Site</b><br>Amarillo, TX');

    // Add site radius circle (500m)
    L.circle([SITE_LAT, SITE_LON], {
        color: '#d4b896',
        fillColor: '#d4b896',
        fillOpacity: 0.1,
        radius: SITE_RADIUS_M  // 500m in meters
    }).addTo(state.map);
}

// ============================================================================
// DATA LOADING
// ============================================================================
async function loadTrackers() {
    try {
        console.log('Loading tracker data from Supabase...');

        // Query the view for active trackers
        const { data, error } = await supabaseClient
            .from('vw_active_samsara_trackers')
            .select('*')
            .order('last_seen_at', { ascending: false, nullsFirst: false });

        if (error) throw error;

        state.trackers = data || [];
        state.filteredTrackers = state.trackers;

        console.log(`Loaded ${state.trackers.length} trackers`);

        // Log most recent sync time for debugging
        const mostRecent = state.trackers
            .filter(t => t.synced_at)
            .sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))[0];
        if (mostRecent) {
            console.log(`Most recent sync: ${mostRecent.synced_at}`);
        }

        // Apply initial filters (this will trigger rendering)
        applyFilters();

        // Update UI
        updateStats();
        updateLastSyncInfo();

    } catch (error) {
        console.error('Error loading trackers:', error);
        showError('Failed to load tracker data. Please refresh the page.');
    }
}

// ============================================================================
// STATISTICS
// ============================================================================
function updateStats() {
    const total = state.trackers.length;
    const onSite = state.trackers.filter(t => t.is_on_site).length;
    const inTransit = state.trackers.filter(t => t.status === 'In Transit').length;
    const active = state.trackers.filter(t => t.last_seen_at && new Date(t.last_seen_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statOnSite').textContent = onSite;
    document.getElementById('statInTransit').textContent = inTransit;
    document.getElementById('statActive').textContent = active;
}

function updateLastSyncInfo() {
    const mostRecent = state.trackers
        .filter(t => t.synced_at)
        .sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))[0];

    if (mostRecent) {
        const syncTime = new Date(mostRecent.synced_at);
        const timeAgo = getTimeAgo(syncTime);
        document.getElementById('lastSyncInfo').innerHTML =
            `<strong>Last Sync:</strong> ${timeAgo} (${syncTime.toLocaleString()})`;
    }
}

// ============================================================================
// MAP RENDERING
// ============================================================================
function updateMap() {
    // Clear existing markers
    Object.values(state.markers).forEach(marker => marker.remove());
    state.markers = {};

    // Add markers for trackers with location data
    state.filteredTrackers.forEach(tracker => {
        if (tracker.last_latitude && tracker.last_longitude) {
            addTrackerMarker(tracker);
        }
    });

    // Fit bounds if we have markers
    if (Object.keys(state.markers).length > 0) {
        const group = L.featureGroup(Object.values(state.markers).concat([state.siteMarker]));
        state.map.fitBounds(group.getBounds().pad(0.1));
    }
}

function addTrackerMarker(tracker) {
    // Determine marker color based on status
    let color = '#666';  // Gray for no data
    if (tracker.status === 'On Site') color = '#d4b896';  // Tan/gold accent
    else if (tracker.status === 'In Transit') color = '#f5a623';  // Orange
    else if (tracker.status === 'Stale') color = '#d0021b';  // Red

    // Create custom marker icon
    const markerIcon = L.divIcon({
        className: 'tracker-marker',
        html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    // Create marker
    const marker = L.marker([tracker.last_latitude, tracker.last_longitude], { icon: markerIcon })
        .addTo(state.map);

    // Add permanent label showing tracker name
    marker.bindTooltip(tracker.name, {
        permanent: true,
        direction: 'top',
        className: 'tracker-label',
        offset: [0, -8]
    });

    // Create popup content (removed share link - those expire)
    const popupContent = `
        <div style="min-width: 200px;">
            <h6 style="margin: 0 0 10px 0; color: #2d2d2d;">${tracker.name}</h6>
            <div style="font-size: 0.9rem;">
                <strong>Status:</strong> <span class="badge badge-${tracker.status.toLowerCase().replace(' ', '-')}">${tracker.status}</span><br>
                <strong>Distance:</strong> ${tracker.distance_from_site_km ? tracker.distance_from_site_km.toFixed(2) + ' km' : 'N/A'}<br>
                <strong>Last Seen:</strong> ${tracker.last_seen_at ? getTimeAgo(new Date(tracker.last_seen_at)) : 'Never'}<br>
                <strong>Accuracy:</strong> ${tracker.last_accuracy_meters ? tracker.last_accuracy_meters.toFixed(1) + 'm' : 'N/A'}
            </div>
        </div>
    `;

    marker.bindPopup(popupContent);

    // Store marker reference
    state.markers[tracker.id] = marker;
}

// ============================================================================
// TABLE RENDERING
// ============================================================================
function renderTrackers() {
    const tbody = document.getElementById('trackerTableBody');

    if (state.filteredTrackers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No trackers found</td></tr>';
        return;
    }

    tbody.innerHTML = state.filteredTrackers.map(tracker => {
        const statusBadge = getStatusBadge(tracker.status);
        const location = tracker.last_latitude && tracker.last_longitude
            ? `${tracker.last_latitude.toFixed(5)}, ${tracker.last_longitude.toFixed(5)}`
            : '<span class="text-muted">No location data</span>';

        const distance = tracker.distance_from_site_km
            ? `${tracker.distance_from_site_km.toFixed(2)} km`
            : '<span class="text-muted">N/A</span>';

        const lastSeen = tracker.last_seen_at
            ? `<span title="${new Date(tracker.last_seen_at).toLocaleString()}">${getTimeAgo(new Date(tracker.last_seen_at))}</span>`
            : '<span class="text-muted">Never</span>';

        const linkedMaterial = tracker.po_id
            ? `PO: ${tracker.po_id}${tracker.install_tag ? ` → ${tracker.install_tag}` : ''}`
            : '<span class="text-muted">Not linked</span>';

        const zoomButton = tracker.last_latitude && tracker.last_longitude
            ? `<button class="btn btn-sm btn-outline-lime" onclick="zoomToTracker('${tracker.id}')"><i class="fas fa-map-marker-alt"></i></button>`
            : '';

        return `
            <tr>
                <td><strong>${tracker.name}</strong></td>
                <td>${statusBadge}</td>
                <td style="font-family: monospace; font-size: 0.9rem;">${location}</td>
                <td>${distance}</td>
                <td>${lastSeen}</td>
                <td>${linkedMaterial}</td>
                <td>${zoomButton}</td>
            </tr>
        `;
    }).join('');
}

function getStatusBadge(status) {
    const badgeClass = status === 'On Site' ? 'badge-on-site'
        : status === 'In Transit' ? 'badge-in-transit'
        : status === 'Stale' ? 'badge-stale'
        : 'badge-no-data';

    return `<span class="badge ${badgeClass}">${status}</span>`;
}

// ============================================================================
// FILTERING
// ============================================================================
function applyFilters() {
    const searchTerm = document.getElementById('searchBox').value.toLowerCase().trim();
    const statusFilter = document.getElementById('filterStatus').value;
    const linkedFilter = document.getElementById('filterLinked').value;
    const hideUnknown = document.getElementById('hideUnknown').checked;

    state.filteredTrackers = state.trackers.filter(tracker => {
        // Hide "Unknown" filter
        if (hideUnknown && (tracker.name === 'Unknown' || tracker.name === null || tracker.name === '')) {
            return false;
        }

        // Search filter
        if (searchTerm) {
            const matchesSearch =
                (tracker.name || '').toLowerCase().includes(searchTerm) ||
                (tracker.id || '').toLowerCase().includes(searchTerm) ||
                (tracker.po_id || '').toLowerCase().includes(searchTerm) ||
                (tracker.install_tag || '').toLowerCase().includes(searchTerm);

            if (!matchesSearch) return false;
        }

        // Status filter
        if (statusFilter && tracker.status !== statusFilter) {
            return false;
        }

        // Linked filter
        if (linkedFilter === 'linked' && !tracker.linked_material_id) {
            return false;
        }
        if (linkedFilter === 'unlinked' && tracker.linked_material_id) {
            return false;
        }

        return true;
    });

    renderTrackers();
    updateMap();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

    return date.toLocaleDateString();
}

function zoomToTracker(trackerId) {
    const marker = state.markers[trackerId];
    if (marker) {
        state.map.setView(marker.getLatLng(), 15);
        marker.openPopup();
    }
}

window.zoomToTracker = zoomToTracker;

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function setupEventListeners() {
    document.getElementById('searchBox').addEventListener('input', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterLinked').addEventListener('change', applyFilters);
    document.getElementById('hideUnknown').addEventListener('change', applyFilters);

    document.getElementById('btnRefresh').addEventListener('click', async () => {
        await loadTrackers();
        showSuccess('Tracker data refreshed');
    });

    document.getElementById('btnExport').addEventListener('click', exportToCSV);
}

// ============================================================================
// REAL-TIME SUBSCRIPTIONS
// ============================================================================
function setupRealtimeSubscriptions() {
    // Subscribe to tracker updates
    supabaseClient
        .channel('samsara_trackers_changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'samsara_trackers'
        }, (payload) => {
            console.log('Real-time update received:', payload);
            loadTrackers();  // Reload all data on any change
        })
        .subscribe();

    console.log('Real-time subscriptions active');
}

// ============================================================================
// EXPORT
// ============================================================================
function exportToCSV() {
    const headers = ['Name', 'Status', 'Latitude', 'Longitude', 'Distance (km)', 'Last Seen', 'Linked Material'];
    const rows = state.filteredTrackers.map(t => [
        t.name,
        t.status,
        t.last_latitude || '',
        t.last_longitude || '',
        t.distance_from_site_km ? t.distance_from_site_km.toFixed(2) : '',
        t.last_seen_at || '',
        t.po_id ? `PO: ${t.po_id}${t.install_tag ? ` -> ${t.install_tag}` : ''}` : ''
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `samsara_trackers_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    showSuccess('Tracker data exported');
}

// ============================================================================
// UI MESSAGES
// ============================================================================
function showError(message) {
    // Simple alert for now - could be replaced with toast notification
    alert(`Error: ${message}`);
}

function showSuccess(message) {
    // Simple alert for now - could be replaced with toast notification
    console.log(`Success: ${message}`);
}

console.log('Samsara Tracker Dashboard loaded');

// Delivery Dates Dashboard
// Displays and manages delivery date information from Supabase
// Uses shared utilities from js/utils/

// ============================================================================
// APPLICATION STATE
// ============================================================================
let deliveryData = [];
let filteredData = [];
let currentView = 'list';
let currentMonth = new Date();

// Supabase client is initialized by js/utils/supabase-client.js

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Delivery Dates Dashboard initializing...');
    loadDeliveryDates();
    setupEventListeners();
});

// Load delivery dates from Supabase
async function loadDeliveryDates() {
    try {
        console.log('Loading delivery dates from Supabase...');

        const { data, error } = await supabaseClient
            .from('delivery_dates')
            .select('*')
            .order('delivery_date', { ascending: true });

        if (error) throw error;

        deliveryData = data || [];
        filteredData = deliveryData;

        console.log(`Loaded ${deliveryData.length} delivery dates`);

        updateStatistics();
        populateFilters();
        renderListView();

    } catch (error) {
        console.error('Error loading delivery dates:', error);
        document.getElementById('deliveryTableBody').innerHTML =
            '<tr><td colspan="8" class="text-center py-4 text-danger">Error loading delivery dates. Please refresh the page.</td></tr>';
    }
}

// Update statistics cards
function updateStatistics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    const monthFromNow = new Date(today);
    monthFromNow.setDate(monthFromNow.getDate() + 30);

    let upcoming = 0;
    let thisWeek = 0;
    let overdue = 0;

    deliveryData.forEach(delivery => {
        if (!delivery.delivery_date) return;

        const deliveryDate = new Date(delivery.delivery_date);
        deliveryDate.setHours(0, 0, 0, 0);

        if (deliveryDate < today) {
            overdue++;
        } else if (deliveryDate <= weekFromNow) {
            thisWeek++;
            upcoming++;
        } else if (deliveryDate <= monthFromNow) {
            upcoming++;
        }
    });

    document.getElementById('totalDeliveries').textContent = deliveryData.length;
    document.getElementById('upcomingDeliveries').textContent = upcoming;
    document.getElementById('weekDeliveries').textContent = thisWeek;
    document.getElementById('overdueDeliveries').textContent = overdue;
}

// Populate filter dropdowns
function populateFilters() {
    // Get unique suppliers
    const suppliers = [...new Set(deliveryData.map(d => d.supplier_name).filter(Boolean))].sort();
    const supplierSelect = document.getElementById('filterSupplier');
    supplierSelect.innerHTML = '<option value="">All Suppliers</option>';
    suppliers.forEach(supplier => {
        supplierSelect.innerHTML += `<option value="${supplier}">${supplier}</option>`;
    });

    // Get unique phases
    const phases = [...new Set(deliveryData.map(d => d.project_phase).filter(Boolean))].sort();
    const phaseSelect = document.getElementById('filterPhase');
    phaseSelect.innerHTML = '<option value="">All Phases</option>';
    phases.forEach(phase => {
        phaseSelect.innerHTML += `<option value="${phase}">${phase}</option>`;
    });
}

// Setup event listeners
function setupEventListeners() {
    // Search and filters
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterSupplier').addEventListener('change', applyFilters);
    document.getElementById('filterPhase').addEventListener('change', applyFilters);
    document.getElementById('filterTimeframe').addEventListener('change', applyFilters);

    // View toggle
    document.getElementById('btnListView').addEventListener('click', () => switchView('list'));
    document.getElementById('btnCalendarView').addEventListener('click', () => switchView('calendar'));

    // Calendar navigation
    document.getElementById('btnPrevMonth').addEventListener('click', () => navigateMonth(-1));
    document.getElementById('btnNextMonth').addEventListener('click', () => navigateMonth(1));

    // Export button
    document.getElementById('btnExport').addEventListener('click', exportToExcel);
}

// Apply filters
function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('filterStatus').value;
    const supplierFilter = document.getElementById('filterSupplier').value;
    const phaseFilter = document.getElementById('filterPhase').value;
    const timeframeFilter = document.getElementById('filterTimeframe').value;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    filteredData = deliveryData.filter(delivery => {
        // Search filter
        if (searchTerm) {
            const searchableText = [
                delivery.po_number,
                delivery.package_description,
                delivery.tag_number,
                delivery.supplier_name
            ].join(' ').toLowerCase();

            if (!searchableText.includes(searchTerm)) return false;
        }

        // Status filter
        if (statusFilter) {
            if (statusFilter === 'tbd') {
                // TBD: no date specified
                if (delivery.delivery_date) return false;
            } else if (delivery.delivery_date) {
                // Has a date - calculate status
                const deliveryDate = new Date(delivery.delivery_date);
                deliveryDate.setHours(0, 0, 0, 0);

                const weekFromNow = new Date(today);
                weekFromNow.setDate(weekFromNow.getDate() + 7);

                let actualStatus = '';
                if (deliveryDate < today) {
                    actualStatus = 'ready';  // Past RTS date = Ready Now
                } else if (deliveryDate <= weekFromNow) {
                    actualStatus = 'week';
                } else {
                    actualStatus = 'upcoming';
                }

                if (actualStatus !== statusFilter) return false;
            } else {
                // No date but filter is not 'tbd'
                return false;
            }
        }

        // Supplier filter
        if (supplierFilter && delivery.supplier_name !== supplierFilter) return false;

        // Phase filter
        if (phaseFilter && delivery.project_phase !== phaseFilter) return false;

        // Timeframe filter
        if (timeframeFilter !== 'all' && delivery.delivery_date) {
            const deliveryDate = new Date(delivery.delivery_date);
            deliveryDate.setHours(0, 0, 0, 0);

            const weekFromNow = new Date(today);
            weekFromNow.setDate(weekFromNow.getDate() + 7);

            const monthFromNow = new Date(today);
            monthFromNow.setDate(monthFromNow.getDate() + 30);

            switch(timeframeFilter) {
                case 'ready':
                    if (deliveryDate >= today) return false;
                    break;
                case 'week':
                    if (deliveryDate < today || deliveryDate > weekFromNow) return false;
                    break;
                case 'month':
                    if (deliveryDate < today || deliveryDate > monthFromNow) return false;
                    break;
                case 'upcoming':
                    if (deliveryDate < today || deliveryDate > monthFromNow) return false;
                    break;
            }
        }

        return true;
    });

    if (currentView === 'list') {
        renderListView();
    } else {
        renderCalendarView();
    }
}

// Render list view
function renderListView() {
    const tbody = document.getElementById('deliveryTableBody');
    document.getElementById('resultCount').textContent = filteredData.length;

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No delivery dates found</td></tr>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    const rows = filteredData.map(delivery => {
        const deliveryDate = delivery.delivery_date ? new Date(delivery.delivery_date) : null;
        let statusBadge = '<span class="badge badge-secondary">TBD</span>';
        let dateDisplay = 'TBD';

        if (deliveryDate) {
            deliveryDate.setHours(0, 0, 0, 0);
            dateDisplay = formatDate(delivery.delivery_date);

            if (deliveryDate < today) {
                statusBadge = '<span class="badge badge-ready">Ready Now</span>';
            } else if (deliveryDate <= weekFromNow) {
                statusBadge = '<span class="badge badge-soon">Ready This Week</span>';
            } else {
                statusBadge = '<span class="badge badge-upcoming">Not Ready Yet</span>';
            }
        }

        return `
            <tr>
                <td><strong>${dateDisplay}</strong></td>
                <td>${statusBadge}</td>
                <td>${delivery.po_number || 'N/A'}</td>
                <td>${delivery.package_description || 'N/A'}</td>
                <td>${delivery.tag_number || 'N/A'}</td>
                <td>${delivery.supplier_name || 'N/A'}</td>
                <td>${delivery.project_phase || 'N/A'}</td>
                <td>${delivery.delivery_date_notes || '-'}</td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rows;
}

// Switch between views
function switchView(view) {
    currentView = view;

    // Update button states
    document.getElementById('btnListView').classList.toggle('active', view === 'list');
    document.getElementById('btnCalendarView').classList.toggle('active', view === 'calendar');

    // Show/hide views
    document.getElementById('listView').style.display = view === 'list' ? 'block' : 'none';
    document.getElementById('calendarView').style.display = view === 'calendar' ? 'block' : 'none';

    if (view === 'calendar') {
        renderCalendarView();
    }
}

// Render calendar view
function renderCalendarView() {
    const grid = document.getElementById('calendarGrid');
    const monthLabel = document.getElementById('calendarMonth');

    // Set month label
    monthLabel.textContent = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Get first day of month and number of days
    const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDay = firstDay.getDay(); // 0 = Sunday

    // Clear grid
    grid.innerHTML = '';

    // Add day headers
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(day => {
        grid.innerHTML += `<div class="calendar-day-header">${day}</div>`;
    });

    // Add empty cells for days before month starts
    for (let i = 0; i < startDay; i++) {
        grid.innerHTML += '<div class="calendar-day" style="opacity: 0.3;"></div>';
    }

    // Add days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
        currentDate.setHours(0, 0, 0, 0);

        // Find deliveries for this day
        const deliveriesForDay = filteredData.filter(delivery => {
            if (!delivery.delivery_date) return false;
            const deliveryDate = new Date(delivery.delivery_date);
            deliveryDate.setHours(0, 0, 0, 0);
            return deliveryDate.getTime() === currentDate.getTime();
        });

        let dayContent = `<div class="calendar-day-header">${day}</div>`;

        deliveriesForDay.slice(0, 3).forEach(delivery => {
            const shortDesc = (delivery.package_description || 'Unknown').substring(0, 20);
            dayContent += `
                <div class="calendar-delivery" title="${delivery.package_description || 'Unknown'}">
                    ${shortDesc}${(delivery.package_description || '').length > 20 ? '...' : ''}
                </div>
            `;
        });

        if (deliveriesForDay.length > 3) {
            dayContent += `<div class="calendar-delivery"><strong>+${deliveriesForDay.length - 3} more</strong></div>`;
        }

        // Highlight today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isToday = currentDate.getTime() === today.getTime();

        grid.innerHTML += `
            <div class="calendar-day" style="${isToday ? 'border: 2px solid #2563EB;' : ''}">
                ${dayContent}
            </div>
        `;
    }
}

// Navigate calendar months
function navigateMonth(direction) {
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    renderCalendarView();
}

// Format date
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Export to Excel
function exportToExcel() {
    console.log('Exporting to Excel...');

    // Create CSV content
    const headers = ['Ready to Ship Date', 'Status', 'PO Number', 'Package Description', 'Tag Number', 'Supplier', 'Phase', 'Date Range/Notes'];
    let csv = headers.join(',') + '\n';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    filteredData.forEach(delivery => {
        const deliveryDate = delivery.delivery_date ? new Date(delivery.delivery_date) : null;
        let status = 'TBD';

        if (deliveryDate) {
            deliveryDate.setHours(0, 0, 0, 0);
            if (deliveryDate < today) {
                status = 'Ready Now';
            } else if (deliveryDate <= weekFromNow) {
                status = 'Ready This Week';
            } else {
                status = 'Not Ready Yet';
            }
        }

        const row = [
            delivery.delivery_date || 'TBD',
            status,
            delivery.po_number || 'N/A',
            `"${(delivery.package_description || 'N/A').replace(/"/g, '""')}"`,
            delivery.tag_number || 'N/A',
            `"${(delivery.supplier_name || 'N/A').replace(/"/g, '""')}"`,
            delivery.project_phase || 'N/A',
            `"${(delivery.delivery_date_notes || '-').replace(/"/g, '""')}"`
        ];
        csv += row.join(',') + '\n';
    });

    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `ready_to_ship_dates_${timestamp}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('Export complete');
}

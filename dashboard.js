// MSR Dashboard JavaScript
// Uses shared utilities from js/utils/

let dashboardData = {
    metrics: null,
    shipments: null,
    poData: null,
    auditData: null,
    disciplineSummary: null
};

let charts = {
    poStatus: null,
    shipmentStatus: null,
    discipline: null
};

// Initialize dashboard on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing MSR Dashboard...');

    // Supabase client is now initialized by js/utils/supabase-client.js
    if (!isSupabaseConfigured()) {
        console.error('Supabase configuration not found!');
        return;
    }

    loadAllData();
});

// Load all data from Supabase
async function loadAllData() {
    try {
        console.log('Loading data from Supabase...');

        // Load metrics from dashboard_metrics table
        const { data: metricsData, error: metricsError } = await supabaseClient
            .from('dashboard_metrics')
            .select('*')
            .order('last_updated', { ascending: false })
            .limit(1)
            .single();

        if (metricsError) throw metricsError;

        // Load shipments
        const { data: shipments, error: shipmentsError } = await supabaseClient
            .from('shipments')
            .select('*')
            .order('delivery_date', { ascending: false, nullsFirst: false });

        if (shipmentsError) throw shipmentsError;

        // Load PO data
        const { data: poData, error: poError } = await supabaseClient
            .from('purchase_orders')
            .select('*')
            .order('created_on', { ascending: false, nullsFirst: false });

        if (poError) throw poError;

        // Load installation data from local JSON files (not migrated to Supabase yet)
        const [auditDataResp, disciplineSummaryResp] = await Promise.all([
            fetch('dashboard_data/audit_data.json'),
            fetch('dashboard_data/discipline_summary.json')
        ]);

        const auditData = await auditDataResp.json();
        const disciplineSummary = await disciplineSummaryResp.json();

        // Build metrics object from Supabase data
        // Parse JSONB fields that may come back as strings
        const parseField = (val, fallback) => {
            if (!val) return fallback;
            if (typeof val === 'string') try { return JSON.parse(val); } catch(e) { return fallback; }
            return val;
        };
        const metrics = {
            last_updated: metricsData.last_updated,
            project_name: metricsData.project_name || 'Greenfield LNG Terminal',
            procurement: parseField(metricsData.procurement, {}),
            installation: parseField(metricsData.installation, disciplineSummary || { total_items: 0, by_discipline: {} }),
            status_counts: parseField(metricsData.status_counts, { po_status: {}, shipment_status: {} })
        };

        dashboardData = {
            metrics,
            shipments: shipments || [],
            poData: poData || [],
            auditData: auditData || [],
            disciplineSummary: disciplineSummary || {}
        };

        console.log('Data loaded successfully from Supabase:', dashboardData);
        console.log('Last updated:', metrics.last_updated);

        // Update all dashboard components
        updateKPICards();
        updateLastUpdated();
        createCharts();
        populatePOTable();
        populateShipmentTable();
        populateInstallationData();
        loadUpcomingMilestones();

    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showError('Failed to load dashboard data from Supabase. Please check the console for details.');
    }
}

// Update KPI cards
function updateKPICards() {
    const m = dashboardData.metrics;

    document.getElementById('totalPOs').textContent = m.procurement.total_pos || '0';
    document.getElementById('totalValue').textContent = formatCurrency(m.procurement.total_po_value);
    document.getElementById('totalShipments').textContent = m.procurement.total_shipments || '0';
    document.getElementById('deliveredShipments').textContent = m.procurement.delivered_shipments || '0';
    document.getElementById('totalInstallItems').textContent = m.installation.total_items || '0';
}

// Update last updated timestamp
function updateLastUpdated() {
    const timestamp = dashboardData.metrics.last_updated;
    document.getElementById('lastUpdated').textContent = formatDateTime(timestamp);
}

// Create all charts
function createCharts() {
    createPOStatusChart();
    createShipmentStatusChart();
    createDisciplineChart();
}

// Create PO Status Chart
function createPOStatusChart() {
    const ctx = document.getElementById('poStatusChart');
    if (!ctx) return;

    const statusData = dashboardData.metrics.status_counts.po_status;
    const labels = Object.keys(statusData);
    const data = Object.values(statusData);

    if (charts.poStatus) {
        charts.poStatus.destroy();
    }

    charts.poStatus = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#d4b896', // Invenio-Tek tan/gold accent
                    '#f5a623', // warning orange
                    '#d0021b', // danger red
                    '#4a90e2', // info blue
                    '#2d2d2d', // darker charcoal
                    '#cccccc'  // medium gray
                ],
                borderWidth: 3,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

// Create Shipment Status Chart
function createShipmentStatusChart() {
    const ctx = document.getElementById('shipmentStatusChart');
    if (!ctx) return;

    const statusData = dashboardData.metrics.status_counts.shipment_status;
    const labels = Object.keys(statusData);
    const data = Object.values(statusData);

    if (charts.shipmentStatus) {
        charts.shipmentStatus.destroy();
    }

    charts.shipmentStatus = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Shipments',
                data: data,
                backgroundColor: [
                    '#d4b896',  // Invenio-Tek tan/gold accent
                    '#f5a623',  // warning orange
                    '#d0021b',  // danger red
                    '#4a90e2',  // info blue
                    '#2d2d2d'   // darker charcoal
                ],
                borderWidth: 0,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Count: ${context.parsed.y}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

// Create Discipline Chart
function createDisciplineChart() {
    const ctx = document.getElementById('disciplineChart');
    if (!ctx) return;

    const disciplines = Object.keys(dashboardData.disciplineSummary);
    const items = disciplines.map(d => dashboardData.disciplineSummary[d].total_items);
    const hours = disciplines.map(d => dashboardData.disciplineSummary[d].total_field_whrs);

    if (charts.discipline) {
        charts.discipline.destroy();
    }

    charts.discipline = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: disciplines.map(d => d.charAt(0).toUpperCase() + d.slice(1)),
            datasets: [
                {
                    label: 'Total Items',
                    data: items,
                    backgroundColor: '#d4b896',  // Invenio-Tek tan/gold accent
                    borderRadius: 8,
                    yAxisID: 'y'
                },
                {
                    label: 'Field Hours',
                    data: hours,
                    backgroundColor: '#2d2d2d',  // Darker charcoal
                    borderRadius: 8,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Items'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Field Hours'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

// Populate PO Table
function populatePOTable() {
    const tbody = document.getElementById('poTableBody');
    const poData = dashboardData.poData;

    console.log('Populating PO table with', poData?.length, 'records');
    if (poData && poData.length > 0) {
        console.log('First PO record:', poData[0]);
    }

    if (!poData || poData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No purchase orders found</td></tr>';
        return;
    }

    // Get unique POs (group by PO ID) - using Supabase field names
    const uniquePOs = {};
    poData.forEach(item => {
        const poId = item.purchase_order_id;
        if (!uniquePOs[poId]) {
            uniquePOs[poId] = item;
        }
    });

    const rows = Object.values(uniquePOs).map(po => {
        const status = getStatusBadge(po.status);
        const deliveryDate = po.delivery_date_from || 'N/A';
        const netValue = po.net_value ? formatCurrency(po.net_value) : 'N/A';

        return `
            <tr>
                <td><strong>${po.purchase_order_id || 'N/A'}</strong></td>
                <td class="text-truncate" style="max-width: 250px;" title="${po.po_description || ''}">${po.po_description || 'N/A'}</td>
                <td>${status}</td>
                <td>${po.supplier || 'N/A'}</td>
                <td>${po.category || 'N/A'}</td>
                <td>${deliveryDate}</td>
                <td><strong>${netValue}</strong></td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rows;

    // Add search functionality
    document.getElementById('poSearch').addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        const rows = tbody.getElementsByTagName('tr');

        Array.from(rows).forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });
}

// Populate Shipment Table
function populateShipmentTable() {
    const tbody = document.getElementById('shipmentTableBody');
    const shipments = dashboardData.shipments;

    console.log('Populating Shipment table with', shipments?.length, 'records');
    if (shipments && shipments.length > 0) {
        console.log('First shipment record:', shipments[0]);
    }

    if (!shipments || shipments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No shipments found</td></tr>';
        return;
    }

    let currentFilter = '';

    function renderShipments() {
        const filteredShipments = currentFilter
            ? shipments.filter(s => s.status === currentFilter)
            : shipments;

        const rows = filteredShipments.map(ship => {
            const status = getStatusBadge(ship.status);
            const eta = ship.eta || 'N/A';
            const deliveryDate = ship.delivery_date || 'N/A';
            const partDescription = ship.part_description || 'N/A';

            return `
                <tr>
                    <td><strong>${ship.shipment_number || 'N/A'}</strong></td>
                    <td>${ship.po_number || 'N/A'}</td>
                    <td>${partDescription}</td>
                    <td>${status}</td>
                    <td>${ship.supplier || 'N/A'}</td>
                    <td>${ship.category || 'N/A'}</td>
                    <td>${eta}</td>
                    <td>${deliveryDate}</td>
                    <td>${ship.num_pieces || 'N/A'}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rows || '<tr><td colspan="9" class="text-center py-4 text-muted">No shipments match the filter</td></tr>';
    }

    renderShipments();

    // Add filter functionality
    document.getElementById('shipmentStatusFilter').addEventListener('change', function(e) {
        currentFilter = e.target.value;
        renderShipments();
    });
}

// Populate Installation Data
function populateInstallationData() {
    // Create discipline cards
    const cardsContainer = document.getElementById('disciplineCards');
    const disciplines = Object.keys(dashboardData.disciplineSummary);

    const cards = disciplines.map(discipline => {
        const data = dashboardData.disciplineSummary[discipline];
        const icon = getDisciplineIcon(discipline);
        const color = getDisciplineColor(discipline);

        return `
            <div class="col-md-4">
                <div class="card border-0 shadow-sm">
                    <div class="card-body">
                        <div class="flex items-center mb-3">
                            <div class="p-3 ${color} rounded-full me-3">
                                <i class="${icon} text-white text-xl"></i>
                            </div>
                            <div>
                                <h6 class="mb-0 text-uppercase font-weight-bold">${discipline}</h6>
                                <small class="text-muted">Installation Items</small>
                            </div>
                        </div>
                        <div class="row g-2">
                            <div class="col-6">
                                <div class="text-center p-2 bg-light rounded">
                                    <div class="text-2xl font-bold text-gray-900">${data.total_items}</div>
                                    <div class="text-xs text-gray-600">Items</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="text-center p-2 bg-light rounded">
                                    <div class="text-2xl font-bold text-gray-900">${Math.round(data.total_field_whrs).toLocaleString()}</div>
                                    <div class="text-xs text-gray-600">Field Hours</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    cardsContainer.innerHTML = cards;

    // Populate installation table
    populateInstallationTable();
}

// Populate Installation Table
function populateInstallationTable() {
    const tbody = document.getElementById('installationTableBody');
    const auditData = dashboardData.auditData;

    let currentFilter = '';

    function renderInstallation() {
        let allItems = [];

        Object.keys(auditData).forEach(discipline => {
            if (!currentFilter || currentFilter === discipline) {
                const items = auditData[discipline].slice(0, 50); // Limit to 50 items per discipline
                items.forEach(item => {
                    allItems.push({
                        discipline: discipline,
                        ...item
                    });
                });
            }
        });

        const rows = allItems.map(item => {
            const disciplineBadge = `<span class="badge bg-secondary">${item.discipline.charAt(0).toUpperCase() + item.discipline.slice(1)}</span>`;
            const desc = item.DESC_ || item['Item Description'] || item.TAG_NO || item['Tag Number'] || 'N/A';
            const dwg = item.DWG || 'N/A';
            const system = item.SYSTEM || 'N/A';
            const qty = item.FLD_QTY || item['Ordered Quantity'] || 'N/A';
            const uom = item.UOM || item['Base UoM'] || 'N/A';
            const hrs = item.FLD_WHRS ? Math.round(item.FLD_WHRS) : 'N/A';

            return `
                <tr>
                    <td>${disciplineBadge}</td>
                    <td class="text-truncate" style="max-width: 250px;" title="${desc}">${desc}</td>
                    <td><small>${dwg}</small></td>
                    <td>${system}</td>
                    <td><strong>${qty}</strong></td>
                    <td>${uom}</td>
                    <td>${hrs}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rows || '<tr><td colspan="7" class="text-center py-4 text-muted">No items found</td></tr>';
    }

    renderInstallation();

    // Add filter functionality
    document.getElementById('disciplineFilter').addEventListener('change', function(e) {
        currentFilter = e.target.value;
        renderInstallation();
    });
}

// Helper Functions
function getStatusBadge(status) {
    if (!status) return '<span class="badge bg-secondary">Unknown</span>';

    const statusLower = status.toLowerCase();
    let badgeClass = 'bg-secondary';

    if (statusLower.includes('delivered') || statusLower.includes('finished')) {
        badgeClass = 'bg-success';
    } else if (statusLower.includes('transit') || statusLower.includes('rts')) {
        badgeClass = 'bg-info';
    } else if (statusLower.includes('not')) {
        badgeClass = 'bg-warning';
    } else if (statusLower.includes('canceled')) {
        badgeClass = 'bg-danger';
    }

    return `<span class="badge ${badgeClass}">${status}</span>`;
}

function getDisciplineIcon(discipline) {
    const icons = {
        'civil': 'fas fa-hard-hat',
        'electrical': 'fas fa-bolt',
        'instrumentation': 'fas fa-gauge-high',
        'mechanical': 'fas fa-cog',
        'steel': 'fas fa-industry'
    };
    return icons[discipline] || 'fas fa-tools';
}

function getDisciplineColor(discipline) {
    const colors = {
        'civil': 'bg-lime-500',         // Lime green variant
        'electrical': 'bg-yellow-500',  // Bright yellow
        'instrumentation': 'bg-blue-500', // Info blue
        'mechanical': 'bg-green-600',   // Darker green
        'steel': 'bg-gray-600'          // Charcoal gray
    };
    return colors[discipline] || 'bg-gray-500';
}

function formatCurrency(value) {
    if (!value || isNaN(value)) return '$0';
    return '$' + Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showError(message) {
    const alertHTML = `
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
            <i class="fas fa-exclamation-triangle me-2"></i>
            <strong>Error:</strong> ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;

    const container = document.querySelector('.container-fluid');
    container.insertAdjacentHTML('afterbegin', alertHTML);
}

function refreshData() {
    console.log('Refreshing dashboard data...');
    location.reload();
}

// Load upcoming milestones for widget
async function loadUpcomingMilestones() {
    try {
        console.log('Loading upcoming milestones...');

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get milestones that haven't finished yet
        const { data: milestones, error } = await supabaseClient
            .from('project_schedule')
            .select('*')
            .eq('is_milestone', true)
            .gte('finish_date', today.toISOString().split('T')[0])
            .order('finish_date', { ascending: true })
            .limit(5);

        if (error) throw error;

        const container = document.getElementById('upcomingMilestonesWidget');

        if (!milestones || milestones.length === 0) {
            container.innerHTML = '<p class="text-muted mb-0">No upcoming milestones found</p>';
            return;
        }

        console.log(`Loaded ${milestones.length} upcoming milestones`);

        const milestonesList = milestones.map(milestone => {
            const finishDate = new Date(milestone.finish_date);
            finishDate.setHours(0, 0, 0, 0);

            const daysUntil = Math.ceil((finishDate - today) / (1000 * 60 * 60 * 24));

            let urgencyClass = '';
            let urgencyText = '';

            if (daysUntil === 0) {
                urgencyClass = 'text-danger';
                urgencyText = 'Today';
            } else if (daysUntil <= 7) {
                urgencyClass = 'text-warning';
                urgencyText = `In ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;
            } else if (daysUntil <= 30) {
                urgencyClass = 'text-info';
                urgencyText = `In ${daysUntil} days`;
            } else {
                urgencyClass = 'text-muted';
                urgencyText = `In ${daysUntil} days`;
            }

            const criticalIcon = milestone.is_critical ?
                '<i class="fas fa-exclamation-triangle text-danger me-2"></i>' : '';

            const formattedDate = finishDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            return `
                <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                    <div class="flex-grow-1">
                        <div>
                            ${criticalIcon}
                            <strong>${milestone.activity_name || 'Unnamed Milestone'}</strong>
                        </div>
                        <small class="text-muted">
                            <i class="fas fa-tag me-1"></i>${milestone.activity_id || 'N/A'}
                            ${milestone.category ? ` | ${milestone.category}` : ''}
                        </small>
                    </div>
                    <div class="text-end ms-3">
                        <div class="${urgencyClass}"><strong>${urgencyText}</strong></div>
                        <small class="text-muted">${formattedDate}</small>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = milestonesList;

    } catch (error) {
        console.error('Error loading upcoming milestones:', error);
        const container = document.getElementById('upcomingMilestonesWidget');
        container.innerHTML = '<p class="text-danger mb-0">Error loading milestones</p>';
    }
}

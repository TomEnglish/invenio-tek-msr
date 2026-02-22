// Material Tracking Application - Supabase Version
// Handles linking PO items to installation items using Supabase backend
// Uses shared utilities from js/utils/

// Supabase client is initialized by js/utils/supabase-client.js

// ============================================================================
// APPLICATION STATE
// ============================================================================

let state = {
    poItems: [],
    installItems: [],
    materialLinks: [],
    selectedPO: null,
    selectedInstall: null,
    supabaseConnected: false
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Material Tracking System (Supabase) initializing...');

    // Check if Supabase is configured
    if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
        showConfigurationError();
        return;
    }

    // Check Supabase connectivity
    await checkSupabaseConnection();

    if (state.supabaseConnected) {
        // Load all data
        await Promise.all([
            loadPOItems(),
            loadInstallItems(),
            loadMaterialLinks()
        ]);

        // Setup event listeners
        setupEventListeners();

        // Setup real-time subscriptions
        setupRealtimeSubscriptions();
    }
});

// ============================================================================
// SUPABASE CONNECTIVITY
// ============================================================================

async function checkSupabaseConnection() {
    try {
        // Try to query the material_links table (should work even if empty)
        const { data, error } = await supabaseClient
            .from('material_links')
            .select('count', { count: 'exact', head: true });

        if (error) {
            console.error('Supabase connection error:', error);
            showSupabaseError(error.message);
            state.supabaseConnected = false;
            return false;
        }

        state.supabaseConnected = true;
        showSupabaseSuccess();
        console.log('Supabase connected successfully');
        return true;

    } catch (error) {
        console.error('Supabase connection failed:', error);
        showSupabaseError(error.message);
        state.supabaseConnected = false;
        return false;
    }
}

function showSupabaseSuccess() {
    document.getElementById('backendSuccess').style.display = 'block';
    document.getElementById('backendWarning').style.display = 'none';
    document.getElementById('backendSuccess').innerHTML = `
        <i class="fas fa-check-circle me-2"></i>
        <strong>Connected:</strong> Supabase database is connected and ready
    `;
}

function showSupabaseError(message) {
    document.getElementById('backendSuccess').style.display = 'none';
    document.getElementById('backendWarning').style.display = 'block';
    document.getElementById('backendWarning').innerHTML = `
        <i class="fas fa-exclamation-triangle me-2"></i>
        <strong>Supabase Error:</strong> ${message}
        <br><small>Please check your Supabase configuration in material-tracking-supabase.js</small>
    `;
}

function showConfigurationError() {
    document.getElementById('backendSuccess').style.display = 'none';
    document.getElementById('backendWarning').style.display = 'block';
    document.getElementById('backendWarning').innerHTML = `
        <i class="fas fa-exclamation-triangle me-2"></i>
        <strong>Configuration Required:</strong> Please configure your Supabase credentials in material-tracking-supabase.js
        <br><small>See SUPABASE_SETUP_GUIDE.md for instructions</small>
    `;
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadPOItems() {
    try {
        // Load PO items and delivery dates from Supabase
        const [poResponse, deliveryResponse] = await Promise.all([
            supabaseClient
                .from('purchase_orders')
                .select('*')
                .order('purchase_order_id', { ascending: true }),
            supabaseClient
                .from('delivery_dates')
                .select('*')
        ]);

        if (poResponse.error) throw poResponse.error;

        // Create delivery date lookup by PO number
        const deliveryDatesByPO = {};
        if (deliveryResponse.data) {
            deliveryResponse.data.forEach(dd => {
                if (dd.po_number) {
                    if (!deliveryDatesByPO[dd.po_number]) {
                        deliveryDatesByPO[dd.po_number] = [];
                    }
                    deliveryDatesByPO[dd.po_number].push({
                        date: dd.delivery_date,
                        notes: dd.delivery_date_notes,
                        package: dd.package_description
                    });
                }
            });
        }

        // Map Supabase fields to expected format with delivery dates
        state.poItems = poResponse.data.map(item => ({
            po_id: item.purchase_order_id,
            line_item: item.line_item,
            description: item.description,
            supplier: item.supplier,
            category: item.category,
            net_value: item.net_value || 0,
            delivery_date: item.delivery_date_from,
            expected_delivery: deliveryDatesByPO[item.purchase_order_id] || []
        }));

        console.log(`Loaded ${state.poItems.length} PO items from Supabase`);
        console.log(`Loaded delivery dates for ${Object.keys(deliveryDatesByPO).length} POs`);
        document.getElementById('poCount').textContent = `${state.poItems.length} items`;

        renderPOItems(state.poItems);
    } catch (error) {
        console.error('Error loading PO items:', error);
        showError('Failed to load PO items. Please ensure dashboard data is extracted.');
    }
}

async function loadInstallItems() {
    try {
        // Load from local JSON file (same as before)
        const response = await fetch('dashboard_data/audit_data.json');
        if (!response.ok) throw new Error('Failed to load installation data');

        const data = await response.json();

        // Handle both array and object formats
        let rawItems = [];
        if (Array.isArray(data)) {
            rawItems = data;
        } else if (data.items) {
            rawItems = data.items;
        } else {
            // Flatten discipline-based structure (civil, electrical, etc.)
            rawItems = Object.entries(data).flatMap(([discipline, items]) =>
                items.map(item => ({ ...item, discipline: discipline.charAt(0).toUpperCase() + discipline.slice(1) }))
            );
        }

        // Map JSON fields to expected format
        state.installItems = rawItems.map(item => ({
            tag: item.SCHED_ID || item.tag || 'N/A',
            description: item.DESC_ || item.description || 'No description',
            discipline: item.discipline || item.Discipline || 'Unknown',
            field_qty: item.FLD_QTY || item.field_qty,
            work_hours: item.FLD_WHRS || item.work_hours
        }));

        console.log(`Loaded ${state.installItems.length} installation items`);
        document.getElementById('installCount').textContent = `${state.installItems.length} items`;

        renderInstallItems(state.installItems);
    } catch (error) {
        console.error('Error loading installation items:', error);
        showError('Failed to load installation items. Please ensure dashboard data is extracted.');
    }
}

async function loadMaterialLinks() {
    try {
        // Query Supabase for material links
        const { data, error } = await supabaseClient
            .from('material_links')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        state.materialLinks = data || [];

        console.log(`Loaded ${state.materialLinks.length} material links`);
        renderMaterialLinks(state.materialLinks);

    } catch (error) {
        console.error('Error loading material links:', error);
        showError(`Failed to load material links: ${error.message}`);
    }
}

// ============================================================================
// REAL-TIME SUBSCRIPTIONS
// ============================================================================

function setupRealtimeSubscriptions() {
    // Subscribe to material_links changes
    supabaseClient
        .channel('material_links_changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'material_links'
        }, (payload) => {
            console.log('Real-time update received:', payload);
            handleRealtimeUpdate(payload);
        })
        .subscribe();

    console.log('Real-time subscriptions active');
}

function handleRealtimeUpdate(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    switch (eventType) {
        case 'INSERT':
            // Add new link to state
            state.materialLinks.unshift(newRecord);
            renderMaterialLinks(state.materialLinks);
            showInfo('A new material link was added');
            break;

        case 'UPDATE':
            // Update existing link in state
            const updateIndex = state.materialLinks.findIndex(link => link.id === newRecord.id);
            if (updateIndex !== -1) {
                state.materialLinks[updateIndex] = newRecord;
                renderMaterialLinks(state.materialLinks);
                showInfo('A material link was updated');
            }
            break;

        case 'DELETE':
            // Remove link from state
            state.materialLinks = state.materialLinks.filter(link => link.id !== oldRecord.id);
            renderMaterialLinks(state.materialLinks);
            showInfo('A material link was deleted');
            break;
    }
}

// ============================================================================
// RENDERING FUNCTIONS (Same as before)
// ============================================================================

function renderPOItems(items) {
    const container = document.getElementById('poList');

    if (items.length === 0) {
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: #999;">No PO items found</div>';
        return;
    }

    container.innerHTML = items.map((item, index) => {
        // Build delivery date badges
        let deliveryBadges = '';
        if (item.expected_delivery && item.expected_delivery.length > 0) {
            const deliveries = item.expected_delivery.slice(0, 2); // Show first 2
            deliveryBadges = deliveries.map(d => {
                const daysAway = d.date ? Math.ceil((new Date(d.date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
                const badgeClass = daysAway !== null && daysAway < 7 ? 'delivery-soon' : '';
                const dateText = d.date ? formatDate(d.date) : 'TBD';
                const noteText = d.notes ? ` (${d.notes})` : '';
                return `<span class="item-tag ${badgeClass}" title="${d.package || ''}"🚚 ${dateText}${noteText}</span>`;
            }).join('');
            if (item.expected_delivery.length > 2) {
                deliveryBadges += `<span class="item-tag">+${item.expected_delivery.length - 2} more</span>`;
            }
        }

        return `
            <div class="selection-item" data-index="${index}">
                <div class="item-title">${item.po_id} - Line ${item.line_item || 'N/A'}</div>
                <div class="item-detail">${truncate(item.description || 'No description', 80)}</div>
                <div class="item-detail"><strong>Supplier:</strong> ${item.supplier || 'Unknown'}</div>
                <span class="item-tag">${item.category || 'Uncategorized'}</span>
                <span class="item-tag">Net: $${formatNumber(item.net_value)}</span>
                ${deliveryBadges}
            </div>
        `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.selection-item').forEach(el => {
        el.addEventListener('click', () => selectPOItem(el));
    });
}

function renderInstallItems(items) {
    const container = document.getElementById('installList');

    if (items.length === 0) {
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: #999;">No installation items found</div>';
        return;
    }

    container.innerHTML = items.map((item, index) => `
        <div class="selection-item" data-index="${index}">
            <div class="item-title">${item.tag}</div>
            <div class="item-detail">${truncate(item.description || 'No description', 80)}</div>
            <div class="item-detail"><strong>Discipline:</strong> ${item.discipline || 'Unknown'}</div>
            <span class="item-tag">${item.discipline || 'Unknown'}</span>
            ${item.field_qty ? `<span class="item-tag">Qty: ${item.field_qty}</span>` : ''}
            ${item.work_hours ? `<span class="item-tag">Hours: ${item.work_hours}</span>` : ''}
        </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.selection-item').forEach(el => {
        el.addEventListener('click', () => selectInstallItem(el));
    });
}

function renderMaterialLinks(links) {
    const tbody = document.getElementById('linksTableBody');

    if (links.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 2rem; color: #999;">
                    <i class="fas fa-inbox fa-2x mb-2"></i>
                    <p>No material links created yet. Use the panels above to link items.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = links.map(link => `
        <tr>
            <td>${link.id}</td>
            <td>${link.po_id}</td>
            <td>${truncate(link.po_description || 'N/A', 40)}</td>
            <td>${link.install_tag || 'N/A'}</td>
            <td>${link.install_discipline || 'N/A'}</td>
            <td>${link.quantity || 'N/A'} ${link.uom || ''}</td>
            <td><span class="status-badge status-${link.material_status}">${capitalizeFirst(link.material_status)}</span></td>
            <td>${formatDate(link.created_at)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-action btn-update" onclick="updateLinkStatus(${link.id}, '${link.material_status}')">
                        <i class="fas fa-edit"></i> Update
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteLink(${link.id})">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function setupEventListeners() {
    // Search boxes
    document.getElementById('poSearch').addEventListener('input', handlePOSearch);
    document.getElementById('installSearch').addEventListener('input', handleInstallSearch);

    // Create link button
    document.getElementById('btnCreateLink').addEventListener('click', createMaterialLink);

    // Filters
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterDiscipline').addEventListener('change', applyFilters);

    // Export button
    document.getElementById('btnExport').addEventListener('click', exportToExcel);
}

function handlePOSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();

    if (searchTerm === '') {
        renderPOItems(state.poItems);
        return;
    }

    const filtered = state.poItems.filter(item => {
        // Convert all fields to strings and handle null/undefined
        const poId = (item.po_id || '').toString().toLowerCase();
        const description = (item.description || '').toString().toLowerCase();
        const supplier = (item.supplier || '').toString().toLowerCase();
        const category = (item.category || '').toString().toLowerCase();

        return poId.includes(searchTerm) ||
               description.includes(searchTerm) ||
               supplier.includes(searchTerm) ||
               category.includes(searchTerm);
    });

    console.log(`PO Search: "${searchTerm}" - Found ${filtered.length} of ${state.poItems.length} items`);
    renderPOItems(filtered);
}

function handleInstallSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();

    if (searchTerm === '') {
        renderInstallItems(state.installItems);
        return;
    }

    const filtered = state.installItems.filter(item => {
        return (item.tag && item.tag.toLowerCase().includes(searchTerm)) ||
               (item.description && item.description.toLowerCase().includes(searchTerm)) ||
               (item.discipline && item.discipline.toLowerCase().includes(searchTerm));
    });

    renderInstallItems(filtered);
}

function selectPOItem(element) {
    // Remove previous selection
    document.querySelectorAll('#poList .selection-item').forEach(el => {
        el.classList.remove('selected');
    });

    // Add selection
    element.classList.add('selected');

    const index = parseInt(element.dataset.index);
    state.selectedPO = state.poItems[index];

    // Update display
    document.getElementById('selectedPO').textContent =
        `${state.selectedPO.po_id} - ${truncate(state.selectedPO.description, 50)}`;

    // Enable create button if both items selected
    updateCreateButtonState();
}

function selectInstallItem(element) {
    // Remove previous selection
    document.querySelectorAll('#installList .selection-item').forEach(el => {
        el.classList.remove('selected');
    });

    // Add selection
    element.classList.add('selected');

    const index = parseInt(element.dataset.index);
    state.selectedInstall = state.installItems[index];

    // Update display
    document.getElementById('selectedInstall').textContent =
        `${state.selectedInstall.tag} - ${truncate(state.selectedInstall.description, 50)}`;

    // Enable create button if both items selected
    updateCreateButtonState();
}

function updateCreateButtonState() {
    const btn = document.getElementById('btnCreateLink');
    btn.disabled = !(state.selectedPO && state.selectedInstall);
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

async function createMaterialLink() {
    if (!state.selectedPO || !state.selectedInstall) {
        alert('Please select both a PO item and an installation item');
        return;
    }

    const quantity = document.getElementById('linkQuantity').value;
    const uom = document.getElementById('linkUOM').value;
    const notes = document.getElementById('linkNotes').value;

    const linkData = {
        po_id: state.selectedPO.po_id,
        po_line_item: state.selectedPO.line_item,
        po_description: state.selectedPO.description,
        install_tag: state.selectedInstall.tag,
        install_discipline: state.selectedInstall.discipline,
        install_description: state.selectedInstall.description,
        quantity: quantity ? parseFloat(quantity) : null,
        uom: uom || null,
        notes: notes || null,
        linked_by: 'User' // Can be replaced with actual user authentication
    };

    try {
        const { data, error } = await supabaseClient
            .from('material_links')
            .insert([linkData])
            .select();

        if (error) throw error;

        console.log('Link created successfully:', data);
        showSuccess('Material link created successfully!');

        // Clear selections
        clearSelections();

        // Reload links (real-time will also update, but this ensures it)
        await loadMaterialLinks();

    } catch (error) {
        console.error('Error creating link:', error);
        showError(`Failed to create link: ${error.message}`);
    }
}

async function updateLinkStatus(linkId, currentStatus) {
    const statuses = ['ordered', 'shipped', 'received', 'installed'];
    const currentIndex = statuses.indexOf(currentStatus);

    // Show status selection dialog
    const newStatus = prompt(
        `Update material status for link #${linkId}\n\nCurrent: ${currentStatus}\n\nEnter new status (ordered, shipped, received, installed):`,
        statuses[Math.min(currentIndex + 1, statuses.length - 1)]
    );

    if (!newStatus || !statuses.includes(newStatus.toLowerCase())) {
        return;
    }

    try {
        const updateData = {
            material_status: newStatus.toLowerCase(),
            updated_at: new Date().toISOString()
        };

        // Add receipt date if status is received and not already set
        if (newStatus.toLowerCase() === 'received') {
            const currentLink = state.materialLinks.find(l => l.id === linkId);
            if (!currentLink.receipt_date) {
                updateData.receipt_date = new Date().toISOString().split('T')[0];
            }
        }

        // Add installation date if status is installed and not already set
        if (newStatus.toLowerCase() === 'installed') {
            const currentLink = state.materialLinks.find(l => l.id === linkId);
            if (!currentLink.installation_date) {
                updateData.installation_date = new Date().toISOString().split('T')[0];
            }
        }

        const { data, error } = await supabaseClient
            .from('material_links')
            .update(updateData)
            .eq('id', linkId)
            .select();

        if (error) throw error;

        showSuccess('Link status updated successfully!');
        await loadMaterialLinks();

    } catch (error) {
        console.error('Error updating link status:', error);
        showError(`Failed to update status: ${error.message}`);
    }
}

async function deleteLink(linkId) {
    if (!confirm(`Are you sure you want to delete link #${linkId}? This action cannot be undone.`)) {
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('material_links')
            .delete()
            .eq('id', linkId);

        if (error) throw error;

        showSuccess('Link deleted successfully!');
        await loadMaterialLinks();

    } catch (error) {
        console.error('Error deleting link:', error);
        showError(`Failed to delete link: ${error.message}`);
    }
}

function applyFilters() {
    const statusFilter = document.getElementById('filterStatus').value;
    const disciplineFilter = document.getElementById('filterDiscipline').value;

    let filtered = [...state.materialLinks];

    if (statusFilter) {
        filtered = filtered.filter(link => link.material_status === statusFilter);
    }

    if (disciplineFilter) {
        filtered = filtered.filter(link => link.install_discipline === disciplineFilter);
    }

    renderMaterialLinks(filtered);
}

async function exportToExcel() {
    try {
        // Get current filtered data
        const statusFilter = document.getElementById('filterStatus').value;
        const disciplineFilter = document.getElementById('filterDiscipline').value;

        let dataToExport = [...state.materialLinks];

        if (statusFilter) {
            dataToExport = dataToExport.filter(link => link.material_status === statusFilter);
        }

        if (disciplineFilter) {
            dataToExport = dataToExport.filter(link => link.install_discipline === disciplineFilter);
        }

        // Create CSV content
        const headers = ['Link ID', 'PO ID', 'PO Line', 'PO Description', 'Install Tag', 'Discipline', 'Install Description', 'Quantity', 'UOM', 'Status', 'Receipt Date', 'Receipt Location', 'Installation Date', 'Notes', 'Linked By', 'Created At'];

        const rows = dataToExport.map(link => [
            link.id,
            link.po_id,
            link.po_line_item || '',
            link.po_description || '',
            link.install_tag || '',
            link.install_discipline || '',
            link.install_description || '',
            link.quantity || '',
            link.uom || '',
            link.material_status,
            link.receipt_date || '',
            link.receipt_location || '',
            link.installation_date || '',
            link.notes || '',
            link.linked_by || '',
            link.created_at
        ].map(cell => `"${String(cell).replace(/"/g, '""')}"`));

        const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

        // Download CSV
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `material_links_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showSuccess('Material links exported successfully!');

    } catch (error) {
        console.error('Error exporting to Excel:', error);
        showError('Failed to export data');
    }
}

function clearSelections() {
    // Clear PO selection
    document.querySelectorAll('#poList .selection-item').forEach(el => {
        el.classList.remove('selected');
    });
    state.selectedPO = null;
    document.getElementById('selectedPO').textContent = 'No item selected';

    // Clear install selection
    document.querySelectorAll('#installList .selection-item').forEach(el => {
        el.classList.remove('selected');
    });
    state.selectedInstall = null;
    document.getElementById('selectedInstall').textContent = 'No item selected';

    // Clear form fields
    document.getElementById('linkQuantity').value = '';
    document.getElementById('linkUOM').value = '';
    document.getElementById('linkNotes').value = '';

    // Disable create button
    updateCreateButtonState();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function truncate(str, maxLength) {
    if (!str) return '';
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

function formatNumber(num) {
    if (!num && num !== 0) return '0.00';
    return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function showSuccess(message) {
    alert('✓ ' + message);
}

function showError(message) {
    alert('✗ ' + message);
}

function showInfo(message) {
    console.log('ℹ ' + message);
    // Could be replaced with toast notifications
}

// ============================================================================
// DELIVERY DATE FILTERING
// ============================================================================

window.filterByDeliveryDates = function() {
    const itemsWithDelivery = state.poItems.filter(item =>
        item.expected_delivery && item.expected_delivery.length > 0
    );

    console.log(`Filtering to ${itemsWithDelivery.length} items with delivery dates`);

    renderPOItems(itemsWithDelivery);
    document.getElementById('poCount').textContent = `${itemsWithDelivery.length} of ${state.poItems.length} items`;

    // Update button visibility
    document.getElementById('filterDeliveryDates').style.display = 'none';
    document.getElementById('clearFilter').style.display = 'inline-block';
};

window.clearDeliveryFilter = function() {
    renderPOItems(state.poItems);
    document.getElementById('poCount').textContent = `${state.poItems.length} items`;

    // Update button visibility
    document.getElementById('filterDeliveryDates').style.display = 'inline-block';
    document.getElementById('clearFilter').style.display = 'none';
};

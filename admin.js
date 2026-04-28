/**
 * Admin Data Browser — browse, search, and edit any project table via Supabase.
 */

// ── Table Configuration ──

const TABLE_CONFIG = {
    materials: {
        label: 'Materials',
        category: 'Inventory',
        icon: 'fa-cubes',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'material_type', label: 'Type', editable: true, type: 'text' },
            { key: 'size', label: 'Size', editable: true, type: 'text' },
            { key: 'grade', label: 'Grade', editable: true, type: 'text' },
            { key: 'spec', label: 'Spec', editable: true, type: 'text' },
            { key: 'qty', label: 'Qty', editable: false, type: 'number' },
            { key: 'current_quantity', label: 'Current Qty', editable: false, type: 'number' },
            { key: 'weight', label: 'Weight', editable: true, type: 'number' },
            { key: 'status', label: 'Status', editable: true, type: 'enum', options: ['in_yard', 'issued', 'shipped', 'depleted'] },
            { key: 'created_at', label: 'Created', editable: false, type: 'datetime' },
        ],
        searchColumns: ['material_type', 'size', 'grade', 'spec'],
    },
    receiving_records: {
        label: 'Receiving Records',
        category: 'Inventory',
        icon: 'fa-clipboard-list',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'material_type', label: 'Type', editable: false, type: 'text' },
            { key: 'qty', label: 'Qty', editable: false, type: 'number' },
            { key: 'size', label: 'Size', editable: false, type: 'text' },
            { key: 'grade', label: 'Grade', editable: false, type: 'text' },
            { key: 'status', label: 'Status', editable: false, type: 'enum', options: ['pending', 'accepted', 'partially_accepted', 'rejected'] },
            { key: 'vendor', label: 'Vendor', editable: false, type: 'text' },
            { key: 'po_number', label: 'PO #', editable: false, type: 'text' },
            { key: 'condition', label: 'Condition', editable: false, type: 'enum', options: ['good', 'damaged', 'mixed'] },
            { key: 'inspection_pass', label: 'Insp. Pass', editable: false, type: 'boolean' },
            { key: 'has_exception', label: 'Exception', editable: false, type: 'boolean' },
            { key: 'exception_type', label: 'Exception Type', editable: false, type: 'text' },
            { key: 'exception_resolved', label: 'Resolved', editable: true, type: 'boolean' },
            { key: 'exception_resolution', label: 'Resolution', editable: true, type: 'enum', options: ['', 'hold', 'return_to_vendor'] },
            { key: 'created_at', label: 'Created', editable: false, type: 'datetime' },
        ],
        searchColumns: ['material_type', 'vendor', 'po_number', 'grade'],
    },
    locations: {
        label: 'Locations',
        category: 'Inventory',
        icon: 'fa-map-marker-alt',
        idField: 'id',
        orderBy: 'zone',
        orderAsc: true,
        canInsert: true,
        canDelete: true,
        columns: [
            { key: 'zone', label: 'Zone', editable: true, type: 'text' },
            { key: 'row', label: 'Row', editable: true, type: 'text' },
            { key: 'rack', label: 'Rack', editable: true, type: 'text' },
            { key: 'is_hold_area', label: 'Hold Area', editable: true, type: 'boolean' },
            { key: 'capacity', label: 'Capacity', editable: true, type: 'number' },
            { key: 'created_at', label: 'Created', editable: false, type: 'datetime' },
        ],
        searchColumns: ['zone', 'row', 'rack'],
    },
    qr_codes: {
        label: 'QR Codes',
        category: 'Inventory',
        icon: 'fa-qrcode',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'code_value', label: 'Code', editable: false, type: 'text' },
            { key: 'entity_type', label: 'Entity Type', editable: true, type: 'enum', options: ['item', 'pallet', 'shipment'] },
            { key: 'entity_id', label: 'Entity ID', editable: false, type: 'text' },
            { key: 'created_at', label: 'Created', editable: false, type: 'datetime' },
        ],
        searchColumns: ['code_value'],
    },
    material_movements: {
        label: 'Material Movements',
        category: 'Tracking',
        icon: 'fa-exchange-alt',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'material_id', label: 'Material ID', editable: false, type: 'text' },
            { key: 'from_location_id', label: 'From Location', editable: false, type: 'text' },
            { key: 'to_location_id', label: 'To Location', editable: false, type: 'text' },
            { key: 'reason', label: 'Reason', editable: false, type: 'text' },
            { key: 'moved_by', label: 'Moved By', editable: false, type: 'text' },
            { key: 'created_at', label: 'Date', editable: false, type: 'datetime' },
        ],
        searchColumns: ['reason'],
    },
    material_issues: {
        label: 'Material Issues',
        category: 'Tracking',
        icon: 'fa-sign-out-alt',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'material_id', label: 'Material ID', editable: false, type: 'text' },
            { key: 'job_number', label: 'Job #', editable: false, type: 'text' },
            { key: 'work_order', label: 'Work Order', editable: false, type: 'text' },
            { key: 'quantity_issued', label: 'Qty Issued', editable: false, type: 'number' },
            { key: 'issued_by', label: 'Issued By', editable: false, type: 'text' },
            { key: 'created_at', label: 'Date', editable: false, type: 'datetime' },
        ],
        searchColumns: ['job_number', 'work_order'],
    },
    shipments_out: {
        label: 'Shipments Out',
        category: 'Tracking',
        icon: 'fa-shipping-fast',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'material_id', label: 'Material ID', editable: false, type: 'text' },
            { key: 'destination', label: 'Destination', editable: false, type: 'text' },
            { key: 'carrier', label: 'Carrier', editable: false, type: 'text' },
            { key: 'tracking_number', label: 'Tracking #', editable: false, type: 'text' },
            { key: 'quantity_shipped', label: 'Qty', editable: false, type: 'number' },
            { key: 'created_at', label: 'Date', editable: false, type: 'datetime' },
        ],
        searchColumns: ['destination', 'carrier', 'tracking_number'],
    },
    purchase_orders: {
        label: 'Purchase Orders',
        category: 'Procurement',
        icon: 'fa-file-invoice-dollar',
        idField: 'id',
        orderBy: 'id',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'purchase_order_id', label: 'PO ID', editable: false, type: 'text' },
            { key: 'po_description', label: 'Description', editable: false, type: 'text' },
            { key: 'supplier', label: 'Supplier', editable: false, type: 'text' },
            { key: 'status', label: 'Status', editable: true, type: 'enum',
              options: ['Sent', 'Follow-Up Document Created', 'Finished', 'Canceled'] },
            { key: 'item_description', label: 'Item', editable: false, type: 'text' },
            { key: 'ordered_quantity', label: 'Qty', editable: false, type: 'number' },
            { key: 'net_value', label: 'Net Value', editable: false, type: 'number' },
            { key: 'delivery_date_from', label: 'Delivery Date', editable: true, type: 'date' },
            { key: 'created_at', label: 'Created', editable: false, type: 'datetime' },
            // Edit-only fields — show in the modal and CSV export, hidden from
            // the row table to keep it readable. Each is editable for manual
            // override of values that normally come from the Excel sync.
            { key: 'item_status', label: 'Item Status', editable: true, type: 'text', inTable: false },
            { key: 'delivery_status', label: 'Delivery Status', editable: true, type: 'text', inTable: false },
            { key: 'category', label: 'Category', editable: true, type: 'text', inTable: false },
            { key: 'sub_category', label: 'Sub-Category', editable: true, type: 'text', inTable: false },
        ],
        searchColumns: ['purchase_order_id', 'po_description', 'supplier', 'item_description'],
    },
    shipments: {
        label: 'Shipments (Inbound)',
        category: 'Procurement',
        icon: 'fa-truck-loading',
        idField: 'id',
        orderBy: 'id',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'shipment_number', label: 'Shipment #', editable: false, type: 'text' },
            { key: 'supplier', label: 'Supplier', editable: false, type: 'text' },
            { key: 'status', label: 'Status', editable: true, type: 'text' },
            { key: 'category', label: 'Category', editable: false, type: 'text' },
            { key: 'po_number', label: 'PO #', editable: false, type: 'text' },
            { key: 'eta', label: 'ETA', editable: false, type: 'date' },
            { key: 'delivery_date', label: 'Delivered', editable: false, type: 'date' },
            { key: 'part_description', label: 'Description', editable: false, type: 'text' },
            { key: 'num_pieces', label: 'Pieces', editable: false, type: 'number' },
        ],
        searchColumns: ['shipment_number', 'supplier', 'po_number', 'part_description'],
    },
    material_links: {
        label: 'Material Links',
        category: 'Procurement',
        icon: 'fa-link',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'po_id', label: 'PO ID', editable: false, type: 'text' },
            { key: 'po_description', label: 'PO Description', editable: false, type: 'text' },
            { key: 'install_tag', label: 'Install Tag', editable: false, type: 'text' },
            { key: 'install_discipline', label: 'Discipline', editable: false, type: 'text' },
            { key: 'material_status', label: 'Status', editable: true, type: 'enum', options: ['ordered', 'shipped', 'received', 'installed'] },
            { key: 'quantity', label: 'Qty', editable: false, type: 'number' },
            { key: 'uom', label: 'UOM', editable: false, type: 'text' },
            { key: 'notes', label: 'Notes', editable: true, type: 'text' },
            { key: 'created_at', label: 'Created', editable: false, type: 'datetime' },
        ],
        searchColumns: ['po_id', 'install_tag', 'po_description', 'install_discipline'],
    },
    delivery_dates: {
        label: 'Delivery Dates',
        category: 'Procurement',
        icon: 'fa-calendar-alt',
        idField: 'id',
        orderBy: 'delivery_date',
        orderAsc: true,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'package_description', label: 'Package', editable: false, type: 'text' },
            { key: 'tag_number', label: 'Tag #', editable: false, type: 'text' },
            { key: 'supplier_name', label: 'Supplier', editable: false, type: 'text' },
            { key: 'po_number', label: 'PO #', editable: false, type: 'text' },
            { key: 'delivery_date', label: 'Delivery Date', editable: true, type: 'date' },
            { key: 'delivery_date_notes', label: 'Notes', editable: true, type: 'text' },
        ],
        searchColumns: ['package_description', 'tag_number', 'supplier_name', 'po_number'],
    },
    audit_log: {
        label: 'Audit Log',
        category: 'Reference',
        icon: 'fa-history',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'action', label: 'Action', editable: false, type: 'text' },
            { key: 'entity_type', label: 'Entity Type', editable: false, type: 'text' },
            { key: 'entity_id', label: 'Entity ID', editable: false, type: 'text' },
            { key: 'user_id', label: 'User ID', editable: false, type: 'text' },
            { key: 'details', label: 'Details', editable: false, type: 'json' },
            { key: 'created_at', label: 'Date', editable: false, type: 'datetime' },
        ],
        searchColumns: ['action', 'entity_type'],
    },
    project_schedule: {
        label: 'Project Schedule',
        category: 'Reference',
        icon: 'fa-tasks',
        idField: 'id',
        orderBy: 'start_date',
        orderAsc: true,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'activity_id', label: 'Activity ID', editable: false, type: 'text' },
            { key: 'activity_name', label: 'Activity', editable: false, type: 'text' },
            { key: 'start_date', label: 'Start', editable: false, type: 'date' },
            { key: 'finish_date', label: 'Finish', editable: false, type: 'date' },
            { key: 'status', label: 'Status', editable: true, type: 'text' },
            { key: 'percent_complete', label: '% Complete', editable: true, type: 'number' },
            { key: 'category', label: 'Category', editable: false, type: 'text' },
            { key: 'is_critical', label: 'Critical', editable: false, type: 'boolean' },
            { key: 'is_milestone', label: 'Milestone', editable: false, type: 'boolean' },
        ],
        searchColumns: ['activity_id', 'activity_name', 'category'],
    },
};

// ── State ──

let state = {
    currentTable: '',
    data: [],
    totalCount: 0,
    page: 0,
    pageSize: 25,
    search: '',
    sortColumn: '',
    sortAsc: true,
    editRecord: null,
    isNewRecord: false,
};

// ── Initialization ──

document.addEventListener('DOMContentLoaded', () => {
    buildTableSelector();
    bindEvents();
});

function buildTableSelector() {
    const select = document.getElementById('tableSelect');
    const categories = {};

    for (const [key, config] of Object.entries(TABLE_CONFIG)) {
        if (!categories[config.category]) categories[config.category] = [];
        categories[config.category].push({ key, label: config.label });
    }

    for (const [category, tables] of Object.entries(categories)) {
        const group = document.createElement('optgroup');
        group.label = category;
        tables.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.key;
            opt.textContent = t.label;
            group.appendChild(opt);
        });
        select.appendChild(group);
    }

    // Add empty default
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- Select Table --';
    defaultOpt.selected = true;
    select.prepend(defaultOpt);
}

function bindEvents() {
    document.getElementById('tableSelect').addEventListener('change', (e) => {
        if (e.target.value) {
            state.currentTable = e.target.value;
            state.page = 0;
            state.search = '';
            state.sortColumn = '';
            document.getElementById('searchInput').value = '';
            loadData();
        }
    });

    let searchTimer;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.search = e.target.value.trim();
            state.page = 0;
            loadData();
        }, 300);
    });

    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
        state.pageSize = parseInt(e.target.value);
        state.page = 0;
        loadData();
    });

    document.getElementById('btnRefresh').addEventListener('click', () => loadData());
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
    document.getElementById('btnPrevPage').addEventListener('click', () => { state.page--; loadData(); });
    document.getElementById('btnNextPage').addEventListener('click', () => { state.page++; loadData(); });
    document.getElementById('btnSaveRecord').addEventListener('click', saveRecord);
    document.getElementById('btnDeleteRecord').addEventListener('click', deleteRecord);
    document.getElementById('btnAddRecord').addEventListener('click', openAddModal);
}

// ── Data Loading ──

async function loadData() {
    const tableName = state.currentTable;
    const config = TABLE_CONFIG[tableName];
    if (!config) return;

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:2rem;"><i class="fas fa-spinner fa-spin fa-2x"></i></td></tr>`;

    // Update UI
    document.getElementById('tableTitle').innerHTML = `<i class="fas ${config.icon} me-2"></i>${config.label}`;
    document.getElementById('btnAddRecord').style.display = config.canInsert ? 'inline-block' : 'none';

    try {
        // Build query
        let query = projectSupabaseClient.from(tableName).select('*', { count: 'exact' });

        // Sort
        const sortCol = state.sortColumn || config.orderBy;
        const sortAsc = state.sortColumn ? state.sortAsc : config.orderAsc;
        if (sortCol) {
            query = query.order(sortCol, { ascending: sortAsc });
        }

        // Search (client-side ilike on searchable columns)
        if (state.search && config.searchColumns.length > 0) {
            const searchFilter = config.searchColumns
                .map(col => `${col}.ilike.%${state.search}%`)
                .join(',');
            query = query.or(searchFilter);
        }

        // Pagination
        const from = state.page * state.pageSize;
        const to = from + state.pageSize - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;
        if (error) throw error;

        state.data = data || [];
        state.totalCount = count || 0;

        renderTableHead(config);
        renderTableBody(config);
        renderPagination();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="20" class="empty-state"><i class="fas fa-exclamation-triangle d-block" style="color:#DC2626;"></i><p>${err.message}</p></td></tr>`;
    }
}

// ── Rendering ──

// Columns can opt out of the table view with `inTable: false` — they still
// appear in the edit modal and in CSV exports. Used for fields that are
// editable but too crowded to show in the table at a glance.
function tableColumns(config) {
    return config.columns.filter(col => col.inTable !== false);
}

function renderTableHead(config) {
    const thead = document.getElementById('tableHead');
    const sortCol = state.sortColumn || config.orderBy;

    thead.innerHTML = '<tr>' + tableColumns(config).map(col => {
        const isSorted = sortCol === col.key;
        const icon = isSorted
            ? (state.sortColumn ? (state.sortAsc ? 'fa-sort-up' : 'fa-sort-down') : (config.orderAsc ? 'fa-sort-up' : 'fa-sort-down'))
            : 'fa-sort';
        return `<th class="${isSorted ? 'sorted' : ''}" onclick="sortBy('${col.key}')">${col.label} <i class="fas ${icon} sort-icon"></i></th>`;
    }).join('') + '</tr>';
}

function renderTableBody(config) {
    const tbody = document.getElementById('tableBody');
    const visible = tableColumns(config);
    document.getElementById('recordCount').textContent = `${state.totalCount} record${state.totalCount !== 1 ? 's' : ''}`;

    if (state.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${visible.length}" class="empty-state"><i class="fas fa-inbox d-block"></i><p>No records found</p></td></tr>`;
        return;
    }

    tbody.innerHTML = state.data.map((row, idx) => {
        return '<tr onclick="openEditModal(' + idx + ')">' + visible.map(col => {
            const val = row[col.key];
            return `<td>${formatCell(val, col.type)}</td>`;
        }).join('') + '</tr>';
    }).join('');
}

function formatCell(value, type) {
    if (value === null || value === undefined) return '<span class="text-muted">—</span>';

    switch (type) {
        case 'datetime':
            return new Date(value).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
        case 'date':
            return value ? new Date(value + 'T00:00:00').toLocaleDateString('en-US') : '—';
        case 'boolean':
            return value
                ? '<span class="status-badge" style="background:#D1FAE5;color:#065F46;">Yes</span>'
                : '<span class="status-badge" style="background:#FEE2E2;color:#991B1B;">No</span>';
        case 'enum':
            return `<span class="status-badge" style="background:${statusColor(value)};color:white;">${value.replaceAll('_', ' ')}</span>`;
        case 'json':
            return typeof value === 'object' ? '<code>' + truncate(JSON.stringify(value), 60) + '</code>' : String(value);
        case 'number':
            return typeof value === 'number' ? value.toLocaleString() : String(value);
        default:
            return escapeHtml(truncate(String(value), 80));
    }
}

function statusColor(status) {
    const colors = {
        in_yard: '#16A34A', issued: '#D97706', shipped: '#2563EB', depleted: '#94A3B8',
        accepted: '#16A34A', partially_accepted: '#D97706', rejected: '#DC2626', pending: '#94A3B8',
        good: '#16A34A', damaged: '#DC2626', mixed: '#D97706',
        ordered: '#94A3B8', received: '#16A34A', installed: '#2563EB',
    };
    return colors[status] || '#64748B';
}

function renderPagination() {
    const totalPages = Math.ceil(state.totalCount / state.pageSize);
    const bar = document.getElementById('paginationBar');
    bar.style.display = totalPages > 1 ? 'flex' : 'none';

    document.getElementById('pageInfo').textContent = `Page ${state.page + 1} of ${totalPages} (${state.totalCount} records)`;
    document.getElementById('btnPrevPage').disabled = state.page <= 0;
    document.getElementById('btnNextPage').disabled = state.page >= totalPages - 1;
}

// ── Sorting ──

function sortBy(column) {
    if (state.sortColumn === column) {
        state.sortAsc = !state.sortAsc;
    } else {
        state.sortColumn = column;
        state.sortAsc = true;
    }
    loadData();
}

// ── Edit Modal ──

function openEditModal(rowIndex) {
    const config = TABLE_CONFIG[state.currentTable];
    const record = state.data[rowIndex];
    state.editRecord = record;
    state.isNewRecord = false;

    document.getElementById('editModalTitle').textContent = `Edit ${config.label} Record`;
    document.getElementById('btnDeleteRecord').style.display = config.canDelete ? 'inline-block' : 'none';
    document.getElementById('btnSaveRecord').textContent = ' Save Changes';
    document.getElementById('btnSaveRecord').innerHTML = '<i class="fas fa-save me-1"></i> Save Changes';

    const hasEditable = config.columns.some(c => c.editable);
    document.getElementById('btnSaveRecord').style.display = hasEditable ? 'inline-block' : 'none';

    renderEditForm(config, record);

    const modal = new bootstrap.Modal(document.getElementById('editModal'));
    modal.show();
}

function openAddModal() {
    const config = TABLE_CONFIG[state.currentTable];
    state.editRecord = {};
    state.isNewRecord = true;

    document.getElementById('editModalTitle').textContent = `Add ${config.label} Record`;
    document.getElementById('btnDeleteRecord').style.display = 'none';
    document.getElementById('btnSaveRecord').innerHTML = '<i class="fas fa-plus me-1"></i> Create';
    document.getElementById('btnSaveRecord').style.display = 'inline-block';

    renderEditForm(config, {});

    const modal = new bootstrap.Modal(document.getElementById('editModal'));
    modal.show();
}

function renderEditForm(config, record) {
    const body = document.getElementById('editModalBody');

    // Show ID field at top for existing records
    let html = '';
    if (!state.isNewRecord && record[config.idField]) {
        html += `<div class="field-group">
            <label>ID <span class="badge bg-secondary">read-only</span></label>
            <div class="field-readonly">${record[config.idField]}</div>
        </div>`;
    }

    config.columns.forEach(col => {
        const value = record[col.key] ?? '';
        const editable = state.isNewRecord ? (col.key !== 'created_at' && col.type !== 'datetime') : col.editable;

        html += `<div class="field-group">`;
        html += `<label>${col.label} ${!editable ? '<span class="badge bg-secondary">read-only</span>' : ''}</label>`;

        if (!editable) {
            html += `<div class="field-readonly">${formatCell(value, col.type)}</div>`;
        } else {
            switch (col.type) {
                case 'enum':
                    html += `<select class="form-select" data-field="${col.key}">`;
                    (col.options || []).forEach(opt => {
                        html += `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt || '(none)'}</option>`;
                    });
                    html += `</select>`;
                    break;
                case 'boolean':
                    html += `<select class="form-select" data-field="${col.key}">
                        <option value="true" ${value === true ? 'selected' : ''}>Yes</option>
                        <option value="false" ${value === false || value === '' ? 'selected' : ''}>No</option>
                    </select>`;
                    break;
                case 'number':
                    html += `<input type="number" class="form-control" data-field="${col.key}" value="${value}" step="any">`;
                    break;
                case 'date':
                    html += `<input type="date" class="form-control" data-field="${col.key}" value="${value || ''}">`;
                    break;
                default:
                    html += `<input type="text" class="form-control" data-field="${col.key}" value="${escapeHtml(String(value))}">`;
            }
        }
        html += `</div>`;
    });

    body.innerHTML = html;
}

// ── Save / Insert ──

async function saveRecord() {
    const config = TABLE_CONFIG[state.currentTable];
    const changes = {};

    // Collect editable field values from modal
    document.querySelectorAll('#editModalBody [data-field]').forEach(el => {
        const col = config.columns.find(c => c.key === el.dataset.field);
        if (!col) return;

        let value = el.value;
        if (col.type === 'boolean') value = value === 'true';
        else if (col.type === 'number') value = value === '' ? null : parseFloat(value);
        else if (value === '') value = null;

        changes[el.dataset.field] = value;
    });

    if (Object.keys(changes).length === 0) {
        bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
        return;
    }

    const btn = document.getElementById('btnSaveRecord');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Saving...';

    try {
        if (state.isNewRecord) {
            const { error } = await projectSupabaseClient
                .from(state.currentTable)
                .insert(changes);
            if (error) throw error;
        } else {
            const id = state.editRecord[config.idField];
            const { error } = await projectSupabaseClient
                .from(state.currentTable)
                .update(changes)
                .eq(config.idField, id);
            if (error) throw error;
        }

        bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
        loadData();
    } catch (err) {
        alert('Save failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save me-1"></i> Save Changes';
    }
}

// ── Delete ──

async function deleteRecord() {
    const config = TABLE_CONFIG[state.currentTable];
    const id = state.editRecord[config.idField];

    if (!confirm(`Are you sure you want to delete this ${config.label} record? This cannot be undone.`)) return;

    const btn = document.getElementById('btnDeleteRecord');
    btn.disabled = true;

    try {
        const { error } = await projectSupabaseClient
            .from(state.currentTable)
            .delete()
            .eq(config.idField, id);
        if (error) throw error;

        bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
        loadData();
    } catch (err) {
        alert('Delete failed: ' + err.message);
    } finally {
        btn.disabled = false;
    }
}

// ── CSV Export ──

function exportCSV() {
    const config = TABLE_CONFIG[state.currentTable];
    if (!config || state.data.length === 0) return;

    const headers = config.columns.map(c => c.label);
    const rows = state.data.map(row =>
        config.columns.map(col => {
            let val = row[col.key];
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') val = JSON.stringify(val);
            // Escape CSV
            val = String(val).replace(/"/g, '""');
            return `"${val}"`;
        })
    );

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.currentTable}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Utilities ──

function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '...' : str;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Make functions available globally for onclick handlers
window.sortBy = sortBy;
window.openEditModal = openEditModal;

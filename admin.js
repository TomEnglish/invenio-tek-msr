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
            { key: 'status', label: 'Status', editable: false, type: 'enum', options: ['in_yard', 'issued', 'shipped', 'depleted', 'written_off'] },
            { key: 'created_at', label: 'Created', editable: false, type: 'datetime' },
        ],
        searchColumns: ['material_type', 'size', 'grade', 'spec'],
        record: { type: 'materials' },
        // A material's photos were taken when it was received.
        photos: [{ kind: 'receipts', from: 'receiving_record_id' }],
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
        record: { type: 'receiving_records' },
        photos: [{ kind: 'receipts', from: 'id' }],
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
        record: { type: 'qr_codes' },
        // Item codes only: HU- codes are crate labels (022), listed on the Crates page.
        filter: query => query.neq('entity_type', 'handling_unit'),
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
        record: { type: 'purchase_orders' },
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
        record: { type: 'shipments' },
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
        // Driver-license entries keep the last four digits and load snapshots keep license fields: hidden here.
        clean: row => { row.details = withoutLicense(row.details); },
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

    // ── Photos ──
    // The photo rows themselves; each opens in the photo viewer.
    inspection_photos: {
        label: 'Receiving Photos',
        category: 'Photos',
        icon: 'fa-camera',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        // These rows have no project of their own: they are asked for through their receipt's.
        select: '*,receiving_records!inner(project_id)',
        filter: query => query.eq('receiving_records.project_id', InvenioProjectScope.getActiveProjectId()),
        columns: [
            { key: 'photo_type', label: 'Type', type: 'enum', options: ['general', 'damage', 'delivery_ticket'] },
            { key: '__receipt', label: 'Received Item', type: 'text', sortable: false },
            { key: 'created_at', label: 'Taken', type: 'datetime' },
        ],
        lookups: [{ column: 'receiving_record_id', table: 'receiving_records', select: 'id,material_type,po_number', as: '__receipt',
            text: receipt => [receipt.material_type, !receipt.po_number ? '' : /^po\b/i.test(receipt.po_number) ? receipt.po_number : `PO ${receipt.po_number}`]
                .filter(Boolean).join(' · ') }],
        searchColumns: ['photo_type'],
        record: { type: 'receiving_records', from: 'receiving_record_id' },
        photos: 'receipt',
    },
    inventory_photos: {
        label: 'Count Photos',
        category: 'Photos',
        icon: 'fa-camera-retro',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: '__item', label: 'Counted Item', type: 'text', sortable: false },
            { key: 'created_at', label: 'Taken', type: 'datetime' },
        ],
        lookups: [{ column: 'inventory_uid', table: 'inventory_records', key: 'uid', select: 'uid,qr_code,inventory_item', as: '__item',
            text: item => [item.qr_code, item.inventory_item].filter(Boolean).join(' · ') }],
        searchColumns: [],
        photos: 'count',
    },

    // ── Initial count ──
    inventory_records: {
        label: 'Count Records',
        category: 'Initial Count',
        icon: 'fa-barcode',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'qr_code', label: 'Tag', type: 'text' },
            { key: 'inventory_item', label: 'Item', type: 'text' },
            { key: 'item_description', label: 'Description', type: 'text', inTable: false },
            { key: 'part_number', label: 'Part Number', type: 'text', inTable: false },
            { key: '__category', label: 'Category', type: 'text', sortable: false },
            { key: 'quantity', label: 'Qty', type: 'number' },
            { key: 'uom', label: 'UOM', type: 'text' },
            { key: 'count_status', label: 'Status', type: 'enum', options: ['expected', 'counted', 'received'] },
            { key: 'condition', label: 'Condition', type: 'enum', options: ['good', 'damaged', 'mixed'] },
            { key: 'location', label: 'Location', type: 'text' },
            { key: 'source', label: 'Source', type: 'enum', options: ['import', 'field', 'legacy'], inTable: false },
            { key: 'is_high_value', label: 'High Value', type: 'boolean', inTable: false },
            { key: 'scanner_comments', label: 'Notes', type: 'text', inTable: false },
            { key: 'last_scanned_by', label: 'Last Scanned By', type: 'text', inTable: false },
            { key: 'counted_at', label: 'Counted', type: 'datetime' },
        ],
        lookups: [{ column: 'category_id', table: 'inventory_categories', select: 'id,name', as: '__category', text: category => category.name }],
        searchColumns: ['qr_code', 'inventory_item', 'item_description', 'part_number'],
        // Photos from the count, and from receiving once the item has been received.
        photos: [{ kind: 'count', from: 'uid' }, { kind: 'receipts', from: 'receiving_record_id' }],
    },
    inventory_categories: {
        label: 'Categories',
        category: 'Initial Count',
        icon: 'fa-sitemap',
        idField: 'id',
        orderBy: 'name',
        orderAsc: true,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: '__parent', label: 'Inside', type: 'text', sortable: false },
            { key: 'status', label: 'Status', type: 'enum', options: ['active', 'proposed', 'archived'] },
            { key: 'sort_order', label: 'Order', type: 'number' },
            { key: 'created_at', label: 'Created', type: 'datetime' },
        ],
        lookups: [{ column: 'parent_id', table: 'inventory_categories', select: 'id,name', as: '__parent', text: category => category.name }],
        searchColumns: ['name'],
    },
    site_maps: {
        label: 'Site Maps',
        category: 'Initial Count',
        icon: 'fa-map',
        idField: 'id',
        orderBy: 'name',
        orderAsc: true,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'is_active', label: 'Active', type: 'boolean' },
            { key: 'image_width', label: 'Width (px)', type: 'number' },
            { key: 'image_height', label: 'Height (px)', type: 'number' },
            { key: 'created_at', label: 'Created', type: 'datetime' },
        ],
        searchColumns: ['name'],
    },
    site_map_zones: {
        label: 'Map Areas',
        category: 'Initial Count',
        icon: 'fa-draw-polygon',
        idField: 'id',
        orderBy: 'name',
        orderAsc: true,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: '__map', label: 'Site Map', type: 'text', sortable: false },
            { key: '__parent', label: 'Inside', type: 'text', sortable: false },
            { key: 'is_active', label: 'Active', type: 'boolean' },
            { key: 'created_at', label: 'Created', type: 'datetime' },
        ],
        lookups: [
            { column: 'map_id', table: 'site_maps', select: 'id,name', as: '__map', text: map => map.name },
            { column: 'parent_id', table: 'site_map_zones', select: 'id,name', as: '__parent', text: zone => zone.name },
        ],
        searchColumns: ['name'],
    },

    // ── Logistics ──
    // Places are shared by every project, so this list is the same in each.
    places: {
        label: 'Places',
        category: 'Logistics',
        icon: 'fa-map-pin',
        idField: 'id',
        orderBy: 'name',
        orderAsc: true,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'kind', label: 'Kind', type: 'enum', options: ['yard', 'site', 'outside_shop', 'vendor', 'other'] },
            { key: 'city', label: 'City', type: 'text' },
            { key: 'state', label: 'State', type: 'text' },
            { key: 'address', label: 'Address', type: 'text', inTable: false },
            { key: 'postal_code', label: 'ZIP Code', type: 'text', inTable: false },
            { key: 'latitude', label: 'Latitude', type: 'text', inTable: false },
            { key: 'longitude', label: 'Longitude', type: 'text', inTable: false },
            { key: 'geofence_radius_m', label: 'Arrival Radius (m)', type: 'number', inTable: false },
            { key: 'contact_name', label: 'Contact', type: 'text' },
            { key: 'contact_phone', label: 'Phone', type: 'text' },
            { key: 'contact_email', label: 'Email', type: 'text', inTable: false },
            { key: 'notes', label: 'Notes', type: 'text', inTable: false },
            { key: 'is_active', label: 'Active', type: 'boolean' },
        ],
        searchColumns: ['name', 'city', 'state', 'contact_name'],
    },
    handling_unit_overview: {
        label: 'Crates',
        category: 'Logistics',
        icon: 'fa-box',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'code', label: 'Label', type: 'text' },
            { key: 'kind', label: 'Kind', type: 'enum', options: ['crate', 'skid', 'bundle', 'basket', 'container', 'other'] },
            { key: 'description', label: 'Description', type: 'text' },
            { key: 'status', label: 'Status', type: 'enum', options: ['open', 'sealed', 'on_load', 'delivered', 'unpacked'] },
            { key: 'item_count', label: 'Items', type: 'number' },
            { key: 'parent_code', label: 'Inside', type: 'text' },
            { key: 'place_name', label: 'Place', type: 'text' },
            { key: 'location', label: 'Location', type: 'text', inTable: false },
            { key: 'load_number', label: 'Load', type: 'text' },
            { key: 'is_high_value', label: 'High Value', type: 'boolean', inTable: false },
            { key: 'sealed_at', label: 'Sealed', type: 'datetime', inTable: false },
            { key: 'created_at', label: 'Created', type: 'datetime' },
        ],
        searchColumns: ['code', 'description'],
    },
    handling_unit_items: {
        label: 'Crate Contents',
        category: 'Logistics',
        icon: 'fa-boxes',
        idField: 'id',
        orderBy: 'packed_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'unit_code', label: 'Crate', type: 'text' },
            { key: 'tag', label: 'Tag', type: 'text' },
            { key: 'name', label: 'Item', type: 'text' },
            { key: 'quantity', label: 'Qty', type: 'number' },
            { key: 'uom', label: 'UOM', type: 'text' },
            { key: 'packed_at', label: 'Packed', type: 'datetime' },
        ],
        lookups: [{ column: 'material_id', table: 'materials', select: 'id,receiving_record_id', as: '__receipt', text: material => material.receiving_record_id }],
        searchColumns: ['unit_code', 'tag', 'name'],
        photos: [{ kind: 'count', from: 'inventory_uid' }, { kind: 'receipts', from: '__receipt' }],
    },
    load_overview: {
        label: 'Loads',
        category: 'Logistics',
        icon: 'fa-truck',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        // Named columns only: license details stay on the Loads page, for the office.
        select: 'id,load_number,status,origin_name,next_stop,planned_date,driver_name,driver_phone,truck_type,truck_number,trailer_number,bol_number,'
            + 'stop_count,planned_count,on_board_count,delivered_count,missing_count,notes,departed_at,delivered_at,closed_at,created_at',
        columns: [
            { key: 'load_number', label: 'Load', type: 'text' },
            { key: 'status', label: 'Status', type: 'enum', options: ['planning', 'loading', 'in_transit', 'delivered', 'closed', 'cancelled'] },
            { key: 'origin_name', label: 'From', type: 'text' },
            { key: 'next_stop', label: 'Next Stop', type: 'text' },
            { key: 'planned_date', label: 'Planned', type: 'date' },
            { key: 'driver_name', label: 'Driver', type: 'text' },
            { key: 'driver_phone', label: 'Driver Phone', type: 'text', inTable: false },
            { key: 'truck_type', label: 'Truck Type', type: 'text', inTable: false },
            { key: 'truck_number', label: 'Truck #', type: 'text', inTable: false },
            { key: 'trailer_number', label: 'Trailer #', type: 'text', inTable: false },
            { key: 'bol_number', label: 'BOL #', type: 'text', inTable: false },
            { key: 'stop_count', label: 'Stops', type: 'number' },
            { key: 'planned_count', label: 'Pieces', type: 'number' },
            { key: 'on_board_count', label: 'On Board', type: 'number' },
            { key: 'delivered_count', label: 'Delivered', type: 'number' },
            { key: 'missing_count', label: 'Missing', type: 'number' },
            { key: 'notes', label: 'Notes', type: 'text', inTable: false },
            { key: 'departed_at', label: 'Departed', type: 'datetime', inTable: false },
            { key: 'delivered_at', label: 'Delivered On', type: 'datetime', inTable: false },
            { key: 'closed_at', label: 'Closed', type: 'datetime', inTable: false },
            { key: 'created_at', label: 'Created', type: 'datetime' },
        ],
        searchColumns: ['load_number', 'driver_name', 'truck_number', 'bol_number'],
    },
    load_stop_overview: {
        label: 'Load Stops',
        category: 'Logistics',
        icon: 'fa-map-signs',
        idField: 'id',
        orderBy: 'planned_date',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: '__load', label: 'Load', type: 'text', sortable: false },
            { key: 'seq', label: 'Stop', type: 'number' },
            { key: 'place_name', label: 'Place', type: 'text' },
            { key: 'kind', label: 'Kind', type: 'enum', options: ['dropoff', 'pickup', 'both'] },
            { key: 'status', label: 'Status', type: 'enum', options: ['pending', 'arrived', 'done', 'cancelled'] },
            { key: 'planned_date', label: 'Planned', type: 'date' },
            { key: 'arrived_at', label: 'Arrived', type: 'datetime' },
            { key: 'arrived_source', label: 'Arrival Recorded By', type: 'enum', options: ['scan', 'tracker', 'office'], inTable: false },
            { key: 'due_count', label: 'Due', type: 'number' },
            { key: 'delivered_count', label: 'Delivered', type: 'number' },
            { key: 'missing_count', label: 'Missing', type: 'number' },
        ],
        lookups: [{ column: 'load_id', table: 'load_overview', select: 'id,load_number', as: '__load', text: load => load.load_number }],
        searchColumns: ['place_name'],
    },
    load_line_overview: {
        label: 'Load Manifest',
        category: 'Logistics',
        icon: 'fa-clipboard-check',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: 'load_number', label: 'Load', type: 'text' },
            { key: 'tag', label: 'Tag', type: 'text' },
            { key: 'name', label: 'Item', type: 'text' },
            { key: 'status', label: 'Status', type: 'enum', options: ['planned', 'on_board', 'delivered', 'missing', 'not_loaded', 'removed', 'written_off'] },
            { key: 'pickup_place', label: 'Pick Up', type: 'text' },
            { key: 'dropoff_place', label: 'Drop Off', type: 'text' },
            { key: 'delivered_place', label: 'Delivered To', type: 'text', inTable: false },
            { key: 'flag', label: 'Flag', type: 'text', inTable: false },
            { key: 'note', label: 'Note', type: 'text', inTable: false },
            { key: 'on_at', label: 'On Board', type: 'datetime', inTable: false },
            { key: 'off_at', label: 'Off', type: 'datetime', inTable: false },
            { key: 'created_at', label: 'Added', type: 'datetime' },
        ],
        lookups: [{ column: 'material_id', table: 'materials', select: 'id,receiving_record_id', as: '__receipt', text: material => material.receiving_record_id }],
        searchColumns: ['load_number', 'tag', 'name'],
        photos: [{ kind: 'count', from: 'inventory_uid' }, { kind: 'receipts', from: '__receipt' }],
    },
    load_companies: {
        label: 'Load Companies',
        category: 'Logistics',
        icon: 'fa-building',
        idField: 'id',
        orderBy: 'created_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        columns: [
            { key: '__load', label: 'Load', type: 'text', sortable: false },
            { key: 'position', label: 'Order', type: 'number' },
            { key: 'name', label: 'Company', type: 'text' },
            { key: 'role', label: 'Role', type: 'enum', options: ['broker', 'carrier', 'dispatcher', 'other'] },
            { key: 'contact_name', label: 'Contact', type: 'text' },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'created_at', label: 'Added', type: 'datetime' },
        ],
        lookups: [{ column: 'load_id', table: 'load_overview', select: 'id,load_number', as: '__load', text: load => load.load_number }],
        searchColumns: ['name', 'contact_name'],
    },

    // ── Tracking ──
    samsara_trackers: {
        label: 'GPS Trackers',
        category: 'Tracking',
        icon: 'fa-satellite-dish',
        idField: 'id',
        orderBy: 'last_seen_at',
        orderAsc: false,
        canInsert: false,
        canDelete: false,
        fileName: 'gps_trackers',
        select: 'id,name,last_latitude,last_longitude,last_accuracy_meters,last_seen_at,is_on_site,distance_from_site_km,synced_at',
        columns: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'last_seen_at', label: 'Last Seen', type: 'datetime' },
            { key: 'last_latitude', label: 'Latitude', type: 'text' },
            { key: 'last_longitude', label: 'Longitude', type: 'text' },
            { key: 'last_accuracy_meters', label: 'Accuracy (m)', type: 'number', inTable: false },
            { key: 'is_on_site', label: 'On Site', type: 'boolean' },
            { key: 'distance_from_site_km', label: 'Distance (km)', type: 'number' },
            { key: 'synced_at', label: 'Updated', type: 'datetime', inTable: false },
        ],
        searchColumns: ['name'],
    },
};
// The order the groups appear in the table list.
const CATEGORY_ORDER = ['Inventory', 'Photos', 'Initial Count', 'Logistics', 'Tracking', 'Procurement', 'Reference'];
// Corrections to physical records use audited operations; history remains read-only.
for (const [table, config] of Object.entries(TABLE_CONFIG)) {
    config.canDelete = false;
    if (['receiving_records','qr_codes','material_movements','material_issues','shipments_out','audit_log'].includes(table)) {
        config.canInsert = false; config.columns.forEach(c => { c.editable = false; });
    }
    if (table === 'materials') config.columns.forEach(c => { c.editable = ['material_type','size','grade','spec','weight'].includes(c.key); });
}


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
    loadToken: 0,
    dataTable: null,
    photos: null,
    photosReady: Promise.resolve(),
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

    const rank = category => (CATEGORY_ORDER.indexOf(category) + 1) || CATEGORY_ORDER.length + 1;
    for (const [category, tables] of Object.entries(categories).sort(([a], [b]) => rank(a) - rank(b))) {
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
    if (window.InvenioAuthReady && !(await window.InvenioAuthReady)) return;
    const tableName = state.currentTable;
    const config = TABLE_CONFIG[tableName];
    if (!config) return;

    // A later table, page or search replaces this one; its answers are then ignored. Until it loads,
    // nothing of the last table is kept to export or open.
    const token = ++state.loadToken;
    state.data = [];
    state.dataTable = null;
    state.totalCount = 0;
    state.photos = null;
    const search = document.getElementById('searchInput');
    search.disabled = !config.searchColumns.length;
    search.placeholder = config.searchColumns.length ? 'Search across columns...' : 'This table has no search';
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:2rem;"><i class="fas fa-spinner fa-spin fa-2x"></i></td></tr>`;

    // Update UI
    document.getElementById('tableTitle').innerHTML = `<i class="fas ${config.icon} me-2"></i>${config.label}`;
    document.getElementById('btnAddRecord').style.display = config.canInsert ? 'inline-block' : 'none';

    try {
        // Build query
        let query = projectSupabaseClient.from(tableName).select(config.select || '*', { count: 'exact' });
        if (config.filter) query = config.filter(query);

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
        if (token !== state.loadToken) return;

        const rows = data || [];
        if (config.clean) rows.forEach(config.clean);
        await addLookups(config, rows);
        if (token !== state.loadToken) return;
        state.data = rows;
        state.dataTable = tableName;
        state.totalCount = count || 0;
        // null while the photos load, 'error' if they could not, else one list per row.
        state.photos = null;
        state.photosReady = config.photos ? loadRowPhotos(config, rows, token) : Promise.resolve();

        renderTableHead(config);
        renderTableBody(config);
        renderPagination();
    } catch (err) {
        if (token !== state.loadToken) return;
        state.photos = 'error';
        // The server's own words can name its tables; the console keeps them.
        console.warn(`Could not load ${tableName}:`, err?.message || err);
        tbody.innerHTML = `<tr><td colspan="20" class="empty-state"><i class="fas fa-exclamation-triangle d-block" style="color:#DC2626;"></i><p>${escapeHtml(`This table could not be loaded${err?.code ? ` (${err.code})` : ''}. Refresh to try again.`)}</p></td></tr>`;
    }
}

// Names for the IDs a table holds (a load's number, a category's name), looked up for the rows shown.
// A lookup that fails leaves its column empty rather than the table.
async function addLookups(config, rows) {
    for (const lookup of config.lookups || []) {
        const key = lookup.key || 'id';
        rows.forEach(row => { row[lookup.as] = null; });
        const ids = [...new Set(rows.map(row => row[lookup.column]).filter(id => id !== null && id !== undefined && id !== ''))];
        if (!ids.length) continue;
        try {
            const found = new Map();
            for (let i = 0; i < ids.length; i += 100) {
                const { data, error } = await projectSupabaseClient.from(lookup.table).select(lookup.select).in(key, ids.slice(i, i + 100));
                if (error) throw error;
                (data || []).forEach(item => found.set(String(item[key]), item));
            }
            rows.forEach(row => {
                const item = found.get(String(row[lookup.column]));
                row[lookup.as] = item ? (lookup.text(item) ?? null) : null;
            });
        } catch (err) {
            console.warn(`Could not look up ${lookup.table}:`, err?.message || err);
        }
    }
}

// Each row's photos: the row itself on the photo tables, else from each source the table names.
async function loadRowPhotos(config, rows, token) {
    let lists;
    try {
        if (typeof config.photos === 'string') {
            lists = rows.map(row => row.storage_path ? [InvenioPhotos.fromRow(config.photos, row)] : []);
        } else {
            const found = await Promise.all(config.photos.map(source => {
                const keys = rows.map(row => row[source.from]);
                return source.kind === 'receipts' ? InvenioPhotos.loadForReceipts(keys) : InvenioPhotos.load(source.kind, keys);
            }));
            lists = rows.map(row => InvenioPhotos.merge(...config.photos.map((source, n) =>
                row[source.from] === null || row[source.from] === undefined ? [] : found[n].get(String(row[source.from])) || [])));
        }
    } catch (err) {
        console.warn('Could not load photos:', err?.message || err);
        lists = 'error';
    }
    if (token !== state.loadToken) return;
    state.photos = lists;
    renderTableBody(config);
}

function photoCell(rowIndex) {
    if (state.photos === null) return '<td class="text-muted" aria-busy="true">…</td>';
    if (state.photos === 'error') return '<td class="text-muted">Unavailable</td>';
    const photos = state.photos[rowIndex] || [];
    return `<td>${photos.length ? InvenioPhotos.chipHtml(photos.length, rowIndex) : '<span class="text-muted">—</span>'}</td>`;
}

// The photos a row's button opens, and which one first. On the photo tables that is every photo
// on the page, starting at the row's own, so they can be paged through.
function photosFor(rowIndex) {
    const config = TABLE_CONFIG[state.currentTable];
    if (!Array.isArray(state.photos)) return { photos: [], start: 0 };
    if (typeof config.photos === 'string') {
        const all = state.photos.flat();
        const own = state.photos[rowIndex]?.[0];
        return { photos: all, start: Math.max(0, all.indexOf(own)) };
    }
    return { photos: state.photos[rowIndex] || [], start: 0 };
}

function rowClicked(event, rowIndex) {
    const chip = event?.target?.closest?.('[data-photo-index]');
    if (chip) {
        const { photos, start } = photosFor(rowIndex);
        InvenioPhotos.open(photos, start, chip);
        return;
    }
    openEditModal(rowIndex);
}

function recordHref(config, record) {
    if (!config.record) return '';
    const id = record[config.record.from || 'id'];
    if (id === null || id === undefined || id === '') return '';
    return `record.html?type=${encodeURIComponent(config.record.type)}&id=${encodeURIComponent(id)}`;
}

// The open record's photos, once the page's photos have loaded. A reload while the record is open
// (a search, a page) is waited for, and the record found again by its ID.
async function showRecordPhotos(record) {
    const config = TABLE_CONFIG[state.currentTable];
    if (!config.photos) return;
    const container = document.getElementById('recordPhotoStrip');
    for (let waited = 0; ; waited += 50) {
        const token = state.loadToken;
        await state.photosReady;
        if (state.editRecord !== record) return;
        if ((token !== state.loadToken || state.photos === null) && waited < 30000) { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
        if (!Array.isArray(state.photos)) {
            container.textContent = 'Photos could not be loaded. Refresh to try again.';
            return;
        }
        const at = state.data.findIndex(row => row[config.idField] === record[config.idField]);
        if (at === -1) {
            container.textContent = 'This record is no longer in the list. Close it and open it again to see its photos.';
            return;
        }
        await InvenioPhotos.strip(container, state.photos[at] || []);
        return;
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
        if (col.sortable === false) return `<th>${col.label}</th>`;
        const isSorted = sortCol === col.key;
        const icon = isSorted
            ? (state.sortColumn ? (state.sortAsc ? 'fa-sort-up' : 'fa-sort-down') : (config.orderAsc ? 'fa-sort-up' : 'fa-sort-down'))
            : 'fa-sort';
        return `<th class="${isSorted ? 'sorted' : ''}" onclick="sortBy('${col.key}')">${col.label} <i class="fas ${icon} sort-icon"></i></th>`;
    }).join('') + (config.photos ? '<th>Photos</th>' : '') + '</tr>';
}

function renderTableBody(config) {
    const tbody = document.getElementById('tableBody');
    const visible = tableColumns(config);
    document.getElementById('recordCount').textContent = `${state.totalCount} record${state.totalCount !== 1 ? 's' : ''}`;

    if (state.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${visible.length + (config.photos ? 1 : 0)}" class="empty-state"><i class="fas fa-inbox d-block"></i><p>No records found</p></td></tr>`;
        return;
    }

    tbody.innerHTML = state.data.map((row, idx) => {
        return '<tr onclick="rowClicked(event, ' + idx + ')">' + visible.map(col => {
            const val = row[col.key];
            return `<td>${formatCell(val, col.type)}</td>`;
        }).join('') + (config.photos ? photoCell(idx) : '') + '</tr>';
    }).join('');
}

function formatCell(value, type) {
    if (value === null || value === undefined) return '<span class="text-muted">—</span>';

    switch (type) {
        case 'datetime': {
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? escapeHtml(String(value)) : date.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
        }
        case 'date': {
            const date = value ? new Date(value + 'T00:00:00') : null;
            return !date ? '—' : Number.isNaN(date.getTime()) ? escapeHtml(String(value)) : date.toLocaleDateString('en-US');
        }
        case 'boolean':
            return value
                ? '<span class="status-badge" style="background:#D1FAE5;color:#065F46;">Yes</span>'
                : '<span class="status-badge" style="background:#FEE2E2;color:#991B1B;">No</span>';
        case 'enum':
            return `<span class="status-badge" style="background:${statusColor(value)};color:white;">${escapeHtml(String(value).replaceAll('_', ' '))}</span>`;
        case 'json':
            return typeof value === 'object' ? '<code>' + escapeHtml(truncate(JSON.stringify(value), 60)) + '</code>' : escapeHtml(String(value));
        case 'number':
            return typeof value === 'number' ? value.toLocaleString() : escapeHtml(String(value));
        default:
            return escapeHtml(truncate(String(value), 80));
    }
}

function statusColor(status) {
    const colors = {
        in_yard: '#16A34A', issued: '#D97706', shipped: '#2563EB', depleted: '#94A3B8', written_off: '#475569',
        accepted: '#16A34A', partially_accepted: '#D97706', rejected: '#DC2626', pending: '#94A3B8',
        good: '#16A34A', damaged: '#DC2626', mixed: '#D97706',
        ordered: '#94A3B8', received: '#16A34A', installed: '#2563EB',
        expected: '#D97706', counted: '#2563EB', active: '#16A34A', proposed: '#D97706', archived: '#94A3B8',
        open: '#94A3B8', sealed: '#2563EB', on_load: '#D97706', delivered: '#16A34A', unpacked: '#475569',
        planning: '#94A3B8', loading: '#D97706', in_transit: '#2563EB', closed: '#475569', cancelled: '#475569',
        arrived: '#2563EB', done: '#16A34A', on_board: '#2563EB', missing: '#DC2626', not_loaded: '#475569', removed: '#94A3B8',
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
    // A photo still open from another record closes first.
    if (window.InvenioPhotos) InvenioPhotos.close();
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

    state.operationId = crypto.randomUUID();
    renderEditForm(config, record);

    const modal = new bootstrap.Modal(document.getElementById('editModal'));
    modal.show();
    showRecordPhotos(record);
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
            <div class="field-readonly">${escapeHtml(record[config.idField])}</div>
        </div>`;
    }

    config.columns.forEach(col => {
        const stored = record[col.key];
        const value = stored ?? '';
        const editable = state.isNewRecord ? (col.key !== 'created_at' && col.type !== 'datetime') : col.editable;

        html += `<div class="field-group">`;
        html += `<label>${col.label} ${!editable ? '<span class="badge bg-secondary">read-only</span>' : ''}</label>`;

        if (!editable) {
            html += `<div class="field-readonly">${formatCell(stored, col.type)}</div>`;
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
                    html += `<input type="number" class="form-control" data-field="${col.key}" value="${escapeHtml(value)}" step="any">`;
                    break;
                case 'date':
                    html += `<input type="date" class="form-control" data-field="${col.key}" value="${escapeHtml(value || '')}">`;
                    break;
                default:
                    html += `<input type="text" class="form-control" data-field="${col.key}" value="${escapeHtml(String(value))}">`;
            }
        }
        html += `</div>`;
    });

    if (state.currentTable === 'materials') html += '<div class="field-group"><label for="correctionReason">Reason for correction</label><textarea id="correctionReason" class="form-control" minlength="5" required></textarea></div>';
    if (!state.isNewRecord && config.photos) {
        html += '<div class="field-group"><label>Photos</label><div id="recordPhotoStrip" class="photo-strip"><span class="text-muted">Loading photos…</span></div></div>';
    }
    const href = state.isNewRecord ? '' : recordHref(config, record);
    if (href) html += `<div class="field-group"><a class="btn btn-outline-primary btn-sm" href="${escapeHtml(href)}"><i class="fas fa-external-link-alt me-1" aria-hidden="true"></i>Open record details</a></div>`;
    body.innerHTML = html;
}

// ── Save / Insert ──

async function saveRecord() {
    if (window.InvenioAuthReady && !(await window.InvenioAuthReady)) return;
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
        } else if (state.currentTable === 'materials') {
            const reason = document.getElementById('correctionReason').value.trim();
            if (reason.length < 5) throw new Error('Explain the correction in at least five characters.');
            const { error } = await supabaseClient.rpc('apply_field_operation', { p_operation_id: state.operationId, p_project_id: InvenioProjectScope.getActiveProjectId(), p_action: 'correct_material', p_payload: { materialId: state.editRecord.id, changes, reason } });
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
    if (window.InvenioAuthReady && !(await window.InvenioAuthReady)) return;
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
    if (!config || state.dataTable !== state.currentTable || state.data.length === 0) return;

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
    a.download = `${config.fileName || state.currentTable}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Utilities ──

function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '...' : str;
}

// A copy of a logged value with license details hidden: the last four digits, and license fields in snapshots.
function withoutLicense(value) {
    if (Array.isArray(value)) return value.map(withoutLicense);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
        [key, /licen[cs]e|^last4$/i.test(key) ? '(hidden)' : withoutLicense(item)]));
}

// Text for markup, quotes included: values also go inside the edit form's value="…" attributes.
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Make functions available globally for onclick handlers
window.sortBy = sortBy;
window.openEditModal = openEditModal;
window.rowClicked = rowClicked;

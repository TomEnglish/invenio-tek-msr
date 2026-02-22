-- ============================================================================
-- PO & Shipment Data Schema for MSR Dashboard
-- ============================================================================
-- Stores Purchase Order and Shipment data from Excel for auto-updating dashboard
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Drop existing tables if re-running
DROP TABLE IF EXISTS dashboard_metrics CASCADE;
DROP TABLE IF EXISTS shipments CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;

-- ============================================================================
-- TABLE: purchase_orders
-- ============================================================================
-- Stores PO line item data from "PO & Shipment Log.xlsx"
CREATE TABLE purchase_orders (
    id BIGSERIAL PRIMARY KEY,

    -- PO Identification
    purchase_order_id TEXT,
    po_description TEXT,
    purchase_order_item TEXT,
    item_uuid TEXT,  -- NOT unique - these are simple integers, not UUIDs

    -- Dates
    created_on DATE,
    item_last_change_date_time TIMESTAMPTZ,
    delivery_date_from DATE,

    -- Status
    status TEXT,
    item_status TEXT,
    delivery_status TEXT,

    -- Organization
    scope TEXT,
    po_li TEXT,
    shipment TEXT,
    category TEXT,
    sub_category TEXT,
    project_task TEXT,

    -- Supplier & Product
    supplier TEXT,
    item_description TEXT,
    item_remark_for_supplier TEXT,
    supplier_part_number TEXT,
    product TEXT,
    product_alt TEXT,  -- "Product.1" column
    manufacturer TEXT,
    manufacturer_part_number TEXT,

    -- Quantities & Pricing
    base_uom TEXT,
    item_type TEXT,
    ordered_quantity NUMERIC(15, 4),
    base_net_price_base_quantity_unit NUMERIC(15, 4),
    net_price NUMERIC(15, 2),
    net_value NUMERIC(15, 2),

    -- Logistics
    incoterms TEXT,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABLE: shipments
-- ============================================================================
-- Stores shipment tracking data from "PO & Shipment Log.xlsx"
CREATE TABLE shipments (
    id BIGSERIAL PRIMARY KEY,

    -- Shipment Identification
    shipment_number TEXT UNIQUE,
    project TEXT,
    po_number TEXT,

    -- Dates
    rts_date DATE,
    eta DATE,
    delivery_date DATE,
    delivery_time TEXT,

    -- Status & Category
    status TEXT,
    category TEXT,

    -- Supplier & Product
    supplier TEXT,
    part_description TEXT,

    -- Quantities & Logistics
    num_pieces INTEGER,
    num_loads INTEGER,
    truck_type TEXT,
    storage_location TEXT,
    ship_from TEXT,
    ship_to TEXT,
    shipper TEXT,
    shipment_by TEXT,  -- "Shipment By (RPS/Supplier)"

    -- Quality & Documentation
    ncr_osd BOOLEAN,  -- "NCR/OSD (X)"
    receiving_pics TEXT,
    detailed_packing_list TEXT,

    -- Notes
    progress_notes TEXT,
    special_receiving_instructions TEXT,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABLE: dashboard_metrics
-- ============================================================================
-- Stores calculated metrics for quick dashboard loading
CREATE TABLE dashboard_metrics (
    id SERIAL PRIMARY KEY,

    -- Metadata
    project_name TEXT DEFAULT 'Frame 6B Power Group',
    last_updated TIMESTAMPTZ DEFAULT NOW(),

    -- Procurement Metrics (JSON)
    procurement JSONB,
    -- Example structure:
    -- {
    --   "total_pos": 97,
    --   "total_po_value": 81945916.37,
    --   "total_shipments": 121,
    --   "delivered_shipments": 35,
    --   "in_transit_shipments": 2,
    --   "not_ready_shipments": 49
    -- }

    -- Installation Metrics (JSON)
    installation JSONB,
    -- Example structure:
    -- {
    --   "disciplines": ["civil", "electrical", ...],
    --   "total_items": 862,
    --   "total_field_hours": 16673.85,
    --   "by_discipline": { ... }
    -- }

    -- Status Counts (JSON)
    status_counts JSONB,
    -- Example structure:
    -- {
    --   "po_status": { "Sent": 102, ... },
    --   "shipment_status": { "Delivered": 35, ... }
    -- }

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_po_purchase_order_id ON purchase_orders(purchase_order_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_item_status ON purchase_orders(item_status);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier);
CREATE INDEX idx_po_category ON purchase_orders(category);
CREATE INDEX idx_po_delivery_date ON purchase_orders(delivery_date_from);

CREATE INDEX idx_shipment_number ON shipments(shipment_number);
CREATE INDEX idx_shipment_po_number ON shipments(po_number);
CREATE INDEX idx_shipment_status ON shipments(status);
CREATE INDEX idx_shipment_supplier ON shipments(supplier);
CREATE INDEX idx_shipment_category ON shipments(category);
CREATE INDEX idx_shipment_eta ON shipments(eta);
CREATE INDEX idx_shipment_delivery_date ON shipments(delivery_date);

-- ============================================================================
-- TRIGGERS: Update timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_po_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_po_timestamp
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_po_timestamp();

CREATE OR REPLACE FUNCTION update_shipment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_shipment_timestamp
    BEFORE UPDATE ON shipments
    FOR EACH ROW
    EXECUTE FUNCTION update_shipment_timestamp();

CREATE OR REPLACE FUNCTION update_metrics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_metrics_timestamp
    BEFORE UPDATE ON dashboard_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_metrics_timestamp();

-- ============================================================================
-- VIEWS: Dashboard Queries
-- ============================================================================

-- View: PO Summary Statistics
CREATE OR REPLACE VIEW vw_po_summary AS
SELECT
    COUNT(DISTINCT purchase_order_id) as total_pos,
    SUM(net_value) as total_po_value,
    COUNT(*) as total_line_items,
    COUNT(DISTINCT supplier) as total_suppliers,
    status,
    COUNT(*) as count_by_status
FROM purchase_orders
GROUP BY status;

-- View: Shipment Summary Statistics
CREATE OR REPLACE VIEW vw_shipment_summary AS
SELECT
    COUNT(*) as total_shipments,
    status,
    COUNT(*) as count_by_status,
    category,
    COUNT(*) as count_by_category
FROM shipments
GROUP BY status, category;

-- View: Recent Activity
CREATE OR REPLACE VIEW vw_recent_activity AS
SELECT
    'PO' as type,
    purchase_order_id as identifier,
    po_description as description,
    status,
    item_last_change_date_time as last_changed,
    synced_at
FROM purchase_orders
WHERE item_last_change_date_time IS NOT NULL
UNION ALL
SELECT
    'Shipment' as type,
    shipment_number as identifier,
    part_description as description,
    status,
    COALESCE(delivery_date, eta, rts_date)::timestamptz as last_changed,
    synced_at
FROM shipments
ORDER BY last_changed DESC NULLS LAST
LIMIT 100;

-- ============================================================================
-- FUNCTION: Calculate Dashboard Metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_dashboard_metrics()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    procurement_data JSONB;
    status_counts_data JSONB;
BEGIN
    -- Calculate procurement metrics
    SELECT jsonb_build_object(
        'total_pos', COUNT(DISTINCT purchase_order_id),
        'total_po_value', COALESCE(SUM(net_value), 0),
        'total_shipments', (SELECT COUNT(*) FROM shipments),
        'delivered_shipments', (SELECT COUNT(*) FROM shipments WHERE status = 'Delivered'),
        'in_transit_shipments', (SELECT COUNT(*) FROM shipments WHERE status IN ('In Transit', 'RTS')),
        'not_ready_shipments', (SELECT COUNT(*) FROM shipments WHERE status = 'Not RTS')
    )
    INTO procurement_data
    FROM purchase_orders;

    -- Calculate status counts
    SELECT jsonb_build_object(
        'po_status', (
            SELECT jsonb_object_agg(status, count)
            FROM (
                SELECT status, COUNT(*) as count
                FROM purchase_orders
                WHERE status IS NOT NULL
                GROUP BY status
            ) po_counts
        ),
        'shipment_status', (
            SELECT jsonb_object_agg(status, count)
            FROM (
                SELECT status, COUNT(*) as count
                FROM shipments
                WHERE status IS NOT NULL
                GROUP BY status
            ) ship_counts
        )
    )
    INTO status_counts_data;

    -- Combine all metrics
    result := jsonb_build_object(
        'procurement', procurement_data,
        'status_counts', status_counts_data,
        'last_updated', NOW()
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Refresh Dashboard Metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION refresh_dashboard_metrics()
RETURNS void AS $$
DECLARE
    metrics_data JSONB;
BEGIN
    -- Calculate fresh metrics
    metrics_data := calculate_dashboard_metrics();

    -- Upsert into dashboard_metrics table
    INSERT INTO dashboard_metrics (id, procurement, status_counts, last_updated)
    VALUES (1, metrics_data->'procurement', metrics_data->'status_counts', NOW())
    ON CONFLICT (id) DO UPDATE SET
        procurement = EXCLUDED.procurement,
        status_counts = EXCLUDED.status_counts,
        last_updated = NOW(),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✓ PO & Shipment Schema Created Successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - purchase_orders (PO line items)';
    RAISE NOTICE '  - shipments (shipment tracking)';
    RAISE NOTICE '  - dashboard_metrics (calculated metrics)';
    RAISE NOTICE '';
    RAISE NOTICE 'Views created:';
    RAISE NOTICE '  - vw_po_summary';
    RAISE NOTICE '  - vw_shipment_summary';
    RAISE NOTICE '  - vw_recent_activity';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions created:';
    RAISE NOTICE '  - calculate_dashboard_metrics()';
    RAISE NOTICE '  - refresh_dashboard_metrics()';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run sync_po_shipment_data.py to upload Excel data';
    RAISE NOTICE '  2. Check dashboard_metrics table for calculated stats';
    RAISE NOTICE '  3. Update dashboard.js to read from Supabase';
END $$;

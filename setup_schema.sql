-- ============================================================================
-- COMBINED SETUP SCHEMA - MSR Dashboard (Greenfield LNG Terminal)
-- ============================================================================
-- This file combines ALL individual schema files into a single re-runnable
-- setup script. Tables are created in dependency order:
--
--   1. po_shipment_schema.sql   - purchase_orders, shipments, dashboard_metrics
--   2. schema.sql               - material_links, material_status_history
--   3. samsara_schema.sql       - samsara_trackers, samsara_location_history
--                                 (references material_links)
--   4. delivery_dates_schema.sql - delivery_dates
--                                 (references purchase_orders in views)
--   5. project_schedule_schema.sql - project_schedule (standalone)
--
-- All DROP IF EXISTS statements are preserved so the script is re-runnable.
-- Run this in Supabase SQL Editor to set up the entire database.
-- ============================================================================


-- ############################################################################
-- PART 1: PO & Shipment Schema
-- ############################################################################

-- ============================================================================
-- PO & Shipment Data Schema for MSR Dashboard
-- ============================================================================
-- Stores Purchase Order and Shipment data from Excel for auto-updating dashboard
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
    project_name TEXT DEFAULT 'Greenfield LNG Terminal',
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
-- INDEXES (PO & Shipments)
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
-- TRIGGERS: Update timestamp (PO & Shipments)
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
-- VIEWS: Dashboard Queries (PO & Shipments)
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
-- Part 1 Complete
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '--- Part 1 Complete: purchase_orders, shipments, dashboard_metrics ---';
END $$;


-- ############################################################################
-- PART 2: Material Tracking Schema
-- ############################################################################

-- ============================================================================
-- Material Tracking System - Supabase Database Schema
-- ============================================================================
-- Project: Greenfield LNG Terminal MSR Dashboard
-- Purpose: Track material links between PO items and installation items
-- Database: PostgreSQL (Supabase)
-- ============================================================================

-- Drop existing tables if they exist (for clean reinstall)
DROP TABLE IF EXISTS material_status_history CASCADE;
DROP TABLE IF EXISTS material_links CASCADE;

-- ============================================================================
-- TABLE: material_links
-- ============================================================================
-- Stores the associations between PO items and installation items
-- Tracks material status throughout the project lifecycle

CREATE TABLE material_links (
    -- Primary key
    id BIGSERIAL PRIMARY KEY,

    -- Purchase Order Information
    po_id TEXT NOT NULL,
    po_line_item INTEGER,
    po_description TEXT,

    -- Installation Information
    install_tag TEXT,
    install_discipline TEXT CHECK (install_discipline IN ('Civil', 'Electrical', 'Instrumentation', 'Mechanical', 'Steel')),
    install_description TEXT,

    -- Material Status Tracking
    material_status TEXT NOT NULL DEFAULT 'ordered' CHECK (material_status IN ('ordered', 'shipped', 'received', 'installed')),

    -- Receipt Information
    receipt_date DATE,
    receipt_location TEXT,

    -- Installation Information
    installation_date DATE,

    -- Quantity Information
    quantity NUMERIC(10, 2),
    uom TEXT, -- Unit of Measure (EA, LBS, FT, etc.)

    -- Additional Information
    notes TEXT,
    linked_by TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Indexes for performance
    CONSTRAINT material_links_po_id_check CHECK (po_id != '')
);

-- Create indexes for faster queries
CREATE INDEX idx_material_links_po_id ON material_links(po_id);
CREATE INDEX idx_material_links_install_tag ON material_links(install_tag);
CREATE INDEX idx_material_links_status ON material_links(material_status);
CREATE INDEX idx_material_links_discipline ON material_links(install_discipline);
CREATE INDEX idx_material_links_created_at ON material_links(created_at DESC);

-- ============================================================================
-- TABLE: material_status_history
-- ============================================================================
-- Audit trail for status changes
-- Tracks who changed what and when

CREATE TABLE material_status_history (
    -- Primary key
    id BIGSERIAL PRIMARY KEY,

    -- Foreign key to material_links
    link_id BIGINT NOT NULL REFERENCES material_links(id) ON DELETE CASCADE,

    -- Status change information
    old_status TEXT,
    new_status TEXT NOT NULL,

    -- Change metadata
    changed_by TEXT,
    change_notes TEXT,

    -- Timestamp
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster history lookups
CREATE INDEX idx_status_history_link_id ON material_status_history(link_id);
CREATE INDEX idx_status_history_changed_at ON material_status_history(changed_at DESC);

-- ============================================================================
-- FUNCTION: Update updated_at timestamp
-- ============================================================================
-- Automatically updates the updated_at column when a row is modified

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_material_links_updated_at
    BEFORE UPDATE ON material_links
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- FUNCTION: Track status changes
-- ============================================================================
-- Automatically logs status changes to history table

CREATE OR REPLACE FUNCTION track_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if status actually changed
    IF (TG_OP = 'UPDATE' AND OLD.material_status IS DISTINCT FROM NEW.material_status) THEN
        INSERT INTO material_status_history (
            link_id,
            old_status,
            new_status,
            changed_by
        ) VALUES (
            NEW.id,
            OLD.material_status,
            NEW.material_status,
            NEW.linked_by
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to track status changes
CREATE TRIGGER track_material_status_changes
    AFTER UPDATE ON material_links
    FOR EACH ROW
    EXECUTE FUNCTION track_status_change();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Enable RLS for security (optional - see setup guide)
-- Uncomment these lines if you want to enable authentication

-- Enable RLS on tables
-- ALTER TABLE material_links ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE material_status_history ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anonymous read access (for development)
-- CREATE POLICY "Allow public read access" ON material_links
--     FOR SELECT
--     USING (true);

-- Policy: Allow anonymous insert/update/delete (for development)
-- CREATE POLICY "Allow public write access" ON material_links
--     FOR ALL
--     USING (true);

-- Policy: Allow public read access to history
-- CREATE POLICY "Allow public read history" ON material_status_history
--     FOR SELECT
--     USING (true);

-- ============================================================================
-- VIEWS (Material Tracking)
-- ============================================================================

-- View: Material links with full details
CREATE OR REPLACE VIEW vw_material_links_detailed AS
SELECT
    ml.id,
    ml.po_id,
    ml.po_line_item,
    ml.po_description,
    ml.install_tag,
    ml.install_discipline,
    ml.install_description,
    ml.material_status,
    ml.receipt_date,
    ml.receipt_location,
    ml.installation_date,
    ml.quantity,
    ml.uom,
    ml.notes,
    ml.linked_by,
    ml.created_at,
    ml.updated_at,
    -- Count of status changes
    (SELECT COUNT(*) FROM material_status_history WHERE link_id = ml.id) as status_change_count,
    -- Days since creation
    EXTRACT(DAY FROM (NOW() - ml.created_at))::INTEGER as days_since_created,
    -- Days since last update
    EXTRACT(DAY FROM (NOW() - ml.updated_at))::INTEGER as days_since_updated
FROM material_links ml
ORDER BY ml.created_at DESC;

-- View: Material statistics by discipline
CREATE OR REPLACE VIEW vw_stats_by_discipline AS
SELECT
    install_discipline,
    COUNT(*) as total_links,
    COUNT(*) FILTER (WHERE material_status = 'ordered') as ordered_count,
    COUNT(*) FILTER (WHERE material_status = 'shipped') as shipped_count,
    COUNT(*) FILTER (WHERE material_status = 'received') as received_count,
    COUNT(*) FILTER (WHERE material_status = 'installed') as installed_count,
    ROUND(AVG(quantity), 2) as avg_quantity
FROM material_links
GROUP BY install_discipline
ORDER BY total_links DESC;

-- View: Material statistics by status
CREATE OR REPLACE VIEW vw_stats_by_status AS
SELECT
    material_status,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM material_links
GROUP BY material_status
ORDER BY
    CASE material_status
        WHEN 'ordered' THEN 1
        WHEN 'shipped' THEN 2
        WHEN 'received' THEN 3
        WHEN 'installed' THEN 4
    END;

-- ============================================================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================================================
-- Uncomment to insert sample data for testing

/*
INSERT INTO material_links (
    po_id, po_line_item, po_description,
    install_tag, install_discipline, install_description,
    material_status, quantity, uom, linked_by
) VALUES
    ('4500012345', 10, 'W12x50 Steel Beams', 'STL-001', 'Steel', 'Main Support Beam', 'ordered', 12, 'EA', 'John Doe'),
    ('4500012346', 5, 'Electrical Conduit 2"', 'ELC-045', 'Electrical', 'Main Power Conduit', 'shipped', 500, 'FT', 'Jane Smith'),
    ('4500012347', 8, 'Control Valve 6"', 'INS-023', 'Instrumentation', 'Process Control Valve', 'received', 4, 'EA', 'Bob Johnson'),
    ('4500012348', 15, 'Concrete Mix', 'CIV-012', 'Civil', 'Foundation Pour', 'installed', 50, 'YD3', 'Mike Wilson'),
    ('4500012349', 3, 'Pump Motor 100HP', 'MEC-067', 'Mechanical', 'Primary Pump Drive', 'ordered', 1, 'EA', 'Sarah Davis');
*/

-- ============================================================================
-- FUNCTIONS FOR API (Material Tracking)
-- ============================================================================

-- Function: Get statistics
CREATE OR REPLACE FUNCTION get_material_statistics()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_links', (SELECT COUNT(*) FROM material_links),
        'status_breakdown', (
            SELECT json_object_agg(material_status, count)
            FROM vw_stats_by_status
        ),
        'discipline_breakdown', (
            SELECT json_object_agg(install_discipline, total_links)
            FROM vw_stats_by_discipline
        )
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function: Search material links
CREATE OR REPLACE FUNCTION search_material_links(search_query TEXT)
RETURNS SETOF material_links AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM material_links
    WHERE
        po_id ILIKE '%' || search_query || '%' OR
        po_description ILIKE '%' || search_query || '%' OR
        install_tag ILIKE '%' || search_query || '%' OR
        install_description ILIKE '%' || search_query || '%' OR
        notes ILIKE '%' || search_query || '%'
    ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS (Material Tracking)
-- ============================================================================

COMMENT ON TABLE material_links IS 'Stores associations between PO items and installation items with status tracking';
COMMENT ON TABLE material_status_history IS 'Audit trail for material status changes';
COMMENT ON COLUMN material_links.material_status IS 'Current status: ordered, shipped, received, or installed';
COMMENT ON COLUMN material_links.install_discipline IS 'Installation discipline: Civil, Electrical, Instrumentation, Mechanical, or Steel';

-- ============================================================================
-- Part 2 Complete
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '--- Part 2 Complete: material_links, material_status_history ---';
END $$;


-- ############################################################################
-- PART 3: Samsara Tracker Integration Schema
-- ############################################################################

-- ============================================================================
-- Samsara Tracker Integration Schema
-- ============================================================================
-- Adds tables for caching Samsara AT11 passive tracker data
-- ============================================================================

-- Drop existing tables if re-running
DROP TABLE IF EXISTS samsara_location_history CASCADE;
DROP TABLE IF EXISTS samsara_trackers CASCADE;

-- ============================================================================
-- TABLE: samsara_trackers
-- ============================================================================
-- Stores AT11 passive tracker metadata from Samsara
CREATE TABLE samsara_trackers (
    id TEXT PRIMARY KEY,                    -- Samsara asset ID
    name TEXT NOT NULL,                      -- Tracker name (e.g., "Condensate Tank-JP3")
    type TEXT DEFAULT 'unpowered',           -- Asset type
    share_link TEXT,                         -- Samsara web viewer link

    -- Metadata
    created_at_samsara TIMESTAMPTZ,          -- When created in Samsara
    updated_at_samsara TIMESTAMPTZ,          -- Last updated in Samsara

    -- Latest location (cached for quick access)
    last_latitude NUMERIC(10, 7),
    last_longitude NUMERIC(10, 7),
    last_accuracy_meters NUMERIC(10, 2),
    last_seen_at TIMESTAMPTZ,

    -- Status flags
    is_on_site BOOLEAN DEFAULT FALSE,        -- Within site geofence
    distance_from_site_km NUMERIC(10, 2),    -- Distance from Greenfield LNG Terminal site

    -- Optional linking to material_links table
    linked_material_id BIGINT REFERENCES material_links(id) ON DELETE SET NULL,

    -- Sync metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABLE: samsara_location_history
-- ============================================================================
-- Stores historical location data for trackers
CREATE TABLE samsara_location_history (
    id BIGSERIAL PRIMARY KEY,
    tracker_id TEXT NOT NULL REFERENCES samsara_trackers(id) ON DELETE CASCADE,

    -- Location data
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    accuracy_meters NUMERIC(10, 2),
    heading_degrees INTEGER,

    -- Timing
    happened_at TIMESTAMPTZ NOT NULL,        -- When location was recorded
    received_at TIMESTAMPTZ DEFAULT NOW(),   -- When we fetched it

    -- Calculated fields
    is_on_site BOOLEAN DEFAULT FALSE,
    distance_from_site_km NUMERIC(10, 2),

    -- Indexes for performance
    UNIQUE(tracker_id, happened_at)
);

-- ============================================================================
-- INDEXES (Samsara)
-- ============================================================================
CREATE INDEX idx_samsara_trackers_name ON samsara_trackers(name);
CREATE INDEX idx_samsara_trackers_on_site ON samsara_trackers(is_on_site);
CREATE INDEX idx_samsara_trackers_linked_material ON samsara_trackers(linked_material_id);
CREATE INDEX idx_samsara_trackers_last_seen ON samsara_trackers(last_seen_at DESC);

CREATE INDEX idx_samsara_location_tracker ON samsara_location_history(tracker_id);
CREATE INDEX idx_samsara_location_time ON samsara_location_history(happened_at DESC);
CREATE INDEX idx_samsara_location_on_site ON samsara_location_history(is_on_site);

-- ============================================================================
-- TRIGGER: Update timestamp (Samsara)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_samsara_trackers_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_samsara_trackers_timestamp
    BEFORE UPDATE ON samsara_trackers
    FOR EACH ROW
    EXECUTE FUNCTION update_samsara_trackers_timestamp();

-- ============================================================================
-- FUNCTION: Calculate distance from site
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_distance_from_site(
    tracker_lat NUMERIC,
    tracker_lon NUMERIC,
    site_lat NUMERIC DEFAULT 28.954,  -- Greenfield LNG Terminal site, Freeport TX area
    site_lon NUMERIC DEFAULT -95.359
)
RETURNS NUMERIC AS $$
DECLARE
    earth_radius_km NUMERIC := 6371;
    dlat NUMERIC;
    dlon NUMERIC;
    a NUMERIC;
    c NUMERIC;
BEGIN
    -- Haversine formula
    dlat := radians(site_lat - tracker_lat);
    dlon := radians(site_lon - tracker_lon);

    a := sin(dlat/2) * sin(dlat/2) +
         cos(radians(tracker_lat)) * cos(radians(site_lat)) *
         sin(dlon/2) * sin(dlon/2);

    c := 2 * atan2(sqrt(a), sqrt(1-a));

    RETURN earth_radius_km * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- FUNCTION: Check if location is on site
-- ============================================================================
CREATE OR REPLACE FUNCTION is_location_on_site(
    tracker_lat NUMERIC,
    tracker_lon NUMERIC,
    radius_km NUMERIC DEFAULT 0.5  -- 500m radius geofence
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN calculate_distance_from_site(tracker_lat, tracker_lon) <= radius_km;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- VIEW: Active trackers with latest locations
-- ============================================================================
CREATE OR REPLACE VIEW vw_active_samsara_trackers AS
SELECT
    t.id,
    t.name,
    t.share_link,
    t.last_latitude,
    t.last_longitude,
    t.last_accuracy_meters,
    t.last_seen_at,
    t.is_on_site,
    t.distance_from_site_km,
    t.linked_material_id,

    -- Material link info (if linked)
    ml.po_id,
    ml.install_tag,
    ml.material_status,

    -- Status classification
    CASE
        WHEN t.last_seen_at IS NULL THEN 'No Data'
        WHEN t.last_seen_at < NOW() - INTERVAL '7 days' THEN 'Stale'
        WHEN t.is_on_site THEN 'On Site'
        ELSE 'In Transit'
    END as status,

    -- Time since last seen
    EXTRACT(EPOCH FROM (NOW() - t.last_seen_at)) / 3600 as hours_since_last_seen,

    t.synced_at,
    t.updated_at
FROM
    samsara_trackers t
LEFT JOIN
    material_links ml ON t.linked_material_id = ml.id
ORDER BY
    t.last_seen_at DESC NULLS LAST;

-- ============================================================================
-- VIEW: Tracker statistics
-- ============================================================================
CREATE OR REPLACE VIEW vw_samsara_tracker_stats AS
SELECT
    COUNT(*) as total_trackers,
    COUNT(CASE WHEN last_seen_at > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
    COUNT(CASE WHEN last_seen_at > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d,
    COUNT(CASE WHEN is_on_site = TRUE THEN 1 END) as on_site,
    COUNT(CASE WHEN is_on_site = FALSE AND last_seen_at IS NOT NULL THEN 1 END) as in_transit,
    COUNT(CASE WHEN linked_material_id IS NOT NULL THEN 1 END) as linked_to_materials,
    MAX(last_seen_at) as most_recent_update,
    MAX(synced_at) as last_sync
FROM
    samsara_trackers;

-- ============================================================================
-- SAMPLE DATA (for testing - remove in production)
-- ============================================================================
-- Uncomment to insert sample data
/*
INSERT INTO samsara_trackers (id, name, share_link, last_latitude, last_longitude, last_accuracy_meters, last_seen_at)
VALUES
    ('281474999387855', 'Condensate Tank-JP3', 'https://cloud.samsara.com/o/4009326/fleet/viewer/O56YIL5WToGLv2mRuiZ5', 29.832962, -95.138394, 191.72, NOW() - INTERVAL '2 hours'),
    ('281474999387856', 'Heat Exchanger-HX2', 'https://cloud.samsara.com/o/4009326/fleet/viewer/ABC123XYZ', 35.2821, -101.8313, 25.0, NOW() - INTERVAL '30 minutes');
*/

-- ============================================================================
-- PERMISSIONS (if using Row Level Security)
-- ============================================================================
-- Enable RLS if needed
-- ALTER TABLE samsara_trackers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE samsara_location_history ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (adjust as needed)
-- CREATE POLICY "Allow public read access to trackers" ON samsara_trackers FOR SELECT USING (true);
-- CREATE POLICY "Allow public read access to location history" ON samsara_location_history FOR SELECT USING (true);

-- ============================================================================
-- Part 3 Complete
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '--- Part 3 Complete: samsara_trackers, samsara_location_history ---';
END $$;


-- ############################################################################
-- PART 4: Delivery Dates Schema
-- ############################################################################

-- ============================================================================
-- Delivery Dates Schema for MSR Dashboard
-- ============================================================================
-- Stores expected delivery dates for installation items
-- ============================================================================

-- Drop existing tables if re-running
DROP TABLE IF EXISTS delivery_dates CASCADE;
DROP TABLE IF EXISTS ready_by_dates CASCADE;  -- Drop old table name

-- ============================================================================
-- TABLE: delivery_dates
-- ============================================================================
-- Stores delivery date information from "ReadyByDates.xlsx"
CREATE TABLE delivery_dates (
    id BIGSERIAL PRIMARY KEY,

    -- Project & Package Info
    project_phase TEXT,
    package_description TEXT,
    tag_number TEXT,

    -- Supplier & PO
    supplier_name TEXT,
    po_number TEXT,

    -- Delivery Date
    delivery_date DATE,
    delivery_date_notes TEXT,  -- For date ranges like "1/20/2026 - 2/14/2026"

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES (Delivery Dates)
-- ============================================================================
CREATE INDEX idx_delivery_po_number ON delivery_dates(po_number);
CREATE INDEX idx_delivery_tag_number ON delivery_dates(tag_number);
CREATE INDEX idx_delivery_supplier ON delivery_dates(supplier_name);
CREATE INDEX idx_delivery_date ON delivery_dates(delivery_date);

-- ============================================================================
-- TRIGGER: Update timestamp (Delivery Dates)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_delivery_dates_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_delivery_dates_timestamp
    BEFORE UPDATE ON delivery_dates
    FOR EACH ROW
    EXECUTE FUNCTION update_delivery_dates_timestamp();

-- ============================================================================
-- VIEW: Delivery dates with PO information
-- ============================================================================
CREATE OR REPLACE VIEW vw_delivery_dates_with_po AS
SELECT
    d.*,
    p.purchase_order_id,
    p.po_description,
    p.supplier as po_supplier,
    p.status as po_status,
    p.delivery_date_from as po_delivery_date
FROM delivery_dates d
LEFT JOIN purchase_orders p ON d.po_number = p.purchase_order_id;

-- ============================================================================
-- VIEW: Upcoming delivery dates (next 30 days)
-- ============================================================================
CREATE OR REPLACE VIEW vw_upcoming_delivery_dates AS
SELECT
    *
FROM delivery_dates
WHERE delivery_date >= CURRENT_DATE
  AND delivery_date <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY delivery_date ASC;

-- ============================================================================
-- Part 4 Complete
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '--- Part 4 Complete: delivery_dates ---';
END $$;


-- ############################################################################
-- PART 5: Project Schedule Schema
-- ############################################################################

-- ============================================================================
-- Project Schedule Schema for MSR Dashboard
-- ============================================================================
-- Stores project schedule activities and milestones
-- ============================================================================

-- Drop existing table if re-running
DROP TABLE IF EXISTS project_schedule CASCADE;

-- ============================================================================
-- TABLE: project_schedule
-- ============================================================================
-- Stores schedule activities from P0203-PM-120-SCH-0002.xlsx
CREATE TABLE project_schedule (
    id BIGSERIAL PRIMARY KEY,

    -- Activity Identification
    activity_id TEXT,
    activity_name TEXT,

    -- Duration & Dates
    remaining_duration INTEGER,  -- Days
    start_date DATE,
    finish_date DATE,

    -- Categorization
    is_milestone BOOLEAN DEFAULT FALSE,  -- True if duration = 0
    activity_type TEXT,  -- e.g., Design, Procurement, Installation, Testing
    category TEXT,  -- Derived from activity name patterns

    -- Status
    status TEXT,  -- Not Started, In Progress, Complete
    percent_complete INTEGER DEFAULT 0,

    -- Criticality
    is_critical BOOLEAN DEFAULT FALSE,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES (Project Schedule)
-- ============================================================================
CREATE INDEX idx_schedule_activity_id ON project_schedule(activity_id);
CREATE INDEX idx_schedule_activity_name ON project_schedule(activity_name);
CREATE INDEX idx_schedule_start_date ON project_schedule(start_date);
CREATE INDEX idx_schedule_finish_date ON project_schedule(finish_date);
CREATE INDEX idx_schedule_is_milestone ON project_schedule(is_milestone);
CREATE INDEX idx_schedule_activity_type ON project_schedule(activity_type);
CREATE INDEX idx_schedule_status ON project_schedule(status);

-- ============================================================================
-- TRIGGER: Update timestamp (Project Schedule)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_project_schedule_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_project_schedule_timestamp
    BEFORE UPDATE ON project_schedule
    FOR EACH ROW
    EXECUTE FUNCTION update_project_schedule_timestamp();

-- ============================================================================
-- VIEW: Milestones only
-- ============================================================================
CREATE OR REPLACE VIEW vw_milestones AS
SELECT
    *
FROM project_schedule
WHERE is_milestone = TRUE
ORDER BY start_date ASC NULLS LAST, finish_date ASC NULLS LAST;

-- ============================================================================
-- VIEW: Upcoming activities (next 30 days)
-- ============================================================================
CREATE OR REPLACE VIEW vw_upcoming_activities AS
SELECT
    *
FROM project_schedule
WHERE
    (start_date >= CURRENT_DATE AND start_date <= CURRENT_DATE + INTERVAL '30 days')
    OR (finish_date >= CURRENT_DATE AND finish_date <= CURRENT_DATE + INTERVAL '30 days')
ORDER BY
    COALESCE(start_date, finish_date) ASC;

-- ============================================================================
-- VIEW: Critical path activities
-- ============================================================================
CREATE OR REPLACE VIEW vw_critical_activities AS
SELECT
    *
FROM project_schedule
WHERE is_critical = TRUE
ORDER BY start_date ASC NULLS LAST;

-- ============================================================================
-- VIEW: Activities by type
-- ============================================================================
CREATE OR REPLACE VIEW vw_activities_by_type AS
SELECT
    activity_type,
    COUNT(*) as activity_count,
    COUNT(*) FILTER (WHERE is_milestone = TRUE) as milestone_count,
    COUNT(*) FILTER (WHERE is_milestone = FALSE) as work_activity_count,
    AVG(remaining_duration) FILTER (WHERE is_milestone = FALSE) as avg_duration
FROM project_schedule
WHERE activity_type IS NOT NULL
GROUP BY activity_type
ORDER BY activity_count DESC;

-- ============================================================================
-- Part 5 Complete
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '--- Part 5 Complete: project_schedule ---';
END $$;


-- ############################################################################
-- SETUP COMPLETE
-- ############################################################################
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '============================================================';
    RAISE NOTICE ' Combined Schema Setup Complete - Greenfield LNG Terminal';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  1. purchase_orders';
    RAISE NOTICE '  2. shipments';
    RAISE NOTICE '  3. dashboard_metrics';
    RAISE NOTICE '  4. material_links';
    RAISE NOTICE '  5. material_status_history';
    RAISE NOTICE '  6. samsara_trackers';
    RAISE NOTICE '  7. samsara_location_history';
    RAISE NOTICE '  8. delivery_dates';
    RAISE NOTICE '  9. project_schedule';
    RAISE NOTICE '';
    RAISE NOTICE 'Views created:';
    RAISE NOTICE '  - vw_po_summary';
    RAISE NOTICE '  - vw_shipment_summary';
    RAISE NOTICE '  - vw_recent_activity';
    RAISE NOTICE '  - vw_material_links_detailed';
    RAISE NOTICE '  - vw_stats_by_discipline';
    RAISE NOTICE '  - vw_stats_by_status';
    RAISE NOTICE '  - vw_active_samsara_trackers';
    RAISE NOTICE '  - vw_samsara_tracker_stats';
    RAISE NOTICE '  - vw_delivery_dates_with_po';
    RAISE NOTICE '  - vw_upcoming_delivery_dates';
    RAISE NOTICE '  - vw_milestones';
    RAISE NOTICE '  - vw_upcoming_activities';
    RAISE NOTICE '  - vw_critical_activities';
    RAISE NOTICE '  - vw_activities_by_type';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions created:';
    RAISE NOTICE '  - calculate_dashboard_metrics()';
    RAISE NOTICE '  - refresh_dashboard_metrics()';
    RAISE NOTICE '  - get_material_statistics()';
    RAISE NOTICE '  - search_material_links(query)';
    RAISE NOTICE '  - calculate_distance_from_site(lat, lon)';
    RAISE NOTICE '  - is_location_on_site(lat, lon, radius)';
    RAISE NOTICE '';
    RAISE NOTICE '============================================================';
END $$;

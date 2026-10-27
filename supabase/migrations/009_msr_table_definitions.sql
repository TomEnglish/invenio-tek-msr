-- ============================================================================
-- 011: MSR-owned table definitions (codification, no behavior change)
-- ============================================================================
-- These 12 tables exist in production but were never in this migration chain —
-- they were applied manually via the sibling MSR repo's loose supabase/*.sql
-- files (po_shipment_schema.sql, schema.sql, samsara_schema.sql,
-- delivery_dates_schema.sql, project_schedule_schema.sql, inventory_schema.sql,
-- consolidated as setup_schema.sql). This migration brings them into the
-- migration history so a fresh deploy can recreate the full database from
-- migrations alone.
--
-- Tables codified here:
--    1. purchase_orders
--    2. shipments
--    3. dashboard_metrics
--    4. material_links
--    5. material_status_history
--    6. samsara_trackers
--    7. samsara_location_history
--    8. delivery_dates
--    9. project_schedule
--   10. inventory_records
--   11. shop_contacts          (intentionally unscoped — vendor reference data)
--   12. outside_shop_inventory
--
-- Operations are idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX
-- IF NOT EXISTS, CREATE OR REPLACE for views/functions/triggers). Running
-- this against the live database is a no-op for the 9 tables that already
-- have project_id; the 3 inventory_* tables (which currently lack project_id
-- entirely) gain it via ALTER TABLE ADD COLUMN IF NOT EXISTS, with a NOT NULL
-- constraint applied after backfill (safe — all three are empty in prod).
--
-- RLS policies are NOT in this migration. The MSR-owned tables currently use
-- "any authenticated user" policies (or no RLS at all). Tightening them to
-- Field's project-scoped pattern is a behavioral change that risks locking
-- users out if the user_projects mapping has gaps. That work is deferred
-- to 012, after a user_projects audit.
--
-- Field's migration 010 already created vw_po_summary and vw_shipment_summary.
-- This migration does not redefine them.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. purchase_orders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id BIGSERIAL PRIMARY KEY,

    -- PO Identification
    purchase_order_id TEXT,
    po_description TEXT,
    purchase_order_item TEXT,
    item_uuid TEXT,

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
    product_alt TEXT,
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Multi-project scoping (added in 010 against existing tables)
    project_id uuid NOT NULL REFERENCES public.projects(id)
);

CREATE INDEX IF NOT EXISTS idx_po_purchase_order_id ON public.purchase_orders(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_item_status ON public.purchase_orders(item_status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON public.purchase_orders(supplier);
CREATE INDEX IF NOT EXISTS idx_po_category ON public.purchase_orders(category);
CREATE INDEX IF NOT EXISTS idx_po_delivery_date ON public.purchase_orders(delivery_date_from);


-- ----------------------------------------------------------------------------
-- 2. shipments
-- Shape: setup_schema.sql base columns + 5 columns added by inventory_schema.sql
-- (mode, ship_type, origin, destination, cargo_description) + project_id (010)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipments (
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
    shipment_by TEXT,

    -- Quality & Documentation
    ncr_osd BOOLEAN,
    receiving_pics TEXT,
    detailed_packing_list TEXT,

    -- Notes
    progress_notes TEXT,
    special_receiving_instructions TEXT,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Multi-project scoping
    project_id uuid NOT NULL REFERENCES public.projects(id),

    -- Logistics dashboard fields (added by inventory_schema.sql)
    mode TEXT,
    ship_type TEXT,
    origin TEXT,
    destination TEXT,
    cargo_description TEXT
);

CREATE INDEX IF NOT EXISTS idx_shipment_number ON public.shipments(shipment_number);
CREATE INDEX IF NOT EXISTS idx_shipment_po_number ON public.shipments(po_number);
CREATE INDEX IF NOT EXISTS idx_shipment_status ON public.shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipment_supplier ON public.shipments(supplier);
CREATE INDEX IF NOT EXISTS idx_shipment_category ON public.shipments(category);
CREATE INDEX IF NOT EXISTS idx_shipment_eta ON public.shipments(eta);
CREATE INDEX IF NOT EXISTS idx_shipment_delivery_date ON public.shipments(delivery_date);


-- ----------------------------------------------------------------------------
-- 3. dashboard_metrics
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dashboard_metrics (
    id SERIAL PRIMARY KEY,
    project_name TEXT DEFAULT 'Greenfield LNG Terminal',
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    procurement JSONB,
    installation JSONB,
    status_counts JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    project_id uuid NOT NULL REFERENCES public.projects(id)
);


-- ----------------------------------------------------------------------------
-- 4. material_links
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_links (
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

    -- Receipt / Installation
    receipt_date DATE,
    receipt_location TEXT,
    installation_date DATE,

    -- Quantity
    quantity NUMERIC(10, 2),
    uom TEXT,

    -- Additional
    notes TEXT,
    linked_by TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Multi-project scoping
    project_id uuid NOT NULL REFERENCES public.projects(id),

    CONSTRAINT material_links_po_id_check CHECK (po_id != '')
);

CREATE INDEX IF NOT EXISTS idx_material_links_po_id ON public.material_links(po_id);
CREATE INDEX IF NOT EXISTS idx_material_links_install_tag ON public.material_links(install_tag);
CREATE INDEX IF NOT EXISTS idx_material_links_status ON public.material_links(material_status);
CREATE INDEX IF NOT EXISTS idx_material_links_discipline ON public.material_links(install_discipline);
CREATE INDEX IF NOT EXISTS idx_material_links_created_at ON public.material_links(created_at DESC);


-- ----------------------------------------------------------------------------
-- 5. material_status_history
-- project_id intentionally nullable here — matches 010, audit row inherits
-- scope through link_id -> material_links.project_id.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_status_history (
    id BIGSERIAL PRIMARY KEY,
    link_id BIGINT NOT NULL REFERENCES public.material_links(id) ON DELETE CASCADE,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by TEXT,
    change_notes TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    project_id uuid REFERENCES public.projects(id)
);

CREATE INDEX IF NOT EXISTS idx_status_history_link_id ON public.material_status_history(link_id);
CREATE INDEX IF NOT EXISTS idx_status_history_changed_at ON public.material_status_history(changed_at DESC);


-- ----------------------------------------------------------------------------
-- 6. samsara_trackers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.samsara_trackers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'unpowered',
    share_link TEXT,

    -- Samsara metadata
    created_at_samsara TIMESTAMPTZ,
    updated_at_samsara TIMESTAMPTZ,

    -- Cached latest location
    last_latitude NUMERIC(10, 7),
    last_longitude NUMERIC(10, 7),
    last_accuracy_meters NUMERIC(10, 2),
    last_seen_at TIMESTAMPTZ,

    -- Geofence status
    is_on_site BOOLEAN DEFAULT FALSE,
    distance_from_site_km NUMERIC(10, 2),

    -- Optional link to a material
    linked_material_id BIGINT REFERENCES public.material_links(id) ON DELETE SET NULL,

    -- Sync / audit timestamps
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Multi-project scoping
    project_id uuid NOT NULL REFERENCES public.projects(id)
);

CREATE INDEX IF NOT EXISTS idx_samsara_trackers_name ON public.samsara_trackers(name);
CREATE INDEX IF NOT EXISTS idx_samsara_trackers_on_site ON public.samsara_trackers(is_on_site);
CREATE INDEX IF NOT EXISTS idx_samsara_trackers_linked_material ON public.samsara_trackers(linked_material_id);
CREATE INDEX IF NOT EXISTS idx_samsara_trackers_last_seen ON public.samsara_trackers(last_seen_at DESC);


-- ----------------------------------------------------------------------------
-- 7. samsara_location_history
-- project_id intentionally nullable (matches 010).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.samsara_location_history (
    id BIGSERIAL PRIMARY KEY,
    tracker_id TEXT NOT NULL REFERENCES public.samsara_trackers(id) ON DELETE CASCADE,
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    accuracy_meters NUMERIC(10, 2),
    heading_degrees INTEGER,
    happened_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    is_on_site BOOLEAN DEFAULT FALSE,
    distance_from_site_km NUMERIC(10, 2),
    project_id uuid REFERENCES public.projects(id),
    UNIQUE(tracker_id, happened_at)
);

CREATE INDEX IF NOT EXISTS idx_samsara_location_tracker ON public.samsara_location_history(tracker_id);
CREATE INDEX IF NOT EXISTS idx_samsara_location_time ON public.samsara_location_history(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_samsara_location_on_site ON public.samsara_location_history(is_on_site);


-- ----------------------------------------------------------------------------
-- 8. delivery_dates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_dates (
    id BIGSERIAL PRIMARY KEY,
    project_phase TEXT,
    package_description TEXT,
    tag_number TEXT,
    supplier_name TEXT,
    po_number TEXT,
    delivery_date DATE,
    delivery_date_notes TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    project_id uuid NOT NULL REFERENCES public.projects(id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_po_number ON public.delivery_dates(po_number);
CREATE INDEX IF NOT EXISTS idx_delivery_tag_number ON public.delivery_dates(tag_number);
CREATE INDEX IF NOT EXISTS idx_delivery_supplier ON public.delivery_dates(supplier_name);
CREATE INDEX IF NOT EXISTS idx_delivery_date ON public.delivery_dates(delivery_date);


-- ----------------------------------------------------------------------------
-- 9. project_schedule
-- Seed data for this table lives in the MSR repo's
-- supabase/seed_project_schedule.sql (118-row baseline, run once on fresh DB).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_schedule (
    id BIGSERIAL PRIMARY KEY,
    activity_id TEXT,
    activity_name TEXT,
    remaining_duration INTEGER,
    start_date DATE,
    finish_date DATE,
    is_milestone BOOLEAN DEFAULT FALSE,
    activity_type TEXT,
    category TEXT,
    status TEXT,
    percent_complete INTEGER DEFAULT 0,
    is_critical BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    project_id uuid NOT NULL REFERENCES public.projects(id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_activity_id ON public.project_schedule(activity_id);
CREATE INDEX IF NOT EXISTS idx_schedule_activity_name ON public.project_schedule(activity_name);
CREATE INDEX IF NOT EXISTS idx_schedule_start_date ON public.project_schedule(start_date);
CREATE INDEX IF NOT EXISTS idx_schedule_finish_date ON public.project_schedule(finish_date);
CREATE INDEX IF NOT EXISTS idx_schedule_is_milestone ON public.project_schedule(is_milestone);
CREATE INDEX IF NOT EXISTS idx_schedule_activity_type ON public.project_schedule(activity_type);
CREATE INDEX IF NOT EXISTS idx_schedule_status ON public.project_schedule(status);


-- ----------------------------------------------------------------------------
-- 10. inventory_records
-- Currently lacks project_id in the live DB — added here as the gap fix.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_records (
    id              BIGSERIAL PRIMARY KEY,
    qr_code         TEXT NOT NULL,
    inventory_item  TEXT NOT NULL,
    item_description TEXT,
    unit            TEXT,
    subsystem       TEXT,
    location        TEXT,
    status          TEXT DEFAULT 'In Storage',
    scan_uid        TEXT,
    scanner_comments TEXT,
    last_scanned_at TIMESTAMPTZ,
    last_scanned_by TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    project_id      uuid NOT NULL REFERENCES public.projects(id)
);

-- Patch path: existing live table lacks project_id. Add it nullable, backfill,
-- then enforce NOT NULL. Safe — table is empty in production.
ALTER TABLE public.inventory_records ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
UPDATE public.inventory_records SET project_id = '00000000-0000-0000-0000-000000000000' WHERE project_id IS NULL;
ALTER TABLE public.inventory_records ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_records_qr ON public.inventory_records(qr_code);
CREATE INDEX IF NOT EXISTS idx_inv_records_unit ON public.inventory_records(unit);
CREATE INDEX IF NOT EXISTS idx_inv_records_subsystem ON public.inventory_records(subsystem);
CREATE INDEX IF NOT EXISTS idx_inv_records_status ON public.inventory_records(status);


-- ----------------------------------------------------------------------------
-- 11. shop_contacts
-- Intentionally unscoped — vendor reference data shared across projects.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_contacts (
    id              BIGSERIAL PRIMARY KEY,
    shop_name       TEXT NOT NULL UNIQUE,
    address         TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    contact_name    TEXT,
    contact_phone   TEXT,
    contact_email   TEXT,
    secondary_contact_name  TEXT,
    secondary_contact_phone TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- 12. outside_shop_inventory
-- Currently lacks project_id in the live DB — added here as the gap fix.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outside_shop_inventory (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT REFERENCES public.shop_contacts(id) ON DELETE SET NULL,
    load_name       TEXT,
    qr_id           TEXT,
    scanner_comments TEXT,
    delivery_date   DATE,
    ship_date       DATE,
    item_status     TEXT DEFAULT 'At Shop',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    project_id      uuid NOT NULL REFERENCES public.projects(id)
);

-- Patch path: existing live table lacks project_id. Same dance as inventory_records.
ALTER TABLE public.outside_shop_inventory ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
UPDATE public.outside_shop_inventory SET project_id = '00000000-0000-0000-0000-000000000000' WHERE project_id IS NULL;
ALTER TABLE public.outside_shop_inventory ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_osi_shop ON public.outside_shop_inventory(shop_id);
CREATE INDEX IF NOT EXISTS idx_osi_load ON public.outside_shop_inventory(load_name);
CREATE INDEX IF NOT EXISTS idx_osi_qr ON public.outside_shop_inventory(qr_id);
CREATE INDEX IF NOT EXISTS idx_osi_status ON public.outside_shop_inventory(item_status);


-- ============================================================================
-- TRIGGERS: updated_at maintenance
--
-- MSR's setup_schema.sql defined six near-identical per-table timestamp
-- functions (update_po_timestamp, update_shipment_timestamp,
-- update_metrics_timestamp, update_samsara_trackers_timestamp,
-- update_delivery_dates_timestamp, update_project_schedule_timestamp). This
-- migration consolidates them onto the single update_updated_at_column()
-- function (already used by material_links). The old per-table functions are
-- explicitly dropped below so they don't linger as orphans in pg_proc.
--
-- track_status_change() (the legacy material_links audit trigger fn) is
-- replaced by track_material_status_change() below, which also writes
-- project_id into the audit row. The legacy name is dropped here.
-- ============================================================================

DROP FUNCTION IF EXISTS public.update_po_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.update_shipment_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.update_metrics_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.update_samsara_trackers_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.update_delivery_dates_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.update_project_schedule_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.track_status_change() CASCADE;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_po_timestamp ON public.purchase_orders;
CREATE TRIGGER trigger_update_po_timestamp
    BEFORE UPDATE ON public.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_shipment_timestamp ON public.shipments;
CREATE TRIGGER trigger_update_shipment_timestamp
    BEFORE UPDATE ON public.shipments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_metrics_timestamp ON public.dashboard_metrics;
CREATE TRIGGER trigger_update_metrics_timestamp
    BEFORE UPDATE ON public.dashboard_metrics
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_material_links_updated_at ON public.material_links;
CREATE TRIGGER update_material_links_updated_at
    BEFORE UPDATE ON public.material_links
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_samsara_trackers_timestamp ON public.samsara_trackers;
CREATE TRIGGER trigger_update_samsara_trackers_timestamp
    BEFORE UPDATE ON public.samsara_trackers
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_delivery_dates_timestamp ON public.delivery_dates;
CREATE TRIGGER trigger_update_delivery_dates_timestamp
    BEFORE UPDATE ON public.delivery_dates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_project_schedule_timestamp ON public.project_schedule;
CREATE TRIGGER trigger_update_project_schedule_timestamp
    BEFORE UPDATE ON public.project_schedule
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================================
-- TRIGGER: log material_status_history when material_links.material_status changes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.track_material_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.material_status IS DISTINCT FROM NEW.material_status) THEN
        INSERT INTO public.material_status_history (
            link_id, old_status, new_status, changed_by, project_id
        ) VALUES (
            NEW.id, OLD.material_status, NEW.material_status, NEW.linked_by, NEW.project_id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS track_material_status_changes ON public.material_links;
CREATE TRIGGER track_material_status_changes
    AFTER UPDATE ON public.material_links
    FOR EACH ROW EXECUTE FUNCTION public.track_material_status_change();


-- ============================================================================
-- FUNCTIONS: Samsara geofence helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.calculate_distance_from_site(
    tracker_lat NUMERIC,
    tracker_lon NUMERIC,
    site_lat NUMERIC DEFAULT 28.954,
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
    dlat := radians(site_lat - tracker_lat);
    dlon := radians(site_lon - tracker_lon);
    a := sin(dlat/2) * sin(dlat/2) +
         cos(radians(tracker_lat)) * cos(radians(site_lat)) *
         sin(dlon/2) * sin(dlon/2);
    c := 2 * atan2(sqrt(a), sqrt(1-a));
    RETURN earth_radius_km * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.is_location_on_site(
    tracker_lat NUMERIC,
    tracker_lon NUMERIC,
    radius_km NUMERIC DEFAULT 0.5
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN public.calculate_distance_from_site(tracker_lat, tracker_lon) <= radius_km;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================================
-- FUNCTIONS: Dashboard metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION public.calculate_dashboard_metrics()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    procurement_data JSONB;
    status_counts_data JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_pos', COUNT(DISTINCT purchase_order_id),
        'total_po_value', COALESCE(SUM(net_value), 0),
        'total_shipments', (SELECT COUNT(*) FROM public.shipments),
        'delivered_shipments', (SELECT COUNT(*) FROM public.shipments WHERE status = 'Delivered'),
        'in_transit_shipments', (SELECT COUNT(*) FROM public.shipments WHERE status IN ('In Transit', 'RTS')),
        'not_ready_shipments', (SELECT COUNT(*) FROM public.shipments WHERE status = 'Not RTS')
    )
    INTO procurement_data
    FROM public.purchase_orders;

    SELECT jsonb_build_object(
        'po_status', (
            SELECT jsonb_object_agg(status, count)
            FROM (
                SELECT status, COUNT(*) as count
                FROM public.purchase_orders
                WHERE status IS NOT NULL
                GROUP BY status
            ) po_counts
        ),
        'shipment_status', (
            SELECT jsonb_object_agg(status, count)
            FROM (
                SELECT status, COUNT(*) as count
                FROM public.shipments
                WHERE status IS NOT NULL
                GROUP BY status
            ) ship_counts
        )
    )
    INTO status_counts_data;

    result := jsonb_build_object(
        'procurement', procurement_data,
        'status_counts', status_counts_data,
        'last_updated', NOW()
    );
    RETURN result;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- FUNCTIONS: Material tracking helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_material_statistics()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_links', (SELECT COUNT(*) FROM public.material_links),
        'status_breakdown', (
            SELECT json_object_agg(material_status, count_by_status)
            FROM (
                SELECT material_status, COUNT(*) as count_by_status
                FROM public.material_links
                GROUP BY material_status
            ) s
        ),
        'discipline_breakdown', (
            SELECT json_object_agg(install_discipline, count_by_discipline)
            FROM (
                SELECT install_discipline, COUNT(*) as count_by_discipline
                FROM public.material_links
                WHERE install_discipline IS NOT NULL
                GROUP BY install_discipline
            ) d
        )
    ) INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- VIEWS
-- vw_po_summary and vw_shipment_summary are owned by 010 — not redefined here.
--
-- Most of the views below add `project_id` to the SELECT list (vs. the original
-- MSR definitions). PostgreSQL's CREATE OR REPLACE VIEW only allows appending
-- columns at the end, so we DROP IF EXISTS first to avoid "cannot change name
-- of view column" errors when the live view was created without project_id.
--
-- KNOWN BEHAVIORAL CHANGE: vw_samsara_tracker_stats and vw_stats_by_status /
-- vw_stats_by_discipline / vw_activities_by_type now GROUP BY project_id, so
-- they return one row per project rather than a single global aggregate. This
-- matches the multi-tenant scoping pattern (project-scope.js filters these
-- views by active project_id, so the dashboard sees per-project stats — the
-- desired behavior). The MSR sync_samsara_data.py admin script reads
-- result[0] expecting a single global row; that script needs a follow-up
-- update if it gets re-run after this migration. No production impact today
-- since the script is manual and rarely run.
-- ============================================================================

DROP VIEW IF EXISTS public.vw_recent_activity;
CREATE VIEW public.vw_recent_activity AS
SELECT
    'PO' as type,
    purchase_order_id as identifier,
    po_description as description,
    status,
    item_last_change_date_time as last_changed,
    synced_at,
    project_id
FROM public.purchase_orders
WHERE item_last_change_date_time IS NOT NULL
UNION ALL
SELECT
    'Shipment' as type,
    shipment_number as identifier,
    part_description as description,
    status,
    COALESCE(delivery_date, eta, rts_date)::timestamptz as last_changed,
    synced_at,
    project_id
FROM public.shipments
ORDER BY last_changed DESC NULLS LAST
LIMIT 100;

DROP VIEW IF EXISTS public.vw_material_links_detailed;
CREATE VIEW public.vw_material_links_detailed AS
SELECT
    ml.*,
    (SELECT COUNT(*) FROM public.material_status_history WHERE link_id = ml.id) as status_change_count,
    EXTRACT(DAY FROM (NOW() - ml.created_at))::INTEGER as days_since_created,
    EXTRACT(DAY FROM (NOW() - ml.updated_at))::INTEGER as days_since_updated
FROM public.material_links ml
ORDER BY ml.created_at DESC;

DROP VIEW IF EXISTS public.vw_stats_by_discipline;
CREATE VIEW public.vw_stats_by_discipline AS
SELECT
    install_discipline,
    project_id,
    COUNT(*) as total_links,
    COUNT(*) FILTER (WHERE material_status = 'ordered') as ordered_count,
    COUNT(*) FILTER (WHERE material_status = 'shipped') as shipped_count,
    COUNT(*) FILTER (WHERE material_status = 'received') as received_count,
    COUNT(*) FILTER (WHERE material_status = 'installed') as installed_count,
    ROUND(AVG(quantity), 2) as avg_quantity
FROM public.material_links
GROUP BY install_discipline, project_id;

DROP VIEW IF EXISTS public.vw_stats_by_status;
CREATE VIEW public.vw_stats_by_status AS
SELECT
    material_status,
    project_id,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY project_id), 2) as percentage
FROM public.material_links
GROUP BY material_status, project_id
ORDER BY
    CASE material_status
        WHEN 'ordered' THEN 1
        WHEN 'shipped' THEN 2
        WHEN 'received' THEN 3
        WHEN 'installed' THEN 4
    END;

DROP VIEW IF EXISTS public.vw_active_samsara_trackers;
CREATE VIEW public.vw_active_samsara_trackers AS
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
    t.project_id,
    ml.po_id,
    ml.install_tag,
    ml.material_status,
    CASE
        WHEN t.last_seen_at IS NULL THEN 'No Data'
        WHEN t.last_seen_at < NOW() - INTERVAL '7 days' THEN 'Stale'
        WHEN t.is_on_site THEN 'On Site'
        ELSE 'In Transit'
    END as status,
    EXTRACT(EPOCH FROM (NOW() - t.last_seen_at)) / 3600 as hours_since_last_seen,
    t.synced_at,
    t.updated_at
FROM public.samsara_trackers t
LEFT JOIN public.material_links ml ON t.linked_material_id = ml.id
ORDER BY t.last_seen_at DESC NULLS LAST;

DROP VIEW IF EXISTS public.vw_samsara_tracker_stats;
CREATE VIEW public.vw_samsara_tracker_stats AS
SELECT
    project_id,
    COUNT(*) as total_trackers,
    COUNT(CASE WHEN last_seen_at > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
    COUNT(CASE WHEN last_seen_at > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d,
    COUNT(CASE WHEN is_on_site = TRUE THEN 1 END) as on_site,
    COUNT(CASE WHEN is_on_site = FALSE AND last_seen_at IS NOT NULL THEN 1 END) as in_transit,
    COUNT(CASE WHEN linked_material_id IS NOT NULL THEN 1 END) as linked_to_materials,
    MAX(last_seen_at) as most_recent_update,
    MAX(synced_at) as last_sync
FROM public.samsara_trackers
GROUP BY project_id;

DROP VIEW IF EXISTS public.vw_delivery_dates_with_po;
CREATE VIEW public.vw_delivery_dates_with_po AS
SELECT
    d.*,
    p.purchase_order_id,
    p.po_description,
    p.supplier as po_supplier,
    p.status as po_status,
    p.delivery_date_from as po_delivery_date
FROM public.delivery_dates d
LEFT JOIN public.purchase_orders p
    ON d.po_number = p.purchase_order_id
   AND d.project_id = p.project_id;

DROP VIEW IF EXISTS public.vw_upcoming_delivery_dates;
CREATE VIEW public.vw_upcoming_delivery_dates AS
SELECT *
FROM public.delivery_dates
WHERE delivery_date >= CURRENT_DATE
  AND delivery_date <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY delivery_date ASC;

DROP VIEW IF EXISTS public.vw_milestones;
CREATE VIEW public.vw_milestones AS
SELECT *
FROM public.project_schedule
WHERE is_milestone = TRUE
ORDER BY start_date ASC NULLS LAST, finish_date ASC NULLS LAST;

DROP VIEW IF EXISTS public.vw_upcoming_activities;
CREATE VIEW public.vw_upcoming_activities AS
SELECT *
FROM public.project_schedule
WHERE
    (start_date >= CURRENT_DATE AND start_date <= CURRENT_DATE + INTERVAL '30 days')
    OR (finish_date >= CURRENT_DATE AND finish_date <= CURRENT_DATE + INTERVAL '30 days')
ORDER BY COALESCE(start_date, finish_date) ASC;

DROP VIEW IF EXISTS public.vw_critical_activities;
CREATE VIEW public.vw_critical_activities AS
SELECT *
FROM public.project_schedule
WHERE is_critical = TRUE
ORDER BY start_date ASC NULLS LAST;

DROP VIEW IF EXISTS public.vw_activities_by_type;
CREATE VIEW public.vw_activities_by_type AS
SELECT
    activity_type,
    project_id,
    COUNT(*) as activity_count,
    COUNT(*) FILTER (WHERE is_milestone = TRUE) as milestone_count,
    COUNT(*) FILTER (WHERE is_milestone = FALSE) as work_activity_count,
    AVG(remaining_duration) FILTER (WHERE is_milestone = FALSE) as avg_duration
FROM public.project_schedule
WHERE activity_type IS NOT NULL
GROUP BY activity_type, project_id
ORDER BY activity_count DESC;

DROP VIEW IF EXISTS public.vw_outside_shop_details;
CREATE VIEW public.vw_outside_shop_details AS
SELECT
    osi.id,
    osi.load_name,
    osi.qr_id,
    osi.scanner_comments,
    osi.delivery_date,
    osi.ship_date,
    osi.item_status,
    osi.project_id,
    sc.shop_name,
    sc.address,
    sc.city,
    sc.state,
    sc.contact_name,
    sc.contact_phone
FROM public.outside_shop_inventory osi
LEFT JOIN public.shop_contacts sc ON osi.shop_id = sc.id
ORDER BY osi.delivery_date DESC NULLS LAST;

DROP VIEW IF EXISTS public.vw_shipment_visibility;
CREATE VIEW public.vw_shipment_visibility AS
SELECT
    id,
    shipment_number,
    cargo_description,
    mode,
    ship_type,
    origin,
    destination,
    status,
    delivery_date AS date_delivered,
    eta AS date_delivered_est,
    rts_date AS date_shipped,
    supplier,
    category,
    num_pieces,
    part_description,
    project_id
FROM public.shipments
ORDER BY delivery_date DESC NULLS LAST;

-- ============================================================================
-- Functions created out-of-band in production (from the old loose
-- supabase/schema.sql). Codified verbatim so fresh environments match prod.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_dashboard_metrics()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.search_material_links(search_query text)
 RETURNS SETOF material_links
 LANGUAGE plpgsql
AS $function$
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
$function$;

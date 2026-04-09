-- ============================================================
-- Inventory & Outside Shop Tables
-- Replaces PowerBI dashboards: Master Inventory, Outside Shop
-- Inventory, Logistics Upgraded, Outside Shops Contacts
-- ============================================================

-- ── Inventory Records (Master Inventory) ────────────────────
-- Tracks all inventory items with QR codes at the main site
CREATE TABLE IF NOT EXISTS inventory_records (
    id              BIGSERIAL PRIMARY KEY,
    qr_code         TEXT NOT NULL,
    inventory_item  TEXT NOT NULL,
    item_description TEXT,
    unit            TEXT,          -- AIFH, ACW, COOLING TOWER, Gas Turbine 1/2/3, etc.
    subsystem       TEXT,
    location        TEXT,          -- Current location/area
    status          TEXT DEFAULT 'In Storage',  -- In Storage, Installed, In Transit, Shipped
    scan_uid        TEXT,
    scanner_comments TEXT,
    last_scanned_at TIMESTAMPTZ,
    last_scanned_by TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_records_qr ON inventory_records(qr_code);
CREATE INDEX IF NOT EXISTS idx_inv_records_unit ON inventory_records(unit);
CREATE INDEX IF NOT EXISTS idx_inv_records_subsystem ON inventory_records(subsystem);
CREATE INDEX IF NOT EXISTS idx_inv_records_status ON inventory_records(status);

-- ── Shop Contacts (Outside Shops Contact List) ──────────────
CREATE TABLE IF NOT EXISTS shop_contacts (
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

-- ── Outside Shop Inventory ──────────────────────────────────
-- Tracks items at external vendor shops
CREATE TABLE IF NOT EXISTS outside_shop_inventory (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT REFERENCES shop_contacts(id) ON DELETE SET NULL,
    load_name       TEXT,           -- Load/shipment name (e.g., NAES2ETHOS, Turbine CAB U1)
    qr_id           TEXT,
    scanner_comments TEXT,
    delivery_date   DATE,
    ship_date       DATE,
    item_status     TEXT DEFAULT 'At Shop',  -- At Shop, Ready to Ship, Shipped, Delivered
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_osi_shop ON outside_shop_inventory(shop_id);
CREATE INDEX IF NOT EXISTS idx_osi_load ON outside_shop_inventory(load_name);
CREATE INDEX IF NOT EXISTS idx_osi_qr ON outside_shop_inventory(qr_id);
CREATE INDEX IF NOT EXISTS idx_osi_status ON outside_shop_inventory(item_status);

-- ── Shipment Visibility (enhance existing shipments table) ──
-- Add columns needed for logistics dashboard if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='mode') THEN
        ALTER TABLE shipments ADD COLUMN mode TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='ship_type') THEN
        ALTER TABLE shipments ADD COLUMN ship_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='origin') THEN
        ALTER TABLE shipments ADD COLUMN origin TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='destination') THEN
        ALTER TABLE shipments ADD COLUMN destination TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='cargo_description') THEN
        ALTER TABLE shipments ADD COLUMN cargo_description TEXT;
    END IF;
END $$;

-- ── Views ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW vw_outside_shop_details AS
SELECT
    osi.id,
    osi.load_name,
    osi.qr_id,
    osi.scanner_comments,
    osi.delivery_date,
    osi.ship_date,
    osi.item_status,
    sc.shop_name,
    sc.address,
    sc.city,
    sc.state,
    sc.contact_name,
    sc.contact_phone
FROM outside_shop_inventory osi
LEFT JOIN shop_contacts sc ON osi.shop_id = sc.id
ORDER BY osi.delivery_date DESC NULLS LAST;

CREATE OR REPLACE VIEW vw_shipment_visibility AS
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
    part_description
FROM shipments
ORDER BY delivery_date DESC NULLS LAST;

-- ── RLS Policies ─────────────────────────────────────────────
ALTER TABLE inventory_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outside_shop_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read inventory_records" ON inventory_records
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert inventory_records" ON inventory_records
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update inventory_records" ON inventory_records
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated read shop_contacts" ON shop_contacts
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert shop_contacts" ON shop_contacts
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update shop_contacts" ON shop_contacts
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated read outside_shop_inventory" ON outside_shop_inventory
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert outside_shop_inventory" ON outside_shop_inventory
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update outside_shop_inventory" ON outside_shop_inventory
    FOR UPDATE TO authenticated USING (true);

-- ============================================================================
-- Delivery Dates Schema for MSR Dashboard
-- ============================================================================
-- Stores expected delivery dates for installation items
-- Run this in Supabase SQL Editor
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
-- INDEXES
-- ============================================================================
CREATE INDEX idx_delivery_po_number ON delivery_dates(po_number);
CREATE INDEX idx_delivery_tag_number ON delivery_dates(tag_number);
CREATE INDEX idx_delivery_supplier ON delivery_dates(supplier_name);
CREATE INDEX idx_delivery_date ON delivery_dates(delivery_date);

-- ============================================================================
-- TRIGGER: Update timestamp
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
-- SUCCESS MESSAGE
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✓ Delivery Dates Schema Created Successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - delivery_dates (delivery date tracking)';
    RAISE NOTICE '';
    RAISE NOTICE 'Views created:';
    RAISE NOTICE '  - vw_delivery_dates_with_po';
    RAISE NOTICE '  - vw_upcoming_delivery_dates';
    RAISE NOTICE '';
    RAISE NOTICE 'Next step:';
    RAISE NOTICE '  Run sync_delivery_dates.py to upload Excel data';
END $$;

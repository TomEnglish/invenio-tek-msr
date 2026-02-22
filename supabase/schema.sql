-- ============================================================================
-- Material Tracking System - Supabase Database Schema
-- ============================================================================
-- Project: Frame 6B Power Group MSR Dashboard
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
-- VIEWS
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
-- FUNCTIONS FOR API
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
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE material_links IS 'Stores associations between PO items and installation items with status tracking';
COMMENT ON TABLE material_status_history IS 'Audit trail for material status changes';
COMMENT ON COLUMN material_links.material_status IS 'Current status: ordered, shipped, received, or installed';
COMMENT ON COLUMN material_links.install_discipline IS 'Installation discipline: Civil, Electrical, Instrumentation, Mechanical, or Steel';

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'Material Tracking Database Schema Created Successfully!';
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - material_links';
    RAISE NOTICE '  - material_status_history';
    RAISE NOTICE '';
    RAISE NOTICE 'Views created:';
    RAISE NOTICE '  - vw_material_links_detailed';
    RAISE NOTICE '  - vw_stats_by_discipline';
    RAISE NOTICE '  - vw_stats_by_status';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions created:';
    RAISE NOTICE '  - get_material_statistics()';
    RAISE NOTICE '  - search_material_links(search_query)';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Configure RLS policies if needed';
    RAISE NOTICE '  2. Update frontend with Supabase credentials';
    RAISE NOTICE '  3. Test the connection';
    RAISE NOTICE '=======================================================';
END $$;

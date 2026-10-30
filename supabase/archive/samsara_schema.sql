-- ============================================================================
-- Samsara Tracker Integration Schema
-- ============================================================================
-- Adds tables for caching Samsara AT11 passive tracker data
-- Run this after the main schema.sql
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
    distance_from_site_km NUMERIC(10, 2),    -- Distance from Frame 6B site

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
-- INDEXES
-- ============================================================================
CREATE INDEX idx_samsara_trackers_name ON samsara_trackers(name);
CREATE INDEX idx_samsara_trackers_on_site ON samsara_trackers(is_on_site);
CREATE INDEX idx_samsara_trackers_linked_material ON samsara_trackers(linked_material_id);
CREATE INDEX idx_samsara_trackers_last_seen ON samsara_trackers(last_seen_at DESC);

CREATE INDEX idx_samsara_location_tracker ON samsara_location_history(tracker_id);
CREATE INDEX idx_samsara_location_time ON samsara_location_history(happened_at DESC);
CREATE INDEX idx_samsara_location_on_site ON samsara_location_history(is_on_site);

-- ============================================================================
-- TRIGGER: Update timestamp
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
    site_lat NUMERIC DEFAULT 35.293,  -- Frame 6B Power Group site, Amarillo TX
    site_lon NUMERIC DEFAULT -101.603
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
-- SUCCESS MESSAGE
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '✓ Samsara Tracker Schema Created Successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - samsara_trackers (passive tracker metadata)';
    RAISE NOTICE '  - samsara_location_history (historical locations)';
    RAISE NOTICE '';
    RAISE NOTICE 'Views created:';
    RAISE NOTICE '  - vw_active_samsara_trackers (active trackers with status)';
    RAISE NOTICE '  - vw_samsara_tracker_stats (summary statistics)';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions created:';
    RAISE NOTICE '  - calculate_distance_from_site(lat, lon)';
    RAISE NOTICE '  - is_location_on_site(lat, lon, radius)';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Update site coordinates in calculate_distance_from_site()';
    RAISE NOTICE '  2. Run sync_samsara_data.py to populate tracker data';
    RAISE NOTICE '  3. Open samsara-tracking.html to view dashboard';
END $$;

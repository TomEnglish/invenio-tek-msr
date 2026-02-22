-- Run this in Supabase SQL Editor to update geofence radius

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

-- ============================================================================
-- Project Schedule Schema for MSR Dashboard
-- ============================================================================
-- Stores project schedule activities and milestones
-- Run this in Supabase SQL Editor
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
-- INDEXES
-- ============================================================================
CREATE INDEX idx_schedule_activity_id ON project_schedule(activity_id);
CREATE INDEX idx_schedule_activity_name ON project_schedule(activity_name);
CREATE INDEX idx_schedule_start_date ON project_schedule(start_date);
CREATE INDEX idx_schedule_finish_date ON project_schedule(finish_date);
CREATE INDEX idx_schedule_is_milestone ON project_schedule(is_milestone);
CREATE INDEX idx_schedule_activity_type ON project_schedule(activity_type);
CREATE INDEX idx_schedule_status ON project_schedule(status);

-- ============================================================================
-- TRIGGER: Update timestamp
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
-- SUCCESS MESSAGE
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✓ Project Schedule Schema Created Successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - project_schedule (main schedule table)';
    RAISE NOTICE '';
    RAISE NOTICE 'Views created:';
    RAISE NOTICE '  - vw_milestones';
    RAISE NOTICE '  - vw_upcoming_activities';
    RAISE NOTICE '  - vw_critical_activities';
    RAISE NOTICE '  - vw_activities_by_type';
    RAISE NOTICE '';
    RAISE NOTICE 'Next step:';
    RAISE NOTICE '  Run sync_project_schedule.py to upload schedule data';
END $$;

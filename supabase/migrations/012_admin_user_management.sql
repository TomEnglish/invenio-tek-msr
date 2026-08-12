-- ============================================================================
-- 012: Multi-user authentication and admin user management
-- ============================================================================
-- This migration extends the shared Field/MSR contract established by
-- migrations 001-011 in the sibling Invenio Field app.
--
-- Apply after the existing users, projects, and MSR table migrations exist.
-- The browser must call the admin-users Edge Function for Auth Admin API
-- operations; this migration never grants browser access to a secret key.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extend the shared profile table without changing existing role values.
-- ----------------------------------------------------------------------------

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_role_active
    ON public.users (role, is_active);

CREATE OR REPLACE FUNCTION public.update_users_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON public.users;
CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_users_updated_at();

-- New Auth users always start as field workers. Never trust a role supplied in
-- user metadata: metadata is client-controlled and must not grant privilege.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, email, full_name, role, is_active)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(COALESCE(NEW.email, 'user'), '@', 1)),
        'field_worker',
        TRUE
    )
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            full_name = CASE
                WHEN public.users.full_name IS NULL OR public.users.full_name = ''
                THEN EXCLUDED.full_name
                ELSE public.users.full_name
            END;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill Auth users created before this migration. Existing roles are kept.
INSERT INTO public.users (id, email, full_name, role, is_active)
SELECT
    au.id,
    COALESCE(au.email, ''),
    COALESCE(NULLIF(au.raw_user_meta_data->>'full_name', ''), split_part(COALESCE(au.email, 'user'), '@', 1)),
    'field_worker',
    TRUE
FROM auth.users AS au
WHERE NOT EXISTS (
    SELECT 1 FROM public.users AS existing WHERE existing.id = au.id
);

-- ----------------------------------------------------------------------------
-- 2. Authorization helpers. These are security-definer functions so RLS
-- policies can check the role table without recursive users-table policies.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_active_user(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = check_user_id
          AND is_active = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = check_user_id
          AND role = 'admin'
          AND is_active = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.can_write_project_data(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = check_user_id
          AND role IN ('field_worker', 'office_staff', 'admin')
          AND is_active = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.has_project_access(check_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT
        check_project_id IS NOT NULL
        AND public.is_active_user((SELECT auth.uid()))
        AND EXISTS (
            SELECT 1
            FROM public.user_projects
            WHERE user_id = (SELECT auth.uid())
              AND project_id = check_project_id
        );
$$;

-- ----------------------------------------------------------------------------
-- 3. Audit table and last-admin protection.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_admin_audit (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('invite', 'update', 'activate', 'deactivate')),
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_admin_audit_created_at
    ON public.user_admin_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_admin_audit_target
    ON public.user_admin_audit (target_user_id);

CREATE OR REPLACE FUNCTION public.prevent_last_admin_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'admin'
           AND OLD.is_active = TRUE
           AND NOT EXISTS (
               SELECT 1
               FROM public.users
               WHERE id <> OLD.id
                 AND role = 'admin'
                 AND is_active = TRUE
           ) THEN
            RAISE EXCEPTION 'The last active administrator cannot be removed'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.role = 'admin'
       AND OLD.is_active = TRUE
       AND (
           NEW.role IS DISTINCT FROM 'admin'
           OR NEW.is_active IS DISTINCT FROM TRUE
       )
       AND NOT EXISTS (
           SELECT 1
           FROM public.users
           WHERE id <> OLD.id
             AND role = 'admin'
             AND is_active = TRUE
       ) THEN
        RAISE EXCEPTION 'The last active administrator cannot be demoted or deactivated'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_prevent_last_admin_update ON public.users;
CREATE TRIGGER trigger_prevent_last_admin_update
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.prevent_last_admin_removal();

DROP TRIGGER IF EXISTS trigger_prevent_last_admin_delete ON public.users;
CREATE TRIGGER trigger_prevent_last_admin_delete
    BEFORE DELETE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.prevent_last_admin_removal();

-- ----------------------------------------------------------------------------
-- 4. RLS for user profiles, memberships, projects, and audit records.
-- ----------------------------------------------------------------------------

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_admin_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read users" ON public.users;
DROP POLICY IF EXISTS "Users can read profiles based on shared projects" ON public.users;
DROP POLICY IF EXISTS "Users can update their own name, admins can update anything" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile, admins can update any" ON public.users;
DROP POLICY IF EXISTS "Users can read own user profile" ON public.users;
DROP POLICY IF EXISTS "Admins can read all user profiles" ON public.users;
DROP POLICY IF EXISTS "Admins can update user profiles" ON public.users;

CREATE POLICY "Users can read own user profile"
    ON public.users FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = id);

CREATE POLICY "Admins can read all user profiles"
    ON public.users FOR SELECT TO authenticated
    USING ((SELECT public.is_admin((SELECT auth.uid()))));

CREATE POLICY "Admins can update user profiles"
    ON public.users FOR UPDATE TO authenticated
    USING ((SELECT public.is_admin((SELECT auth.uid()))))
    WITH CHECK ((SELECT public.is_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Users can read their own project assignments" ON public.user_projects;
DROP POLICY IF EXISTS "Admins can manage user_projects" ON public.user_projects;
DROP POLICY IF EXISTS "Users can read active project assignments" ON public.user_projects;
DROP POLICY IF EXISTS "Admins can manage active project assignments" ON public.user_projects;

CREATE POLICY "Users can read active project assignments"
    ON public.user_projects FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        AND (SELECT public.is_active_user((SELECT auth.uid())))
    );

CREATE POLICY "Admins can manage active project assignments"
    ON public.user_projects FOR ALL TO authenticated
    USING ((SELECT public.is_admin((SELECT auth.uid()))))
    WITH CHECK ((SELECT public.is_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Users can read assigned projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can insert projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can update projects" ON public.projects;
DROP POLICY IF EXISTS "Active users can read assigned projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can insert active projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can update active projects" ON public.projects;

CREATE POLICY "Active users can read assigned projects"
    ON public.projects FOR SELECT TO authenticated
    USING ((SELECT public.has_project_access(id)));

CREATE POLICY "Admins can insert active projects"
    ON public.projects FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_admin((SELECT auth.uid()))));

CREATE POLICY "Admins can update active projects"
    ON public.projects FOR UPDATE TO authenticated
    USING ((SELECT public.is_admin((SELECT auth.uid()))))
    WITH CHECK ((SELECT public.is_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Admins can read user audit" ON public.user_admin_audit;
CREATE POLICY "Admins can read user audit"
    ON public.user_admin_audit FOR SELECT TO authenticated
    USING ((SELECT public.is_admin((SELECT auth.uid()))));

REVOKE INSERT, UPDATE, DELETE ON public.user_admin_audit FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Tighten project-scoped MSR tables to active project members.
--
-- The existing migrations intentionally used broad authenticated-user policies
-- while the project mapping was being reconciled. Replace all policies on the
-- project-owned tables with one consistent policy set. Service-role sync jobs
-- continue to work because service_role bypasses RLS.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    table_name TEXT;
    policy_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'locations',
        'qr_codes',
        'receiving_records',
        'materials',
        'material_movements',
        'material_issues',
        'shipments_out',
        'purchase_orders',
        'shipments',
        'dashboard_metrics',
        'material_links',
        'material_status_history',
        'samsara_trackers',
        'samsara_location_history',
        'delivery_dates',
        'project_schedule',
        'inventory_records',
        'outside_shop_inventory'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

        -- Replace pre-existing policies so permissive OR-combination cannot
        -- bypass the new project-membership condition.
        FOR policy_name IN
            SELECT policyname
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = table_name
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
        END LOOP;

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_project_access(project_id)))',
            'Project members can read ' || table_name,
            table_name
        );

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_write_project_data((SELECT auth.uid()))) AND (SELECT public.has_project_access(project_id)))',
            'Project members can insert ' || table_name,
            table_name
        );

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.can_write_project_data((SELECT auth.uid()))) AND (SELECT public.has_project_access(project_id))) WITH CHECK ((SELECT public.can_write_project_data((SELECT auth.uid()))) AND (SELECT public.has_project_access(project_id)))',
            'Project members can update ' || table_name,
            table_name
        );

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.is_admin((SELECT auth.uid()))) AND (SELECT public.has_project_access(project_id)))',
            'Admins can delete ' || table_name,
            table_name
        );
    END LOOP;
END;
$$;

-- These history tables inherit scope from their parent row when the old
-- migration left project_id nullable.
UPDATE public.material_status_history AS history
SET project_id = links.project_id
FROM public.material_links AS links
WHERE history.project_id IS NULL
  AND history.link_id = links.id;

UPDATE public.samsara_location_history AS history
SET project_id = trackers.project_id
FROM public.samsara_trackers AS trackers
WHERE history.project_id IS NULL
  AND history.tracker_id = trackers.id;

-- Shop contacts are intentionally shared reference data, but inactive users
-- must not retain direct API access.
ALTER TABLE public.shop_contacts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
    policy_name TEXT;
BEGIN
    FOR policy_name IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'shop_contacts'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.shop_contacts', policy_name);
    END LOOP;
END;
$$;

CREATE POLICY "Active users can read shop contacts"
    ON public.shop_contacts FOR SELECT TO authenticated
    USING ((SELECT public.is_active_user((SELECT auth.uid()))));

CREATE POLICY "Active users can insert shop contacts"
    ON public.shop_contacts FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.can_write_project_data((SELECT auth.uid()))));

CREATE POLICY "Active users can update shop contacts"
    ON public.shop_contacts FOR UPDATE TO authenticated
    USING ((SELECT public.can_write_project_data((SELECT auth.uid()))))
    WITH CHECK ((SELECT public.can_write_project_data((SELECT auth.uid()))));

CREATE POLICY "Admins can delete shop contacts"
    ON public.shop_contacts FOR DELETE TO authenticated
    USING ((SELECT public.is_admin((SELECT auth.uid()))));

COMMIT;

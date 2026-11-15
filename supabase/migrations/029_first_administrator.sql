-- First administrator. Every way to add a person needs an administrator
-- already, so a new, empty database had no way to get its first one. This adds
-- one server-only function for the setup command (scripts/create-first-admin.mjs).
-- It refuses as soon as the database has an active administrator, so it cannot
-- be used to add a second one or to take over a database in use. Changes no
-- table, column or rule.
BEGIN;

CREATE FUNCTION public.bootstrap_first_admin(p_target uuid,p_full_name text,p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE after_row public.users; project_ids uuid[];
BEGIN
 -- The same lock as every other change to who may administer (013).
 PERFORM pg_advisory_xact_lock(73190421);
 IF EXISTS(SELECT 1 FROM public.users WHERE role='admin' AND is_active AND invitation_status='accepted') THEN
  RAISE EXCEPTION 'This database already has an administrator. Add people from Users & Access.' USING ERRCODE='42501';
 END IF;
 IF length(trim(coalesce(p_full_name,''))) NOT BETWEEN 1 AND 120 THEN
  RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023'; END IF;
 IF p_expires_at IS NULL OR p_expires_at<=now() OR p_expires_at>now()+interval '7 days' THEN
  RAISE EXCEPTION 'Invitation expiry must be within the next 7 days' USING ERRCODE='22023'; END IF;
 -- A first invitation sent to the wrong address is withdrawn when the command
 -- is run again for the right one, so only one is ever outstanding.
 -- Like any cancelled invitation, it also gives up its project access.
 WITH withdrawn AS (
  UPDATE public.users SET invitation_status='cancelled',is_active=false
   WHERE role='admin' AND invitation_status='pending' AND id<>p_target RETURNING id
 ) DELETE FROM public.user_projects WHERE user_id IN (SELECT id FROM withdrawn);
 -- An account that already finished setup keeps it; anyone else gets a fresh invitation.
 UPDATE public.users SET full_name=trim(p_full_name),role='admin',is_active=true,
  invitation_expires_at=CASE WHEN invitation_status='accepted' THEN invitation_expires_at ELSE p_expires_at END,
  invitation_status=CASE WHEN invitation_status='accepted' THEN 'accepted' ELSE 'pending' END
  WHERE id=p_target RETURNING * INTO after_row;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO project_ids FROM public.projects;
 INSERT INTO public.user_projects(user_id,project_id) SELECT p_target,unnest(project_ids) ON CONFLICT DO NOTHING;
 INSERT INTO public.user_admin_audit(actor_user_id,target_user_id,action,details)
 VALUES(NULL,p_target,'invite',jsonb_build_object('firstAdministrator',true,
 'after',jsonb_build_object('fullName',after_row.full_name,'role',after_row.role,'isActive',after_row.is_active,'projectIds',project_ids,'invitationStatus',after_row.invitation_status)));
 RETURN to_jsonb(after_row);
END $$;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(uuid,text,timestamptz) TO service_role;

COMMIT;

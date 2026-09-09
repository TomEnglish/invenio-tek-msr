-- Shared Field/MSR authorization. Apply after 012; deploy compatible clients.
BEGIN;

ALTER TABLE public.users ADD COLUMN invitation_status text NOT NULL DEFAULT 'accepted'
  CHECK (invitation_status IN ('pending','accepted','cancelled'));
ALTER TABLE public.users ADD COLUMN invitation_expires_at timestamptz;
-- Previously sent but never confirmed invitations need a fresh setup link.
UPDATE public.users u SET invitation_status='pending',invitation_expires_at=now()
 FROM auth.users a WHERE a.id=u.id AND a.invited_at IS NOT NULL AND a.email_confirmed_at IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.users(id,email,full_name,role,is_active,invitation_status)
 VALUES(NEW.id,coalesce(NEW.email,''),coalesce(nullif(NEW.raw_user_meta_data->>'full_name',''),split_part(NEW.email,'@',1)),
   'field_worker',true,'pending') ON CONFLICT(id) DO NOTHING;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.is_active_user(check_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.users WHERE id=check_user_id AND is_active AND invitation_status='accepted');
$$;
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_active_user(check_user_id) AND EXISTS(SELECT 1 FROM public.users WHERE id=check_user_id AND role='admin');
$$;
CREATE OR REPLACE FUNCTION public.is_office_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_active_user(auth.uid()) AND EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role IN ('office_staff','admin'));
$$;
CREATE OR REPLACE FUNCTION public.has_project_access(check_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_active_user(auth.uid()) AND EXISTS(
 SELECT 1 FROM public.user_projects up JOIN public.projects p ON p.id=up.project_id
 WHERE up.user_id=auth.uid() AND p.id=check_project_id AND p.status<>'archived');
$$;
CREATE OR REPLACE FUNCTION public.can_work_project(check_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.has_project_access(check_project_id) AND EXISTS(SELECT 1 FROM public.projects WHERE id=check_project_id AND status='active');
$$;
REVOKE ALL ON FUNCTION public.is_office_user(),public.can_work_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_office_user(),public.can_work_project(uuid) TO authenticated,service_role;

-- All operational history is immutable to browser roles. Field writes use
-- transactional RPCs in 014. Office forms retain their specific write paths.
DO $$ DECLARE t text; pol text; office_tables text[] := ARRAY[
 'locations','purchase_orders','shipments','material_links','delivery_dates','project_schedule','inventory_records','outside_shop_inventory'];
BEGIN
 FOREACH t IN ARRAY ARRAY['locations','qr_codes','receiving_records','materials','material_movements','material_issues',
 'shipments_out','purchase_orders','shipments','dashboard_metrics','material_links','material_status_history','samsara_trackers',
 'samsara_location_history','delivery_dates','project_schedule','inventory_records','outside_shop_inventory'] LOOP
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',pol,t);
  END LOOP;
  EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING(public.has_project_access(project_id))',t);
  IF t=ANY(office_tables) THEN
   EXECUTE format('CREATE POLICY office_insert ON public.%I FOR INSERT TO authenticated WITH CHECK(public.is_office_user() AND public.can_work_project(project_id))',t);
   EXECUTE format('CREATE POLICY office_update ON public.%I FOR UPDATE TO authenticated USING(public.is_office_user() AND public.can_work_project(project_id)) WITH CHECK(public.is_office_user() AND public.can_work_project(project_id))',t);
  END IF;
 END LOOP;
END $$;
-- QR label generation remains available to office staff; field creation is
-- part of the receiving transaction and cannot relink another receipt.
CREATE POLICY office_qr_insert ON public.qr_codes FOR INSERT TO authenticated
 WITH CHECK(public.is_office_user() AND public.can_work_project(project_id));

DROP POLICY IF EXISTS "Active users can insert shop contacts" ON public.shop_contacts;
DROP POLICY IF EXISTS "Active users can update shop contacts" ON public.shop_contacts;
CREATE POLICY office_contacts_insert ON public.shop_contacts FOR INSERT TO authenticated WITH CHECK(public.is_office_user());
CREATE POLICY office_contacts_update ON public.shop_contacts FOR UPDATE TO authenticated USING(public.is_office_user()) WITH CHECK(public.is_office_user());

-- Active users can see colleagues in shared projects for attribution/assignment.
CREATE OR REPLACE FUNCTION public.shares_project(other_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_active_user(auth.uid()) AND EXISTS(
 SELECT 1 FROM public.user_projects mine JOIN public.user_projects theirs USING(project_id)
 WHERE mine.user_id=auth.uid() AND theirs.user_id=other_user_id);
$$;
REVOKE ALL ON FUNCTION public.shares_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_project(uuid) TO authenticated;
CREATE POLICY colleague_profiles ON public.users FOR SELECT TO authenticated USING(public.shares_project(id));
REVOKE INSERT,UPDATE,DELETE ON public.users,public.user_projects FROM anon,authenticated;

-- Protect all reporting views, not just the frontend's current filtered calls.
DO $$ DECLARE v record;
BEGIN
 FOR v IN SELECT schemaname,viewname FROM pg_views WHERE schemaname='public' LOOP
  EXECUTE format('ALTER VIEW %I.%I SET (security_invoker=true)',v.schemaname,v.viewname);
 END LOOP;
END $$;

ALTER TABLE public.audit_log ADD COLUMN project_id uuid REFERENCES public.projects(id);
UPDATE public.audit_log a SET project_id=m.project_id FROM public.materials m WHERE a.entity_type='material' AND a.entity_id=m.id;
UPDATE public.audit_log a SET project_id=r.project_id FROM public.receiving_records r WHERE a.entity_type IN ('receiving_record','receiving') AND a.entity_id=r.id;
DROP POLICY IF EXISTS "Authenticated users can read audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated users can insert audit log" ON public.audit_log;
CREATE POLICY audit_project_read ON public.audit_log FOR SELECT TO authenticated USING(public.has_project_access(project_id));
REVOKE INSERT,UPDATE,DELETE ON public.audit_log FROM anon,authenticated;

DROP POLICY IF EXISTS "Authenticated users can read inspection_photos" ON public.inspection_photos;
DROP POLICY IF EXISTS "Authenticated users can insert inspection_photos" ON public.inspection_photos;
CREATE POLICY photo_read ON public.inspection_photos FOR SELECT TO authenticated USING(EXISTS(
 SELECT 1 FROM public.receiving_records r WHERE r.id=receiving_record_id AND public.has_project_access(r.project_id)));
CREATE POLICY photo_insert ON public.inspection_photos FOR INSERT TO authenticated WITH CHECK(EXISTS(
 SELECT 1 FROM public.receiving_records r WHERE r.id=receiving_record_id AND public.can_work_project(r.project_id)
 AND (r.created_by=auth.uid() OR public.is_office_user())));
CREATE UNIQUE INDEX IF NOT EXISTS inspection_photos_storage_path_unique ON public.inspection_photos(storage_path);

CREATE OR REPLACE FUNCTION public.can_access_inspection_path(path text, writing boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE receipt public.receiving_records;
BEGIN
 SELECT * INTO receipt FROM public.receiving_records WHERE id=split_part(path,'/',1)::uuid;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN CASE WHEN writing THEN public.can_work_project(receipt.project_id) AND (receipt.created_by=auth.uid() OR public.is_office_user())
 ELSE public.has_project_access(receipt.project_id) END;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.can_access_inspection_path(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_inspection_path(text,boolean) TO authenticated;
UPDATE storage.buckets SET public=false WHERE id='inspection-photos';
-- Restrictive policies also constrain pre-existing permissive storage policies.
CREATE POLICY inspection_scope_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'inspection-photos' OR public.can_access_inspection_path(name,false));
CREATE POLICY inspection_scope_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'inspection-photos' OR public.can_access_inspection_path(name,true));
CREATE POLICY inspection_scope_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'inspection-photos' OR public.can_access_inspection_path(name,true))
 WITH CHECK(bucket_id<>'inspection-photos' OR public.can_access_inspection_path(name,true));
CREATE POLICY inspection_scope_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'inspection-photos');
CREATE POLICY inspection_objects_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='inspection-photos' AND public.can_access_inspection_path(name,false));
CREATE POLICY inspection_objects_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='inspection-photos' AND public.can_access_inspection_path(name,true));
CREATE POLICY inspection_objects_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='inspection-photos' AND public.can_access_inspection_path(name,true))
 WITH CHECK(bucket_id='inspection-photos' AND public.can_access_inspection_path(name,true));
CREATE POLICY inspection_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
 USING(bucket_id<>'inspection-photos') WITH CHECK(bucket_id<>'inspection-photos');

-- The old privileged deduction endpoint cannot be called independently of an
-- inventory transaction. A client release is required for physical mutations.
REVOKE ALL ON FUNCTION public.deduct_material_quantity(uuid,integer,text) FROM PUBLIC,anon,authenticated;

ALTER TABLE public.user_admin_audit DROP CONSTRAINT user_admin_audit_action_check;
ALTER TABLE public.user_admin_audit ADD CONSTRAINT user_admin_audit_action_check
 CHECK(action IN ('invite','update','activate','deactivate','resend_invite','cancel_invite','accept_invite','project_create','project_update'));

CREATE OR REPLACE FUNCTION public.prevent_last_admin_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(73190421);
 IF OLD.role='admin' AND OLD.is_active AND OLD.invitation_status='accepted'
 AND (TG_OP='DELETE' OR NEW.role<>'admin' OR NOT NEW.is_active OR NEW.invitation_status<>'accepted')
 AND NOT EXISTS(SELECT 1 FROM public.users WHERE id<>OLD.id AND role='admin' AND is_active AND invitation_status='accepted')
 THEN RAISE EXCEPTION 'The last active administrator cannot be removed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
 p_actor uuid,p_target uuid,p_changes jsonb,p_projects uuid[] DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_row public.users; after_row public.users; old_projects uuid[]; new_projects uuid[]; action_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(73190421);
 IF NOT public.is_admin(p_actor) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT before_row FROM public.users WHERE id=p_target FOR UPDATE;
 IF p_expected_updated_at IS NOT NULL AND before_row.updated_at<>p_expected_updated_at THEN
  RAISE EXCEPTION 'User changed since this form was opened' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('full_name','role','is_active','invitation_status','invitation_expires_at')) THEN
  RAISE EXCEPTION 'Unsupported profile field' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(project_id ORDER BY project_id),'{}') INTO old_projects FROM public.user_projects WHERE user_id=p_target;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO new_projects FROM unnest(coalesce(p_projects,old_projects)) id;
 IF EXISTS(SELECT 1 FROM unnest(new_projects) id WHERE NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=id)) THEN
  RAISE EXCEPTION 'Project not found' USING ERRCODE='23503'; END IF;
 UPDATE public.users SET
  full_name=CASE WHEN p_changes ? 'full_name' THEN p_changes->>'full_name' ELSE full_name END,
  role=CASE WHEN p_changes ? 'role' THEN p_changes->>'role' ELSE role END,
  is_active=CASE WHEN p_changes ? 'is_active' THEN (p_changes->>'is_active')::boolean ELSE is_active END,
  invitation_status=CASE WHEN p_changes ? 'invitation_status' THEN p_changes->>'invitation_status' ELSE invitation_status END,
  invitation_expires_at=CASE WHEN p_changes ? 'invitation_expires_at' THEN (p_changes->>'invitation_expires_at')::timestamptz ELSE invitation_expires_at END
 WHERE id=p_target RETURNING * INTO after_row;
 IF length(trim(after_row.full_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023'; END IF;
 DELETE FROM public.user_projects WHERE user_id=p_target AND NOT(project_id=ANY(new_projects));
 INSERT INTO public.user_projects(user_id,project_id) SELECT p_target,unnest(new_projects) ON CONFLICT DO NOTHING;
 action_name:=CASE
  WHEN after_row.invitation_status='cancelled' AND before_row.invitation_status<>'cancelled' THEN 'cancel_invite'
  WHEN after_row.invitation_status='pending' AND before_row.invitation_expires_at IS NULL AND after_row.invitation_expires_at IS NOT NULL THEN 'invite'
  WHEN after_row.invitation_status='pending' AND after_row.invitation_expires_at IS DISTINCT FROM before_row.invitation_expires_at THEN 'resend_invite'
  WHEN before_row.is_active AND NOT after_row.is_active THEN 'deactivate'
  WHEN NOT before_row.is_active AND after_row.is_active THEN 'activate' ELSE 'update' END;
 INSERT INTO public.user_admin_audit(actor_user_id,target_user_id,action,details)
 VALUES(p_actor,p_target,action_name,jsonb_build_object(
 'before',jsonb_build_object('fullName',before_row.full_name,'role',before_row.role,'isActive',before_row.is_active,'projectIds',old_projects,'invitationStatus',before_row.invitation_status),
 'after',jsonb_build_object('fullName',after_row.full_name,'role',after_row.role,'isActive',after_row.is_active,'projectIds',new_projects,'invitationStatus',after_row.invitation_status)));
 RETURN to_jsonb(after_row);
END $$;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid,uuid,jsonb,uuid[],timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid,uuid,jsonb,uuid[],timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_invitation() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE profile public.users;
BEGIN
 PERFORM pg_advisory_xact_lock(73190421);
 SELECT * INTO STRICT profile FROM public.users WHERE id=auth.uid() FOR UPDATE;
 IF NOT profile.is_active OR profile.invitation_status='cancelled' THEN RAISE EXCEPTION 'Invitation cancelled' USING ERRCODE='42501'; END IF;
 IF profile.invitation_status='accepted' THEN RETURN; END IF;
 IF profile.invitation_expires_at IS NULL OR profile.invitation_expires_at<now() THEN RAISE EXCEPTION 'Invitation expired' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL AND coalesce(encrypted_password,'')<>'') THEN
  RAISE EXCEPTION 'Set a password before accepting your invitation' USING ERRCODE='42501'; END IF;
 UPDATE public.users SET invitation_status='accepted' WHERE id=auth.uid();
 INSERT INTO public.user_admin_audit(actor_user_id,target_user_id,action,details) VALUES(auth.uid(),auth.uid(),'accept_invite','{}');
END $$;
REVOKE ALL ON FUNCTION public.complete_invitation() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_invitation() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_project(p_actor uuid,p_id uuid,p_name text,p_description text,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_row public.projects; after_row public.projects;
BEGIN
 IF NOT public.is_admin(p_actor) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF length(trim(p_name)) NOT BETWEEN 1 AND 120 OR length(coalesce(p_description,''))>2000 THEN
  RAISE EXCEPTION 'Invalid project details' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.projects(name,description,status) VALUES(trim(p_name),p_description,p_status) RETURNING * INTO after_row;
  INSERT INTO public.user_projects(user_id,project_id) VALUES(p_actor,after_row.id);
 ELSE
  SELECT * INTO STRICT before_row FROM public.projects WHERE id=p_id FOR UPDATE;
  UPDATE public.projects SET name=trim(p_name),description=p_description,status=p_status WHERE id=p_id RETURNING * INTO after_row;
 END IF;
 INSERT INTO public.user_admin_audit(actor_user_id,action,details)
 VALUES(p_actor,CASE WHEN p_id IS NULL THEN 'project_create' ELSE 'project_update' END,
  jsonb_build_object('projectId',after_row.id,'before',to_jsonb(before_row),'after',to_jsonb(after_row)));
 RETURN to_jsonb(after_row);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_project(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_project(uuid,uuid,text,text,text) TO service_role;
REVOKE INSERT,UPDATE,DELETE ON public.projects FROM anon,authenticated;

COMMIT;

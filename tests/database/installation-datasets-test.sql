BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('99999999-9999-4999-8999-999999999991','installation-reader@example.test');
UPDATE public.users SET invitation_status='accepted'
 WHERE id='99999999-9999-4999-8999-999999999991';
INSERT INTO public.projects(id,name) VALUES
 ('99999999-9999-4999-8999-999999999992','Private installation site');
INSERT INTO public.user_projects(user_id,project_id) VALUES
 ('99999999-9999-4999-8999-999999999991','00000000-0000-0000-0000-000000000000');
INSERT INTO public.installation_datasets(project_id,dataset_key,payload) VALUES
 ('00000000-0000-0000-0000-000000000000','audit_data','{"civil":[]}'),
 ('99999999-9999-4999-8999-999999999992','audit_data','{"private":true}');
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM payload FROM public.installation_datasets;
  RAISE EXCEPTION 'Anonymous installation data access must fail';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999991',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.installation_datasets)<>1 THEN
  RAISE EXCEPTION 'Installation data must be limited to assigned projects'; END IF;
 BEGIN
  UPDATE public.installation_datasets SET payload='{}';
  RAISE EXCEPTION 'Browser installation data writes must fail';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.users SET is_active=false WHERE id='99999999-9999-4999-8999-999999999991';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.installation_datasets) THEN
  RAISE EXCEPTION 'Inactive users must not read installation data'; END IF;
END $$;
RESET ROLE;
ROLLBACK;

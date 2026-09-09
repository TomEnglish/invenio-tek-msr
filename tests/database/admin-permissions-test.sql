BEGIN;
\ir admin-fixtures.sql

SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('f1111111-1111-4111-8111-111111111111','f2222222-2222-4222-8222-222222222222','{"role":"admin"}')
$query$,'42501','A service call with a field-worker actor cannot administer users');
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('01111111-1111-4111-8111-111111111111','f2222222-2222-4222-8222-222222222222','{"role":"admin"}')
$query$,'42501','A service call with an office actor cannot administer users');
RESET ROLE;
UPDATE public.users SET is_active=false WHERE id='a2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('a2222222-2222-4222-8222-222222222222','f2222222-2222-4222-8222-222222222222','{"role":"admin"}')
$query$,'42501','A deactivated administrator cannot act through a service call');
SELECT pg_temp.assert_true((SELECT role='field_worker' FROM public.users WHERE id='f2222222-2222-4222-8222-222222222222'),
 'Unauthorized calls leave the target unchanged');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.user_admin_audit),'Unauthorized calls cannot create success audit');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
-- Even a genuine admin browser must use the audited service path. Test actual
-- statements as authenticated, not just privilege metadata.
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','{"role":"admin"}')
$query$,'42501','Authenticated admin cannot execute service-only RPC');
SELECT pg_temp.expect_error($query$
 UPDATE public.users SET role='admin' WHERE id='f1111111-1111-4111-8111-111111111111'
$query$,'42501','Authenticated admin cannot directly update profiles');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.users(id,email,full_name,role) VALUES('f1111111-1111-4111-8111-111111111111','duplicate@example.test','Duplicate','admin')
$query$,'42501','Authenticated admin cannot directly insert profiles');
SELECT pg_temp.expect_error($query$
 DELETE FROM public.users WHERE id='f1111111-1111-4111-8111-111111111111'
$query$,'42501','Authenticated admin cannot directly delete profiles');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.user_projects(user_id,project_id) VALUES('f1111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222')
$query$,'42501','Authenticated admin cannot directly add membership');
SELECT pg_temp.expect_error($query$
 UPDATE public.user_projects SET project_id='b2222222-2222-4222-8222-222222222222' WHERE user_id='f1111111-1111-4111-8111-111111111111'
$query$,'42501','Authenticated admin cannot directly replace membership');
SELECT pg_temp.expect_error($query$
 DELETE FROM public.user_projects WHERE user_id='f1111111-1111-4111-8111-111111111111'
$query$,'42501','Authenticated admin cannot directly delete membership');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.user_admin_audit(actor_user_id,target_user_id,action) VALUES('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','update')
$query$,'42501','Authenticated admin cannot forge audit records');
RESET ROLE;
ROLLBACK;

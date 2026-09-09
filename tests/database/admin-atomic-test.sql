BEGIN;
\ir admin-fixtures.sql

CREATE TEMP TABLE original_state AS
 SELECT to_jsonb(u) AS profile,
 (SELECT jsonb_agg(to_jsonb(up) ORDER BY up.project_id) FROM public.user_projects up WHERE up.user_id=u.id) AS memberships,
 (SELECT count(*) FROM public.user_admin_audit) AS audit_count
 FROM public.users u WHERE id='f1111111-1111-4111-8111-111111111111';
GRANT SELECT ON original_state TO service_role;

SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111',
  '{"full_name":"Should roll back","role":"office_staff"}',ARRAY['ffffffff-ffff-4fff-8fff-ffffffffffff']::uuid[])
$query$,'23503','Invalid project rejects the complete update');
SELECT pg_temp.assert_true(
 (SELECT to_jsonb(u)=(SELECT profile FROM original_state) FROM public.users u WHERE id='f1111111-1111-4111-8111-111111111111'),
 'Invalid project preserves every profile field');
SELECT pg_temp.assert_true(
 (SELECT jsonb_agg(to_jsonb(up) ORDER BY project_id)=(SELECT memberships FROM original_state)
 FROM public.user_projects up WHERE user_id='f1111111-1111-4111-8111-111111111111'),
 'Invalid project preserves original memberships');
SELECT pg_temp.assert_true((SELECT count(*)=(SELECT audit_count FROM original_state) FROM public.user_admin_audit),
 'Rejected update produces no success audit');
RESET ROLE;

-- Fail after the profile UPDATE and after old membership removal, exercising
-- rollback at the actual database mutation boundary rather than prevalidation.
CREATE FUNCTION pg_temp.fail_membership_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.user_id='f1111111-1111-4111-8111-111111111111' AND NEW.project_id='b2222222-2222-4222-8222-222222222222' THEN
  RAISE EXCEPTION 'Injected membership failure' USING ERRCODE='P0901';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_membership_insert_failure BEFORE INSERT ON public.user_projects
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_membership_insert();
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111',
  '{"full_name":"Should also roll back","role":"office_staff","is_active":false}',ARRAY['b2222222-2222-4222-8222-222222222222']::uuid[])
$query$,'P0901','Injected membership write failure reaches the caller');
SELECT pg_temp.assert_true(
 (SELECT to_jsonb(u)=(SELECT profile FROM original_state) FROM public.users u WHERE id='f1111111-1111-4111-8111-111111111111'),
 'Membership insert failure rolls back all profile changes');
SELECT pg_temp.assert_true(
 (SELECT jsonb_agg(to_jsonb(up) ORDER BY project_id)=(SELECT memberships FROM original_state)
 FROM public.user_projects up WHERE user_id='f1111111-1111-4111-8111-111111111111'),
 'Membership insert failure restores memberships already deleted');
SELECT pg_temp.assert_true((SELECT count(*)=(SELECT audit_count FROM original_state) FROM public.user_admin_audit),
 'Membership failure rolls back the audit transaction');
RESET ROLE;
DROP TRIGGER test_membership_insert_failure ON public.user_projects;

SET LOCAL ROLE service_role;
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111',
 '{"full_name":"Updated Worker","role":"office_staff"}',ARRAY['b2222222-2222-4222-8222-222222222222']::uuid[]);
SELECT pg_temp.assert_true((SELECT full_name='Updated Worker' AND role='office_staff' FROM public.users WHERE id='f1111111-1111-4111-8111-111111111111'),
 'Valid update changes the profile');
SELECT pg_temp.assert_true((SELECT array_agg(project_id)=ARRAY['b2222222-2222-4222-8222-222222222222']::uuid[] FROM public.user_projects WHERE user_id='f1111111-1111-4111-8111-111111111111'),
 'Valid update replaces memberships');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.user_admin_audit WHERE target_user_id='f1111111-1111-4111-8111-111111111111'),
 'One successful update produces exactly one audit row');
RESET ROLE;
ROLLBACK;

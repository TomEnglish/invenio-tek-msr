BEGIN;
\ir admin-fixtures.sql
-- Migration 029. The fixtures hold two accepted administrators, as a database in use does.
SELECT pg_temp.assert_true(
 has_function_privilege('service_role','public.bootstrap_first_admin(uuid,text,timestamptz)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.bootstrap_first_admin(uuid,text,timestamptz)','EXECUTE')
 AND NOT has_function_privilege('anon','public.bootstrap_first_admin(uuid,text,timestamptz)','EXECUTE'),
 'Only the server may create the first administrator');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('f1111111-1111-4111-8111-111111111111','Field One',now()+interval '1 hour')
$query$,'42501','A signed-in user cannot make themselves the first administrator');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('f1111111-1111-4111-8111-111111111111','Field One',now()+interval '1 hour')
$query$,'42501','Refused while the database has an active administrator');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT role='field_worker' FROM public.users WHERE id='f1111111-1111-4111-8111-111111111111')
 AND NOT EXISTS(SELECT 1 FROM public.user_admin_audit),'A refusal changes nothing and records nothing');

-- A new database: accounts exist only as unaccepted invitations, and nobody administers.
ALTER TABLE public.users DISABLE TRIGGER USER;
UPDATE public.users SET role='field_worker',invitation_status='pending',invitation_expires_at=NULL;
ALTER TABLE public.users ENABLE TRIGGER USER;
UPDATE public.users SET invitation_status='accepted' WHERE id='01111111-1111-4111-8111-111111111111';
DELETE FROM public.user_projects;

SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('f1111111-1111-4111-8111-111111111111','  ',now()+interval '1 hour')
$query$,'22023','A name is required');
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('f1111111-1111-4111-8111-111111111111','Field One',now()-interval '1 minute')
$query$,'22023','An expiry in the past is refused');
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('f1111111-1111-4111-8111-111111111111','Field One',now()+interval '8 days')
$query$,'22023','An expiry beyond a week is refused');
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('f1111111-1111-4111-8111-111111111111','Field One',NULL)
$query$,'22023','An expiry is required');
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('99999999-9999-4999-8999-999999999999','Nobody',now()+interval '1 hour')
$query$,'P0002','An unknown account is refused');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.users WHERE role='admin') AND NOT EXISTS(SELECT 1 FROM public.user_admin_audit),
 'Refused requests leave no administrator and no record');

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(
 (SELECT r->>'role'='admin' AND r->>'invitation_status'='pending' AND (r->>'is_active')::boolean AND r->>'full_name'='Field One'
     AND (r->>'invitation_expires_at')::timestamptz>now()
   FROM public.bootstrap_first_admin('f1111111-1111-4111-8111-111111111111','  Field One ',now()+interval '1 hour') r),
 'The first administrator is invited, not yet accepted');
RESET ROLE;
SELECT pg_temp.assert_true(NOT public.is_admin('f1111111-1111-4111-8111-111111111111'),'An invited administrator has no access until setup is finished');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.user_projects WHERE user_id='f1111111-1111-4111-8111-111111111111')=(SELECT count(*) FROM public.projects)
 AND (SELECT count(*)>=3 FROM public.projects),'The first administrator belongs to every project');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.user_admin_audit WHERE action='invite' AND actor_user_id IS NULL
  AND target_user_id='f1111111-1111-4111-8111-111111111111' AND (details->>'firstAdministrator')::boolean
  AND details->'after'->>'role'='admin'),'The setup is on record as first-time setup');

-- Sent to the wrong address: running it again for the right one withdraws the first.
SET LOCAL ROLE service_role;
SELECT public.bootstrap_first_admin('f2222222-2222-4222-8222-222222222222','Field Two',now()+interval '1 hour');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT invitation_status='cancelled' AND NOT is_active FROM public.users WHERE id='f1111111-1111-4111-8111-111111111111')
 AND (SELECT count(*)=1 FROM public.users WHERE role='admin' AND invitation_status='pending' AND is_active),
 'Only one first-administrator invitation is ever outstanding');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_projects WHERE user_id='f1111111-1111-4111-8111-111111111111')
 AND (SELECT count(*) FROM public.user_projects WHERE user_id='f2222222-2222-4222-8222-222222222222')=(SELECT count(*) FROM public.projects),
 'The withdrawn invitation gives up its project access; the new one has every project');

-- An account that already finished setup is promoted as it stands, with no second invitation.
SAVEPOINT promoted;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT r->>'invitation_status'='accepted' AND r->>'role'='admin'
   FROM public.bootstrap_first_admin('01111111-1111-4111-8111-111111111111','Office One',now()+interval '1 hour') r),
 'An accepted account keeps its setup');
RESET ROLE;
SELECT pg_temp.assert_true(public.is_admin('01111111-1111-4111-8111-111111111111')
 AND (SELECT invitation_status='cancelled' FROM public.users WHERE id='f2222222-2222-4222-8222-222222222222'),
 'It administers at once and the outstanding invitation is withdrawn');
ROLLBACK TO promoted;

-- The invited administrator finishes setup; from then on the door is closed.
UPDATE auth.users SET encrypted_password='test-hash',email_confirmed_at=now() WHERE id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
SELECT public.complete_invitation();
RESET ROLE;
SELECT pg_temp.assert_true(public.is_admin('f2222222-2222-4222-8222-222222222222'),'Finishing setup makes the first administrator active');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($query$
 SELECT public.bootstrap_first_admin('a1111111-1111-4111-8111-111111111111','Second Admin',now()+interval '1 hour')
$query$,'42501','Once an administrator is active the setup function refuses for good');
-- The administrator can now invite people the normal way.
SELECT public.admin_update_user('f2222222-2222-4222-8222-222222222222','a1111111-1111-4111-8111-111111111111','{"role":"office_staff"}');
RESET ROLE;
ROLLBACK;

BEGIN;
\ir admin-fixtures.sql

SET LOCAL ROLE service_role;
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','{"role":"office_staff"}');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.users WHERE role='admin' AND is_active AND invitation_status='accepted'),
 'A second administrator may be demoted while one accepted active admin remains');
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','{"role":"field_worker"}')
$query$,'23514','Last active admin cannot demote themselves');
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','{"is_active":false}')
$query$,'23514','Last active admin cannot deactivate themselves');
SELECT pg_temp.expect_error($query$
 SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','{"invitation_status":"cancelled"}')
$query$,'23514','Cancelling the last active admin cannot bypass protection');
SELECT pg_temp.expect_error($query$
 DELETE FROM public.users WHERE id='a1111111-1111-4111-8111-111111111111'
$query$,'23514','Direct service deletion cannot remove the last active admin');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.user_admin_audit),'Failed last-admin attempts create no success audit');
RESET ROLE;

-- Pending/inactive admins cannot serve as the surviving usable administrator.
UPDATE public.users SET role='admin',invitation_status='pending' WHERE id='a2222222-2222-4222-8222-222222222222';
SELECT pg_temp.expect_error($query$
 UPDATE public.users SET is_active=false WHERE id='a1111111-1111-4111-8111-111111111111'
$query$,'23514','Pending admin does not count as an active replacement');
UPDATE public.users SET invitation_status='accepted',is_active=false WHERE id='a2222222-2222-4222-8222-222222222222';
SELECT pg_temp.expect_error($query$
 UPDATE public.users SET role='office_staff' WHERE id='a1111111-1111-4111-8111-111111111111'
$query$,'23514','Inactive admin does not count as an active replacement');

UPDATE public.users SET is_active=true WHERE id='a2222222-2222-4222-8222-222222222222';
SELECT pg_temp.expect_error($query$
 UPDATE public.users SET role='office_staff' WHERE role='admin'
$query$,'23514','One statement cannot demote both remaining administrators');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.users WHERE role='admin' AND is_active AND invitation_status='accepted'),
 'Rejected multi-row removal rolls back both administrator updates');
ROLLBACK;

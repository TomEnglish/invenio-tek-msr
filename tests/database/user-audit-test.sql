BEGIN;
\ir admin-fixtures.sql

SET LOCAL ROLE service_role;
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111',
 '{"full_name":"Office Colleague","role":"office_staff"}',ARRAY['b2222222-2222-4222-8222-222222222222']::uuid[]);
SELECT pg_temp.assert_true((SELECT action='update' AND actor_user_id='a1111111-1111-4111-8111-111111111111'
 AND target_user_id='f1111111-1111-4111-8111-111111111111'
 AND details->'before'='{"fullName":"Original Worker","role":"field_worker","isActive":true,"projectIds":["b1111111-1111-4111-8111-111111111111"],"invitationStatus":"accepted"}'::jsonb
 AND details->'after'='{"fullName":"Office Colleague","role":"office_staff","isActive":true,"projectIds":["b2222222-2222-4222-8222-222222222222"],"invitationStatus":"accepted"}'::jsonb
 FROM public.user_admin_audit ORDER BY id DESC LIMIT 1),'Audit records actual before/after profile and membership state');

SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','{"is_active":false}');
SELECT pg_temp.assert_true((SELECT action='deactivate' AND details#>>'{before,isActive}'='true' AND details#>>'{after,isActive}'='false'
 FROM public.user_admin_audit ORDER BY id DESC LIMIT 1),'Deactivation has the correct action and state transition');
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','{"is_active":true}');
SELECT pg_temp.assert_true((SELECT action='activate' AND details#>>'{before,isActive}'='false' AND details#>>'{after,isActive}'='true'
 FROM public.user_admin_audit ORDER BY id DESC LIMIT 1),'Activation has the correct action and state transition');
RESET ROLE;

UPDATE public.users SET invitation_status='pending' WHERE id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f2222222-2222-4222-8222-222222222222',
 jsonb_build_object('invitation_status','pending','invitation_expires_at',now()+interval '1 day'));
SELECT pg_temp.assert_true((SELECT action='invite' FROM public.user_admin_audit ORDER BY id DESC LIMIT 1),
 'Setting the initial invitation expiry records invite');
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f2222222-2222-4222-8222-222222222222',
 jsonb_build_object('invitation_expires_at',now()+interval '2 days'));
SELECT pg_temp.assert_true((SELECT action='resend_invite' FROM public.user_admin_audit ORDER BY id DESC LIMIT 1),
 'Renewing an existing invitation records resend_invite');
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f2222222-2222-4222-8222-222222222222',
 '{"invitation_status":"cancelled","is_active":false}',ARRAY[]::uuid[]);
SELECT pg_temp.assert_true((SELECT action='cancel_invite' AND details#>>'{before,invitationStatus}'='pending'
 AND details#>>'{after,invitationStatus}'='cancelled' AND details#>'{after,projectIds}'='[]'::jsonb
 FROM public.user_admin_audit ORDER BY id DESC LIMIT 1),'Cancelling an invitation records cancellation and access removal');
RESET ROLE;

-- A pending Auth profile can exist before delivery of its first invitation.
-- Editing that profile must not falsely claim that an invitation was issued.
UPDATE public.users SET is_active=true,invitation_status='pending',invitation_expires_at=NULL
 WHERE id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SELECT public.admin_update_user('a1111111-1111-4111-8111-111111111111','f2222222-2222-4222-8222-222222222222','{"full_name":"Corrected Pending Name"}');
SELECT pg_temp.assert_true((SELECT action='update' FROM public.user_admin_audit ORDER BY id DESC LIMIT 1),
 'A pending profile name correction does not falsely record an invitation');
RESET ROLE;
ROLLBACK;

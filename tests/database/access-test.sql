BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('11111111-1111-1111-1111-111111111111','admin@example.test'),
 ('22222222-2222-2222-2222-222222222222','field@example.test'),
 ('33333333-3333-3333-3333-333333333333','office@example.test');
UPDATE public.users SET invitation_status='accepted';
UPDATE public.users SET role='admin' WHERE email='admin@example.test';
UPDATE public.users SET role='office_staff' WHERE email='office@example.test';
INSERT INTO public.projects(id,name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Other yard');
INSERT INTO public.user_projects(user_id,project_id)
SELECT id,'00000000-0000-0000-0000-000000000000' FROM public.users;
INSERT INTO public.locations(id,zone,row,rack,project_id) VALUES
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','A','1','1','00000000-0000-0000-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
DO $$
DECLARE affected int;
BEGIN
 UPDATE public.locations SET zone='unauthorized' WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected <> 0 THEN RAISE EXCEPTION 'Field worker must not edit office-managed locations'; END IF;
END $$;
RESET ROLE;
ROLLBACK;

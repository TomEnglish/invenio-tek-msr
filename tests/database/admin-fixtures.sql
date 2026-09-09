-- Included inside each test's BEGIN/ROLLBACK; nothing survives its connection.
CREATE FUNCTION pg_temp.assert_true(condition boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF;
END $$;

CREATE FUNCTION pg_temp.expect_error(statement text, expected_state text, label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE;
 END;
 IF actual_state IS DISTINCT FROM expected_state THEN
  RAISE EXCEPTION 'Assertion failed: %; expected SQLSTATE %, received %',label,expected_state,coalesce(actual_state,'success');
 END IF;
END $$;

INSERT INTO auth.users(id,email) VALUES
 ('a1111111-1111-4111-8111-111111111111','admin-one@example.test'),
 ('a2222222-2222-4222-8222-222222222222','admin-two@example.test'),
 ('f1111111-1111-4111-8111-111111111111','field-one@example.test'),
 ('f2222222-2222-4222-8222-222222222222','field-two@example.test'),
 ('01111111-1111-4111-8111-111111111111','office-one@example.test');
UPDATE public.users SET invitation_status='accepted',full_name=CASE
 WHEN email='field-one@example.test' THEN 'Original Worker' ELSE split_part(email,'@',1) END;
UPDATE public.users SET role='admin' WHERE email LIKE 'admin-%';
UPDATE public.users SET role='office_staff' WHERE email='office-one@example.test';
INSERT INTO public.projects(id,name) VALUES
 ('b1111111-1111-4111-8111-111111111111','Test Yard One'),
 ('b2222222-2222-4222-8222-222222222222','Test Yard Two');
INSERT INTO public.user_projects(user_id,project_id)
 SELECT id,'b1111111-1111-4111-8111-111111111111' FROM public.users;

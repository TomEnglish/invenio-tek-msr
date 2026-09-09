BEGIN;
\ir admin-fixtures.sql

INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','OPS','1','1'),
 ('c2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','OPS','2','1'),
 ('c3333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222','OTHER','1','1');
INSERT INTO public.qr_codes(id,project_id,code_value,entity_type) VALUES
 ('d3333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222','OTHER-PROJECT-QR','item');
INSERT INTO public.receiving_records(id,project_id,qr_code_id,material_type,qty,created_by) VALUES
 ('e3333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222',
 'd3333333-3333-4333-8333-333333333333','Other Steel',10,'f2222222-2222-4222-8222-222222222222');
INSERT INTO public.materials(id,project_id,receiving_record_id,qr_code_id,material_type,qty,current_quantity) VALUES
 ('e4444444-4444-4444-8444-444444444444','b2222222-2222-4222-8222-222222222222',
 'e3333333-3333-4333-8333-333333333333','d3333333-3333-4333-8333-333333333333','Other Steel',10,10);

CREATE FUNCTION pg_temp.receiving_payload(qr text, status text DEFAULT 'accepted', quantity numeric DEFAULT 10, accepted numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('qrCodeValue',qr,'material',jsonb_build_object('material_type','Steel','qty',quantity),
 'po','{}'::jsonb,'inspection',jsonb_build_object('condition','good','inspection_pass',true),
 'location',jsonb_build_object('location_id','c1111111-1111-4111-8111-111111111111'),
 'decision',jsonb_build_object('status',status,'has_exception',false,'accepted_qty',accepted));
$$;
CREATE TEMP TABLE operation_results(name text PRIMARY KEY,result jsonb);
GRANT ALL ON operation_results TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
INSERT INTO operation_results VALUES('receipt',public.apply_field_operation(
 '10000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-ACCEPTED')));
SELECT pg_temp.assert_true((SELECT r.status='accepted' AND r.qty=10 AND r.created_by=auth.uid()
 FROM public.receiving_records r WHERE r.id=(SELECT (result->>'id')::uuid FROM operation_results WHERE name='receipt')),
 'Accepted receiving creates a receipt attributed to authenticated caller');
SELECT pg_temp.assert_true((SELECT m.qty=10 AND m.current_quantity=10 AND m.project_id='b1111111-1111-4111-8111-111111111111'
 FROM public.materials m WHERE m.id=(SELECT (result->>'material_id')::uuid FROM operation_results WHERE name='receipt')),
 'Accepted receiving returns the committed material with full quantity');

DO $$ DECLARE first_result jsonb; replay jsonb; receipts_before bigint; materials_before bigint; audits_before bigint;
BEGIN
 SELECT result INTO first_result FROM operation_results WHERE name='receipt';
 SELECT count(*) INTO receipts_before FROM public.receiving_records;
 SELECT count(*) INTO materials_before FROM public.materials;
 SELECT count(*) INTO audits_before FROM public.audit_log;
 PERFORM pg_temp.assert_true(audits_before>0,'Receiving writes an audit record');
 replay:=public.apply_field_operation('10000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-ACCEPTED'));
 PERFORM pg_temp.assert_true(replay=first_result,'Identical replay returns the original result');
 PERFORM pg_temp.assert_true((SELECT count(*)=receipts_before FROM public.receiving_records),'Replay creates no second receipt');
 PERFORM pg_temp.assert_true((SELECT count(*)=materials_before FROM public.materials),'Replay creates no second material');
 PERFORM pg_temp.assert_true((SELECT count(*)=audits_before FROM public.audit_log),'Replay creates no second audit');
END $$;
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation('10000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-CHANGED'))
$query$,'23505','Reusing an operation ID with changed input is a conflict');
SELECT set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation('10000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-ACCEPTED'))
$query$,'23505','Another authorized actor cannot claim an existing operation ID');
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);

INSERT INTO operation_results VALUES('partial',public.apply_field_operation(
 '10000000-0000-4000-8000-000000000002','b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-PARTIAL','partially_accepted',10,4)));
SELECT pg_temp.assert_true((SELECT qty=4 AND current_quantity=4 FROM public.materials
 WHERE id=(SELECT (result->>'material_id')::uuid FROM operation_results WHERE name='partial')),
 'Partial receiving adds only the accepted quantity to inventory');
SELECT pg_temp.assert_true((SELECT qty=10 AND status='partially_accepted' FROM public.receiving_records
 WHERE id=(SELECT (result->>'id')::uuid FROM operation_results WHERE name='partial')),
 'Partial receipt preserves the originally received quantity');
INSERT INTO operation_results VALUES('rejected',public.apply_field_operation(
 '10000000-0000-4000-8000-000000000003','b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-REJECTED','rejected')));
SELECT pg_temp.assert_true((SELECT status='rejected' FROM public.receiving_records
 WHERE id=(SELECT (result->>'id')::uuid FROM operation_results WHERE name='rejected')),'Rejected receiving still records the inspection');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.materials
 WHERE receiving_record_id=(SELECT (result->>'id')::uuid FROM operation_results WHERE name='rejected')),'Rejected receiving adds no inventory');

DO $$ DECLARE bad_quantity numeric;
BEGIN
 FOREACH bad_quantity IN ARRAY ARRAY[0,-1,0.5,2147483648]::numeric[] LOOP
  PERFORM pg_temp.expect_error(format($query$SELECT public.apply_field_operation(gen_random_uuid(),
   'b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-BAD-QTY','accepted',%s))$query$,bad_quantity),
   '22023','Receiving rejects invalid positive integer quantity '||bad_quantity);
 END LOOP;
 FOREACH bad_quantity IN ARRAY ARRAY[0,-1,10,11,0.5]::numeric[] LOOP
  PERFORM pg_temp.expect_error(format($query$SELECT public.apply_field_operation(gen_random_uuid(),
   'b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-BAD-PARTIAL','partially_accepted',10,%s))$query$,bad_quantity),
   '22023','Partial receiving rejects accepted quantity '||bad_quantity);
 END LOOP;
END $$;
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation(gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-MISSING-PARTIAL','partially_accepted'))$query$,
 '22023','Partial receiving requires an accepted quantity');
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation(gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','unknown_action','{}')$query$,'22023','Unknown operations are rejected');
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation(gen_random_uuid(),
 'b2222222-2222-4222-8222-222222222222','receiving',pg_temp.receiving_payload('OPS-UNASSIGNED'))$query$,'42501','Unassigned project operation is denied');
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation(gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OTHER-PROJECT-QR'))$query$,'42501','Another project QR cannot be relinked');
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation(gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','receiving',jsonb_set(pg_temp.receiving_payload('OPS-BAD-LOCATION'),
 '{location,location_id}','"c3333333-3333-4333-8333-333333333333"'))$query$,'42501','Receiving rejects another project location');
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation(gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','issue','{"materialId":"e4444444-4444-4444-8444-444444444444","jobNumber":"JOB","quantity":1}')$query$,
 '42501','Issue rejects another project material');

DO $$ DECLARE material uuid; result jsonb; replay jsonb; payload jsonb; bad_quantity numeric; action_name text;
BEGIN
 SELECT (r.result->>'material_id')::uuid INTO material FROM operation_results r WHERE name='receipt';
 payload:=jsonb_build_object('materialId',material,'fromLocationId','c1111111-1111-4111-8111-111111111111',
  'toLocationId','c2222222-2222-4222-8222-222222222222','reason','Clear receiving bay');
 result:=public.apply_field_operation('10000000-0000-4000-8000-000000000004','b1111111-1111-4111-8111-111111111111','transfer',payload);
 replay:=public.apply_field_operation('10000000-0000-4000-8000-000000000004','b1111111-1111-4111-8111-111111111111','transfer',payload);
 PERFORM pg_temp.assert_true(result=replay,'Transfer replay returns original movement');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.material_movements WHERE material_id=material),'Transfer replay creates one movement');
 PERFORM pg_temp.assert_true((SELECT location_id='c2222222-2222-4222-8222-222222222222' FROM public.materials WHERE id=material),'Transfer changes material location');
 PERFORM pg_temp.expect_error(format($query$SELECT public.apply_field_operation(gen_random_uuid(),
  'b1111111-1111-4111-8111-111111111111','transfer',%L::jsonb)$query$,
  jsonb_set(payload,'{toLocationId}','"c3333333-3333-4333-8333-333333333333"')),'42501','Transfer rejects another project destination');

 FOREACH action_name IN ARRAY ARRAY['issue','shipment'] LOOP
  FOREACH bad_quantity IN ARRAY ARRAY[0,-1,0.5,11,2147483648]::numeric[] LOOP
   payload:=jsonb_build_object('materialId',material,'jobNumber','JOB','destination','Site','quantity',bad_quantity);
   PERFORM pg_temp.expect_error(format($query$SELECT public.apply_field_operation(gen_random_uuid(),
    'b1111111-1111-4111-8111-111111111111',%L,%L::jsonb)$query$,action_name,payload),
    '22023',action_name||' rejects invalid or unavailable quantity '||bad_quantity);
  END LOOP;
 END LOOP;

 payload:=jsonb_build_object('materialId',material,'jobNumber','JOB','quantity',3);
 result:=public.apply_field_operation('10000000-0000-4000-8000-000000000005','b1111111-1111-4111-8111-111111111111','issue',payload);
 replay:=public.apply_field_operation('10000000-0000-4000-8000-000000000005','b1111111-1111-4111-8111-111111111111','issue',payload);
 PERFORM pg_temp.assert_true(result=replay AND (result->>'current_quantity')::integer=7,'Issue replay returns original result with quantity 7');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.material_issues WHERE material_id=material),'Issue replay records one issue');
 PERFORM pg_temp.assert_true((SELECT current_quantity=7 FROM public.materials WHERE id=material),'Issue deducts quantity exactly once');

 payload:=jsonb_build_object('materialId',material,'destination','Site','quantity',7);
 result:=public.apply_field_operation('10000000-0000-4000-8000-000000000006','b1111111-1111-4111-8111-111111111111','shipment',payload);
 replay:=public.apply_field_operation('10000000-0000-4000-8000-000000000006','b1111111-1111-4111-8111-111111111111','shipment',payload);
 PERFORM pg_temp.assert_true(result=replay AND (result->>'current_quantity')::integer=0,'Shipment replay returns original exhausted quantity');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.shipments_out WHERE material_id=material),'Shipment replay records one shipment');
 PERFORM pg_temp.assert_true((SELECT current_quantity=0 FROM public.materials WHERE id=material),'Shipment deducts remaining quantity exactly once');
 PERFORM pg_temp.expect_error(format($query$SELECT public.apply_field_operation(gen_random_uuid(),
  'b1111111-1111-4111-8111-111111111111','issue',%L::jsonb)$query$,
  jsonb_build_object('materialId',material,'jobNumber','JOB','quantity',1)),'22023','Depleted inventory cannot be issued');
END $$;
RESET ROLE;

-- Inject the final audit write failure. Retrying the SAME operation after
-- removing the trigger proves that its idempotency claim also rolled back.
CREATE FUNCTION pg_temp.fail_operation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Injected operation audit failure' USING ERRCODE='P0902'; END $$;
CREATE TRIGGER test_operation_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_operation_audit();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation('10000000-0000-4000-8000-000000000007',
 'b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-ROLLBACK'))$query$,'P0902','Audit failure aborts receiving');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.qr_codes WHERE code_value='OPS-ROLLBACK'),'Audit failure rolls back the newly created QR');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.receiving_records),'Audit failure creates no extra receipt');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.materials),'Audit failure creates no extra material');
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation('10000000-0000-4000-8000-000000000008',
 'b1111111-1111-4111-8111-111111111111','issue',jsonb_build_object('materialId',
 (SELECT result->>'material_id' FROM operation_results WHERE name='partial'),'jobNumber','ROLLBACK','quantity',1))$query$,
 'P0902','Audit failure aborts material issue');
SELECT pg_temp.assert_true((SELECT current_quantity=4 FROM public.materials
 WHERE id=(SELECT (result->>'material_id')::uuid FROM operation_results WHERE name='partial')),'Audit failure restores deducted quantity');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.material_issues WHERE job_number='ROLLBACK'),'Audit failure removes the issue event');
RESET ROLE;
DROP TRIGGER test_operation_audit_failure ON public.audit_log;
SET LOCAL ROLE authenticated;
SELECT public.apply_field_operation('10000000-0000-4000-8000-000000000007','b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-ROLLBACK'));
SELECT public.apply_field_operation('10000000-0000-4000-8000-000000000008','b1111111-1111-4111-8111-111111111111','issue',jsonb_build_object('materialId',
 (SELECT result->>'material_id' FROM operation_results WHERE name='partial'),'jobNumber','ROLLBACK','quantity',1));
SELECT pg_temp.assert_true((SELECT current_quantity=3 FROM public.materials
 WHERE id=(SELECT (result->>'material_id')::uuid FROM operation_results WHERE name='partial')),'Same operation succeeds once after failed transaction rollback');
RESET ROLE;

UPDATE public.users SET is_active=false WHERE id='f1111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($query$SELECT public.apply_field_operation(gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','receiving',pg_temp.receiving_payload('OPS-INACTIVE'))$query$,'42501','Inactive user cannot operate with an existing JWT');
RESET ROLE;
ROLLBACK;

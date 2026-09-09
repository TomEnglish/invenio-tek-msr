BEGIN;
\ir admin-fixtures.sql
INSERT INTO public.locations(id,zone,row,rack,project_id) VALUES ('d1111111-1111-4111-8111-111111111111','A','1','1','b1111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT public.apply_field_operation('e1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','receiving',
'{"qrCodeValue":"EXCEPTION-TEST","material":{"material_type":"Pipe","qty":10},"po":{},"inspection":{"condition":"damaged","inspection_pass":false},"location":{"location_id":"d1111111-1111-4111-8111-111111111111"},"decision":{"status":"accepted","has_exception":true,"exception_type":"damage"}}');
DO $$ DECLARE r uuid; m uuid; BEGIN
 SELECT id INTO r FROM public.receiving_records WHERE material_type='Pipe';
 SELECT id INTO m FROM public.materials WHERE receiving_record_id=r;
 PERFORM pg_temp.expect_error(format('select public.apply_field_operation(gen_random_uuid(),%L,''exception'',%L)', 'b1111111-1111-4111-8111-111111111111',jsonb_build_object('id',r,'resolution','hold')), '42501','Field worker cannot resolve exceptions');
 PERFORM pg_temp.expect_error(format('select public.apply_field_operation(gen_random_uuid(),%L,''correct_material'',%L)', 'b1111111-1111-4111-8111-111111111111',jsonb_build_object('materialId',m,'reason','Fix spec','changes',jsonb_build_object('spec','A105'))), '42501','Field worker cannot correct material');
 PERFORM set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
 PERFORM public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','exception',jsonb_build_object('id',r,'resolution','hold','ownerId','01111111-1111-4111-8111-111111111111','dueDate','2026-09-10'));
 PERFORM pg_temp.assert_true((SELECT NOT exception_resolved AND exception_due_date='2026-09-10' FROM public.receiving_records WHERE id=r),'Hold retains open status and owner due date');
 PERFORM pg_temp.expect_error(format('select public.apply_field_operation(gen_random_uuid(),%L,''exception'',%L)', 'b1111111-1111-4111-8111-111111111111',jsonb_build_object('id',r,'resolution','hold','ownerId','f1111111-1111-4111-8111-111111111111')), '42501','Owner must be office staff');
 PERFORM public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','exception',jsonb_build_object('id',r,'resolution','released'));
 PERFORM pg_temp.assert_true((SELECT exception_resolved FROM public.receiving_records WHERE id=r),'Release closes exception');
 PERFORM set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
 PERFORM pg_temp.expect_error(format('select public.apply_field_operation(gen_random_uuid(),%L,''correct_material'',%L)', 'b1111111-1111-4111-8111-111111111111',jsonb_build_object('materialId',m,'reason','Fix count','changes',jsonb_build_object('current_quantity',100))), '22023','Correction cannot silently overwrite quantity');
 PERFORM public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','correct_material',jsonb_build_object('materialId',m,'reason','Correct vendor spec','changes',jsonb_build_object('spec','A105')));
 PERFORM pg_temp.assert_true((SELECT spec='A105' AND current_quantity=10 FROM public.materials WHERE id=m),'Descriptive correction preserves quantity');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.audit_log WHERE action='material_corrected' AND details->>'reason'='Correct vendor spec'),'Correction reason audited');
END $$;
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
INSERT INTO public.material_links(project_id,po_id,material_status) VALUES ('b1111111-1111-4111-8111-111111111111','PO-TEST','ordered');
UPDATE public.material_links SET material_status='shipped' WHERE po_id='PO-TEST';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.material_status_history WHERE new_status='shipped' AND changed_by='01111111-1111-4111-8111-111111111111'),'Office status update atomically writes protected history');
ROLLBACK;

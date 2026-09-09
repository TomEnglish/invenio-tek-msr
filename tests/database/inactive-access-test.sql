BEGIN;
\ir admin-fixtures.sql

INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','TEST','1','1');
INSERT INTO public.qr_codes(id,project_id,code_value,entity_type) VALUES
 ('d1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','TEST-QR-ONE','item');
INSERT INTO public.receiving_records(id,project_id,qr_code_id,material_type,qty,created_by,location_id,has_exception,exception_type) VALUES
 ('e1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
 'd1111111-1111-4111-8111-111111111111','Steel',10,'f1111111-1111-4111-8111-111111111111',
 'c1111111-1111-4111-8111-111111111111',true,'damage');
INSERT INTO public.materials(id,project_id,receiving_record_id,qr_code_id,material_type,qty,current_quantity,location_id) VALUES
 ('e2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111',
 'e1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','Steel',10,10,
 'c1111111-1111-4111-8111-111111111111');
INSERT INTO public.inspection_photos(receiving_record_id,storage_path,photo_type) VALUES
 ('e1111111-1111-4111-8111-111111111111','e1111111-1111-4111-8111-111111111111/test.jpg','damage');
INSERT INTO public.audit_log(user_id,action,entity_type,entity_id,project_id) VALUES
 ('f1111111-1111-4111-8111-111111111111','receiving_created','receiving_record',
 'e1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111');
INSERT INTO public.purchase_orders(purchase_order_id,item_last_change_date_time,project_id) VALUES
 ('TEST-PO',now(),'b1111111-1111-4111-8111-111111111111');
INSERT INTO public.shipments(shipment_number,project_id) VALUES('TEST-SHIP','b1111111-1111-4111-8111-111111111111');
INSERT INTO public.shop_contacts(shop_name) VALUES('Test Shared Shop');
INSERT INTO storage.buckets(id,name,public) VALUES('inspection-photos','inspection-photos',false) ON CONFLICT(id) DO NOTHING;
INSERT INTO storage.objects(bucket_id,name) VALUES('inspection-photos','e1111111-1111-4111-8111-111111111111/test.jpg');
-- A deployed bucket may retain a permissive legacy policy. Hardening must still
-- deny inactive/anonymous readers and writers when policies combine with OR.
CREATE POLICY test_legacy_storage_allow ON storage.objects FOR ALL TO authenticated,anon USING(true) WITH CHECK(true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE relation text; visible bigint;
BEGIN
 FOREACH relation IN ARRAY ARRAY[
 'projects','user_projects','locations','qr_codes','receiving_records','materials','inspection_photos','audit_log','shop_contacts',
 'v_inventory_summary','v_aging_report','v_exception_summary','v_yard_overview','vw_po_summary','vw_shipment_summary','vw_recent_activity'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',relation) INTO visible;
  PERFORM pg_temp.assert_true(visible>0,'Active assigned worker has a visible fixture in '||relation);
 END LOOP;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='inspection-photos'),
 'Active receipt owner can read the stored photo');
RESET ROLE;

-- Keep the same JWT subject and memberships. The database must revoke access
-- immediately, without requiring a logout or a fresh access token.
UPDATE public.users SET is_active=false WHERE id='f1111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
DO $$ DECLARE relation text; visible bigint; changed integer;
BEGIN
 FOREACH relation IN ARRAY ARRAY[
 'projects','user_projects','locations','qr_codes','receiving_records','materials','inspection_photos','audit_log','shop_contacts',
 'v_inventory_summary','v_aging_report','v_exception_summary','v_yard_overview','vw_po_summary','vw_shipment_summary','vw_recent_activity'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',relation) INTO visible;
  PERFORM pg_temp.assert_true(visible=0,'Inactive worker cannot read '||relation);
 END LOOP;
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.users WHERE id<>'f1111111-1111-4111-8111-111111111111'),
  'Inactive worker cannot read colleagues through shared projects');
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='inspection-photos'),
  'Inactive owner cannot read stored photos despite permissive legacy policy');
 UPDATE storage.objects SET name='e1111111-1111-4111-8111-111111111111/renamed.jpg' WHERE bucket_id='inspection-photos';
 GET DIAGNOSTICS changed=ROW_COUNT;
 PERFORM pg_temp.assert_true(changed=0,'Inactive user cannot overwrite stored photos');
 DELETE FROM storage.objects WHERE bucket_id='inspection-photos';
 GET DIAGNOSTICS changed=ROW_COUNT;
 PERFORM pg_temp.assert_true(changed=0,'Inactive user cannot delete stored photos');
END $$;
SELECT pg_temp.expect_error($query$
 INSERT INTO storage.objects(bucket_id,name) VALUES('inspection-photos','e1111111-1111-4111-8111-111111111111/new.jpg')
$query$,'42501','Inactive user cannot upload photos');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.inspection_photos(receiving_record_id,storage_path,photo_type)
 VALUES('e1111111-1111-4111-8111-111111111111','e1111111-1111-4111-8111-111111111111/new.jpg','general')
$query$,'42501','Inactive user cannot attach photo metadata');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='inspection-photos'),
 'Anonymous caller cannot use a permissive legacy policy to read photos');
SELECT pg_temp.expect_error($query$
 INSERT INTO storage.objects(bucket_id,name) VALUES('inspection-photos','e1111111-1111-4111-8111-111111111111/anon.jpg')
$query$,'42501','Anonymous caller cannot upload inspection photos');
RESET ROLE;
ROLLBACK;

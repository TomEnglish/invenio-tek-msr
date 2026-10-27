BEGIN;
\ir admin-fixtures.sql

-- Project one: a location, a two-level category tree, a site map with a zone.
INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','OPS','1','1');
INSERT INTO public.inventory_categories(id,project_id,parent_id,name) VALUES
 ('7a111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,'Generator 1'),
 ('7a222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','7a111111-1111-4111-8111-111111111111','Oil System');
INSERT INTO public.site_maps(id,project_id,name) VALUES
 ('5a111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Yard plan');
INSERT INTO public.site_map_zones(id,map_id,project_id,name,shape) VALUES
 ('2a111111-1111-4111-8111-111111111111','5a111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Zone A',
  '[[0,0],[0.5,0],[0.5,0.5],[0,0.5]]');
-- Project two: objects a project-one worker must never be able to reference.
INSERT INTO public.inventory_categories(id,project_id,name) VALUES
 ('7a333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222','Other project');
INSERT INTO public.site_maps(id,project_id,name) VALUES
 ('5a222222-2222-4222-8222-222222222222','b2222222-2222-4222-8222-222222222222','Other plan');
INSERT INTO public.site_map_zones(id,map_id,project_id,name,shape) VALUES
 ('2a222222-2222-4222-8222-222222222222','5a222222-2222-4222-8222-222222222222','b2222222-2222-4222-8222-222222222222','Other zone',
  '[[0,0],[1,0],[1,1]]');

SELECT pg_temp.expect_error($query$
 INSERT INTO public.inventory_categories(project_id,parent_id,name)
 VALUES('b2222222-2222-4222-8222-222222222222','7a111111-1111-4111-8111-111111111111','Cross-project child')
$query$,'42501','A category parent must be in the same project');
SELECT pg_temp.expect_error($query$
 UPDATE public.inventory_categories SET parent_id='7a222222-2222-4222-8222-222222222222' WHERE id='7a111111-1111-4111-8111-111111111111'
$query$,'22023','The category tree cannot loop');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.site_map_zones(map_id,project_id,name,shape)
 VALUES('5a111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Bad','[[0,0],[2,0],[0,1]]')
$query$,'23514','Zone points must be inside the map');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.site_map_zones(map_id,project_id,name,shape)
 VALUES('5a111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Bad','[["a",0],[1,0],[0,1]]')
$query$,'23514','Zone points must be numbers');
SELECT pg_temp.expect_error($query$
 UPDATE public.site_maps SET storage_path='b2222222-2222-4222-8222-222222222222/5a111111-1111-4111-8111-111111111111.png'
 WHERE id='5a111111-1111-4111-8111-111111111111'
$query$,'23514','A site plan path must use its own project and map');

CREATE FUNCTION pg_temp.count_payload(tag text,extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('tag',tag,'name','Control valve','quantity','2','uom','EA','condition','good',
  'categoryId','7a222222-2222-4222-8222-222222222222','siteMapId','5a111111-1111-4111-8111-111111111111',
  'zoneId','2a111111-1111-4111-8111-111111111111','pin',jsonb_build_object('x',0.25,'y',0.25))||extra;
$$;
CREATE TEMP TABLE results(name text PRIMARY KEY,result jsonb);
GRANT ALL ON results TO authenticated;

-- ---- Field counts -------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
INSERT INTO results VALUES('first',public.apply_field_operation(
 '20000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','count',pg_temp.count_payload('GEN1-CV-101')));
SELECT pg_temp.assert_true((SELECT i.count_status='counted' AND i.source='field' AND i.quantity=2 AND i.counted_by=auth.uid()
 AND i.category_id='7a222222-2222-4222-8222-222222222222' AND i.zone_id='2a111111-1111-4111-8111-111111111111'
 AND i.pin_x=0.25 AND i.location='Zone A' AND i.uid=(SELECT (result->>'uid')::uuid FROM results WHERE name='first')
 FROM public.inventory_records i WHERE i.qr_code='GEN1-CV-101'),'A count creates a counted item with its category, zone and pin');
SELECT pg_temp.assert_true((SELECT (result->>'created')::boolean FROM results WHERE name='first'),'The first count reports a new item');

DO $$ DECLARE first_result jsonb; replay jsonb; items_before bigint; audits_before bigint;
BEGIN
 SELECT result INTO first_result FROM results WHERE name='first';
 SELECT count(*) INTO items_before FROM public.inventory_records;
 SELECT count(*) INTO audits_before FROM public.audit_log WHERE action='inventory_counted';
 PERFORM pg_temp.assert_true(audits_before=1,'A count writes one audit record');
 replay:=public.apply_field_operation('20000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','count',pg_temp.count_payload('GEN1-CV-101'));
 PERFORM pg_temp.assert_true(replay=first_result,'Replaying a count returns the original result');
 PERFORM pg_temp.assert_true((SELECT count(*)=items_before FROM public.inventory_records),'Replay creates no second item');
 PERFORM pg_temp.assert_true((SELECT count(*)=audits_before FROM public.audit_log WHERE action='inventory_counted'),'Replay creates no second audit');
END $$;
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation('20000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('GEN1-CV-101','{"quantity":"3"}'))
$query$,'23505','Reusing a count operation ID with changed input is a conflict');

INSERT INTO results VALUES('recount',public.apply_field_operation(
 '20000000-0000-4000-8000-000000000002','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload(' GEN1-CV-101 ','{"quantity":"5","pin":null,"zoneId":null}')));
SELECT pg_temp.assert_true((SELECT NOT (result->>'created')::boolean FROM results WHERE name='recount'),'A recount updates rather than creates');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(quantity)=5 AND bool_and(pin_x IS NULL) FROM public.inventory_records
 WHERE btrim(qr_code)='GEN1-CV-101'),'A recount of the same tag (spaces trimmed) replaces quantity and pin');

SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-1','{"categoryId":"7a333333-3333-4333-8333-333333333333"}'))
$query$,'42501','A category from another project is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-2','{"zoneId":"2a222222-2222-4222-8222-222222222222"}'))
$query$,'42501','A zone from another project is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-3','{"siteMapId":"5a222222-2222-4222-8222-222222222222","zoneId":null}'))
$query$,'42501','A map from another project is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-4','{"siteMapId":null,"zoneId":null}'))
$query$,'22023','A pin without a map is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-5','{"pin":{"x":1.5,"y":0.2}}'))
$query$,'22023','A pin off the map is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-6','{"pin":{"x":0.2}}'))
$query$,'22023','A pin without both coordinates is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-7','{"quantity":"0"}'))
$query$,'22023','A zero quantity is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-8','{"quantity":"two"}'))
$query$,'22023','A non-numeric quantity is rejected');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('X-9','{"proposedCategory":{"name":"Pumps"}}'))
$query$,'22023','A count cannot both choose and propose a category');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('','{}'))
$query$,'22023','A count needs a tag');

-- Field proposals: a new category is 'proposed', a repeat proposal reuses it.
INSERT INTO results VALUES('proposal',public.apply_field_operation(
 '20000000-0000-4000-8000-000000000003','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload('GEN1-PV-201','{"categoryId":null,"proposedCategory":{"parentId":"7a222222-2222-4222-8222-222222222222","name":"Pressure Valve"}}')));
INSERT INTO results VALUES('proposal_again',public.apply_field_operation(
 '20000000-0000-4000-8000-000000000004','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload('GEN1-PV-202','{"categoryId":null,"proposedCategory":{"parentId":"7a222222-2222-4222-8222-222222222222","name":"pressure valve"}}')));
SELECT pg_temp.assert_true((SELECT c.status='proposed' AND c.proposed_by=auth.uid() AND c.parent_id='7a222222-2222-4222-8222-222222222222'
 FROM public.inventory_categories c WHERE c.id=(SELECT (result->>'category_id')::uuid FROM results WHERE name='proposal')),
 'A field proposal creates a proposed category under the chosen parent');
SELECT pg_temp.assert_true((SELECT (a.result->>'category_id')=(b.result->>'category_id') FROM results a,results b
 WHERE a.name='proposal' AND b.name='proposal_again'),'A repeat proposal with the same name reuses the category');

-- Field users only write through the operation; direct writes are blocked.
SELECT pg_temp.expect_error($query$
 INSERT INTO public.inventory_categories(project_id,name) VALUES('b1111111-1111-4111-8111-111111111111','Field typed')
$query$,'42501','Field users cannot create categories directly');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.inventory_records(project_id,qr_code,inventory_item) VALUES('b1111111-1111-4111-8111-111111111111','DIRECT-1','Direct')
$query$,'42501','Field users cannot create inventory records directly');
DO $$ DECLARE changed bigint;
BEGIN
 UPDATE public.inventory_records SET quantity=99 WHERE qr_code='GEN1-CV-101';
 GET DIAGNOSTICS changed=ROW_COUNT;
 PERFORM pg_temp.assert_true(changed=0,'Field users cannot edit inventory records directly');
END $$;
SELECT pg_temp.expect_error($query$
 SELECT public.import_inventory_items('b1111111-1111-4111-8111-111111111111','[{"tag":"A"}]'::jsonb,true)
$query$,'42501','Field users cannot import');

-- Photos and storage paths.
SELECT pg_temp.assert_true(public.can_access_inventory_photo_path((SELECT result->>'uid' FROM results WHERE name='first')||'/op-1.jpg',true),
 'A project worker may upload a photo for a counted item');
SELECT pg_temp.assert_true(NOT public.can_access_inventory_photo_path('not-a-uuid/op-1.jpg',false),'A malformed photo path is refused');
SELECT pg_temp.expect_error(format($query$
 SELECT public.attach_inventory_photo(%L,'wrong-prefix/op-1.jpg')
$query$,(SELECT result->>'uid' FROM results WHERE name='first')),'42501','A photo path must start with the item uid');
SELECT public.attach_inventory_photo((SELECT (result->>'uid')::uuid FROM results WHERE name='first'),
 (SELECT result->>'uid' FROM results WHERE name='first')||'/op-1.jpg');
SELECT public.attach_inventory_photo((SELECT (result->>'uid')::uuid FROM results WHERE name='first'),
 (SELECT result->>'uid' FROM results WHERE name='first')||'/op-1.jpg');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.inventory_photos),'Re-attaching the same photo is idempotent');
SELECT pg_temp.assert_true(public.can_access_site_plan_path('b1111111-1111-4111-8111-111111111111/5a111111-1111-4111-8111-111111111111.png',false),
 'Project members can read their site plan');
SELECT pg_temp.assert_true(NOT public.can_access_site_plan_path('b1111111-1111-4111-8111-111111111111/5a111111-1111-4111-8111-111111111111.png',true),
 'Field users cannot replace a site plan');
SELECT pg_temp.assert_true(NOT public.can_access_site_plan_path('b2222222-2222-4222-8222-222222222222/5a222222-2222-4222-8222-222222222222.png',false),
 'Members cannot read another project''s site plan');

-- ---- Office import of early data ---------------------------------------
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.assert_true(public.can_access_site_plan_path('b1111111-1111-4111-8111-111111111111/5a111111-1111-4111-8111-111111111111.png',true),
 'Office users can upload a site plan');
INSERT INTO results VALUES('dry',public.import_inventory_items('b1111111-1111-4111-8111-111111111111',$json$[
 {"tag":"GT2-LO-001","description":"Lube oil cooler","category_path":"Gas Turbine 2 > Lube Oil > Cooler","part_number":"P-123","quantity":"1"},
 {"tag":"GT2-LO-002","description":"Lube oil pump","category_path":"Gas Turbine 2 > Lube Oil > Pump","quantity":"2","uom":"EA"},
 {"tag":"GEN1-CV-101","description":"Already counted","category_path":"Generator 1 > Oil System"}
]$json$::jsonb,true));
SELECT pg_temp.assert_true((SELECT (result->>'applied')::boolean=false AND (result->>'created')::int=2 AND (result->>'skipped')::int=1
 AND (result->>'new_categories')::int=4 FROM results WHERE name='dry'),'A dry run reports two new items, one skip and four new categories');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.inventory_records WHERE qr_code LIKE 'GT2-%')
 AND (SELECT count(*)=0 FROM public.inventory_categories WHERE name='Gas Turbine 2'),'A dry run writes nothing');
INSERT INTO results VALUES('apply',public.import_inventory_items('b1111111-1111-4111-8111-111111111111',$json$[
 {"tag":"GT2-LO-001","description":"Lube oil cooler","category_path":"Gas Turbine 2 > Lube Oil > Cooler","part_number":"P-123","quantity":"1"},
 {"tag":"GT2-LO-002","description":"Lube oil pump","category_path":"Gas Turbine 2 > Lube Oil > Pump","quantity":"2","uom":"EA"},
 {"tag":"GEN1-CV-101","description":"Already counted","category_path":"Generator 1 > Oil System"}
]$json$::jsonb,false));
SELECT pg_temp.assert_true((SELECT i.count_status='expected' AND i.source='import' AND i.part_number='P-123' AND c.name='Cooler'
 AND p.name='Lube Oil' FROM public.inventory_records i JOIN public.inventory_categories c ON c.id=i.category_id
 JOIN public.inventory_categories p ON p.id=c.parent_id WHERE i.qr_code='GT2-LO-001'),'Import creates expected items under their category path');
SELECT pg_temp.assert_true((SELECT inventory_item='Control valve' AND quantity=5 FROM public.inventory_records WHERE qr_code='GEN1-CV-101'),
 'Import never overwrites a counted item');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.inventory_categories WHERE name='Gas Turbine 2'),'Shared category paths are created once');
INSERT INTO results VALUES('dupes',public.import_inventory_items('b1111111-1111-4111-8111-111111111111',
 '[{"tag":"DUP-1"},{"tag":"DUP-1"},{"tag":"BAD-Q","quantity":"-1"}]'::jsonb,false));
SELECT pg_temp.assert_true((SELECT (result->>'applied')::boolean=false AND jsonb_array_length(result->'errors')=2 FROM results WHERE name='dupes')
 AND (SELECT count(*)=0 FROM public.inventory_records WHERE qr_code IN ('DUP-1','BAD-Q')),'Any invalid row stops the whole import');
SELECT pg_temp.expect_error($query$
 SELECT public.import_inventory_items('b2222222-2222-4222-8222-222222222222','[{"tag":"A"}]'::jsonb,true)
$query$,'42501','Office users cannot import into a project they are not assigned to');

-- ---- Counting an expected tag, then receiving it --------------------------
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
INSERT INTO results VALUES('found',public.apply_field_operation(
 '20000000-0000-4000-8000-000000000005','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload('GT2-LO-001','{"name":"Lube oil cooler","categoryId":null,"quantity":"1"}')));
SELECT pg_temp.assert_true((SELECT count_status='counted' AND source='import' AND part_number='P-123' AND category_id IS NOT NULL
 AND NOT (SELECT (result->>'created')::boolean FROM results WHERE name='found')
 FROM public.inventory_records WHERE qr_code='GT2-LO-001'),'Counting an expected tag keeps its imported part number and category');
INSERT INTO results VALUES('receipt',public.apply_field_operation(
 '20000000-0000-4000-8000-000000000006','b1111111-1111-4111-8111-111111111111','receiving',
 jsonb_build_object('qrCodeValue','GT2-LO-001','material',jsonb_build_object('material_type','Other','qty',1,'description','Lube oil cooler'),
  'po','{}'::jsonb,'inspection',jsonb_build_object('condition','good','inspection_pass',true),
  'location',jsonb_build_object('location_id','c1111111-1111-4111-8111-111111111111'),
  'decision',jsonb_build_object('status','accepted','has_exception',false))));
SELECT pg_temp.assert_true((SELECT i.count_status='received' AND i.receiving_record_id=(r.result->>'id')::uuid AND i.uid=(r.result->>'inventory_uid')::uuid
 FROM public.inventory_records i, results r WHERE i.qr_code='GT2-LO-001' AND r.name='receipt'),'Receiving a counted tag links the count');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('GT2-LO-001','{}'))
$query$,'22023','A received tag cannot be counted again');
INSERT INTO results VALUES('plain_receipt',public.apply_field_operation(
 '20000000-0000-4000-8000-000000000007','b1111111-1111-4111-8111-111111111111','receiving',
 jsonb_build_object('qrCodeValue','NEVER-COUNTED','material',jsonb_build_object('material_type','Other','qty',1),
  'po','{}'::jsonb,'inspection',jsonb_build_object('condition','good','inspection_pass',true),
  'location',jsonb_build_object('location_id','c1111111-1111-4111-8111-111111111111'),
  'decision',jsonb_build_object('status','accepted','has_exception',false))));
SELECT pg_temp.assert_true((SELECT result->'inventory_uid'='null'::jsonb FROM results WHERE name='plain_receipt'),
 'Receiving a tag with no count still works');

-- ---- Merging categories ----------------------------------------------------
SELECT pg_temp.expect_error($query$
 SELECT public.merge_inventory_category((SELECT (result->>'category_id')::uuid FROM results WHERE name='proposal'),'7a222222-2222-4222-8222-222222222222')
$query$,'42501','Field users cannot merge categories');
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($query$
 SELECT public.merge_inventory_category('7a111111-1111-4111-8111-111111111111','7a222222-2222-4222-8222-222222222222')
$query$,'22023','A category cannot merge into its own subcategory');
INSERT INTO public.inventory_categories(id,project_id,parent_id,name) VALUES
 ('7a444444-4444-4444-8444-444444444444','b1111111-1111-4111-8111-111111111111','7a222222-2222-4222-8222-222222222222','Control Valve');
INSERT INTO results VALUES('merge',public.merge_inventory_category(
 (SELECT (result->>'category_id')::uuid FROM results WHERE name='proposal'),'7a444444-4444-4444-8444-444444444444'));
SELECT pg_temp.assert_true((SELECT (result->>'items_moved')::int=2 FROM results WHERE name='merge')
 AND (SELECT status='archived' FROM public.inventory_categories WHERE id=(SELECT (result->>'category_id')::uuid FROM results WHERE name='proposal'))
 AND (SELECT count(*)=2 FROM public.inventory_records WHERE category_id='7a444444-4444-4444-8444-444444444444'),
 'Merging moves the proposal''s items and archives it');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM public.audit_log WHERE action IN ('inventory_imported','inventory_category_merged')),
 'Imports and merges are audited');
RESET ROLE;
ROLLBACK;

BEGIN;
\ir admin-fixtures.sql

INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','T1','1','2');
CREATE TEMP TABLE results(name text PRIMARY KEY,result jsonb);
GRANT ALL ON results TO authenticated;
CREATE FUNCTION pg_temp.op(op_id uuid,action text,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.apply_field_operation(op_id,'b1111111-1111-4111-8111-111111111111',action,payload);
$$;
CREATE FUNCTION pg_temp.pack(payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.op(gen_random_uuid(),'pack',payload);
$$;

-- Office staff manage places; every active user can read them.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
INSERT INTO public.places(id,kind,name,city,state,latitude,longitude) VALUES
 ('9a111111-1111-4111-8111-111111111111','outside_shop','Gulf Rewind Shop','Katy','TX',29.785,-95.824);
INSERT INTO public.places(id,kind,name,project_id) VALUES
 ('9a222222-2222-4222-8222-222222222222','yard','Test Yard One laydown','b1111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT created_by='01111111-1111-4111-8111-111111111111' FROM public.places WHERE name='Gulf Rewind Shop'),
 'A place records who added it');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name,latitude) VALUES('vendor','Half point',29.1)$q$,
 '23514','A map point needs both coordinates');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name,project_id) VALUES('outside_shop','Project shop','b1111111-1111-4111-8111-111111111111')$q$,
 '23514','Only yards and sites belong to a project');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name) VALUES('vendor','gulf rewind shop')$q$,
 '23505','Active places have unique names');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name,project_id) VALUES('yard','Other yard','b2222222-2222-4222-8222-222222222222')$q$,
 '42501','Office staff add yards only for their own projects');
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.places),'Field users can read places');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name) VALUES('vendor','Field vendor')$q$,
 '42501','Field users cannot add places');
UPDATE public.places SET name='Renamed' WHERE id='9a111111-1111-4111-8111-111111111111';
SELECT pg_temp.expect_error($q$DELETE FROM public.places$q$,'42501','Places are retired, not deleted');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT name='Gulf Rewind Shop' FROM public.places WHERE id='9a111111-1111-4111-8111-111111111111'),
 'Field users cannot rename places');

-- Office reserves crate labels to print.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
INSERT INTO results SELECT 'labels',jsonb_agg(code) FROM public.reserve_handling_unit_labels('b1111111-1111-4111-8111-111111111111',3);
SELECT pg_temp.assert_true((SELECT jsonb_array_length(result)=3 AND bool_and(e#>>'{}' ~ '^HU-[A-HJ-NP-Z2-9]{6}$')
 FROM results,jsonb_array_elements(result) e WHERE name='labels' GROUP BY result),'Office reserves a batch of crate labels');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.qr_codes q,results r,jsonb_array_elements_text(r.result) c
 WHERE r.name='labels' AND q.code_value=c AND q.entity_type='handling_unit' AND q.entity_id IS NULL),'Reserved labels wait for their first pack');
SELECT pg_temp.expect_error($q$SELECT public.reserve_handling_unit_labels('b1111111-1111-4111-8111-111111111111',0)$q$,
 '22023','A label batch has a size');
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT public.reserve_handling_unit_labels('b1111111-1111-4111-8111-111111111111',1)$q$,
 '42501','Field users cannot reserve labels');

-- Items to pack: two counted items and a received pipe.
SELECT pg_temp.op('40000000-0000-4000-8000-000000000001','count','{"tag":"CV-1","name":"Control valve","quantity":"1"}');
SELECT pg_temp.op('40000000-0000-4000-8000-000000000002','count','{"tag":"FL-1","name":"Flanges","quantity":"20"}');
SELECT pg_temp.op('40000000-0000-4000-8000-000000000003','receiving',
 '{"qrCodeValue":"MAT-1","material":{"material_type":"Pipe","size":"4in","qty":5},"decision":{"status":"accepted"},
   "inspection":{"condition":"good","inspection_pass":true},
   "location":{"location_id":"c1111111-1111-4111-8111-111111111111"}}');
RESET ROLE;
INSERT INTO public.inventory_records(project_id,qr_code,inventory_item,count_status,source)
 VALUES('b1111111-1111-4111-8111-111111111111','EXP-1','Expected pump','expected','import');
INSERT INTO public.qr_codes(code_value,entity_type,project_id) VALUES
 ('HU-ITEM01','item','b1111111-1111-4111-8111-111111111111'),
 ('HU-OTHER1','handling_unit','b2222222-2222-4222-8222-222222222222');

-- Packing creates the crate from its label and seals it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
INSERT INTO results VALUES('pack1',pg_temp.op('41000000-0000-4000-8000-000000000001','pack',
 '{"unitCode":"hu-test01","description":"Valve crate","add":["CV-1","MAT-1"],"placeId":"9a222222-2222-4222-8222-222222222222","seal":true}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='sealed' AND (result->>'created')::boolean AND (result->>'item_count')::integer=2
 AND result->>'code'='HU-TEST01' FROM results WHERE name='pack1'),'Packing creates and seals a crate');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.handling_unit_items WHERE unit_code='HU-TEST01'),'The crate lists both items');
SELECT pg_temp.assert_true((SELECT name='Pipe 4in' AND quantity=5 AND material_id IS NOT NULL FROM public.handling_unit_items WHERE tag='MAT-1'),
 'A received material is packed whole and named from its receipt');
SELECT pg_temp.assert_true((SELECT name='Control valve' AND inventory_uid IS NOT NULL FROM public.handling_unit_items WHERE tag='CV-1'),
 'A counted item is packed by its count');
SELECT pg_temp.assert_true((SELECT q.entity_type='handling_unit' AND q.entity_id=(r.result->>'id')::uuid
 FROM public.qr_codes q,results r WHERE q.code_value='HU-TEST01' AND r.name='pack1'),'The label points at its crate');
SELECT pg_temp.assert_true((SELECT place_name='Test Yard One laydown' FROM public.handling_unit_overview WHERE code='HU-TEST01'),
 'The crate is at the place it was packed');
SELECT pg_temp.assert_true(pg_temp.op('41000000-0000-4000-8000-000000000001','pack',
 '{"unitCode":"hu-test01","description":"Valve crate","add":["CV-1","MAT-1"],"placeId":"9a222222-2222-4222-8222-222222222222","seal":true}')
 =(SELECT result FROM results WHERE name='pack1'),'A replayed pack returns the first result');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('41000000-0000-4000-8000-000000000001','pack','{"unitCode":"HU-TEST01"}')$q$,
 '23505','An operation ID cannot be reused for a different pack');

SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":["CV-1"]}')$q$,'22023','An item can be in only one crate');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":["EXP-1"]}')$q$,'22023','An item is counted or received before packing');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":["NOPE-9"]}')$q$,'22023','Unknown tags are refused');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-1"}')$q$,'22023','Crate labels have a format');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-ITEM01"}')$q$,'22023','An item tag cannot become a crate');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-OTHER1"}')$q$,'42501','Another project''s label is refused');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-EMPTY1","seal":true}')$q$,'22023','An empty crate cannot be sealed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","seal":"yes"}')$q$,'22023','Seal is true or false');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":"CV-1"}')$q$,'22023','Tags come as a list');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":[7]}')$q$,'22023','Tags are text');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","kind":"barrel"}')$q$,'22023','Crate types are a fixed list');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST01","remove":["FL-1"]}')$q$,'22023','Only items in the crate can be taken out');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.handling_units WHERE code IN ('HU-TEST02','HU-EMPTY1')),
 'A refused pack leaves no crate behind');

-- Crates go inside containers, without loops and at most 5 deep.
INSERT INTO results VALUES('box',pg_temp.pack(
 '{"unitCode":"HU-BOX001","kind":"container","add":["HU-TEST01","FL-1"],"placeId":"9a111111-1111-4111-8111-111111111111"}'));
SELECT pg_temp.assert_true((SELECT parent_code='HU-BOX001' AND top_code='HU-BOX001' AND place_name='Gulf Rewind Shop'
 FROM public.handling_unit_overview WHERE code='HU-TEST01'),'A crate inside a container is where the container is');
SELECT pg_temp.assert_true((SELECT item_count=1 AND unit_count=1 FROM public.handling_unit_overview WHERE code='HU-BOX001'),
 'The container holds one item and one crate');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST01","add":["HU-BOX001"]}')$q$,'22023','Crates cannot loop');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST01","add":["HU-TEST01"]}')$q$,'22023','A crate cannot hold itself');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST03","add":["HU-TEST01"]}')$q$,'22023','A crate in a container comes out first');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST03","add":["HU-OTHER1"]}')$q$,'42501','Another project''s crate cannot be nested');
SELECT pg_temp.pack('{"unitCode":"HU-DEEP5"}');
SELECT pg_temp.pack('{"unitCode":"HU-DEEP4","add":["HU-DEEP5"]}');
SELECT pg_temp.pack('{"unitCode":"HU-DEEP3","add":["HU-DEEP4"]}');
SELECT pg_temp.pack('{"unitCode":"HU-DEEP2","add":["HU-DEEP3"]}');
SELECT pg_temp.pack('{"unitCode":"HU-DEEP1","add":["HU-DEEP2"]}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-DEEP0","add":["HU-DEEP1"]}')$q$,'22023','Nesting stops at 5 levels');

-- Unpacking releases items and crates where the outermost crate stands.
INSERT INTO results VALUES('unbox',pg_temp.op(gen_random_uuid(),'unpack','{"unitCode":"HU-BOX001"}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='unpacked' AND (result->>'items_released')::integer=1 AND (result->>'units_released')::integer=1
 FROM results WHERE name='unbox'),'Unpacking releases what the container held');
SELECT pg_temp.assert_true((SELECT parent_id IS NULL AND place_id='9a111111-1111-4111-8111-111111111111' AND status='sealed'
 FROM public.handling_units WHERE code='HU-TEST01'),'A released crate stays sealed where the container was');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'unpack','{"unitCode":"HU-BOX001"}')$q$,'22023','A crate is unpacked once');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'unpack','{"unitCode":"HU-NOPE01"}')$q$,'42501','Unknown crates cannot be unpacked');

-- Taking an item out frees it for another crate.
INSERT INTO results VALUES('remove',pg_temp.pack('{"unitCode":"HU-TEST01","remove":["MAT-1"]}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='open' AND (result->>'item_count')::integer=1 FROM results WHERE name='remove'),
 'Changing a sealed crate reopens it');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.handling_unit_contents WHERE tag='MAT-1' AND removed_at IS NOT NULL),
 'The crate keeps a record of what came out');
RESET ROLE;

-- Once the project has areas, a crate on its own needs one to be sealed.
INSERT INTO public.site_maps(id,project_id,name) VALUES
 ('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Yard plan');
INSERT INTO public.site_map_zones(id,map_id,project_id,parent_id,name,shape,is_active) VALUES
 ('2b111111-1111-4111-8111-111111111111','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,
  'T1 Pipe Racks','[[0,0],[0.5,0],[0.5,0.5],[0,0.5]]',true),
 ('2b222222-2222-4222-8222-222222222222','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
  '2b111111-1111-4111-8111-111111111111','Rack 2','[[0.1,0.1],[0.4,0.1],[0.4,0.2],[0.1,0.2]]',true),
 ('2b333333-3333-4333-8333-333333333333','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,
  'Old bay','[[0.6,0.6],[0.9,0.6],[0.9,0.9]]',false);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST04","add":["MAT-1"],"seal":true}')$q$,'22023','Sealing needs an area');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST04","add":["MAT-1"],"zoneId":"2b333333-3333-4333-8333-333333333333","seal":true}')$q$,
 '22023','A retired area is refused');
INSERT INTO results VALUES('zoned',pg_temp.pack('{"unitCode":"HU-TEST04","add":["MAT-1"],"zoneId":"2b222222-2222-4222-8222-222222222222","seal":true}'));
SELECT pg_temp.assert_true((SELECT location='T1 Pipe Racks › Rack 2' AND status='sealed' FROM public.handling_units WHERE code='HU-TEST04'),
 'A sealed crate names its area');

-- Issuing a packed material in full takes it out of its crate.
INSERT INTO results SELECT 'issue',pg_temp.op(gen_random_uuid(),'issue',
 jsonb_build_object('materialId',m.id,'quantity','5','jobNumber','J-100')) FROM public.materials m
 JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-1';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.handling_unit_items WHERE tag='MAT-1'),'An issued material leaves its crate');

-- An unpacked crate's label can be packed again.
SELECT pg_temp.op(gen_random_uuid(),'unpack','{"unitCode":"HU-TEST01"}');
INSERT INTO results VALUES('reuse',pg_temp.pack('{"unitCode":"HU-TEST01","add":["CV-1"]}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='open' AND NOT (result->>'created')::boolean FROM results WHERE name='reuse'),
 'An unpacked crate is reused');

-- Field writes go only through the operation; other projects stay hidden.
SELECT pg_temp.expect_error($q$SELECT public.apply_logistics_operation('f1111111-1111-4111-8111-111111111111',gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','pack','{"unitCode":"HU-SNEAK1"}')$q$,'42501','The logistics function cannot be called directly');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'teleport','{}')$q$,'22023','Unknown actions are refused');
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$INSERT INTO public.handling_units(project_id,code) VALUES('b1111111-1111-4111-8111-111111111111','HU-DIRECT1')$q$,
 '42501','Office staff cannot write crates directly');
SELECT pg_temp.expect_error($q$UPDATE public.handling_unit_contents SET removed_at=now()$q$,'42501','Crate contents cannot be edited directly');
RESET ROLE;
INSERT INTO public.handling_units(project_id,code) VALUES('b2222222-2222-4222-8222-222222222222','HU-OTHER1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.handling_unit_overview WHERE project_id='b2222222-2222-4222-8222-222222222222'),
 'Crates in other projects are hidden');
RESET ROLE;

ROLLBACK;

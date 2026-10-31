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
 ('HU-OTHER1','handling_unit','b2222222-2222-4222-8222-222222222222');
SELECT pg_temp.expect_error($q$INSERT INTO public.qr_codes(code_value,entity_type,project_id)
 VALUES('hu-item01','item','b1111111-1111-4111-8111-111111111111')$q$,'23514','HU- codes are crate labels and nothing else');
SELECT pg_temp.expect_error($q$INSERT INTO public.qr_codes(code_value,entity_type,project_id)
 VALUES('HU-OTHER1','handling_unit','b1111111-1111-4111-8111-111111111111')$q$,'23505','A crate label is unique across projects');

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
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'count','{"tag":"CV-1","name":"Control valve","quantity":"2"}')$q$,
 '22023','A packed item is not recounted until it comes out');

SELECT pg_temp.op('40000000-0000-4000-8000-000000000004','receiving',
 '{"qrCodeValue":"cv-1","material":{"material_type":"Control valve","qty":1},"decision":{"status":"accepted"},
   "inspection":{"condition":"good"},"location":{"location_id":"c1111111-1111-4111-8111-111111111111"}}');
SELECT pg_temp.assert_true((SELECT material_id IS NOT NULL AND inventory_uid IS NULL AND unit_code='HU-TEST01' FROM public.handling_unit_items WHERE tag='CV-1'),
 'A counted item that is received stays in its crate as the received material');
SELECT pg_temp.assert_true((SELECT position='in_crate' AND item_kind='material' AND crate_code='HU-TEST01' FROM public.item_positions WHERE tag='CV-1'),
 'A received item in a crate is where its crate is');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":["CV-1"]}')$q$,'22023','An item can be in only one crate');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":["EXP-1"]}')$q$,'22023','An item is counted or received before packing');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":["NOPE-9"]}')$q$,'22023','Unknown tags are refused');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-1"}')$q$,'22023','Crate labels have a format');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'count','{"tag":"hu-abc123","name":"Crate","quantity":"1"}')$q$,
 '22023','A crate label is not counted as an item');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'transfer',(SELECT jsonb_build_object('materialId',m.id,
 'fromLocationId','c1111111-1111-4111-8111-111111111111','toLocationId','c1111111-1111-4111-8111-111111111111')
 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-1'))$q$,
 '22023','A packed material is not moved to another rack');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-OTHER1"}')$q$,'42501','Another project''s label is refused');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-EMPTY1","seal":true}')$q$,'22023','An empty crate cannot be sealed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","seal":"yes"}')$q$,'22023','Seal is true or false');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":"CV-1"}')$q$,'22023','Tags come as a list');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","add":[7]}')$q$,'22023','Tags are text');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST02","kind":"barrel"}')$q$,'22023','Crate types are a fixed list');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST01","remove":["FL-1"]}')$q$,'22023','Only items in the crate can be taken out');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.handling_units WHERE code IN ('HU-TEST02','HU-EMPTY1')),
 'A refused pack leaves no crate behind');
INSERT INTO results VALUES('partial',pg_temp.pack('{"unitCode":"HU-PART01","add":["FL-1","NOPE-9"],"seal":true,"partial":true}'));
SELECT pg_temp.assert_true((SELECT (result->>'item_count')::integer=1 AND result->>'status'='open' AND jsonb_array_length(result->'refused')=1
 AND result#>>'{refused,0,code}'='NOPE-9' AND result#>>'{refused,0,sqlstate}'='22023' FROM results WHERE name='partial'),
 'A partial pack keeps the good tags, returns the refused ones and leaves the crate open');
SELECT pg_temp.pack('{"unitCode":"HU-PART01","remove":["fl-1"]}');

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
SELECT pg_temp.assert_true((SELECT position='at_place' AND place_name='Gulf Rewind Shop' AND place_kind='outside_shop'
 FROM public.item_positions WHERE tag='FL-1'),'A released item is where the container was');
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
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST04","add":["MAT-1"],"zoneId":"not-an-id"}')$q$,'22023','A bad area ID is refused with a reason');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST04","add":["MAT-1"],"zoneId":"2b333333-3333-4333-8333-333333333333","seal":true}')$q$,
 '22023','A retired area is refused');
INSERT INTO results VALUES('zoned',pg_temp.pack('{"unitCode":"HU-TEST04","add":["MAT-1"],"zoneId":"2b222222-2222-4222-8222-222222222222","seal":true}'));
SELECT pg_temp.assert_true((SELECT location='T1 Pipe Racks › Rack 2' AND status='sealed' FROM public.handling_units WHERE code='HU-TEST04'),
 'A sealed crate names its area');
RESET ROLE;

-- A site plan draws one place. An area has to be at the place given; a crate
-- moved keeps its seal, and a new place without an area clears the old area.
UPDATE public.site_maps SET place_id='9a222222-2222-4222-8222-222222222222' WHERE id='5b111111-1111-4111-8111-111111111111';
SELECT pg_temp.expect_error($q$UPDATE public.site_maps SET place_id='9a111111-1111-4111-8111-111111111111'
 WHERE id='5b111111-1111-4111-8111-111111111111'$q$,'42501','A site plan draws a yard or site');
INSERT INTO public.places(id,kind,name,project_id,is_active) VALUES
 ('9a444444-4444-4444-8444-444444444444','yard','Old laydown','b1111111-1111-4111-8111-111111111111',false);
SELECT pg_temp.expect_error($q$UPDATE public.site_maps SET place_id='9a444444-4444-4444-8444-444444444444'
 WHERE id='5b111111-1111-4111-8111-111111111111'$q$,'22023','A site plan can''t be tied to a retired place');
UPDATE public.site_map_zones SET location_id='c1111111-1111-4111-8111-111111111111' WHERE id='2b222222-2222-4222-8222-222222222222';
INSERT INTO public.locations(id,project_id,zone,row,rack,is_hold_area) VALUES
 ('c2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','HOLD','1','1',true),
 ('c3333333-3333-4333-8333-333333333333','b1111111-1111-4111-8111-111111111111','T2','1','1',false);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'move',
 '{"unitCode":"HU-TEST04","placeId":"9a111111-1111-4111-8111-111111111111","zoneId":"2b222222-2222-4222-8222-222222222222"}')$q$,
 '22023','An area has to be at the place given');
SELECT pg_temp.op(gen_random_uuid(),'move','{"unitCode":"HU-TEST04","zoneId":"2b111111-1111-4111-8111-111111111111"}');
SELECT pg_temp.assert_true((SELECT status='sealed' AND sealed_at IS NOT NULL AND location='T1 Pipe Racks' AND place_id='9a222222-2222-4222-8222-222222222222'
 FROM public.handling_units WHERE code='HU-TEST04'),'A moved crate keeps its seal and takes the place its area is at');
SELECT pg_temp.op(gen_random_uuid(),'move','{"unitCode":"HU-TEST04","placeId":"9a111111-1111-4111-8111-111111111111"}');
SELECT pg_temp.assert_true((SELECT status='sealed' AND zone_id IS NULL AND location IS NULL AND place_id='9a111111-1111-4111-8111-111111111111'
 FROM public.handling_units WHERE code='HU-TEST04'),'A new place without an area clears the old area; a shop needs no area');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-YARD01","add":["FL-1"],"placeId":"9a222222-2222-4222-8222-222222222222","seal":true}')$q$,
 '22023','A crate sealed at a place with a site plan needs an area');

-- A received material starts in its rack's area; its location can be
-- corrected without a recount, and it follows the rack of its new area.
SELECT pg_temp.op(gen_random_uuid(),'receiving',
 '{"qrCodeValue":"MAT-2","material":{"material_type":"Pipe","qty":10},"decision":{"status":"accepted"},
   "inspection":{"condition":"good"},"location":{"location_id":"c1111111-1111-4111-8111-111111111111"}}');
SELECT pg_temp.assert_true((SELECT position='at_place' AND area='T1 Pipe Racks › Rack 2' AND place_name='Test Yard One laydown'
 FROM public.item_positions WHERE tag='MAT-2'),'A received material starts in the area linked to its rack');
SELECT pg_temp.op(gen_random_uuid(),'relocate','{"tag":"mat-2","zoneId":"2b111111-1111-4111-8111-111111111111","reason":"Found on the next rack"}');
SELECT pg_temp.assert_true((SELECT m.zone_id='2b111111-1111-4111-8111-111111111111' AND m.location_id IS NULL FROM public.materials m
 JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-2'),'A relocated material follows the rack of its new area');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'relocate','{"tag":"MAT-2"}')$q$,'22023','Relocating needs a place or area');

-- A tag received before it was counted is counted as received, and moves to
-- where it was counted.
SELECT pg_temp.op(gen_random_uuid(),'receiving',
 '{"qrCodeValue":"PRE-1","material":{"material_type":"Gasket","qty":1},"decision":{"status":"accepted"},
   "inspection":{"condition":"good"},"location":{"location_id":"c3333333-3333-4333-8333-333333333333"}}');
INSERT INTO results VALUES('precount',pg_temp.op(gen_random_uuid(),'count',
 '{"tag":"pre-1","name":"Gasket","quantity":"1","zoneId":"2b222222-2222-4222-8222-222222222222"}'));
SELECT pg_temp.assert_true((SELECT result->>'count_status'='received' FROM results WHERE name='precount'),
 'A tag received before it was counted is counted as received');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(item_kind='material' AND area='T1 Pipe Racks › Rack 2') FROM public.item_positions WHERE lower(tag)='pre-1'),
 'The received item is where it was counted, with one record');

-- An older offline count doesn't overwrite a newer one.
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'count',
 '{"tag":"FL-1","name":"Flanges","quantity":"19","zoneId":"2b222222-2222-4222-8222-222222222222","capturedAt":"2020-01-01T00:00:00Z"}')$q$,
 '22023','A count made before the latest one is refused');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'count',
 '{"tag":"FL-1","name":"Flanges","quantity":"19","capturedAt":"yesterday"}')$q$,'22023','capturedAt is a real time');

-- Held stock: crews can't pack, issue or move it except to a hold area; the
-- office can.
RESET ROLE;
INSERT INTO public.qr_codes(id,project_id,code_value,entity_type) VALUES
 ('d4444444-4444-4444-8444-444444444444','b1111111-1111-4111-8111-111111111111','HELD-1','item');
INSERT INTO public.receiving_records(id,project_id,qr_code_id,material_type,qty,created_by,status,has_exception,exception_type,exception_resolution,location_id) VALUES
 ('e5555555-5555-4555-8555-555555555555','b1111111-1111-4111-8111-111111111111','d4444444-4444-4444-8444-444444444444','Valve',2,
  'f1111111-1111-4111-8111-111111111111','accepted',true,'damage','hold','c3333333-3333-4333-8333-333333333333');
INSERT INTO public.materials(id,project_id,receiving_record_id,qr_code_id,material_type,qty,current_quantity,location_id) VALUES
 ('e6666666-6666-4666-8666-666666666666','b1111111-1111-4111-8111-111111111111','e5555555-5555-4555-8555-555555555555',
  'd4444444-4444-4444-8444-444444444444','Valve',2,2,'c3333333-3333-4333-8333-333333333333');
UPDATE public.qr_codes SET entity_id='e5555555-5555-4555-8555-555555555555' WHERE id='d4444444-4444-4444-8444-444444444444';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.assert_true((SELECT hold='on_hold' FROM public.item_positions WHERE tag='HELD-1'),'The hold shows with the item');
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-HELD01","add":["HELD-1"]}')$q$,'22023','Crews can''t pack held stock');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'issue',
 '{"materialId":"e6666666-6666-4666-8666-666666666666","jobNumber":"J-1","quantity":1}')$q$,'22023','Crews can''t issue held stock');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'transfer','{"materialId":"e6666666-6666-4666-8666-666666666666",
 "fromLocationId":"c3333333-3333-4333-8333-333333333333","toLocationId":"c1111111-1111-4111-8111-111111111111"}')$q$,
 '22023','Held stock moves only to a hold area');
SELECT pg_temp.op(gen_random_uuid(),'transfer','{"materialId":"e6666666-6666-4666-8666-666666666666",
 "fromLocationId":"c3333333-3333-4333-8333-333333333333","toLocationId":"c2222222-2222-4222-8222-222222222222"}');
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.pack('{"unitCode":"HU-HELD01","add":["HELD-1"]}');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.handling_unit_items WHERE tag='HELD-1'),'Office staff can pack held stock');
RESET ROLE;
INSERT INTO public.site_map_zones(id,map_id,project_id,name,shape,location_id) VALUES
 ('2b444444-4444-4444-8444-444444444444','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Hold bay',
  '[[0.6,0.1],[0.9,0.1],[0.9,0.3]]','c2222222-2222-4222-8222-222222222222');
INSERT INTO public.qr_codes(id,project_id,code_value,entity_type) VALUES
 ('d5555555-5555-4555-8555-555555555555','b1111111-1111-4111-8111-111111111111','HELD-2','item');
INSERT INTO public.receiving_records(id,project_id,qr_code_id,material_type,qty,created_by,status,has_exception,exception_type,exception_resolution,location_id) VALUES
 ('e7777777-7777-4777-8777-777777777777','b1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Gasket',5,
  'f1111111-1111-4111-8111-111111111111','accepted',true,'damage','return_to_vendor','c2222222-2222-4222-8222-222222222222');
INSERT INTO public.materials(id,project_id,receiving_record_id,qr_code_id,material_type,qty,current_quantity,location_id) VALUES
 ('e8888888-8888-4888-8888-888888888888','b1111111-1111-4111-8111-111111111111','e7777777-7777-4777-8777-777777777777',
  'd5555555-5555-4555-8555-555555555555','Gasket',5,5,'c2222222-2222-4222-8222-222222222222');
UPDATE public.qr_codes SET entity_id='e7777777-7777-4777-8777-777777777777' WHERE id='d5555555-5555-4555-8555-555555555555';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'move','{"unitCode":"HU-HELD01","placeId":"9a222222-2222-4222-8222-222222222222",
 "zoneId":"2b222222-2222-4222-8222-222222222222"}')$q$,'22023','A crate holding held stock goes only to a hold area');
SELECT pg_temp.op(gen_random_uuid(),'move','{"unitCode":"HU-HELD01","placeId":"9a222222-2222-4222-8222-222222222222","zoneId":"2b444444-4444-4444-8444-444444444444"}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'relocate','{"tag":"HELD-2","zoneId":"2b222222-2222-4222-8222-222222222222"}')$q$,
 '22023','Stock being returned to the vendor is relocated only to a hold area');
SELECT pg_temp.op(gen_random_uuid(),'relocate','{"tag":"HELD-2","zoneId":"2b444444-4444-4444-8444-444444444444"}');
SELECT pg_temp.op(gen_random_uuid(),'count','{"tag":"held-2","name":"Gasket","quantity":"5","zoneId":"2b222222-2222-4222-8222-222222222222"}');
SELECT pg_temp.assert_true((SELECT zone_id='2b444444-4444-4444-8444-444444444444' AND location_id='c2222222-2222-4222-8222-222222222222'
 FROM public.materials WHERE id='e8888888-8888-4888-8888-888888888888'),'Counting held stock elsewhere doesn''t move it out of the hold area');

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

-- Issuing part of a packed material opens the crate and leaves the rest in it.
SELECT pg_temp.expect_error($q$SELECT pg_temp.pack('{"unitCode":"HU-TEST01","add":["MAT-2"],"zoneId":"2b222222-2222-4222-8222-222222222222"}')$q$,
 '22023','A crate at a shop can''t be given a yard area without saying it moved to the yard');
SELECT pg_temp.pack('{"unitCode":"HU-TEST01","add":["MAT-2"],"placeId":"9a222222-2222-4222-8222-222222222222",
 "zoneId":"2b222222-2222-4222-8222-222222222222","seal":true}');
SELECT pg_temp.op(gen_random_uuid(),'issue',(SELECT jsonb_build_object('materialId',m.id,'quantity',3,'jobNumber','J-200')
 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-2'));
SELECT pg_temp.assert_true((SELECT i.quantity=7 AND u.status='open' FROM public.handling_unit_items i JOIN public.handling_units u ON u.id=i.unit_id
 WHERE i.tag='MAT-2'),'A partial issue from a crate opens it and leaves the rest packed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'shipment',(SELECT jsonb_build_object('materialId',m.id,'quantity',1,'destination','Site')
 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-2'))$q$,'42501','Crews don''t ship stock out');
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.op(gen_random_uuid(),'shipment',(SELECT jsonb_build_object('materialId',m.id,'quantity',1,'destination','Site')
 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-2'))$q$,'22023','Packed stock isn''t shipped out');
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);

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

-- A place another project uses can't be claimed or retired by one project's
-- office, and every change to a place is in the audit log.
INSERT INTO public.places(id,kind,name) VALUES('9a333333-3333-4333-8333-333333333333','yard','Shared yard');
INSERT INTO public.handling_units(project_id,code,place_id) VALUES('b2222222-2222-4222-8222-222222222222','HU-OTHER2','9a333333-3333-4333-8333-333333333333');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$UPDATE public.places SET project_id='b1111111-1111-4111-8111-111111111111' WHERE id='9a333333-3333-4333-8333-333333333333'$q$,
 '22023','A place another project uses can''t become one project''s');
SELECT pg_temp.expect_error($q$UPDATE public.places SET is_active=false WHERE id='9a333333-3333-4333-8333-333333333333'$q$,
 '42501','A place another project uses can''t be retired by this project''s office');
UPDATE public.places SET notes='Gate code at the office' WHERE id='9a333333-3333-4333-8333-333333333333';
SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.audit_log WHERE action='place_updated' AND entity_id='9a333333-3333-4333-8333-333333333333'),
 'Changes to places are in the audit log');
UPDATE public.places SET is_active=false WHERE id='9a333333-3333-4333-8333-333333333333';
SELECT pg_temp.assert_true((SELECT NOT is_active FROM public.places WHERE id='9a333333-3333-4333-8333-333333333333'),'An administrator can retire a shared place');
RESET ROLE;

ROLLBACK;

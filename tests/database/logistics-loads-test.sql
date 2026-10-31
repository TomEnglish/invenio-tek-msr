BEGIN;
\ir admin-fixtures.sql

-- Project one: a rack location, our yard, a site, and an outside shop. Project
-- two has its own yard, which project one can't use.
INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','T1','1','2');
INSERT INTO public.places(id,kind,name,project_id) VALUES
 ('9b111111-1111-4111-8111-111111111111','yard','Home Yard','b1111111-1111-4111-8111-111111111111'),
 ('9b333333-3333-4333-8333-333333333333','site','Field Site','b1111111-1111-4111-8111-111111111111'),
 ('9b444444-4444-4444-8444-444444444444','yard','Other Yard','b2222222-2222-4222-8222-222222222222');
INSERT INTO public.places(id,kind,name) VALUES ('9b222222-2222-4222-8222-222222222222','outside_shop','Rewind Shop');
CREATE TEMP TABLE results(name text PRIMARY KEY,result jsonb);
GRANT ALL ON results TO authenticated;
CREATE FUNCTION pg_temp.opx(op_id uuid,action text,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.apply_field_operation(op_id,'b1111111-1111-4111-8111-111111111111',action,payload);
$$;
CREATE FUNCTION pg_temp.op(action text,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.opx(gen_random_uuid(),action,payload);
$$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true);
$$;

-- Pieces: four counted items, two received pipes, and crates. HU-C0001 sits
-- inside HU-B0001.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('count',jsonb_build_object('tag',t,'name',n,'quantity','1'))
 FROM (VALUES ('CV-1','Control valve'),('FL-1','Flanges'),('ROTOR-1','Generator rotor'),('PUMP-1','Lube oil pump')) v(t,n);
SELECT pg_temp.op('receiving',jsonb_build_object('qrCodeValue',t,'material',jsonb_build_object('material_type','Pipe','size','6in','qty',4),
 'decision',jsonb_build_object('status','accepted'),'inspection',jsonb_build_object('condition','good','inspection_pass',true),
 'location',jsonb_build_object('location_id','c1111111-1111-4111-8111-111111111111'))) FROM (VALUES ('MAT-1'),('MAT-2')) v(t);
SELECT pg_temp.op('pack','{"unitCode":"HU-A0001","add":["CV-1"],"seal":true}');
SELECT pg_temp.op('pack','{"unitCode":"HU-C0001"}');
SELECT pg_temp.op('pack','{"unitCode":"HU-B0001","add":["FL-1","HU-C0001"],"seal":true}');

-- A field user creates a load with its stops and companies.
INSERT INTO results VALUES('l1',pg_temp.opx('20000000-0000-4000-8000-000000000001','load_save',jsonb_build_object(
 'loadId','1d000000-0000-4000-8000-000000000001','originPlaceId','9b111111-1111-4111-8111-111111111111','truckType','Flatbed',
 'plannedDate','2026-11-30','companies',jsonb_build_array(
  jsonb_build_object('name','Gulf Freight Brokers','role','broker','phone','555-0100'),
  jsonb_build_object('name','Lone Star Haul','role','carrier','contactName','Dispatch','phone','555-0101')),
 'stops',jsonb_build_array(
  jsonb_build_object('id','5d000000-0000-4000-8000-000000000011','placeId','9b222222-2222-4222-8222-222222222222'),
  jsonb_build_object('id','5d000000-0000-4000-8000-000000000012','placeId','9b333333-3333-4333-8333-333333333333','kind','dropoff')))));
SELECT pg_temp.assert_true((SELECT result->>'load_number'='L-0001' AND result->>'status'='planning' AND (result->>'created')::boolean
 FROM results WHERE name='l1'),'A new load is numbered L-0001 and starts in planning');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.load_companies WHERE load_id='1d000000-0000-4000-8000-000000000001'),'The load has two companies');
SELECT pg_temp.assert_true((SELECT string_agg(place_name,',' ORDER BY seq)='Rewind Shop,Field Site' FROM public.load_stop_overview
 WHERE load_id='1d000000-0000-4000-8000-000000000001'),'Stops keep their order');
SELECT pg_temp.assert_true(pg_temp.opx('20000000-0000-4000-8000-000000000001','load_save',jsonb_build_object(
 'loadId','1d000000-0000-4000-8000-000000000001','originPlaceId','9b111111-1111-4111-8111-111111111111','truckType','Flatbed',
 'plannedDate','2026-11-30','companies',jsonb_build_array(
  jsonb_build_object('name','Gulf Freight Brokers','role','broker','phone','555-0100'),
  jsonb_build_object('name','Lone Star Haul','role','carrier','contactName','Dispatch','phone','555-0101')),
 'stops',jsonb_build_array(
  jsonb_build_object('id','5d000000-0000-4000-8000-000000000011','placeId','9b222222-2222-4222-8222-222222222222'),
  jsonb_build_object('id','5d000000-0000-4000-8000-000000000012','placeId','9b333333-3333-4333-8333-333333333333','kind','dropoff'))))
 =(SELECT result FROM results WHERE name='l1'),'Saving the same load again with the same operation ID returns the first answer');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","companies":[{"name":"A"},{"name":"B"},{"name":"C"},{"name":"D"}]}')$q$,
 '22023','A load has at most 3 companies');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","companies":[{"phone":"555"}]}')$q$,
 '22023','Each company needs a name');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","plannedDate":"2026-02-30"}')$q$,
 '22023','Dates must be real');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","originPlaceId":"9b444444-4444-4444-8444-444444444444"}')$q$,
 '42501','Another project''s yard can''t be the origin');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"truckType":"Flatbed"}')$q$,'22023','A load needs an ID');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[
 {"id":"5d000000-0000-4000-8000-000000000011","placeId":"9b222222-2222-4222-8222-222222222222"},
 {"id":"5d000000-0000-4000-8000-000000000011","placeId":"9b333333-3333-4333-8333-333333333333"}]}')$q$,'22023','Each stop has its own ID');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","companies":[
 {"name":"Gulf Freight Brokers","role":"broker","phone":"555-0100"},{"name":"Lone Star Haul","role":"carrier","phone":"555-0101"},
 {"name":"R. Ortiz Trucking","role":"carrier","phone":"555-0102"}]}');
SELECT pg_temp.assert_true((SELECT count(*)=3 AND max(position)=3 FROM public.load_companies WHERE load_id='1d000000-0000-4000-8000-000000000001'),
 'The company list is replaced, up to three');

-- A second load gets the next number; a load in another project is hidden.
INSERT INTO results VALUES('l2',pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000002","driverName":"Sam Lee",
 "stops":[{"id":"5d000000-0000-4000-8000-000000000021","placeId":"9b222222-2222-4222-8222-222222222222"}]}'));
SELECT pg_temp.assert_true((SELECT result->>'load_number'='L-0002' FROM results WHERE name='l2'),'The next load is L-0002');
RESET ROLE;
INSERT INTO public.loads(id,project_id,load_number) VALUES('1d000000-0000-4000-8000-000000000099','b2222222-2222-4222-8222-222222222222','L-0001');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loads WHERE project_id='b2222222-2222-4222-8222-222222222222'),'Other projects'' loads are hidden');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000099","notes":"x"}')$q$,'42501','Another project''s load can''t be changed');

-- Planning: crates and loose items, each to a drop-off stop.
SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[
 {"code":"hu-a0001","dropoffStopId":"5d000000-0000-4000-8000-000000000011"},
 {"code":"HU-B0001","dropoffStopId":"5d000000-0000-4000-8000-000000000012"},
 {"code":"ROTOR-1","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}');
SELECT pg_temp.assert_true((SELECT planned_count=3 FROM public.load_overview WHERE id='1d000000-0000-4000-8000-000000000001'),'Three pieces are planned');
SELECT pg_temp.assert_true((SELECT load_number='L-0001' AND load_line_status='planned' FROM public.handling_unit_overview WHERE code='HU-A0001'),
 'A planned crate shows its load');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"HU-C0001","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}')$q$,
 '22023','A crate inside a crate travels with it');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"CV-1","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}')$q$,
 '22023','A packed item travels with its crate');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000002","add":[{"code":"HU-A0001","dropoffStopId":"5d000000-0000-4000-8000-000000000021"}]}')$q$,
 '22023','A piece is on one load at a time');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"PUMP-1","dropoffStopId":"5d000000-0000-4000-8000-000000000021"}]}')$q$,
 '22023','A drop-off stop belongs to the same load');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"PUMP-1"}]}')$q$,
 '22023','A planned piece needs a drop-off stop');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"PUMP-1",
 "pickupStopId":"5d000000-0000-4000-8000-000000000012","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}')$q$,
 '22023','A piece is picked up before it comes off');

-- Planned and loaded pieces can't be packed, unpacked or put in a crate.
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('pack','{"unitCode":"HU-X0001","add":["HU-A0001"]}')$q$,'22023','A planned crate can''t go inside another');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('unpack','{"unitCode":"HU-A0001"}')$q$,'22023','A planned crate can''t be unpacked');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('pack','{"unitCode":"HU-X0001","add":["ROTOR-1"]}')$q$,'22023','A planned item can''t be packed');

-- Stops with pieces planned can't be dropped; reordering keeps each place in
-- the order once.
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[
 {"id":"5d000000-0000-4000-8000-000000000011","placeId":"9b222222-2222-4222-8222-222222222222"}]}')$q$,'22023','A stop with pieces can''t be dropped');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[
 {"id":"5d000000-0000-4000-8000-000000000012","placeId":"9b333333-3333-4333-8333-333333333333"},
 {"id":"5d000000-0000-4000-8000-000000000011","placeId":"9b222222-2222-4222-8222-222222222222"}]}');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[
 {"id":"5d000000-0000-4000-8000-000000000011","placeId":"9b222222-2222-4222-8222-222222222222"},
 {"id":"5d000000-0000-4000-8000-000000000012","placeId":"9b333333-3333-4333-8333-333333333333"}]}');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.assert_true((SELECT string_agg(place_name,',' ORDER BY seq)='Rewind Shop,Field Site' FROM public.load_stop_overview
 WHERE load_id='1d000000-0000-4000-8000-000000000001'),'Stops can be reordered and back');

-- Loading: planned pieces go on; an unplanned piece needs a drop-off stop;
-- a mistaken scan can be undone.
INSERT INTO results VALUES('on1',pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":["HU-A0001","ROTOR-1",
 {"code":"MAT-1","dropoffStopId":"5d000000-0000-4000-8000-000000000012"}]}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='loading' AND (result->>'on_board')::integer=3 AND (result->>'planned')::integer=1
 FROM results WHERE name='on1'),'Loading starts and three pieces are on board');
SELECT pg_temp.assert_true((SELECT status='on_load' FROM public.handling_units WHERE code='HU-A0001'),'A crate on board is on a load');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":["PUMP-1"]}')$q$,
 '22023','An unplanned piece needs a drop-off stop');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":[{"code":"PUMP-1","dropoffStopId":"5d000000-0000-4000-8000-000000000012"}]}');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","undo":["PUMP-1"]}');
SELECT pg_temp.assert_true((SELECT status='removed' FROM public.load_lines WHERE tag='PUMP-1'),'An undone field addition is taken off');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":[{"code":"PUMP-1","dropoffStopId":"5d000000-0000-4000-8000-000000000012"}]}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011","pieces":["MAT-2"]}')$q$,
 '22023','Before leaving, pieces go on without a stop');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('pack','{"unitCode":"HU-A0001"}')$q$,'22023','A crate on a truck can''t be repacked');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('unpack','{"unitCode":"HU-A0001"}')$q$,'22023','A crate on a truck can''t be unpacked');
SELECT pg_temp.assert_true((SELECT load_number='L-0001' AND load_line_status='on_board' AND top_status='on_load'
 FROM public.handling_unit_overview WHERE code='HU-A0001'),'The crate shows it is on board L-0001');

-- Leaving: the driver's name is needed; planned pieces not on board stay.
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001"}')$q$,'22023','The driver''s name comes first');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","driverName":"Rosa Ortiz","driverPhone":"555-0199","truckNumber":"TX-4410","trailerNumber":"TR-88"}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001","confirmAll":true}')$q$,
 '42501','Only office staff confirm loading without scanning');
INSERT INTO results VALUES('dep1',pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001"}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='in_transit' AND (result->>'not_loaded')::integer=1 FROM results WHERE name='dep1'),
 'The truck leaves and the unloaded crate stays behind');
SELECT pg_temp.assert_true((SELECT status='sealed' FROM public.handling_units WHERE code='HU-B0001'),'A crate left behind keeps its state');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[]}')$q$,'22023','Stops are fixed once the truck leaves');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[]}')$q$,'22023','The plan is fixed once the truck leaves');

-- The second load carries MAT-2.
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000002","pieces":[{"code":"MAT-2","dropoffStopId":"5d000000-0000-4000-8000-000000000021"}]}');
SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000002"}');

-- The licence: recorded by the field, readable only by the office, and never
-- in field_operations or in full in the audit log.
INSERT INTO results VALUES('lic',public.record_driver_licence('30000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001',
 '{"number":"tx 9q7z  5678","state":"TX","expiry":"2029-05-31"}'));
SELECT pg_temp.assert_true((SELECT result->>'last4'='5678' FROM results WHERE name='lic'),'Recording a licence answers with its last four characters');
SELECT pg_temp.assert_true(public.record_driver_licence('30000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001',
 '{"number":"tx 9q7z  5678","state":"TX","expiry":"2029-05-31"}')=(SELECT result FROM results WHERE name='lic'),'A repeated licence call returns the first answer');
SELECT pg_temp.expect_error($q$SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000001','{"number":"!!"}')$q$,
 '22023','A licence number has a format');
SELECT pg_temp.expect_error($q$SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000099','{"number":"TX12345"}')$q$,
 '42501','Another project''s load is refused');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.load_driver_licences),'Field users can''t read licences');
SELECT pg_temp.assert_true((SELECT licence_recorded_at IS NOT NULL FROM public.load_overview WHERE id='1d000000-0000-4000-8000-000000000001'),
 'Everyone can see that a licence is on file');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT licence_number='TX 9Q7Z 5678' AND licence_state='TX' FROM public.load_driver_licences
 WHERE load_id='1d000000-0000-4000-8000-000000000001'),'Office staff read the licence');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.field_operations WHERE payload::text ILIKE '%9q7z%')
 AND NOT EXISTS(SELECT 1 FROM public.audit_log WHERE details::text ILIKE '%9q7z%'),'The full number is in neither field_operations nor the audit log');

-- Licence photos: field staff upload and attach but can't read them back.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000001/front.jpg');
SELECT public.attach_driver_licence_photo('1d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001/front.jpg');
SELECT public.attach_driver_licence_photo('1d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001/front.jpg');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='driver-licences'),'Field users can''t see licence photos');
SELECT pg_temp.expect_error($q$SELECT public.attach_driver_licence_photo('1d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001/back.jpg')$q$,
 '22023','A photo is uploaded before it is attached');
SELECT pg_temp.expect_error($q$SELECT public.attach_driver_licence_photo('1d000000-0000-4000-8000-000000000001','elsewhere/front.jpg')$q$,
 '22023','A photo sits in its load''s folder');
SELECT pg_temp.expect_error($q$INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000099/x.jpg')$q$,
 '42501','Photos can''t go under another project''s load');
DELETE FROM storage.objects WHERE bucket_id='driver-licences';
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='driver-licences')
 AND (SELECT count(*)=1 FROM public.driver_licence_photos),'Office staff see the photo, attached once, and the field delete removed nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000001/anon.jpg')$q$,
 '42501','Signed-out visitors can''t upload');
RESET ROLE;

-- Unloading at the shop: due pieces come off, one due later is flagged, and
-- the crate left behind turns up as extra.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011",
 "pieces":["HU-A0001"],"zoneId":"2b111111-1111-4111-8111-111111111111"}')$q$,'22023','Areas are only for this project''s own yards');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011","pieces":["MAT-2"]}')$q$,
 '22023','A piece on another load can''t come off this one');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011","pieces":["HU-C0001"]}')$q$,
 '22023','A nested crate comes off with its crate');
INSERT INTO results VALUES('off1',pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011",
 "pieces":["HU-A0001","ROTOR-1","MAT-1","HU-B0001"]}'));
SELECT pg_temp.assert_true((SELECT (result->>'delivered')::integer=4 AND (result->>'extra')::integer=1 AND (result->>'wrong_stop')::integer=1
 FROM results WHERE name='off1'),'Four pieces come off: one extra, one due elsewhere');
SELECT pg_temp.assert_true((SELECT status='delivered' AND place_name='Rewind Shop' FROM public.handling_unit_overview WHERE code='HU-A0001')
 AND (SELECT status='delivered' FROM public.handling_units WHERE code='HU-B0001'),'Unloaded crates are delivered at the shop');
SELECT pg_temp.assert_true((SELECT top_code='HU-B0001' AND place_name='Rewind Shop' FROM public.handling_unit_overview WHERE code='HU-C0001'),
 'A nested crate arrives with its crate');
SELECT pg_temp.assert_true((SELECT status='arrived' AND arrived_source='scan' FROM public.load_stops WHERE id='5d000000-0000-4000-8000-000000000011'),
 'The first scan marks the stop arrived');
SELECT pg_temp.assert_true((SELECT delivered_place='Rewind Shop' AND is_current_position FROM public.load_line_overview WHERE tag='ROTOR-1'),
 'A loose item''s current position is where it came off');
SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011"}');

-- The last stop: the pump wasn't scanned off, so it's missing and the load
-- is delivered. Only office staff confirm without scanning or close.
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000012","confirmAll":true}')$q$,
 '42501','Only office staff confirm delivery without scanning');
INSERT INTO results VALUES('done1',pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000012"}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='delivered' AND (result->>'stop_missing')::integer=1 FROM results WHERE name='done1'),
 'The last stop finishes the load with the pump missing');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_close','{"loadId":"1d000000-0000-4000-8000-000000000001"}')$q$,'42501','Field users can''t close a load');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('line_found',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='PUMP-1' AND status='missing'),
 'placeId','9b333333-3333-4333-8333-333333333333'))$q$,'42501','Field users can''t mark a piece found');

SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_close','{"loadId":"1d000000-0000-4000-8000-000000000001"}');
SELECT pg_temp.op('line_found',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='PUMP-1' AND status='missing'),
 'placeId','9b333333-3333-4333-8333-333333333333','note','Found in the truck''s side box'));
SELECT pg_temp.assert_true((SELECT status='closed' AND delivered_count=5 AND missing_count=0 AND flagged_count=3 AND stops_done=2
 FROM public.load_overview WHERE id='1d000000-0000-4000-8000-000000000001'),'The closed load adds up');

-- The office confirms an outside shop's delivery without scanning.
INSERT INTO results VALUES('done2',pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000002","stopId":"5d000000-0000-4000-8000-000000000021","confirmAll":true}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='delivered' AND (result->>'stop_delivered')::integer=1 FROM results WHERE name='done2'),
 'Office confirmation delivers the pieces');
SELECT pg_temp.assert_true((SELECT delivered_source='office' FROM public.load_lines WHERE tag='MAT-2'),'It says the office confirmed it');

-- A return trip from the shop, cancelled before it leaves: the crate goes
-- back to delivered.
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000003","originPlaceId":"9b222222-2222-4222-8222-222222222222","driverName":"Rosa Ortiz",
 "stops":[{"id":"5d000000-0000-4000-8000-000000000031","placeId":"9b111111-1111-4111-8111-111111111111"}]}');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000003","pieces":[{"code":"HU-A0001","dropoffStopId":"5d000000-0000-4000-8000-000000000031"}]}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_close','{"loadId":"1d000000-0000-4000-8000-000000000003","cancel":true}')$q$,'42501','Field users can''t cancel a load');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_close','{"loadId":"1d000000-0000-4000-8000-000000000003","cancel":true}');
SELECT pg_temp.assert_true((SELECT status='delivered' FROM public.handling_units WHERE code='HU-A0001')
 AND (SELECT status='cancelled' FROM public.loads WHERE id='1d000000-0000-4000-8000-000000000003'),'Cancelling puts the crate back');

-- The return trip again, loaded by the office with nobody to scan at the
-- shop, then unloaded into an area at our yard.
RESET ROLE;
INSERT INTO public.site_maps(id,project_id,name) VALUES('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Yard plan');
INSERT INTO public.site_map_zones(id,map_id,project_id,name,shape) VALUES
 ('2b111111-1111-4111-8111-111111111111','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Bay 4','[[0,0],[1,0],[1,1]]');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000004","originPlaceId":"9b222222-2222-4222-8222-222222222222","driverName":"Sam Lee",
 "stops":[{"id":"5d000000-0000-4000-8000-000000000041","placeId":"9b111111-1111-4111-8111-111111111111"}]}');
SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000004","add":[{"code":"HU-A0001","dropoffStopId":"5d000000-0000-4000-8000-000000000041"}]}');
INSERT INTO results VALUES('dep4',pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000004","confirmAll":true}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='in_transit' AND (result->>'on_board')::integer=1 FROM results WHERE name='dep4'),
 'Office staff confirm the loading and the truck leaves');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000004","stopId":"5d000000-0000-4000-8000-000000000041","pieces":["HU-A0001"],
 "zoneId":"2b111111-1111-4111-8111-111111111111"}');
SELECT pg_temp.assert_true((SELECT status='delivered' AND place_name='Home Yard' AND location='Bay 4' FROM public.handling_unit_overview WHERE code='HU-A0001'),
 'Back at our yard, the crate is in the area chosen');
SELECT pg_temp.op('unpack','{"unitCode":"HU-A0001","seal":false}');
SELECT pg_temp.assert_true((SELECT status='unpacked' FROM public.handling_units WHERE code='HU-A0001'),'A delivered crate can be unpacked');

-- Removing the licence: not before 90 days after closing, and not while a
-- photo is still stored.
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT public.remove_driver_licence('1d000000-0000-4000-8000-000000000001')$q$,'22023','Licences are kept for 90 days');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.driver_licences_due_for_removal()),'Nothing is due yet');
RESET ROLE;
UPDATE public.loads SET closed_at=now()-interval '91 days' WHERE id='1d000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT storage_paths='{1d000000-0000-4000-8000-000000000001/front.jpg}' FROM public.driver_licences_due_for_removal()),
 'The office sees what is due, with its photos');
SELECT pg_temp.expect_error($q$SELECT public.remove_driver_licence('1d000000-0000-4000-8000-000000000001')$q$,'22023','Photos are deleted first');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT public.remove_driver_licence('1d000000-0000-4000-8000-000000000001')$q$,'42501','Field users can''t remove a licence');
DELETE FROM storage.objects WHERE bucket_id='driver-licences';
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
DELETE FROM storage.objects WHERE bucket_id='driver-licences';
INSERT INTO results VALUES('removed',public.remove_driver_licence('1d000000-0000-4000-8000-000000000001'));
SELECT pg_temp.assert_true((SELECT (result->>'photos_removed')::integer=1 AND (result->>'licence_removed')::boolean FROM results WHERE name='removed'),
 'The licence and its photo are removed');
SELECT pg_temp.assert_true((SELECT licence_number IS NULL AND removed_at IS NOT NULL FROM public.load_driver_licences WHERE load_id='1d000000-0000-4000-8000-000000000001'),
 'Nothing of the number is kept');
SELECT pg_temp.expect_error($q$SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000001','{"number":"TX12345"}')$q$,
 '22023','A removed licence stays removed');

-- Every write goes through the operations.
SELECT pg_temp.expect_error($q$INSERT INTO public.loads(project_id,load_number) VALUES('b1111111-1111-4111-8111-111111111111','L-0099')$q$,
 '42501','Office staff can''t write loads directly');
SELECT pg_temp.expect_error($q$UPDATE public.load_lines SET status='delivered'$q$,'42501','Lines can''t be edited directly');
SELECT pg_temp.expect_error($q$SELECT public.logistics_load_close('01111111-1111-4111-8111-111111111111',gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','{}')$q$,'42501','Internal load functions can''t be called directly');
RESET ROLE;

ROLLBACK;

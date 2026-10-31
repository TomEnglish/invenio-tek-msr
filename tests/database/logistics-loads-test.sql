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
GRANT ALL ON results TO authenticated,service_role;
CREATE FUNCTION pg_temp.opx(op_id uuid,action text,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.apply_field_operation(op_id,'b1111111-1111-4111-8111-111111111111',action,payload);
$$;
CREATE FUNCTION pg_temp.op(action text,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.opx(gen_random_uuid(),action,payload);
$$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true);
$$;

-- Pieces: counted items, received pipes and crates. HU-C0001 sits inside
-- HU-B0001, and HU-E0001 inside HU-D0001.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('count',jsonb_build_object('tag',t,'name',n,'quantity','1','isHighValue',t='VALVE-9'))
 FROM (VALUES ('CV-1','Control valve'),('FL-1','Flanges'),('ROTOR-1','Generator rotor'),('PUMP-1','Lube oil pump'),
  ('GEAR-2','Gearbox'),('VALVE-9','Turbine stop valve')) v(t,n);
SELECT pg_temp.op('receiving',jsonb_build_object('qrCodeValue',t,'material',jsonb_build_object('material_type','Pipe','size','6in','qty',4),
 'decision',jsonb_build_object('status','accepted'),'inspection',jsonb_build_object('condition','good','inspection_pass',true),
 'location',jsonb_build_object('location_id','c1111111-1111-4111-8111-111111111111'))) FROM (VALUES ('MAT-1'),('MAT-2'),('MAT-3'),('MAT-4'),('MAT-5')) v(t);
SELECT pg_temp.op('pack','{"unitCode":"HU-A0001","add":["CV-1"],"seal":true}');
SELECT pg_temp.op('pack','{"unitCode":"HU-C0001"}');
SELECT pg_temp.op('pack','{"unitCode":"HU-B0001","add":["FL-1","HU-C0001"],"seal":true}');
SELECT pg_temp.op('pack','{"unitCode":"HU-E0001","add":["GEAR-2"]}');
SELECT pg_temp.op('pack','{"unitCode":"HU-D0001","add":["MAT-3","HU-E0001"],"seal":true}');

-- A crew starts a load for a truck that turned up: it is started in the field.
INSERT INTO results VALUES('l1',pg_temp.opx('20000000-0000-4000-8000-000000000001','load_save',jsonb_build_object(
 'loadId','1d000000-0000-4000-8000-000000000001','originPlaceId','9b111111-1111-4111-8111-111111111111','truckType','Flatbed',
 'plannedDate','2026-11-30','companies',jsonb_build_array(
  jsonb_build_object('name','Gulf Freight Brokers','role','broker','phone','555-0100'),
  jsonb_build_object('name','Lone Star Haul','role','carrier','contactName','Dispatch','phone','555-0101')),
 'stops',jsonb_build_array(
  jsonb_build_object('id','5d000000-0000-4000-8000-000000000011','placeId','9b222222-2222-4222-8222-222222222222'),
  jsonb_build_object('id','5d000000-0000-4000-8000-000000000012','placeId','9b333333-3333-4333-8333-333333333333','kind','dropoff')))));
SELECT pg_temp.assert_true((SELECT result->>'load_number'='L-0001' AND result->>'status'='planning' AND (result->>'created')::boolean
 AND (result->>'started_in_field')::boolean FROM results WHERE name='l1'),'A crew''s new load is L-0001, in planning, started in the field');
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
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","notes":"Old note",
 "capturedAt":"2020-01-01T00:00:00Z"}')$q$,'22023','An edit made before the load''s latest change is refused');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","companies":[
 {"name":"Gulf Freight Brokers","role":"broker","phone":"555-0100"},{"name":"Lone Star Haul","role":"carrier","phone":"555-0101"},
 {"name":"R. Ortiz Trucking","role":"carrier","phone":"555-0102"}]}');
SELECT pg_temp.assert_true((SELECT count(*)=3 AND max(position)=3 FROM public.load_companies WHERE load_id='1d000000-0000-4000-8000-000000000001'),
 'The company list is replaced, up to three');

-- The office plans L-0002. A crew can't change its plan or stops.
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
INSERT INTO results VALUES('l2',pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000002","originPlaceId":"9b111111-1111-4111-8111-111111111111",
 "driverName":"Sam Lee","stops":[{"id":"5d000000-0000-4000-8000-000000000021","placeId":"9b222222-2222-4222-8222-222222222222"}]}'));
SELECT pg_temp.assert_true((SELECT result->>'load_number'='L-0002' AND NOT (result->>'started_in_field')::boolean FROM results WHERE name='l2'),
 'The next load is L-0002, planned by the office');
SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000002","add":[
 {"code":"MAT-2","dropoffStopId":"5d000000-0000-4000-8000-000000000021"},{"code":"PUMP-1","dropoffStopId":"5d000000-0000-4000-8000-000000000021"}]}');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000002","remove":["MAT-2"]}')$q$,
 '42501','A crew can''t change the office''s plan');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000002","stops":[]}')$q$,
 '42501','A crew can''t change the office''s stops');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000002","truckNumber":"TX-5520"}');
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
 {"code":"HU-D0001","dropoffStopId":"5d000000-0000-4000-8000-000000000012"},
 {"code":"ROTOR-1","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}');
SELECT pg_temp.assert_true((SELECT planned_count=4 FROM public.load_overview WHERE id='1d000000-0000-4000-8000-000000000001'),'Four pieces are planned');
SELECT pg_temp.assert_true((SELECT load_number='L-0001' AND load_line_status='planned' FROM public.handling_unit_overview WHERE code='HU-A0001'),
 'A planned crate shows its load');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"HU-C0001","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}')$q$,
 '22023','A crate inside a crate travels with it');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"CV-1","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}')$q$,
 '22023','A packed item travels with its crate');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"MAT-2","dropoffStopId":"5d000000-0000-4000-8000-000000000011"}]}')$q$,
 '22023','A piece is on one load at a time');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"MAT-5","dropoffStopId":"5d000000-0000-4000-8000-000000000021"}]}')$q$,
 '22023','A drop-off stop belongs to the same load');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"MAT-5"}]}')$q$,
 '22023','A planned piece needs a drop-off stop');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[{"code":"MAT-5",
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
-- a mistaken scan can be undone; a piece planned on a load that hasn't left
-- moves over when asked; with partial, bad tags come back refused.
INSERT INTO results VALUES('on1',pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":["HU-A0001","ROTOR-1","HU-D0001",
 {"code":"MAT-1","dropoffStopId":"5d000000-0000-4000-8000-000000000012"}]}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='loading' AND (result->>'on_board')::integer=4 AND (result->>'planned')::integer=1
 FROM results WHERE name='on1'),'Loading starts and four pieces are on board');
SELECT pg_temp.assert_true((SELECT status='on_load' FROM public.handling_units WHERE code='HU-A0001'),'A crate on board is on a load');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":["MAT-5"]}')$q$,
 '22023','An unplanned piece needs a drop-off stop');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":[{"code":"PUMP-1","dropoffStopId":"5d000000-0000-4000-8000-000000000012"}]}')$q$,
 '22023','A piece planned on another load isn''t taken without asking');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":[{"code":"PUMP-1","dropoffStopId":"5d000000-0000-4000-8000-000000000012","move":true}]}');
SELECT pg_temp.assert_true((SELECT status='removed' FROM public.load_lines WHERE tag='PUMP-1' AND load_id='1d000000-0000-4000-8000-000000000002'),
 'Moving a piece takes it off the other load''s plan');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","undo":["PUMP-1"]}');
SELECT pg_temp.assert_true((SELECT status='removed' FROM public.load_lines WHERE tag='PUMP-1' AND load_id='1d000000-0000-4000-8000-000000000001'),
 'An undone field addition is taken off');
INSERT INTO results VALUES('partial',pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","partial":true,"pieces":[
 {"code":"PUMP-1","dropoffStopId":"5d000000-0000-4000-8000-000000000012"},{"code":"VALVE-9","dropoffStopId":"5d000000-0000-4000-8000-000000000012"},
 {"code":"NOPE-9","dropoffStopId":"5d000000-0000-4000-8000-000000000012"}]}'));
SELECT pg_temp.assert_true((SELECT (result->>'on_board')::integer=6 AND jsonb_array_length(result->'refused')=1 AND result#>>'{refused,0,code}'='NOPE-9'
 FROM results WHERE name='partial'),'With partial, good scans go on and a bad tag comes back refused');
SELECT pg_temp.assert_true((SELECT is_high_value FROM public.load_line_overview WHERE tag='VALVE-9'),'The manifest shows high-value items');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011","pieces":["MAT-5"]}')$q$,
 '22023','Before leaving, pieces go on without a stop');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('pack','{"unitCode":"HU-A0001"}')$q$,'22023','A crate on a truck can''t be repacked');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('unpack','{"unitCode":"HU-A0001"}')$q$,'22023','A crate on a truck can''t be unpacked');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('issue',(SELECT jsonb_build_object('materialId',m.id,'quantity',1,'jobNumber','J-1')
 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-1'))$q$,'22023','Stock on a truck isn''t issued');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('issue',(SELECT jsonb_build_object('materialId',m.id,'quantity',1,'jobNumber','J-1')
 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-3'))$q$,'22023','Stock in a crate on a truck isn''t issued');
SELECT pg_temp.assert_true((SELECT load_number='L-0001' AND load_line_status='on_board' AND top_status='on_load'
 FROM public.handling_unit_overview WHERE code='HU-A0001'),'The crate shows it is on board L-0001');
SELECT pg_temp.assert_true((SELECT position='on_load' AND load_number='L-0001' FROM public.item_positions WHERE tag='MAT-3'),
 'An item in a crate on a truck is on that load');

-- Leaving: the driver's name and licence come first. Crews can't let a
-- truck leave without the licence; office staff can, with a reason.
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001"}')$q$,'22023','The driver''s name comes first');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","driverName":"Rosa Ortiz","driverPhone":"555-0199","truckNumber":"TX-4410","trailerNumber":"TR-88"}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001"}')$q$,'22023','The licence comes before the truck leaves');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001","overrideReason":"Driver forgot it"}')$q$,
 '42501','Only office staff let a truck leave without the licence');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001","confirmAll":true}')$q$,
 '42501','Only office staff confirm loading without scanning');

-- The licence: recorded by the field, readable only by the office, never in
-- field_operations or in full in the audit log. A late retry never
-- overwrites a newer correction.
INSERT INTO results VALUES('lic',public.record_driver_licence('30000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001',
 '{"number":"tx 9q7z  5678","state":"TX","expiry":"2029-05-31"}'));
SELECT pg_temp.assert_true((SELECT result->>'last4'='5678' FROM results WHERE name='lic'),'Recording a licence answers with its last four characters');
SELECT pg_temp.expect_error($q$SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000001','{"number":"!!"}')$q$,
 '22023','A licence number has a format');
SELECT pg_temp.expect_error($q$SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000099','{"number":"TX12345"}')$q$,
 '42501','Another project''s load is refused');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.load_driver_licences),'Field users can''t read licences');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT public.record_driver_licence('30000000-0000-4000-8000-000000000002','1d000000-0000-4000-8000-000000000001','{"number":"TX 9Q7Z 4321","state":"TX"}');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((public.record_driver_licence('30000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001',
 '{"number":"tx 9q7z  5678","state":"TX","expiry":"2029-05-31"}')->>'recorded')::boolean,'A repeated licence call is answered');
SELECT pg_temp.expect_error($q$SELECT public.record_driver_licence('30000000-0000-4000-8000-000000000003','1d000000-0000-4000-8000-000000000001',
 '{"number":"TX 9Q7Z 1111","capturedAt":"2020-01-01T00:00:00Z"}')$q$,'22023','A licence recorded before a newer correction is refused');
SELECT pg_temp.assert_true((SELECT licence_recorded_at IS NOT NULL FROM public.load_overview WHERE id='1d000000-0000-4000-8000-000000000001'),
 'Everyone can see that a licence is on file');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT licence_number='TX 9Q7Z 4321' AND licence_state='TX' FROM public.load_driver_licences
 WHERE load_id='1d000000-0000-4000-8000-000000000001'),'Office staff read the licence, and the late retry didn''t overwrite the correction');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.field_operations WHERE payload::text ILIKE '%9q7z%')
 AND NOT EXISTS(SELECT 1 FROM public.audit_log WHERE details::text ILIKE '%9q7z%'),'The full number is in neither field_operations nor the audit log');

-- Licence photos: field staff upload and attach but can't read them back;
-- each load keeps at most four files, named <load id>/<name>.jpg.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001"}')$q$,'22023','A number alone isn''t enough; a photo is needed');
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
SELECT pg_temp.expect_error($q$INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000001/sub/x.jpg')$q$,
 '42501','Photos can''t go in sub-folders');
SELECT pg_temp.expect_error($q$INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000001/front.gif')$q$,
 '42501','Photos are JPEG or PNG files');
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('driver-licences','1d000000-0000-4000-8000-000000000001/back.jpg'),
 ('driver-licences','1d000000-0000-4000-8000-000000000001/stray.jpg'),
 ('driver-licences','1d000000-0000-4000-8000-000000000001/side.png');
SELECT pg_temp.expect_error($q$INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000001/fifth.jpg')$q$,
 '42501','A load keeps at most four licence files');
DELETE FROM storage.objects WHERE bucket_id='driver-licences';
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM storage.objects WHERE bucket_id='driver-licences')
 AND (SELECT count(*)=1 FROM public.driver_licence_photos),'Office staff see the files, one attached, and the field delete removed nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000001/anon.jpg')$q$,
 '42501','Signed-out visitors can''t upload');
RESET ROLE;

-- With the licence on file the truck leaves; the crate that didn't go on is
-- left behind until a second phone's scan, made before the truck left,
-- uploads.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
INSERT INTO results VALUES('dep1',pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000001"}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='in_transit' AND (result->>'not_loaded')::integer=1 FROM results WHERE name='dep1'),
 'The truck leaves and the crate not scanned on stays behind');
SELECT pg_temp.assert_true((SELECT status='sealed' FROM public.handling_units WHERE code='HU-B0001'),'A crate left behind keeps its state');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":["HU-B0001"]}')$q$,
 '22023','After leaving, a scan without a stop needs to have been made before departure');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000001","pieces":["HU-B0001"],"capturedAt":"2020-01-01T08:00:00Z"}');
SELECT pg_temp.assert_true((SELECT l.status='on_board' AND l.pickup_stop_id IS NULL AND u.status='on_load' FROM public.load_lines l
 JOIN public.handling_units u ON u.id=l.unit_id WHERE l.tag='HU-B0001'),'A scan made before departure counts once it uploads');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000001","add":[]}')$q$,'22023','The plan is fixed once the truck leaves');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[]}')$q$,
 '42501','Crews can''t change stops once the truck leaves');

-- Office staff add a stop the truck hasn't reached.
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[
 {"id":"5d000000-0000-4000-8000-000000000011","placeId":"9b222222-2222-4222-8222-222222222222"},
 {"id":"5d000000-0000-4000-8000-000000000012","placeId":"9b333333-3333-4333-8333-333333333333"},
 {"id":"5d000000-0000-4000-8000-000000000013","placeId":"9b111111-1111-4111-8111-111111111111"}]}');
SELECT pg_temp.assert_true((SELECT string_agg(place_name,',' ORDER BY seq)='Rewind Shop,Field Site,Home Yard' FROM public.load_stop_overview
 WHERE load_id='1d000000-0000-4000-8000-000000000001'),'After departure, the office can add a stop it hasn''t reached');

-- L-0002 leaves without a licence, on the office's say-so, and only from a
-- shop or vendor can it be confirmed without scanning.
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000002","pieces":["MAT-2"]}');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000002","confirmAll":true,"overrideReason":"Broker emailed it"}')$q$,
 '22023','Confirm without scanning is only for loads leaving a shop or vendor');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000002","overrideReason":"no"}')$q$,
 '22023','An override needs a real reason');
SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000002","overrideReason":"Broker emailed the licence; photo to follow"}');
SELECT pg_temp.assert_true((SELECT status='in_transit' AND licence_override_at IS NOT NULL AND licence_override_reason LIKE 'Broker%'
 FROM public.load_overview WHERE id='1d000000-0000-4000-8000-000000000002'),'The override and its reason are recorded on the load');

-- Unloading at the shop: due pieces come off, ones due later are flagged,
-- and a piece that was never on the truck is extra.
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011",
 "pieces":["HU-A0001"],"zoneId":"2b111111-1111-4111-8111-111111111111"}')$q$,'42501','An area has to be on a site plan of this project');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011","pieces":["MAT-2"]}')$q$,
 '22023','A piece on another load can''t come off this one');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011","pieces":["HU-C0001"]}')$q$,
 '22023','A nested crate comes off with its crate');
INSERT INTO results VALUES('off1',pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011",
 "pieces":["HU-A0001","ROTOR-1","MAT-1","HU-B0001","MAT-4"]}'));
SELECT pg_temp.assert_true((SELECT (result->>'delivered')::integer=5 AND (result->>'extra')::integer=1 AND (result->>'wrong_stop')::integer=2
 FROM results WHERE name='off1'),'Five pieces come off: one extra, two due elsewhere');
SELECT pg_temp.assert_true((SELECT status='delivered' AND place_name='Rewind Shop' FROM public.handling_unit_overview WHERE code='HU-A0001')
 AND (SELECT status='delivered' FROM public.handling_units WHERE code='HU-B0001'),'Unloaded crates are delivered at the shop');
SELECT pg_temp.assert_true((SELECT top_code='HU-B0001' AND place_name='Rewind Shop' FROM public.handling_unit_overview WHERE code='HU-C0001'),
 'A nested crate arrives with its crate');
SELECT pg_temp.assert_true((SELECT position='at_place' AND place_name='Rewind Shop' FROM public.item_positions WHERE tag='ROTOR-1')
 AND (SELECT position='in_crate' AND place_name='Rewind Shop' FROM public.item_positions WHERE tag='CV-1'),
 'A loose item is where it came off, and a packed one where its crate is');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('transfer',(SELECT jsonb_build_object('materialId',m.id,'fromLocationId',m.location_id,
 'toLocationId','c1111111-1111-4111-8111-111111111111') FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-4'))$q$,
 '22023','An item at a shop isn''t moved to a yard rack');
SELECT pg_temp.assert_true((SELECT status='arrived' AND arrived_source='scan' FROM public.load_stops WHERE id='5d000000-0000-4000-8000-000000000011'),
 'The first scan marks the stop arrived');
SELECT pg_temp.assert_true((SELECT delivered_place='Rewind Shop' AND is_current_position FROM public.load_line_overview WHERE tag='ROTOR-1'),
 'A loose item''s current position is where it came off');

-- Only office staff finish a stop at a shop; the truck has been there, so
-- the stop stays.
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011"}')$q$,
 '42501','Crews don''t finish stops at outside shops');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000001","stops":[
 {"id":"5d000000-0000-4000-8000-000000000012","placeId":"9b333333-3333-4333-8333-333333333333"},
 {"id":"5d000000-0000-4000-8000-000000000013","placeId":"9b111111-1111-4111-8111-111111111111"}]}')$q$,'22023','A stop the truck reached stays on the load');
SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011"}');

-- At the site a later scan corrects where a piece came off; an older scan
-- that uploads late changes nothing.
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
INSERT INTO results VALUES('fix1',pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000012","pieces":["MAT-1"]}'));
SELECT pg_temp.assert_true((SELECT (result->>'corrected')::integer=1 FROM results WHERE name='fix1')
 AND (SELECT flag IS NULL AND delivered_place='Field Site' FROM public.load_line_overview WHERE tag='MAT-1'),'A later scan corrects the stop and clears the flag');
SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000011","pieces":["MAT-1"],
 "capturedAt":"2020-01-01T09:00:00Z"}');
SELECT pg_temp.assert_true((SELECT delivered_place='Field Site' FROM public.load_line_overview WHERE tag='MAT-1'),'An older scan doesn''t move it back');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000012","confirmAll":true}')$q$,
 '42501','Only office staff confirm delivery without scanning');
INSERT INTO results VALUES('done12',pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000012"}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='in_transit' AND (result->>'stop_missing')::integer=3 FROM results WHERE name='done12'),
 'Three pieces weren''t scanned off at the site and are missing');
SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000013"}');
SELECT pg_temp.assert_true((SELECT status='delivered' FROM public.loads WHERE id='1d000000-0000-4000-8000-000000000001'),'The last stop finishes the load');

-- Until the load closes, a scan clears "missing". What's really gone is
-- written off by the office, with what it held; an administrator can undo it.
INSERT INTO results VALUES('late',pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000001","stopId":"5d000000-0000-4000-8000-000000000012","pieces":["PUMP-1"]}'));
SELECT pg_temp.assert_true((SELECT status='delivered' AND flag='found' FROM public.load_lines WHERE tag='PUMP-1' AND load_id='1d000000-0000-4000-8000-000000000001'
 AND status<>'removed'),'A scan after the last stop still finds a missing piece');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('line_write_off',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='VALVE-9'),
 'reason','Fell off the truck'))$q$,'42501','Crews don''t write off pieces');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_close','{"loadId":"1d000000-0000-4000-8000-000000000001"}')$q$,'42501','Field users can''t close a load');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('load_close','{"loadId":"1d000000-0000-4000-8000-000000000001"}')$q$,'22023','A load with missing pieces doesn''t close');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('line_write_off',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='ROTOR-1'),
 'reason','Not really lost'))$q$,'22023','Only a missing piece is written off');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('line_write_off',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='VALVE-9'),'reason','x'))$q$,
 '22023','A write-off needs a reason');
SELECT pg_temp.op('line_write_off',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='VALVE-9'),'reason','Not at the site; carrier claim CL-77'));
INSERT INTO results VALUES('wo',pg_temp.op('line_write_off',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='HU-D0001'),
 'reason','Crate lost in transit; carrier claim CL-78')));
SELECT pg_temp.assert_true((SELECT (result->>'units')::integer=2 AND (result->>'materials')::integer=1 AND (result->>'items')::integer=1 FROM results WHERE name='wo'),
 'Writing off a crate covers the crate inside it and both items');
SELECT pg_temp.assert_true((SELECT bool_and(status='written_off') FROM public.handling_units WHERE code IN ('HU-D0001','HU-E0001'))
 AND (SELECT m.status='written_off' AND m.current_quantity=0 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-3')
 AND (SELECT written_off_at IS NOT NULL FROM public.inventory_records WHERE qr_code='GEAR-2')
 AND (SELECT position='gone' FROM public.item_positions WHERE tag='VALVE-9'),'Written-off crates and items are gone');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('count','{"tag":"GEAR-2","name":"Gearbox","quantity":"1"}')$q$,'22023','A written-off item isn''t recounted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('pack','{"unitCode":"HU-X0002","add":["MAT-3"]}')$q$,'22023','A written-off item isn''t packed');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_close','{"loadId":"1d000000-0000-4000-8000-000000000001"}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('line_write_off_undo',jsonb_build_object('writeOffId',(SELECT result->>'write_off_id' FROM results WHERE name='wo'),
 'reason','Found at the depot'))$q$,'42501','Only an administrator undoes a write-off');
SELECT pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('line_write_off_undo',jsonb_build_object('writeOffId',(SELECT result->>'write_off_id' FROM results WHERE name='wo'),'reason','Found at the carrier''s depot'));
SELECT pg_temp.assert_true((SELECT status='missing' FROM public.handling_units WHERE code='HU-D0001')
 AND (SELECT status='open' FROM public.handling_units WHERE code='HU-E0001')
 AND (SELECT m.status='in_yard' AND m.current_quantity=4 FROM public.materials m JOIN public.qr_codes q ON q.id=m.qr_code_id WHERE q.code_value='MAT-3')
 AND (SELECT written_off_at IS NULL FROM public.inventory_records WHERE qr_code='GEAR-2'),'Undoing a write-off puts everything back as it was');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('line_write_off_undo',jsonb_build_object('writeOffId',(SELECT result->>'write_off_id' FROM results WHERE name='wo'),
 'reason','Again'))$q$,'22023','A write-off is undone once');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('line_found',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='HU-D0001' AND status='missing'),
 'placeId','9b333333-3333-4333-8333-333333333333'))$q$,'42501','Field users can''t mark a piece found');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('line_found',jsonb_build_object('lineId',(SELECT id FROM public.load_lines WHERE tag='HU-D0001' AND status='missing'),
 'placeId','9b333333-3333-4333-8333-333333333333','note','At the carrier''s depot'));
SELECT pg_temp.assert_true((SELECT status='closed' AND delivered_count=7 AND missing_count=0 AND written_off_count=1 AND flagged_count=4 AND stops_done=3
 FROM public.load_overview WHERE id='1d000000-0000-4000-8000-000000000001'),'The closed load adds up');

-- The office finishes L-0002 at the shop, confirming without scanning.
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000002","stopId":"5d000000-0000-4000-8000-000000000021"}')$q$,
 '42501','Crews don''t finish shop stops on the office''s loads either');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
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
INSERT INTO results VALUES('dep4',pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000004","confirmAll":true,
 "overrideReason":"Shop loaded it after hours; licence by email"}'));
SELECT pg_temp.assert_true((SELECT result->>'status'='in_transit' AND (result->>'on_board')::integer=1 FROM results WHERE name='dep4'),
 'Office staff confirm the loading at the shop and the truck leaves');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000004","stopId":"5d000000-0000-4000-8000-000000000041","pieces":["HU-A0001"],
 "zoneId":"2b111111-1111-4111-8111-111111111111"}');
SELECT pg_temp.assert_true((SELECT status='delivered' AND place_name='Home Yard' AND location='Bay 4' FROM public.handling_unit_overview WHERE code='HU-A0001'),
 'Back at our yard, the crate is in the area chosen');
SELECT pg_temp.op('unpack','{"unitCode":"HU-A0001","seal":false}');
SELECT pg_temp.assert_true((SELECT status='unpacked' FROM public.handling_units WHERE code='HU-A0001')
 AND (SELECT position='at_place' AND area='Bay 4' AND place_name='Home Yard' FROM public.item_positions WHERE tag='CV-1'),
 'A delivered crate can be unpacked, and what was in it is where the crate was');

-- A pick-up at a shop on the way: when the office confirms the stop, the
-- piece to collect goes on board.
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_save','{"loadId":"1d000000-0000-4000-8000-000000000005","originPlaceId":"9b111111-1111-4111-8111-111111111111","driverName":"Ana Ruiz",
 "stops":[{"id":"5d000000-0000-4000-8000-000000000051","placeId":"9b222222-2222-4222-8222-222222222222","kind":"both"},
  {"id":"5d000000-0000-4000-8000-000000000052","placeId":"9b111111-1111-4111-8111-111111111111"}]}');
SELECT pg_temp.op('load_plan','{"loadId":"1d000000-0000-4000-8000-000000000005","add":[
 {"code":"MAT-5","dropoffStopId":"5d000000-0000-4000-8000-000000000051"},
 {"code":"ROTOR-1","pickupStopId":"5d000000-0000-4000-8000-000000000051","dropoffStopId":"5d000000-0000-4000-8000-000000000052"}]}');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_on','{"loadId":"1d000000-0000-4000-8000-000000000005","pieces":["MAT-5"]}');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_depart','{"loadId":"1d000000-0000-4000-8000-000000000005","overrideReason":"Regular driver; licence on file with the carrier"}');
INSERT INTO results VALUES('pick',pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000005","stopId":"5d000000-0000-4000-8000-000000000051","confirmAll":true}'));
SELECT pg_temp.assert_true((SELECT (result->>'stop_delivered')::integer=1 AND (result->>'picked_up')::integer=1 FROM results WHERE name='pick')
 AND (SELECT status='on_board' FROM public.load_lines WHERE tag='ROTOR-1' AND load_id='1d000000-0000-4000-8000-000000000005'),
 'Confirming a shop stop delivers what was due and boards what was to be collected');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.op('load_off','{"loadId":"1d000000-0000-4000-8000-000000000005","stopId":"5d000000-0000-4000-8000-000000000052","pieces":["ROTOR-1"]}');
SELECT pg_temp.op('stop_complete','{"loadId":"1d000000-0000-4000-8000-000000000005","stopId":"5d000000-0000-4000-8000-000000000052"}');
SELECT pg_temp.assert_true((SELECT position='at_place' AND place_name='Home Yard' FROM public.item_positions WHERE tag='ROTOR-1'),
 'The collected piece is back at our yard');

-- Office staff remove a wrong photo, or a whole licence, before it is due,
-- with a reason; it can then be recorded again.
SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000005','{"number":"NM 5555 777"}');
INSERT INTO storage.objects(bucket_id,name) VALUES('driver-licences','1d000000-0000-4000-8000-000000000005/front.jpg');
SELECT public.attach_driver_licence_photo('1d000000-0000-4000-8000-000000000005','1d000000-0000-4000-8000-000000000005/front.jpg');
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT public.remove_driver_licence_photo('1d000000-0000-4000-8000-000000000005/front.jpg')$q$,'22023','A photo is deleted from storage first');
DELETE FROM storage.objects WHERE bucket_id='driver-licences' AND name='1d000000-0000-4000-8000-000000000005/front.jpg';
SELECT public.remove_driver_licence_photo('1d000000-0000-4000-8000-000000000005/front.jpg');
SELECT pg_temp.assert_true((SELECT removed_at IS NOT NULL FROM public.driver_licence_photos WHERE storage_path='1d000000-0000-4000-8000-000000000005/front.jpg'),
 'Office staff remove a wrong photo at any time');
SELECT pg_temp.expect_error($q$SELECT public.remove_driver_licence('1d000000-0000-4000-8000-000000000005')$q$,'22023','Removing a licence early needs a reason');
SELECT public.remove_driver_licence('1d000000-0000-4000-8000-000000000005','Wrong driver''s licence recorded');
SELECT pg_temp.assert_true((SELECT licence_recorded_at IS NULL FROM public.loads WHERE id='1d000000-0000-4000-8000-000000000005')
 AND (SELECT licence_number IS NULL FROM public.load_driver_licences WHERE load_id='1d000000-0000-4000-8000-000000000005'),
 'A removed licence is no longer on file');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000005','{"number":"NM 5555 778"}');
SELECT pg_temp.expect_error($q$SELECT public.remove_driver_licence('1d000000-0000-4000-8000-000000000005','Mistake')$q$,'42501','Field users can''t remove a licence');

-- Crews see activity without licences, phone numbers or whole records.
SELECT pg_temp.assert_true((SELECT count(*)>0 AND count(*) FILTER (WHERE action LIKE 'driver_licence%')=0
 AND count(*) FILTER (WHERE details ? 'before' OR details ? 'after' OR details::text LIKE '%555-0199%')=0
 FROM public.list_project_activity('b1111111-1111-4111-8111-111111111111',null,200)),'Crews see activity without licence or driver details');

-- A project with loads still open can't be completed or archived.
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE public.projects SET status='completed' WHERE id='b1111111-1111-4111-8111-111111111111'$q$,
 '22023','A project closes its loads before it is completed');

-- The daily job removes licences that are due: 90 days after a load closes,
-- or after its last activity if it never closes. It deletes every file in
-- the load's folder first.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.driver_licences_due_for_removal()),'Nothing is due yet');
SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000002','{"number":"TX 2222 333"}');
RESET ROLE;
UPDATE public.loads SET closed_at=now()-interval '91 days' WHERE id='1d000000-0000-4000-8000-000000000001';
ALTER TABLE public.loads DISABLE TRIGGER loads_updated_at;
ALTER TABLE public.load_lines DISABLE TRIGGER load_lines_updated_at;
ALTER TABLE public.load_stops DISABLE TRIGGER load_stops_updated_at;
UPDATE public.loads SET updated_at=now()-interval '91 days' WHERE id='1d000000-0000-4000-8000-000000000002';
UPDATE public.load_lines SET updated_at=now()-interval '91 days' WHERE load_id='1d000000-0000-4000-8000-000000000002';
UPDATE public.load_stops SET updated_at=now()-interval '91 days' WHERE load_id='1d000000-0000-4000-8000-000000000002';
ALTER TABLE public.loads ENABLE TRIGGER loads_updated_at;
ALTER TABLE public.load_lines ENABLE TRIGGER load_lines_updated_at;
ALTER TABLE public.load_stops ENABLE TRIGGER load_stops_updated_at;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT array_length(storage_paths,1)=4 FROM public.driver_licences_due_for_removal()
 WHERE load_id='1d000000-0000-4000-8000-000000000001'),'The office sees what is due, with every file in its folder');
SELECT pg_temp.expect_error($q$SELECT public.purge_driver_licence('1d000000-0000-4000-8000-000000000001')$q$,'42501','Only the server job purges');
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO results SELECT 'queue',jsonb_agg(to_jsonb(q)) FROM public.driver_licence_purge_queue() q;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM results,jsonb_array_elements(result) e WHERE name='queue'
 AND e->>'load_id' IN ('1d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000002')),
 'The job finds a closed load''s licence and one whose load went quiet');
SELECT pg_temp.expect_error($q$SELECT public.purge_driver_licence('1d000000-0000-4000-8000-000000000001')$q$,'22023','Files are deleted first');
DELETE FROM storage.objects WHERE bucket_id='driver-licences' AND split_part(name,'/',1)='1d000000-0000-4000-8000-000000000001';
INSERT INTO results VALUES('purge1',public.purge_driver_licence('1d000000-0000-4000-8000-000000000001'));
INSERT INTO results VALUES('purge2',public.purge_driver_licence('1d000000-0000-4000-8000-000000000002'));
SELECT pg_temp.assert_true((SELECT (result->>'photos_removed')::integer=1 AND (result->>'licence_removed')::boolean FROM results WHERE name='purge1')
 AND (SELECT (result->>'licence_removed')::boolean FROM results WHERE name='purge2'),'The job removes the licences and photos');
SELECT pg_temp.expect_error($q$SELECT public.purge_driver_licence('1d000000-0000-4000-8000-000000000005')$q$,'22023','A licence that isn''t due stays');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT bool_and(licence_number IS NULL AND removed_at IS NOT NULL) FROM public.load_driver_licences
 WHERE load_id IN ('1d000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000002'))
 AND (SELECT licence_recorded_at IS NULL FROM public.loads WHERE id='1d000000-0000-4000-8000-000000000001'),'Nothing of the numbers is kept');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$SELECT public.record_driver_licence(gen_random_uuid(),'1d000000-0000-4000-8000-000000000001','{"number":"TX12345"}')$q$,
 '22023','A licence past its retention period isn''t recorded again');

-- Every write goes through the operations.
SELECT pg_temp.expect_error($q$INSERT INTO public.loads(project_id,load_number) VALUES('b1111111-1111-4111-8111-111111111111','L-0099')$q$,
 '42501','Office staff can''t write loads directly');
SELECT pg_temp.expect_error($q$UPDATE public.load_lines SET status='delivered'$q$,'42501','Lines can''t be edited directly');
SELECT pg_temp.expect_error($q$SELECT public.logistics_load_close('01111111-1111-4111-8111-111111111111',gen_random_uuid(),
 'b1111111-1111-4111-8111-111111111111','{}')$q$,'42501','Internal load functions can''t be called directly');
SELECT pg_temp.expect_error($q$SELECT public.driver_licence_due_at('1d000000-0000-4000-8000-000000000001')$q$,'42501','Internal licence functions can''t be called directly');
RESET ROLE;

ROLLBACK;

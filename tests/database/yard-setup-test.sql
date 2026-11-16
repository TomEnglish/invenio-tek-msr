-- 030: yards, racks and site plans are set up and retired from the office screens.
BEGIN;
\ir admin-fixtures.sql

CREATE TEMP TABLE results(name text PRIMARY KEY,result jsonb);
GRANT ALL ON results TO authenticated;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true);
$$;
CREATE FUNCTION pg_temp.op(action text,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111',action,payload);
$$;
CREATE FUNCTION pg_temp.receive(tag text,rack text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.op('receiving',jsonb_build_object('qrCodeValue',tag,'material',jsonb_build_object('material_type','Pipe','size','4in','qty',5),
  'decision',jsonb_build_object('status','accepted'),'inspection',jsonb_build_object('condition','good','inspection_pass',true),
  'location',jsonb_build_object('location_id',rack)));
$$;
-- Like expect_error, for a refusal whose words the office reads.
CREATE FUNCTION pg_temp.expect_message(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual=MESSAGE_TEXT;
 END;
 IF actual IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Assertion failed: %; expected "%", received "%"',label,expected,coalesce(actual,'success');
 END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Yard names are unique within a project, not across projects.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
INSERT INTO public.places(id,kind,name,project_id) VALUES
 ('9c111111-1111-4111-8111-111111111111','yard','Laydown Yard','b1111111-1111-4111-8111-111111111111'),
 ('9c222222-2222-4222-8222-222222222222','site','North Site','b1111111-1111-4111-8111-111111111111');
INSERT INTO public.places(id,kind,name) VALUES
 ('9c444444-4444-4444-8444-444444444444','outside_shop','Rewind Shop'),
 ('9c555555-5555-4555-8555-555555555555','yard','Common Yard');
RESET ROLE;
INSERT INTO public.places(id,kind,name,project_id) VALUES
 ('9c333333-3333-4333-8333-333333333333','yard','laydown yard','b2222222-2222-4222-8222-222222222222');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.places WHERE lower(name)='laydown yard' AND is_active),
 'Two projects can each have a Laydown Yard');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name,project_id) VALUES('site','LAYDOWN YARD','b1111111-1111-4111-8111-111111111111')$q$,
 '23505','A project''s places have unique names');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name,project_id) VALUES('yard','common yard','b1111111-1111-4111-8111-111111111111')$q$,
 '23505','A project''s yard cannot take a shared place''s name');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name) VALUES('vendor','North Site')$q$,
 '23505','A shared place cannot take a project yard''s name');
SELECT pg_temp.expect_error($q$INSERT INTO public.places(kind,name) VALUES('vendor','rewind shop')$q$,
 '23505','Shared places stay unique among themselves');
SELECT pg_temp.expect_error($q$UPDATE public.places SET name='Rewind Shop' WHERE id='9c222222-2222-4222-8222-222222222222'$q$,
 '23505','A rename cannot take a shared place''s name');
SELECT pg_temp.expect_error($q$UPDATE public.places SET project_id=NULL WHERE id='9c111111-1111-4111-8111-111111111111'$q$,
 '23505','A yard cannot become shared while another project has a place of its name');

-- ---------------------------------------------------------------------------
-- Racks: office staff add and edit them for their own projects.
-- ---------------------------------------------------------------------------
INSERT INTO public.locations(id,project_id,zone,row,rack,capacity,place_id) VALUES
 ('c1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',' T1 ','1',' 1',40,'9c111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT zone='T1' AND rack='1' AND is_active AND place_id='9c111111-1111-4111-8111-111111111111' AND updated_at IS NOT NULL
 FROM public.locations WHERE id='c1111111-1111-4111-8111-111111111111'),'A rack''s names are trimmed, and it starts active at its yard');
-- The way the app and site already published add a rack: no yard, no active flag.
INSERT INTO public.locations(id,project_id,zone,row,rack,is_hold_area,capacity) VALUES
 ('c2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','HOLD','1','1',true,NULL);
INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c3333333-3333-4333-8333-333333333333','b1111111-1111-4111-8111-111111111111','T1','1','2');
SELECT pg_temp.assert_true((SELECT is_active AND place_id IS NULL AND is_hold_area FROM public.locations WHERE id='c2222222-2222-4222-8222-222222222222'),
 'Added the way an installed app adds it, a rack is active with no yard yet');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.audit_log WHERE action='rack_created' AND entity_type='rack'
 AND project_id='b1111111-1111-4111-8111-111111111111' AND user_id='01111111-1111-4111-8111-111111111111'),'Adding a rack is in the audit log');
SELECT pg_temp.expect_error($q$INSERT INTO public.locations(project_id,zone,row,rack) VALUES('b1111111-1111-4111-8111-111111111111','  ','1','3')$q$,
 '22023','A rack needs a zone, row and rack');
SELECT pg_temp.expect_error($q$INSERT INTO public.locations(project_id,zone,row,rack) VALUES('b1111111-1111-4111-8111-111111111111',repeat('Z',61),'1','3')$q$,
 '22023','Rack names have a length limit');
SELECT pg_temp.expect_error($q$INSERT INTO public.locations(project_id,zone,row,rack,capacity) VALUES('b1111111-1111-4111-8111-111111111111','T1','1','3',0)$q$,
 '22023','Capacity is a positive number or blank');
SELECT pg_temp.expect_error($q$INSERT INTO public.locations(project_id,zone,row,rack) VALUES('b1111111-1111-4111-8111-111111111111','t1','1','1 ')$q$,
 '23505','Active racks in a project have unique names, ignoring capitals and spaces');
SELECT pg_temp.expect_error($q$UPDATE public.locations SET rack='1' WHERE id='c3333333-3333-4333-8333-333333333333'$q$,
 '23505','A rack cannot be renamed onto another active rack');
SELECT pg_temp.expect_error($q$INSERT INTO public.locations(project_id,zone,row,rack) VALUES('b2222222-2222-4222-8222-222222222222','T1','1','1')$q$,
 '42501','Office staff add racks only to their own projects');
SELECT pg_temp.expect_error($q$UPDATE public.locations SET place_id='9c444444-4444-4444-8444-444444444444' WHERE id='c3333333-3333-4333-8333-333333333333'$q$,
 '42501','A rack is at a yard or site, never a shop');
SELECT pg_temp.expect_error($q$UPDATE public.locations SET place_id='9c333333-3333-4333-8333-333333333333' WHERE id='c3333333-3333-4333-8333-333333333333'$q$,
 '42501','A rack cannot be at another project''s yard');
UPDATE public.locations SET place_id='9c555555-5555-4555-8555-555555555555' WHERE id='c2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true((SELECT place_id='9c555555-5555-4555-8555-555555555555' FROM public.locations WHERE id='c2222222-2222-4222-8222-222222222222'),
 'A rack can be at a shared yard');
SELECT pg_temp.expect_error($q$DELETE FROM public.locations WHERE id='c3333333-3333-4333-8333-333333333333'$q$,'42501','Racks are retired, not deleted');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$INSERT INTO public.locations(project_id,zone,row,rack) VALUES('b1111111-1111-4111-8111-111111111111','T9','1','1')$q$,
 '42501','Field users cannot add racks');
DO $$ DECLARE changed bigint;
BEGIN
 UPDATE public.locations SET is_active=false WHERE id='c3333333-3333-4333-8333-333333333333';
 GET DIAGNOSTICS changed=ROW_COUNT;
 PERFORM pg_temp.assert_true(changed=0,'Field users cannot retire racks');
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.locations),'Field users still read their project''s racks');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE public.locations SET project_id='b2222222-2222-4222-8222-222222222222',place_id=NULL WHERE id='c3333333-3333-4333-8333-333333333333'$q$,
 '22023','A rack stays in its project');

-- ---------------------------------------------------------------------------
-- What each project still needs before work can start.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(project_id='b1111111-1111-4111-8111-111111111111' AND is_member AND own_yards=2 AND shared_yards=1
 AND racks=3 AND hold_racks=1 AND site_plans=0) FROM public.project_setup_status()),'Office staff see what their own projects have set up');
SELECT pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
-- (The starter project the migrations create is listed too.)
SELECT pg_temp.assert_true((SELECT count(*) FILTER (WHERE project_id IN ('b1111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222'))=2
 FROM public.project_setup_status()),'An administrator sees every project, assigned to it or not');
SELECT pg_temp.assert_true((SELECT NOT is_member AND own_yards=1 AND shared_yards=1 AND racks=0 AND hold_racks=0 AND site_plans=0
 FROM public.project_setup_status('b2222222-2222-4222-8222-222222222222')),'A project with only a yard shows what it still lacks');
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.project_setup_status()),'Field users are not shown setup');
RESET ROLE;
UPDATE public.projects SET status='archived' WHERE id='b2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*) FILTER (WHERE project_id='b2222222-2222-4222-8222-222222222222')=0
 AND count(*) FILTER (WHERE project_id='b1111111-1111-4111-8111-111111111111')=1 FROM public.project_setup_status()),'An archived project is not listed');
RESET ROLE;
UPDATE public.projects SET status='active' WHERE id='b2222222-2222-4222-8222-222222222222';

-- ---------------------------------------------------------------------------
-- A rack can't be retired while items are on it, and a retired rack takes
-- nothing new.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
INSERT INTO results VALUES('ys1',pg_temp.receive('YS-1','c1111111-1111-4111-8111-111111111111'));
INSERT INTO results VALUES('ys2',pg_temp.receive('YS-2','c1111111-1111-4111-8111-111111111111'));
SELECT pg_temp.expect_message($q$UPDATE public.locations SET is_active=false WHERE id='c1111111-1111-4111-8111-111111111111'$q$,
 'T1 · Row 1, Rack 1 can''t be retired yet: it still holds 2 items; move them to another rack first','A rack holding items says how many');
SELECT pg_temp.expect_error($q$UPDATE public.locations SET is_active=false WHERE id='c1111111-1111-4111-8111-111111111111'$q$,
 '22023','The refusal is one the app treats as needing a decision');
SELECT pg_temp.op('transfer',jsonb_build_object('materialId',(SELECT result->>'material_id' FROM results WHERE name='ys1'),
 'fromLocationId','c1111111-1111-4111-8111-111111111111','toLocationId','c3333333-3333-4333-8333-333333333333','reason','Clearing the rack'));
SELECT pg_temp.expect_message($q$UPDATE public.locations SET is_active=false WHERE id='c1111111-1111-4111-8111-111111111111'$q$,
 'T1 · Row 1, Rack 1 can''t be retired yet: it still holds 1 item; move them to another rack first','One item left is counted as one');
-- The other item goes into a crate: it is no longer on the rack, though its record still names it.
SELECT pg_temp.op('pack','{"unitCode":"HU-YS0001","add":["YS-2"],"placeId":"9c111111-1111-4111-8111-111111111111","seal":true}');
UPDATE public.locations SET is_active=false WHERE id='c1111111-1111-4111-8111-111111111111';
SELECT pg_temp.assert_true((SELECT NOT is_active FROM public.locations WHERE id='c1111111-1111-4111-8111-111111111111'),
 'An empty rack is retired');
SELECT pg_temp.assert_true((SELECT location_id IS NULL FROM public.materials WHERE id=(SELECT (result->>'material_id')::uuid FROM results WHERE name='ys2')),
 'A packed item no longer points at the retired rack');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.audit_log WHERE action='rack_updated' AND entity_id='c1111111-1111-4111-8111-111111111111'
 AND details#>>'{before,is_active}'='true' AND details#>>'{after,is_active}'='false'),'Retiring a rack is in the audit log');
SELECT pg_temp.expect_message($q$SELECT pg_temp.receive('YS-3','c1111111-1111-4111-8111-111111111111')$q$,
 'That rack is retired; choose another rack','Nothing is received onto a retired rack');
SELECT pg_temp.expect_error($q$SELECT pg_temp.op('transfer',jsonb_build_object('materialId',(SELECT result->>'material_id' FROM results WHERE name='ys1'),
 'fromLocationId','c3333333-3333-4333-8333-333333333333','toLocationId','c1111111-1111-4111-8111-111111111111','reason','Back again'))$q$,
 '22023','Nothing is moved onto a retired rack');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.qr_codes WHERE code_value='YS-3'),'A refused receipt leaves nothing behind');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.v_yard_overview WHERE location_id='c1111111-1111-4111-8111-111111111111')
 AND (SELECT count(*)=2 FROM public.v_yard_overview),'The yard overview lists active racks only');
SELECT pg_temp.assert_true((SELECT NOT rack_active AND rack_place_name='Laydown Yard' FROM public.location_areas WHERE location_id='c1111111-1111-4111-8111-111111111111'),
 'Each rack''s row says whether it is active and which yard it is at');
-- Its name is free again; it can't be restored over the rack that took it.
INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c4444444-4444-4444-8444-444444444444','b1111111-1111-4111-8111-111111111111','T1','1','1');
SELECT pg_temp.expect_error($q$UPDATE public.locations SET is_active=true WHERE id='c1111111-1111-4111-8111-111111111111'$q$,
 '23505','A retired rack cannot be restored over an active rack of its name');
UPDATE public.locations SET rack='9',is_active=true WHERE id='c1111111-1111-4111-8111-111111111111';
SELECT pg_temp.assert_true((SELECT is_active AND rack='9' FROM public.locations WHERE id='c1111111-1111-4111-8111-111111111111'),
 'Renamed, a retired rack is restored');
-- Rack changes are setup: in the audit log for the office, not in the feed crews read.
SELECT pg_temp.as_user('f1111111-1111-4111-8111-111111111111');
SELECT pg_temp.assert_true((SELECT count(*)>0 AND count(*) FILTER (WHERE entity_type='rack')=0
 FROM public.list_project_activity('b1111111-1111-4111-8111-111111111111')),'Rack setup stays out of the crews'' activity feed');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- An area's rack is an active one at the plan's place, and a rack linked to
-- an active area can't be retired.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
INSERT INTO public.site_maps(id,project_id,name,place_id) VALUES
 ('5c111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Laydown plan','9c111111-1111-4111-8111-111111111111'),
 ('5c222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','North plan','9c222222-2222-4222-8222-222222222222');
INSERT INTO public.site_map_zones(id,map_id,project_id,name,shape,location_id) VALUES
 ('2c111111-1111-4111-8111-111111111111','5c111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Bay 1',
  '[[0,0],[0.4,0],[0.4,0.4],[0,0.4]]','c4444444-4444-4444-8444-444444444444');
SELECT pg_temp.expect_message($q$UPDATE public.locations SET is_active=false WHERE id='c4444444-4444-4444-8444-444444444444'$q$,
 'T1 · Row 1, Rack 1 can''t be retired yet: it is linked to the area Bay 1; on Site Maps, set that area to No rack first',
 'A rack linked to an active area says which area');
SELECT pg_temp.expect_error($q$UPDATE public.locations SET place_id='9c222222-2222-4222-8222-222222222222' WHERE id='c4444444-4444-4444-8444-444444444444'$q$,
 '22023','A rack linked to an area stays at the place its plan draws');
UPDATE public.locations SET place_id='9c111111-1111-4111-8111-111111111111' WHERE id='c4444444-4444-4444-8444-444444444444';
SELECT pg_temp.expect_error($q$INSERT INTO public.site_map_zones(map_id,project_id,name,shape,location_id) VALUES
 ('5c222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','North bay','[[0,0],[1,0],[1,1]]','c1111111-1111-4111-8111-111111111111')$q$,
 '22023','An area cannot link a rack that is at another place');
SELECT pg_temp.expect_error($q$UPDATE public.site_maps SET place_id='9c222222-2222-4222-8222-222222222222' WHERE id='5c111111-1111-4111-8111-111111111111'$q$,
 '22023','A plan cannot move to another place while its areas link racks at the first');
UPDATE public.site_map_zones SET location_id=NULL WHERE id='2c111111-1111-4111-8111-111111111111';
UPDATE public.locations SET is_active=false WHERE id='c4444444-4444-4444-8444-444444444444';
SELECT pg_temp.assert_true((SELECT NOT is_active FROM public.locations WHERE id='c4444444-4444-4444-8444-444444444444'),
 'Once its area is set to No rack, the rack is retired');
SELECT pg_temp.expect_message($q$UPDATE public.site_map_zones SET location_id='c4444444-4444-4444-8444-444444444444' WHERE id='2c111111-1111-4111-8111-111111111111'$q$,
 'T1 · Row 1, Rack 1 is retired; restore it on the Racks page or choose another rack','An area cannot link a retired rack');
-- An inactive area keeps the rack it named; it can't come back while that rack is retired.
UPDATE public.locations SET is_active=true WHERE id='c4444444-4444-4444-8444-444444444444';
UPDATE public.site_map_zones SET location_id='c4444444-4444-4444-8444-444444444444' WHERE id='2c111111-1111-4111-8111-111111111111';
UPDATE public.site_map_zones SET is_active=false WHERE id='2c111111-1111-4111-8111-111111111111';
UPDATE public.locations SET is_active=false WHERE id='c4444444-4444-4444-8444-444444444444';
SELECT pg_temp.expect_error($q$UPDATE public.site_map_zones SET is_active=true WHERE id='2c111111-1111-4111-8111-111111111111'$q$,
 '22023','An area cannot be made active again on a retired rack');

-- ---------------------------------------------------------------------------
-- An area, a site plan and a place can't go out of use while stock is
-- recorded there.
-- ---------------------------------------------------------------------------
INSERT INTO public.site_map_zones(id,map_id,project_id,parent_id,name,shape) VALUES
 ('2c222222-2222-4222-8222-222222222222','5c111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,
  'Bay 2','[[0.5,0.5],[1,0.5],[1,1],[0.5,1]]'),
 ('2c333333-3333-4333-8333-333333333333','5c111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
  '2c222222-2222-4222-8222-222222222222','Shelf A','[[0.6,0.6],[0.9,0.6],[0.9,0.9]]'),
 ('2c444444-4444-4444-8444-444444444444','5c111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,
  'Bay 3','[[0,0.5],[0.4,0.5],[0.4,1]]');
SELECT pg_temp.op('move','{"unitCode":"HU-YS0001","zoneId":"2c222222-2222-4222-8222-222222222222"}');
SELECT pg_temp.expect_message($q$UPDATE public.site_map_zones SET is_active=false WHERE id='2c222222-2222-4222-8222-222222222222'$q$,
 'Bay 2 can''t be made inactive yet: it still has 1 crate recorded there; move them first','An area with a crate in it says so');
SELECT pg_temp.op('count','{"tag":"YS-C1","name":"Control valve","quantity":"1","zoneId":"2c333333-3333-4333-8333-333333333333"}');
SELECT pg_temp.expect_message($q$UPDATE public.site_map_zones SET is_active=false WHERE id='2c222222-2222-4222-8222-222222222222'$q$,
 'Bay 2 can''t be made inactive yet: it still has 1 crate and 1 loose item recorded there; move them first',
 'An area counts what is in the areas inside it');
SELECT pg_temp.expect_message($q$UPDATE public.site_map_zones SET is_active=false WHERE id='2c333333-3333-4333-8333-333333333333'$q$,
 'Bay 2 › Shelf A can''t be made inactive yet: it still has 1 loose item recorded there; move them first','An inner area is named by its path');
SELECT pg_temp.expect_message($q$UPDATE public.site_maps SET is_active=false WHERE id='5c111111-1111-4111-8111-111111111111'$q$,
 'Laydown plan can''t be made inactive yet: it still has 1 crate and 1 loose item recorded on it; move them first','A site plan with stock on it says so');
UPDATE public.site_map_zones SET is_active=false WHERE id='2c444444-4444-4444-8444-444444444444';
SELECT pg_temp.assert_true((SELECT NOT is_active FROM public.site_map_zones WHERE id='2c444444-4444-4444-8444-444444444444'),'An empty area is made inactive');
SELECT pg_temp.expect_message($q$UPDATE public.places SET is_active=false WHERE id='9c111111-1111-4111-8111-111111111111'$q$,
 'Laydown Yard can''t be retired yet: it still has 1 crate, 1 loose item, 1 active rack and 1 active site plan','A yard lists everything still there');
SELECT pg_temp.expect_message($q$UPDATE public.places SET kind='other' WHERE id='9c555555-5555-4555-8555-555555555555'$q$,
 'Common Yard stays a yard or site while it has 1 active rack','A yard with racks or plans stays a yard or site');
-- North Site has only its plan, then an open load that stops there.
SELECT pg_temp.expect_message($q$UPDATE public.places SET is_active=false WHERE id='9c222222-2222-4222-8222-222222222222'$q$,
 'North Site can''t be retired yet: it still has 1 active site plan','A place with an active site plan is not retired');
UPDATE public.site_maps SET is_active=false WHERE id='5c222222-2222-4222-8222-222222222222';
SELECT pg_temp.op('load_save','{"loadId":"1e000000-0000-4000-8000-000000000001","originPlaceId":"9c111111-1111-4111-8111-111111111111",
 "driverName":"Sam Lee","stops":[{"id":"5e000000-0000-4000-8000-000000000001","placeId":"9c222222-2222-4222-8222-222222222222"}]}');
SELECT pg_temp.expect_message($q$UPDATE public.places SET is_active=false WHERE id='9c222222-2222-4222-8222-222222222222'$q$,
 'North Site can''t be retired yet: it still has 1 open load','A place an open load stops at is not retired');
RESET ROLE;
UPDATE public.loads SET status='cancelled',closed_at=now() WHERE id='1e000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
UPDATE public.places SET is_active=false WHERE id='9c222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true((SELECT NOT is_active FROM public.places WHERE id='9c222222-2222-4222-8222-222222222222'),
 'With nothing left there, a place is retired');
SELECT pg_temp.expect_error($q$UPDATE public.locations SET place_id='9c222222-2222-4222-8222-222222222222' WHERE id='c3333333-3333-4333-8333-333333333333'$q$,
 '22023','A rack cannot be put at a retired place');
RESET ROLE;

-- A shared yard another project has racks at can't be claimed by this one (022's guard, now counting racks).
UPDATE public.locations SET place_id=NULL WHERE id='c2222222-2222-4222-8222-222222222222';
INSERT INTO public.locations(project_id,zone,row,rack,place_id) VALUES
 ('b2222222-2222-4222-8222-222222222222','A','1','1','9c555555-5555-4555-8555-555555555555');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('01111111-1111-4111-8111-111111111111');
SELECT pg_temp.expect_error($q$UPDATE public.places SET project_id='b1111111-1111-4111-8111-111111111111' WHERE id='9c555555-5555-4555-8555-555555555555'$q$,
 '22023','A shared yard another project has racks at cannot become one project''s');
RESET ROLE;

ROLLBACK;

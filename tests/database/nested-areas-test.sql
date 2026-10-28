BEGIN;
\ir admin-fixtures.sql

-- Project one has a plan with no areas yet, and a second plan.
INSERT INTO public.locations(id,project_id,zone,row,rack) VALUES
 ('c1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','T1','1','2');
INSERT INTO public.site_maps(id,project_id,name) VALUES
 ('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','Yard plan'),
 ('5b222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','Warehouse plan');

CREATE FUNCTION pg_temp.count_payload(tag text,extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('tag',tag,'name','Valve','quantity','1')||extra;
$$;
CREATE TEMP TABLE results(name text PRIMARY KEY,result jsonb);
GRANT ALL ON results TO authenticated;

-- Before any areas exist, a count needs no location.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
INSERT INTO results VALUES('no_areas',public.apply_field_operation(
 '30000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111','count',pg_temp.count_payload('NA-1')));
RESET ROLE;

-- Areas inside areas: T1 Pipe Racks > Rack 2, plus an area on the other plan.
INSERT INTO public.site_map_zones(id,map_id,project_id,parent_id,name,shape,location_id) VALUES
 ('2b111111-1111-4111-8111-111111111111','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,
  'T1 Pipe Racks','[[0,0],[0.5,0],[0.5,0.5],[0,0.5]]',NULL),
 ('2b222222-2222-4222-8222-222222222222','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
  '2b111111-1111-4111-8111-111111111111','Rack 2','[[0.1,0.1],[0.4,0.1],[0.4,0.2],[0.1,0.2]]','c1111111-1111-4111-8111-111111111111'),
 ('2b333333-3333-4333-8333-333333333333','5b222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111',NULL,
  'Aisle 4','[[0,0],[1,0],[1,1]]',NULL);

SELECT pg_temp.assert_true(public.site_map_zone_path('2b222222-2222-4222-8222-222222222222')='T1 Pipe Racks › Rack 2',
 'An area''s path lists its parents');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape)
 VALUES('5b222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','2b111111-1111-4111-8111-111111111111','Wrong plan','[[0,0],[1,0],[1,1]]')
$query$,'42501','A parent area must be on the same plan');
SELECT pg_temp.expect_error($query$
 UPDATE public.site_map_zones SET parent_id='2b222222-2222-4222-8222-222222222222' WHERE id='2b111111-1111-4111-8111-111111111111'
$query$,'22023','The area tree cannot loop');
SELECT pg_temp.expect_error($query$
 UPDATE public.site_map_zones SET map_id='5b222222-2222-4222-8222-222222222222' WHERE id='2b111111-1111-4111-8111-111111111111'
$query$,'22023','An area with sub-areas cannot move to another plan on its own');
SELECT pg_temp.expect_error($query$
 INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape)
 VALUES('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','2b111111-1111-4111-8111-111111111111','rack 2','[[0,0],[1,0],[1,1]]')
$query$,'23505','Sibling areas cannot share a name');
INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape)
 VALUES('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,'Rack 2','[[0.6,0.6],[0.9,0.6],[0.9,0.9]]');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.site_map_zones WHERE lower(name)='rack 2'),
 'The same name may be used under a different parent');

-- With areas in place, every count names one.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',pg_temp.count_payload('NA-2'))
$query$,'22023','A count must name an area once the project has areas');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('NA-3','{"siteMapId":"5b222222-2222-4222-8222-222222222222"}'))
$query$,'22023','The other plan has its own area, so a count on it must name one too');
INSERT INTO results VALUES('rack',public.apply_field_operation(
 '30000000-0000-4000-8000-000000000002','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload('NA-4','{"zoneId":"2b222222-2222-4222-8222-222222222222"}')));
SELECT pg_temp.assert_true((SELECT i.location='T1 Pipe Racks › Rack 2' AND i.site_map_id='5b111111-1111-4111-8111-111111111111'
 AND i.zone_id='2b222222-2222-4222-8222-222222222222' FROM public.inventory_records i WHERE i.qr_code='NA-4'),
 'A count stores the area''s full path and takes the plan from the area');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('NA-5','{"zoneId":"2b222222-2222-4222-8222-222222222222","siteMapId":"5b222222-2222-4222-8222-222222222222"}'))
$query$,'42501','An area must be on the plan the count names');
DO $$ DECLARE changed bigint;
BEGIN
 UPDATE public.site_map_zones SET is_active=false WHERE id='2b111111-1111-4111-8111-111111111111';
 GET DIAGNOSTICS changed=ROW_COUNT;
 PERFORM pg_temp.assert_true(changed=0,'Field users cannot retire areas');
END $$;
RESET ROLE;

-- Retiring a parent takes its sub-areas out of use too.
UPDATE public.site_map_zones SET is_active=false WHERE id='2b111111-1111-4111-8111-111111111111';
SELECT pg_temp.assert_true(NOT public.site_map_zone_is_live('2b222222-2222-4222-8222-222222222222'),
 'An area under a retired parent is out of use');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('NA-6','{"zoneId":"2b222222-2222-4222-8222-222222222222"}'))
$query$,'22023','A count cannot use an area under a retired parent');
RESET ROLE;
INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape)
 VALUES('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,'T1 Pipe Racks','[[0,0],[0.5,0],[0.5,0.5]]');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.site_map_zones WHERE name='T1 Pipe Racks'),
 'A retired area''s name can be reused');

-- Office users retire and restore areas directly.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','01111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE changed bigint;
BEGIN
 UPDATE public.site_map_zones SET is_active=false WHERE id='2b333333-3333-4333-8333-333333333333';
 GET DIAGNOSTICS changed=ROW_COUNT;
 PERFORM pg_temp.assert_true(changed=1,'Office users can retire an area');
END $$;
RESET ROLE;

-- Fixtures for the remaining checks: an active area to count into, another
-- project's area, a plan to retire, and a plan with no areas.
INSERT INTO public.site_map_zones(id,map_id,project_id,parent_id,name,shape) VALUES
 ('2b444444-4444-4444-8444-444444444444','5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',NULL,
  'Bay A','[[0.5,0.5],[1,0.5],[1,1],[0.5,1]]');
INSERT INTO public.site_maps(id,project_id,name) VALUES
 ('5b333333-3333-4333-8333-333333333333','b1111111-1111-4111-8111-111111111111','Retired plan'),
 ('5b444444-4444-4444-8444-444444444444','b1111111-1111-4111-8111-111111111111','Plan with no areas'),
 ('5b555555-5555-4555-8555-555555555555','b2222222-2222-4222-8222-222222222222','Other project plan');
INSERT INTO public.site_map_zones(id,map_id,project_id,name,shape) VALUES
 ('2b555555-5555-4555-8555-555555555555','5b333333-3333-4333-8333-333333333333','b1111111-1111-4111-8111-111111111111','Old yard','[[0,0],[1,0],[1,1]]'),
 ('2b666666-6666-4666-8666-666666666666','5b555555-5555-4555-8555-555555555555','b2222222-2222-4222-8222-222222222222','Hidden','[[0,0],[1,0],[1,1]]');
UPDATE public.site_maps SET is_active=false WHERE id='5b333333-3333-4333-8333-333333333333';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.assert_true(public.site_map_zone_path('2b666666-6666-4666-8666-666666666666') IS NULL
 AND NOT public.site_map_zone_is_live('2b666666-6666-4666-8666-666666666666'),
 'Path and in-use checks reveal nothing about another project''s areas');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('NA-7','{"zoneId":"2b333333-3333-4333-8333-333333333333"}'))
$query$,'22023','A retired area cannot be used');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('NA-8','{"zoneId":"2b555555-5555-4555-8555-555555555555"}'))
$query$,'22023','An area on a retired plan cannot be used');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',
  pg_temp.count_payload('NA-9','{"siteMapId":"5b333333-3333-4333-8333-333333333333","pin":{"x":0.5,"y":0.5}}'))
$query$,'22023','A retired plan cannot be used to skip the location');
INSERT INTO results VALUES('pin_from_area',public.apply_field_operation(
 '30000000-0000-4000-8000-000000000003','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload('NA-10','{"zoneId":"2b444444-4444-4444-8444-444444444444","pin":{"x":0.7,"y":0.8}}')));
SELECT pg_temp.assert_true((SELECT site_map_id='5b111111-1111-4111-8111-111111111111' AND pin_x=0.7 AND pin_y=0.8 AND location='Bay A'
 FROM public.inventory_records WHERE qr_code='NA-10'),'A pin with an area but no plan takes the area''s plan');
INSERT INTO results VALUES('no_area_plan',public.apply_field_operation(
 '30000000-0000-4000-8000-000000000004','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload('NA-11','{"siteMapId":"5b444444-4444-4444-8444-444444444444","pin":{"x":0.2,"y":0.3}}')));
SELECT pg_temp.assert_true((SELECT zone_id IS NULL AND pin_x=0.2 FROM public.inventory_records WHERE qr_code='NA-11'),
 'A plan without areas accepts a pin on its own');
SELECT pg_temp.expect_error($query$
 SELECT public.apply_field_operation(gen_random_uuid(),'b1111111-1111-4111-8111-111111111111','count',pg_temp.count_payload('NA-4'))
$query$,'22023','A recount must still name an area');
INSERT INTO results VALUES('moved',public.apply_field_operation(
 '30000000-0000-4000-8000-000000000005','b1111111-1111-4111-8111-111111111111','count',
 pg_temp.count_payload('NA-4','{"zoneId":"2b444444-4444-4444-8444-444444444444"}')));
SELECT pg_temp.assert_true((SELECT location='Bay A' AND zone_id='2b444444-4444-4444-8444-444444444444'
 FROM public.inventory_records WHERE qr_code='NA-4'),'A recount can move an item to another area');
RESET ROLE;

-- Nesting stops at 20 levels, counting the moved area's own sub-areas.
DO $$ DECLARE parent uuid:=NULL; node uuid; i integer;
BEGIN
 FOR i IN 1..20 LOOP
  INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape)
   VALUES('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',parent,'Level '||i,'[[0,0],[1,0],[1,1]]')
   RETURNING id INTO node;
  parent:=node;
 END LOOP;
 PERFORM pg_temp.assert_true(public.site_map_zone_path(node) LIKE 'Level 1 › % › Level 20','Twenty levels of areas are allowed');
 PERFORM pg_temp.expect_error(format($query$
  INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape)
  VALUES('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',%L,'Level 21','[[0,0],[1,0],[1,1]]')
 $query$,node),'22023','A twenty-first level is refused');
 INSERT INTO public.site_map_zones(map_id,project_id,parent_id,name,shape)
  VALUES('5b111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','2b444444-4444-4444-8444-444444444444','Bay A-1','[[0.6,0.6],[0.9,0.6],[0.9,0.9]]');
 PERFORM pg_temp.expect_error(format($query$
  UPDATE public.site_map_zones SET parent_id=(SELECT id FROM public.site_map_zones WHERE name='Level 19')
  WHERE id='2b444444-4444-4444-8444-444444444444'
 $query$),'22023','Moving an area with sub-areas cannot push them past twenty levels');
END $$;
ROLLBACK;

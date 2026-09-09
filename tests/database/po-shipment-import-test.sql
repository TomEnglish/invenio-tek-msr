BEGIN;
\ir admin-fixtures.sql

INSERT INTO public.projects(id,name,status) VALUES
 ('b3333333-3333-4333-8333-333333333333','Archived Import Yard','archived');
INSERT INTO public.purchase_orders(project_id,purchase_order_id,purchase_order_item,item_description,net_value) VALUES
 ('b1111111-1111-4111-8111-111111111111','PO-ABSENT','00010','Keep absent PO',5),
 ('b2222222-2222-4222-8222-222222222222','PO-IMPORT','00010','Other project PO',999);
INSERT INTO public.shipments(project_id,shipment_number,part_description,status) VALUES
 ('b1111111-1111-4111-8111-111111111111','SHIP-ABSENT','Keep absent shipment','Not Ready'),
 ('b2222222-2222-4222-8222-222222222222','SHIP-OTHER','Other project shipment','Delivered');
INSERT INTO public.dashboard_metrics(project_id,project_name,procurement,installation,status_counts) VALUES
 ('b1111111-1111-4111-8111-111111111111','Test Yard One','{"total_pos":1}','{"total_items":17,"by_discipline":{"civil":17}}','{}'),
 ('b2222222-2222-4222-8222-222222222222','Test Yard Two','{"total_pos":91}','{"total_items":23}','{"marker":"other project"}');

CREATE FUNCTION pg_temp.import_state(p_project_id uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'purchase_orders',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.purchase_orders p WHERE project_id=p_project_id),
  'shipments',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.shipments s WHERE project_id=p_project_id),
  'dashboard_metrics',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.dashboard_metrics m WHERE project_id=p_project_id));
$$;

CREATE FUNCTION pg_temp.fail_shipment_after_po_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='TEST-FAIL-AFTER-PO' THEN
  IF NOT EXISTS(SELECT 1 FROM public.purchase_orders WHERE project_id=NEW.project_id
   AND purchase_order_id='PO-IMPORT' AND purchase_order_item='00010' AND net_value=9999) THEN
   RAISE EXCEPTION 'The PO update must have happened before this trigger' USING ERRCODE='P0002';
  END IF;
  RAISE EXCEPTION 'Injected shipment write failure' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_test_shipment_failure AFTER INSERT OR UPDATE ON public.shipments
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_shipment_after_po_write();

SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT public.import_po_shipment_snapshot(
 'b1111111-1111-4111-8111-111111111111','[{"purchase_order_id":"PO-DENIED","purchase_order_item":"1"}]',
 '[{"shipment_number":"SHIP-DENIED"}]')$q$,'42501','Anonymous cannot import');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
SELECT pg_temp.expect_error($q$SELECT public.import_po_shipment_snapshot(
 'b1111111-1111-4111-8111-111111111111','[{"purchase_order_id":"PO-DENIED","purchase_order_item":"1"}]',
 '[{"shipment_number":"SHIP-DENIED"}]')$q$,'42501','Even an authenticated admin cannot import');
RESET ROLE;
SET LOCAL ROLE service_role;

DO $$
DECLARE
 target_project_id uuid := 'b1111111-1111-4111-8111-111111111111';
 po jsonb := '[{"purchase_order_id":"PO-IMPORT","purchase_order_item":"00010","item_description":"Imported valve","net_value":25,"ordered_quantity":2,"status":"Sent"}]';
 shipments jsonb := '[{"shipment_number":"SHIP-IMPORT","po_number":"PO-IMPORT","num_pieces":2,"status":"In Transit"}]';
 result jsonb; po_id bigint; shipment_id bigint; baseline jsonb; other_baseline jsonb;
 absent_po jsonb; absent_shipment jsonb; actual_state text; invalid_project uuid;
 numeric_field text; special_number text; forbidden_field text;
BEGIN
 other_baseline := pg_temp.import_state('b2222222-2222-4222-8222-222222222222');
 SELECT to_jsonb(p) INTO absent_po FROM public.purchase_orders p WHERE purchase_order_id='PO-ABSENT';
 SELECT to_jsonb(s) INTO absent_shipment FROM public.shipments s WHERE shipment_number='SHIP-ABSENT';
 result := public.import_po_shipment_snapshot(target_project_id,po,shipments);
 PERFORM pg_temp.assert_true((result->>'purchase_orders')::integer=1 AND (result->>'shipments')::integer=1
  AND (result->>'synced_at')::timestamptz IS NOT NULL,'Service import returns row counts and timestamp');
 SELECT id INTO po_id FROM public.purchase_orders WHERE purchase_order_id='PO-IMPORT' AND project_id='b1111111-1111-4111-8111-111111111111';
 SELECT id INTO shipment_id FROM public.shipments WHERE shipment_number='SHIP-IMPORT';
 po := jsonb_set(jsonb_set(po,'{0,net_value}','70'),'{0,item_description}','"Updated valve"');
 shipments := jsonb_set(jsonb_set(shipments,'{0,num_pieces}','3'),'{0,status}','"Delivered"');
 PERFORM public.import_po_shipment_snapshot(target_project_id,po,shipments);
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.purchase_orders WHERE project_id='b1111111-1111-4111-8111-111111111111'),'Repeat import retains absent PO and creates no duplicate');
 PERFORM pg_temp.assert_true((SELECT id=po_id AND net_value=70 AND item_description='Updated valve' FROM public.purchase_orders
  WHERE purchase_order_id='PO-IMPORT' AND project_id='b1111111-1111-4111-8111-111111111111'),'PO update preserves its database ID');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.shipments WHERE project_id='b1111111-1111-4111-8111-111111111111'),'Repeat import retains absent shipment and creates no duplicate');
 PERFORM pg_temp.assert_true((SELECT id=shipment_id AND num_pieces=3 AND status='Delivered' FROM public.shipments WHERE shipment_number='SHIP-IMPORT'),'Shipment update preserves its database ID');
 PERFORM pg_temp.assert_true((SELECT to_jsonb(p)=absent_po FROM public.purchase_orders p WHERE purchase_order_id='PO-ABSENT'),'Absent PO is unchanged');
 PERFORM pg_temp.assert_true((SELECT to_jsonb(s)=absent_shipment FROM public.shipments s WHERE shipment_number='SHIP-ABSENT'),'Absent shipment is unchanged');
 PERFORM pg_temp.assert_true((SELECT (procurement->>'total_pos')::integer=2 AND (procurement->>'total_po_value')::numeric=75
  AND (procurement->>'total_shipments')::integer=2 AND (procurement->>'delivered_shipments')::integer=1
  FROM public.dashboard_metrics WHERE project_id='b1111111-1111-4111-8111-111111111111'),'Metrics include imported and preserved records');
 PERFORM pg_temp.assert_true((SELECT installation='{"total_items":17,"by_discipline":{"civil":17}}'::jsonb
  FROM public.dashboard_metrics WHERE project_id='b1111111-1111-4111-8111-111111111111'),'Procurement import preserves installation metrics');
 PERFORM pg_temp.assert_true(pg_temp.import_state('b2222222-2222-4222-8222-222222222222')=other_baseline,'Import leaves all other project data unchanged');

 PERFORM public.import_po_shipment_snapshot(target_project_id,jsonb_build_array((po->0)-'item_description'),shipments);
 PERFORM pg_temp.assert_true((SELECT item_description='Updated valve' FROM public.purchase_orders WHERE id=po_id),'Omitted source columns preserve existing values');

 baseline := pg_temp.import_state(target_project_id);
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,po||po,shipments),'22023','Duplicate PO/line keys rejected');
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,po,shipments||shipments),'22023','Duplicate shipment numbers rejected');
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,jsonb_set(po,'{0,purchase_order_id}','"  "'),shipments),'22023','Blank PO ID rejected');
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,jsonb_set(po,'{0,purchase_order_item}','""'),shipments),'22023','Blank PO line rejected');
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,po,jsonb_set(shipments,'{0,shipment_number}','"  "')),'22023','Blank shipment number rejected');
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,'[]',shipments),'22023','Empty PO sheet rejected');
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,po,'[]'),'22023','Empty shipment sheet rejected');
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,po,jsonb_set(shipments,'{0,shipment_number}','"SHIP-OTHER"')),'22023','Shipment cannot move from another project');
 FOREACH invalid_project IN ARRAY ARRAY['b3333333-3333-4333-8333-333333333333'::uuid,'b9999999-9999-4999-8999-999999999999'::uuid,NULL::uuid] LOOP
  PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',invalid_project,po,shipments),'22023','Inactive, missing, or unspecified project rejected');
 END LOOP;
 FOREACH special_number IN ARRAY ARRAY['NaN','Infinity','-Infinity'] LOOP
  FOREACH numeric_field IN ARRAY ARRAY['ordered_quantity','base_net_price_base_quantity_unit','net_price','net_value'] LOOP
   PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,
    jsonb_set(po,ARRAY['0',numeric_field],to_jsonb(special_number)),shipments),'22023','PO numeric fields must be finite: '||numeric_field||'='||special_number);
  END LOOP;
  FOREACH numeric_field IN ARRAY ARRAY['num_pieces','num_loads'] LOOP
   PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,po,
    jsonb_set(shipments,ARRAY['0',numeric_field],to_jsonb(special_number))),'22023','Shipment numeric fields must be finite: '||numeric_field||'='||special_number);
  END LOOP;
 END LOOP;
 FOREACH forbidden_field IN ARRAY ARRAY['id','project_id','created_at','updated_at','synced_at'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,
   jsonb_set(po,ARRAY['0',forbidden_field],'"client-supplied"'),shipments),'22023','PO server metadata cannot be supplied: '||forbidden_field);
  PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,po,
   jsonb_set(shipments,ARRAY['0',forbidden_field],'"client-supplied"')),'22023','Shipment server metadata cannot be supplied: '||forbidden_field);
 END LOOP;
 PERFORM pg_temp.assert_true(pg_temp.import_state(target_project_id)=baseline,'Validation failures preserve project records and metrics');
 PERFORM pg_temp.assert_true(pg_temp.import_state('b2222222-2222-4222-8222-222222222222')=other_baseline,'Collision failure preserves the owning project');

 -- An invalid second-sheet number must leave every existing value unchanged.
 BEGIN
  PERFORM public.import_po_shipment_snapshot(target_project_id,
   jsonb_set(po,'{0,net_value}','9999'),jsonb_set(shipments,'{0,num_pieces}','"not-a-number"'));
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE;
 END;
 PERFORM pg_temp.assert_true(actual_state IN ('22P02','22023'),'Invalid shipment numeric must fail conversion or validation');
 PERFORM pg_temp.assert_true(pg_temp.import_state(target_project_id)=baseline,'Invalid shipment numeric preserves all project records and metrics');

 -- This trigger verifies the PO changed, then fails after the shipment write.
 PERFORM pg_temp.expect_error(format('SELECT public.import_po_shipment_snapshot(%L,%L,%L)',target_project_id,
  jsonb_set(po,'{0,net_value}','9999'),jsonb_set(shipments,'{0,status}','"TEST-FAIL-AFTER-PO"')),'P0001','Injected failure happens after actual PO and shipment writes');
 PERFORM pg_temp.assert_true(pg_temp.import_state(target_project_id)=baseline,'Shipment write failure rolls back PO, shipment, and dashboard metric changes');
END $$;
RESET ROLE;
ROLLBACK;

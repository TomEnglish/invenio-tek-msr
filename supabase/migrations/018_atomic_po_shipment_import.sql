-- One project import is one transaction; no source row is deleted.
BEGIN;
ALTER TABLE public.purchase_orders
 ADD CONSTRAINT purchase_orders_project_po_line_key UNIQUE(project_id,purchase_order_id,purchase_order_item);

CREATE OR REPLACE FUNCTION public.import_po_shipment_snapshot(
 p_project_id uuid, p_purchase_orders jsonb, p_shipments jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_project_name text; v_row jsonb; v_synced_at timestamptz := statement_timestamp();
 v_metric_id integer; v_imported integer; v_procurement jsonb; v_status_counts jsonb; v_field text;
BEGIN
 -- Lock the project row to serialize imports and prevent a simultaneous archive.
 SELECT name INTO v_project_name FROM public.projects WHERE id=p_project_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'An active project is required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_purchase_orders) IS DISTINCT FROM 'array' OR jsonb_typeof(p_shipments) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Both sheets must be arrays' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_purchase_orders) NOT BETWEEN 1 AND 10000 OR jsonb_array_length(p_shipments) NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION 'Each sheet must contain 1 to 10000 records' USING ERRCODE='22023';
 END IF;

 FOR v_row IN SELECT value FROM jsonb_array_elements(p_purchase_orders) LOOP
  IF jsonb_typeof(v_row)<>'object' OR v_row-ARRAY['purchase_order_id','po_description','purchase_order_item','item_uuid','created_on','item_last_change_date_time','delivery_date_from','status','item_status','delivery_status','scope','po_li','shipment','category','sub_category','project_task','supplier','item_description','item_remark_for_supplier','supplier_part_number','product','product_alt','manufacturer','manufacturer_part_number','base_uom','item_type','ordered_quantity','base_net_price_base_quantity_unit','net_price','net_value','incoterms'] <> '{}'::jsonb THEN
   RAISE EXCEPTION 'Unexpected purchase order fields' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(v_row->>'purchase_order_id'),'') IS NULL OR nullif(btrim(v_row->>'purchase_order_item'),'') IS NULL
   OR v_row->>'purchase_order_id'<>btrim(v_row->>'purchase_order_id')
   OR v_row->>'purchase_order_item'<>btrim(v_row->>'purchase_order_item') THEN
   RAISE EXCEPTION 'Every PO requires a trimmed identifier and line number' USING ERRCODE='22023';
  END IF;
  FOREACH v_field IN ARRAY ARRAY['ordered_quantity','base_net_price_base_quantity_unit','net_price','net_value'] LOOP
   IF lower(v_row->>v_field) IN ('nan','infinity','-infinity','inf','-inf') THEN
    RAISE EXCEPTION 'Numeric values must be finite' USING ERRCODE='22023';
   END IF;
  END LOOP;
  IF (v_row->>'ordered_quantity')::numeric < 0 THEN
   RAISE EXCEPTION 'Ordered quantities cannot be negative' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_shipments) LOOP
  IF jsonb_typeof(v_row)<>'object' OR v_row-ARRAY['shipment_number','project','po_number','rts_date','eta','delivery_date','delivery_time','status','category','supplier','part_description','num_pieces','num_loads','truck_type','storage_location','ship_from','ship_to','shipper','shipment_by','ncr_osd','receiving_pics','detailed_packing_list','progress_notes','special_receiving_instructions'] <> '{}'::jsonb THEN
   RAISE EXCEPTION 'Unexpected shipment fields' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(v_row->>'shipment_number'),'') IS NULL OR v_row->>'shipment_number'<>btrim(v_row->>'shipment_number') THEN
   RAISE EXCEPTION 'Every shipment requires a trimmed identifier' USING ERRCODE='22023';
  END IF;
  IF lower(v_row->>'num_pieces') IN ('nan','infinity','-infinity','inf','-inf') OR lower(v_row->>'num_loads') IN ('nan','infinity','-infinity','inf','-inf') THEN
   RAISE EXCEPTION 'Numeric values must be finite' USING ERRCODE='22023';
  END IF;
  IF (v_row->>'num_pieces')::integer < 0 OR (v_row->>'num_loads')::integer < 0 THEN
   RAISE EXCEPTION 'Shipment quantities cannot be negative' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_purchase_orders) r GROUP BY r->>'purchase_order_id',r->>'purchase_order_item' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_shipments) r GROUP BY r->>'shipment_number' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Duplicate source identifiers must be resolved before importing' USING ERRCODE='22023';
 END IF;

 INSERT INTO public.purchase_orders (purchase_order_id,po_description,purchase_order_item,item_uuid,created_on,item_last_change_date_time,delivery_date_from,status,item_status,delivery_status,scope,po_li,shipment,category,sub_category,project_task,supplier,item_description,item_remark_for_supplier,supplier_part_number,product,product_alt,manufacturer,manufacturer_part_number,base_uom,item_type,ordered_quantity,base_net_price_base_quantity_unit,net_price,net_value,incoterms,project_id,synced_at)
 SELECT r.purchase_order_id,r.po_description,r.purchase_order_item,r.item_uuid,r.created_on,r.item_last_change_date_time,r.delivery_date_from,r.status,r.item_status,r.delivery_status,r.scope,r.po_li,r.shipment,r.category,r.sub_category,r.project_task,r.supplier,r.item_description,r.item_remark_for_supplier,r.supplier_part_number,r.product,r.product_alt,r.manufacturer,r.manufacturer_part_number,r.base_uom,r.item_type,r.ordered_quantity,r.base_net_price_base_quantity_unit,r.net_price,r.net_value,r.incoterms,p_project_id,v_synced_at
 FROM jsonb_array_elements(p_purchase_orders) input
 LEFT JOIN public.purchase_orders existing ON existing.project_id=p_project_id
  AND existing.purchase_order_id=input->>'purchase_order_id' AND existing.purchase_order_item=input->>'purchase_order_item'
 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.purchase_orders,coalesce(to_jsonb(existing),'{}')||input) r
 ON CONFLICT (project_id,purchase_order_id,purchase_order_item) DO UPDATE SET
 po_description=EXCLUDED.po_description,
 item_uuid=EXCLUDED.item_uuid,
 created_on=EXCLUDED.created_on,
 item_last_change_date_time=EXCLUDED.item_last_change_date_time,
 delivery_date_from=EXCLUDED.delivery_date_from,
 status=EXCLUDED.status,
 item_status=EXCLUDED.item_status,
 delivery_status=EXCLUDED.delivery_status,
 scope=EXCLUDED.scope,
 po_li=EXCLUDED.po_li,
 shipment=EXCLUDED.shipment,
 category=EXCLUDED.category,
 sub_category=EXCLUDED.sub_category,
 project_task=EXCLUDED.project_task,
 supplier=EXCLUDED.supplier,
 item_description=EXCLUDED.item_description,
 item_remark_for_supplier=EXCLUDED.item_remark_for_supplier,
 supplier_part_number=EXCLUDED.supplier_part_number,
 product=EXCLUDED.product,
 product_alt=EXCLUDED.product_alt,
 manufacturer=EXCLUDED.manufacturer,
 manufacturer_part_number=EXCLUDED.manufacturer_part_number,
 base_uom=EXCLUDED.base_uom,
 item_type=EXCLUDED.item_type,
 ordered_quantity=EXCLUDED.ordered_quantity,
 base_net_price_base_quantity_unit=EXCLUDED.base_net_price_base_quantity_unit,
 net_price=EXCLUDED.net_price,
 net_value=EXCLUDED.net_value,
 incoterms=EXCLUDED.incoterms,synced_at=EXCLUDED.synced_at
 ;

 -- The existing shipment number is globally unique. Never move a record from
 -- another project, including a collision committed by a concurrent import.
 INSERT INTO public.shipments (shipment_number,project,po_number,rts_date,eta,delivery_date,delivery_time,status,category,supplier,part_description,num_pieces,num_loads,truck_type,storage_location,ship_from,ship_to,shipper,shipment_by,ncr_osd,receiving_pics,detailed_packing_list,progress_notes,special_receiving_instructions,project_id,synced_at)
 SELECT r.shipment_number,r.project,r.po_number,r.rts_date,r.eta,r.delivery_date,r.delivery_time,r.status,r.category,r.supplier,r.part_description,r.num_pieces,r.num_loads,r.truck_type,r.storage_location,r.ship_from,r.ship_to,r.shipper,r.shipment_by,r.ncr_osd,r.receiving_pics,r.detailed_packing_list,r.progress_notes,r.special_receiving_instructions,p_project_id,v_synced_at
 FROM jsonb_array_elements(p_shipments) input
 LEFT JOIN public.shipments existing ON existing.project_id=p_project_id AND existing.shipment_number=input->>'shipment_number'
 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.shipments,coalesce(to_jsonb(existing),'{}')||input) r
 ON CONFLICT (shipment_number) DO UPDATE SET
 project=EXCLUDED.project,
 po_number=EXCLUDED.po_number,
 rts_date=EXCLUDED.rts_date,
 eta=EXCLUDED.eta,
 delivery_date=EXCLUDED.delivery_date,
 delivery_time=EXCLUDED.delivery_time,
 status=EXCLUDED.status,
 category=EXCLUDED.category,
 supplier=EXCLUDED.supplier,
 part_description=EXCLUDED.part_description,
 num_pieces=EXCLUDED.num_pieces,
 num_loads=EXCLUDED.num_loads,
 truck_type=EXCLUDED.truck_type,
 storage_location=EXCLUDED.storage_location,
 ship_from=EXCLUDED.ship_from,
 ship_to=EXCLUDED.ship_to,
 shipper=EXCLUDED.shipper,
 shipment_by=EXCLUDED.shipment_by,
 ncr_osd=EXCLUDED.ncr_osd,
 receiving_pics=EXCLUDED.receiving_pics,
 detailed_packing_list=EXCLUDED.detailed_packing_list,
 progress_notes=EXCLUDED.progress_notes,
 special_receiving_instructions=EXCLUDED.special_receiving_instructions,synced_at=EXCLUDED.synced_at
 WHERE shipments.project_id=EXCLUDED.project_id;
 GET DIAGNOSTICS v_imported=ROW_COUNT;
 IF v_imported<>jsonb_array_length(p_shipments) THEN
  RAISE EXCEPTION 'A shipment identifier belongs to another project' USING ERRCODE='22023';
 END IF;

 SELECT jsonb_build_object(
  'total_pos',count(DISTINCT purchase_order_id),'total_po_value',coalesce(sum(net_value),0),
  'total_shipments',(SELECT count(*) FROM public.shipments WHERE project_id=p_project_id),
  'delivered_shipments',(SELECT count(*) FROM public.shipments WHERE project_id=p_project_id AND lower(btrim(status))='delivered'),
  'in_transit_shipments',(SELECT count(*) FROM public.shipments WHERE project_id=p_project_id AND lower(btrim(status))='in transit'),
  'not_ready_shipments',(SELECT count(*) FROM public.shipments WHERE project_id=p_project_id AND lower(btrim(status))='not ready')
 ) INTO v_procurement FROM public.purchase_orders WHERE project_id=p_project_id;
 SELECT jsonb_build_object(
  'po_status',(SELECT coalesce(jsonb_object_agg(status,n),'{}') FROM (
   SELECT coalesce(nullif(btrim(status),''),'Unknown') status,count(*) n FROM public.purchase_orders WHERE project_id=p_project_id GROUP BY 1) counts),
  'shipment_status',(SELECT coalesce(jsonb_object_agg(status,n),'{}') FROM (
   SELECT coalesce(nullif(btrim(status),''),'Unknown') status,count(*) n FROM public.shipments WHERE project_id=p_project_id GROUP BY 1) counts)
 ) INTO v_status_counts;
 SELECT id INTO v_metric_id FROM public.dashboard_metrics WHERE project_id=p_project_id ORDER BY last_updated DESC NULLS LAST,id DESC LIMIT 1;
 IF FOUND THEN
  UPDATE public.dashboard_metrics SET project_name=v_project_name,procurement=v_procurement,status_counts=v_status_counts,last_updated=v_synced_at WHERE id=v_metric_id;
 ELSE
  INSERT INTO public.dashboard_metrics(project_id,project_name,procurement,status_counts,last_updated)
   VALUES(p_project_id,v_project_name,v_procurement,v_status_counts,v_synced_at);
 END IF;
 RETURN jsonb_build_object('purchase_orders',jsonb_array_length(p_purchase_orders),'shipments',v_imported,'synced_at',v_synced_at);
END $$;
REVOKE ALL ON FUNCTION public.import_po_shipment_snapshot(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_po_shipment_snapshot(uuid,jsonb,jsonb) TO service_role;
COMMIT;

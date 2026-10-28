-- Nested map areas: areas can sit inside areas and be retired, and a count
-- must name an area whenever its project has a site plan with areas.
BEGIN;

alter table public.site_map_zones
 add column parent_id uuid references public.site_map_zones(id),
 add column is_active boolean not null default true;
create index site_map_zones_parent on public.site_map_zones(parent_id);
do $$ declare clashes text;
begin
 select string_agg(format('%s on plan %s', d.names, d.map_id), '; ') into clashes
  from (select map_id, string_agg(name, ', ' order by name) as names from public.site_map_zones
        where is_active group by map_id, lower(name) having count(*)>1) d;
 if clashes is not null then
  raise exception 'Rename areas whose names differ only by case before applying 020: %', clashes;
 end if;
end $$;
create unique index site_map_zones_sibling_name on public.site_map_zones
 (map_id,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name)) where is_active;

-- Parents sit on the same plan, the tree never loops, nesting stops at 20
-- levels, and an area with sub-areas cannot move to another plan on its own.
-- Adding or moving areas on a plan takes turns (an advisory lock per plan) and
-- must run at READ COMMITTED, so each check sees any other writer's committed
-- change instead of racing it. Renames, colours and retirements don't change
-- the tree's shape, so they skip the lock.
create or replace function public.site_map_zone_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_shape boolean; v_ancestors integer; v_loop boolean; v_height integer;
begin
 if tg_op='INSERT' then
  v_shape:=true;
 else
  v_shape:=new.parent_id is distinct from old.parent_id or new.map_id<>old.map_id;
 end if;
 if v_shape then
  if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Add or move areas at READ COMMITTED so simultaneous edits are checked' using errcode='0A000';
  end if;
  if tg_op='UPDATE' and new.map_id<>old.map_id then
   perform pg_advisory_xact_lock(hashtextextended('site_map_zones:'||least(old.map_id,new.map_id)::text,0));
   perform pg_advisory_xact_lock(hashtextextended('site_map_zones:'||greatest(old.map_id,new.map_id)::text,0));
  else
   perform pg_advisory_xact_lock(hashtextextended('site_map_zones:'||new.map_id::text,0));
  end if;
 end if;
 if not exists(select 1 from public.site_maps m where m.id=new.map_id and m.project_id=new.project_id) then
  raise exception 'Zone map must belong to the same project' using errcode='42501';
 end if;
 if new.location_id is not null and not exists(select 1 from public.locations l where l.id=new.location_id and l.project_id=new.project_id) then
  raise exception 'Zone location must belong to the same project' using errcode='42501';
 end if;
 if new.parent_id is not null then
  if not exists(select 1 from public.site_map_zones p where p.id=new.parent_id and p.map_id=new.map_id and p.project_id=new.project_id) then
   raise exception 'A parent area must be on the same site plan' using errcode='42501';
  end if;
  with recursive up(id,parent_id,depth) as (
   select z.id,z.parent_id,1 from public.site_map_zones z where z.id=new.parent_id
   union all select z.id,z.parent_id,up.depth+1 from public.site_map_zones z join up on z.id=up.parent_id where up.depth<=20)
  select max(depth),coalesce(bool_or(id=new.id),false) into v_ancestors,v_loop from up;
  if v_loop then
   raise exception 'An area cannot be placed inside itself' using errcode='22023';
  end if;
  with recursive down(id,height) as (
   select new.id,1
   union all select z.id,down.height+1 from public.site_map_zones z join down on z.parent_id=down.id where down.height<=20)
  select max(height) into v_height from down;
  if v_ancestors+v_height>20 then
   raise exception 'Areas can be nested at most 20 levels deep' using errcode='22023';
  end if;
 end if;
 if tg_op='UPDATE' and new.map_id<>old.map_id and exists(select 1 from public.site_map_zones c where c.parent_id=new.id) then
  raise exception 'Move or detach this area''s sub-areas before moving it to another plan' using errcode='22023';
 end if;
 return new;
end $$;

-- "T1 Pipe Racks › Rack 2". Runs with the caller's rights, so row-level
-- security limits it to areas the caller can read.
create function public.site_map_zone_path(p_zone_id uuid) returns text
language sql stable set search_path=public as $$
 with recursive up(id,parent_id,name,depth) as (
  select z.id,z.parent_id,z.name,0 from public.site_map_zones z where z.id=p_zone_id
  union all select z.id,z.parent_id,z.name,up.depth+1 from public.site_map_zones z join up on z.id=up.parent_id where up.depth<50)
 select string_agg(name,' › ' order by depth desc) from up
$$;
revoke all on function public.site_map_zone_path(uuid) from public,anon;
grant execute on function public.site_map_zone_path(uuid) to authenticated;

-- An area is in use only if it and every area above it are active.
create function public.site_map_zone_is_live(p_zone_id uuid) returns boolean
language sql stable set search_path=public as $$
 with recursive up(id,parent_id,is_active,depth) as (
  select z.id,z.parent_id,z.is_active,0 from public.site_map_zones z where z.id=p_zone_id
  union all select z.id,z.parent_id,z.is_active,up.depth+1 from public.site_map_zones z join up on z.id=up.parent_id where up.depth<50)
 select exists(select 1 from up) and not exists(select 1 from up where not up.is_active)
$$;
revoke all on function public.site_map_zone_is_live(uuid) from public,anon;
grant execute on function public.site_map_zone_is_live(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Field operations: as in 019, except a count refuses retired plans, resolves
-- its area first, stores the area's full path as the location, and must name an
-- area when the project has active areas on an active plan.
-- ---------------------------------------------------------------------------
create or replace function public.apply_field_operation(p_operation_id uuid,p_project_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
<<operation>>
declare
 actor uuid:=auth.uid(); previous public.field_operations; material public.materials; qr public.qr_codes;
 record_id uuid; material_id uuid; event_id uuid; target_location uuid; qty integer; accepted integer; decision text;
 receipt public.receiving_records; before_state jsonb; result jsonb; delta jsonb;
 item public.inventory_records; item_uid uuid; tag text; item_name text; count_qty numeric; count_uom text; count_condition text;
 v_category_id uuid; v_parent_id uuid; v_proposed_name text; v_map_id uuid; v_zone_id uuid; v_zone_name text; v_zone_map uuid; v_pin_x numeric; v_pin_y numeric; created boolean;
begin
 if actor is null or not public.can_work_project(p_project_id) then
  raise exception 'An active account and assignment to an active project are required' using errcode='42501';
 end if;
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Operation ID and object payload are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into previous from public.field_operations where operation_id=p_operation_id;
 if found then
  if previous.user_id<>actor or previous.project_id<>p_project_id or previous.action<>p_action or previous.payload<>p_payload then
   raise exception 'Operation ID already belongs to a different request' using errcode='23505';
  end if;
  return previous.result;
 end if;
 if p_action='receiving' then
  if coalesce(p_payload#>>'{material,qty}','') !~ '^[0-9]+$' then raise exception 'Whole positive quantity required' using errcode='22023'; end if;
  if (p_payload#>>'{material,qty}')::numeric>2147483647 then raise exception 'Quantity is too large' using errcode='22023'; end if;
  qty:=(p_payload#>>'{material,qty}')::integer;
  decision:=p_payload#>>'{decision,status}';
  if qty<=0 or decision is null or decision not in ('accepted','partially_accepted','rejected') or length(trim(coalesce(p_payload#>>'{material,material_type}','')))=0
    or length(trim(coalesce(p_payload->>'qrCodeValue','')))=0 then
   raise exception 'Material, QR code, quantity and receiving decision are required' using errcode='22023';
  end if;
  if decision='partially_accepted' then
   if coalesce(p_payload#>>'{decision,accepted_qty}','') !~ '^[0-9]+$' then raise exception 'Specify the accepted quantity' using errcode='22023'; end if;
   if (p_payload#>>'{decision,accepted_qty}')::numeric>2147483647 then raise exception 'Quantity is too large' using errcode='22023'; end if;
   accepted:=(p_payload#>>'{decision,accepted_qty}')::integer;
   if accepted<=0 or accepted>=qty then raise exception 'Partial accepted quantity must be between zero and delivered quantity' using errcode='22023'; end if;
  else accepted:=case when decision='accepted' then qty else 0 end; end if;
  target_location:=nullif(p_payload#>>'{location,location_id}','')::uuid;
  if target_location is null or not exists(select 1 from public.locations l where l.id=target_location and l.project_id=p_project_id) then
   raise exception 'Location must belong to this project' using errcode='42501';
  end if;
  if (p_payload#>>'{material,weight}')::numeric < 0 then raise exception 'Weight cannot be negative' using errcode='22023'; end if;
  insert into public.qr_codes(code_value,entity_type,project_id) values(trim(p_payload->>'qrCodeValue'),'item',p_project_id) on conflict(code_value) do nothing;
  select * into qr from public.qr_codes where code_value=trim(p_payload->>'qrCodeValue') for update;
  if qr.project_id<>p_project_id then raise exception 'QR code belongs to another project' using errcode='42501'; end if;
  if qr.entity_id is not null then raise exception 'QR code is already linked to a receipt' using errcode='22023'; end if;
  insert into public.receiving_records(project_id,qr_code_id,status,material_type,size,grade,qty,accepted_qty,weight,description,spec,vendor,po_number,delivery_ticket,carrier,
   condition,damage_notes,inspection_pass,has_exception,exception_type,location_id,created_by)
  values(p_project_id,qr.id,decision,trim(p_payload#>>'{material,material_type}'),p_payload#>>'{material,size}',p_payload#>>'{material,grade}',qty,accepted,
   (p_payload#>>'{material,weight}')::numeric,p_payload#>>'{material,description}',p_payload#>>'{material,spec}',p_payload#>>'{po,vendor}',p_payload#>>'{po,po_number}',
   p_payload#>>'{po,delivery_ticket}',p_payload#>>'{po,carrier}',p_payload#>>'{inspection,condition}',p_payload#>>'{inspection,damage_notes}',
   coalesce((p_payload#>>'{inspection,inspection_pass}')::boolean,false),coalesce((p_payload#>>'{decision,has_exception}')::boolean,false),
   nullif(p_payload#>>'{decision,exception_type}',''),target_location,actor) returning id into record_id;
  if accepted>0 then
   insert into public.materials(project_id,receiving_record_id,qr_code_id,material_type,size,grade,qty,current_quantity,weight,spec,location_id,status)
   select p_project_id,r.id,r.qr_code_id,r.material_type,r.size,r.grade,accepted,accepted,r.weight,r.spec,r.location_id,'in_yard' from public.receiving_records r where r.id=record_id
   returning id into material_id;
  end if;
  update public.qr_codes set entity_id=record_id where id=qr.id;
  update public.inventory_records i set count_status='received',receiving_record_id=record_id
   where i.project_id=p_project_id and btrim(i.qr_code)=trim(p_payload->>'qrCodeValue') and i.count_status<>'received'
   returning i.uid into item_uid;
  result:=jsonb_build_object('id',record_id,'material_id',material_id,'accepted_qty',accepted,'inventory_uid',item_uid);
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(actor,'receiving_created','receiving_record',record_id,jsonb_build_object('operation_id',p_operation_id,'qty',qty,'accepted_qty',accepted,'status',decision,'inventory_uid',item_uid),p_project_id);
 elsif p_action='count' then
  tag:=trim(coalesce(p_payload->>'tag',''));
  item_name:=trim(coalesce(p_payload->>'name',''));
  if length(tag)=0 or length(tag)>120 then raise exception 'Tag number is required' using errcode='22023'; end if;
  if length(item_name)=0 or length(item_name)>200 then raise exception 'Item name is required' using errcode='22023'; end if;
  if coalesce(p_payload->>'quantity','') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then
   raise exception 'Quantity must be a positive number with up to 3 decimals' using errcode='22023'; end if;
  count_qty:=(p_payload->>'quantity')::numeric;
  if count_qty<=0 then raise exception 'Quantity must be a positive number with up to 3 decimals' using errcode='22023'; end if;
  count_uom:=coalesce(nullif(trim(p_payload->>'uom'),''),'EA');
  if length(count_uom)>16 then raise exception 'Unit is too long' using errcode='22023'; end if;
  count_condition:=nullif(p_payload->>'condition','');
  if count_condition is not null and count_condition not in ('good','damaged','mixed') then raise exception 'Unknown condition' using errcode='22023'; end if;
  v_category_id:=nullif(p_payload->>'categoryId','')::uuid;
  if v_category_id is not null and jsonb_typeof(p_payload->'proposedCategory')='object' then
   raise exception 'Choose a category or propose one, not both' using errcode='22023'; end if;
  if v_category_id is not null and not exists(select 1 from public.inventory_categories c where c.id=v_category_id and c.project_id=p_project_id and c.status<>'archived') then
   raise exception 'Category is unavailable in this project' using errcode='42501'; end if;
  if jsonb_typeof(p_payload->'proposedCategory')='object' then
   v_proposed_name:=trim(coalesce(p_payload#>>'{proposedCategory,name}',''));
   v_parent_id:=nullif(p_payload#>>'{proposedCategory,parentId}','')::uuid;
   if length(v_proposed_name) not between 1 and 120 then raise exception 'Proposed category needs a name' using errcode='22023'; end if;
   if v_parent_id is not null and not exists(select 1 from public.inventory_categories c where c.id=v_parent_id and c.project_id=p_project_id and c.status<>'archived') then
    raise exception 'Parent category is unavailable in this project' using errcode='42501'; end if;
   select c.id into v_category_id from public.inventory_categories c where c.project_id=p_project_id and c.status<>'archived'
    and c.parent_id is not distinct from v_parent_id and lower(c.name)=lower(v_proposed_name);
   if v_category_id is null then
    insert into public.inventory_categories(project_id,parent_id,name,status,proposed_by)
     values(p_project_id,v_parent_id,v_proposed_name,'proposed',actor) returning id into v_category_id;
   end if;
  end if;
  v_map_id:=nullif(p_payload->>'siteMapId','')::uuid;
  if v_map_id is not null and not exists(select 1 from public.site_maps m where m.id=v_map_id and m.project_id=p_project_id) then
   raise exception 'Site map is unavailable in this project' using errcode='42501'; end if;
  if v_map_id is not null and not exists(select 1 from public.site_maps m where m.id=v_map_id and m.is_active) then
   raise exception 'This site plan is no longer in use' using errcode='22023'; end if;
  -- An area names the location; it also identifies the plan when none was sent.
  v_zone_id:=nullif(p_payload->>'zoneId','')::uuid;
  if v_zone_id is not null then
   select z.map_id into v_zone_map from public.site_map_zones z where z.id=v_zone_id and z.project_id=p_project_id and (v_map_id is null or z.map_id=v_map_id);
   if not found then raise exception 'Zone is unavailable on this map' using errcode='42501'; end if;
   if not public.site_map_zone_is_live(v_zone_id) or not exists(select 1 from public.site_maps m where m.id=v_zone_map and m.is_active) then
    raise exception 'This area is no longer in use; choose another' using errcode='22023'; end if;
   v_map_id:=coalesce(v_map_id,v_zone_map);
   v_zone_name:=public.site_map_zone_path(v_zone_id);
  end if;
  if jsonb_typeof(p_payload->'pin')='object' then
   if v_map_id is null then raise exception 'A pin needs a site map' using errcode='22023'; end if;
   if jsonb_typeof(p_payload#>'{pin,x}') is distinct from 'number' or jsonb_typeof(p_payload#>'{pin,y}') is distinct from 'number' then
    raise exception 'Pin coordinates must be numbers' using errcode='22023'; end if;
   v_pin_x:=round((p_payload#>>'{pin,x}')::numeric,6); v_pin_y:=round((p_payload#>>'{pin,y}')::numeric,6);
   if v_pin_x not between 0 and 1 or v_pin_y not between 0 and 1 then raise exception 'Pin must be on the map' using errcode='22023'; end if;
  end if;
  if v_zone_id is null and exists(select 1 from public.site_map_zones z join public.site_maps m on m.id=z.map_id
    where z.project_id=p_project_id and m.is_active and (v_map_id is null or m.id=v_map_id) and public.site_map_zone_is_live(z.id)) then
   raise exception 'Choose a location' using errcode='22023'; end if;
  select * into item from public.inventory_records i where i.project_id=p_project_id and btrim(i.qr_code)=tag for update;
  created:=not found;
  if not created and item.count_status='received' then
   raise exception 'This tag has already been received' using errcode='22023'; end if;
  before_state:=case when created then null else to_jsonb(item) end;
  if created then
   insert into public.inventory_records(project_id,qr_code,inventory_item,item_description,part_number,category_id,quantity,uom,condition,
    site_map_id,pin_x,pin_y,zone_id,location,scanner_comments,count_status,source,counted_by,counted_at,last_scanned_at,last_scanned_by)
   values(p_project_id,tag,item_name,nullif(trim(p_payload->>'description'),''),nullif(trim(p_payload->>'partNumber'),''),v_category_id,count_qty,count_uom,count_condition,
    v_map_id,v_pin_x,v_pin_y,v_zone_id,v_zone_name,nullif(trim(p_payload->>'notes'),''),'counted','field',actor,now(),now(),
    (select coalesce(u.full_name,u.email) from public.users u where u.id=actor))
   returning * into item;
  else
   update public.inventory_records i set inventory_item=item_name,
    item_description=coalesce(nullif(trim(p_payload->>'description'),''),i.item_description),
    part_number=coalesce(nullif(trim(p_payload->>'partNumber'),''),i.part_number),
    category_id=coalesce(v_category_id,i.category_id),quantity=count_qty,uom=count_uom,condition=count_condition,
    site_map_id=v_map_id,pin_x=v_pin_x,pin_y=v_pin_y,zone_id=v_zone_id,location=coalesce(v_zone_name,i.location),
    scanner_comments=coalesce(nullif(trim(p_payload->>'notes'),''),i.scanner_comments),count_status='counted',counted_by=actor,counted_at=now(),
    last_scanned_at=now(),last_scanned_by=(select coalesce(u.full_name,u.email) from public.users u where u.id=actor)
   where i.id=item.id returning * into item;
  end if;
  result:=jsonb_build_object('uid',item.uid,'id',item.id,'created',created,'category_id',item.category_id,'count_status',item.count_status);
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(actor,'inventory_counted','inventory_record',item.uid,jsonb_build_object('operation_id',p_operation_id,'tag',tag,'created',created,'before',before_state,'after',to_jsonb(item)),p_project_id);
 elsif p_action in ('transfer','issue','shipment','correct_material') then
  select * into material from public.materials where id=(p_payload->>'materialId')::uuid for update;
  if not found or material.project_id<>p_project_id then raise exception 'Material is unavailable in this project' using errcode='42501'; end if;
  before_state:=to_jsonb(material);
  if p_action='transfer' then
   target_location:=(p_payload->>'toLocationId')::uuid;
   if target_location is null or not exists(select 1 from public.locations l where l.id=target_location and l.project_id=p_project_id) then
    raise exception 'Destination must belong to this project' using errcode='42501'; end if;
   if material.location_id is distinct from (p_payload->>'fromLocationId')::uuid then raise exception 'Location changed; refresh before transferring' using errcode='22023'; end if;
   if material.current_quantity<=0 then raise exception 'Cannot move depleted material' using errcode='22023'; end if;
   update public.materials set location_id=target_location where id=material.id; -- qualified below to avoid ambiguity
   insert into public.material_movements(project_id,material_id,from_location_id,to_location_id,moved_by,reason)
    values(p_project_id,material.id,material.location_id,target_location,actor,p_payload->>'reason') returning id into event_id;
  elsif p_action='correct_material' then
   if not public.is_admin(actor) then raise exception 'Only administrators can correct materials' using errcode='42501'; end if;
   delta:=p_payload->'changes';
   if length(trim(coalesce(p_payload->>'reason','')))<5 or jsonb_typeof(delta) is distinct from 'object' or delta='{}'::jsonb or
     exists(select 1 from jsonb_object_keys(delta) k where k not in ('material_type','size','grade','weight','spec')) then
    raise exception 'A correction reason and supported descriptive fields are required; use stock operations for quantities' using errcode='22023'; end if;
   if delta ? 'material_type' and length(trim(coalesce(delta->>'material_type','')))=0 then raise exception 'Material type is required' using errcode='22023'; end if;
   if (delta->>'weight')::numeric <0 then raise exception 'Weight cannot be negative' using errcode='22023'; end if;
   update public.materials m set
    material_type=case when delta?'material_type' then delta->>'material_type' else m.material_type end,
    size=case when delta?'size' then delta->>'size' else m.size end,
    grade=case when delta?'grade' then delta->>'grade' else m.grade end,
    weight=case when delta?'weight' then (delta->>'weight')::numeric else m.weight end,
    spec=case when delta?'spec' then delta->>'spec' else m.spec end where m.id=material.id;
   event_id:=material.id;
  else
   if coalesce(p_payload->>'quantity','') !~ '^[0-9]+$' then raise exception 'Whole positive quantity required' using errcode='22023'; end if;
   if (p_payload->>'quantity')::numeric>2147483647 then raise exception 'Quantity is too large' using errcode='22023'; end if;
   qty:=(p_payload->>'quantity')::integer;
   if qty<=0 or qty>material.current_quantity then raise exception 'Quantity must be positive and no greater than available stock' using errcode='22023'; end if;
   if p_action='issue' then
    if length(trim(coalesce(p_payload->>'jobNumber','')))=0 then raise exception 'Job number required' using errcode='22023'; end if;
    insert into public.material_issues(project_id,material_id,job_number,work_order,quantity_issued,issued_by)
     values(p_project_id,material.id,trim(p_payload->>'jobNumber'),p_payload->>'workOrder',qty,actor) returning id into event_id;
   else
    if length(trim(coalesce(p_payload->>'destination','')))=0 then raise exception 'Destination required' using errcode='22023'; end if;
    insert into public.shipments_out(project_id,material_id,destination,carrier,tracking_number,quantity_shipped)
     values(p_project_id,material.id,trim(p_payload->>'destination'),p_payload->>'carrier',p_payload->>'trackingNumber',qty) returning id into event_id;
   end if;
   update public.materials set current_quantity=material.current_quantity-operation.qty,
    status=case when material.current_quantity=operation.qty then case when p_action='shipment' then 'shipped' else 'depleted' end else 'in_yard' end where id=material.id;
  end if;
  select jsonb_build_object('id',event_id,'material_id',m.id,'current_quantity',m.current_quantity) into result from public.materials m where m.id=material.id;
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   select actor,case p_action when 'transfer' then 'material_transferred' when 'issue' then 'material_issued' when 'shipment' then 'shipment_created' else 'material_corrected' end,
    'material',m.id,jsonb_build_object('operation_id',p_operation_id,'before',before_state,'after',to_jsonb(m),'reason',p_payload->>'reason'),p_project_id
   from public.materials m where m.id=material.id;
 elsif p_action='exception' then
  if not public.is_office_user() then raise exception 'Office access required' using errcode='42501'; end if;
  select * into receipt from public.receiving_records where id=(p_payload->>'id')::uuid for update;
  if not found or receipt.project_id<>p_project_id then raise exception 'Receipt unavailable in this project' using errcode='42501'; end if;
  if not receipt.has_exception or p_payload->>'resolution' is null or p_payload->>'resolution' not in ('hold','return_to_vendor','released') then raise exception 'Valid exception decision required' using errcode='22023'; end if;
  if nullif(p_payload->>'ownerId','') is not null and not exists(select 1 from public.user_projects up join public.users u on u.id=up.user_id
    where up.project_id=p_project_id and up.user_id=(p_payload->>'ownerId')::uuid and public.is_active_user(u.id) and u.role in ('office_staff','admin')) then
   raise exception 'Exception owner must be active office staff assigned to this project' using errcode='42501'; end if;
  update public.receiving_records set exception_resolution=p_payload->>'resolution',exception_resolved=(p_payload->>'resolution'<>'hold'),
   exception_owner_id=nullif(p_payload->>'ownerId','')::uuid,exception_due_date=nullif(p_payload->>'dueDate','')::date,exception_notes=p_payload->>'notes' where id=receipt.id;
  result:=jsonb_build_object('id',receipt.id,'exception_resolved',p_payload->>'resolution'<>'hold');
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(actor,'exception_updated','receiving_record',receipt.id,jsonb_build_object('before',to_jsonb(receipt),'decision',p_payload,'operation_id',p_operation_id),p_project_id);
 else raise exception 'Unsupported operation' using errcode='22023'; end if;
 insert into public.field_operations(operation_id,user_id,project_id,action,payload,result) values(p_operation_id,actor,p_project_id,p_action,p_payload,result);
 return result;
end $$;
revoke all on function public.apply_field_operation(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.apply_field_operation(uuid,uuid,text,jsonb) to authenticated;

COMMIT;

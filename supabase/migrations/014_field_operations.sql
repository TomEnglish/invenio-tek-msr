BEGIN;
-- All physical stock changes, their history, and their retry receipt commit together.
create table public.field_operations (
 operation_id uuid primary key,
 user_id uuid not null references public.users(id),
 project_id uuid not null references public.projects(id),
 action text not null,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.field_operations enable row level security;
create policy own_operations on public.field_operations for select to authenticated
 using (user_id=auth.uid() and public.has_project_access(project_id));
revoke insert,update,delete on public.field_operations from anon,authenticated;

alter table public.receiving_records add column accepted_qty integer;
alter table public.receiving_records add column exception_owner_id uuid references public.users(id);
alter table public.receiving_records add column exception_due_date date;
alter table public.receiving_records add column exception_notes text;
alter table public.receiving_records drop constraint receiving_records_exception_resolution_check;
alter table public.receiving_records add constraint receiving_records_exception_resolution_check
 check (exception_resolution in ('hold','return_to_vendor','released'));

create function public.apply_field_operation(p_operation_id uuid,p_project_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
<<operation>>
declare
 actor uuid:=auth.uid(); previous public.field_operations; material public.materials; qr public.qr_codes;
 record_id uuid; material_id uuid; event_id uuid; target_location uuid; qty integer; accepted integer; decision text;
 receipt public.receiving_records; before_state jsonb; result jsonb; delta jsonb;
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
  result:=jsonb_build_object('id',record_id,'material_id',material_id,'accepted_qty',accepted);
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(actor,'receiving_created','receiving_record',record_id,jsonb_build_object('operation_id',p_operation_id,'qty',qty,'accepted_qty',accepted,'status',decision),p_project_id);
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

-- Deterministic references allow photo upload retries without duplicate rows.
create function public.attach_inspection_photo(p_record_id uuid,p_path text,p_type text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.receiving_records;
begin
 select * into r from public.receiving_records where id=p_record_id;
 if not found or not public.can_work_project(r.project_id) or (r.created_by<>auth.uid() and not public.is_office_user())
  or split_part(p_path,'/',1)<>p_record_id::text then raise exception 'Photo access denied' using errcode='42501'; end if;
 insert into public.inspection_photos(receiving_record_id,storage_path,photo_type) values(p_record_id,p_path,p_type) on conflict(storage_path) do nothing;
end $$;
revoke all on function public.attach_inspection_photo(uuid,text,text) from public,anon;
grant execute on function public.attach_inspection_photo(uuid,text,text) to authenticated;

COMMIT;

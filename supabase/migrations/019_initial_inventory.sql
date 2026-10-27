-- Initial field inventory: an office-managed category tree, site-plan maps with
-- zones, and counted items that a later receipt links to by tag number.
BEGIN;

-- ---------------------------------------------------------------------------
-- Category tree (Generator 1 > Oil System > Control Valve). Office edits it
-- directly; field users can only propose a category through a count.
-- ---------------------------------------------------------------------------
create table public.inventory_categories (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 parent_id uuid references public.inventory_categories(id),
 name text not null check (name=btrim(name) and length(name) between 1 and 120),
 status text not null default 'active' check (status in ('active','proposed','archived')),
 sort_order integer not null default 0,
 proposed_by uuid references public.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index inventory_categories_sibling_name on public.inventory_categories
 (project_id,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name)) where status<>'archived';
create index inventory_categories_parent on public.inventory_categories(parent_id);

-- Parents stay in the same project and the tree never loops.
create function public.inventory_category_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.parent_id is not null then
  if not exists(select 1 from public.inventory_categories p where p.id=new.parent_id and p.project_id=new.project_id) then
   raise exception 'Parent category must belong to the same project' using errcode='42501';
  end if;
  if exists(with recursive up(id,parent_id) as (
     select c.id,c.parent_id from public.inventory_categories c where c.id=new.parent_id
     union all select c.id,c.parent_id from public.inventory_categories c join up on c.id=up.parent_id)
    select 1 from up where up.id=new.id) then
   raise exception 'A category cannot be placed inside itself' using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger inventory_categories_guard before insert or update of parent_id,project_id on public.inventory_categories
 for each row execute function public.inventory_category_guard();
create trigger inventory_categories_updated_at before update on public.inventory_categories
 for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Site plans: an uploaded image per map, zones as normalised (0-1) polygons.
-- ---------------------------------------------------------------------------
create table public.site_maps (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 name text not null check (name=btrim(name) and length(name) between 1 and 120),
 storage_path text,
 image_width integer check (image_width between 1 and 10000),
 image_height integer check (image_height between 1 and 10000),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint site_maps_storage_path_scope check (storage_path is null
  or storage_path ~ ('^'||project_id::text||'/'||id::text||'\.(png|jpg|jpeg|webp)$'))
);
create trigger site_maps_updated_at before update on public.site_maps
 for each row execute function public.update_updated_at_column();

create function public.valid_zone_shape(shape jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(shape)='array' and jsonb_array_length(shape) between 3 and 200 then
  not exists(select 1 from jsonb_array_elements(shape) p where
   case when jsonb_typeof(p)='array' and jsonb_array_length(p)=2
     and jsonb_typeof(p->0)='number' and jsonb_typeof(p->1)='number'
    then (p->>0)::numeric not between 0 and 1 or (p->>1)::numeric not between 0 and 1
    else true end)
  else false end
$$;

create table public.site_map_zones (
 id uuid primary key default gen_random_uuid(),
 map_id uuid not null references public.site_maps(id),
 project_id uuid not null references public.projects(id),
 name text not null check (name=btrim(name) and length(name) between 1 and 120),
 shape jsonb not null check (public.valid_zone_shape(shape)),
 color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
 location_id uuid references public.locations(id),
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index site_map_zones_map on public.site_map_zones(map_id);

create function public.site_map_zone_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.site_maps m where m.id=new.map_id and m.project_id=new.project_id) then
  raise exception 'Zone map must belong to the same project' using errcode='42501';
 end if;
 if new.location_id is not null and not exists(select 1 from public.locations l where l.id=new.location_id and l.project_id=new.project_id) then
  raise exception 'Zone location must belong to the same project' using errcode='42501';
 end if;
 return new;
end $$;
create trigger site_map_zones_guard before insert or update on public.site_map_zones
 for each row execute function public.site_map_zone_guard();
create trigger site_map_zones_updated_at before update on public.site_map_zones
 for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Counted items extend the existing yard inventory records. The tag (QR value)
-- is unique per project so a later receipt can find its count.
-- ---------------------------------------------------------------------------
alter table public.inventory_records
 add column uid uuid not null default gen_random_uuid(),
 add column category_id uuid references public.inventory_categories(id),
 add column part_number text,
 add column quantity numeric(12,3) not null default 1 check (quantity>0),
 add column uom text not null default 'EA' check (uom=btrim(uom) and length(uom) between 1 and 16),
 add column condition text check (condition in ('good','damaged','mixed')),
 add column count_status text not null default 'counted' check (count_status in ('expected','counted','received')),
 add column source text not null default 'field' check (source in ('import','field','legacy')),
 add column site_map_id uuid references public.site_maps(id),
 add column pin_x numeric(7,6) check (pin_x between 0 and 1),
 add column pin_y numeric(7,6) check (pin_y between 0 and 1),
 add column zone_id uuid references public.site_map_zones(id),
 add column counted_by uuid references public.users(id),
 add column counted_at timestamptz,
 add column receiving_record_id uuid references public.receiving_records(id);
alter table public.inventory_records
 add constraint inventory_records_uid_key unique (uid),
 add constraint inventory_records_receiving_record_key unique (receiving_record_id),
 add constraint inventory_records_tag_present check (length(btrim(qr_code))>0),
 add constraint inventory_records_pin_needs_map check ((pin_x is null)=(pin_y is null) and (pin_x is null or site_map_id is not null)),
 add constraint inventory_records_received_link check ((count_status='received')=(receiving_record_id is not null));
create unique index inventory_records_project_tag on public.inventory_records(project_id,btrim(qr_code));
create index inventory_records_category on public.inventory_records(category_id);
create index inventory_records_count_status on public.inventory_records(project_id,count_status);
create trigger inventory_records_updated_at before update on public.inventory_records
 for each row execute function public.update_updated_at_column();

create function public.inventory_record_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.category_id is not null and not exists(select 1 from public.inventory_categories c where c.id=new.category_id and c.project_id=new.project_id) then
  raise exception 'Category must belong to the same project' using errcode='42501';
 end if;
 if new.site_map_id is not null and not exists(select 1 from public.site_maps m where m.id=new.site_map_id and m.project_id=new.project_id) then
  raise exception 'Site map must belong to the same project' using errcode='42501';
 end if;
 if new.zone_id is not null and not exists(select 1 from public.site_map_zones z where z.id=new.zone_id and z.project_id=new.project_id
   and (new.site_map_id is null or z.map_id=new.site_map_id)) then
  raise exception 'Zone must belong to the same project and map' using errcode='42501';
 end if;
 return new;
end $$;
create trigger inventory_records_guard before insert or update of category_id,site_map_id,zone_id,project_id on public.inventory_records
 for each row execute function public.inventory_record_guard();

-- Rows that existed before counting started become legacy counts, grouped
-- under a top-level category per unit.
update public.inventory_records set source='legacy';
insert into public.inventory_categories(project_id,name)
 select distinct on (project_id,lower(btrim(unit))) project_id,btrim(unit) from public.inventory_records
 where length(btrim(coalesce(unit,'')))>0 order by project_id,lower(btrim(unit)),btrim(unit);
update public.inventory_records r set category_id=c.id
 from public.inventory_categories c
 where c.project_id=r.project_id and c.parent_id is null and lower(c.name)=lower(btrim(r.unit));

create table public.inventory_photos (
 id uuid primary key default gen_random_uuid(),
 inventory_uid uuid not null references public.inventory_records(uid),
 project_id uuid not null references public.projects(id),
 storage_path text not null unique,
 created_by uuid references public.users(id),
 created_at timestamptz not null default now()
);
create index inventory_photos_item on public.inventory_photos(inventory_uid);

-- ---------------------------------------------------------------------------
-- Access: members read; office edits categories and maps; field writes only
-- through apply_field_operation and attach_inventory_photo.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['inventory_categories','site_maps','site_map_zones','inventory_photos'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE DELETE ON public.%I FROM anon,authenticated',t);
  EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING(public.has_project_access(project_id))',t);
  IF t<>'inventory_photos' THEN
   EXECUTE format('CREATE POLICY office_insert ON public.%I FOR INSERT TO authenticated WITH CHECK(public.is_office_user() AND public.can_work_project(project_id))',t);
   EXECUTE format('CREATE POLICY office_update ON public.%I FOR UPDATE TO authenticated USING(public.is_office_user() AND public.can_work_project(project_id)) WITH CHECK(public.is_office_user() AND public.can_work_project(project_id))',t);
  END IF;
 END LOOP;
END $$;
revoke insert,update on public.inventory_photos from anon,authenticated;

-- ---------------------------------------------------------------------------
-- Storage: site plans at <project_id>/<map_id>.<ext>; inventory photos at
-- <inventory uid>/<operation>-<n>.jpg. Same restrictive+permissive shape as 013.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets(id,name,public) VALUES
 ('site-plans','site-plans',false),('inventory-photos','inventory-photos',false)
ON CONFLICT (id) DO UPDATE SET public=false;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='allowed_mime_types') THEN
  UPDATE storage.buckets SET file_size_limit=15728640,allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp'] WHERE id='site-plans';
  UPDATE storage.buckets SET file_size_limit=10485760,allowed_mime_types=ARRAY['image/jpeg','image/png'] WHERE id='inventory-photos';
 END IF;
END $$;

create function public.can_access_site_plan_path(path text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare m public.site_maps;
begin
 select * into m from public.site_maps where id=split_part(split_part(path,'/',2),'.',1)::uuid
  and project_id=split_part(path,'/',1)::uuid;
 if not found then return false; end if;
 return case when writing then public.is_office_user() and public.can_work_project(m.project_id)
  else public.has_project_access(m.project_id) end;
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.can_access_site_plan_path(text,boolean) from public;
grant execute on function public.can_access_site_plan_path(text,boolean) to authenticated;

create function public.can_access_inventory_photo_path(path text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare item public.inventory_records;
begin
 select * into item from public.inventory_records where uid=split_part(path,'/',1)::uuid;
 if not found then return false; end if;
 return case when writing then public.can_work_project(item.project_id) else public.has_project_access(item.project_id) end;
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.can_access_inventory_photo_path(text,boolean) from public;
grant execute on function public.can_access_inventory_photo_path(text,boolean) to authenticated;

CREATE POLICY site_plan_scope_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'site-plans' OR public.can_access_site_plan_path(name,false));
CREATE POLICY site_plan_scope_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'site-plans' OR public.can_access_site_plan_path(name,true));
CREATE POLICY site_plan_scope_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'site-plans' OR public.can_access_site_plan_path(name,true))
 WITH CHECK(bucket_id<>'site-plans' OR public.can_access_site_plan_path(name,true));
CREATE POLICY site_plan_scope_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'site-plans');
CREATE POLICY site_plan_objects_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='site-plans' AND public.can_access_site_plan_path(name,false));
CREATE POLICY site_plan_objects_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='site-plans' AND public.can_access_site_plan_path(name,true));
CREATE POLICY site_plan_objects_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='site-plans' AND public.can_access_site_plan_path(name,true))
 WITH CHECK(bucket_id='site-plans' AND public.can_access_site_plan_path(name,true));

CREATE POLICY inventory_photo_scope_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'inventory-photos' OR public.can_access_inventory_photo_path(name,false));
CREATE POLICY inventory_photo_scope_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'inventory-photos' OR public.can_access_inventory_photo_path(name,true));
CREATE POLICY inventory_photo_scope_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'inventory-photos' OR public.can_access_inventory_photo_path(name,true))
 WITH CHECK(bucket_id<>'inventory-photos' OR public.can_access_inventory_photo_path(name,true));
CREATE POLICY inventory_photo_scope_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'inventory-photos');
CREATE POLICY inventory_photo_objects_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='inventory-photos' AND public.can_access_inventory_photo_path(name,false));
CREATE POLICY inventory_photo_objects_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='inventory-photos' AND public.can_access_inventory_photo_path(name,true));
CREATE POLICY inventory_photo_objects_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='inventory-photos' AND public.can_access_inventory_photo_path(name,true))
 WITH CHECK(bucket_id='inventory-photos' AND public.can_access_inventory_photo_path(name,true));

CREATE POLICY inventory_files_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
 USING(bucket_id NOT IN ('site-plans','inventory-photos')) WITH CHECK(bucket_id NOT IN ('site-plans','inventory-photos'));

-- Deterministic paths let photo uploads retry without duplicate rows.
create function public.attach_inventory_photo(p_inventory_uid uuid,p_path text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.inventory_records;
begin
 select * into item from public.inventory_records where uid=p_inventory_uid;
 if not found or not public.can_work_project(item.project_id) or split_part(p_path,'/',1)<>p_inventory_uid::text then
  raise exception 'Photo access denied' using errcode='42501';
 end if;
 insert into public.inventory_photos(inventory_uid,project_id,storage_path,created_by)
  values(p_inventory_uid,item.project_id,p_path,auth.uid()) on conflict(storage_path) do nothing;
end $$;
revoke all on function public.attach_inventory_photo(uuid,text) from public,anon;
grant execute on function public.attach_inventory_photo(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Field operations: 014 unchanged except a new 'count' action and receiving
-- now links the counted (or expected) item with the same tag.
-- ---------------------------------------------------------------------------
create or replace function public.apply_field_operation(p_operation_id uuid,p_project_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
<<operation>>
declare
 actor uuid:=auth.uid(); previous public.field_operations; material public.materials; qr public.qr_codes;
 record_id uuid; material_id uuid; event_id uuid; target_location uuid; qty integer; accepted integer; decision text;
 receipt public.receiving_records; before_state jsonb; result jsonb; delta jsonb;
 item public.inventory_records; item_uid uuid; tag text; item_name text; count_qty numeric; count_uom text; count_condition text;
 v_category_id uuid; v_parent_id uuid; v_proposed_name text; v_map_id uuid; v_zone_id uuid; v_zone_name text; v_pin_x numeric; v_pin_y numeric; created boolean;
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
  if jsonb_typeof(p_payload->'pin')='object' then
   if v_map_id is null then raise exception 'A pin needs a site map' using errcode='22023'; end if;
   if jsonb_typeof(p_payload#>'{pin,x}') is distinct from 'number' or jsonb_typeof(p_payload#>'{pin,y}') is distinct from 'number' then
    raise exception 'Pin coordinates must be numbers' using errcode='22023'; end if;
   v_pin_x:=round((p_payload#>>'{pin,x}')::numeric,6); v_pin_y:=round((p_payload#>>'{pin,y}')::numeric,6);
   if v_pin_x not between 0 and 1 or v_pin_y not between 0 and 1 then raise exception 'Pin must be on the map' using errcode='22023'; end if;
  end if;
  v_zone_id:=nullif(p_payload->>'zoneId','')::uuid;
  if v_zone_id is not null then
   select z.name into v_zone_name from public.site_map_zones z where z.id=v_zone_id and z.project_id=p_project_id and (v_map_id is null or z.map_id=v_map_id);
   if not found then raise exception 'Zone is unavailable on this map' using errcode='42501'; end if;
  end if;
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

-- ---------------------------------------------------------------------------
-- Office import of early data. Validates every row first; a dry run returns
-- the plan without writing. Counted and received tags are never overwritten.
-- ---------------------------------------------------------------------------
create function public.import_inventory_items(p_project_id uuid,p_items jsonb,p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_row jsonb; v_index integer:=0; v_tag text; v_name text; v_qty numeric; v_uom text; v_path text[]; v_segment text;
 v_parent uuid; v_category uuid; v_existing public.inventory_records; v_action text;
 v_errors jsonb:='[]'::jsonb; v_rows jsonb:='[]'::jsonb; v_created integer:=0; v_updated integer:=0; v_skipped integer:=0; v_new_categories integer:=0;
 v_missing boolean; v_prefix text; v_seen text[]:='{}';
begin
 if auth.uid() is null or not public.is_office_user() or not public.can_work_project(p_project_id) then
  raise exception 'Office access to an active project is required' using errcode='42501';
 end if;
 perform 1 from public.projects where id=p_project_id for update;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 5000 then
  raise exception 'Provide between 1 and 5000 items' using errcode='22023';
 end if;
 for v_row in select value from jsonb_array_elements(p_items) loop
  v_index:=v_index+1;
  if jsonb_typeof(v_row)<>'object' or v_row-array['tag','name','description','category_path','part_number','quantity','uom']<>'{}'::jsonb then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_row->>'tag','message','Unexpected columns'); continue; end if;
  v_tag:=btrim(coalesce(v_row->>'tag',''));
  if length(v_tag) not between 1 and 120 then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Tag number is required'); continue; end if;
  if coalesce(nullif(v_row->>'quantity',''),'1') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Quantity must be a positive number'); continue; end if;
  if coalesce(nullif(v_row->>'quantity',''),'1')::numeric<=0 then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Quantity must be a positive number'); continue; end if;
  if length(btrim(coalesce(v_row->>'uom','EA')))>16 then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Unit is too long'); continue; end if;
  if exists(select 1 from unnest(string_to_array(coalesce(v_row->>'category_path',''),'>')) s where length(btrim(s))>120) then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Category names are limited to 120 characters'); continue; end if;
 end loop;
 for v_tag in select btrim(r->>'tag') from jsonb_array_elements(p_items) r where length(btrim(coalesce(r->>'tag','')))>0
  group by btrim(r->>'tag') having count(*)>1 loop
  v_errors:=v_errors||jsonb_build_object('row',null,'tag',v_tag,'message','Tag appears more than once in the file');
 end loop;
 if jsonb_array_length(v_errors)>0 then
  return jsonb_build_object('applied',false,'errors',v_errors,'rows','[]'::jsonb,'created',0,'updated',0,'skipped',0,'new_categories',0);
 end if;

 v_index:=0;
 for v_row in select value from jsonb_array_elements(p_items) loop
  v_index:=v_index+1;
  v_tag:=btrim(v_row->>'tag');
  v_path:=array(select btrim(s) from unnest(string_to_array(coalesce(v_row->>'category_path',''),'>')) s where length(btrim(s))>0);
  v_name:=coalesce(nullif(btrim(v_row->>'name'),''),nullif(btrim(v_row->>'description'),''),v_path[array_length(v_path,1)],v_tag);
  v_qty:=coalesce(nullif(v_row->>'quantity',''),'1')::numeric;
  v_uom:=coalesce(nullif(btrim(v_row->>'uom'),''),'EA');
  -- Walk the category path, reusing existing nodes and creating missing ones.
  v_parent:=null; v_category:=null; v_missing:=false; v_prefix:='';
  foreach v_segment in array v_path loop
   v_prefix:=v_prefix||'>'||lower(v_segment);
   v_category:=null;
   if not v_missing then
    select c.id into v_category from public.inventory_categories c where c.project_id=p_project_id and c.status<>'archived'
     and c.parent_id is not distinct from v_parent and lower(c.name)=lower(v_segment);
   end if;
   if v_category is null then
    if p_dry_run then
     -- A missing level makes every deeper level new; count each new path once.
     v_missing:=true;
     if not (v_prefix=any(v_seen)) then v_seen:=v_seen||v_prefix; v_new_categories:=v_new_categories+1; end if;
    else
     insert into public.inventory_categories(project_id,parent_id,name) values(p_project_id,v_parent,v_segment) returning id into v_category;
     v_new_categories:=v_new_categories+1;
    end if;
   elsif not p_dry_run then
    update public.inventory_categories set status='active' where id=v_category and status='proposed';
   end if;
   v_parent:=v_category;
  end loop;
  select * into v_existing from public.inventory_records i where i.project_id=p_project_id and btrim(i.qr_code)=v_tag for update;
  if not found then v_action:='create'; v_created:=v_created+1;
   if not p_dry_run then
    insert into public.inventory_records(project_id,qr_code,inventory_item,item_description,part_number,category_id,quantity,uom,count_status,source)
     values(p_project_id,v_tag,v_name,nullif(btrim(v_row->>'description'),''),nullif(btrim(v_row->>'part_number'),''),v_category,v_qty,v_uom,'expected','import');
   end if;
  elsif v_existing.count_status='expected' then v_action:='update'; v_updated:=v_updated+1;
   if not p_dry_run then
    update public.inventory_records set inventory_item=v_name,item_description=nullif(btrim(v_row->>'description'),''),
     part_number=nullif(btrim(v_row->>'part_number'),''),category_id=coalesce(v_category,category_id),quantity=v_qty,uom=v_uom
     where id=v_existing.id;
   end if;
  else v_action:='skip_'||v_existing.count_status; v_skipped:=v_skipped+1; end if;
  v_rows:=v_rows||jsonb_build_object('row',v_index,'tag',v_tag,'action',v_action);
 end loop;
 if not p_dry_run then
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(auth.uid(),'inventory_imported','project',p_project_id,
    jsonb_build_object('created',v_created,'updated',v_updated,'skipped',v_skipped,'new_categories',v_new_categories),p_project_id);
 end if;
 return jsonb_build_object('applied',not p_dry_run,'errors','[]'::jsonb,'rows',v_rows,'created',v_created,'updated',v_updated,
  'skipped',v_skipped,'new_categories',v_new_categories);
end $$;
revoke all on function public.import_inventory_items(uuid,jsonb,boolean) from public,anon;
grant execute on function public.import_inventory_items(uuid,jsonb,boolean) to authenticated;

-- Fold one category (often a field proposal) into another: items and child
-- categories move across, then the source is archived.
create function public.merge_inventory_category(p_from uuid,p_into uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_from public.inventory_categories; v_into public.inventory_categories; v_items integer; v_children integer;
begin
 select * into v_from from public.inventory_categories where id=p_from for update;
 select * into v_into from public.inventory_categories where id=p_into for update;
 if v_from.id is null or v_into.id is null or v_from.project_id<>v_into.project_id or auth.uid() is null
   or not public.is_office_user() or not public.can_work_project(v_from.project_id) then
  raise exception 'Office access to both categories is required' using errcode='42501';
 end if;
 if v_from.id=v_into.id or v_into.status='archived' or v_from.status='archived' then
  raise exception 'Choose two different, current categories' using errcode='22023';
 end if;
 if exists(with recursive up(id,parent_id) as (
    select c.id,c.parent_id from public.inventory_categories c where c.id=p_into
    union all select c.id,c.parent_id from public.inventory_categories c join up on c.id=up.parent_id)
   select 1 from up where up.id=p_from) then
  raise exception 'A category cannot be merged into one of its own subcategories' using errcode='22023';
 end if;
 if exists(select 1 from public.inventory_categories a join public.inventory_categories b on lower(a.name)=lower(b.name)
   where a.parent_id=p_from and b.parent_id=p_into and a.status<>'archived' and b.status<>'archived') then
  raise exception 'Both categories have a subcategory with the same name; merge those first' using errcode='23505';
 end if;
 update public.inventory_records set category_id=p_into where category_id=p_from;
 get diagnostics v_items=row_count;
 update public.inventory_categories set parent_id=p_into where parent_id=p_from and status<>'archived';
 get diagnostics v_children=row_count;
 update public.inventory_categories set status='archived' where id=p_from;
 update public.inventory_categories set status='active' where id=p_into and status='proposed';
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'inventory_category_merged','inventory_category',p_into,
   jsonb_build_object('from',to_jsonb(v_from),'items_moved',v_items,'children_moved',v_children),v_from.project_id);
 return jsonb_build_object('items_moved',v_items,'children_moved',v_children);
end $$;
revoke all on function public.merge_inventory_category(uuid,uuid) from public,anon;
grant execute on function public.merge_inventory_category(uuid,uuid) to authenticated;

COMMIT;

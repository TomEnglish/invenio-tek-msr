-- Places and crates: places shared by every project (our yards and sites,
-- outside shops, vendors), handling units with their own HU- labels that hold
-- items and other units, and the pack/unpack field operations.
BEGIN;

-- ---------------------------------------------------------------------------
-- Places. A map point and radius let a tracker's arrival be recognised later.
-- A yard or site may belong to one project; shops and vendors belong to none.
-- ---------------------------------------------------------------------------
create table public.places (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('yard','site','outside_shop','vendor','other')),
 name text not null check (name=btrim(name) and length(name) between 1 and 120),
 project_id uuid references public.projects(id),
 address text check (length(address)<=200),
 city text check (length(city)<=80),
 state text check (length(state)<=40),
 postal_code text check (length(postal_code)<=20),
 latitude numeric(9,6) check (latitude between -90 and 90),
 longitude numeric(9,6) check (longitude between -180 and 180),
 geofence_radius_m integer not null default 300 check (geofence_radius_m between 25 and 20000),
 contact_name text check (length(contact_name)<=120),
 contact_phone text check (length(contact_phone)<=40),
 contact_email text check (length(contact_email)<=200),
 secondary_contact_name text check (length(secondary_contact_name)<=120),
 secondary_contact_phone text check (length(secondary_contact_phone)<=40),
 notes text check (length(notes)<=2000),
 is_active boolean not null default true,
 created_by uuid references public.users(id) default auth.uid(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint places_point_pair check ((latitude is null)=(longitude is null)),
 constraint places_project_kind check (project_id is null or kind in ('yard','site'))
);
create unique index places_active_name on public.places(lower(name)) where is_active;
create trigger places_updated_at before update on public.places
 for each row execute function public.update_updated_at_column();

alter table public.places enable row level security;
revoke delete on public.places from anon,authenticated;
create policy active_read on public.places for select to authenticated using(public.is_active_user(auth.uid()));
create policy office_insert on public.places for insert to authenticated
 with check(public.is_office_user() and (project_id is null or public.can_work_project(project_id)));
create policy office_update on public.places for update to authenticated
 using(public.is_office_user() and (project_id is null or public.can_work_project(project_id)))
 with check(public.is_office_user() and (project_id is null or public.can_work_project(project_id)));

-- ---------------------------------------------------------------------------
-- Handling units: crates, skids, bundles, baskets and containers. A unit can
-- sit inside another; its own place and area count only while it is on top.
-- The on_load and delivered states are for loads, which come next.
-- ---------------------------------------------------------------------------
alter table public.qr_codes drop constraint qr_codes_entity_type_check,
 add constraint qr_codes_entity_type_check check (entity_type in ('item','pallet','shipment','handling_unit'));

create table public.handling_units (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 code text not null unique check (code ~ '^HU-[A-Z0-9]{4,20}$'),
 kind text not null default 'crate' check (kind in ('crate','skid','bundle','basket','container','other')),
 description text check (length(description)<=200),
 is_high_value boolean not null default false,
 status text not null default 'open' check (status in ('open','sealed','on_load','delivered','unpacked')),
 parent_id uuid references public.handling_units(id),
 place_id uuid references public.places(id),
 site_map_id uuid references public.site_maps(id),
 zone_id uuid references public.site_map_zones(id),
 location text check (length(location)<=500),
 created_by uuid references public.users(id),
 sealed_by uuid references public.users(id),
 sealed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint handling_units_not_own_parent check (parent_id is distinct from id),
 constraint handling_units_sealed_stamp check (status<>'sealed' or sealed_at is not null)
);
create index handling_units_parent on public.handling_units(parent_id);
create index handling_units_project_status on public.handling_units(project_id,status);
create trigger handling_units_updated_at before update on public.handling_units
 for each row execute function public.update_updated_at_column();

-- References stay in the project, nesting never loops and stops at 5 levels.
-- Nesting takes turns per project (an advisory lock) at READ COMMITTED, so two
-- phones can't put crates inside each other at the same moment.
create function public.handling_unit_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_ancestors integer; v_loop boolean; v_height integer;
begin
 if new.site_map_id is not null and not exists(select 1 from public.site_maps m where m.id=new.site_map_id and m.project_id=new.project_id) then
  raise exception 'Site plan must belong to the same project' using errcode='42501';
 end if;
 if new.zone_id is not null and not exists(select 1 from public.site_map_zones z where z.id=new.zone_id and z.project_id=new.project_id
   and (new.site_map_id is null or z.map_id=new.site_map_id)) then
  raise exception 'Area must belong to the same project and plan' using errcode='42501';
 end if;
 if new.place_id is not null and not exists(select 1 from public.places p where p.id=new.place_id and (p.project_id is null or p.project_id=new.project_id)) then
  raise exception 'That place belongs to another project' using errcode='42501';
 end if;
 if new.parent_id is not null and (tg_op='INSERT' or new.parent_id is distinct from old.parent_id) then
  if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Nest crates at READ COMMITTED so simultaneous packing is checked' using errcode='0A000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('handling_units:'||new.project_id::text,0));
  if not exists(select 1 from public.handling_units p where p.id=new.parent_id and p.project_id=new.project_id) then
   raise exception 'A crate can only go inside a crate from the same project' using errcode='42501';
  end if;
  with recursive up(id,parent_id,depth) as (
   select h.id,h.parent_id,1 from public.handling_units h where h.id=new.parent_id
   union all select h.id,h.parent_id,up.depth+1 from public.handling_units h join up on h.id=up.parent_id where up.depth<=5)
  select max(depth),coalesce(bool_or(id=new.id),false) into v_ancestors,v_loop from up;
  if v_loop then
   raise exception 'A crate cannot go inside itself or a crate it contains' using errcode='22023';
  end if;
  with recursive down(id,height) as (
   select new.id,1
   union all select h.id,down.height+1 from public.handling_units h join down on h.parent_id=down.id where down.height<=5)
  select max(height) into v_height from down;
  if v_ancestors+v_height>5 then
   raise exception 'Crates can be nested at most 5 levels deep' using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger handling_units_guard before insert or update of parent_id,project_id,place_id,site_map_id,zone_id on public.handling_units
 for each row execute function public.handling_unit_guard();

-- What is in each unit now and what was in it before. Whole items only: a
-- received material or, before receipt, a counted item.
create table public.handling_unit_contents (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 unit_id uuid not null references public.handling_units(id),
 material_id uuid references public.materials(id),
 inventory_uid uuid references public.inventory_records(uid),
 tag text not null check (length(tag) between 1 and 120),
 quantity numeric(12,3) not null check (quantity>0),
 uom text not null default 'EA',
 packed_by uuid references public.users(id),
 packed_at timestamptz not null default now(),
 removed_by uuid references public.users(id),
 removed_at timestamptz,
 constraint handling_unit_contents_one_item check (num_nonnulls(material_id,inventory_uid)=1)
);
create unique index handling_unit_contents_active_material on public.handling_unit_contents(material_id)
 where removed_at is null and material_id is not null;
create unique index handling_unit_contents_active_item on public.handling_unit_contents(inventory_uid)
 where removed_at is null and inventory_uid is not null;
create index handling_unit_contents_unit on public.handling_unit_contents(unit_id) where removed_at is null;

create function public.handling_unit_contents_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.handling_units u where u.id=new.unit_id and u.project_id=new.project_id)
   or (new.material_id is not null and not exists(select 1 from public.materials m where m.id=new.material_id and m.project_id=new.project_id))
   or (new.inventory_uid is not null and not exists(select 1 from public.inventory_records i where i.uid=new.inventory_uid and i.project_id=new.project_id)) then
  raise exception 'Crate and item must belong to the same project' using errcode='42501';
 end if;
 return new;
end $$;
create trigger handling_unit_contents_guard before insert or update of project_id,unit_id,material_id,inventory_uid on public.handling_unit_contents
 for each row execute function public.handling_unit_contents_guard();

-- Members read; every write goes through apply_field_operation.
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['handling_units','handling_unit_contents'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON public.%I FROM anon,authenticated',t);
  EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING(public.has_project_access(project_id))',t);
 END LOOP;
END $$;

-- The outermost unit a unit sits in (itself when it is on top). Runs with the
-- caller's rights.
create function public.handling_unit_top(p_unit_id uuid) returns public.handling_units
language sql stable set search_path=public as $$
 with recursive up(id,parent_id,depth) as (
  select h.id,h.parent_id,0 from public.handling_units h where h.id=p_unit_id
  union all select h.id,h.parent_id,up.depth+1 from public.handling_units h join up on h.id=up.parent_id where up.depth<20)
 select h.* from public.handling_units h join up on up.id=h.id order by up.depth desc limit 1
$$;
revoke all on function public.handling_unit_top(uuid) from public,anon;
grant execute on function public.handling_unit_top(uuid) to authenticated;

-- One row per unit with where its outermost unit is, and what it holds.
create view public.handling_unit_overview with (security_invoker=true) as
select u.id,u.project_id,u.code,u.kind,u.description,u.is_high_value,u.status,u.parent_id,p.code as parent_code,
 top.id as top_unit_id,top.code as top_code,top.place_id,pl.name as place_name,top.site_map_id,top.zone_id,top.location,
 (select count(*) from public.handling_unit_contents c where c.unit_id=u.id and c.removed_at is null)::integer as item_count,
 (select count(*) from public.handling_units k where k.parent_id=u.id)::integer as unit_count,
 u.sealed_at,u.created_at,u.updated_at
from public.handling_units u
left join public.handling_units p on p.id=u.parent_id
cross join lateral public.handling_unit_top(u.id) top
left join public.places pl on pl.id=top.place_id;

-- Items packed in a unit now, with a readable name.
create view public.handling_unit_items with (security_invoker=true) as
select c.id,c.project_id,c.unit_id,u.code as unit_code,c.material_id,c.inventory_uid,c.tag,
 coalesce(i.inventory_item,nullif(concat_ws(' ',m.material_type,m.size,m.grade),''),c.tag) as name,
 c.quantity,c.uom,c.packed_by,c.packed_at
from public.handling_unit_contents c
join public.handling_units u on u.id=c.unit_id
left join public.materials m on m.id=c.material_id
left join public.inventory_records i on i.uid=c.inventory_uid
where c.removed_at is null;

-- ---------------------------------------------------------------------------
-- Crate labels. Office reserves a batch of unused HU- codes to print; a label
-- becomes a unit the first time it is packed.
-- ---------------------------------------------------------------------------
create function public.reserve_handling_unit_labels(p_project_id uuid,p_count integer)
returns table(code text) language plpgsql security definer set search_path=public,pg_temp as $$
declare alphabet constant text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text; v_codes text[]:='{}'; tries integer:=0;
begin
 if not public.is_office_user() or not public.can_work_project(p_project_id) then
  raise exception 'Office access to an active project is required' using errcode='42501';
 end if;
 if p_count is null or p_count not between 1 and 500 then
  raise exception 'Reserve between 1 and 500 labels at a time' using errcode='22023';
 end if;
 while coalesce(array_length(v_codes,1),0)<p_count loop
  tries:=tries+1;
  if tries>p_count*20 then raise exception 'Could not find enough free label codes; try again' using errcode='55000'; end if;
  v_code:='HU-'||(select string_agg(substr(alphabet,1+floor(random()*32)::integer,1),'') from generate_series(1,6));
  insert into public.qr_codes(code_value,entity_type,project_id) values(v_code,'handling_unit',p_project_id) on conflict(code_value) do nothing;
  if found then v_codes:=v_codes||v_code; end if;
 end loop;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'handling_unit_labels_reserved','qr_code',null,jsonb_build_object('count',p_count,'codes',to_jsonb(v_codes)),p_project_id);
 return query select unnest(v_codes);
end $$;
revoke all on function public.reserve_handling_unit_labels(uuid,integer) from public,anon;
grant execute on function public.reserve_handling_unit_labels(uuid,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Logistics field operations, called only from apply_field_operation (which
-- has already checked the caller, the project and the operation ID).
--  pack:   {unitCode, kind?, description?, isHighValue?, placeId?, zoneId?,
--           siteMapId?, add?: [tag], remove?: [tag], seal?}
--          Tags starting HU- are units to nest; the rest are item tags.
--  unpack: {unitCode}
-- ---------------------------------------------------------------------------
create function public.apply_logistics_operation(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
 v_code text; v_qr public.qr_codes; v_unit public.handling_units; v_top public.handling_units; v_child public.handling_units;
 v_material public.materials; v_item public.inventory_records; v_existing public.handling_unit_contents;
 v_before jsonb; v_created boolean:=false; v_tag text; v_kind text; v_added text[]:='{}'; v_removed text[]:='{}';
 v_place_id uuid; v_map_id uuid; v_zone_id uuid; v_zone_map uuid; v_seal boolean; v_items integer; v_units integer; result jsonb;
begin
 if p_action not in ('pack','unpack') then
  raise exception 'Unsupported operation' using errcode='22023';
 end if;
 v_code:=upper(btrim(coalesce(p_payload->>'unitCode','')));
 if v_code !~ '^HU-[A-Z0-9]{4,20}$' then
  raise exception 'Scan a crate label (HU-…)' using errcode='22023';
 end if;

 if p_action='pack' then
  if (p_payload ? 'add' and jsonb_typeof(p_payload->'add')<>'array') or (p_payload ? 'remove' and jsonb_typeof(p_payload->'remove')<>'array') then
   raise exception 'Items to add or remove must be lists of tags' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_payload->'add','[]'))+jsonb_array_length(coalesce(p_payload->'remove','[]'))>500 then
   raise exception 'Pack at most 500 tags at a time' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'add','[]')||coalesce(p_payload->'remove','[]')) e where jsonb_typeof(e)<>'string') then
   raise exception 'Tags must be text' using errcode='22023';
  end if;
  if (p_payload ? 'isHighValue' and jsonb_typeof(p_payload->'isHighValue')<>'boolean') or (p_payload ? 'seal' and jsonb_typeof(p_payload->'seal')<>'boolean') then
   raise exception 'High value and seal must be true or false' using errcode='22023';
  end if;
  v_kind:=coalesce(nullif(p_payload->>'kind',''),'crate');
  if v_kind not in ('crate','skid','bundle','basket','container','other') then
   raise exception 'Unknown crate type' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_payload->>'description','')))>200 then
   raise exception 'Description is too long' using errcode='22023';
  end if;
  v_seal:=coalesce((p_payload->>'seal')::boolean,false);

  -- The label: unused, or already this project's crate label.
  insert into public.qr_codes(code_value,entity_type,project_id) values(v_code,'handling_unit',p_project_id) on conflict(code_value) do nothing;
  select * into v_qr from public.qr_codes where code_value=v_code for update;
  if v_qr.project_id is distinct from p_project_id then
   raise exception 'This label belongs to another project' using errcode='42501';
  end if;
  if v_qr.entity_type<>'handling_unit' then
   raise exception 'This is an item tag, not a crate label' using errcode='22023';
  end if;
  select * into v_unit from public.handling_units where code=v_code for update;
  v_created:=not found;
  if v_created then
   insert into public.handling_units(project_id,code,kind,description,is_high_value,created_by)
   values(p_project_id,v_code,v_kind,nullif(btrim(p_payload->>'description'),''),coalesce((p_payload->>'isHighValue')::boolean,false),p_actor)
   returning * into v_unit;
   update public.qr_codes set entity_id=v_unit.id where id=v_qr.id;
  else
   if v_unit.status not in ('open','sealed','unpacked') then
    raise exception 'This crate is on a load; unload it before repacking' using errcode='22023';
   end if;
   v_before:=to_jsonb(v_unit);
   update public.handling_units h set
    kind=case when p_payload ? 'kind' then v_kind else h.kind end,
    description=case when p_payload ? 'description' then nullif(btrim(p_payload->>'description'),'') else h.description end,
    is_high_value=case when p_payload ? 'isHighValue' then (p_payload->>'isHighValue')::boolean else h.is_high_value end,
    status='open',sealed_by=null,sealed_at=null
   where h.id=v_unit.id returning * into v_unit;
  end if;

  -- Where the unit is: a place and an area, as a count names its area.
  v_place_id:=nullif(p_payload->>'placeId','')::uuid;
  if v_place_id is not null then
   if not exists(select 1 from public.places p where p.id=v_place_id and p.is_active and (p.project_id is null or p.project_id=p_project_id)) then
    raise exception 'That place is unavailable' using errcode='42501';
   end if;
   update public.handling_units set place_id=v_place_id where id=v_unit.id;
  end if;
  v_map_id:=nullif(p_payload->>'siteMapId','')::uuid;
  v_zone_id:=nullif(p_payload->>'zoneId','')::uuid;
  if v_map_id is not null and not exists(select 1 from public.site_maps m where m.id=v_map_id and m.project_id=p_project_id and m.is_active) then
   raise exception 'This site plan is unavailable or no longer in use' using errcode='42501';
  end if;
  if v_zone_id is not null then
   select z.map_id into v_zone_map from public.site_map_zones z where z.id=v_zone_id and z.project_id=p_project_id and (v_map_id is null or z.map_id=v_map_id);
   if not found then raise exception 'Zone is unavailable on this map' using errcode='42501'; end if;
   if not public.site_map_zone_is_live(v_zone_id) or not exists(select 1 from public.site_maps m where m.id=v_zone_map and m.is_active) then
    raise exception 'This area is no longer in use; choose another' using errcode='22023';
   end if;
   update public.handling_units set site_map_id=v_zone_map,zone_id=v_zone_id,location=public.site_map_zone_path(v_zone_id) where id=v_unit.id;
  end if;
  select * into v_unit from public.handling_units where id=v_unit.id;

  -- Take things out first, so a tag can move between lists in one pack.
  for v_tag in select btrim(e) from jsonb_array_elements_text(coalesce(p_payload->'remove','[]')) e loop
   if upper(v_tag) ~ '^HU-' then
    v_top:=public.handling_unit_top(v_unit.id);
    update public.handling_units set parent_id=null,place_id=v_top.place_id,site_map_id=v_top.site_map_id,zone_id=v_top.zone_id,location=v_top.location
     where code=upper(v_tag) and parent_id=v_unit.id;
    if not found then raise exception '% isn''t in this crate',upper(v_tag) using errcode='22023'; end if;
    v_removed:=v_removed||upper(v_tag);
   else
    update public.handling_unit_contents set removed_at=now(),removed_by=p_actor where unit_id=v_unit.id and removed_at is null and tag=v_tag;
    if not found then raise exception '% isn''t in this crate',v_tag using errcode='22023'; end if;
    v_removed:=v_removed||v_tag;
   end if;
  end loop;

  for v_tag in select btrim(e) from jsonb_array_elements_text(coalesce(p_payload->'add','[]')) e loop
   if length(v_tag) not between 1 and 120 then
    raise exception 'Tag numbers must be 1 to 120 characters' using errcode='22023';
   end if;
   if upper(v_tag) ~ '^HU-' then
    select * into v_child from public.handling_units where code=upper(v_tag) for update;
    if not found or v_child.project_id<>p_project_id then
     raise exception 'Crate % isn''t in this project',upper(v_tag) using errcode='42501';
    end if;
    if v_child.id=v_unit.id then raise exception 'A crate can''t go inside itself' using errcode='22023'; end if;
    continue when v_child.parent_id=v_unit.id;
    if v_child.parent_id is not null then
     raise exception '% is already inside %; take it out first',v_child.code,(select h.code from public.handling_units h where h.id=v_child.parent_id) using errcode='22023';
    end if;
    if v_child.status not in ('open','sealed') then
     raise exception '% is %; it can''t go inside another crate',v_child.code,replace(v_child.status,'_',' ') using errcode='22023';
    end if;
    update public.handling_units set parent_id=v_unit.id where id=v_child.id;
    v_added:=v_added||v_child.code;
   else
    -- A received material first; otherwise a counted item not yet received.
    select m.* into v_material from public.materials m join public.qr_codes q on q.id=m.qr_code_id
     where q.code_value=v_tag and m.project_id=p_project_id for update of m;
    if found then
     if v_material.status<>'in_yard' or v_material.current_quantity<=0 then
      raise exception '% has been issued or shipped; it can''t be packed',v_tag using errcode='22023';
     end if;
     select * into v_existing from public.handling_unit_contents c where c.material_id=v_material.id and c.removed_at is null;
    else
     select * into v_item from public.inventory_records i where i.project_id=p_project_id and btrim(i.qr_code)=v_tag for update;
     if not found or v_item.count_status<>'counted' then
      raise exception '% isn''t a received or counted item in this project',v_tag using errcode='22023';
     end if;
     select * into v_existing from public.handling_unit_contents c where c.inventory_uid=v_item.uid and c.removed_at is null;
    end if;
    if v_existing.id is not null then
     continue when v_existing.unit_id=v_unit.id;
     raise exception '% is already in crate %; take it out of that crate first',v_tag,
      (select h.code from public.handling_units h where h.id=v_existing.unit_id) using errcode='22023';
    end if;
    insert into public.handling_unit_contents(project_id,unit_id,material_id,inventory_uid,tag,quantity,uom,packed_by)
    values(p_project_id,v_unit.id,v_material.id,case when v_material.id is null then v_item.uid end,v_tag,
     case when v_material.id is null then v_item.quantity else v_material.current_quantity end,
     case when v_material.id is null then v_item.uom else 'EA' end,p_actor);
    v_added:=v_added||v_tag;
   end if;
  end loop;

  select count(*) into v_items from public.handling_unit_contents c where c.unit_id=v_unit.id and c.removed_at is null;
  select count(*) into v_units from public.handling_units h where h.parent_id=v_unit.id;
  if v_seal then
   if v_items+v_units=0 then
    raise exception 'An empty crate can''t be sealed' using errcode='22023';
   end if;
   if v_unit.parent_id is null and v_unit.zone_id is null and exists(select 1 from public.site_map_zones z join public.site_maps m on m.id=z.map_id
     where z.project_id=p_project_id and m.is_active and public.site_map_zone_is_live(z.id)) then
    raise exception 'Choose a location' using errcode='22023';
   end if;
   update public.handling_units set status='sealed',sealed_by=p_actor,sealed_at=now() where id=v_unit.id;
  end if;
  select * into v_unit from public.handling_units where id=v_unit.id;
  result:=jsonb_build_object('id',v_unit.id,'code',v_unit.code,'status',v_unit.status,'created',v_created,'item_count',v_items,'unit_count',v_units);
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(p_actor,'handling_unit_packed','handling_unit',v_unit.id,jsonb_build_object('operation_id',p_operation_id,'created',v_created,
    'added',to_jsonb(v_added),'removed',to_jsonb(v_removed),'before',v_before,'after',to_jsonb(v_unit)),p_project_id);

 else
  select * into v_unit from public.handling_units where code=v_code for update;
  if not found or v_unit.project_id<>p_project_id then
   raise exception 'Crate % isn''t in this project',v_code using errcode='42501';
  end if;
  if v_unit.status not in ('open','sealed') then
   raise exception 'This crate is %; it can''t be unpacked',replace(v_unit.status,'_',' ') using errcode='22023';
  end if;
  v_before:=to_jsonb(v_unit);
  -- Everything comes out where the outermost crate is.
  v_top:=public.handling_unit_top(v_unit.id);
  update public.handling_unit_contents set removed_at=now(),removed_by=p_actor where unit_id=v_unit.id and removed_at is null;
  get diagnostics v_items=row_count;
  update public.handling_units set parent_id=null,place_id=v_top.place_id,site_map_id=v_top.site_map_id,zone_id=v_top.zone_id,location=v_top.location
   where parent_id=v_unit.id;
  get diagnostics v_units=row_count;
  update public.handling_units set status='unpacked',parent_id=null,sealed_by=null,sealed_at=null,
   place_id=v_top.place_id,site_map_id=v_top.site_map_id,zone_id=v_top.zone_id,location=v_top.location
  where id=v_unit.id returning * into v_unit;
  result:=jsonb_build_object('id',v_unit.id,'code',v_unit.code,'status',v_unit.status,'items_released',v_items,'units_released',v_units);
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(p_actor,'handling_unit_unpacked','handling_unit',v_unit.id,jsonb_build_object('operation_id',p_operation_id,
    'items_released',v_items,'units_released',v_units,'before',v_before,'after',to_jsonb(v_unit)),p_project_id);
 end if;
 return result;
end $$;
revoke all on function public.apply_logistics_operation(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- Field operations: as in 020, except a material that is issued or shipped in
-- full comes out of its crate, and actions this function doesn't know go to
-- apply_logistics_operation (so later logistics steps replace only that).
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
   update public.handling_unit_contents c set removed_at=now(),removed_by=actor
    from public.materials m where m.id=material.id and c.material_id=m.id and c.removed_at is null and m.status<>'in_yard';
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
 else result:=public.apply_logistics_operation(actor,p_operation_id,p_project_id,p_action,p_payload); end if;
 insert into public.field_operations(operation_id,user_id,project_id,action,payload,result) values(p_operation_id,actor,p_project_id,p_action,p_payload,result);
 return result;
end $$;
revoke all on function public.apply_field_operation(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.apply_field_operation(uuid,uuid,text,jsonb) to authenticated;

COMMIT;

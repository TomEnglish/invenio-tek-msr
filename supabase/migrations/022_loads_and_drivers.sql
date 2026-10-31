-- Loads, stops and drivers, and the fixes from the 31 October workflow review
-- that have to be in place before loads go live.
--
-- A load is one outside carrier's truck trip: its ordered stops, a manifest of
-- crates and loose items, the driver, and up to three companies between us and
-- the driver. The office plans loads; a crew can start one for a truck that
-- turns up unannounced. A truck leaves only with the driver's licence number
-- and a photo of it, unless office staff record why not. The licence is kept
-- apart: only office staff can read it, it never goes into field_operations
-- (the audit log keeps only its last four characters), and a daily server job
-- removes it 90 days after the load closes, or after its last activity if it
-- never closes. Office staff finish stops at outside shops and vendors, and
-- write off pieces that are really lost.
--
-- Items: a tag is unique within its project whatever its capitals, and HU-
-- codes are crate labels only. A counted item that is received keeps its crate
-- and load lines; a rejected delivery doesn't use up the tag. Every item has
-- one current place and area, and site plans belong to a place. Stock in a
-- crate, on a truck, on hold or being returned can't be moved, issued or
-- shipped as if it were loose, and Ship Out is for office staff. Changes made
-- offline carry the time they were made, and older ones don't overwrite newer.
--
-- Every write goes through apply_field_operation, which hands logistics
-- actions to apply_logistics_operation.
BEGIN;

-- ---------------------------------------------------------------------------
-- Tags and labels. A tag is unique within its project whatever its capitals,
-- so the same tag can exist in two projects. HU- codes are crate labels and
-- nothing else, unique across projects so a label always finds one crate.
-- ---------------------------------------------------------------------------
alter table public.qr_codes drop constraint qr_codes_code_value_key,
 add constraint qr_codes_crate_labels check ((entity_type='handling_unit')=(code_value ~* '^HU-'));
create unique index qr_codes_project_code on public.qr_codes(project_id,lower(code_value));
create unique index qr_codes_crate_label on public.qr_codes(lower(code_value)) where entity_type='handling_unit';

drop index public.inventory_records_project_tag;
create unique index inventory_records_project_tag on public.inventory_records(project_id,lower(btrim(qr_code)));

-- An item's own place and area, which say where it is while it is loose; in a
-- crate or on a truck the crate or the load says (item_positions). A written-off
-- item was lost on a load. A count can carry a "rejected on delivery" note.
alter table public.materials
 add column place_id uuid references public.places(id),
 add column site_map_id uuid references public.site_maps(id),
 add column zone_id uuid references public.site_map_zones(id),
 add column is_high_value boolean not null default false,
 drop constraint materials_status_check,
 add constraint materials_status_check check (status in ('in_yard','issued','shipped','depleted','written_off'));
alter table public.inventory_records
 add column place_id uuid references public.places(id),
 add column is_high_value boolean not null default false,
 add column rejected_receipt_id uuid references public.receiving_records(id),
 add column written_off_at timestamptz,
 add column written_off_by uuid references public.users(id),
 add constraint inventory_records_written_off check ((written_off_at is null)=(written_off_by is null));

-- A crate that was on a truck but wasn't unloaded where expected is missing
-- until it is scanned or the office marks it found; one that is really gone
-- is written off.
alter table public.handling_units drop constraint handling_units_status_check,
 add constraint handling_units_status_check check (status in ('open','sealed','on_load','delivered','unpacked','missing','written_off'));

-- A site plan draws one yard or site, so an area always names a place. A rack
-- is linked to at most one area, which receiving and transfers record.
alter table public.site_maps add column place_id uuid references public.places(id);
create unique index site_map_zones_rack on public.site_map_zones(location_id) where is_active and location_id is not null;

create function public.site_map_place_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.place_id is not null and not exists(select 1 from public.places p where p.id=new.place_id and p.kind in ('yard','site')
   and (p.project_id is null or p.project_id=new.project_id)) then
  raise exception 'A site plan draws one of this project''s yards or sites' using errcode='42501';
 end if;
 if new.place_id is not null and new.place_id is distinct from (case when tg_op='UPDATE' then old.place_id end)
   and not exists(select 1 from public.places p where p.id=new.place_id and p.is_active) then
  raise exception 'That place is retired; restore it or choose another' using errcode='22023';
 end if;
 return new;
end $$;
create trigger site_maps_place_guard before insert or update of place_id,project_id on public.site_maps
 for each row execute function public.site_map_place_guard();
-- An existing plan belongs to its project's yard or site, where the project
-- has just one.
update public.site_maps m set place_id=p.id
 from (select project_id,(array_agg(id))[1] as id from public.places where kind in ('yard','site') and is_active and project_id is not null
  group by project_id having count(*)=1) p
 where m.place_id is null and p.project_id=m.project_id;

create function public.material_position_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.place_id is not null and not exists(select 1 from public.places p where p.id=new.place_id and (p.project_id is null or p.project_id=new.project_id)) then
  raise exception 'That place belongs to another project' using errcode='42501';
 end if;
 if new.site_map_id is not null and not exists(select 1 from public.site_maps m where m.id=new.site_map_id and m.project_id=new.project_id) then
  raise exception 'Site plan must belong to the same project' using errcode='42501';
 end if;
 if new.zone_id is not null and not exists(select 1 from public.site_map_zones z where z.id=new.zone_id and z.project_id=new.project_id
   and (new.site_map_id is null or z.map_id=new.site_map_id)) then
  raise exception 'Area must belong to the same project and plan' using errcode='42501';
 end if;
 return new;
end $$;
create trigger materials_position_guard before insert or update of project_id,place_id,site_map_id,zone_id on public.materials
 for each row execute function public.material_position_guard();

-- As in 019, plus: HU- codes aren't item tags, and the place is one the
-- project can use.
create or replace function public.inventory_record_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if btrim(new.qr_code) ~* '^HU-' then
  raise exception 'HU- codes are crate labels; give the item its own tag' using errcode='22023';
 end if;
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
 if new.place_id is not null and not exists(select 1 from public.places p where p.id=new.place_id and (p.project_id is null or p.project_id=new.project_id)) then
  raise exception 'That place belongs to another project' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger inventory_records_guard on public.inventory_records;
create trigger inventory_records_guard before insert or update of qr_code,category_id,site_map_id,zone_id,place_id,project_id on public.inventory_records
 for each row execute function public.inventory_record_guard();

-- A tag received before it was counted or imported: its new record starts
-- out received, linked to that receipt.
create function public.inventory_record_link_receipt() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_receipt uuid;
begin
 if new.count_status='received' then return new; end if;
 select r.id into v_receipt from public.qr_codes q join public.receiving_records r on r.id=q.entity_id
  where q.project_id=new.project_id and lower(q.code_value)=lower(btrim(new.qr_code)) and q.entity_type='item'
   and r.status in ('accepted','partially_accepted') and not exists(select 1 from public.inventory_records i where i.receiving_record_id=r.id);
 if v_receipt is not null then
  new.count_status:='received'; new.receiving_record_id:=v_receipt;
 end if;
 return new;
end $$;
create trigger inventory_records_link_receipt before insert on public.inventory_records
 for each row execute function public.inventory_record_link_receipt();

-- Count records change only by counting, importing and receiving.
drop policy office_insert on public.inventory_records;
drop policy office_update on public.inventory_records;

-- One-off repairs for records made under the old rules: a rejected delivery
-- gives its tag back and leaves the count as it was, a count or import made
-- after its receipt is linked to it, and a received item's crate record
-- follows it to the received material.
update public.qr_codes q set entity_id=null from public.receiving_records r
 where r.id=q.entity_id and q.entity_type='item' and r.status='rejected';
update public.inventory_records i set count_status=case when i.counted_at is not null then 'counted' else 'expected' end,
 receiving_record_id=null,rejected_receipt_id=r.id
 from public.receiving_records r where r.id=i.receiving_record_id and r.status='rejected';
update public.inventory_records i set count_status='received',receiving_record_id=r.id
 from public.qr_codes q join public.receiving_records r on r.id=q.entity_id
 where q.project_id=i.project_id and lower(q.code_value)=lower(btrim(i.qr_code)) and q.entity_type='item' and i.count_status<>'received'
  and r.status in ('accepted','partially_accepted') and not exists(select 1 from public.inventory_records x where x.receiving_record_id=r.id);
update public.handling_unit_contents c set material_id=m.id,inventory_uid=null
 from public.inventory_records i join public.materials m on m.receiving_record_id=i.receiving_record_id
 where c.inventory_uid=i.uid and c.removed_at is null and i.count_status='received'
  and not exists(select 1 from public.handling_unit_contents x where x.material_id=m.id and x.removed_at is null);

-- As in 021, with the per-project label index.
create or replace function public.reserve_handling_unit_labels(p_project_id uuid,p_count integer)
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
  insert into public.qr_codes(code_value,entity_type,project_id) values(v_code,'handling_unit',p_project_id) on conflict do nothing;
  if found then v_codes:=v_codes||v_code; end if;
 end loop;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'handling_unit_labels_reserved','qr_code',null,jsonb_build_object('count',p_count,'codes',to_jsonb(v_codes)),p_project_id);
 return query select unnest(v_codes);
end $$;

-- As in 019, except tags match whatever their capitals and HU- crate labels
-- are refused. A tag that was already received is imported as received.
create or replace function public.import_inventory_items(p_project_id uuid,p_items jsonb,p_dry_run boolean default true) returns jsonb
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
 -- Receiving and counting a tag wait for an import, and it for them.
 perform pg_advisory_xact_lock(hashtextextended('tags:'||p_project_id::text,0));
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
  if v_tag ~* '^HU-' then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','HU- codes are crate labels; give the item its own tag'); continue; end if;
  if coalesce(nullif(v_row->>'quantity',''),'1') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Quantity must be a positive number'); continue; end if;
  if coalesce(nullif(v_row->>'quantity',''),'1')::numeric<=0 then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Quantity must be a positive number'); continue; end if;
  if length(btrim(coalesce(v_row->>'uom','EA')))>16 then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Unit is too long'); continue; end if;
  if exists(select 1 from unnest(string_to_array(coalesce(v_row->>'category_path',''),'>')) s where length(btrim(s))>120) then
   v_errors:=v_errors||jsonb_build_object('row',v_index,'tag',v_tag,'message','Category names are limited to 120 characters'); continue; end if;
 end loop;
 for v_tag in select min(btrim(r->>'tag')) from jsonb_array_elements(p_items) r where length(btrim(coalesce(r->>'tag','')))>0
  group by lower(btrim(r->>'tag')) having count(*)>1 loop
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
  select * into v_existing from public.inventory_records i where i.project_id=p_project_id and lower(btrim(i.qr_code))=lower(v_tag) for update;
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

-- ---------------------------------------------------------------------------
-- Loads: one truck trip, numbered L-0001 upwards in each project. The driver's
-- name and phone are on the load so anyone on the project can call them. A
-- load a crew starts is marked started_in_field for the office to review.
-- edited_at is when the latest saved change was made, on whichever device.
-- ---------------------------------------------------------------------------
create table public.loads (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 load_number text not null check (load_number ~ '^L-[0-9]{4,6}$'),
 status text not null default 'planning' check (status in ('planning','loading','in_transit','delivered','closed','cancelled')),
 origin_place_id uuid references public.places(id),
 planned_date date,
 truck_type text check (length(truck_type)<=60),
 truck_number text check (length(truck_number)<=40),
 trailer_number text check (length(trailer_number)<=40),
 bol_number text check (length(bol_number)<=60),
 driver_name text check (length(driver_name)<=120),
 driver_phone text check (length(driver_phone)<=40),
 licence_recorded_at timestamptz,
 licence_override_reason text check (length(licence_override_reason) between 5 and 500),
 licence_override_by uuid references public.users(id),
 licence_override_at timestamptz,
 started_in_field boolean not null default false,
 notes text check (length(notes)<=2000),
 created_by uuid references public.users(id),
 edited_at timestamptz not null default now(),
 departed_by uuid references public.users(id),
 departed_at timestamptz,
 delivered_at timestamptz,
 closed_by uuid references public.users(id),
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint loads_project_number unique (project_id,load_number),
 constraint loads_departed check (status in ('planning','loading','cancelled') or departed_at is not null),
 constraint loads_finished check ((status in ('closed','cancelled'))=(closed_at is not null)),
 constraint loads_licence_override check ((licence_override_reason is null)=(licence_override_at is null) and (licence_override_at is null)=(licence_override_by is null))
);
create index loads_project_status on public.loads(project_id,status);
create trigger loads_updated_at before update on public.loads
 for each row execute function public.update_updated_at_column();

-- Up to three companies between us and the driver, in order from the one we
-- hired to the one whose truck it is.
create table public.load_companies (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 load_id uuid not null references public.loads(id),
 position integer not null check (position between 1 and 3),
 name text not null check (name=btrim(name) and length(name) between 1 and 120),
 role text not null default 'carrier' check (role in ('broker','carrier','dispatcher','other')),
 contact_name text check (length(contact_name)<=120),
 phone text check (length(phone)<=40),
 created_at timestamptz not null default now(),
 constraint load_companies_position unique (load_id,position)
);

-- The places a load goes to after it leaves, in order. A stop taken off the
-- plan stays as cancelled, with no place in the order.
create table public.load_stops (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 load_id uuid not null references public.loads(id),
 seq integer check (seq between 1 and 50),
 place_id uuid not null references public.places(id),
 kind text not null default 'dropoff' check (kind in ('dropoff','pickup','both')),
 planned_date date,
 status text not null default 'pending' check (status in ('pending','arrived','done','cancelled')),
 arrived_at timestamptz,
 arrived_source text check (arrived_source in ('scan','tracker','office')),
 completed_by uuid references public.users(id),
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint load_stops_order unique (load_id,seq) deferrable initially deferred,
 constraint load_stops_cancelled check ((status='cancelled')=(seq is null)),
 constraint load_stops_arrived check ((status in ('arrived','done'))=(arrived_at is not null) and (arrived_at is null)=(arrived_source is null)),
 constraint load_stops_done check ((status='done')=(completed_at is not null))
);
create index load_stops_load on public.load_stops(load_id);
create trigger load_stops_updated_at before update on public.load_stops
 for each row execute function public.update_updated_at_column();

-- The manifest: one line per top-level crate or loose item on a load. A piece
-- is on at most one load at a time, from being planned until it comes off,
-- is left behind or is taken off the plan. A missing piece stays on its load
-- until it is scanned, found or written off.
create table public.load_lines (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 load_id uuid not null references public.loads(id),
 unit_id uuid references public.handling_units(id),
 material_id uuid references public.materials(id),
 inventory_uid uuid references public.inventory_records(uid),
 tag text not null check (length(tag) between 1 and 120),
 pickup_stop_id uuid references public.load_stops(id),
 dropoff_stop_id uuid not null references public.load_stops(id),
 status text not null default 'planned' check (status in ('planned','on_board','delivered','missing','not_loaded','removed','written_off')),
 flag text check (flag in ('extra','wrong_stop','found')),
 added_in_field boolean not null default false,
 unit_status_before text,
 delivered_stop_id uuid references public.load_stops(id),
 delivered_place_id uuid references public.places(id),
 delivered_source text check (delivered_source in ('scan','tracker','office')),
 note text check (length(note)<=500),
 planned_by uuid references public.users(id),
 on_by uuid references public.users(id),
 on_at timestamptz,
 off_by uuid references public.users(id),
 off_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint load_lines_one_piece check (num_nonnulls(unit_id,material_id,inventory_uid)=1),
 constraint load_lines_delivered check ((status='delivered')=(delivered_place_id is not null and delivered_source is not null)),
 constraint load_lines_boarded check (status not in ('on_board','missing') or on_at is not null)
);
create unique index load_lines_open_unit on public.load_lines(unit_id)
 where status in ('planned','on_board','missing') and unit_id is not null;
create unique index load_lines_open_material on public.load_lines(material_id)
 where status in ('planned','on_board','missing') and material_id is not null;
create unique index load_lines_open_item on public.load_lines(inventory_uid)
 where status in ('planned','on_board','missing') and inventory_uid is not null;
create index load_lines_load on public.load_lines(load_id,status);
create index load_lines_dropoff on public.load_lines(dropoff_stop_id);
create trigger load_lines_updated_at before update on public.load_lines
 for each row execute function public.update_updated_at_column();

-- A missing piece the office wrote off, and everything that went with it as
-- it was before, so an administrator can undo it.
create table public.load_write_offs (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 load_id uuid not null references public.loads(id),
 line_id uuid not null references public.load_lines(id),
 reason text not null check (length(reason) between 5 and 500),
 affected jsonb not null,
 written_off_by uuid not null references public.users(id),
 written_off_at timestamptz not null default now(),
 undone_by uuid references public.users(id),
 undone_at timestamptz,
 undo_reason text check (length(undo_reason) between 5 and 500),
 constraint load_write_offs_undone check ((undone_at is null)=(undone_by is null) and (undone_at is null)=(undo_reason is null))
);
create unique index load_write_offs_open on public.load_write_offs(line_id) where undone_at is null;

-- Everything on a load stays in the load's project, places are ones the
-- project can use, and a line's stops belong to its own load.
create function public.load_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_table_name='loads' then
  if new.origin_place_id is not null and not exists(select 1 from public.places p where p.id=new.origin_place_id
    and (p.project_id is null or p.project_id=new.project_id)) then
   raise exception 'That place belongs to another project' using errcode='42501';
  end if;
  return new;
 end if;
 if not exists(select 1 from public.loads l where l.id=new.load_id and l.project_id=new.project_id) then
  raise exception 'A load''s stops and pieces belong to its project' using errcode='42501';
 end if;
 if tg_table_name='load_stops' then
  if not exists(select 1 from public.places p where p.id=new.place_id and (p.project_id is null or p.project_id=new.project_id)) then
   raise exception 'That place belongs to another project' using errcode='42501';
  end if;
 elsif tg_table_name='load_lines' then
  if exists(select 1 from public.load_stops s where s.id in (new.pickup_stop_id,new.dropoff_stop_id,new.delivered_stop_id) and s.load_id<>new.load_id)
    or (new.unit_id is not null and not exists(select 1 from public.handling_units u where u.id=new.unit_id and u.project_id=new.project_id))
    or (new.material_id is not null and not exists(select 1 from public.materials m where m.id=new.material_id and m.project_id=new.project_id))
    or (new.inventory_uid is not null and not exists(select 1 from public.inventory_records i where i.uid=new.inventory_uid and i.project_id=new.project_id)) then
   raise exception 'A load''s stops and pieces belong to its project' using errcode='42501';
  end if;
 elsif tg_table_name='load_write_offs' then
  if not exists(select 1 from public.load_lines x where x.id=new.line_id and x.load_id=new.load_id) then
   raise exception 'A load''s stops and pieces belong to its project' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
create trigger loads_guard before insert or update of project_id,origin_place_id on public.loads
 for each row execute function public.load_guard();
create trigger load_companies_guard before insert or update of project_id,load_id on public.load_companies
 for each row execute function public.load_guard();
create trigger load_stops_guard before insert or update of project_id,load_id,place_id on public.load_stops
 for each row execute function public.load_guard();
create trigger load_lines_guard before insert or update of project_id,load_id,unit_id,material_id,inventory_uid,pickup_stop_id,dropoff_stop_id,delivered_stop_id
 on public.load_lines for each row execute function public.load_guard();
create trigger load_write_offs_guard before insert or update of project_id,load_id,line_id on public.load_write_offs
 for each row execute function public.load_guard();

-- Members read; every write goes through apply_field_operation.
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['loads','load_companies','load_stops','load_lines','load_write_offs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON public.%I FROM anon,authenticated',t);
  EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING(public.has_project_access(project_id))',t);
 END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Places are shared by every project, so one project's office can't claim,
-- change the kind of, or retire a place another project is using. Every
-- change to a place is in the audit log.
-- ---------------------------------------------------------------------------
create function public.place_users(p_place_id uuid) returns table(project_id uuid)
language sql stable security definer set search_path=public as $$
 select l.project_id from public.loads l where l.origin_place_id=p_place_id and l.status not in ('closed','cancelled')
 union select s.project_id from public.load_stops s join public.loads l on l.id=s.load_id
  where s.place_id=p_place_id and s.status<>'cancelled' and l.status not in ('closed','cancelled')
 union select u.project_id from public.handling_units u where u.place_id=p_place_id and u.status not in ('unpacked','written_off')
 union select m.project_id from public.materials m where m.place_id=p_place_id and m.status='in_yard'
 union select i.project_id from public.inventory_records i where i.place_id=p_place_id and i.count_status<>'received' and i.written_off_at is null
 union select m.project_id from public.site_maps m where m.place_id=p_place_id and m.is_active
$$;
revoke all on function public.place_users(uuid) from public,anon,authenticated;

create function public.place_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.project_id is not null and new.project_id is distinct from old.project_id
   and exists(select 1 from public.place_users(old.id) u where u.project_id<>new.project_id) then
  raise exception '% is in use by other projects, so it can''t belong to one project',old.name using errcode='22023';
 end if;
 if (new.kind<>old.kind or (old.is_active and not new.is_active)) and not public.is_admin(auth.uid())
   and exists(select 1 from public.place_users(old.id) u where not public.can_work_project(u.project_id)) then
  raise exception '% is in use by another project; ask an administrator to change or retire it',old.name using errcode='42501';
 end if;
 return new;
end $$;
create trigger places_guard before update of project_id,kind,is_active on public.places
 for each row execute function public.place_guard();

create function public.place_audit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
 values(auth.uid(),case when tg_op='INSERT' then 'place_created' else 'place_updated' end,'place',new.id,
  jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) end,'after',to_jsonb(new)),new.project_id);
 return null;
end $$;
create trigger places_audit after insert or update on public.places
 for each row execute function public.place_audit();

-- A project can't be completed or archived while it has loads open, so no
-- licence outlives its load's project unnoticed.
create function public.project_loads_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_open integer;
begin
 if new.status in ('completed','archived') and new.status is distinct from old.status then
  select count(*) into v_open from public.loads l where l.project_id=new.id and l.status not in ('closed','cancelled');
  if v_open>0 then
   raise exception 'Close or cancel this project''s open loads (%) first',v_open using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger projects_loads_guard before update of status on public.projects
 for each row execute function public.project_loads_guard();

-- ---------------------------------------------------------------------------
-- Driver licences. Anyone working the project can record one while the load
-- is open; only office staff can read them. Photos sit in the private
-- driver-licences bucket at <load id>/<name>.jpg, at most four per load.
-- Every licence operation ID is remembered so a late retry never overwrites
-- a newer correction.
-- ---------------------------------------------------------------------------
create table public.load_driver_licences (
 load_id uuid primary key references public.loads(id),
 project_id uuid not null references public.projects(id),
 licence_number text check (licence_number ~ '^[A-Z0-9][A-Z0-9 -]{2,39}$'),
 licence_state text check (length(licence_state)<=40),
 licence_expiry date,
 recorded_by uuid references public.users(id),
 recorded_at timestamptz not null default now(),
 removed_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint load_driver_licences_kept check ((removed_at is null)=(licence_number is not null)),
 constraint load_driver_licences_removed check (removed_at is null or (licence_state is null and licence_expiry is null))
);
create trigger load_driver_licences_updated_at before update on public.load_driver_licences
 for each row execute function public.update_updated_at_column();

create table public.driver_licence_photos (
 id uuid primary key default gen_random_uuid(),
 load_id uuid not null references public.loads(id),
 project_id uuid not null references public.projects(id),
 storage_path text not null unique,
 created_by uuid references public.users(id),
 created_at timestamptz not null default now(),
 removed_at timestamptz
);
create index driver_licence_photos_load on public.driver_licence_photos(load_id);

create table public.load_licence_operations (
 operation_id uuid primary key,
 load_id uuid not null references public.loads(id),
 project_id uuid not null references public.projects(id),
 user_id uuid not null references public.users(id),
 applied_at timestamptz not null default now()
);

DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['load_driver_licences','driver_licence_photos','load_licence_operations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON public.%I FROM anon,authenticated',t);
  EXECUTE format('CREATE POLICY office_read ON public.%I FOR SELECT TO authenticated USING(public.is_office_user() AND public.has_project_access(project_id))',t);
 END LOOP;
END $$;

INSERT INTO storage.buckets(id,name,public) VALUES ('driver-licences','driver-licences',false)
ON CONFLICT (id) DO UPDATE SET public=false;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='allowed_mime_types') THEN
  UPDATE storage.buckets SET file_size_limit=10485760,allowed_mime_types=ARRAY['image/jpeg','image/png'] WHERE id='driver-licences';
 END IF;
END $$;

-- Files are named <load id>/<name>.jpg, .jpeg or .png. Writing needs work
-- access to the load's project while the load is open (office staff can
-- still add to a closed one) and, for a new file, fewer than four in the
-- folder. Reading needs office access; office staff can delete at any time.
create function public.can_access_driver_licence_path(path text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare v_load public.loads;
begin
 select * into v_load from public.loads where id=split_part(path,'/',1)::uuid;
 if not found then return false; end if;
 return case when writing then path ~ ('^'||v_load.id::text||'/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png)$')
   and public.can_work_project(v_load.project_id) and (v_load.status not in ('closed','cancelled') or public.is_office_user())
  else public.is_office_user() and public.has_project_access(v_load.project_id) end;
exception when invalid_text_representation then return false;
end $$;
-- Uploads to one load's folder take turns, so a fifth file can't land
-- alongside a fourth.
create function public.can_add_driver_licence_path(path text) returns boolean
language plpgsql volatile security definer set search_path=public as $$
begin
 if not public.can_access_driver_licence_path(path,true) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-licences:'||split_part(path,'/',1),0));
 return (select count(*) from storage.objects o where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=split_part(path,'/',1))<4;
end $$;
create function public.can_remove_driver_licence_path(path text) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare v_load public.loads;
begin
 select * into v_load from public.loads where id=split_part(path,'/',1)::uuid;
 return found and public.is_office_user() and public.has_project_access(v_load.project_id);
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.can_access_driver_licence_path(text,boolean),public.can_add_driver_licence_path(text),
 public.can_remove_driver_licence_path(text) from public,anon;
grant execute on function public.can_access_driver_licence_path(text,boolean),public.can_add_driver_licence_path(text),
 public.can_remove_driver_licence_path(text) to authenticated;

CREATE POLICY driver_licence_scope_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'driver-licences' OR public.can_access_driver_licence_path(name,false));
CREATE POLICY driver_licence_scope_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'driver-licences' OR public.can_add_driver_licence_path(name));
CREATE POLICY driver_licence_scope_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'driver-licences' OR public.can_access_driver_licence_path(name,true))
 WITH CHECK(bucket_id<>'driver-licences' OR public.can_access_driver_licence_path(name,true));
CREATE POLICY driver_licence_scope_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'driver-licences' OR public.can_remove_driver_licence_path(name));
CREATE POLICY driver_licence_objects_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='driver-licences' AND public.can_access_driver_licence_path(name,false));
CREATE POLICY driver_licence_objects_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='driver-licences' AND public.can_add_driver_licence_path(name));
CREATE POLICY driver_licence_objects_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='driver-licences' AND public.can_access_driver_licence_path(name,true))
 WITH CHECK(bucket_id='driver-licences' AND public.can_access_driver_licence_path(name,true));
CREATE POLICY driver_licence_objects_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='driver-licences' AND public.can_remove_driver_licence_path(name));
CREATE POLICY driver_licence_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
 USING(bucket_id<>'driver-licences') WITH CHECK(bucket_id<>'driver-licences');

-- ---------------------------------------------------------------------------
-- Helpers for field operations. They have no access of their own and run
-- inside apply_field_operation. Text is trimmed and empty means none.
-- ---------------------------------------------------------------------------
create function public.logistics_text(p_object jsonb,p_key text,p_max integer,p_label text) returns text
language plpgsql immutable set search_path=pg_catalog as $$
declare v text;
begin
 if jsonb_typeof(p_object->p_key) not in ('string','number','null') then
  raise exception '% must be text',p_label using errcode='22023';
 end if;
 v:=nullif(btrim(coalesce(p_object->>p_key,'')),'');
 if length(v)>p_max then
  raise exception '% is too long (at most % characters)',p_label,p_max using errcode='22023';
 end if;
 return v;
end $$;

create function public.logistics_date(p_object jsonb,p_key text,p_label text) returns date
language plpgsql stable set search_path=pg_catalog as $$
declare v text:=nullif(btrim(coalesce(p_object->>p_key,'')),'');
begin
 if v is null then return null; end if;
 if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  raise exception '% must be a date like 2026-11-30',p_label using errcode='22023';
 end if;
 begin
  return v::date;
 exception when others then
  raise exception '% isn''t a real date',p_label using errcode='22023';
 end;
end $$;

create function public.logistics_id(p_object jsonb,p_key text,p_label text) returns uuid
language plpgsql immutable set search_path=pg_catalog as $$
declare v text:=nullif(btrim(coalesce(p_object->>p_key,'')),'');
begin
 if v is null then return null; end if;
 if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception '% isn''t a valid ID',p_label using errcode='22023';
 end if;
 return v::uuid;
end $$;

create function public.logistics_flag(p_object jsonb,p_key text,p_label text) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(p_object->p_key) not in ('boolean','null') then
  raise exception '% must be true or false',p_label using errcode='22023';
 end if;
 return coalesce((p_object->>p_key)::boolean,false);
end $$;

create function public.logistics_list(p_object jsonb,p_key text,p_label text) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(p_object->p_key) is null or jsonb_typeof(p_object->p_key)='null' then return '[]'::jsonb; end if;
 if jsonb_typeof(p_object->p_key)<>'array' then
  raise exception 'Send % as a list',p_label using errcode='22023';
 end if;
 if jsonb_array_length(p_object->p_key)>500 then
  raise exception 'Send at most 500 % at a time',p_label using errcode='22023';
 end if;
 return p_object->p_key;
end $$;

-- capturedAt: when the change was made on the device, as an ISO 8601 time
-- with a zone. A clock running ahead is taken as now.
create function public.logistics_captured(p_object jsonb) returns timestamptz
language plpgsql stable set search_path=pg_catalog as $$
declare v text:=nullif(btrim(coalesce(p_object->>'capturedAt','')),''); v_at timestamptz;
begin
 if v is null then return null; end if;
 if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
  raise exception 'capturedAt must be a time like 2026-11-30T14:05:00Z' using errcode='22023';
 end if;
 begin
  v_at:=v::timestamptz;
 exception when others then
  raise exception 'capturedAt isn''t a real time' using errcode='22023';
 end;
 return least(v_at,now());
end $$;

-- How far a device's clock may run behind or ahead before its changes are
-- judged older or newer than another's. Within it, the later upload wins.
create function public.logistics_clock_slack() returns interval
language sql immutable set search_path=pg_catalog as $$ select interval '5 minutes' $$;

-- Crate labels are upper case; item tags are kept as written.
create function public.logistics_code(p_code text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when upper(btrim(coalesce(p_code,''))) ~ '^HU-' then upper(btrim(p_code)) else btrim(coalesce(p_code,'')) end
$$;

-- The records behind an item tag in a project, whatever its capitals: its
-- received material, if any, and its count record, if any.
create function public.logistics_tag(p_project_id uuid,p_tag text,out material_id uuid,out inventory_uid uuid)
language sql stable set search_path=public as $$
 select (select m.id from public.materials m join public.qr_codes q on q.id=m.qr_code_id
   where q.project_id=p_project_id and lower(q.code_value)=lower(btrim(p_tag)) and m.project_id=p_project_id
   order by m.created_at desc limit 1),
  (select i.uid from public.inventory_records i where i.project_id=p_project_id and lower(btrim(i.qr_code))=lower(btrim(p_tag)))
$$;

create function public.logistics_load(p_project_id uuid,p_load_id uuid) returns public.loads
language plpgsql set search_path=public,pg_temp as $$
declare v public.loads;
begin
 if p_load_id is null then raise exception 'Choose a load' using errcode='22023'; end if;
 select * into v from public.loads where id=p_load_id for update;
 if not found or v.project_id<>p_project_id then
  raise exception 'That load isn''t in this project' using errcode='42501';
 end if;
 return v;
end $$;

create function public.logistics_place(p_project_id uuid,p_place_id uuid) returns public.places
language plpgsql stable set search_path=public,pg_temp as $$
declare v public.places;
begin
 if p_place_id is null then raise exception 'Choose a place' using errcode='22023'; end if;
 select * into v from public.places where id=p_place_id;
 if not found or not v.is_active or (v.project_id is not null and v.project_id<>p_project_id) then
  raise exception 'That place is unavailable' using errcode='42501';
 end if;
 return v;
end $$;

-- Where something is put: an active place the project can use and, if given,
-- an area of a live site plan. The area has to be at that place: on a plan
-- drawn for it or, on a plan not yet tied to a place, at a yard or site
-- (never a shop or vendor). With no place, the area's plan names it.
-- p_require_area asks for an area wherever the place has a plan with areas
-- (with no place, wherever the project has one, as before).
create function public.logistics_position(p_project_id uuid,p_place_id uuid,p_map_id uuid,p_zone_id uuid,p_require_area boolean)
returns table(place_id uuid,site_map_id uuid,zone_id uuid,location text)
language plpgsql stable set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_place public.places; v_map public.site_maps; v_zone public.site_map_zones;
begin
 if p_place_id is not null then v_place:=public.logistics_place(p_project_id,p_place_id); end if;
 if p_map_id is not null then
  select * into v_map from public.site_maps m where m.id=p_map_id and m.project_id=p_project_id;
  if not found then raise exception 'This site plan is unavailable or no longer in use' using errcode='42501'; end if;
  if not v_map.is_active then raise exception 'This site plan is no longer in use' using errcode='22023'; end if;
 end if;
 if p_zone_id is not null then
  select * into v_zone from public.site_map_zones z where z.id=p_zone_id and z.project_id=p_project_id and (p_map_id is null or z.map_id=p_map_id);
  if not found then raise exception 'Zone is unavailable on this map' using errcode='42501'; end if;
  select * into v_map from public.site_maps m where m.id=v_zone.map_id;
  if not public.site_map_zone_is_live(v_zone.id) or not v_map.is_active then
   raise exception 'This area is no longer in use; choose another' using errcode='22023';
  end if;
  if v_place.id is null then
   if v_map.place_id is not null then v_place:=public.logistics_place(p_project_id,v_map.place_id); end if;
  elsif v_map.place_id is distinct from v_place.id and not (v_map.place_id is null and v_place.kind in ('yard','site')) then
   raise exception 'That area isn''t at %',v_place.name using errcode='22023';
  end if;
 elsif p_require_area and exists(select 1 from public.site_map_zones z join public.site_maps m on m.id=z.map_id
   where z.project_id=p_project_id and m.is_active and public.site_map_zone_is_live(z.id) and (p_map_id is null or m.id=p_map_id)
    and (v_place.id is null or m.place_id=v_place.id or (m.place_id is null and v_place.project_id is not distinct from p_project_id))) then
  raise exception 'Choose a location' using errcode='22023';
 end if;
 return query select v_place.id,v_map.id,v_zone.id,case when v_zone.id is not null then public.site_map_zone_path(v_zone.id) end;
end $$;

-- Put a loose item somewhere. A material takes the rack of its new area (none
-- if the area has no rack), and off to another place without an area it is no
-- longer on a yard rack; a change of rack is recorded as a movement. A count
-- record's pin and area text belong to where it was, so they go.
create function public.logistics_place_item(p_actor uuid,p_material_id uuid,p_inventory_uid uuid,p_place_id uuid,p_map_id uuid,p_zone_id uuid,
 p_location text,p_reason text) returns void language plpgsql set search_path=public,pg_temp as $$
declare v_before public.materials; v_after public.materials;
begin
 if p_material_id is not null then
  select * into v_before from public.materials where id=p_material_id;
  update public.materials m set place_id=p_place_id,site_map_id=p_map_id,zone_id=p_zone_id,
   location_id=case when p_zone_id is not null then (select z.location_id from public.site_map_zones z where z.id=p_zone_id)
    when p_place_id is distinct from m.place_id then null else m.location_id end
  where m.id=p_material_id returning * into v_after;
  if v_after.location_id is not null and v_after.location_id is distinct from v_before.location_id then
   insert into public.material_movements(project_id,material_id,from_location_id,to_location_id,moved_by,reason)
   values(v_after.project_id,v_after.id,v_before.location_id,v_after.location_id,p_actor,p_reason);
  end if;
 end if;
 if p_inventory_uid is not null then
  update public.inventory_records i set place_id=p_place_id,site_map_id=p_map_id,zone_id=p_zone_id,pin_x=null,pin_y=null,
   location=case when p_zone_id is not null then p_location when p_place_id is distinct from i.place_id then null else i.location end
  where i.uid=p_inventory_uid;
 end if;
end $$;

create function public.logistics_stop(p_load public.loads,p_stop_id uuid,p_what text) returns public.load_stops
language plpgsql set search_path=public,pg_temp as $$
declare v public.load_stops;
begin
 if p_stop_id is null then raise exception 'Choose %',p_what using errcode='22023'; end if;
 select * into v from public.load_stops where id=p_stop_id and load_id=p_load.id and status<>'cancelled' for update;
 if not found then raise exception 'That stop isn''t on load %',p_load.load_number using errcode='22023'; end if;
 return v;
end $$;

create function public.logistics_stop_name(p_stop public.load_stops) returns text
language sql stable set search_path=public as $$
 select 'Stop '||coalesce(p_stop.seq::text,'(cancelled)')||' ('||p.name||')' from public.places p where p.id=p_stop.place_id
$$;

-- A material the office put on hold, or is returning to the vendor.
create function public.logistics_material_hold(p_material_id uuid) returns text
language sql stable set search_path=public as $$
 select case r.exception_resolution when 'hold' then 'on hold' else 'being returned to the vendor' end
 from public.materials m join public.receiving_records r on r.id=m.receiving_record_id
 where m.id=p_material_id and r.has_exception and r.exception_resolution in ('hold','return_to_vendor')
$$;

-- Held stock goes only to a hold area: an area linked to a hold-area rack.
create function public.logistics_hold_area(p_zone_id uuid) returns boolean
language sql stable set search_path=public as $$
 select coalesce((select l.is_hold_area from public.site_map_zones z join public.locations l on l.id=z.location_id where z.id=p_zone_id),false)
$$;

-- The first held material in a crate or the crates inside it, as a sentence.
create function public.logistics_unit_hold(p_unit_id uuid) returns text
language sql stable set search_path=public as $$
 with recursive down(id,depth) as (
  select p_unit_id,0
  union all select h.id,down.depth+1 from public.handling_units h join down on h.parent_id=down.id where down.depth<10)
 select c.tag||' is '||public.logistics_material_hold(c.material_id)
 from down join public.handling_unit_contents c on c.unit_id=down.id and c.removed_at is null
 where public.logistics_material_hold(c.material_id) is not null
 limit 1
$$;

-- The piece's place on another open load, if any.
create function public.logistics_open_line(p_unit_id uuid,p_material_id uuid,p_inventory_uid uuid,p_except_load uuid)
returns table(line_id uuid,load_id uuid,load_number text,line_status text)
language sql stable set search_path=public as $$
 select x.id,x.load_id,l.load_number,x.status from public.load_lines x join public.loads l on l.id=x.load_id
 where x.status in ('planned','on_board','missing') and x.load_id is distinct from p_except_load
  and (x.unit_id=p_unit_id or x.material_id=p_material_id or x.inventory_uid=p_inventory_uid)
 order by case x.status when 'on_board' then 0 when 'missing' then 1 else 2 end
 limit 1
$$;

-- What holds a loose item in place: the crate it is packed in, the outermost
-- crate around that, and the load that crate (or the item itself) is on.
create function public.logistics_item_state(p_material_id uuid,p_inventory_uid uuid)
returns table(unit_id uuid,unit_code text,top_code text,top_status text,load_number text,line_status text)
language sql stable set search_path=public as $$
 with c as (
  select c.unit_id,u.code from public.handling_unit_contents c join public.handling_units u on u.id=c.unit_id
  where c.removed_at is null and (c.material_id=p_material_id or c.inventory_uid=p_inventory_uid) limit 1)
 select c.unit_id,c.code,t.code,t.status,o.load_number,o.line_status
 from (select 1) one
 left join c on true
 left join lateral public.handling_unit_top(c.unit_id) t on true
 left join lateral public.logistics_open_line(t.id,case when c.unit_id is null then p_material_id end,
  case when c.unit_id is null then p_inventory_uid end,null) o on true
$$;

-- Refuses an item that isn't loose: packed in a crate, or on a truck or
-- missing (itself or in its crate). p_doing finishes "take it out of the
-- crate before …".
create function public.logistics_item_loose(p_tag text,p_material_id uuid,p_inventory_uid uuid,p_doing text) returns void
language plpgsql stable set search_path=public,pg_temp as $$
declare v record;
begin
 select * into v from public.logistics_item_state(p_material_id,p_inventory_uid);
 if v.line_status in ('on_board','missing') or v.top_status in ('on_load','missing') then
  raise exception '% is on load %; % it when it comes off',p_tag,coalesce(v.load_number,'?'),p_doing using errcode='22023';
 end if;
 if v.unit_id is not null then
  raise exception '% is packed in %; take it out of the crate before %',p_tag,v.unit_code,
   case p_doing when 'move' then 'moving it' when 'count' then 'counting it' when 'ship' then 'shipping it'
    when 'issue' then 'issuing it' when 'receive' then 'receiving it' else p_doing||'ing it' end using errcode='22023';
 end if;
end $$;

-- A crate (or the crate it sits in) that is on a truck, missing or written
-- off can't be packed, unpacked or moved.
create function public.logistics_unit_free(p_unit public.handling_units) returns void
language plpgsql set search_path=public,pg_temp as $$
declare v_top public.handling_units; v_number text;
begin
 v_top:=public.handling_unit_top(p_unit.id);
 if v_top.status not in ('on_load','missing','written_off') then return; end if;
 if v_top.status='written_off' then
  raise exception '% was written off; an administrator can undo that',v_top.code using errcode='22023';
 end if;
 select o.load_number into v_number from public.logistics_open_line(v_top.id,null,null,null) o;
 if v_top.status='missing' then
  raise exception '% is missing from load %; scan it or the office marks it found first',v_top.code,coalesce(v_number,'?') using errcode='22023';
 end if;
 if v_top.id<>p_unit.id then
  raise exception '% is inside %, which is on load %; unload it first',p_unit.code,v_top.code,coalesce(v_number,'?') using errcode='22023';
 end if;
 raise exception '% is on load %; unload it first',p_unit.code,coalesce(v_number,'?') using errcode='22023';
end $$;

-- What a scanned code is: a top-level crate, or a loose received material or
-- counted item. A crate inside another crate, or an item packed in a crate,
-- travels with that crate, so it is refused. When loading, the item must
-- still be in stock and, for crews, not on hold.
create function public.logistics_piece(p_project_id uuid,p_code text,p_loading boolean)
returns table(unit_id uuid,material_id uuid,inventory_uid uuid,tag text,unit_status text)
language plpgsql set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_code text:=public.logistics_code(p_code); v_unit public.handling_units; v_material public.materials;
 v_item public.inventory_records; v_mid uuid; v_uid uuid; v_holder text; v_held text;
begin
 if length(v_code) not between 1 and 120 then
  raise exception 'Tag numbers must be 1 to 120 characters' using errcode='22023';
 end if;
 if v_code ~ '^HU-' then
  select * into v_unit from public.handling_units h where h.code=v_code for update;
  if not found or v_unit.project_id<>p_project_id then
   raise exception 'Crate % isn''t in this project',v_code using errcode='42501';
  end if;
  if v_unit.parent_id is not null then
   select t.code into v_holder from public.handling_unit_top(v_unit.id) t;
   raise exception '% is inside %; a crate travels with the crate it''s in',v_unit.code,v_holder using errcode='22023';
  end if;
  if v_unit.status='written_off' then
   raise exception '% was written off; an administrator can undo that',v_unit.code using errcode='22023';
  end if;
  if p_loading and not public.is_office_user() then
   v_held:=public.logistics_unit_hold(v_unit.id);
   if v_held is not null then
    raise exception '% holds %; the office releases it before it can go on a load',v_unit.code,v_held using errcode='22023';
   end if;
  end if;
  return query select v_unit.id,null::uuid,null::uuid,v_unit.code,v_unit.status;
  return;
 end if;
 select t.material_id,t.inventory_uid into v_mid,v_uid from public.logistics_tag(p_project_id,v_code) t;
 if v_mid is not null then
  select * into v_material from public.materials m where m.id=v_mid for update;
  v_code:=(select q.code_value from public.qr_codes q where q.id=v_material.qr_code_id);
  if v_material.status='written_off' then
   raise exception '% was written off; an administrator can undo that',v_code using errcode='22023';
  end if;
  if p_loading and (v_material.status<>'in_yard' or v_material.current_quantity<=0) then
   raise exception '% has been issued or shipped; it can''t go on a load',v_code using errcode='22023';
  end if;
  if p_loading and not public.is_office_user() then
   v_held:=public.logistics_material_hold(v_material.id);
   if v_held is not null then
    raise exception '% is %; the office releases it before it can go on a load',v_code,v_held using errcode='22023';
   end if;
  end if;
  select h.code into v_holder from public.handling_unit_contents c join public.handling_units h on h.id=c.unit_id
   where c.material_id=v_material.id and c.removed_at is null;
 else
  select * into v_item from public.inventory_records i where i.uid=v_uid for update;
  if v_item.uid is null or v_item.count_status<>'counted' then
   raise exception '% isn''t a crate label or a received or counted item in this project',v_code using errcode='22023';
  end if;
  v_code:=btrim(v_item.qr_code);
  if v_item.written_off_at is not null then
   raise exception '% was written off; an administrator can undo that',v_code using errcode='22023';
  end if;
  select h.code into v_holder from public.handling_unit_contents c join public.handling_units h on h.id=c.unit_id
   where c.inventory_uid=v_item.uid and c.removed_at is null;
 end if;
 if v_holder is not null then
  raise exception '% is packed in %; load the crate instead',v_code,v_holder using errcode='22023';
 end if;
 return query select null::uuid,v_material.id,case when v_material.id is null then v_item.uid end,v_code,null::text;
end $$;

-- A piece already on another load. If it is only planned on a load that
-- hasn't left, p_move takes it off that plan; otherwise it is refused. When
-- planning (rather than loading the truck), a crew can take a piece only
-- from a load a crew started. Returns the load it came from, if any.
create function public.logistics_take_piece(p_load_id uuid,p_unit_id uuid,p_material_id uuid,p_inventory_uid uuid,p_tag text,p_move boolean,p_planning boolean)
returns text language plpgsql set search_path=public,pg_temp as $$
declare v record;
begin
 select x.id,x.status,l.load_number,l.status as load_status,l.started_in_field into v from public.load_lines x join public.loads l on l.id=x.load_id
  where x.status in ('planned','on_board','missing') and x.load_id<>p_load_id
   and (x.unit_id=p_unit_id or x.material_id=p_material_id or x.inventory_uid=p_inventory_uid)
  for update of x;
 if not found then return null; end if;
 if v.status='missing' then
  raise exception '% is missing from load %; scan it there or the office marks it found first',p_tag,v.load_number using errcode='22023';
 end if;
 if v.status='on_board' or v.load_status not in ('planning','loading') then
  raise exception '% is already on load %',p_tag,v.load_number using errcode='22023';
 end if;
 if not p_move then
  raise exception '% is planned on load %; move it to this load or take it off that plan first',p_tag,v.load_number using errcode='22023';
 end if;
 if p_planning and not v.started_in_field and not public.is_office_user() then
  raise exception 'The office planned % on load %; ask the office to move it',p_tag,v.load_number using errcode='42501';
 end if;
 update public.load_lines set status='removed',note=left(coalesce(note||' ','')||'Moved to another load.',500) where id=v.id;
 return v.load_number;
end $$;

create function public.logistics_load_summary(p_load_id uuid) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object('load_id',l.id,'load_number',l.load_number,'status',l.status,
  'planned',count(x.id) filter (where x.status='planned'),'on_board',count(x.id) filter (where x.status='on_board'),
  'delivered',count(x.id) filter (where x.status='delivered'),'missing',count(x.id) filter (where x.status='missing'))
 from public.loads l left join public.load_lines x on x.load_id=l.id where l.id=p_load_id group by l.id
$$;

-- ---------------------------------------------------------------------------
-- Crates.
-- pack: {unitCode, kind?, description?, isHighValue?, placeId?, siteMapId?,
-- zoneId?, add?: [tag], remove?: [tag], seal?, partial?, capturedAt?}
-- As in 021, except: a crate on a truck, missing or written off (or inside
-- one) can't be packed; a planned crate can't go inside another crate; an
-- item on a load, on hold or being returned can't be packed; a delivered
-- crate put inside another takes a crate's ordinary status; a new place
-- without an area clears the old area; what comes out is where the
-- outermost crate is. With partial, tags that can't be added or removed come
-- back in refused instead of refusing the whole step, and the crate isn't
-- sealed.
-- ---------------------------------------------------------------------------
create function public.logistics_pack(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_code text; v_qr public.qr_codes; v_unit public.handling_units; v_top public.handling_units; v_child public.handling_units;
 v_material public.materials; v_item public.inventory_records; v_existing public.handling_unit_contents; v_mid uuid; v_uid uuid;
 v_before jsonb; v_created boolean:=false; v_tag text; v_canon text; v_kind text; v_added text[]:='{}'; v_removed text[]:='{}';
 v_load text; v_held text; v_place uuid; v_map uuid; v_zone uuid; v_pos record;
 v_seal boolean; v_partial boolean; v_refused jsonb:='[]'; v_msg text; v_state text; v_items integer; v_units integer;
 v_office boolean:=public.is_office_user(); result jsonb;
begin
 v_code:=upper(btrim(coalesce(p_payload->>'unitCode','')));
 if v_code !~ '^HU-[A-Z0-9]{4,20}$' then
  raise exception 'Scan a crate label (HU-…)' using errcode='22023';
 end if;
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
 v_partial:=public.logistics_flag(p_payload,'partial','Partial');
 v_place:=public.logistics_id(p_payload,'placeId','Place');
 v_map:=public.logistics_id(p_payload,'siteMapId','Site plan');
 v_zone:=public.logistics_id(p_payload,'zoneId','Area');
 perform public.logistics_captured(p_payload);

 -- The label: unused, or already this project's crate label.
 insert into public.qr_codes(code_value,entity_type,project_id) values(v_code,'handling_unit',p_project_id) on conflict do nothing;
 select * into v_qr from public.qr_codes q where lower(q.code_value)=lower(v_code) and q.entity_type='handling_unit' for update;
 if v_qr.project_id is distinct from p_project_id then
  raise exception 'This label belongs to another project' using errcode='42501';
 end if;
 select * into v_unit from public.handling_units where code=v_code for update;
 v_created:=not found;
 if v_created then
  insert into public.handling_units(project_id,code,kind,description,is_high_value,created_by)
  values(p_project_id,v_code,v_kind,nullif(btrim(p_payload->>'description'),''),coalesce((p_payload->>'isHighValue')::boolean,false),p_actor)
  returning * into v_unit;
  update public.qr_codes set entity_id=v_unit.id where id=v_qr.id;
 else
  perform public.logistics_unit_free(v_unit);
  if v_unit.status not in ('open','sealed','unpacked','delivered') then
   raise exception 'This crate is %; it can''t be repacked',replace(v_unit.status,'_',' ') using errcode='22023';
  end if;
  v_before:=to_jsonb(v_unit);
  update public.handling_units h set
   kind=case when p_payload ? 'kind' then v_kind else h.kind end,
   description=case when p_payload ? 'description' then nullif(btrim(p_payload->>'description'),'') else h.description end,
   is_high_value=case when p_payload ? 'isHighValue' then (p_payload->>'isHighValue')::boolean else h.is_high_value end,
   status='open',sealed_by=null,sealed_at=null
  where h.id=v_unit.id returning * into v_unit;
 end if;

 -- Where the crate is. A new place without an area clears the old area.
 if (v_place is not null and v_place is distinct from v_unit.place_id) or v_map is not null or v_zone is not null then
  select * into v_pos from public.logistics_position(p_project_id,coalesce(v_place,v_unit.place_id),v_map,v_zone,false);
  update public.handling_units set place_id=v_pos.place_id,site_map_id=v_pos.site_map_id,zone_id=v_pos.zone_id,location=v_pos.location
   where id=v_unit.id returning * into v_unit;
 end if;
 v_top:=public.handling_unit_top(v_unit.id);

 -- Take things out first, so a tag can move between lists in one pack.
 for v_tag in select btrim(e) from jsonb_array_elements_text(coalesce(p_payload->'remove','[]')) e loop
  begin
   if upper(v_tag) ~ '^HU-' then
    update public.handling_units set parent_id=null,place_id=v_top.place_id,site_map_id=v_top.site_map_id,zone_id=v_top.zone_id,location=v_top.location
     where code=upper(v_tag) and parent_id=v_unit.id;
    if not found then raise exception '% isn''t in this crate',upper(v_tag) using errcode='22023'; end if;
    v_removed:=v_removed||upper(v_tag);
   else
    update public.handling_unit_contents set removed_at=now(),removed_by=p_actor
     where unit_id=v_unit.id and removed_at is null and lower(tag)=lower(v_tag) returning * into v_existing;
    if not found then raise exception '% isn''t in this crate',v_tag using errcode='22023'; end if;
    perform public.logistics_place_item(p_actor,v_existing.material_id,v_existing.inventory_uid,v_top.place_id,v_top.site_map_id,v_top.zone_id,
     v_top.location,'Taken out of '||v_unit.code);
    v_removed:=v_removed||v_existing.tag;
   end if;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',v_tag,'list','remove','message',v_msg,'sqlstate',v_state);
  end;
 end loop;

 for v_tag in select btrim(e) from jsonb_array_elements_text(coalesce(p_payload->'add','[]')) e loop
  begin
   if length(v_tag) not between 1 and 120 then
    raise exception 'Tag numbers must be 1 to 120 characters' using errcode='22023';
   end if;
   if upper(v_tag) ~ '^HU-' then
    select * into v_child from public.handling_units where code=upper(v_tag) for update;
    if not found or v_child.project_id<>p_project_id then
     raise exception 'Crate % isn''t in this project',upper(v_tag) using errcode='42501';
    end if;
    if v_child.id=v_unit.id then raise exception 'A crate can''t go inside itself' using errcode='22023'; end if;
    if v_child.parent_id is distinct from v_unit.id then
     if v_child.parent_id is not null then
      raise exception '% is already inside %; take it out first',v_child.code,(select h.code from public.handling_units h where h.id=v_child.parent_id) using errcode='22023';
     end if;
     if v_child.status not in ('open','sealed','delivered') then
      raise exception '% is %; it can''t go inside another crate',v_child.code,replace(v_child.status,'_',' ') using errcode='22023';
     end if;
     select o.load_number into v_load from public.logistics_open_line(v_child.id,null,null,null) o;
     if v_load is not null then
      raise exception '% is planned on load %; take it off the load first',v_child.code,v_load using errcode='22023';
     end if;
     if not v_office then
      v_held:=public.logistics_unit_hold(v_child.id);
      if v_held is not null then
       raise exception '% holds %; the office releases it before it can be packed',v_child.code,v_held using errcode='22023';
      end if;
     end if;
     update public.handling_units set parent_id=v_unit.id,
      status=case when status='delivered' then case when sealed_at is not null then 'sealed' else 'open' end else status end
     where id=v_child.id;
     v_added:=v_added||v_child.code;
    end if;
   else
    -- A received material first; otherwise a counted item not yet received.
    select t.material_id,t.inventory_uid into v_mid,v_uid from public.logistics_tag(p_project_id,v_tag) t;
    v_material:=null; v_item:=null; v_existing:=null;
    if v_mid is not null then
     select * into v_material from public.materials where id=v_mid for update;
     v_canon:=(select q.code_value from public.qr_codes q where q.id=v_material.qr_code_id);
     if v_material.status='written_off' then
      raise exception '% was written off; an administrator can undo that',v_canon using errcode='22023';
     end if;
     if v_material.status<>'in_yard' or v_material.current_quantity<=0 then
      raise exception '% has been issued or shipped; it can''t be packed',v_canon using errcode='22023';
     end if;
     if not v_office then
      v_held:=public.logistics_material_hold(v_material.id);
      if v_held is not null then
       raise exception '% is %; the office releases it before it can be packed',v_canon,v_held using errcode='22023';
      end if;
     end if;
     select * into v_existing from public.handling_unit_contents c where c.material_id=v_material.id and c.removed_at is null;
    else
     select * into v_item from public.inventory_records where uid=v_uid for update;
     if v_item.uid is null or v_item.count_status<>'counted' then
      raise exception '% isn''t a received or counted item in this project',v_tag using errcode='22023';
     end if;
     v_canon:=btrim(v_item.qr_code);
     if v_item.written_off_at is not null then
      raise exception '% was written off; an administrator can undo that',v_canon using errcode='22023';
     end if;
     select * into v_existing from public.handling_unit_contents c where c.inventory_uid=v_item.uid and c.removed_at is null;
    end if;
    if v_existing.id is not null and v_existing.unit_id<>v_unit.id then
     raise exception '% is already in crate %; take it out of that crate first',v_canon,
      (select h.code from public.handling_units h where h.id=v_existing.unit_id) using errcode='22023';
    end if;
    if v_existing.id is null then
     select o.load_number into v_load from public.logistics_open_line(null,v_material.id,case when v_material.id is null then v_item.uid end,null) o;
     if v_load is not null then
      raise exception '% is on load %; take it off the load first',v_canon,v_load using errcode='22023';
     end if;
     insert into public.handling_unit_contents(project_id,unit_id,material_id,inventory_uid,tag,quantity,uom,packed_by)
     values(p_project_id,v_unit.id,v_material.id,case when v_material.id is null then v_item.uid end,v_canon,
      case when v_material.id is null then v_item.quantity else v_material.current_quantity end,
      case when v_material.id is null then v_item.uom else 'EA' end,p_actor);
     v_added:=v_added||v_canon;
    end if;
   end if;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',v_tag,'list','add','message',v_msg,'sqlstate',v_state);
  end;
 end loop;

 select count(*) into v_items from public.handling_unit_contents c where c.unit_id=v_unit.id and c.removed_at is null;
 select count(*) into v_units from public.handling_units h where h.parent_id=v_unit.id;
 if v_seal and jsonb_array_length(v_refused)>0 then v_seal:=false; end if;
 if v_seal then
  if v_items+v_units=0 then
   raise exception 'An empty crate can''t be sealed' using errcode='22023';
  end if;
  if v_unit.parent_id is null and v_unit.zone_id is null then
   perform public.logistics_position(p_project_id,v_unit.place_id,null,null,true);
  end if;
  update public.handling_units set status='sealed',sealed_by=p_actor,sealed_at=now() where id=v_unit.id;
 end if;
 select * into v_unit from public.handling_units where id=v_unit.id;
 result:=jsonb_build_object('id',v_unit.id,'code',v_unit.code,'status',v_unit.status,'created',v_created,'item_count',v_items,'unit_count',v_units,
  'refused',v_refused);
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'handling_unit_packed','handling_unit',v_unit.id,jsonb_build_object('operation_id',p_operation_id,'created',v_created,
   'added',to_jsonb(v_added),'removed',to_jsonb(v_removed),'refused',v_refused,'before',v_before,'after',to_jsonb(v_unit)),p_project_id);
 return result;
end $$;

-- unpack: {unitCode} As in 021, except a crate on a truck, missing or
-- written off (or inside one), or planned on a load, can't be unpacked, and
-- a delivered crate can. Everything comes out where the outermost crate is.
create function public.logistics_unpack(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_code text; v_unit public.handling_units; v_top public.handling_units; v_content public.handling_unit_contents;
 v_before jsonb; v_load text; v_items integer:=0; v_units integer; result jsonb;
begin
 v_code:=upper(btrim(coalesce(p_payload->>'unitCode','')));
 if v_code !~ '^HU-[A-Z0-9]{4,20}$' then
  raise exception 'Scan a crate label (HU-…)' using errcode='22023';
 end if;
 select * into v_unit from public.handling_units where code=v_code for update;
 if not found or v_unit.project_id<>p_project_id then
  raise exception 'Crate % isn''t in this project',v_code using errcode='42501';
 end if;
 perform public.logistics_unit_free(v_unit);
 if v_unit.status not in ('open','sealed','delivered') then
  raise exception 'This crate is %; it can''t be unpacked',replace(v_unit.status,'_',' ') using errcode='22023';
 end if;
 select o.load_number into v_load from public.logistics_open_line(v_unit.id,null,null,null) o;
 if v_load is not null then
  raise exception '% is planned on load %; take it off the load first',v_unit.code,v_load using errcode='22023';
 end if;
 v_before:=to_jsonb(v_unit);
 v_top:=public.handling_unit_top(v_unit.id);
 for v_content in select * from public.handling_unit_contents c where c.unit_id=v_unit.id and c.removed_at is null for update loop
  perform public.logistics_place_item(p_actor,v_content.material_id,v_content.inventory_uid,v_top.place_id,v_top.site_map_id,v_top.zone_id,
   v_top.location,'Unpacked from '||v_unit.code);
  update public.handling_unit_contents set removed_at=now(),removed_by=p_actor where id=v_content.id;
  v_items:=v_items+1;
 end loop;
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
 return result;
end $$;

-- move: {unitCode, placeId?, siteMapId?, zoneId?, capturedAt?} A crate moved
-- without being opened keeps its seal. Only an outermost crate that isn't on
-- a truck moves, and a sealed one needs an area where its place has a plan.
-- A crate holding stock on hold goes, for crews, only to a hold area.
create function public.logistics_move(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_code text; v_unit public.handling_units; v_before jsonb; v_place uuid; v_map uuid; v_zone uuid; v_pos record; v_holder text; v_held text;
begin
 v_code:=upper(btrim(coalesce(p_payload->>'unitCode','')));
 if v_code !~ '^HU-[A-Z0-9]{4,20}$' then
  raise exception 'Scan a crate label (HU-…)' using errcode='22023';
 end if;
 v_place:=public.logistics_id(p_payload,'placeId','Place');
 v_map:=public.logistics_id(p_payload,'siteMapId','Site plan');
 v_zone:=public.logistics_id(p_payload,'zoneId','Area');
 perform public.logistics_captured(p_payload);
 if v_place is null and v_map is null and v_zone is null then
  raise exception 'Choose where the crate is now' using errcode='22023';
 end if;
 select * into v_unit from public.handling_units where code=v_code for update;
 if not found or v_unit.project_id<>p_project_id then
  raise exception 'Crate % isn''t in this project',v_code using errcode='42501';
 end if;
 perform public.logistics_unit_free(v_unit);
 if v_unit.parent_id is not null then
  select t.code into v_holder from public.handling_unit_top(v_unit.id) t;
  raise exception '% is inside %; move that crate instead',v_unit.code,v_holder using errcode='22023';
 end if;
 if v_unit.status not in ('open','sealed','delivered','unpacked') then
  raise exception 'This crate is %; it can''t be moved',replace(v_unit.status,'_',' ') using errcode='22023';
 end if;
 v_before:=to_jsonb(v_unit);
 select * into v_pos from public.logistics_position(p_project_id,coalesce(v_place,v_unit.place_id),v_map,v_zone,v_unit.status='sealed');
 if not public.is_office_user() then
  v_held:=public.logistics_unit_hold(v_unit.id);
  if v_held is not null and not public.logistics_hold_area(v_pos.zone_id) then
   raise exception '% holds %; until the office releases it, the crate can only go to a hold area',v_unit.code,v_held using errcode='22023';
  end if;
 end if;
 update public.handling_units set place_id=v_pos.place_id,site_map_id=v_pos.site_map_id,zone_id=v_pos.zone_id,location=v_pos.location
  where id=v_unit.id returning * into v_unit;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'handling_unit_moved','handling_unit',v_unit.id,jsonb_build_object('operation_id',p_operation_id,
   'code',v_unit.code,'before',v_before,'after',to_jsonb(v_unit)),p_project_id);
 return jsonb_build_object('id',v_unit.id,'code',v_unit.code,'status',v_unit.status,'place_id',v_unit.place_id,'zone_id',v_unit.zone_id,'location',v_unit.location);
end $$;

-- relocate: {tag, placeId?, siteMapId?, zoneId?, reason?, capturedAt?}
-- Correct where a loose item is without counting it again (a received item
-- can't be recounted), wherever it was recorded. A material takes the rack of
-- its new area; one on hold goes, for crews, only to a hold area.
create function public.logistics_relocate(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_tag text; v_mid uuid; v_uid uuid; v_material public.materials; v_item public.inventory_records; v_before jsonb; v_after jsonb;
 v_place uuid; v_map uuid; v_zone uuid; v_pos record; v_reason text; v_hold text;
begin
 v_tag:=public.logistics_text(p_payload,'tag',120,'Tag');
 if v_tag is null then raise exception 'Tag number is required' using errcode='22023'; end if;
 if v_tag ~* '^HU-' then raise exception 'That''s a crate label; move crates with Move' using errcode='22023'; end if;
 v_place:=public.logistics_id(p_payload,'placeId','Place');
 v_map:=public.logistics_id(p_payload,'siteMapId','Site plan');
 v_zone:=public.logistics_id(p_payload,'zoneId','Area');
 v_reason:=public.logistics_text(p_payload,'reason',500,'Reason');
 perform public.logistics_captured(p_payload);
 if v_place is null and v_map is null and v_zone is null then
  raise exception 'Choose where the item is now' using errcode='22023';
 end if;
 select t.material_id,t.inventory_uid into v_mid,v_uid from public.logistics_tag(p_project_id,v_tag) t;
 if v_mid is not null then
  select * into v_material from public.materials where id=v_mid for update;
  v_tag:=(select q.code_value from public.qr_codes q where q.id=v_material.qr_code_id);
  if v_material.status='written_off' then
   raise exception '% was written off; an administrator can undo that',v_tag using errcode='22023';
  end if;
  if v_material.status<>'in_yard' or v_material.current_quantity<=0 then
   raise exception '% has been issued or shipped',v_tag using errcode='22023';
  end if;
  perform public.logistics_item_loose(v_tag,v_material.id,null,'move');
  v_before:=to_jsonb(v_material);
  select * into v_pos from public.logistics_position(p_project_id,coalesce(v_place,v_material.place_id),v_map,v_zone,false);
  v_hold:=public.logistics_material_hold(v_material.id);
  if v_hold is not null and not public.is_office_user() and not public.logistics_hold_area(v_pos.zone_id) then
   raise exception '% is %; until the office releases it, it can only go to a hold area',v_tag,v_hold using errcode='22023';
  end if;
  perform public.logistics_place_item(p_actor,v_material.id,null,v_pos.place_id,v_pos.site_map_id,v_pos.zone_id,v_pos.location,
   coalesce(v_reason,'Moved to '||coalesce(v_pos.location,'a new place')));
  select * into v_material from public.materials where id=v_material.id;
  v_after:=to_jsonb(v_material);
 elsif v_uid is not null then
  select * into v_item from public.inventory_records where uid=v_uid for update;
  v_tag:=btrim(v_item.qr_code);
  if v_item.written_off_at is not null then
   raise exception '% was written off; an administrator can undo that',v_tag using errcode='22023';
  end if;
  if v_item.count_status<>'counted' then
   raise exception '% hasn''t been counted yet; count it where it is',v_tag using errcode='22023';
  end if;
  perform public.logistics_item_loose(v_tag,null,v_item.uid,'move');
  v_before:=to_jsonb(v_item);
  select * into v_pos from public.logistics_position(p_project_id,coalesce(v_place,v_item.place_id),v_map,v_zone,false);
  perform public.logistics_place_item(p_actor,null,v_item.uid,v_pos.place_id,v_pos.site_map_id,v_pos.zone_id,v_pos.location,null);
  select * into v_item from public.inventory_records where uid=v_item.uid;
  v_after:=to_jsonb(v_item);
 else
  raise exception '% isn''t a received or counted item in this project',v_tag using errcode='22023';
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'item_relocated',case when v_mid is not null then 'material' else 'inventory_record' end,coalesce(v_mid,v_uid),
   jsonb_build_object('operation_id',p_operation_id,'tag',v_tag,'reason',v_reason,'before',v_before,'after',v_after),p_project_id);
 return jsonb_build_object('tag',v_tag,'material_id',v_mid,'inventory_uid',case when v_mid is null then v_uid end,
  'place_id',v_pos.place_id,'zone_id',v_pos.zone_id,'location',v_pos.location);
end $$;

-- ---------------------------------------------------------------------------
-- load_save: create a load or change its details, driver, companies and
-- stops. {loadId (made by the caller, so offline steps can name it),
-- originPlaceId?, plannedDate?, truckType?, truckNumber?, trailerNumber?,
-- bolNumber?, notes?, driverName?, driverPhone?,
-- companies?: [{name, role?, contactName?, phone?}] (up to 3; replaces the list),
-- stops?: [{id, placeId, kind?, plannedDate?}] (replaces the list),
-- capturedAt?} Only the keys sent are changed. A load a crew creates is
-- started in the field. The office plans stops, except on a load started in
-- the field; once the truck has left, only office staff change stops, and
-- only ones it hasn't reached (with none left to reach, the load is
-- delivered). A change made before the load's latest saved change is refused.
-- ---------------------------------------------------------------------------
create function public.logistics_load_save(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_id uuid; v_load public.loads; v_before jsonb; v_created boolean:=false; v_number integer; v_office boolean:=public.is_office_user();
 v_origin uuid; v_planned date; v_truck_type text; v_truck_number text; v_trailer text; v_bol text; v_notes text; v_driver text; v_phone text;
 v_captured timestamptz; v_list jsonb; v_elem jsonb; v_place_id uuid; v_stop public.load_stops; v_stop_id uuid; v_kind text; v_name text;
 v_stop_date date; v_ids uuid[]:='{}'; v_companies_before jsonb; i integer;
begin
 v_id:=public.logistics_id(p_payload,'loadId','Load');
 if v_id is null then raise exception 'A load ID is required' using errcode='22023'; end if;
 -- Check every field before changing anything.
 if nullif(p_payload->>'originPlaceId','') is not null then
  v_origin:=(public.logistics_place(p_project_id,public.logistics_id(p_payload,'originPlaceId','Origin'))).id;
 end if;
 v_planned:=public.logistics_date(p_payload,'plannedDate','Planned date');
 v_truck_type:=public.logistics_text(p_payload,'truckType',60,'Truck type');
 v_truck_number:=public.logistics_text(p_payload,'truckNumber',40,'Truck number');
 v_trailer:=public.logistics_text(p_payload,'trailerNumber',40,'Trailer number');
 v_bol:=public.logistics_text(p_payload,'bolNumber',60,'Bill of lading number');
 v_notes:=public.logistics_text(p_payload,'notes',2000,'Notes');
 v_driver:=public.logistics_text(p_payload,'driverName',120,'Driver name');
 v_phone:=public.logistics_text(p_payload,'driverPhone',40,'Driver phone');
 v_captured:=public.logistics_captured(p_payload);

 select * into v_load from public.loads where id=v_id for update;
 if not found then
  -- The project stays active while the load is added (completing it waits),
  -- and numbers take turns per project.
  perform 1 from public.projects p where p.id=p_project_id and p.status='active' for share;
  if not found then raise exception 'This project isn''t active; loads can''t be added' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('loads:'||p_project_id::text,0));
  select coalesce(max(substring(l.load_number from 3)::integer),0)+1 into v_number from public.loads l where l.project_id=p_project_id;
  insert into public.loads(id,project_id,load_number,origin_place_id,planned_date,truck_type,truck_number,trailer_number,bol_number,notes,
   driver_name,driver_phone,started_in_field,created_by,edited_at)
  values(v_id,p_project_id,'L-'||lpad(v_number::text,4,'0'),v_origin,v_planned,v_truck_type,v_truck_number,v_trailer,v_bol,v_notes,
   v_driver,v_phone,not v_office,p_actor,coalesce(v_captured,now()))
  returning * into v_load;
  v_created:=true;
 else
  if v_load.project_id<>p_project_id then raise exception 'That load isn''t in this project' using errcode='42501'; end if;
  if v_load.status in ('closed','cancelled') then
   raise exception 'Load % is %; it can''t change',v_load.load_number,v_load.status using errcode='22023';
  end if;
  if v_captured<v_load.edited_at-public.logistics_clock_slack() then
   raise exception 'Load % was changed after this edit was made; check it and save again',v_load.load_number using errcode='22023';
  end if;
  v_before:=to_jsonb(v_load);
  update public.loads l set
   origin_place_id=case when p_payload ? 'originPlaceId' then v_origin else l.origin_place_id end,
   planned_date=case when p_payload ? 'plannedDate' then v_planned else l.planned_date end,
   truck_type=case when p_payload ? 'truckType' then v_truck_type else l.truck_type end,
   truck_number=case when p_payload ? 'truckNumber' then v_truck_number else l.truck_number end,
   trailer_number=case when p_payload ? 'trailerNumber' then v_trailer else l.trailer_number end,
   bol_number=case when p_payload ? 'bolNumber' then v_bol else l.bol_number end,
   notes=case when p_payload ? 'notes' then v_notes else l.notes end,
   driver_name=case when p_payload ? 'driverName' then v_driver else l.driver_name end,
   driver_phone=case when p_payload ? 'driverPhone' then v_phone else l.driver_phone end,
   edited_at=coalesce(v_captured,now())
  where l.id=v_load.id returning * into v_load;
 end if;

 if p_payload ? 'companies' then
  v_list:=public.logistics_list(p_payload,'companies','companies');
  if jsonb_array_length(v_list)>3 then raise exception 'Add up to 3 companies' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.position),'[]') into v_companies_before from public.load_companies c where c.load_id=v_load.id;
  delete from public.load_companies where load_id=v_load.id;
  for i in 0..jsonb_array_length(v_list)-1 loop
   v_elem:=v_list->i;
   if jsonb_typeof(v_elem)<>'object' then raise exception 'Each company needs a name' using errcode='22023'; end if;
   v_name:=public.logistics_text(v_elem,'name',120,'Company name');
   if v_name is null then raise exception 'Each company needs a name' using errcode='22023'; end if;
   v_kind:=coalesce(nullif(v_elem->>'role',''),'carrier');
   if v_kind not in ('broker','carrier','dispatcher','other') then
    raise exception 'A company''s role is broker, carrier, dispatcher or other' using errcode='22023';
   end if;
   insert into public.load_companies(project_id,load_id,position,name,role,contact_name,phone)
   values(p_project_id,v_load.id,i+1,v_name,v_kind,public.logistics_text(v_elem,'contactName',120,'Contact name'),public.logistics_text(v_elem,'phone',40,'Company phone'));
  end loop;
 end if;

 if p_payload ? 'stops' then
  if v_load.status in ('planning','loading') then
   if not v_office and not v_load.started_in_field then
    raise exception 'The office plans the stops of load %',v_load.load_number using errcode='42501';
   end if;
  elsif v_load.status='in_transit' then
   if not v_office then
    raise exception 'Load % has left; only office staff can change its stops',v_load.load_number using errcode='42501';
   end if;
  else
   raise exception 'Load % has been delivered; its stops can''t change',v_load.load_number using errcode='22023';
  end if;
  v_list:=public.logistics_list(p_payload,'stops','stops');
  if jsonb_array_length(v_list)>20 then raise exception 'A load can have at most 20 stops' using errcode='22023'; end if;
  for i in 0..jsonb_array_length(v_list)-1 loop
   v_elem:=v_list->i;
   if jsonb_typeof(v_elem)<>'object' then raise exception 'Each stop needs an ID and a place' using errcode='22023'; end if;
   v_stop_id:=public.logistics_id(v_elem,'id','Stop ID');
   if v_stop_id is null then raise exception 'Each stop needs an ID' using errcode='22023'; end if;
   if v_stop_id=any(v_ids) then raise exception 'Two stops share one ID' using errcode='22023'; end if;
   v_ids:=v_ids||v_stop_id;
   v_place_id:=public.logistics_id(v_elem,'placeId','Place');
   v_kind:=coalesce(nullif(v_elem->>'kind',''),'dropoff');
   if v_kind not in ('dropoff','pickup','both') then
    raise exception 'A stop is a drop-off, a pick-up or both' using errcode='22023';
   end if;
   v_stop_date:=public.logistics_date(v_elem,'plannedDate','Stop date');
   select * into v_stop from public.load_stops where id=v_stop_id for update;
   if found then
    if v_stop.load_id<>v_load.id then raise exception 'That stop belongs to another load' using errcode='42501'; end if;
    if v_stop.status in ('arrived','done') and (v_stop.place_id is distinct from v_place_id or v_stop.kind<>v_kind) then
     raise exception '% has been reached; its place and kind can''t change',public.logistics_stop_name(v_stop) using errcode='22023';
    end if;
    if v_stop.place_id is distinct from v_place_id then perform public.logistics_place(p_project_id,v_place_id); end if;
    update public.load_stops set seq=i+1,place_id=v_place_id,kind=v_kind,planned_date=v_stop_date,
     status=case when status='cancelled' then 'pending' else status end where id=v_stop_id;
   else
    perform public.logistics_place(p_project_id,v_place_id);
    insert into public.load_stops(id,project_id,load_id,seq,place_id,kind,planned_date)
    values(v_stop_id,p_project_id,v_load.id,i+1,v_place_id,v_kind,v_stop_date);
   end if;
  end loop;
  -- Stops left out are cancelled, unless the truck has been there or pieces
  -- still need them.
  for v_stop in select * from public.load_stops s where s.load_id=v_load.id and s.status<>'cancelled' and not (s.id=any(v_ids)) for update loop
   if v_stop.status in ('arrived','done') then
    raise exception '% has been reached; it stays on the load',public.logistics_stop_name(v_stop) using errcode='22023';
   end if;
   if exists(select 1 from public.load_lines x where x.status in ('planned','on_board','missing') and v_stop.id in (x.pickup_stop_id,x.dropoff_stop_id)) then
    raise exception 'The stop at % still has pieces planned for it; move them to another stop first',
     (select p.name from public.places p where p.id=v_stop.place_id) using errcode='22023';
   end if;
   update public.load_stops set status='cancelled',seq=null where id=v_stop.id;
  end loop;
  if exists(select 1 from public.load_lines x join public.load_stops d on d.id=x.dropoff_stop_id
     left join public.load_stops p on p.id=x.pickup_stop_id
    where x.load_id=v_load.id and x.status in ('planned','on_board') and (d.kind='pickup' or p.kind='dropoff' or p.seq>=d.seq)) then
   raise exception 'Every planned piece needs a drop-off stop after its pick-up stop' using errcode='22023';
  end if;
  if v_load.status='in_transit' and not exists(select 1 from public.load_stops s where s.load_id=v_load.id and s.status in ('pending','arrived')) then
   update public.loads set status='delivered',delivered_at=now() where id=v_load.id returning * into v_load;
  end if;
 end if;

 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_saved','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'created',v_created,'before',v_before,'after',to_jsonb(v_load),
   'companies_before',v_companies_before,'stops_changed',p_payload ? 'stops'),p_project_id);
 return jsonb_build_object('id',v_load.id,'load_number',v_load.load_number,'status',v_load.status,'created',v_created,
  'started_in_field',v_load.started_in_field);
end $$;

-- load_plan: plan pieces before the truck leaves. {loadId,
-- add?: [{code, dropoffStopId, pickupStopId?, move?}], remove?: [code],
-- partial?} Office staff plan loads; a crew can plan one it started. move
-- takes a piece off another load's plan, if that load hasn't left.
create function public.logistics_load_plan(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_piece record; v_line public.load_lines; v_drop public.load_stops; v_pick public.load_stops;
 v_list jsonb; v_elem jsonb; v_code text; v_from text; v_added text[]:='{}'; v_removed text[]:='{}'; v_moved jsonb:='[]';
 v_partial boolean; v_refused jsonb:='[]'; v_msg text; v_state text; i integer;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status not in ('planning','loading') then
  raise exception 'Load % has left; its plan can''t change',v_load.load_number using errcode='22023';
 end if;
 if not public.is_office_user() and not v_load.started_in_field then
  raise exception 'The office plans what goes on load %',v_load.load_number using errcode='42501';
 end if;
 v_partial:=public.logistics_flag(p_payload,'partial','Partial');
 for v_code in select public.logistics_code(e) from jsonb_array_elements_text(public.logistics_list(p_payload,'remove','pieces to take off the plan')) e loop
  begin
   select * into v_line from public.load_lines x where x.load_id=v_load.id and lower(x.tag)=lower(v_code) and x.status in ('planned','on_board') for update;
   if not found then raise exception '% isn''t planned on load %',v_code,v_load.load_number using errcode='22023'; end if;
   if v_line.status='on_board' then raise exception '% is on the truck; take it off the truck first',v_code using errcode='22023'; end if;
   update public.load_lines set status='removed' where id=v_line.id;
   v_removed:=v_removed||v_line.tag;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',v_code,'list','remove','message',v_msg,'sqlstate',v_state);
  end;
 end loop;
 v_list:=public.logistics_list(p_payload,'add','pieces to plan');
 for i in 0..jsonb_array_length(v_list)-1 loop
  v_elem:=v_list->i; v_from:=null;
  begin
   if jsonb_typeof(v_elem)<>'object' then
    raise exception 'Each piece to plan needs a code and a drop-off stop' using errcode='22023';
   end if;
   select * into v_piece from public.logistics_piece(p_project_id,v_elem->>'code',true);
   v_drop:=public.logistics_stop(v_load,public.logistics_id(v_elem,'dropoffStopId','Drop-off stop'),'where '||v_piece.tag||' comes off');
   if v_drop.kind='pickup' then
    raise exception '% is a pick-up stop; choose where % comes off',public.logistics_stop_name(v_drop),v_piece.tag using errcode='22023';
   end if;
   v_pick:=null;
   if nullif(v_elem->>'pickupStopId','') is not null then
    v_pick:=public.logistics_stop(v_load,public.logistics_id(v_elem,'pickupStopId','Pick-up stop'),'where '||v_piece.tag||' is picked up');
    if v_pick.kind='dropoff' then
     raise exception '% is a drop-off stop; nothing is picked up there',public.logistics_stop_name(v_pick) using errcode='22023';
    end if;
    if v_pick.seq>=v_drop.seq then
     raise exception '% has to be picked up before it comes off',v_piece.tag using errcode='22023';
    end if;
   end if;
   select * into v_line from public.load_lines x where x.load_id=v_load.id and x.status in ('planned','on_board')
    and (x.unit_id=v_piece.unit_id or x.material_id=v_piece.material_id or x.inventory_uid=v_piece.inventory_uid) for update;
   if found then
    update public.load_lines set dropoff_stop_id=v_drop.id,pickup_stop_id=v_pick.id where id=v_line.id;
   else
    v_from:=public.logistics_take_piece(v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,
     public.logistics_flag(v_elem,'move','Move'),true);
    if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
     raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
    end if;
    insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,pickup_stop_id,dropoff_stop_id,planned_by)
    values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_pick.id,v_drop.id,p_actor);
   end if;
   if v_from is not null then v_moved:=v_moved||jsonb_build_object('code',v_piece.tag,'from',v_from); end if;
   v_added:=v_added||v_piece.tag;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',coalesce(v_elem->>'code',v_list->>i),'list','add','message',v_msg,'sqlstate',v_state);
  end;
 end loop;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_planned','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'added',to_jsonb(v_added),'removed',to_jsonb(v_removed),
   'moved_from',v_moved,'refused',v_refused),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('refused',v_refused,'moved',v_moved);
end $$;

-- load_on: scan pieces onto the truck. {loadId, stopId? (a pick-up stop once
-- the truck has left; none means at the start), pieces: [code or {code,
-- dropoffStopId?, move?}], undo?: [code], partial?, capturedAt?} A piece that
-- wasn't planned needs a drop-off stop. A scan made before the truck left
-- counts as loaded at the start even if it uploads later, so a second
-- phone's scans aren't lost, unless the piece has travelled on another load
-- since; one whose drop-off is already done is missing. A crew may take a
-- piece another load had planned (move), since it is on this truck.
create function public.logistics_load_on(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_at public.load_stops; v_piece record; v_line public.load_lines; v_has boolean; v_drop public.load_stops;
 v_list jsonb; v_elem jsonb; v_code text; v_from text; v_on text[]:='{}'; v_off text[]:='{}'; v_moved jsonb:='[]';
 v_captured timestamptz; v_on_at timestamptz; v_late boolean:=false; v_status text;
 v_partial boolean; v_refused jsonb:='[]'; v_msg text; v_state text; i integer;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 v_captured:=public.logistics_captured(p_payload);
 v_on_at:=coalesce(v_captured,now());
 v_partial:=public.logistics_flag(p_payload,'partial','Partial');
 if v_load.status in ('delivered','closed','cancelled') then
  raise exception 'Load % is finished',v_load.load_number using errcode='22023';
 end if;
 if nullif(p_payload->>'stopId','') is not null then
  if v_load.status<>'in_transit' then
   raise exception 'Until the truck leaves, scan pieces on without choosing a stop' using errcode='22023';
  end if;
  v_at:=public.logistics_stop(v_load,public.logistics_id(p_payload,'stopId','Stop'),'the stop');
  if v_at.kind='dropoff' then
   raise exception '% is a drop-off stop; nothing is picked up there',public.logistics_stop_name(v_at) using errcode='22023';
  end if;
  if v_at.status='done' then raise exception '% is already done',public.logistics_stop_name(v_at) using errcode='22023'; end if;
 elsif v_load.status='in_transit' then
  if v_captured is null or v_captured>v_load.departed_at+public.logistics_clock_slack() then
   raise exception 'Load % has left; choose the pick-up stop you''re at',v_load.load_number using errcode='22023';
  end if;
  v_late:=true;
 end if;

 -- Undo first, so a mistaken scan can be fixed in the same save.
 for v_code in select public.logistics_code(e) from jsonb_array_elements_text(public.logistics_list(p_payload,'undo','pieces to take off')) e loop
  begin
   select * into v_line from public.load_lines x where x.load_id=v_load.id and lower(x.tag)=lower(v_code) and x.status='on_board' for update;
   if not found then raise exception '% isn''t on the truck',v_code using errcode='22023'; end if;
   if v_line.pickup_stop_id is distinct from v_at.id then
    raise exception '% was loaded somewhere else; it comes off at a stop',v_code using errcode='22023';
   end if;
   update public.load_lines set status=case when added_in_field then 'removed' when v_late then 'not_loaded' else 'planned' end,
    on_by=null,on_at=null,unit_status_before=null where id=v_line.id;
   if v_line.unit_id is not null then
    update public.handling_units set status=coalesce(v_line.unit_status_before,'sealed') where id=v_line.unit_id;
   end if;
   v_off:=v_off||v_line.tag;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',v_code,'list','undo','message',v_msg,'sqlstate',v_state);
  end;
 end loop;

 v_list:=public.logistics_list(p_payload,'pieces','pieces');
 for i in 0..jsonb_array_length(v_list)-1 loop
  v_elem:=v_list->i; v_from:=null;
  begin
   if jsonb_typeof(v_elem)='string' then
    v_elem:=jsonb_build_object('code',v_elem#>>'{}');
   elsif jsonb_typeof(v_elem)<>'object' then
    raise exception 'Each piece needs a code' using errcode='22023';
   end if;
   select * into v_piece from public.logistics_piece(p_project_id,v_elem->>'code',true);
   select * into v_line from public.load_lines x where x.load_id=v_load.id and x.status in ('planned','on_board','missing','not_loaded')
    and (x.unit_id=v_piece.unit_id or x.material_id=v_piece.material_id or x.inventory_uid=v_piece.inventory_uid)
    order by case x.status when 'on_board' then 0 when 'missing' then 1 when 'planned' then 2 else 3 end,x.created_at desc limit 1 for update;
   v_has:=found;
   -- A repeat scan of a piece already on changes nothing.
   if not (v_has and v_line.status in ('on_board','missing')) then
    if nullif(v_elem->>'dropoffStopId','') is not null then
     v_drop:=public.logistics_stop(v_load,public.logistics_id(v_elem,'dropoffStopId','Drop-off stop'),'where '||v_piece.tag||' comes off');
    elsif v_has then
     select * into v_drop from public.load_stops where id=v_line.dropoff_stop_id;
    else
     raise exception 'Choose where % comes off',v_piece.tag using errcode='22023';
    end if;
    if v_drop.kind='pickup' then
     raise exception '% is a pick-up stop; choose where % comes off',public.logistics_stop_name(v_drop),v_piece.tag using errcode='22023';
    end if;
    if v_drop.status='done' and not v_late then
     raise exception '% is already done; choose a later stop for %',public.logistics_stop_name(v_drop),v_piece.tag using errcode='22023';
    end if;
    if v_at.id is not null and v_drop.seq<=v_at.seq then
     raise exception '% has to come off at a stop after this one',v_piece.tag using errcode='22023';
    end if;
    if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
     raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
    end if;
    v_status:=case when v_drop.status='done' then 'missing' else 'on_board' end;
    if v_late and exists(select 1 from public.load_lines y where y.load_id<>v_load.id
      and (y.unit_id=v_piece.unit_id or y.material_id=v_piece.material_id or y.inventory_uid=v_piece.inventory_uid)
      and y.status in ('on_board','delivered','missing','written_off')
      and coalesce(y.off_at,y.on_at,y.updated_at)>v_captured+public.logistics_clock_slack()) then
     raise exception '% travelled on another load after this scan was made; the scan is out of date',v_piece.tag using errcode='22023';
    end if;
    if not v_has or v_line.status='not_loaded' then
     v_from:=public.logistics_take_piece(v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,
      public.logistics_flag(v_elem,'move','Move'),false);
    end if;
    if v_has then
     update public.load_lines set status=v_status,dropoff_stop_id=v_drop.id,pickup_stop_id=v_at.id,unit_status_before=v_piece.unit_status,
      on_by=p_actor,on_at=v_on_at where id=v_line.id;
    else
     insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,pickup_stop_id,dropoff_stop_id,status,added_in_field,
      unit_status_before,planned_by,on_by,on_at)
     values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_at.id,v_drop.id,v_status,true,
      v_piece.unit_status,p_actor,p_actor,v_on_at);
    end if;
    if v_piece.unit_id is not null then
     update public.handling_units set status=case when v_status='missing' then 'missing' else 'on_load' end where id=v_piece.unit_id;
    end if;
    if v_from is not null then v_moved:=v_moved||jsonb_build_object('code',v_piece.tag,'from',v_from); end if;
    v_on:=v_on||v_piece.tag;
   end if;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',coalesce(v_elem->>'code',v_list->>i),'list','pieces','message',v_msg,'sqlstate',v_state);
  end;
 end loop;

 if v_load.status='planning' and exists(select 1 from public.load_lines x where x.load_id=v_load.id and x.status='on_board') then
  update public.loads set status='loading' where id=v_load.id;
 end if;
 if v_at.id is not null and v_at.status='pending' and cardinality(v_on)>0 then
  update public.load_stops set status='arrived',arrived_at=v_on_at,arrived_source='scan' where id=v_at.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_loaded','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_at.id,'on',to_jsonb(v_on),'undone',to_jsonb(v_off),
   'moved_from',v_moved,'refused',v_refused,'captured_at',v_captured,'before_departure',v_late),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('refused',v_refused,'moved',v_moved);
end $$;

-- load_depart: the truck leaves. {loadId, confirmAll?, overrideReason?,
-- capturedAt?} It needs the driver's name, something on board, and the
-- driver's licence number and a photo of it, unless office staff give a
-- reason to let it leave without them. confirmAll (office staff, for a load
-- leaving an outside shop or vendor, where nobody scans) marks every planned
-- piece loaded. Planned pieces that didn't go on are left behind.
create function public.logistics_load_depart(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_line public.load_lines; v_piece record; v_confirm boolean; v_confirmed integer:=0; v_left integer;
 v_office boolean:=public.is_office_user(); v_origin_kind text; v_reason text; v_captured timestamptz;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status not in ('planning','loading') then
  raise exception 'Load % has already left',v_load.load_number using errcode='22023';
 end if;
 v_confirm:=public.logistics_flag(p_payload,'confirmAll','Confirm all');
 v_captured:=public.logistics_captured(p_payload);
 if v_confirm then
  if not v_office then
   raise exception 'Only office staff can mark pieces loaded without scanning them' using errcode='42501';
  end if;
  select p.kind into v_origin_kind from public.places p where p.id=v_load.origin_place_id;
  if v_origin_kind is null or v_origin_kind not in ('outside_shop','vendor') then
   raise exception 'Confirm without scanning is only for a load leaving an outside shop or vendor; at our yards and sites the crew scans' using errcode='22023';
  end if;
 end if;
 if v_load.driver_name is null then
  raise exception 'Add the driver''s name before load % leaves',v_load.load_number using errcode='22023';
 end if;
 if not (exists(select 1 from public.load_driver_licences d where d.load_id=v_load.id and d.licence_number is not null)
   and exists(select 1 from public.driver_licence_photos p where p.load_id=v_load.id and p.removed_at is null)) then
  v_reason:=public.logistics_text(p_payload,'overrideReason',500,'Reason');
  if v_reason is null then
   raise exception 'Record the driver''s licence number and a photo of it before load % leaves',v_load.load_number using errcode='22023';
  end if;
  if not v_office then
   raise exception 'Only office staff can let a load leave without the driver''s licence' using errcode='42501';
  end if;
  if length(v_reason)<5 then raise exception 'Give a reason of at least 5 characters' using errcode='22023'; end if;
 end if;
 if v_confirm then
  for v_line in select * from public.load_lines x where x.load_id=v_load.id and x.status='planned' and x.pickup_stop_id is null for update loop
   select * into v_piece from public.logistics_piece(p_project_id,v_line.tag,true);
   if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
    raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
   end if;
   update public.load_lines set status='on_board',unit_status_before=v_piece.unit_status,on_by=p_actor,on_at=now() where id=v_line.id;
   if v_line.unit_id is not null then
    update public.handling_units set status='on_load' where id=v_line.unit_id;
   end if;
   v_confirmed:=v_confirmed+1;
  end loop;
 end if;
 if not exists(select 1 from public.load_lines x where x.load_id=v_load.id and x.status='on_board') then
  raise exception 'Nothing is on the truck yet' using errcode='22023';
 end if;
 update public.load_lines set status='not_loaded' where load_id=v_load.id and status='planned' and pickup_stop_id is null;
 get diagnostics v_left=row_count;
 update public.loads set status='in_transit',departed_at=coalesce(v_captured,now()),departed_by=p_actor,
  licence_override_reason=v_reason,licence_override_by=case when v_reason is not null then p_actor end,
  licence_override_at=case when v_reason is not null then now() end
 where id=v_load.id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_departed','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'confirmed',v_confirmed,'not_loaded',v_left,
   'licence_override',v_reason is not null),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('not_loaded',v_left);
end $$;

-- load_off: scan pieces off at a stop. {loadId, stopId, pieces: [code],
-- siteMapId?, zoneId?, partial?, capturedAt?} The first scan marks the stop
-- arrived. A piece due somewhere else is flagged wrong_stop, one the records
-- didn't have on the truck is flagged extra, and a missing one is found.
-- Until the load is closed, a later scan of a piece already unloaded at
-- another stop moves it here, unless it has moved on since. Unloaded pieces
-- take the stop's place, and the area chosen if the place has a site plan.
create function public.logistics_load_off(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_stop public.load_stops; v_place public.places; v_piece record; v_line public.load_lines; v_has boolean; v_skip boolean;
 v_other text; v_flag text; v_code text; v_map uuid; v_zone uuid; v_pos record; v_captured timestamptz; v_off_at timestamptz;
 v_done integer:=0; v_extra integer:=0; v_wrong integer:=0; v_corrected integer:=0; v_tags text[]:='{}';
 v_partial boolean; v_refused jsonb:='[]'; v_msg text; v_state text;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status in ('planning','loading') then
  raise exception 'Load % hasn''t left yet',v_load.load_number using errcode='22023';
 end if;
 if v_load.status in ('closed','cancelled') then
  raise exception 'Load % is %',v_load.load_number,v_load.status using errcode='22023';
 end if;
 v_stop:=public.logistics_stop(v_load,public.logistics_id(p_payload,'stopId','Stop'),'the stop the pieces come off at');
 select * into v_place from public.places where id=v_stop.place_id;
 v_map:=public.logistics_id(p_payload,'siteMapId','Site plan');
 v_zone:=public.logistics_id(p_payload,'zoneId','Area');
 v_captured:=public.logistics_captured(p_payload);
 v_off_at:=coalesce(v_captured,now());
 v_partial:=public.logistics_flag(p_payload,'partial','Partial');
 if v_map is not null or v_zone is not null then
  select * into v_pos from public.logistics_position(p_project_id,v_place.id,v_map,v_zone,false);
 else
  select v_place.id as place_id,null::uuid as site_map_id,null::uuid as zone_id,null::text as location into v_pos;
 end if;
 for v_code in select e from jsonb_array_elements_text(public.logistics_list(p_payload,'pieces','pieces')) e loop
  begin
   v_skip:=false;
   select * into v_piece from public.logistics_piece(p_project_id,v_code,false);
   select * into v_line from public.load_lines x where x.load_id=v_load.id
    and (x.unit_id=v_piece.unit_id or x.material_id=v_piece.material_id or x.inventory_uid=v_piece.inventory_uid)
    order by (x.status in ('on_board','missing','delivered')) desc,x.created_at desc limit 1 for update;
   v_has:=found;
   if v_has and v_line.status='delivered' then
    -- Already off: a scan here (newer than the one recorded) corrects the stop.
    if v_line.delivered_stop_id is not distinct from v_stop.id or v_captured<v_line.off_at-public.logistics_clock_slack() then
     v_skip:=true;
    else
     -- Only where it last came off can be corrected, not once it has moved on.
     select o.load_number into v_other from public.logistics_open_line(v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_load.id) o;
     if v_other is not null then
      raise exception '% is on load % now; it can''t come off this load again',v_piece.tag,v_other using errcode='22023';
     end if;
     if exists(select 1 from public.load_lines y where y.id<>v_line.id and y.created_at>v_line.created_at
       and y.status in ('on_board','delivered','missing','written_off')
       and (y.unit_id=v_piece.unit_id or y.material_id=v_piece.material_id or y.inventory_uid=v_piece.inventory_uid)) then
      raise exception '% has travelled on another load since it came off here',v_piece.tag using errcode='22023';
     end if;
     if v_piece.unit_id is not null and v_piece.unit_status<>'delivered' then
      raise exception '% is % now; it can''t come off this load again',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
     end if;
     v_flag:=case when v_line.flag='extra' then 'extra' when v_line.dropoff_stop_id<>v_stop.id then 'wrong_stop'
      when v_line.flag='wrong_stop' then null else v_line.flag end;
     update public.load_lines set flag=v_flag,delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,delivered_source='scan',
      off_by=p_actor,off_at=v_off_at where id=v_line.id;
     v_corrected:=v_corrected+1;
     if v_flag='wrong_stop' then v_wrong:=v_wrong+1; end if;
    end if;
   elsif v_has and v_line.status in ('on_board','missing') then
    v_flag:=case when v_line.dropoff_stop_id<>v_stop.id then 'wrong_stop' when v_line.status='missing' then 'found' end;
    update public.load_lines set status='delivered',flag=coalesce(v_flag,flag),delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,
     delivered_source='scan',off_by=p_actor,off_at=v_off_at where id=v_line.id;
    if v_flag='wrong_stop' then v_wrong:=v_wrong+1; end if;
   else
    -- The records didn't have it on this truck: an extra piece.
    select o.load_number into v_other from public.logistics_open_line(v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_load.id) o;
    if v_other is not null then raise exception '% belongs to load %',v_piece.tag,v_other using errcode='22023'; end if;
    if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
     raise exception '% is %; it can''t be unloaded here',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
    end if;
    if v_has then
     update public.load_lines set status='delivered',flag='extra',delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,
      delivered_source='scan',off_by=p_actor,off_at=v_off_at where id=v_line.id;
    else
     insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,dropoff_stop_id,status,flag,added_in_field,
      delivered_stop_id,delivered_place_id,delivered_source,planned_by,off_by,off_at)
     values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_stop.id,'delivered','extra',true,
      v_stop.id,v_place.id,'scan',p_actor,p_actor,v_off_at);
    end if;
    v_extra:=v_extra+1;
   end if;
   if not v_skip then
    if v_piece.unit_id is not null then
     update public.handling_units set status='delivered',place_id=v_pos.place_id,site_map_id=v_pos.site_map_id,zone_id=v_pos.zone_id,location=v_pos.location
      where id=v_piece.unit_id;
    else
     perform public.logistics_place_item(p_actor,v_piece.material_id,v_piece.inventory_uid,v_pos.place_id,v_pos.site_map_id,v_pos.zone_id,
      v_pos.location,'Unloaded from '||v_load.load_number);
    end if;
    v_done:=v_done+1;
    v_tags:=v_tags||v_piece.tag;
   end if;
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate '23505' then
   if not v_partial then raise; end if;
   get stacked diagnostics v_msg=message_text,v_state=returned_sqlstate;
   v_refused:=v_refused||jsonb_build_object('code',v_code,'message',v_msg,'sqlstate',v_state);
  end;
 end loop;
 if v_stop.status='pending' and v_done>0 then
  update public.load_stops set status='arrived',arrived_at=v_off_at,arrived_source='scan' where id=v_stop.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_unloaded','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_stop.id,'pieces',to_jsonb(v_tags),
   'corrected',v_corrected,'refused',v_refused,'captured_at',v_captured),p_project_id);
 return jsonb_build_object('load_id',v_load.id,'stop_id',v_stop.id,'delivered',v_done,'extra',v_extra,'wrong_stop',v_wrong,
  'corrected',v_corrected,'refused',v_refused);
end $$;

-- stop_complete: finish a stop. {loadId, stopId, confirmAll?, capturedAt?}
-- Office staff finish stops at outside shops and vendors, where nobody
-- scans; at our yards and sites the crew scans and finishes. Without
-- confirmAll, pieces due here and not scanned off are missing and planned
-- pick-ups stay behind. confirmAll (office staff, at an outside shop or
-- vendor) records the pieces due here as delivered and the planned pick-ups
-- as on board. The last stop finishes the load.
create function public.logistics_stop_complete(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_stop public.load_stops; v_place public.places; v_line public.load_lines; v_piece record; v_drop public.load_stops;
 v_confirm boolean; v_office boolean:=public.is_office_user(); v_delivered integer:=0; v_missing integer:=0; v_boarded integer:=0; v_left integer:=0;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status<>'in_transit' then
  raise exception 'Load % isn''t on the road',v_load.load_number using errcode='22023';
 end if;
 v_stop:=public.logistics_stop(v_load,public.logistics_id(p_payload,'stopId','Stop'),'the stop to finish');
 if v_stop.status='done' then raise exception '% is already done',public.logistics_stop_name(v_stop) using errcode='22023'; end if;
 select * into v_place from public.places where id=v_stop.place_id;
 v_confirm:=public.logistics_flag(p_payload,'confirmAll','Confirm all');
 perform public.logistics_captured(p_payload);
 if v_place.kind in ('outside_shop','vendor') and not v_office then
  raise exception 'Office staff finish stops at outside shops and vendors' using errcode='42501';
 end if;
 if v_confirm then
  if not v_office then
   raise exception 'Only office staff can mark pieces delivered without scanning them' using errcode='42501';
  end if;
  if v_place.kind not in ('outside_shop','vendor') then
   raise exception 'Confirm without scanning is only for outside shops and vendors; here the crew scans pieces off' using errcode='22023';
  end if;
 end if;
 for v_line in select * from public.load_lines x where x.dropoff_stop_id=v_stop.id and x.status='on_board' for update loop
  if v_confirm then
   update public.load_lines set status='delivered',delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,delivered_source='office',
    off_by=p_actor,off_at=now() where id=v_line.id;
   if v_line.unit_id is not null then
    update public.handling_units set status='delivered',place_id=v_place.id,site_map_id=null,zone_id=null,location=null where id=v_line.unit_id;
   else
    perform public.logistics_place_item(p_actor,v_line.material_id,v_line.inventory_uid,v_place.id,null,null,null,
     'Delivered by '||v_load.load_number);
   end if;
   v_delivered:=v_delivered+1;
  else
   update public.load_lines set status='missing' where id=v_line.id;
   if v_line.unit_id is not null then update public.handling_units set status='missing' where id=v_line.unit_id; end if;
   v_missing:=v_missing+1;
  end if;
 end loop;
 -- Pieces to be picked up here: on board when the office confirms, otherwise
 -- they stay behind.
 for v_line in select * from public.load_lines x where x.pickup_stop_id=v_stop.id and x.status='planned' for update loop
  if v_confirm then
   select * into v_piece from public.logistics_piece(p_project_id,v_line.tag,true);
   select * into v_drop from public.load_stops where id=v_line.dropoff_stop_id;
   if v_drop.status='done' then
    raise exception '% was due off at %, which is already done; change where it comes off first',v_line.tag,public.logistics_stop_name(v_drop) using errcode='22023';
   end if;
   if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
    raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
   end if;
   update public.load_lines set status='on_board',unit_status_before=v_piece.unit_status,on_by=p_actor,on_at=now() where id=v_line.id;
   if v_line.unit_id is not null then update public.handling_units set status='on_load' where id=v_line.unit_id; end if;
   v_boarded:=v_boarded+1;
  else
   update public.load_lines set status='not_loaded' where id=v_line.id;
   v_left:=v_left+1;
  end if;
 end loop;
 update public.load_stops set status='done',arrived_at=coalesce(arrived_at,now()),
  arrived_source=coalesce(arrived_source,case when v_office then 'office' else 'scan' end),
  completed_by=p_actor,completed_at=now() where id=v_stop.id;
 if not exists(select 1 from public.load_stops s where s.load_id=v_load.id and s.status in ('pending','arrived')) then
  update public.loads set status='delivered',delivered_at=now() where id=v_load.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_stop_completed','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_stop.id,
   'confirmed',v_confirm,'delivered',v_delivered,'missing',v_missing,'on',v_boarded,'not_picked_up',v_left),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('stop_id',v_stop.id,'stop_delivered',v_delivered,'stop_missing',v_missing,
  'picked_up',v_boarded,'not_picked_up',v_left);
end $$;

-- load_close (office only): {loadId, cancel?}. Close a delivered load once no
-- piece is missing, or cancel one that hasn't left, which puts its crates
-- back as they were.
create function public.logistics_load_close(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_line public.load_lines; v_cancel boolean; v_open integer;
begin
 if not public.is_office_user() then
  raise exception 'Only office staff can close or cancel a load' using errcode='42501';
 end if;
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 v_cancel:=public.logistics_flag(p_payload,'cancel','Cancel');
 if v_cancel then
  if v_load.status not in ('planning','loading') then
   raise exception 'Only a load that hasn''t left can be cancelled' using errcode='22023';
  end if;
  for v_line in select * from public.load_lines x where x.load_id=v_load.id and x.status='on_board' and x.unit_id is not null for update loop
   update public.handling_units set status=coalesce(v_line.unit_status_before,'sealed') where id=v_line.unit_id;
  end loop;
  update public.load_lines set status='removed' where load_id=v_load.id and status in ('planned','on_board');
  update public.loads set status='cancelled',closed_at=now(),closed_by=p_actor where id=v_load.id;
 else
  if v_load.status<>'delivered' then
   raise exception 'Finish every stop of load % before closing it',v_load.load_number using errcode='22023';
  end if;
  select count(*) into v_open from public.load_lines x where x.load_id=v_load.id and x.status in ('on_board','missing');
  if v_open>0 then
   raise exception 'Load % still has missing pieces (%); scan them, mark them found or write them off first',v_load.load_number,v_open using errcode='22023';
  end if;
  update public.loads set status='closed',closed_at=now(),closed_by=p_actor where id=v_load.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,case when v_cancel then 'load_cancelled' else 'load_closed' end,'load',v_load.id,jsonb_build_object('operation_id',p_operation_id),p_project_id);
 return public.logistics_load_summary(v_load.id);
end $$;

-- line_found (office only): {lineId, placeId, note?}. A missing piece turned
-- up at a place.
create function public.logistics_line_found(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_line public.load_lines; v_place public.places; v_stop uuid; v_note text;
begin
 if not public.is_office_user() then
  raise exception 'Only office staff can mark a missing piece found' using errcode='42501';
 end if;
 select * into v_line from public.load_lines where id=public.logistics_id(p_payload,'lineId','Piece') for update;
 if not found or v_line.project_id<>p_project_id then
  raise exception 'That piece isn''t on a load in this project' using errcode='42501';
 end if;
 if v_line.status<>'missing' then raise exception '% isn''t missing',v_line.tag using errcode='22023'; end if;
 v_place:=public.logistics_place(p_project_id,public.logistics_id(p_payload,'placeId','Place'));
 v_note:=public.logistics_text(p_payload,'note',500,'Note');
 select s.id into v_stop from public.load_stops s where s.load_id=v_line.load_id and s.place_id=v_place.id and s.status<>'cancelled' order by s.seq limit 1;
 update public.load_lines set status='delivered',flag='found',delivered_stop_id=v_stop,delivered_place_id=v_place.id,delivered_source='office',
  note=coalesce(v_note,note),off_by=p_actor,off_at=now() where id=v_line.id;
 if v_line.unit_id is not null then
  update public.handling_units set status='delivered',place_id=v_place.id,site_map_id=null,zone_id=null,location=null where id=v_line.unit_id;
 else
  perform public.logistics_place_item(p_actor,v_line.material_id,v_line.inventory_uid,v_place.id,null,null,null,'Found after a load');
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_piece_found','load',v_line.load_id,jsonb_build_object('operation_id',p_operation_id,'line_id',v_line.id,'tag',v_line.tag,'place_id',v_place.id),p_project_id);
 return jsonb_build_object('line_id',v_line.id,'tag',v_line.tag,'status','delivered','place_id',v_place.id);
end $$;

-- line_write_off (office only): {lineId, reason}. A missing piece is really
-- gone: the piece, the crates inside it and the items they hold are written
-- off, as they were kept in load_write_offs. An administrator can undo it.
create function public.logistics_line_write_off(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_line public.load_lines; v_reason text; v_units jsonb; v_materials jsonb; v_items jsonb; v_id uuid;
begin
 if not public.is_office_user() then
  raise exception 'Only office staff can write off a missing piece' using errcode='42501';
 end if;
 select * into v_line from public.load_lines where id=public.logistics_id(p_payload,'lineId','Piece') for update;
 if not found or v_line.project_id<>p_project_id then
  raise exception 'That piece isn''t on a load in this project' using errcode='42501';
 end if;
 if v_line.status<>'missing' then
  raise exception '% isn''t missing; only a missing piece can be written off',v_line.tag using errcode='22023';
 end if;
 v_reason:=public.logistics_text(p_payload,'reason',500,'Reason');
 if v_reason is null or length(v_reason)<5 then raise exception 'Give a reason of at least 5 characters' using errcode='22023'; end if;
 if v_line.unit_id is not null then
  with recursive down(id,depth) as (
   select v_line.unit_id,0
   union all select h.id,down.depth+1 from public.handling_units h join down on h.parent_id=down.id where down.depth<10)
  select jsonb_agg(jsonb_build_object('id',u.id,'code',u.code,'status',u.status)) into v_units
  from down join public.handling_units u on u.id=down.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'tag',c.tag,'status',m.status,'current_quantity',m.current_quantity)),'[]') into v_materials
  from public.handling_unit_contents c join public.materials m on m.id=c.material_id
  where c.removed_at is null and c.unit_id in (select (e->>'id')::uuid from jsonb_array_elements(v_units) e);
  select coalesce(jsonb_agg(jsonb_build_object('uid',i.uid,'tag',c.tag)),'[]') into v_items
  from public.handling_unit_contents c join public.inventory_records i on i.uid=c.inventory_uid
  where c.removed_at is null and i.written_off_at is null and c.unit_id in (select (e->>'id')::uuid from jsonb_array_elements(v_units) e);
 else
  v_units:='[]';
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'tag',v_line.tag,'status',m.status,'current_quantity',m.current_quantity)),'[]') into v_materials
  from public.materials m where m.id=v_line.material_id;
  select coalesce(jsonb_agg(jsonb_build_object('uid',i.uid,'tag',v_line.tag)),'[]') into v_items
  from public.inventory_records i where i.uid=v_line.inventory_uid;
 end if;
 update public.handling_units set status='written_off' where id in (select (e->>'id')::uuid from jsonb_array_elements(v_units) e);
 update public.materials set status='written_off',current_quantity=0 where id in (select (e->>'id')::uuid from jsonb_array_elements(v_materials) e);
 update public.inventory_records set written_off_at=now(),written_off_by=p_actor where uid in (select (e->>'uid')::uuid from jsonb_array_elements(v_items) e);
 update public.load_lines set status='written_off',note=v_reason,off_by=p_actor,off_at=now() where id=v_line.id;
 insert into public.load_write_offs(project_id,load_id,line_id,reason,affected,written_off_by)
 values(p_project_id,v_line.load_id,v_line.id,v_reason,jsonb_build_object('units',v_units,'materials',v_materials,'items',v_items),p_actor)
 returning id into v_id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_piece_written_off','load',v_line.load_id,jsonb_build_object('operation_id',p_operation_id,'line_id',v_line.id,'tag',v_line.tag,
   'reason',v_reason,'write_off_id',v_id,'units',jsonb_array_length(v_units),'materials',jsonb_array_length(v_materials),'items',jsonb_array_length(v_items)),p_project_id);
 return jsonb_build_object('write_off_id',v_id,'line_id',v_line.id,'tag',v_line.tag,'status','written_off',
  'units',jsonb_array_length(v_units),'materials',jsonb_array_length(v_materials),'items',jsonb_array_length(v_items));
end $$;

-- line_write_off_undo (administrators only): {writeOffId, reason}. The piece
-- turned up after all: everything goes back as it was, and the piece is
-- missing again until it is scanned or marked found; a closed load opens
-- again (delivered) so it can be.
create function public.logistics_line_write_off_undo(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_write_off public.load_write_offs; v_line public.load_lines; v_reason text; v_other text;
begin
 if not public.is_admin(p_actor) then
  raise exception 'Only an administrator can undo a write-off' using errcode='42501';
 end if;
 select * into v_write_off from public.load_write_offs where id=public.logistics_id(p_payload,'writeOffId','Write-off') for update;
 if not found or v_write_off.project_id<>p_project_id then
  raise exception 'That write-off isn''t in this project' using errcode='42501';
 end if;
 if v_write_off.undone_at is not null then raise exception 'That write-off was already undone' using errcode='22023'; end if;
 v_reason:=public.logistics_text(p_payload,'reason',500,'Reason');
 if v_reason is null or length(v_reason)<5 then raise exception 'Give a reason of at least 5 characters' using errcode='22023'; end if;
 select * into v_line from public.load_lines where id=v_write_off.line_id for update;
 select o.load_number into v_other from public.logistics_open_line(v_line.unit_id,v_line.material_id,v_line.inventory_uid,null) o;
 if v_other is not null then
  raise exception '% is on load % now; take it off that load first',v_line.tag,v_other using errcode='22023';
 end if;
 perform 1 from public.projects p where p.id=p_project_id and p.status='active' for share;
 if not found then raise exception 'This project isn''t active' using errcode='22023'; end if;
 update public.load_lines set status='missing' where id=v_line.id;
 update public.loads set status='delivered',closed_at=null,closed_by=null where id=v_line.load_id and status='closed';
 update public.handling_units u set status=a.status from jsonb_to_recordset(v_write_off.affected->'units') a(id uuid,status text)
  where u.id=a.id and u.status='written_off';
 update public.materials m set status=a.status,current_quantity=a.current_quantity
  from jsonb_to_recordset(v_write_off.affected->'materials') a(id uuid,status text,current_quantity integer)
  where m.id=a.id and m.status='written_off';
 update public.inventory_records set written_off_at=null,written_off_by=null
  where uid in (select (e->>'uid')::uuid from jsonb_array_elements(v_write_off.affected->'items') e);
 update public.load_write_offs set undone_by=p_actor,undone_at=now(),undo_reason=v_reason where id=v_write_off.id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_piece_write_off_undone','load',v_line.load_id,jsonb_build_object('operation_id',p_operation_id,'line_id',v_line.id,'tag',v_line.tag,
   'reason',v_reason,'write_off_id',v_write_off.id),p_project_id);
 return jsonb_build_object('write_off_id',v_write_off.id,'line_id',v_line.id,'tag',v_line.tag,'status','missing');
end $$;

-- The dispatcher apply_field_operation hands unknown actions to (021).
create or replace function public.apply_logistics_operation(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
begin
 case p_action
  when 'pack' then return public.logistics_pack(p_actor,p_operation_id,p_project_id,p_payload);
  when 'unpack' then return public.logistics_unpack(p_actor,p_operation_id,p_project_id,p_payload);
  when 'move' then return public.logistics_move(p_actor,p_operation_id,p_project_id,p_payload);
  when 'relocate' then return public.logistics_relocate(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_save' then return public.logistics_load_save(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_plan' then return public.logistics_load_plan(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_on' then return public.logistics_load_on(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_depart' then return public.logistics_load_depart(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_off' then return public.logistics_load_off(p_actor,p_operation_id,p_project_id,p_payload);
  when 'stop_complete' then return public.logistics_stop_complete(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_close' then return public.logistics_load_close(p_actor,p_operation_id,p_project_id,p_payload);
  when 'line_found' then return public.logistics_line_found(p_actor,p_operation_id,p_project_id,p_payload);
  when 'line_write_off' then return public.logistics_line_write_off(p_actor,p_operation_id,p_project_id,p_payload);
  when 'line_write_off_undo' then return public.logistics_line_write_off_undo(p_actor,p_operation_id,p_project_id,p_payload);
  else raise exception 'Unsupported operation' using errcode='22023';
 end case;
end $$;

DO $$ DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
  'logistics_text(jsonb,text,integer,text)','logistics_date(jsonb,text,text)','logistics_id(jsonb,text,text)',
  'logistics_flag(jsonb,text,text)','logistics_list(jsonb,text,text)','logistics_captured(jsonb)','logistics_clock_slack()','logistics_code(text)',
  'logistics_tag(uuid,text)','logistics_load(uuid,uuid)','logistics_place(uuid,uuid)',
  'logistics_position(uuid,uuid,uuid,uuid,boolean)','logistics_place_item(uuid,uuid,uuid,uuid,uuid,uuid,text,text)','logistics_hold_area(uuid)',
  'logistics_stop(public.loads,uuid,text)','logistics_stop_name(public.load_stops)',
  'logistics_material_hold(uuid)','logistics_unit_hold(uuid)','logistics_open_line(uuid,uuid,uuid,uuid)',
  'logistics_item_state(uuid,uuid)','logistics_item_loose(text,uuid,uuid,text)','logistics_unit_free(public.handling_units)',
  'logistics_piece(uuid,text,boolean)','logistics_take_piece(uuid,uuid,uuid,uuid,text,boolean,boolean)','logistics_load_summary(uuid)',
  'logistics_pack(uuid,uuid,uuid,jsonb)','logistics_unpack(uuid,uuid,uuid,jsonb)','logistics_move(uuid,uuid,uuid,jsonb)',
  'logistics_relocate(uuid,uuid,uuid,jsonb)','logistics_load_save(uuid,uuid,uuid,jsonb)','logistics_load_plan(uuid,uuid,uuid,jsonb)',
  'logistics_load_on(uuid,uuid,uuid,jsonb)','logistics_load_depart(uuid,uuid,uuid,jsonb)','logistics_load_off(uuid,uuid,uuid,jsonb)',
  'logistics_stop_complete(uuid,uuid,uuid,jsonb)','logistics_load_close(uuid,uuid,uuid,jsonb)','logistics_line_found(uuid,uuid,uuid,jsonb)',
  'logistics_line_write_off(uuid,uuid,uuid,jsonb)','logistics_line_write_off_undo(uuid,uuid,uuid,jsonb)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public,anon,authenticated',f);
 END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Field operations: as in 021, except
--  receiving and count: one tag at a time, and both wait for an import.
--  receiving: HU- crate labels aren't item tags; a tag matches whatever its
--   capitals; the inspection condition is required; an item on a truck is
--   received when it comes off. Only an accepted delivery uses up the tag and
--   marks its count received, and the received material takes over the
--   count's crate and load lines; a rejection leaves a note on the count. The
--   material starts in the area linked to its rack, and can be high value.
--  count: HU- labels aren't counted; an item in a crate, on a truck or written
--   off isn't recounted; placeId says where, and the area has to be there; a
--   count made before a newer one is refused (capturedAt); a tag received
--   before it was counted is marked received, and its material moves to
--   where it was counted unless it is packed, travelling or (for crews) held.
--  transfer: refused for an item in a crate, on a truck or away from our
--   yards and sites; on hold or being returned, only to a hold area (office
--   staff excepted). The material follows its new rack's area.
--  issue: refused on a truck and, for crews, on hold or being returned. From
--   a crate, the crate's count drops with it and the crate is opened.
--  shipment: office staff only, for stock leaving the project for good, and
--   never from a crate or a load.
-- ---------------------------------------------------------------------------
create or replace function public.apply_field_operation(p_operation_id uuid,p_project_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
<<operation>>
declare
 actor uuid:=auth.uid(); previous public.field_operations; material public.materials; qr public.qr_codes;
 record_id uuid; material_id uuid; event_id uuid; target_location uuid; qty integer; accepted integer; decision text;
 receipt public.receiving_records; before_state jsonb; result jsonb; delta jsonb;
 item public.inventory_records; item_uid uuid; tag text; item_name text; count_qty numeric; count_uom text; count_condition text;
 v_category_id uuid; v_parent_id uuid; v_proposed_name text; v_pin_x numeric; v_pin_y numeric; created boolean;
 v_pos record; v_state record; v_receipt uuid; v_captured timestamptz; v_high boolean; v_hold text; v_away text;
 v_zone_id uuid; v_map_id uuid; v_place_id uuid; v_office boolean; v_weight numeric;
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
 v_office:=public.is_office_user();
 if p_action='receiving' then
  if coalesce(p_payload#>>'{material,qty}','') !~ '^[0-9]+$' then raise exception 'Whole positive quantity required' using errcode='22023'; end if;
  if (p_payload#>>'{material,qty}')::numeric>2147483647 then raise exception 'Quantity is too large' using errcode='22023'; end if;
  qty:=(p_payload#>>'{material,qty}')::integer;
  decision:=p_payload#>>'{decision,status}';
  tag:=btrim(coalesce(p_payload->>'qrCodeValue',''));
  if qty<=0 or decision is null or decision not in ('accepted','partially_accepted','rejected') or length(trim(coalesce(p_payload#>>'{material,material_type}','')))=0
    or length(tag)=0 then
   raise exception 'Material, QR code, quantity and receiving decision are required' using errcode='22023';
  end if;
  if length(tag)>120 then raise exception 'Tag numbers must be 1 to 120 characters' using errcode='22023'; end if;
  if tag ~* '^HU-' then raise exception 'HU- codes are crate labels; give the item its own tag' using errcode='22023'; end if;
  count_condition:=p_payload#>>'{inspection,condition}';
  if count_condition is null or count_condition not in ('good','damaged','mixed') then
   raise exception 'Choose the condition: good, damaged or mixed' using errcode='22023';
  end if;
  if decision='partially_accepted' then
   if coalesce(p_payload#>>'{decision,accepted_qty}','') !~ '^[0-9]+$' then raise exception 'Specify the accepted quantity' using errcode='22023'; end if;
   if (p_payload#>>'{decision,accepted_qty}')::numeric>2147483647 then raise exception 'Quantity is too large' using errcode='22023'; end if;
   accepted:=(p_payload#>>'{decision,accepted_qty}')::integer;
   if accepted<=0 or accepted>=qty then raise exception 'Partial accepted quantity must be between zero and delivered quantity' using errcode='22023'; end if;
  else accepted:=case when decision='accepted' then qty else 0 end; end if;
  target_location:=public.logistics_id(p_payload->'location','location_id','Location');
  if target_location is null or not exists(select 1 from public.locations l where l.id=target_location and l.project_id=p_project_id) then
   raise exception 'Location must belong to this project' using errcode='42501';
  end if;
  begin
   v_weight:=nullif(btrim(coalesce(p_payload#>>'{material,weight}','')),'')::numeric;
  exception when others then
   raise exception 'Weight must be a number' using errcode='22023';
  end;
  if v_weight<0 then raise exception 'Weight cannot be negative' using errcode='22023'; end if;
  if v_weight>1e12 then raise exception 'Weight must be a real number' using errcode='22023'; end if;
  v_high:=case when jsonb_typeof(p_payload#>'{material,is_high_value}')='boolean' then (p_payload#>>'{material,is_high_value}')::boolean else false end;
  -- The tag is this project's, whatever its capitals, spelt as it was counted.
  perform pg_advisory_xact_lock_shared(hashtextextended('tags:'||p_project_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('tag:'||p_project_id::text||':'||lower(tag),0));
  select * into item from public.inventory_records i where i.project_id=p_project_id and lower(btrim(i.qr_code))=lower(tag) for update;
  tag:=coalesce(btrim(item.qr_code),tag);
  insert into public.qr_codes(code_value,entity_type,project_id) values(tag,'item',p_project_id) on conflict do nothing;
  select * into qr from public.qr_codes q where q.project_id=p_project_id and lower(q.code_value)=lower(tag) for update;
  if qr.entity_id is not null then raise exception 'This tag has already been received' using errcode='22023'; end if;
  if item.uid is not null then
   if item.written_off_at is not null then
    raise exception '% was written off on a load; an administrator can undo that first',tag using errcode='22023';
   end if;
   select * into v_state from public.logistics_item_state(null,item.uid);
   if v_state.line_status in ('on_board','missing') or v_state.top_status in ('on_load','missing') then
    raise exception '% is on load %; receive it when it comes off',tag,coalesce(v_state.load_number,'?') using errcode='22023';
   end if;
  end if;
  insert into public.receiving_records(project_id,qr_code_id,status,material_type,size,grade,qty,accepted_qty,weight,description,spec,vendor,po_number,delivery_ticket,carrier,
   condition,damage_notes,inspection_pass,has_exception,exception_type,location_id,created_by)
  values(p_project_id,qr.id,decision,trim(p_payload#>>'{material,material_type}'),p_payload#>>'{material,size}',p_payload#>>'{material,grade}',qty,accepted,
   v_weight,p_payload#>>'{material,description}',p_payload#>>'{material,spec}',p_payload#>>'{po,vendor}',p_payload#>>'{po,po_number}',
   p_payload#>>'{po,delivery_ticket}',p_payload#>>'{po,carrier}',count_condition,p_payload#>>'{inspection,damage_notes}',
   coalesce((p_payload#>>'{inspection,inspection_pass}')::boolean,false),coalesce((p_payload#>>'{decision,has_exception}')::boolean,false),
   nullif(p_payload#>>'{decision,exception_type}',''),target_location,actor) returning id into record_id;
  if accepted>0 then
   -- The material starts in the area linked to its rack, if there is one.
   insert into public.materials(project_id,receiving_record_id,qr_code_id,material_type,size,grade,qty,current_quantity,weight,spec,location_id,status,
    place_id,site_map_id,zone_id,is_high_value)
   select p_project_id,r.id,r.qr_code_id,r.material_type,r.size,r.grade,accepted,accepted,r.weight,r.spec,r.location_id,'in_yard',m.place_id,z.map_id,z.id,
    v_high or coalesce(item.is_high_value,false)
   from public.receiving_records r
   left join public.site_map_zones z on z.location_id=r.location_id and z.is_active
   left join public.site_maps m on m.id=z.map_id
   where r.id=record_id
   returning id into operation.material_id;
   update public.qr_codes set entity_id=record_id where id=qr.id;
   if item.uid is not null then
    update public.inventory_records set count_status='received',receiving_record_id=record_id,rejected_receipt_id=null where uid=item.uid;
    -- The received material takes over the count's crate and load lines.
    update public.handling_unit_contents set material_id=operation.material_id,inventory_uid=null,quantity=accepted,uom='EA'
     where inventory_uid=item.uid and removed_at is null;
    update public.load_lines set material_id=operation.material_id,inventory_uid=null where inventory_uid=item.uid;
    item_uid:=item.uid;
   end if;
  elsif item.uid is not null then
   update public.inventory_records set rejected_receipt_id=record_id where uid=item.uid;
  end if;
  result:=jsonb_build_object('id',record_id,'material_id',operation.material_id,'accepted_qty',accepted,'inventory_uid',item_uid);
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(actor,'receiving_created','receiving_record',record_id,jsonb_build_object('operation_id',p_operation_id,'tag',tag,'qty',qty,'accepted_qty',accepted,
    'status',decision,'inventory_uid',item_uid),p_project_id);
 elsif p_action='count' then
  tag:=btrim(coalesce(p_payload->>'tag',''));
  item_name:=btrim(coalesce(p_payload->>'name',''));
  if length(tag)=0 or length(tag)>120 then raise exception 'Tag number is required' using errcode='22023'; end if;
  if tag ~* '^HU-' then raise exception 'HU- codes are crate labels; count the items inside the crate' using errcode='22023'; end if;
  if length(item_name)=0 or length(item_name)>200 then raise exception 'Item name is required' using errcode='22023'; end if;
  if coalesce(p_payload->>'quantity','') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then
   raise exception 'Quantity must be a positive number with up to 3 decimals' using errcode='22023'; end if;
  count_qty:=(p_payload->>'quantity')::numeric;
  if count_qty<=0 then raise exception 'Quantity must be a positive number with up to 3 decimals' using errcode='22023'; end if;
  count_uom:=coalesce(nullif(trim(p_payload->>'uom'),''),'EA');
  if length(count_uom)>16 then raise exception 'Unit is too long' using errcode='22023'; end if;
  count_condition:=nullif(p_payload->>'condition','');
  if count_condition is not null and count_condition not in ('good','damaged','mixed') then raise exception 'Unknown condition' using errcode='22023'; end if;
  if p_payload ? 'isHighValue' and jsonb_typeof(p_payload->'isHighValue')<>'boolean' then
   raise exception 'High value must be true or false' using errcode='22023'; end if;
  v_high:=(p_payload->>'isHighValue')::boolean;
  v_captured:=public.logistics_captured(p_payload);
  v_category_id:=public.logistics_id(p_payload,'categoryId','Category');
  if v_category_id is not null and jsonb_typeof(p_payload->'proposedCategory')='object' then
   raise exception 'Choose a category or propose one, not both' using errcode='22023'; end if;
  if v_category_id is not null and not exists(select 1 from public.inventory_categories c where c.id=v_category_id and c.project_id=p_project_id and c.status<>'archived') then
   raise exception 'Category is unavailable in this project' using errcode='42501'; end if;
  if jsonb_typeof(p_payload->'proposedCategory')='object' then
   v_proposed_name:=trim(coalesce(p_payload#>>'{proposedCategory,name}',''));
   v_parent_id:=public.logistics_id(p_payload->'proposedCategory','parentId','Parent category');
   if length(v_proposed_name) not between 1 and 120 then raise exception 'Proposed category needs a name' using errcode='22023'; end if;
   if v_parent_id is not null and not exists(select 1 from public.inventory_categories c where c.id=v_parent_id and c.project_id=p_project_id and c.status<>'archived') then
    raise exception 'Parent category is unavailable in this project' using errcode='42501'; end if;
  end if;
  -- Where it is: a place and, where the place has a site plan, an area there.
  if public.logistics_id(p_payload,'siteMapId','Site map') is not null
    and not exists(select 1 from public.site_maps m where m.id=public.logistics_id(p_payload,'siteMapId','Site map') and m.project_id=p_project_id) then
   raise exception 'Site map is unavailable in this project' using errcode='42501'; end if;
  select * into v_pos from public.logistics_position(p_project_id,public.logistics_id(p_payload,'placeId','Place'),
   public.logistics_id(p_payload,'siteMapId','Site map'),public.logistics_id(p_payload,'zoneId','Zone'),true);
  if jsonb_typeof(p_payload->'pin')='object' then
   if v_pos.site_map_id is null then raise exception 'A pin needs a site map' using errcode='22023'; end if;
   if jsonb_typeof(p_payload#>'{pin,x}') is distinct from 'number' or jsonb_typeof(p_payload#>'{pin,y}') is distinct from 'number' then
    raise exception 'Pin coordinates must be numbers' using errcode='22023'; end if;
   v_pin_x:=round((p_payload#>>'{pin,x}')::numeric,6); v_pin_y:=round((p_payload#>>'{pin,y}')::numeric,6);
   if v_pin_x not between 0 and 1 or v_pin_y not between 0 and 1 then raise exception 'Pin must be on the map' using errcode='22023'; end if;
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('tags:'||p_project_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('tag:'||p_project_id::text||':'||lower(tag),0));
  select * into item from public.inventory_records i where i.project_id=p_project_id and lower(btrim(i.qr_code))=lower(tag) for update;
  created:=not found;
  if not created then
   if item.count_status='received' then
    raise exception 'This tag has already been received' using errcode='22023'; end if;
   if item.written_off_at is not null then
    raise exception '% was written off on a load; an administrator can undo that',btrim(item.qr_code) using errcode='22023'; end if;
   perform public.logistics_item_loose(btrim(item.qr_code),null,item.uid,'count');
   if v_captured<item.counted_at-public.logistics_clock_slack() then
    raise exception '% was counted again after this count was made; check it and count it again if needed',btrim(item.qr_code) using errcode='22023'; end if;
  end if;
  if jsonb_typeof(p_payload->'proposedCategory')='object' then
   select c.id into v_category_id from public.inventory_categories c where c.project_id=p_project_id and c.status<>'archived'
    and c.parent_id is not distinct from v_parent_id and lower(c.name)=lower(v_proposed_name);
   if v_category_id is null then
    insert into public.inventory_categories(project_id,parent_id,name,status,proposed_by)
     values(p_project_id,v_parent_id,v_proposed_name,'proposed',actor) returning id into v_category_id;
   end if;
  end if;
  -- A tag received before this count is received.
  select r.id into v_receipt from public.qr_codes q join public.receiving_records r on r.id=q.entity_id
   where q.project_id=p_project_id and lower(q.code_value)=lower(tag) and q.entity_type='item' and r.status in ('accepted','partially_accepted')
    and not exists(select 1 from public.inventory_records x where x.receiving_record_id=r.id);
  before_state:=case when created then null else to_jsonb(item) end;
  if created then
   insert into public.inventory_records(project_id,qr_code,inventory_item,item_description,part_number,category_id,quantity,uom,condition,
    site_map_id,pin_x,pin_y,zone_id,location,place_id,is_high_value,scanner_comments,count_status,receiving_record_id,source,counted_by,counted_at,
    last_scanned_at,last_scanned_by)
   values(p_project_id,tag,item_name,nullif(trim(p_payload->>'description'),''),nullif(trim(p_payload->>'partNumber'),''),v_category_id,count_qty,count_uom,count_condition,
    v_pos.site_map_id,v_pin_x,v_pin_y,v_pos.zone_id,v_pos.location,v_pos.place_id,coalesce(v_high,false),nullif(trim(p_payload->>'notes'),''),
    case when v_receipt is not null then 'received' else 'counted' end,v_receipt,'field',actor,coalesce(v_captured,now()),now(),
    (select coalesce(u.full_name,u.email) from public.users u where u.id=actor))
   returning * into item;
  else
   update public.inventory_records i set inventory_item=item_name,
    item_description=coalesce(nullif(trim(p_payload->>'description'),''),i.item_description),
    part_number=coalesce(nullif(trim(p_payload->>'partNumber'),''),i.part_number),
    category_id=coalesce(v_category_id,i.category_id),quantity=count_qty,uom=count_uom,condition=count_condition,
    site_map_id=v_pos.site_map_id,pin_x=v_pin_x,pin_y=v_pin_y,zone_id=v_pos.zone_id,location=coalesce(v_pos.location,i.location),
    place_id=case when v_pos.place_id is not null then v_pos.place_id when v_pos.zone_id is not null then null else i.place_id end,
    is_high_value=coalesce(v_high,i.is_high_value),
    scanner_comments=coalesce(nullif(trim(p_payload->>'notes'),''),i.scanner_comments),
    count_status=case when v_receipt is not null then 'received' else 'counted' end,receiving_record_id=v_receipt,
    counted_by=actor,counted_at=coalesce(v_captured,now()),
    last_scanned_at=now(),last_scanned_by=(select coalesce(u.full_name,u.email) from public.users u where u.id=actor)
   where i.id=item.id returning * into item;
  end if;
  -- A received item is where it was counted, unless it is packed, travelling
  -- or, for crews, on hold and the count isn't in a hold area.
  if v_receipt is not null and (v_pos.place_id is not null or v_pos.zone_id is not null) then
   select m.id into operation.material_id from public.materials m where m.receiving_record_id=v_receipt and m.status='in_yard';
   select * into v_state from public.logistics_item_state(operation.material_id,null);
   if operation.material_id is not null and v_state.unit_id is null and v_state.line_status is null
     and (v_office or public.logistics_material_hold(operation.material_id) is null or public.logistics_hold_area(v_pos.zone_id)) then
    perform public.logistics_place_item(actor,operation.material_id,null,v_pos.place_id,v_pos.site_map_id,v_pos.zone_id,v_pos.location,'Counted here');
   end if;
  end if;
  result:=jsonb_build_object('uid',item.uid,'id',item.id,'created',created,'category_id',item.category_id,'count_status',item.count_status);
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(actor,'inventory_counted','inventory_record',item.uid,jsonb_build_object('operation_id',p_operation_id,'tag',tag,'created',created,
    'captured_at',v_captured,'before',before_state,'after',to_jsonb(item)),p_project_id);
 elsif p_action in ('transfer','issue','shipment','correct_material') then
  select * into material from public.materials where id=public.logistics_id(p_payload,'materialId','Material') for update;
  if not found or material.project_id<>p_project_id then raise exception 'Material is unavailable in this project' using errcode='42501'; end if;
  tag:=(select q.code_value from public.qr_codes q where q.id=material.qr_code_id);
  before_state:=to_jsonb(material);
  if p_action in ('transfer','issue','shipment') and material.status='written_off' then
   raise exception '% was written off on a load; an administrator can undo that',tag using errcode='22023';
  end if;
  v_hold:=public.logistics_material_hold(material.id);
  if p_action='transfer' then
   target_location:=public.logistics_id(p_payload,'toLocationId','Destination');
   if target_location is null or not exists(select 1 from public.locations l where l.id=target_location and l.project_id=p_project_id) then
    raise exception 'Destination must belong to this project' using errcode='42501'; end if;
   if material.location_id is distinct from public.logistics_id(p_payload,'fromLocationId','Location') then raise exception 'Location changed; refresh before transferring' using errcode='22023'; end if;
   if material.current_quantity<=0 then raise exception 'Cannot move depleted material' using errcode='22023'; end if;
   perform public.logistics_item_loose(tag,material.id,null,'move');
   select p.name into v_away from public.places p where p.id=material.place_id and p.kind not in ('yard','site');
   if v_away is not null then
    raise exception '% is at %; it comes back to the yard on a load',tag,v_away using errcode='22023'; end if;
   if v_hold is not null and not v_office and not exists(select 1 from public.locations l where l.id=target_location and l.is_hold_area) then
    raise exception '% is %; until the office releases it, it can only go to a hold area',tag,v_hold using errcode='22023'; end if;
   select z.id,z.map_id,m.place_id into v_zone_id,v_map_id,v_place_id from public.site_map_zones z join public.site_maps m on m.id=z.map_id
    where z.location_id=target_location and z.is_active;
   update public.materials set location_id=target_location,zone_id=v_zone_id,site_map_id=v_map_id,place_id=coalesce(v_place_id,material.place_id)
    where id=material.id;
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
   select * into v_state from public.logistics_item_state(material.id,null);
   if p_action='issue' then
    if length(trim(coalesce(p_payload->>'jobNumber','')))=0 then raise exception 'Job number required' using errcode='22023'; end if;
    if v_state.line_status in ('on_board','missing') or v_state.top_status in ('on_load','missing') then
     raise exception '% is on load %; issue it when it comes off',tag,coalesce(v_state.load_number,'?') using errcode='22023'; end if;
    if v_hold is not null and not v_office then
     raise exception '% is %; the office releases it before it can be issued',tag,v_hold using errcode='22023'; end if;
    insert into public.material_issues(project_id,material_id,job_number,work_order,quantity_issued,issued_by)
     values(p_project_id,material.id,trim(p_payload->>'jobNumber'),p_payload->>'workOrder',qty,actor) returning id into event_id;
   else
    if not v_office then
     raise exception 'Ship Out is for office staff, for stock leaving the project for good; send items to shops and sites on a load' using errcode='42501'; end if;
    if length(trim(coalesce(p_payload->>'destination','')))=0 then raise exception 'Destination required' using errcode='22023'; end if;
    perform public.logistics_item_loose(tag,material.id,null,'ship');
    if v_state.line_status is not null then
     raise exception '% is planned on load %; take it off the load first',tag,v_state.load_number using errcode='22023'; end if;
    insert into public.shipments_out(project_id,material_id,destination,carrier,tracking_number,quantity_shipped)
     values(p_project_id,material.id,trim(p_payload->>'destination'),p_payload->>'carrier',p_payload->>'trackingNumber',qty) returning id into event_id;
   end if;
   update public.materials set current_quantity=material.current_quantity-operation.qty,
    status=case when material.current_quantity=operation.qty then case when p_action='shipment' then 'shipped' else 'depleted' end else 'in_yard' end where id=material.id;
   -- Issued from a crate: the crate is opened, and holds what is left.
   if v_state.unit_id is not null then
    if material.current_quantity=operation.qty then
     update public.handling_unit_contents c set removed_at=now(),removed_by=actor where c.material_id=material.id and c.removed_at is null;
    else
     update public.handling_unit_contents c set quantity=material.current_quantity-operation.qty where c.material_id=material.id and c.removed_at is null;
    end if;
    update public.handling_units set status='open',sealed_by=null,sealed_at=null where id=v_state.unit_id and status='sealed';
   end if;
   -- Nothing left to plan on a load.
   if material.current_quantity=operation.qty then
    update public.load_lines x set status='removed',note=left(coalesce(x.note||' ','')||'Issued in full.',500)
     where x.material_id=material.id and x.status='planned';
   end if;
  end if;
  select jsonb_build_object('id',event_id,'material_id',m.id,'current_quantity',m.current_quantity) into result from public.materials m where m.id=material.id;
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   select actor,case p_action when 'transfer' then 'material_transferred' when 'issue' then 'material_issued' when 'shipment' then 'shipment_created' else 'material_corrected' end,
    'material',m.id,jsonb_build_object('operation_id',p_operation_id,'tag',operation.tag,'qty',operation.qty,'before',before_state,'after',to_jsonb(m),
     'reason',p_payload->>'reason'),p_project_id
   from public.materials m where m.id=material.id;
 elsif p_action='exception' then
  if not v_office then raise exception 'Office access required' using errcode='42501'; end if;
  select * into receipt from public.receiving_records where id=public.logistics_id(p_payload,'id','Receipt') for update;
  if not found or receipt.project_id<>p_project_id then raise exception 'Receipt unavailable in this project' using errcode='42501'; end if;
  if not receipt.has_exception or p_payload->>'resolution' is null or p_payload->>'resolution' not in ('hold','return_to_vendor','released') then raise exception 'Valid exception decision required' using errcode='22023'; end if;
  if public.logistics_id(p_payload,'ownerId','Owner') is not null and not exists(select 1 from public.user_projects up join public.users u on u.id=up.user_id
    where up.project_id=p_project_id and up.user_id=public.logistics_id(p_payload,'ownerId','Owner') and public.is_active_user(u.id) and u.role in ('office_staff','admin')) then
   raise exception 'Exception owner must be active office staff assigned to this project' using errcode='42501'; end if;
  update public.receiving_records set exception_resolution=p_payload->>'resolution',exception_resolved=(p_payload->>'resolution'<>'hold'),
   exception_owner_id=public.logistics_id(p_payload,'ownerId','Owner'),exception_due_date=nullif(p_payload->>'dueDate','')::date,
   exception_notes=p_payload->>'notes' where id=receipt.id;
  result:=jsonb_build_object('id',receipt.id,'exception_resolved',p_payload->>'resolution'<>'hold');
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(actor,'exception_updated','receiving_record',receipt.id,jsonb_build_object('before',to_jsonb(receipt),'decision',p_payload,'operation_id',p_operation_id),p_project_id);
 else result:=public.apply_logistics_operation(actor,p_operation_id,p_project_id,p_action,p_payload); end if;
 insert into public.field_operations(operation_id,user_id,project_id,action,payload,result) values(p_operation_id,actor,p_project_id,p_action,p_payload,result);
 return result;
end $$;
revoke all on function public.apply_field_operation(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.apply_field_operation(uuid,uuid,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The driver's licence, recorded with its own calls so the number never
-- lands in field_operations. A licence is due for removal 90 days after its
-- load closes or is cancelled or, if the load never closes, 90 days after its
-- last activity. A daily job removes due licences with the service role;
-- office staff can remove one sooner, with a reason.
-- ---------------------------------------------------------------------------
create function public.driver_licence_due_at(p_load_id uuid) returns timestamptz
language sql stable security definer set search_path=public as $$
 select coalesce(l.closed_at,greatest(l.updated_at,
   (select max(x.updated_at) from public.load_lines x where x.load_id=l.id),
   (select max(s.updated_at) from public.load_stops s where s.load_id=l.id),
   (select max(p.created_at) from public.driver_licence_photos p where p.load_id=l.id)))+interval '90 days'
 from public.loads l where l.id=p_load_id
$$;

-- p_licence: {number, state?, expiry? (YYYY-MM-DD), capturedAt?}. A repeated
-- operation ID is answered without being applied again, and a change made
-- before the latest one is refused.
create function public.record_driver_licence(p_operation_id uuid,p_load_id uuid,p_licence jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); v_load public.loads; v_row public.load_driver_licences; v_op public.load_licence_operations;
 v_number text; v_state text; v_expiry date; v_captured timestamptz; v_last4 text;
begin
 if p_operation_id is null or jsonb_typeof(p_licence) is distinct from 'object' then
  raise exception 'Operation ID and licence details are required' using errcode='22023';
 end if;
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or actor is null or not public.can_work_project(v_load.project_id) then
  raise exception 'That load isn''t in your projects' using errcode='42501';
 end if;
 select * into v_op from public.load_licence_operations where operation_id=p_operation_id;
 if found then
  if v_op.load_id<>p_load_id or v_op.user_id<>actor then
   raise exception 'Operation ID already belongs to a different request' using errcode='23505';
  end if;
  return jsonb_build_object('load_id',p_load_id,'recorded',true);
 end if;
 if v_load.status in ('closed','cancelled') and not public.is_office_user() then
  raise exception 'Load % is closed; the office can still correct its licence',v_load.load_number using errcode='22023';
 end if;
 if public.driver_licence_due_at(p_load_id)<now() then
  raise exception 'Load % is past its 90-day licence retention period',v_load.load_number using errcode='22023';
 end if;
 v_captured:=public.logistics_captured(p_licence);
 select * into v_row from public.load_driver_licences where load_id=p_load_id for update;
 if found and v_captured<greatest(v_row.recorded_at,v_row.removed_at)-public.logistics_clock_slack() then
  raise exception 'The licence for load % was changed after this was recorded; check it and record it again if needed',v_load.load_number using errcode='22023';
 end if;
 v_number:=upper(regexp_replace(btrim(coalesce(p_licence->>'number','')),'\s+',' ','g'));
 if v_number !~ '^[A-Z0-9][A-Z0-9 -]{2,39}$' then
  raise exception 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes' using errcode='22023';
 end if;
 -- Only a long number's last four characters are ever repeated back or logged.
 v_last4:=case when length(regexp_replace(v_number,'[^A-Z0-9]','','g'))>6 then right(regexp_replace(v_number,'[^A-Z0-9]','','g'),4) end;
 v_state:=public.logistics_text(p_licence,'state',40,'Issuing state');
 v_expiry:=public.logistics_date(p_licence,'expiry','Expiry date');
 insert into public.load_driver_licences(load_id,project_id,licence_number,licence_state,licence_expiry,recorded_by,recorded_at)
 values(p_load_id,v_load.project_id,v_number,v_state,v_expiry,actor,coalesce(v_captured,now()))
 on conflict (load_id) do update set licence_number=excluded.licence_number,licence_state=excluded.licence_state,
  licence_expiry=excluded.licence_expiry,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at,removed_at=null;
 insert into public.load_licence_operations(operation_id,load_id,project_id,user_id) values(p_operation_id,p_load_id,v_load.project_id,actor);
 update public.loads set licence_recorded_at=coalesce(v_captured,now()) where id=p_load_id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(actor,'driver_licence_recorded','load',p_load_id,jsonb_build_object('operation_id',p_operation_id,'last4',v_last4),v_load.project_id);
 return jsonb_build_object('load_id',p_load_id,'recorded',true,'last4',v_last4);
end $$;

-- Attach a photo already uploaded to driver-licences/<load id>/<name>.jpg.
-- Field uploads must not overwrite (upserting needs read access they don't
-- have); retrying an upload that already landed is fine.
create function public.attach_driver_licence_photo(p_load_id uuid,p_path text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); v_load public.loads;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or actor is null or not public.can_work_project(v_load.project_id)
   or (v_load.status in ('closed','cancelled') and not public.is_office_user()) then
  raise exception 'Licence photos can''t be added to that load' using errcode='42501';
 end if;
 if coalesce(p_path,'') !~ ('^'||p_load_id::text||'/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png)$') then
  raise exception 'Licence photos are stored as <load id>/<name>.jpg' using errcode='22023';
 end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and o.name=p_path) then
  raise exception 'Upload the photo before attaching it' using errcode='22023';
 end if;
 if exists(select 1 from public.driver_licence_photos p where p.storage_path=p_path) then return; end if;
 if (select count(*) from public.driver_licence_photos p where p.load_id=p_load_id and p.removed_at is null)>=4 then
  raise exception 'A load keeps at most 4 licence photos' using errcode='22023';
 end if;
 insert into public.driver_licence_photos(load_id,project_id,storage_path,created_by) values(p_load_id,v_load.project_id,p_path,actor);
 update public.loads set licence_recorded_at=coalesce(licence_recorded_at,now()) where id=p_load_id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(actor,'driver_licence_photo_added','load',p_load_id,jsonb_build_object('photo',split_part(p_path,'/',2)),v_load.project_id);
end $$;

-- Office staff take back a wrong photo: delete the file through Storage,
-- then record it here, with a reason if they like.
create function public.remove_driver_licence_photo(p_path text,p_reason text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_photo public.driver_licence_photos;
begin
 select * into v_photo from public.driver_licence_photos where storage_path=p_path for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_photo.project_id) then
  raise exception 'Only office staff on the load''s project can remove its licence photos' using errcode='42501';
 end if;
 if v_photo.removed_at is not null then return; end if;
 if exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and o.name=p_path) then
  raise exception 'Delete the photo from storage first' using errcode='22023';
 end if;
 update public.driver_licence_photos set removed_at=now() where id=v_photo.id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'driver_licence_photo_removed','load',v_photo.load_id,jsonb_build_object('photo',split_part(p_path,'/',2),
   'reason',left(nullif(btrim(coalesce(p_reason,'')),''),500)),v_photo.project_id);
end $$;

-- Clears a load's licence once every file in its folder is gone. Internal.
create function public.driver_licence_clear(p_load public.loads,p_actor uuid,p_reason text,p_source text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_photos integer; v_numbers integer;
begin
 if exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=p_load.id::text) then
  raise exception 'Delete the licence photos from storage first' using errcode='22023';
 end if;
 update public.driver_licence_photos set removed_at=now() where load_id=p_load.id and removed_at is null;
 get diagnostics v_photos=row_count;
 update public.load_driver_licences set licence_number=null,licence_state=null,licence_expiry=null,removed_at=now()
  where load_id=p_load.id and removed_at is null;
 get diagnostics v_numbers=row_count;
 update public.loads set licence_recorded_at=null where id=p_load.id and licence_recorded_at is not null;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'driver_licence_removed','load',p_load.id,jsonb_build_object('photos',v_photos,'licence',v_numbers>0,'reason',p_reason,'by',p_source),p_load.project_id);
 return jsonb_build_object('load_id',p_load.id,'photos_removed',v_photos,'licence_removed',v_numbers>0);
end $$;

-- Office staff remove a load's licence: once it is due, or sooner with a
-- reason (the wrong driver or document). Delete the photos through Storage
-- first.
create function public.remove_driver_licence(p_load_id uuid,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can remove its licence' using errcode='42501';
 end if;
 if length(v_reason)>500 then raise exception 'Reason is too long (at most 500 characters)' using errcode='22023'; end if;
 if public.driver_licence_due_at(p_load_id)>now() and coalesce(length(v_reason),0)<5 then
  raise exception 'Give a reason to remove the licence before it is due' using errcode='22023';
 end if;
 return public.driver_licence_clear(v_load,auth.uid(),v_reason,'office');
end $$;

-- Whether a load has both a licence number and a photo on file: all a crew
-- needs to know before departure. The licence itself stays with the office.
create function public.load_licence_complete(p_load_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.load_driver_licences d where d.load_id=l.id and d.licence_number is not null)
  and exists(select 1 from public.driver_licence_photos p where p.load_id=l.id and p.removed_at is null)
 from public.loads l where l.id=p_load_id and public.has_project_access(l.project_id)
$$;

-- Licences due for removal on the office's projects, with every file in each
-- load's folder.
create function public.driver_licences_due_for_removal() returns table(load_id uuid,load_number text,storage_paths text[])
language sql stable security definer set search_path=public as $$
 select l.id,l.load_number,coalesce((select array_agg(o.name order by o.name) from storage.objects o
   where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=l.id::text),'{}')
 from public.loads l
 where public.is_office_user() and public.has_project_access(l.project_id) and public.driver_licence_due_at(l.id)<now()
  and (exists(select 1 from public.load_driver_licences d where d.load_id=l.id and d.removed_at is null)
   or exists(select 1 from public.driver_licence_photos p where p.load_id=l.id and p.removed_at is null)
   or exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=l.id::text))
$$;

-- For the daily removal job, which runs with the service role: every load in
-- any project whose licence is due, with every file in its folder.
create function public.driver_licence_purge_queue() returns table(load_id uuid,project_id uuid,load_number text,due_at timestamptz,storage_paths text[])
language sql stable security definer set search_path=public as $$
 select l.id,l.project_id,l.load_number,public.driver_licence_due_at(l.id),
  coalesce((select array_agg(o.name order by o.name) from storage.objects o
   where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=l.id::text),'{}')
 from public.loads l
 where public.driver_licence_due_at(l.id)<now()
  and (exists(select 1 from public.load_driver_licences d where d.load_id=l.id and d.removed_at is null)
   or exists(select 1 from public.driver_licence_photos p where p.load_id=l.id and p.removed_at is null)
   or exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=l.id::text))
 order by 4
$$;

create function public.purge_driver_licence(p_load_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found then raise exception 'That load doesn''t exist' using errcode='22023'; end if;
 if public.driver_licence_due_at(p_load_id)>=now() then
  raise exception 'The licence for load % isn''t due for removal yet',v_load.load_number using errcode='22023';
 end if;
 return public.driver_licence_clear(v_load,null,null,'retention');
end $$;

revoke all on function public.driver_licence_due_at(uuid),public.driver_licence_clear(public.loads,uuid,text,text),
 public.record_driver_licence(uuid,uuid,jsonb),public.attach_driver_licence_photo(uuid,text),public.remove_driver_licence_photo(text,text),
 public.remove_driver_licence(uuid,text),public.driver_licences_due_for_removal(),public.load_licence_complete(uuid),
 public.driver_licence_purge_queue(),public.purge_driver_licence(uuid) from public,anon,authenticated;
grant execute on function public.record_driver_licence(uuid,uuid,jsonb),public.attach_driver_licence_photo(uuid,text),
 public.remove_driver_licence_photo(text,text),public.remove_driver_licence(uuid,text),public.driver_licences_due_for_removal(),
 public.load_licence_complete(uuid) to authenticated;
grant execute on function public.driver_licence_purge_queue(),public.purge_driver_licence(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Activity. The audit log keeps whole before-and-after records, licence
-- events and drivers' phone numbers, so office staff read it directly;
-- everyone on a project reads its activity through list_project_activity:
-- what happened, to what (subject: the load number, crate label or tag), by
-- whom and when, with a fixed set of safe details.
-- ---------------------------------------------------------------------------
drop policy audit_project_read on public.audit_log;
create policy office_read on public.audit_log for select to authenticated
 using(public.is_office_user() and (public.has_project_access(project_id) or (project_id is null and public.is_admin(auth.uid()))));

create function public.list_project_activity(p_project_id uuid,p_before timestamptz default null,p_limit integer default 50)
returns table(id uuid,created_at timestamptz,user_id uuid,user_name text,action text,entity_type text,entity_id uuid,subject text,details jsonb)
language sql stable security definer set search_path=public as $$
 select a.id,a.created_at,a.user_id,u.full_name,a.action,a.entity_type,a.entity_id,
  case a.entity_type
   when 'load' then (select l.load_number from public.loads l where l.id=a.entity_id and l.project_id=a.project_id)
   when 'handling_unit' then (select h.code from public.handling_units h where h.id=a.entity_id and h.project_id=a.project_id)
   when 'material' then (select q.code_value from public.materials m join public.qr_codes q on q.id=m.qr_code_id
    where m.id=a.entity_id and m.project_id=a.project_id)
   when 'inventory_record' then (select btrim(i.qr_code) from public.inventory_records i where i.uid=a.entity_id and i.project_id=a.project_id)
   when 'receiving_record' then (select q.code_value from public.receiving_records r join public.qr_codes q on q.id=r.qr_code_id
    where r.id=a.entity_id and r.project_id=a.project_id)
  end,
  coalesce((select jsonb_object_agg(k.key,k.value) from jsonb_each(coalesce(a.details,'{}'::jsonb)) k
   where k.key in ('tag','code','created','added','removed','qty','accepted_qty','status','items_released','units_released','pieces','on','undone',
    'confirmed','delivered','missing','not_loaded','not_picked_up','corrected','moved_from','reason','stop_id','line_id','write_off_id')),'{}'::jsonb)
 from public.audit_log a left join public.users u on u.id=a.user_id
 where a.project_id=p_project_id and public.has_project_access(p_project_id)
  and a.action not like 'driver_licence%' and (p_before is null or a.created_at<p_before)
 order by a.created_at desc
 limit least(greatest(coalesce(p_limit,50),1),200)
$$;
revoke all on function public.list_project_activity(uuid,timestamptz,integer) from public,anon;
grant execute on function public.list_project_activity(uuid,timestamptz,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Views for the office pages and the app.
-- ---------------------------------------------------------------------------
-- Each rack and the area it is linked to, so receiving can show the area.
create view public.location_areas with (security_invoker=true) as
select l.id as location_id,l.project_id,l.zone as rack_zone,l."row" as rack_row,l.rack,l.is_hold_area,
 z.id as zone_id,z.map_id as site_map_id,public.site_map_zone_path(z.id) as area,m.place_id,p.name as place_name
from public.locations l
left join public.site_map_zones z on z.location_id=l.id and z.is_active
left join public.site_maps m on m.id=z.map_id
left join public.places p on p.id=m.place_id;

-- Where each item is now: the one answer every screen shows. A received item
-- is its material; an item not yet received is its count record. position is
-- on_load or missing (its load says where), in_crate (where the outermost
-- crate is), at_place (its own place and area), gone (issued, shipped, used
-- up or written off) or unknown.
create view public.item_positions with (security_invoker=true) as
with items as (
 select 'material'::text as item_kind,m.project_id,m.id as material_id,i.uid as inventory_uid,q.code_value as tag,
  coalesce(i.inventory_item,nullif(concat_ws(' ',m.material_type,m.size,m.grade),''),q.code_value) as name,
  m.current_quantity::numeric as quantity,'EA'::text as uom,m.status,(m.is_high_value or coalesce(i.is_high_value,false)) as is_high_value,
  case when r.has_exception and r.exception_resolution='hold' then 'on_hold'
   when r.has_exception and r.exception_resolution='return_to_vendor' then 'return_to_vendor' end as hold,
  false as rejected_on_delivery,m.place_id,m.site_map_id,m.zone_id,m.location_id,null::text as location_note
 from public.materials m
 join public.qr_codes q on q.id=m.qr_code_id
 join public.receiving_records r on r.id=m.receiving_record_id
 left join public.inventory_records i on i.receiving_record_id=m.receiving_record_id
 union all
 select 'count',i.project_id,null,i.uid,btrim(i.qr_code),i.inventory_item,i.quantity,i.uom,
  case when i.written_off_at is not null then 'written_off' else i.count_status end,i.is_high_value,null,i.rejected_receipt_id is not null,
  i.place_id,i.site_map_id,i.zone_id,null,i.location
 from public.inventory_records i where i.count_status<>'received'
)
select it.item_kind,it.project_id,it.material_id,it.inventory_uid,it.tag,it.name,it.quantity,it.uom,it.status,it.is_high_value,it.hold,it.rejected_on_delivery,
 c.unit_id as crate_id,c.code as crate_code,top.code as top_crate_code,top.status as top_crate_status,
 ln.load_id,ln.load_number,ln.line_status,k.position,
 case when k.position in ('in_crate','at_place') then k.place_id end as place_id,
 case when k.position in ('in_crate','at_place') then pl.name end as place_name,
 case when k.position in ('in_crate','at_place') then pl.kind end as place_kind,
 case when k.position in ('in_crate','at_place') then k.site_map_id end as site_map_id,
 case when k.position in ('in_crate','at_place') then k.zone_id end as zone_id,
 case when k.position in ('in_crate','at_place') and k.zone_id is not null then public.site_map_zone_path(k.zone_id) end as area,
 case when k.position='at_place' then it.location_id end as location_id,
 case when k.position='at_place' then it.location_note end as location_note
from items it
left join lateral (select x.unit_id,u.code from public.handling_unit_contents x join public.handling_units u on u.id=x.unit_id
  where x.removed_at is null and ((it.material_id is not null and x.material_id=it.material_id) or (it.material_id is null and x.inventory_uid=it.inventory_uid))
  limit 1) c on true
left join lateral public.handling_unit_top(c.unit_id) top on true
left join lateral (select x.load_id,l.load_number,x.status as line_status from public.load_lines x join public.loads l on l.id=x.load_id
  where x.status in ('planned','on_board','missing')
   and case when c.unit_id is not null then x.unit_id=top.id else (x.material_id=it.material_id or x.inventory_uid=it.inventory_uid) end
  order by case x.status when 'on_board' then 0 when 'missing' then 1 else 2 end limit 1) ln on true
cross join lateral (select
  case when it.status in ('issued','shipped','depleted','written_off') then 'gone'
   when ln.line_status='on_board' or top.status='on_load' then 'on_load'
   when ln.line_status='missing' or top.status='missing' then 'missing'
   when c.unit_id is not null then 'in_crate'
   when coalesce(it.place_id,it.zone_id,it.location_id) is not null or it.location_note is not null then 'at_place'
   else 'unknown' end as position,
  case when c.unit_id is not null then top.place_id else it.place_id end as place_id,
  case when c.unit_id is not null then top.site_map_id else it.site_map_id end as site_map_id,
  case when c.unit_id is not null then top.zone_id else it.zone_id end as zone_id) k
left join public.places pl on pl.id=k.place_id;

create view public.load_overview with (security_invoker=true) as
select l.id,l.project_id,l.load_number,l.status,l.origin_place_id,o.name as origin_name,o.kind as origin_kind,l.planned_date,
 l.truck_type,l.truck_number,l.trailer_number,l.bol_number,l.driver_name,l.driver_phone,l.licence_recorded_at,
 public.load_licence_complete(l.id) as licence_complete,l.licence_override_at,l.licence_override_reason,l.started_in_field,l.notes,
 (select count(*) from public.load_companies c where c.load_id=l.id)::integer as company_count,
 (select count(*) from public.load_stops s where s.load_id=l.id and s.status<>'cancelled')::integer as stop_count,
 (select count(*) from public.load_stops s where s.load_id=l.id and s.status='done')::integer as stops_done,
 (select p.name from public.load_stops s join public.places p on p.id=s.place_id
   where s.load_id=l.id and s.status in ('pending','arrived') order by s.seq limit 1) as next_stop,
 coalesce(n.planned,0)::integer as planned_count,coalesce(n.on_board,0)::integer as on_board_count,
 coalesce(n.delivered,0)::integer as delivered_count,coalesce(n.missing,0)::integer as missing_count,
 coalesce(n.written_off,0)::integer as written_off_count,coalesce(n.flagged,0)::integer as flagged_count,
 l.departed_at,l.delivered_at,l.closed_at,l.created_by,l.edited_at,l.created_at,l.updated_at
from public.loads l
left join public.places o on o.id=l.origin_place_id
left join lateral (select count(*) filter (where x.status='planned') as planned,count(*) filter (where x.status='on_board') as on_board,
  count(*) filter (where x.status='delivered') as delivered,count(*) filter (where x.status='missing') as missing,
  count(*) filter (where x.status='written_off') as written_off,count(*) filter (where x.flag is not null) as flagged
 from public.load_lines x where x.load_id=l.id) n on true;

create view public.load_stop_overview with (security_invoker=true) as
select s.id,s.project_id,s.load_id,s.seq,s.place_id,p.name as place_name,p.kind as place_kind,p.city,p.state,
 s.kind,s.planned_date,s.status,s.arrived_at,s.arrived_source,s.completed_at,
 coalesce(n.due,0)::integer as due_count,coalesce(n.delivered,0)::integer as delivered_count,coalesce(n.missing,0)::integer as missing_count,
 coalesce(n.pickups,0)::integer as pickup_count
from public.load_stops s
join public.places p on p.id=s.place_id
left join lateral (select count(*) filter (where x.dropoff_stop_id=s.id and x.status in ('planned','on_board')) as due,
  count(*) filter (where x.delivered_stop_id=s.id and x.status='delivered') as delivered,
  count(*) filter (where x.dropoff_stop_id=s.id and x.status='missing') as missing,
  count(*) filter (where x.pickup_stop_id=s.id and x.status='planned') as pickups
 from public.load_lines x where x.load_id=s.load_id) n on true
where s.status<>'cancelled';

-- is_current_position marks the line that says where a piece is now: its
-- latest line that put it on a truck, off at a place, missing or written off.
create view public.load_line_overview with (security_invoker=true) as
select x.id,x.project_id,x.load_id,l.load_number,l.status as load_status,x.tag,
 case when x.unit_id is not null then 'crate' else 'item' end as piece_kind,x.unit_id,x.material_id,x.inventory_uid,
 coalesce(u.description,case when u.id is not null then initcap(u.kind) end,i.inventory_item,mi.inventory_item,nullif(concat_ws(' ',m.material_type,m.size,m.grade),''),x.tag) as name,
 coalesce(u.is_high_value,m.is_high_value or coalesce(mi.is_high_value,false),i.is_high_value,false) as is_high_value,x.status,x.flag,x.added_in_field,
 x.pickup_stop_id,ps.seq as pickup_seq,pp.name as pickup_place,
 x.dropoff_stop_id,ds.seq as dropoff_seq,dp.name as dropoff_place,
 x.delivered_stop_id,x.delivered_place_id,vp.name as delivered_place,x.delivered_source,x.note,
 x.on_at,x.off_at,x.created_at,x.updated_at,
 (x.status in ('on_board','delivered','missing','written_off') and not exists(
   select 1 from public.load_lines y where y.id<>x.id and y.status in ('on_board','delivered','missing','written_off')
    and (y.unit_id=x.unit_id or y.material_id=x.material_id or y.inventory_uid=x.inventory_uid)
    and (coalesce(y.off_at,y.on_at,y.updated_at),y.id)>(coalesce(x.off_at,x.on_at,x.updated_at),x.id))) as is_current_position
from public.load_lines x
join public.loads l on l.id=x.load_id
join public.load_stops ds on ds.id=x.dropoff_stop_id
join public.places dp on dp.id=ds.place_id
left join public.load_stops ps on ps.id=x.pickup_stop_id
left join public.places pp on pp.id=ps.place_id
left join public.places vp on vp.id=x.delivered_place_id
left join public.handling_units u on u.id=x.unit_id
left join public.materials m on m.id=x.material_id
left join public.inventory_records mi on mi.receiving_record_id=m.receiving_record_id
left join public.inventory_records i on i.uid=x.inventory_uid;

-- As in 021, plus the outermost crate's status and the load it is on or
-- planned for.
create or replace view public.handling_unit_overview with (security_invoker=true) as
select u.id,u.project_id,u.code,u.kind,u.description,u.is_high_value,u.status,u.parent_id,p.code as parent_code,
 top.id as top_unit_id,top.code as top_code,top.place_id,pl.name as place_name,top.site_map_id,top.zone_id,top.location,
 (select count(*) from public.handling_unit_contents c where c.unit_id=u.id and c.removed_at is null)::integer as item_count,
 (select count(*) from public.handling_units k where k.parent_id=u.id)::integer as unit_count,
 u.sealed_at,u.created_at,u.updated_at,
 top.status as top_status,ol.load_id,ol.load_number,ol.line_status as load_line_status,pl.kind as place_kind
from public.handling_units u
left join public.handling_units p on p.id=u.parent_id
cross join lateral public.handling_unit_top(u.id) top
left join public.places pl on pl.id=top.place_id
left join lateral (select x.load_id,ld.load_number,x.status as line_status from public.load_lines x join public.loads ld on ld.id=x.load_id
  where x.unit_id=top.id and x.status in ('planned','on_board','missing')
  order by case x.status when 'on_board' then 0 when 'missing' then 1 else 2 end limit 1) ol on true;

-- What a scanned code is in a project, for the Scan tab: a crate, a received
-- item, a counted, expected or written-off item, an unused crate label, or
-- nothing yet. can_receive is true only when receiving may start: an item
-- tag with no receipt in this project that isn't on a truck or written off.
create function public.lookup_tag(p_project_id uuid,p_code text) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare v_code text:=btrim(coalesce(p_code,'')); v_unit public.handling_unit_overview; v_item public.item_positions; v_rejected boolean;
begin
 if not public.has_project_access(p_project_id) then
  raise exception 'That project isn''t one of yours' using errcode='42501';
 end if;
 if length(v_code) not between 1 and 120 then
  raise exception 'Tag numbers must be 1 to 120 characters' using errcode='22023';
 end if;
 if v_code ~* '^HU-' then
  select * into v_unit from public.handling_unit_overview h where h.code=upper(v_code) and h.project_id=p_project_id;
  if found then
   return jsonb_build_object('kind','crate','code',v_unit.code,'unit_id',v_unit.id,'status',v_unit.status,'parent_code',v_unit.parent_code,
    'top_code',v_unit.top_code,'top_status',v_unit.top_status,'place_id',v_unit.place_id,'place_name',v_unit.place_name,'place_kind',v_unit.place_kind,
    'zone_id',v_unit.zone_id,'location',v_unit.location,'load_id',v_unit.load_id,'load_number',v_unit.load_number,
    'load_line_status',v_unit.load_line_status,'item_count',v_unit.item_count,'unit_count',v_unit.unit_count,'can_receive',false);
  end if;
  return jsonb_build_object('kind',case when exists(select 1 from public.qr_codes q where q.project_id=p_project_id and q.entity_type='handling_unit'
    and lower(q.code_value)=lower(v_code)) then 'unused_label' else 'unknown_label' end,'code',upper(v_code),'can_receive',false);
 end if;
 v_rejected:=exists(select 1 from public.qr_codes q join public.receiving_records r on r.qr_code_id=q.id
  where q.project_id=p_project_id and lower(q.code_value)=lower(v_code) and r.status='rejected');
 select * into v_item from public.item_positions p where p.project_id=p_project_id and lower(p.tag)=lower(v_code)
  order by (p.item_kind='material') desc limit 1;
 if not found then
  return jsonb_build_object('kind','unknown','code',v_code,'rejected_before',v_rejected,'can_receive',true);
 end if;
 return to_jsonb(v_item)||jsonb_build_object('kind',case when v_item.item_kind='material' then 'received' else v_item.status end,
  'code',v_item.tag,'rejected_before',v_rejected,
  'can_receive',v_item.item_kind='count' and v_item.status in ('counted','expected') and v_item.position not in ('on_load','missing'));
end $$;
revoke all on function public.lookup_tag(uuid,text) from public,anon;
grant execute on function public.lookup_tag(uuid,text) to authenticated;

COMMIT;

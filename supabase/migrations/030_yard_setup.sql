-- Yard setup from the office screens. Racks can be retired and belong to a
-- yard or site; a yard's name is unique within its project, not across all
-- of them; a yard, rack, site plan or area can't go out of use while stock
-- is still recorded there; and each project reports what it still needs
-- before work can start.
--
-- Works with the site and the app already published: both read racks with
-- every column and add them with zone, row, rack, hold area and capacity
-- only, so the new columns take their defaults. What they newly meet is a
-- refusal, each a plain sentence they show as it is:
--  * a retired rack still shows in an older picker; choosing it is refused
--    (22023, which the app keeps as "needs a decision");
--  * adding a rack whose zone, row and rack an active rack of the project
--    already has is refused (23505), as is a capacity below 1 or a name over
--    60 characters (22023). Before, such a rack was added.
BEGIN;

-- ---------------------------------------------------------------------------
-- Racks: an active flag, the yard or site they are at, and when they changed.
-- ---------------------------------------------------------------------------
alter table public.locations
 add column is_active boolean not null default true,
 add column place_id uuid references public.places(id),
 add column updated_at timestamptz not null default now();
create index locations_place on public.locations(place_id) where place_id is not null;
create trigger locations_updated_at before update on public.locations
 for each row execute function public.update_updated_at_column();
-- Racks are retired, never deleted.
revoke delete,truncate on public.locations from anon,authenticated;

-- "T1 · Row 1, Rack 2", as every screen names a rack.
create function public.rack_label(p_zone text,p_row text,p_rack text) returns text
language sql immutable set search_path=pg_catalog as $$
 select p_zone||' · Row '||p_row||', Rack '||p_rack
$$;

-- "1 crate", "3 crates", or nothing for none; and "a, b and c".
create function public.count_phrase(p_count bigint,p_one text,p_many text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when p_count=1 then '1 '||p_one when p_count>1 then p_count::text||' '||p_many end
$$;
create function public.list_phrase(p_parts text[]) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when n=0 then null when n=1 then parts[1] else array_to_string(parts[1:n-1],', ')||' and '||parts[n] end
 from (select array_remove(p_parts,null) as parts,coalesce(cardinality(array_remove(p_parts,null)),0) as n) s
$$;

-- What the screens show as being somewhere now: crates standing there (the
-- outermost ones, not on a truck) and loose items (item_positions, the one
-- answer every screen gives). A rack holds loose items only. Each filter that
-- is null is left out.
create function public.stock_recorded(p_project_id uuid,p_place_id uuid,p_map_id uuid,p_zone_ids uuid[],p_location_id uuid,
 out crates bigint,out items bigint)
language sql stable security definer set search_path=public as $$
 select
  (select count(*) from public.handling_units u
    where p_location_id is null and u.parent_id is null and u.status in ('open','sealed','delivered')
     and (p_project_id is null or u.project_id=p_project_id) and (p_place_id is null or u.place_id=p_place_id)
     and (p_map_id is null or u.site_map_id=p_map_id) and (p_zone_ids is null or u.zone_id=any(p_zone_ids))),
  (select count(*) from public.item_positions i
    where i.position='at_place' and i.crate_id is null
     and (p_project_id is null or i.project_id=p_project_id) and (p_place_id is null or i.place_id=p_place_id)
     and (p_map_id is null or i.site_map_id=p_map_id) and (p_zone_ids is null or i.zone_id=any(p_zone_ids))
     and (p_location_id is null or i.location_id=p_location_id))
$$;

-- A rack's names are tidy and unique among its project's active racks (a
-- check, not an index: older data has repeats, which stay until one is
-- renamed or retired). Its yard is one the project can use. It can't be
-- retired while items are on it or an active area is linked to it.
create function public.location_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_renamed boolean; v_place public.places; v_area text; v_at text; v_items bigint; v_label text;
begin
 if tg_op='UPDATE' and new.project_id is distinct from old.project_id then
  raise exception 'A rack stays in its project' using errcode='22023';
 end if;
 -- Tidy first, so a stray space typed onto an unchanged name is not a rename.
 if tg_op='INSERT' or new.zone is distinct from old.zone or new."row" is distinct from old."row" or new.rack is distinct from old.rack then
  new.zone:=btrim(new.zone); new."row":=btrim(new."row"); new.rack:=btrim(new.rack);
 end if;
 v_renamed:=tg_op='INSERT' or new.zone is distinct from old.zone or new."row" is distinct from old."row" or new.rack is distinct from old.rack;
 if v_renamed then
  if coalesce(new.zone,'')='' or coalesce(new."row",'')='' or coalesce(new.rack,'')='' then
   raise exception 'Enter the zone, row and rack' using errcode='22023';
  end if;
  if length(new.zone)>60 or length(new."row")>60 or length(new.rack)>60 then
   raise exception 'Zone, row and rack can be 60 characters at most' using errcode='22023';
  end if;
 end if;
 v_label:=public.rack_label(new.zone,new."row",new.rack);
 if (tg_op='INSERT' or new.capacity is distinct from old.capacity) and new.capacity is not null and new.capacity not between 1 and 1000000 then
  raise exception 'Capacity is a whole number from 1 to 1,000,000, or blank' using errcode='22023';
 end if;
 if new.is_active and (v_renamed or not old.is_active) then
  perform pg_advisory_xact_lock(hashtextextended('locations:'||new.project_id::text,0));
  if exists(select 1 from public.locations l where l.project_id=new.project_id and l.is_active and l.id<>new.id
    and lower(l.zone)=lower(new.zone) and lower(l."row")=lower(new."row") and lower(l.rack)=lower(new.rack)) then
   raise exception 'Another active rack is already called %',v_label using errcode='23505';
  end if;
 end if;
 if new.place_id is not null and (tg_op='INSERT' or new.place_id is distinct from old.place_id) then
  select * into v_place from public.places p where p.id=new.place_id;
  if not found or v_place.kind not in ('yard','site') or (v_place.project_id is not null and v_place.project_id<>new.project_id) then
   raise exception 'A rack is at one of this project''s yards or sites' using errcode='42501';
  end if;
  if not v_place.is_active then
   raise exception 'That place is retired; restore it or choose another' using errcode='22023';
  end if;
  select public.site_map_zone_path(z.id),p.name into v_area,v_at
  from public.site_map_zones z join public.site_maps m on m.id=z.map_id join public.places p on p.id=m.place_id
  where z.location_id=new.id and z.is_active and m.place_id<>new.place_id limit 1;
  if found then
   raise exception '% is linked to the area %, on a plan of %; choose that place, or set the area to No rack first',v_label,v_area,v_at using errcode='22023';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.item_positions i where i.project_id=new.project_id and i.position='at_place' and i.crate_id is null
    and i.location_id=new.id and i.place_id is not null and i.place_id<>new.place_id) then
   raise exception '% holds items recorded at another place; move them first',v_label using errcode='22023';
  end if;
 end if;
 if tg_op='UPDATE' and old.is_active and not new.is_active then
  select s.items into v_items from public.stock_recorded(old.project_id,null,null,null,old.id) s;
  if v_items>0 then
   raise exception '% can''t be retired yet: it still holds %; move them to another rack first',v_label,
    public.count_phrase(v_items,'item','items') using errcode='22023';
  end if;
  select public.site_map_zone_path(z.id) into v_area from public.site_map_zones z where z.location_id=old.id and z.is_active limit 1;
  if found then
   raise exception '% can''t be retired yet: it is linked to the area %; on Site Maps, set that area to No rack first',v_label,v_area using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger locations_guard before insert or update on public.locations
 for each row execute function public.location_guard();

-- Every change to a rack is in the audit log. An item packed in a crate or
-- riding on a load isn't on a rack, though its record may still name the one
-- it came from; it must not come back to a retired rack, so retiring takes
-- that link away and the rack's entry lists the items (unlinked_items).
create function public.location_audit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_unlinked jsonb;
begin
 if tg_op='UPDATE' and old.is_active and not new.is_active then
  with cleared as (
   update public.materials m set location_id=null where m.location_id=new.id and m.status='in_yard' returning m.id,m.qr_code_id)
  select jsonb_agg(jsonb_build_object('material_id',c.id,'tag',q.code_value) order by q.code_value) into v_unlinked
  from cleared c left join public.qr_codes q on q.id=c.qr_code_id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
 values(auth.uid(),case when tg_op='INSERT' then 'rack_created' else 'rack_updated' end,'rack',new.id,
  jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) end,'after',to_jsonb(new))
   ||case when v_unlinked is not null then jsonb_build_object('unlinked_items',v_unlinked) else '{}'::jsonb end,new.project_id);
 return null;
end $$;
create trigger locations_audit after insert or update on public.locations
 for each row execute function public.location_audit();

-- Nothing new goes on a retired rack: not a receipt, a move or a correction.
create function public.retired_rack_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.location_id is not null and (tg_op='INSERT' or new.location_id is distinct from old.location_id)
   and exists(select 1 from public.locations l where l.id=new.location_id and not l.is_active) then
  raise exception 'That rack is retired; choose another rack' using errcode='22023';
 end if;
 return new;
end $$;
create trigger materials_rack_guard before insert or update of location_id on public.materials
 for each row execute function public.retired_rack_guard();
create trigger receiving_records_rack_guard before insert or update of location_id on public.receiving_records
 for each row execute function public.retired_rack_guard();

-- ---------------------------------------------------------------------------
-- Places. A yard or site's name is unique within its project; shared places
-- are unique among themselves; and no project's place shares a name with a
-- shared one, so a name never means two places to the same crew.
-- ---------------------------------------------------------------------------
drop index public.places_active_name;
create unique index places_active_project_name on public.places(project_id,lower(name)) where is_active and project_id is not null;
create unique index places_active_shared_name on public.places(lower(name)) where is_active and project_id is null;

-- A project using a place now includes one with active racks there, so
-- another project's office can't claim or change it (022's place_guard).
create or replace function public.place_users(p_place_id uuid) returns table(project_id uuid)
language sql stable security definer set search_path=public as $$
 select l.project_id from public.loads l where l.origin_place_id=p_place_id and l.status not in ('closed','cancelled')
 union select s.project_id from public.load_stops s join public.loads l on l.id=s.load_id
  where s.place_id=p_place_id and s.status<>'cancelled' and l.status not in ('closed','cancelled')
 union select u.project_id from public.handling_units u where u.place_id=p_place_id and u.status not in ('unpacked','written_off')
 union select m.project_id from public.materials m where m.place_id=p_place_id and m.status='in_yard'
 union select i.project_id from public.inventory_records i where i.place_id=p_place_id and i.count_status<>'received' and i.written_off_at is null
 union select m.project_id from public.site_maps m where m.place_id=p_place_id and m.is_active
 union select r.project_id from public.locations r where r.place_id=p_place_id and r.is_active
$$;

-- A place stays a yard or site while racks or plans hang off it, and can't
-- be retired while anything is still there: stock, an open load that starts
-- or stops there, an active rack or an active site plan.
create function public.place_setup_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_stock record; v_loads bigint; v_racks bigint; v_plans bigint; v_left text;
begin
 if new.is_active and (tg_op='INSERT' or not old.is_active or lower(new.name)<>lower(old.name) or new.project_id is distinct from old.project_id) then
  perform pg_advisory_xact_lock(hashtextextended('places:names',0));
  if exists(select 1 from public.places p where p.id<>new.id and p.is_active and lower(p.name)=lower(new.name)
    and (p.project_id is null)<>(new.project_id is null)) then
   raise exception 'Another active place is already called %',new.name using errcode='23505';
  end if;
 end if;
 if tg_op='INSERT' then return new; end if;
 select count(*) into v_racks from public.locations l where l.place_id=old.id and l.is_active;
 select count(*) into v_plans from public.site_maps m where m.place_id=old.id and m.is_active;
 if old.kind in ('yard','site') and new.kind not in ('yard','site') and v_racks+v_plans>0 then
  raise exception '% stays a yard or site while it has %',old.name,
   public.list_phrase(array[public.count_phrase(v_racks,'active rack','active racks'),public.count_phrase(v_plans,'active site plan','active site plans')])
   using errcode='22023';
 end if;
 if old.is_active and not new.is_active then
  select * into v_stock from public.stock_recorded(null,old.id,null,null,null);
  select count(*) into v_loads from public.loads l where l.status not in ('closed','cancelled')
   and (l.origin_place_id=old.id or exists(select 1 from public.load_stops s where s.load_id=l.id and s.place_id=old.id and s.status<>'cancelled'));
  v_left:=public.list_phrase(array[public.count_phrase(v_stock.crates,'crate','crates'),public.count_phrase(v_stock.items,'loose item','loose items'),
   public.count_phrase(v_loads,'open load','open loads'),public.count_phrase(v_racks,'active rack','active racks'),
   public.count_phrase(v_plans,'active site plan','active site plans')]);
  if v_left is not null then
   raise exception '% can''t be retired yet: it still has %',old.name,v_left using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger places_setup_guard before insert or update of name,kind,project_id,is_active on public.places
 for each row execute function public.place_setup_guard();

-- ---------------------------------------------------------------------------
-- Site plans and areas. Neither goes out of use while crates or loose items
-- are recorded there. An area's rack is an active one at the plan's place.
-- ---------------------------------------------------------------------------
create function public.site_map_setup_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_stock record; v_left text; v_rack text; v_at text;
begin
 if old.is_active and not new.is_active then
  select * into v_stock from public.stock_recorded(old.project_id,null,old.id,null,null);
  v_left:=public.list_phrase(array[public.count_phrase(v_stock.crates,'crate','crates'),public.count_phrase(v_stock.items,'loose item','loose items')]);
  if v_left is not null then
   raise exception '% can''t be made inactive yet: it still has % recorded on it; move them first',old.name,v_left using errcode='22023';
  end if;
 end if;
 if new.place_id is not null and new.place_id is distinct from old.place_id then
  select public.rack_label(l.zone,l."row",l.rack),p.name into v_rack,v_at
  from public.site_map_zones z join public.locations l on l.id=z.location_id join public.places p on p.id=l.place_id
  where z.map_id=new.id and z.is_active and l.place_id<>new.place_id limit 1;
  if found then
   raise exception 'An area of this plan is linked to %, a rack at %; move that rack or set the area to No rack first',v_rack,v_at using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger site_maps_setup_guard before update of is_active,place_id on public.site_maps
 for each row execute function public.site_map_setup_guard();

create function public.site_map_zone_setup_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rack public.locations; v_place uuid; v_ids uuid[]; v_stock record; v_left text;
begin
 if new.location_id is not null and new.is_active and (tg_op='INSERT' or new.location_id is distinct from old.location_id or not old.is_active
   or new.map_id is distinct from old.map_id) then
  select * into v_rack from public.locations l where l.id=new.location_id;
  if found and not v_rack.is_active then
   raise exception '% is retired; restore it on the Racks page or choose another rack',public.rack_label(v_rack.zone,v_rack."row",v_rack.rack)
    using errcode='22023';
  end if;
  select m.place_id into v_place from public.site_maps m where m.id=new.map_id;
  if v_rack.place_id is not null and v_place is not null and v_rack.place_id<>v_place then
   raise exception '% is at %, which is not the place this plan draws',public.rack_label(v_rack.zone,v_rack."row",v_rack.rack),
    (select p.name from public.places p where p.id=v_rack.place_id) using errcode='22023';
  end if;
 end if;
 if tg_op='UPDATE' and old.is_active and not new.is_active then
  -- This area and the active ones inside it, which go out of use with it.
  with recursive down(id) as (
   select old.id
   union all select z.id from public.site_map_zones z join down on z.parent_id=down.id where z.is_active)
  select array_agg(id) into v_ids from down;
  select * into v_stock from public.stock_recorded(old.project_id,null,null,v_ids,null);
  v_left:=public.list_phrase(array[public.count_phrase(v_stock.crates,'crate','crates'),public.count_phrase(v_stock.items,'loose item','loose items')]);
  if v_left is not null then
   raise exception '% can''t be made inactive yet: it still has % recorded there; move them first',public.site_map_zone_path(old.id),v_left
    using errcode='22023';
  end if;
 end if;
 return new;
end $$;
create trigger site_map_zones_setup_guard before insert or update of location_id,is_active,map_id on public.site_map_zones
 for each row execute function public.site_map_zone_setup_guard();

-- ---------------------------------------------------------------------------
-- Views. Each rack with its area (022) now also says whether the rack is
-- active and which yard it is at. The yard overview lists active racks only.
-- ---------------------------------------------------------------------------
create or replace view public.location_areas with (security_invoker=true) as
select l.id as location_id,l.project_id,l.zone as rack_zone,l."row" as rack_row,l.rack,l.is_hold_area,
 z.id as zone_id,z.map_id as site_map_id,public.site_map_zone_path(z.id) as area,m.place_id,p.name as place_name,
 l.is_active as rack_active,l.place_id as rack_place_id,rp.name as rack_place_name
from public.locations l
left join public.site_map_zones z on z.location_id=l.id and z.is_active
left join public.site_maps m on m.id=z.map_id
left join public.places p on p.id=m.place_id
left join public.places rp on rp.id=l.place_id;

create or replace view public.v_yard_overview with (security_invoker=true) as
select
  l.id as location_id,
  l.project_id,
  l.zone,
  l.row,
  l.rack,
  l.is_hold_area,
  l.capacity,
  count(m.id) as items_stored,
  coalesce(sum(m.current_quantity), 0) as total_quantity
from public.locations l
left join public.materials m on m.location_id = l.id and m.status = 'in_yard'
where l.is_active
group by l.id, l.project_id, l.zone, l.row, l.rack, l.is_hold_area, l.capacity;

-- ---------------------------------------------------------------------------
-- What a project has of what it needs before work can start: a yard or site
-- (its own, or a shared one it has racks or a site plan at; shared ones that
-- exist are counted apart), racks, a hold-area rack and a site plan. Office
-- staff see their projects; administrators see every project that isn't
-- archived, and whether they are assigned to it.
-- ---------------------------------------------------------------------------
create function public.project_setup_status(p_project_id uuid default null)
returns table(project_id uuid,is_member boolean,own_yards integer,shared_yards integer,shared_yards_used integer,racks integer,hold_racks integer,site_plans integer)
language sql stable security definer set search_path=public as $$
 select p.id,public.has_project_access(p.id),
  (select count(*) from public.places y where y.project_id=p.id and y.kind in ('yard','site') and y.is_active)::integer,
  (select count(*) from public.places y where y.project_id is null and y.kind in ('yard','site') and y.is_active)::integer,
  (select count(*) from public.places y where y.project_id is null and y.kind in ('yard','site') and y.is_active
    and (exists(select 1 from public.locations l where l.place_id=y.id and l.project_id=p.id and l.is_active)
     or exists(select 1 from public.site_maps m where m.place_id=y.id and m.project_id=p.id and m.is_active)))::integer,
  (select count(*) from public.locations l where l.project_id=p.id and l.is_active)::integer,
  (select count(*) from public.locations l where l.project_id=p.id and l.is_active and l.is_hold_area)::integer,
  (select count(*) from public.site_maps m where m.project_id=p.id and m.is_active)::integer
 from public.projects p
 where p.status<>'archived' and (p_project_id is null or p.id=p_project_id)
  and public.is_office_user() and (public.is_admin(auth.uid()) or public.has_project_access(p.id))
$$;
revoke all on function public.project_setup_status(uuid) from public,anon;
grant execute on function public.project_setup_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rack changes are setup, kept in the audit log for the office. They stay out
-- of the project activity feed crews read, which is otherwise as in 026.
-- ---------------------------------------------------------------------------
create or replace function public.list_project_activity(p_project_id uuid,p_before timestamptz default null,p_limit integer default 50)
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
   -- 026: a shipment is named by its number; its id is in the details, read only when it is a plain number, so no
   -- entry can fail the feed and the lookup uses the key.
   when 'shipment' then (select s.shipment_number from public.shipments s
    where s.id=case when a.details->>'shipment_id' ~ '^[0-9]{1,18}$' then (a.details->>'shipment_id')::bigint end and s.project_id=a.project_id)
  end,
  coalesce((select jsonb_object_agg(k.key,k.value) from jsonb_each(coalesce(a.details,'{}'::jsonb)) k
   where k.key in ('tag','code','created','added','removed','qty','accepted_qty','status','items_released','units_released','pieces','on','undone',
    'confirmed','delivered','missing','not_loaded','not_picked_up','corrected','moved_from','reason','stop_id','line_id','write_off_id',
    'tracker_name','moved_from_shipment_number')),'{}'::jsonb)
 from public.audit_log a left join public.users u on u.id=a.user_id
 where a.project_id=p_project_id and public.has_project_access(p_project_id)
  and a.action not like 'driver_licence%' and a.entity_type<>'rack' and (p_before is null or a.created_at<p_before)
 order by a.created_at desc
 limit least(greatest(coalesce(p_limit,50),1),200)
$$;
revoke all on function public.list_project_activity(uuid,timestamptz,integer) from public,anon;
grant execute on function public.list_project_activity(uuid,timestamptz,integer) to authenticated;

-- Helpers and trigger functions are for the database's own use.
revoke all on function public.rack_label(text,text,text),public.count_phrase(bigint,text,text),public.list_phrase(text[]),
 public.stock_recorded(uuid,uuid,uuid,uuid[],uuid),public.location_guard(),public.location_audit(),public.retired_rack_guard(),
 public.place_setup_guard(),public.site_map_setup_guard(),public.site_map_zone_setup_guard() from public,anon,authenticated;

COMMIT;

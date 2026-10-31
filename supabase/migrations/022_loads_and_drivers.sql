-- Loads, stops and drivers. A load is one outside carrier's truck trip: its
-- ordered stops, a manifest of crates and loose items, the driver, and up to
-- three companies between us and the driver. The driver's licence is kept
-- apart: only office staff can read it, it never goes into field_operations
-- (the audit log keeps only its last four characters), and it is removed 90
-- days after the load closes. Every other write goes through
-- apply_field_operation, which hands these actions to apply_logistics_operation.
BEGIN;

-- A crate that was on a truck but wasn't unloaded where expected is missing
-- until the office marks it found.
alter table public.handling_units drop constraint handling_units_status_check,
 add constraint handling_units_status_check check (status in ('open','sealed','on_load','delivered','unpacked','missing'));

-- ---------------------------------------------------------------------------
-- Loads: one truck trip, numbered L-0001 upwards in each project. The driver's
-- name and phone are on the load so anyone on the project can call them.
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
 notes text check (length(notes)<=2000),
 created_by uuid references public.users(id),
 departed_by uuid references public.users(id),
 departed_at timestamptz,
 delivered_at timestamptz,
 closed_by uuid references public.users(id),
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint loads_project_number unique (project_id,load_number),
 constraint loads_departed check (status in ('planning','loading','cancelled') or departed_at is not null),
 constraint loads_finished check ((status in ('closed','cancelled'))=(closed_at is not null))
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
-- until it is found.
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
 status text not null default 'planned' check (status in ('planned','on_board','delivered','missing','not_loaded','removed')),
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

-- Members read; every write goes through apply_field_operation.
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['loads','load_companies','load_stops','load_lines'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON public.%I FROM anon,authenticated',t);
  EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING(public.has_project_access(project_id))',t);
 END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Driver licences. Anyone working the project can record one while the load
-- is open; only office staff can read them. Photos sit in the private
-- driver-licences bucket at <load id>/<name>.jpg.
-- ---------------------------------------------------------------------------
create table public.load_driver_licences (
 load_id uuid primary key references public.loads(id),
 project_id uuid not null references public.projects(id),
 licence_number text check (licence_number ~ '^[A-Z0-9][A-Z0-9 -]{2,39}$'),
 licence_state text check (length(licence_state)<=40),
 licence_expiry date,
 recorded_by uuid references public.users(id),
 recorded_at timestamptz not null default now(),
 last_operation_id uuid,
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

DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['load_driver_licences','driver_licence_photos'] LOOP
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

-- Writing needs work access to the load's project while the load is open
-- (office staff can still add to a closed one). Reading needs office access.
create function public.can_access_driver_licence_path(path text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare v_load public.loads;
begin
 select * into v_load from public.loads where id=split_part(path,'/',1)::uuid;
 if not found then return false; end if;
 return case when writing then public.can_work_project(v_load.project_id) and (v_load.status not in ('closed','cancelled') or public.is_office_user())
  else public.is_office_user() and public.has_project_access(v_load.project_id) end;
exception when invalid_text_representation then return false;
end $$;
-- Photos can be deleted only by office staff, once the load closed more than
-- 90 days ago.
create function public.can_remove_driver_licence_path(path text) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare v_load public.loads;
begin
 select * into v_load from public.loads where id=split_part(path,'/',1)::uuid;
 return found and public.is_office_user() and public.has_project_access(v_load.project_id) and v_load.closed_at<now()-interval '90 days';
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.can_access_driver_licence_path(text,boolean),public.can_remove_driver_licence_path(text) from public,anon;
grant execute on function public.can_access_driver_licence_path(text,boolean),public.can_remove_driver_licence_path(text) to authenticated;

CREATE POLICY driver_licence_scope_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'driver-licences' OR public.can_access_driver_licence_path(name,false));
CREATE POLICY driver_licence_scope_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'driver-licences' OR public.can_access_driver_licence_path(name,true));
CREATE POLICY driver_licence_scope_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'driver-licences' OR public.can_access_driver_licence_path(name,true))
 WITH CHECK(bucket_id<>'driver-licences' OR public.can_access_driver_licence_path(name,true));
CREATE POLICY driver_licence_scope_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'driver-licences' OR public.can_remove_driver_licence_path(name));
CREATE POLICY driver_licence_objects_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='driver-licences' AND public.can_access_driver_licence_path(name,false));
CREATE POLICY driver_licence_objects_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='driver-licences' AND public.can_access_driver_licence_path(name,true));
CREATE POLICY driver_licence_objects_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='driver-licences' AND public.can_access_driver_licence_path(name,true))
 WITH CHECK(bucket_id='driver-licences' AND public.can_access_driver_licence_path(name,true));
CREATE POLICY driver_licence_objects_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='driver-licences' AND public.can_remove_driver_licence_path(name));
CREATE POLICY driver_licence_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
 USING(bucket_id<>'driver-licences') WITH CHECK(bucket_id<>'driver-licences');

-- ---------------------------------------------------------------------------
-- Helpers for logistics operations. They have no access of their own and run
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

-- Crate labels are upper case; item tags are kept as written.
create function public.logistics_code(p_code text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when upper(btrim(coalesce(p_code,''))) ~ '^HU-' then upper(btrim(p_code)) else btrim(coalesce(p_code,'')) end
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

-- What a scanned code is: a top-level crate, or a loose received material or
-- counted item. A crate inside another crate, or an item packed in a crate,
-- travels with that crate, so it is refused. When loading, the item must
-- still be in the yard.
create function public.logistics_piece(p_project_id uuid,p_code text,p_loading boolean)
returns table(unit_id uuid,material_id uuid,inventory_uid uuid,tag text,unit_status text)
language plpgsql set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_code text:=public.logistics_code(p_code); v_unit public.handling_units; v_material public.materials;
 v_item public.inventory_records; v_holder text;
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
  return query select v_unit.id,null::uuid,null::uuid,v_unit.code,v_unit.status;
  return;
 end if;
 select m.* into v_material from public.materials m join public.qr_codes q on q.id=m.qr_code_id
  where q.code_value=v_code and m.project_id=p_project_id for update of m;
 if found then
  if p_loading and (v_material.status<>'in_yard' or v_material.current_quantity<=0) then
   raise exception '% has been issued or shipped; it can''t go on a load',v_code using errcode='22023';
  end if;
  select h.code into v_holder from public.handling_unit_contents c join public.handling_units h on h.id=c.unit_id
   where c.material_id=v_material.id and c.removed_at is null;
 else
  select * into v_item from public.inventory_records i where i.project_id=p_project_id and btrim(i.qr_code)=v_code for update;
  if not found or v_item.count_status<>'counted' then
   raise exception '% isn''t a crate label or a received or counted item in this project',v_code using errcode='22023';
  end if;
  select h.code into v_holder from public.handling_unit_contents c join public.handling_units h on h.id=c.unit_id
   where c.inventory_uid=v_item.uid and c.removed_at is null;
 end if;
 if v_holder is not null then
  raise exception '% is packed in %; load the crate instead',v_code,v_holder using errcode='22023';
 end if;
 return query select null::uuid,v_material.id,case when v_material.id is null then v_item.uid end,v_code,null::text;
end $$;

-- The piece's place on another open load, if any.
create function public.logistics_open_line(p_unit_id uuid,p_material_id uuid,p_inventory_uid uuid,p_except_load uuid)
returns table(line_id uuid,load_id uuid,load_number text,line_status text)
language sql stable set search_path=public as $$
 select x.id,x.load_id,l.load_number,x.status from public.load_lines x join public.loads l on l.id=x.load_id
 where x.status in ('planned','on_board','missing') and x.load_id is distinct from p_except_load
  and (x.unit_id=p_unit_id or x.material_id=p_material_id or x.inventory_uid=p_inventory_uid)
 limit 1
$$;

-- A crate (or the crate it sits in) that is on a truck or missing can't be
-- packed or unpacked.
create function public.logistics_unit_free(p_unit public.handling_units) returns void
language plpgsql set search_path=public,pg_temp as $$
declare v_top public.handling_units; v_number text;
begin
 v_top:=public.handling_unit_top(p_unit.id);
 if v_top.status not in ('on_load','missing') then return; end if;
 select o.load_number into v_number from public.logistics_open_line(v_top.id,null,null,null) o;
 if v_top.status='missing' then
  raise exception '% is missing from load %; the office marks it found first',v_top.code,coalesce(v_number,'?') using errcode='22023';
 end if;
 if v_top.id<>p_unit.id then
  raise exception '% is inside %, which is on load %; unload it first',p_unit.code,v_top.code,coalesce(v_number,'?') using errcode='22023';
 end if;
 raise exception '% is on load %; unload it first',p_unit.code,coalesce(v_number,'?') using errcode='22023';
end $$;

create function public.logistics_load_summary(p_load_id uuid) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object('load_id',l.id,'load_number',l.load_number,'status',l.status,
  'planned',count(x.id) filter (where x.status='planned'),'on_board',count(x.id) filter (where x.status='on_board'),
  'delivered',count(x.id) filter (where x.status='delivered'),'missing',count(x.id) filter (where x.status='missing'))
 from public.loads l left join public.load_lines x on x.load_id=l.id where l.id=p_load_id group by l.id
$$;

-- ---------------------------------------------------------------------------
-- Packing, as in 021, except a crate on a truck or missing (or inside one)
-- can't be packed or unpacked, a planned crate can't go inside another crate
-- or be unpacked, an item on a load can't be packed, and a delivered crate can
-- be repacked, unpacked or put in another crate.
-- ---------------------------------------------------------------------------
create function public.logistics_pack(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_code text; v_qr public.qr_codes; v_unit public.handling_units; v_top public.handling_units; v_child public.handling_units;
 v_material public.materials; v_item public.inventory_records; v_existing public.handling_unit_contents;
 v_before jsonb; v_created boolean:=false; v_tag text; v_kind text; v_added text[]:='{}'; v_removed text[]:='{}'; v_load text;
 v_place_id uuid; v_map_id uuid; v_zone_id uuid; v_zone_map uuid; v_seal boolean; v_items integer; v_units integer; result jsonb;
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
   if v_child.status not in ('open','sealed','delivered') then
    raise exception '% is %; it can''t go inside another crate',v_child.code,replace(v_child.status,'_',' ') using errcode='22023';
   end if;
   select o.load_number into v_load from public.logistics_open_line(v_child.id,null,null,null) o;
   if v_load is not null then
    raise exception '% is planned on load %; take it off the load first',v_child.code,v_load using errcode='22023';
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
   select o.load_number into v_load from public.logistics_open_line(null,v_material.id,case when v_material.id is null then v_item.uid end,null) o;
   if v_load is not null then
    raise exception '% is on load %; take it off the load first',v_tag,v_load using errcode='22023';
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
 return result;
end $$;

create function public.logistics_unpack(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_code text; v_unit public.handling_units; v_top public.handling_units; v_before jsonb; v_load text; v_items integer; v_units integer; result jsonb;
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
 return result;
end $$;

-- ---------------------------------------------------------------------------
-- load_save: create a load or change its details, driver, companies and
-- stops. {loadId (made by the caller, so offline steps can name it),
-- originPlaceId?, plannedDate?, truckType?, truckNumber?, trailerNumber?,
-- bolNumber?, notes?, driverName?, driverPhone?,
-- companies?: [{name, role?, contactName?, phone?}] (up to 3; replaces the list),
-- stops?: [{id, placeId, kind?, plannedDate?}] (replaces the list; only
-- before the truck leaves)}. Only the keys sent are changed.
-- ---------------------------------------------------------------------------
create function public.logistics_load_save(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_id uuid; v_load public.loads; v_before jsonb; v_created boolean:=false; v_number integer;
 v_origin uuid; v_planned date; v_truck_type text; v_truck_number text; v_trailer text; v_bol text; v_notes text; v_driver text; v_phone text;
 v_list jsonb; v_elem jsonb; v_place public.places; v_stop public.load_stops; v_stop_id uuid; v_kind text; v_name text; v_stop_date date;
 v_ids uuid[]:='{}'; v_companies_before jsonb; i integer;
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

 select * into v_load from public.loads where id=v_id for update;
 if not found then
  -- Numbers take turns per project.
  perform pg_advisory_xact_lock(hashtextextended('loads:'||p_project_id::text,0));
  select coalesce(max(substring(l.load_number from 3)::integer),0)+1 into v_number from public.loads l where l.project_id=p_project_id;
  insert into public.loads(id,project_id,load_number,origin_place_id,planned_date,truck_type,truck_number,trailer_number,bol_number,notes,driver_name,driver_phone,created_by)
  values(v_id,p_project_id,'L-'||lpad(v_number::text,4,'0'),v_origin,v_planned,v_truck_type,v_truck_number,v_trailer,v_bol,v_notes,v_driver,v_phone,p_actor)
  returning * into v_load;
  v_created:=true;
 else
  if v_load.project_id<>p_project_id then raise exception 'That load isn''t in this project' using errcode='42501'; end if;
  if v_load.status in ('closed','cancelled') then
   raise exception 'Load % is %; it can''t change',v_load.load_number,v_load.status using errcode='22023';
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
   driver_phone=case when p_payload ? 'driverPhone' then v_phone else l.driver_phone end
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
  if v_load.status not in ('planning','loading') then
   raise exception 'Load % has left; its stops can''t change',v_load.load_number using errcode='22023';
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
   v_place:=public.logistics_place(p_project_id,public.logistics_id(v_elem,'placeId','Place'));
   v_kind:=coalesce(nullif(v_elem->>'kind',''),'dropoff');
   if v_kind not in ('dropoff','pickup','both') then
    raise exception 'A stop is a drop-off, a pick-up or both' using errcode='22023';
   end if;
   v_stop_date:=public.logistics_date(v_elem,'plannedDate','Stop date');
   select * into v_stop from public.load_stops where id=v_stop_id for update;
   if found then
    if v_stop.load_id<>v_load.id then raise exception 'That stop belongs to another load' using errcode='42501'; end if;
    update public.load_stops set seq=i+1,place_id=v_place.id,kind=v_kind,planned_date=v_stop_date,status='pending' where id=v_stop_id;
   else
    insert into public.load_stops(id,project_id,load_id,seq,place_id,kind,planned_date)
    values(v_stop_id,p_project_id,v_load.id,i+1,v_place.id,v_kind,v_stop_date);
   end if;
  end loop;
  -- Stops left out are cancelled, unless pieces still need them.
  for v_stop in select * from public.load_stops s where s.load_id=v_load.id and s.status<>'cancelled' and not (s.id=any(v_ids)) for update loop
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
 end if;

 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_saved','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'created',v_created,'before',v_before,'after',to_jsonb(v_load),
   'companies_before',v_companies_before,'stops_changed',p_payload ? 'stops'),p_project_id);
 return jsonb_build_object('id',v_load.id,'load_number',v_load.load_number,'status',v_load.status,'created',v_created);
end $$;

-- load_plan: plan pieces before the truck leaves. {loadId,
-- add?: [{code, dropoffStopId, pickupStopId?}], remove?: [code]}.
create function public.logistics_load_plan(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_piece record; v_line public.load_lines; v_has boolean; v_drop public.load_stops; v_pick public.load_stops;
 v_list jsonb; v_elem jsonb; v_code text; v_other text; v_added text[]:='{}'; v_removed text[]:='{}'; i integer;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status not in ('planning','loading') then
  raise exception 'Load % has left; its plan can''t change',v_load.load_number using errcode='22023';
 end if;
 for v_code in select public.logistics_code(e) from jsonb_array_elements_text(public.logistics_list(p_payload,'remove','pieces to take off the plan')) e loop
  select * into v_line from public.load_lines x where x.load_id=v_load.id and x.tag=v_code and x.status in ('planned','on_board') for update;
  if not found then raise exception '% isn''t planned on load %',v_code,v_load.load_number using errcode='22023'; end if;
  if v_line.status='on_board' then raise exception '% is on the truck; take it off the truck first',v_code using errcode='22023'; end if;
  update public.load_lines set status='removed' where id=v_line.id;
  v_removed:=v_removed||v_code;
 end loop;
 v_list:=public.logistics_list(p_payload,'add','pieces to plan');
 for i in 0..jsonb_array_length(v_list)-1 loop
  v_elem:=v_list->i;
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
  v_has:=found;
  if v_has then
   update public.load_lines set dropoff_stop_id=v_drop.id,pickup_stop_id=v_pick.id where id=v_line.id;
  else
   select o.load_number into v_other from public.logistics_open_line(v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_load.id) o;
   if v_other is not null then raise exception '% is already on load %',v_piece.tag,v_other using errcode='22023'; end if;
   if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
    raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
   end if;
   insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,pickup_stop_id,dropoff_stop_id,planned_by)
   values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_pick.id,v_drop.id,p_actor);
  end if;
  v_added:=v_added||v_piece.tag;
 end loop;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_planned','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'added',to_jsonb(v_added),'removed',to_jsonb(v_removed)),p_project_id);
 return public.logistics_load_summary(v_load.id);
end $$;

-- load_on: scan pieces onto the truck. {loadId, stopId? (a pick-up stop
-- once the truck has left; none means at the start), pieces: [code or
-- {code, dropoffStopId}], undo?: [code]}. A piece that wasn't planned needs a
-- drop-off stop.
create function public.logistics_load_on(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_at public.load_stops; v_piece record; v_line public.load_lines; v_has boolean; v_drop public.load_stops;
 v_list jsonb; v_elem jsonb; v_code text; v_other text; v_on text[]:='{}'; v_off text[]:='{}'; i integer;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 v_at:=null;
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
  raise exception 'Load % has left; choose the pick-up stop you''re at',v_load.load_number using errcode='22023';
 end if;

 -- Undo first, so a mistaken scan can be fixed in the same save.
 for v_code in select public.logistics_code(e) from jsonb_array_elements_text(public.logistics_list(p_payload,'undo','pieces to take off')) e loop
  select * into v_line from public.load_lines x where x.load_id=v_load.id and x.tag=v_code and x.status='on_board' for update;
  if not found then raise exception '% isn''t on the truck',v_code using errcode='22023'; end if;
  if v_line.pickup_stop_id is distinct from v_at.id then
   raise exception '% was loaded somewhere else; it comes off at a stop',v_code using errcode='22023';
  end if;
  update public.load_lines set status=case when added_in_field then 'removed' else 'planned' end,on_by=null,on_at=null,unit_status_before=null
   where id=v_line.id;
  if v_line.unit_id is not null then
   update public.handling_units set status=coalesce(v_line.unit_status_before,'sealed') where id=v_line.unit_id;
  end if;
  v_off:=v_off||v_code;
 end loop;

 v_list:=public.logistics_list(p_payload,'pieces','pieces');
 for i in 0..jsonb_array_length(v_list)-1 loop
  v_elem:=v_list->i;
  if jsonb_typeof(v_elem)='string' then
   v_elem:=jsonb_build_object('code',v_elem#>>'{}');
  elsif jsonb_typeof(v_elem)<>'object' then
   raise exception 'Each piece needs a code' using errcode='22023';
  end if;
  select * into v_piece from public.logistics_piece(p_project_id,v_elem->>'code',true);
  select * into v_line from public.load_lines x where x.load_id=v_load.id and x.status in ('planned','on_board')
   and (x.unit_id=v_piece.unit_id or x.material_id=v_piece.material_id or x.inventory_uid=v_piece.inventory_uid) for update;
  v_has:=found;
  continue when v_has and v_line.status='on_board';
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
  if v_drop.status='done' then
   raise exception '% is already done; choose a later stop for %',public.logistics_stop_name(v_drop),v_piece.tag using errcode='22023';
  end if;
  if v_at.id is not null and v_drop.seq<=v_at.seq then
   raise exception '% has to come off at a stop after this one',v_piece.tag using errcode='22023';
  end if;
  if v_piece.unit_id is not null and v_piece.unit_status not in ('open','sealed','delivered') then
   raise exception '% is %; it can''t go on a load',v_piece.tag,replace(v_piece.unit_status,'_',' ') using errcode='22023';
  end if;
  if v_has then
   update public.load_lines set status='on_board',dropoff_stop_id=v_drop.id,pickup_stop_id=v_at.id,unit_status_before=v_piece.unit_status,
    on_by=p_actor,on_at=now() where id=v_line.id;
  else
   select o.load_number into v_other from public.logistics_open_line(v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_load.id) o;
   if v_other is not null then raise exception '% is already on load %',v_piece.tag,v_other using errcode='22023'; end if;
   insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,pickup_stop_id,dropoff_stop_id,status,added_in_field,
    unit_status_before,planned_by,on_by,on_at)
   values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_at.id,v_drop.id,'on_board',true,
    v_piece.unit_status,p_actor,p_actor,now());
  end if;
  if v_piece.unit_id is not null then
   update public.handling_units set status='on_load' where id=v_piece.unit_id;
  end if;
  v_on:=v_on||v_piece.tag;
 end loop;

 if v_load.status='planning' and exists(select 1 from public.load_lines x where x.load_id=v_load.id and x.status='on_board') then
  update public.loads set status='loading' where id=v_load.id;
 end if;
 if v_at.id is not null and v_at.status='pending' then
  update public.load_stops set status='arrived',arrived_at=now(),arrived_source='scan' where id=v_at.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_loaded','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_at.id,'on',to_jsonb(v_on),'undone',to_jsonb(v_off)),p_project_id);
 return public.logistics_load_summary(v_load.id);
end $$;

-- load_depart: the truck leaves. {loadId, confirmAll? (office only: mark
-- every planned piece loaded without scanning, for a load leaving a place
-- with nobody to scan)}. Needs the driver's name and something on board.
-- Planned pieces that didn't go on are left behind.
create function public.logistics_load_depart(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_line public.load_lines; v_piece record; v_confirm boolean; v_confirmed integer:=0; v_left integer;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status not in ('planning','loading') then
  raise exception 'Load % has already left',v_load.load_number using errcode='22023';
 end if;
 v_confirm:=public.logistics_flag(p_payload,'confirmAll','Confirm all');
 if v_confirm and not public.is_office_user() then
  raise exception 'Only office staff can mark pieces loaded without scanning them' using errcode='42501';
 end if;
 if v_load.driver_name is null then
  raise exception 'Add the driver''s name before load % leaves',v_load.load_number using errcode='22023';
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
 update public.loads set status='in_transit',departed_at=now(),departed_by=p_actor where id=v_load.id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_departed','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'confirmed',v_confirmed,'not_loaded',v_left),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('not_loaded',v_left);
end $$;

-- load_off: scan pieces off at a stop. {loadId, stopId, pieces: [code],
-- zoneId?, siteMapId? (only at this project's own yard or site)}. The first
-- scan marks the stop arrived. A piece due somewhere else is flagged
-- wrong_stop; one the records didn't have on the truck is flagged extra.
create function public.logistics_load_off(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
 v_load public.loads; v_stop public.load_stops; v_place public.places; v_piece record; v_line public.load_lines; v_has boolean;
 v_other text; v_flag text; v_code text; v_map_id uuid; v_zone_id uuid; v_zone_map uuid; v_location text;
 v_done integer:=0; v_extra integer:=0; v_wrong integer:=0; v_tags text[]:='{}';
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status in ('planning','loading') then
  raise exception 'Load % hasn''t left yet',v_load.load_number using errcode='22023';
 end if;
 if v_load.status<>'in_transit' then raise exception 'Load % is finished',v_load.load_number using errcode='22023'; end if;
 v_stop:=public.logistics_stop(v_load,public.logistics_id(p_payload,'stopId','Stop'),'the stop the pieces come off at');
 select * into v_place from public.places where id=v_stop.place_id;
 v_map_id:=public.logistics_id(p_payload,'siteMapId','Site plan');
 v_zone_id:=public.logistics_id(p_payload,'zoneId','Area');
 if v_zone_id is not null then
  if v_place.project_id is distinct from p_project_id then
   raise exception 'Areas can only be chosen at this project''s own yard or site' using errcode='22023';
  end if;
  select z.map_id into v_zone_map from public.site_map_zones z where z.id=v_zone_id and z.project_id=p_project_id and (v_map_id is null or z.map_id=v_map_id);
  if not found then raise exception 'Zone is unavailable on this map' using errcode='42501'; end if;
  if not public.site_map_zone_is_live(v_zone_id) or not exists(select 1 from public.site_maps m where m.id=v_zone_map and m.is_active) then
   raise exception 'This area is no longer in use; choose another' using errcode='22023';
  end if;
  v_location:=public.site_map_zone_path(v_zone_id);
 end if;
 if v_stop.status='pending' then
  update public.load_stops set status='arrived',arrived_at=now(),arrived_source='scan' where id=v_stop.id returning * into v_stop;
 end if;
 for v_code in select e from jsonb_array_elements_text(public.logistics_list(p_payload,'pieces','pieces')) e loop
  select * into v_piece from public.logistics_piece(p_project_id,v_code,false);
  select * into v_line from public.load_lines x where x.load_id=v_load.id
   and (x.unit_id=v_piece.unit_id or x.material_id=v_piece.material_id or x.inventory_uid=v_piece.inventory_uid)
   order by (x.status in ('on_board','missing','delivered')) desc,x.created_at desc limit 1 for update;
  v_has:=found;
  continue when v_has and v_line.status='delivered';
  if v_has and v_line.status in ('on_board','missing') then
   v_flag:=case when v_line.dropoff_stop_id<>v_stop.id then 'wrong_stop' when v_line.status='missing' then 'found' end;
   update public.load_lines set status='delivered',flag=coalesce(v_flag,flag),delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,
    delivered_source='scan',off_by=p_actor,off_at=now() where id=v_line.id;
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
     delivered_source='scan',off_by=p_actor,off_at=now() where id=v_line.id;
   else
    insert into public.load_lines(project_id,load_id,unit_id,material_id,inventory_uid,tag,dropoff_stop_id,status,flag,added_in_field,
     delivered_stop_id,delivered_place_id,delivered_source,planned_by,off_by,off_at)
    values(p_project_id,v_load.id,v_piece.unit_id,v_piece.material_id,v_piece.inventory_uid,v_piece.tag,v_stop.id,'delivered','extra',true,
     v_stop.id,v_place.id,'scan',p_actor,p_actor,now());
   end if;
   v_extra:=v_extra+1;
  end if;
  if v_piece.unit_id is not null then
   update public.handling_units set status='delivered',place_id=v_place.id,site_map_id=v_zone_map,zone_id=v_zone_id,location=v_location
    where id=v_piece.unit_id;
  end if;
  v_done:=v_done+1;
  v_tags:=v_tags||v_piece.tag;
 end loop;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_unloaded','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_stop.id,'pieces',to_jsonb(v_tags)),p_project_id);
 return jsonb_build_object('load_id',v_load.id,'stop_id',v_stop.id,'delivered',v_done,'extra',v_extra,'wrong_stop',v_wrong);
end $$;

-- stop_complete: finish a stop. {loadId, stopId, confirmAll? (office only:
-- the pieces due here arrived without being scanned, as at an outside shop)}.
-- Without confirmAll, pieces due here and not scanned off are missing. The
-- last stop finishes the load.
create function public.logistics_stop_complete(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_stop public.load_stops; v_place public.places; v_line public.load_lines; v_confirm boolean;
 v_delivered integer:=0; v_missing integer:=0; v_left integer;
begin
 v_load:=public.logistics_load(p_project_id,public.logistics_id(p_payload,'loadId','Load'));
 if v_load.status<>'in_transit' then
  raise exception 'Load % isn''t on the road',v_load.load_number using errcode='22023';
 end if;
 v_stop:=public.logistics_stop(v_load,public.logistics_id(p_payload,'stopId','Stop'),'the stop to finish');
 if v_stop.status='done' then raise exception '% is already done',public.logistics_stop_name(v_stop) using errcode='22023'; end if;
 v_confirm:=public.logistics_flag(p_payload,'confirmAll','Confirm all');
 if v_confirm and not public.is_office_user() then
  raise exception 'Only office staff can mark pieces delivered without scanning them' using errcode='42501';
 end if;
 select * into v_place from public.places where id=v_stop.place_id;
 for v_line in select * from public.load_lines x where x.dropoff_stop_id=v_stop.id and x.status='on_board' for update loop
  if v_confirm then
   update public.load_lines set status='delivered',delivered_stop_id=v_stop.id,delivered_place_id=v_place.id,delivered_source='office',
    off_by=p_actor,off_at=now() where id=v_line.id;
   if v_line.unit_id is not null then
    update public.handling_units set status='delivered',place_id=v_place.id,site_map_id=null,zone_id=null,location=null where id=v_line.unit_id;
   end if;
   v_delivered:=v_delivered+1;
  else
   update public.load_lines set status='missing' where id=v_line.id;
   if v_line.unit_id is not null then update public.handling_units set status='missing' where id=v_line.unit_id; end if;
   v_missing:=v_missing+1;
  end if;
 end loop;
 -- Pieces that were to be picked up here and weren't stay behind.
 update public.load_lines set status='not_loaded' where pickup_stop_id=v_stop.id and status='planned';
 get diagnostics v_left=row_count;
 update public.load_stops set status='done',arrived_at=coalesce(arrived_at,now()),
  arrived_source=coalesce(arrived_source,case when public.is_office_user() then 'office' else 'scan' end),
  completed_by=p_actor,completed_at=now() where id=v_stop.id;
 if not exists(select 1 from public.load_stops s where s.load_id=v_load.id and s.status in ('pending','arrived')) then
  update public.loads set status='delivered',delivered_at=now() where id=v_load.id;
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_stop_completed','load',v_load.id,jsonb_build_object('operation_id',p_operation_id,'stop_id',v_stop.id,
   'confirmed',v_confirm,'delivered',v_delivered,'missing',v_missing,'not_picked_up',v_left),p_project_id);
 return public.logistics_load_summary(v_load.id)||jsonb_build_object('stop_id',v_stop.id,'stop_delivered',v_delivered,'stop_missing',v_missing,'not_picked_up',v_left);
end $$;

-- load_close (office only): {loadId, cancel?}. Close a delivered load, or
-- cancel one that hasn't left, which puts its crates back as they were.
create function public.logistics_load_close(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_payload jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v_load public.loads; v_line public.load_lines; v_cancel boolean;
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
 end if;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(p_actor,'load_piece_found','load',v_line.load_id,jsonb_build_object('operation_id',p_operation_id,'line_id',v_line.id,'tag',v_line.tag,'place_id',v_place.id),p_project_id);
 return jsonb_build_object('line_id',v_line.id,'tag',v_line.tag,'status','delivered','place_id',v_place.id);
end $$;

-- The dispatcher apply_field_operation hands unknown actions to (021).
create or replace function public.apply_logistics_operation(p_actor uuid,p_operation_id uuid,p_project_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
begin
 case p_action
  when 'pack' then return public.logistics_pack(p_actor,p_operation_id,p_project_id,p_payload);
  when 'unpack' then return public.logistics_unpack(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_save' then return public.logistics_load_save(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_plan' then return public.logistics_load_plan(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_on' then return public.logistics_load_on(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_depart' then return public.logistics_load_depart(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_off' then return public.logistics_load_off(p_actor,p_operation_id,p_project_id,p_payload);
  when 'stop_complete' then return public.logistics_stop_complete(p_actor,p_operation_id,p_project_id,p_payload);
  when 'load_close' then return public.logistics_load_close(p_actor,p_operation_id,p_project_id,p_payload);
  when 'line_found' then return public.logistics_line_found(p_actor,p_operation_id,p_project_id,p_payload);
  else raise exception 'Unsupported operation' using errcode='22023';
 end case;
end $$;

DO $$ DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
  'logistics_text(jsonb,text,integer,text)','logistics_date(jsonb,text,text)','logistics_id(jsonb,text,text)',
  'logistics_flag(jsonb,text,text)','logistics_list(jsonb,text,text)','logistics_code(text)',
  'logistics_load(uuid,uuid)','logistics_place(uuid,uuid)','logistics_stop(public.loads,uuid,text)','logistics_stop_name(public.load_stops)',
  'logistics_piece(uuid,text,boolean)','logistics_open_line(uuid,uuid,uuid,uuid)','logistics_unit_free(public.handling_units)',
  'logistics_load_summary(uuid)','logistics_pack(uuid,uuid,uuid,jsonb)','logistics_unpack(uuid,uuid,uuid,jsonb)',
  'logistics_load_save(uuid,uuid,uuid,jsonb)','logistics_load_plan(uuid,uuid,uuid,jsonb)','logistics_load_on(uuid,uuid,uuid,jsonb)',
  'logistics_load_depart(uuid,uuid,uuid,jsonb)','logistics_load_off(uuid,uuid,uuid,jsonb)','logistics_stop_complete(uuid,uuid,uuid,jsonb)',
  'logistics_load_close(uuid,uuid,uuid,jsonb)','logistics_line_found(uuid,uuid,uuid,jsonb)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public,anon,authenticated',f);
 END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The driver's licence: recorded with its own calls so the number never
-- lands in field_operations. A repeated operation ID returns the first answer.
-- p_licence: {number, state?, expiry? (YYYY-MM-DD)}.
-- ---------------------------------------------------------------------------
create function public.record_driver_licence(p_operation_id uuid,p_load_id uuid,p_licence jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); v_load public.loads; v_row public.load_driver_licences; v_number text; v_state text; v_expiry date;
begin
 if p_operation_id is null or jsonb_typeof(p_licence) is distinct from 'object' then
  raise exception 'Operation ID and licence details are required' using errcode='22023';
 end if;
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or actor is null or not public.can_work_project(v_load.project_id) then
  raise exception 'That load isn''t in your projects' using errcode='42501';
 end if;
 select * into v_row from public.load_driver_licences where load_id=p_load_id for update;
 if found and v_row.last_operation_id=p_operation_id then
  return jsonb_build_object('load_id',p_load_id,'recorded',true,'last4',right(v_row.licence_number,4));
 end if;
 if found and v_row.removed_at is not null then
  raise exception 'This licence was removed after the 90-day retention period' using errcode='22023';
 end if;
 if v_load.status in ('closed','cancelled') and not public.is_office_user() then
  raise exception 'Load % is closed; the office can still correct its licence',v_load.load_number using errcode='22023';
 end if;
 v_number:=upper(regexp_replace(btrim(coalesce(p_licence->>'number','')),'\s+',' ','g'));
 if v_number !~ '^[A-Z0-9][A-Z0-9 -]{2,39}$' then
  raise exception 'Enter the licence number: 3 to 40 letters, numbers, spaces or dashes' using errcode='22023';
 end if;
 v_state:=public.logistics_text(p_licence,'state',40,'Issuing state');
 v_expiry:=public.logistics_date(p_licence,'expiry','Expiry date');
 insert into public.load_driver_licences(load_id,project_id,licence_number,licence_state,licence_expiry,recorded_by,recorded_at,last_operation_id)
 values(p_load_id,v_load.project_id,v_number,v_state,v_expiry,actor,now(),p_operation_id)
 on conflict (load_id) do update set licence_number=excluded.licence_number,licence_state=excluded.licence_state,
  licence_expiry=excluded.licence_expiry,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at,last_operation_id=excluded.last_operation_id;
 update public.loads set licence_recorded_at=now() where id=p_load_id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(actor,'driver_licence_recorded','load',p_load_id,jsonb_build_object('operation_id',p_operation_id,'last4',right(v_number,4)),v_load.project_id);
 return jsonb_build_object('load_id',p_load_id,'recorded',true,'last4',right(v_number,4));
end $$;

-- Attach a photo already uploaded to driver-licences/<load id>/<name>.jpg.
-- Field uploads must not overwrite (upserting needs read access they don't
-- have); retrying an upload that already landed is fine.
create function public.attach_driver_licence_photo(p_load_id uuid,p_path text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); v_load public.loads;
begin
 select * into v_load from public.loads where id=p_load_id;
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

-- Licences of loads closed more than 90 days ago. The office Loads page lists
-- them, deletes the photos through Storage, then calls remove_driver_licence,
-- which refuses while any photo is still stored.
create function public.driver_licences_due_for_removal() returns table(load_id uuid,load_number text,storage_paths text[])
language sql stable security definer set search_path=public as $$
 select l.id,l.load_number,coalesce(array_agg(distinct p.storage_path) filter (where p.id is not null),'{}')
 from public.loads l
 left join public.load_driver_licences d on d.load_id=l.id and d.removed_at is null
 left join public.driver_licence_photos p on p.load_id=l.id and p.removed_at is null
 where l.closed_at<now()-interval '90 days' and (d.load_id is not null or p.id is not null)
  and public.is_office_user() and public.has_project_access(l.project_id)
 group by l.id,l.load_number
$$;

create function public.remove_driver_licence(p_load_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_photos integer; v_numbers integer;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can remove its licence' using errcode='42501';
 end if;
 if v_load.closed_at is null or v_load.closed_at>=now()-interval '90 days' then
  raise exception 'Licences are kept until 90 days after the load closes' using errcode='22023';
 end if;
 if exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=p_load_id::text) then
  raise exception 'Delete the licence photos from storage first' using errcode='22023';
 end if;
 update public.driver_licence_photos set removed_at=now() where load_id=p_load_id and removed_at is null;
 get diagnostics v_photos=row_count;
 update public.load_driver_licences set licence_number=null,licence_state=null,licence_expiry=null,removed_at=now()
  where load_id=p_load_id and removed_at is null;
 get diagnostics v_numbers=row_count;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'driver_licence_removed','load',p_load_id,jsonb_build_object('photos',v_photos,'licence',v_numbers>0),v_load.project_id);
 return jsonb_build_object('load_id',p_load_id,'photos_removed',v_photos,'licence_removed',v_numbers>0);
end $$;
revoke all on function public.record_driver_licence(uuid,uuid,jsonb),public.attach_driver_licence_photo(uuid,text),
 public.driver_licences_due_for_removal(),public.remove_driver_licence(uuid) from public,anon;
grant execute on function public.record_driver_licence(uuid,uuid,jsonb),public.attach_driver_licence_photo(uuid,text),
 public.driver_licences_due_for_removal(),public.remove_driver_licence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Views for the office pages and the app.
-- ---------------------------------------------------------------------------
create view public.load_overview with (security_invoker=true) as
select l.id,l.project_id,l.load_number,l.status,l.origin_place_id,o.name as origin_name,l.planned_date,
 l.truck_type,l.truck_number,l.trailer_number,l.bol_number,l.driver_name,l.driver_phone,l.licence_recorded_at,l.notes,
 (select count(*) from public.load_companies c where c.load_id=l.id)::integer as company_count,
 (select count(*) from public.load_stops s where s.load_id=l.id and s.status<>'cancelled')::integer as stop_count,
 (select count(*) from public.load_stops s where s.load_id=l.id and s.status='done')::integer as stops_done,
 (select p.name from public.load_stops s join public.places p on p.id=s.place_id
   where s.load_id=l.id and s.status in ('pending','arrived') order by s.seq limit 1) as next_stop,
 coalesce(n.planned,0)::integer as planned_count,coalesce(n.on_board,0)::integer as on_board_count,
 coalesce(n.delivered,0)::integer as delivered_count,coalesce(n.missing,0)::integer as missing_count,
 coalesce(n.flagged,0)::integer as flagged_count,
 l.departed_at,l.delivered_at,l.closed_at,l.created_by,l.created_at,l.updated_at
from public.loads l
left join public.places o on o.id=l.origin_place_id
left join lateral (select count(*) filter (where x.status='planned') as planned,count(*) filter (where x.status='on_board') as on_board,
  count(*) filter (where x.status='delivered') as delivered,count(*) filter (where x.status='missing') as missing,
  count(*) filter (where x.flag is not null) as flagged
 from public.load_lines x where x.load_id=l.id) n on true;

create view public.load_stop_overview with (security_invoker=true) as
select s.id,s.project_id,s.load_id,s.seq,s.place_id,p.name as place_name,p.kind as place_kind,p.city,p.state,
 s.kind,s.planned_date,s.status,s.arrived_at,s.arrived_source,s.completed_at,
 coalesce(n.due,0)::integer as due_count,coalesce(n.delivered,0)::integer as delivered_count,coalesce(n.missing,0)::integer as missing_count
from public.load_stops s
join public.places p on p.id=s.place_id
left join lateral (select count(*) filter (where x.dropoff_stop_id=s.id and x.status in ('planned','on_board')) as due,
  count(*) filter (where x.delivered_stop_id=s.id and x.status='delivered') as delivered,
  count(*) filter (where x.dropoff_stop_id=s.id and x.status='missing') as missing
 from public.load_lines x where x.load_id=s.load_id) n on true
where s.status<>'cancelled';

-- is_current_position marks the line that says where a piece is now: its
-- latest line that put it on a truck, off at a place, or missing.
create view public.load_line_overview with (security_invoker=true) as
select x.id,x.project_id,x.load_id,l.load_number,l.status as load_status,x.tag,
 case when x.unit_id is not null then 'crate' else 'item' end as piece_kind,x.unit_id,x.material_id,x.inventory_uid,
 coalesce(u.description,case when u.id is not null then initcap(u.kind) end,i.inventory_item,nullif(concat_ws(' ',m.material_type,m.size,m.grade),''),x.tag) as name,
 coalesce(u.is_high_value,false) as is_high_value,x.status,x.flag,x.added_in_field,
 x.pickup_stop_id,ps.seq as pickup_seq,pp.name as pickup_place,
 x.dropoff_stop_id,ds.seq as dropoff_seq,dp.name as dropoff_place,
 x.delivered_stop_id,x.delivered_place_id,vp.name as delivered_place,x.delivered_source,x.note,
 x.on_at,x.off_at,x.created_at,x.updated_at,
 (x.status in ('on_board','delivered','missing') and not exists(
   select 1 from public.load_lines y where y.id<>x.id and y.status in ('on_board','delivered','missing')
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
left join public.inventory_records i on i.uid=x.inventory_uid;

-- As in 021, plus the load the crate's outermost crate is on or planned for.
create or replace view public.handling_unit_overview with (security_invoker=true) as
select u.id,u.project_id,u.code,u.kind,u.description,u.is_high_value,u.status,u.parent_id,p.code as parent_code,
 top.id as top_unit_id,top.code as top_code,top.place_id,pl.name as place_name,top.site_map_id,top.zone_id,top.location,
 (select count(*) from public.handling_unit_contents c where c.unit_id=u.id and c.removed_at is null)::integer as item_count,
 (select count(*) from public.handling_units k where k.parent_id=u.id)::integer as unit_count,
 u.sealed_at,u.created_at,u.updated_at,
 top.status as top_status,ol.load_id,ol.load_number,ol.line_status as load_line_status
from public.handling_units u
left join public.handling_units p on p.id=u.parent_id
cross join lateral public.handling_unit_top(u.id) top
left join public.places pl on pl.id=top.place_id
left join lateral (select x.load_id,ld.load_number,x.status as line_status from public.load_lines x join public.loads ld on ld.id=x.load_id
  where x.unit_id=top.id and x.status in ('planned','on_board','missing')
  order by case x.status when 'on_board' then 0 when 'missing' then 1 else 2 end limit 1) ol on true;

COMMIT;

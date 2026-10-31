-- Driver licences are kept for 365 days, not 90, and never removed without
-- warning, because a licence is sometimes needed to recover a tracker a
-- driver kept. A licence is due 365 days after its load closes or is
-- cancelled or, if the load never closes, 365 days after its last activity.
-- For the 30 days before that it is listed by driver_licences_due_soon, and
-- office staff can keep it past its date, with a reason, until they release
-- it. Neither the daily job nor the Loads page removes a kept licence. Each
-- load's due date is in load_overview, so pages needn't know the period.
BEGIN;

create table public.driver_licence_holds (
 load_id uuid primary key references public.loads(id),
 project_id uuid not null references public.projects(id),
 reason text not null check (length(reason) between 5 and 500),
 held_by uuid not null references public.users(id),
 held_at timestamptz not null default now()
);
alter table public.driver_licence_holds enable row level security;
revoke insert,update,delete on public.driver_licence_holds from anon,authenticated;
create policy office_read on public.driver_licence_holds for select to authenticated
 using(public.is_office_user() and public.has_project_access(project_id));

create or replace function public.driver_licence_due_at(p_load_id uuid) returns timestamptz
language sql stable security definer set search_path=public as $$
 select coalesce(l.closed_at,greatest(l.updated_at,
   (select max(x.updated_at) from public.load_lines x where x.load_id=l.id),
   (select max(s.updated_at) from public.load_stops s where s.load_id=l.id),
   (select max(p.created_at) from public.driver_licence_photos p where p.load_id=l.id)))+interval '365 days'
 from public.loads l where l.id=p_load_id
$$;

-- The same date for anyone on the load's project, for the pages.
create function public.load_licence_due_at(p_load_id uuid) returns timestamptz
language sql stable security definer set search_path=public as $$
 select public.driver_licence_due_at(l.id) from public.loads l where l.id=p_load_id and public.has_project_access(l.project_id)
$$;

-- Whether a load still has any licence data: a number, an attached photo or
-- a file in its folder. Internal.
create function public.driver_licence_on_record(p_load_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.load_driver_licences d where d.load_id=p_load_id and d.removed_at is null)
  or exists(select 1 from public.driver_licence_photos p where p.load_id=p_load_id and p.removed_at is null)
  or exists(select 1 from storage.objects o where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=p_load_id::text)
$$;

-- The warning: licences due in the next p_days (30 unless asked) on the
-- office's projects, overdue kept ones included, earliest first.
create function public.driver_licences_due_soon(p_days integer default 30)
returns table(load_id uuid,load_number text,project_id uuid,due_at timestamptz,kept boolean,keep_reason text,kept_at timestamptz)
language sql stable security definer set search_path=public as $$
 select l.id,l.load_number,l.project_id,public.driver_licence_due_at(l.id),h.load_id is not null,h.reason,h.held_at
 from public.loads l left join public.driver_licence_holds h on h.load_id=l.id
 where public.is_office_user() and public.has_project_access(l.project_id)
  and public.driver_licence_due_at(l.id)<now()+make_interval(days=>least(greatest(coalesce(p_days,30),1),365))
  and public.driver_licence_on_record(l.id)
 order by 4
$$;

-- Keep a load's licence past its date, with a reason; again to change the
-- reason. release_driver_licence_hold lets it be removed when due.
create function public.keep_driver_licence(p_load_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can keep its licence' using errcode='42501';
 end if;
 if v_reason is null or length(v_reason) not between 5 and 500 then
  raise exception 'Give a reason of 5 to 500 characters for keeping the licence' using errcode='22023';
 end if;
 insert into public.driver_licence_holds(load_id,project_id,reason,held_by) values(p_load_id,v_load.project_id,v_reason,auth.uid())
 on conflict (load_id) do update set reason=excluded.reason,held_by=excluded.held_by,held_at=now();
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'driver_licence_kept','load',p_load_id,jsonb_build_object('reason',v_reason),v_load.project_id);
 return jsonb_build_object('load_id',p_load_id,'kept',true,'due_at',public.driver_licence_due_at(p_load_id));
end $$;

create function public.release_driver_licence_hold(p_load_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_hold public.driver_licence_holds;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can release its licence' using errcode='42501';
 end if;
 delete from public.driver_licence_holds where load_id=p_load_id returning * into v_hold;
 if v_hold.load_id is not null then
  insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
   values(auth.uid(),'driver_licence_hold_released','load',p_load_id,jsonb_build_object('reason',v_hold.reason),v_load.project_id);
 end if;
 return jsonb_build_object('load_id',p_load_id,'kept',false,'due_at',public.driver_licence_due_at(p_load_id));
end $$;

-- As in 022, except a kept licence is never listed, purged or removed.
create or replace function public.driver_licences_due_for_removal() returns table(load_id uuid,load_number text,storage_paths text[])
language sql stable security definer set search_path=public as $$
 select l.id,l.load_number,coalesce((select array_agg(o.name order by o.name) from storage.objects o
   where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=l.id::text),'{}')
 from public.loads l
 where public.is_office_user() and public.has_project_access(l.project_id) and public.driver_licence_due_at(l.id)<now()
  and not exists(select 1 from public.driver_licence_holds h where h.load_id=l.id)
  and public.driver_licence_on_record(l.id)
$$;

create or replace function public.driver_licence_purge_queue() returns table(load_id uuid,project_id uuid,load_number text,due_at timestamptz,storage_paths text[])
language sql stable security definer set search_path=public as $$
 select l.id,l.project_id,l.load_number,public.driver_licence_due_at(l.id),
  coalesce((select array_agg(o.name order by o.name) from storage.objects o
   where o.bucket_id='driver-licences' and split_part(o.name,'/',1)=l.id::text),'{}')
 from public.loads l
 where public.driver_licence_due_at(l.id)<now()
  and not exists(select 1 from public.driver_licence_holds h where h.load_id=l.id)
  and public.driver_licence_on_record(l.id)
 order by 4
$$;

create or replace function public.purge_driver_licence(p_load_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found then raise exception 'That load doesn''t exist' using errcode='22023'; end if;
 if exists(select 1 from public.driver_licence_holds h where h.load_id=p_load_id) then
  raise exception 'The licence for load % is being kept',v_load.load_number using errcode='22023';
 end if;
 if public.driver_licence_due_at(p_load_id)>=now() then
  raise exception 'The licence for load % isn''t due for removal yet',v_load.load_number using errcode='22023';
 end if;
 return public.driver_licence_clear(v_load,null,null,'retention');
end $$;

create or replace function public.remove_driver_licence(p_load_id uuid,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_load public.loads; v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); v_hold public.driver_licence_holds;
begin
 select * into v_load from public.loads where id=p_load_id for update;
 if not found or not public.is_office_user() or not public.has_project_access(v_load.project_id) then
  raise exception 'Only office staff on the load''s project can remove its licence' using errcode='42501';
 end if;
 select * into v_hold from public.driver_licence_holds where load_id=p_load_id;
 if v_hold.load_id is not null then
  raise exception 'This licence is being kept (%); release it first',v_hold.reason using errcode='22023';
 end if;
 if length(v_reason)>500 then raise exception 'Reason is too long (at most 500 characters)' using errcode='22023'; end if;
 if public.driver_licence_due_at(p_load_id)>now() and coalesce(length(v_reason),0)<5 then
  raise exception 'Give a reason to remove the licence before it is due' using errcode='22023';
 end if;
 return public.driver_licence_clear(v_load,auth.uid(),v_reason,'office');
end $$;

-- As in 022, plus the date the load's licence is due for removal.
create or replace view public.load_overview with (security_invoker=true) as
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
 l.departed_at,l.delivered_at,l.closed_at,l.created_by,l.edited_at,l.created_at,l.updated_at,
 public.load_licence_due_at(l.id) as licence_due_at
from public.loads l
left join public.places o on o.id=l.origin_place_id
left join lateral (select count(*) filter (where x.status='planned') as planned,count(*) filter (where x.status='on_board') as on_board,
  count(*) filter (where x.status='delivered') as delivered,count(*) filter (where x.status='missing') as missing,
  count(*) filter (where x.status='written_off') as written_off,count(*) filter (where x.flag is not null) as flagged
 from public.load_lines x where x.load_id=l.id) n on true;

revoke all on function public.driver_licence_on_record(uuid) from public,anon,authenticated;
revoke all on function public.load_licence_due_at(uuid),public.driver_licences_due_soon(integer),
 public.keep_driver_licence(uuid,text),public.release_driver_licence_hold(uuid) from public,anon;
grant execute on function public.load_licence_due_at(uuid),public.driver_licences_due_soon(integer),
 public.keep_driver_licence(uuid,text),public.release_driver_licence_hold(uuid) to authenticated;

-- Trigger functions run only as triggers; nobody calls them directly.
revoke all on function public.place_guard(),public.place_audit(),public.project_loads_guard() from public,anon,authenticated;

COMMIT;

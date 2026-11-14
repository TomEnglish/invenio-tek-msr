-- Trackers on shipments: which GPS tracker rides with which shipment from the
-- PO & Shipment Log, so the Shipments page can show where a shipment in transit
-- is. Everyone on a project can see its links; office staff make and end them,
-- only through the two functions below, and each change is in the audit log.
-- Nothing is deleted: a link that ends keeps who ended it, when and why.
--
-- A shipment has at most one tracker at a time, and a tracker rides with at
-- most one shipment at a time. Linking a tracker that is on another shipment
-- moves it only when the caller says so (p_move), so no one takes a tracker off
-- a shipment by mistake. A link stays within one project: when a tracker or a
-- shipment moves to another project, its link ends. The import (018) keeps a
-- shipment's id, so links survive every import.
BEGIN;

create table public.shipment_trackers (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 shipment_id bigint not null references public.shipments(id),
 tracker_id text not null references public.samsara_trackers(id),
 linked_by uuid references public.users(id),
 linked_at timestamptz not null default clock_timestamp(),
 ended_by uuid references public.users(id),
 ended_at timestamptz,
 -- unlinked: taken off this shipment; replaced: another tracker was linked to
 -- this shipment; moved: this tracker was linked to another shipment;
 -- reassigned: the tracker or the shipment moved to another project.
 ended_reason text check (ended_reason in ('unlinked','replaced','moved','reassigned')),
 constraint shipment_trackers_ended check ((ended_at is null)=(ended_reason is null) and (ended_at is null or ended_at>=linked_at))
);
create unique index shipment_trackers_one_per_shipment on public.shipment_trackers(shipment_id) where ended_at is null;
create unique index shipment_trackers_one_per_tracker on public.shipment_trackers(tracker_id) where ended_at is null;
create index shipment_trackers_project on public.shipment_trackers(project_id) where ended_at is null;

alter table public.shipment_trackers enable row level security;
revoke insert,update,delete,truncate on public.shipment_trackers from anon,authenticated;
create policy member_read on public.shipment_trackers for select to authenticated using(public.has_project_access(project_id));

-- Links start and end by the clock, not the transaction's start: a call that
-- waited for another may end a link made after it began, and a new link starts
-- after the one it replaces or moves ended, so no two overlap in time.

-- Link a tracker to a shipment, replacing the shipment's current tracker. A
-- tracker already on another shipment is moved here only with p_move; without
-- it the call is refused (23505) and says which shipment has the tracker.
-- Linking the tracker a shipment already has changes nothing.
create function public.link_shipment_tracker(p_shipment_id bigint,p_tracker_id text,p_move boolean default false)
returns public.shipment_trackers
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_shipment public.shipments; v_tracker public.samsara_trackers;
 v_current public.shipment_trackers; v_other public.shipment_trackers; v_other_number text;
 v_link public.shipment_trackers;
begin
 if not public.is_office_user() then
  raise exception 'Only office staff can link a tracker to a shipment' using errcode='42501';
 end if;
 -- Shipment first, then tracker: two calls for the same tracker wait for each other.
 select * into v_shipment from public.shipments where id=p_shipment_id for update;
 if not found or not public.can_work_project(v_shipment.project_id) then
  raise exception 'That shipment isn''t in a project you can change' using errcode='42501';
 end if;
 select * into v_tracker from public.samsara_trackers where id=p_tracker_id for update;
 if not found or v_tracker.project_id is distinct from v_shipment.project_id then
  raise exception 'That tracker isn''t one of this project''s trackers' using errcode='22023';
 end if;
 select * into v_current from public.shipment_trackers where shipment_id=v_shipment.id and ended_at is null;
 if found and v_current.tracker_id=v_tracker.id then
  return v_current;
 end if;
 select * into v_other from public.shipment_trackers where tracker_id=v_tracker.id and ended_at is null;
 if found then
  -- A link stays within its project (see the triggers below); one that didn't is never moved or named from here.
  if v_other.project_id is distinct from v_shipment.project_id then
   raise exception 'Tracker % is on a shipment in another project; take it off there first',v_tracker.name using errcode='42501';
  end if;
  select shipment_number into v_other_number from public.shipments where id=v_other.shipment_id;
  if not coalesce(p_move,false) then
   raise exception 'Tracker % is on shipment %. Move it to this shipment?',v_tracker.name,coalesce(v_other_number,'#'||v_other.shipment_id)
    using errcode='23505';
  end if;
  -- Unlinking that shipment doesn't wait for this tracker, so its link may have ended meanwhile: then nothing moves.
  update public.shipment_trackers set ended_at=clock_timestamp(),ended_by=auth.uid(),ended_reason='moved' where id=v_other.id and ended_at is null;
  if not found then
   v_other:=null; v_other_number:=null;
  end if;
 end if;
 if v_current.id is not null then
  -- Likewise a move elsewhere may have taken this shipment's tracker meanwhile: then nothing is replaced.
  update public.shipment_trackers set ended_at=clock_timestamp(),ended_by=auth.uid(),ended_reason='replaced' where id=v_current.id and ended_at is null;
  if not found then
   v_current:=null;
  end if;
 end if;
 insert into public.shipment_trackers(project_id,shipment_id,tracker_id,linked_by)
  values(v_shipment.project_id,v_shipment.id,v_tracker.id,auth.uid()) returning * into v_link;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'shipment_tracker_linked','shipment',null,
   jsonb_strip_nulls(jsonb_build_object('shipment_id',v_shipment.id,'shipment_number',v_shipment.shipment_number,
    'tracker_id',v_tracker.id,'tracker_name',v_tracker.name,'replaced_tracker_id',v_current.tracker_id,
    'moved_from_shipment_id',v_other.shipment_id,'moved_from_shipment_number',v_other_number)),
   v_shipment.project_id);
 return v_link;
end $$;
revoke all on function public.link_shipment_tracker(bigint,text,boolean) from public,anon;
grant execute on function public.link_shipment_tracker(bigint,text,boolean) to authenticated;

-- Take a tracker off a shipment. The caller names the tracker it saw, so a
-- tracker someone else linked meanwhile isn't taken off unseen (40001).
create function public.unlink_shipment_tracker(p_shipment_id bigint,p_tracker_id text)
returns public.shipment_trackers
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shipment public.shipments; v_link public.shipment_trackers; v_tracker_name text;
begin
 if not public.is_office_user() then
  raise exception 'Only office staff can unlink a tracker from a shipment' using errcode='42501';
 end if;
 select * into v_shipment from public.shipments where id=p_shipment_id for update;
 if not found or not public.can_work_project(v_shipment.project_id) then
  raise exception 'That shipment isn''t in a project you can change' using errcode='42501';
 end if;
 select * into v_link from public.shipment_trackers where shipment_id=v_shipment.id and ended_at is null;
 if not found then
  raise exception 'No tracker is linked to this shipment' using errcode='22023';
 end if;
 if v_link.tracker_id is distinct from p_tracker_id then
  raise exception 'The tracker on shipment % has changed since you opened it; open it again',v_shipment.shipment_number using errcode='40001';
 end if;
 -- A move to another shipment doesn't wait for this shipment, so the link may have ended meanwhile.
 update public.shipment_trackers set ended_at=clock_timestamp(),ended_by=auth.uid(),ended_reason='unlinked' where id=v_link.id and ended_at is null returning * into v_link;
 if not found then
  raise exception 'The tracker on shipment % has changed since you opened it; open it again',v_shipment.shipment_number using errcode='40001';
 end if;
 select name into v_tracker_name from public.samsara_trackers where id=v_link.tracker_id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'shipment_tracker_unlinked','shipment',null,
   jsonb_strip_nulls(jsonb_build_object('shipment_id',v_shipment.id,'shipment_number',v_shipment.shipment_number,
    'tracker_id',v_link.tracker_id,'tracker_name',v_tracker_name)),
   v_shipment.project_id);
 return v_link;
end $$;
revoke all on function public.unlink_shipment_tracker(bigint,text) from public,anon;
grant execute on function public.unlink_shipment_tracker(bigint,text) to authenticated;

-- A tracker (moved by the tracker sync) or a shipment (moved by office staff)
-- that goes to another project leaves its link behind: the link ends as
-- reassigned, recorded in the project it was in. So a link never reaches
-- across projects, and no one is asked to move a tracker they can't see.
create function public.shipment_tracker_reassigned(p_link public.shipment_trackers,p_reason text) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
 values(auth.uid(),'shipment_tracker_unlinked','shipment',null,
  jsonb_strip_nulls(jsonb_build_object('shipment_id',p_link.shipment_id,
   'shipment_number',(select shipment_number from public.shipments where id=p_link.shipment_id),
   'tracker_id',p_link.tracker_id,'tracker_name',(select name from public.samsara_trackers where id=p_link.tracker_id),'reason',p_reason)),
  p_link.project_id)
$$;
revoke all on function public.shipment_tracker_reassigned(public.shipment_trackers,text) from public,anon,authenticated;

create function public.tracker_changed_project() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_link public.shipment_trackers;
begin
 for v_link in update public.shipment_trackers set ended_at=clock_timestamp(),ended_by=auth.uid(),ended_reason='reassigned'
  where tracker_id=new.id and ended_at is null and project_id is distinct from new.project_id returning * loop
  perform public.shipment_tracker_reassigned(v_link,'The tracker moved to another project');
 end loop;
 return new;
end $$;
revoke all on function public.tracker_changed_project() from public,anon,authenticated;
create trigger tracker_changed_project after update of project_id on public.samsara_trackers
 for each row when (old.project_id is distinct from new.project_id) execute function public.tracker_changed_project();

create function public.shipment_changed_project() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_link public.shipment_trackers;
begin
 for v_link in update public.shipment_trackers set ended_at=clock_timestamp(),ended_by=auth.uid(),ended_reason='reassigned'
  where shipment_id=new.id and ended_at is null and project_id is distinct from new.project_id returning * loop
  perform public.shipment_tracker_reassigned(v_link,'The shipment moved to another project');
 end loop;
 return new;
end $$;
revoke all on function public.shipment_changed_project() from public,anon,authenticated;
create trigger shipment_changed_project after update of project_id on public.shipments
 for each row when (old.project_id is distinct from new.project_id) execute function public.shipment_changed_project();

-- The project activity feed (022) names the shipment of a tracker change and
-- passes on the tracker's name, so crews see what changed. Otherwise as in 022.
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
  and a.action not like 'driver_licence%' and (p_before is null or a.created_at<p_before)
 order by a.created_at desc
 limit least(greatest(coalesce(p_limit,50),1),200)
$$;
revoke all on function public.list_project_activity(uuid,timestamptz,integer) from public,anon;
grant execute on function public.list_project_activity(uuid,timestamptz,integer) to authenticated;

COMMIT;

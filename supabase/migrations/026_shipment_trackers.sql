-- Trackers on shipments: which GPS tracker rides with which shipment from the
-- PO & Shipment Log, so the Shipments page can show where a shipment in transit
-- is. Everyone on a project can see its links; office staff make and end them,
-- only through the two functions below, and each change is in the audit log.
-- Nothing is deleted: a link that ends keeps who ended it, when and why.
--
-- A shipment has at most one tracker at a time, and a tracker rides with at
-- most one shipment at a time. Linking a tracker that is on another shipment
-- moves it only when the caller says so (p_move), so no one takes a tracker off
-- a shipment by mistake. The import (018) keeps a shipment's id, so links
-- survive every import.
BEGIN;

create table public.shipment_trackers (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 shipment_id bigint not null references public.shipments(id),
 tracker_id text not null references public.samsara_trackers(id),
 linked_by uuid references public.users(id),
 linked_at timestamptz not null default now(),
 ended_by uuid references public.users(id),
 ended_at timestamptz,
 -- unlinked: taken off this shipment; replaced: another tracker was linked to
 -- this shipment; moved: this tracker was linked to another shipment.
 ended_reason text check (ended_reason in ('unlinked','replaced','moved')),
 constraint shipment_trackers_ended check ((ended_at is null)=(ended_reason is null) and (ended_at is null or ended_at>=linked_at))
);
create unique index shipment_trackers_one_per_shipment on public.shipment_trackers(shipment_id) where ended_at is null;
create unique index shipment_trackers_one_per_tracker on public.shipment_trackers(tracker_id) where ended_at is null;
create index shipment_trackers_project on public.shipment_trackers(project_id) where ended_at is null;

alter table public.shipment_trackers enable row level security;
revoke insert,update,delete,truncate on public.shipment_trackers from anon,authenticated;
create policy member_read on public.shipment_trackers for select to authenticated using(public.has_project_access(project_id));

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
  select shipment_number into v_other_number from public.shipments where id=v_other.shipment_id;
  if not coalesce(p_move,false) then
   raise exception 'Tracker % is on shipment %. Move it to this shipment?',v_tracker.name,coalesce(v_other_number,'#'||v_other.shipment_id)
    using errcode='23505';
  end if;
  update public.shipment_trackers set ended_at=now(),ended_by=auth.uid(),ended_reason='moved' where id=v_other.id;
 end if;
 if v_current.id is not null then
  update public.shipment_trackers set ended_at=now(),ended_by=auth.uid(),ended_reason='replaced' where id=v_current.id;
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
 update public.shipment_trackers set ended_at=now(),ended_by=auth.uid(),ended_reason='unlinked' where id=v_link.id returning * into v_link;
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

COMMIT;

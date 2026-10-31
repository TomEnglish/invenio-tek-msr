-- Administrators can edit and delete PO & Installation links, each with a
-- reason, and both are recorded. Office staff keep what they have today:
-- making links and changing a link's status, dates and notes.
--
-- admin_update_material_link(link, changes, reason, expected) changes a link's
-- PO and installation details: PO number, PO line, PO description, install
-- tag, discipline, install description, quantity and unit. The audit log keeps
-- the old and new values and the reason. With `expected` (the values the form
-- started from) a detail someone else changed meanwhile isn't overwritten.
--
-- admin_delete_material_link(link, reason) deletes a link. Its status history
-- goes with it (on delete cascade) and any tracker pointing at it is unlinked
-- (on delete set null), so the audit log keeps the link, its history and the
-- trackers first. There is still no delete policy: this is the only way.
--
-- A trigger holds the browser's roles to that: a link keeps its number and its
-- project, a new link takes the next number and no other (so a deleted link's
-- number never comes back), and the eight details change only through the
-- function.
BEGIN;

-- Text without whitespace at either end (tabs, line breaks and no-break spaces
-- included); empty text is no value.
create function public.material_link_text(p_value text) returns text
language sql immutable set search_path=pg_catalog as $$
 select nullif(regexp_replace(coalesce(p_value,''),'^[[:space:]'||chr(160)||']+|[[:space:]'||chr(160)||']+$','','g'),'')
$$;

create function public.material_link_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if current_user not in ('anon','authenticated') then
  return new;
 end if;
 if tg_op='INSERT' then
  -- The column default has just drawn the next number; any other number is one the browser chose.
  begin
   if new.id is distinct from currval(pg_get_serial_sequence('public.material_links','id')) then
    raise exception 'A new link takes the next number' using errcode='42501';
   end if;
  exception when object_not_in_prerequisite_state then
   raise exception 'A new link takes the next number' using errcode='42501';
  end;
  return new;
 end if;
 if new.id is distinct from old.id then
  raise exception 'A link keeps its number' using errcode='42501';
 end if;
 if new.project_id is distinct from old.project_id then
  raise exception 'A link stays in its project' using errcode='42501';
 end if;
 if (new.po_id,new.po_line_item,new.po_description,new.install_tag,new.install_discipline,new.install_description,new.quantity,new.uom)
    is distinct from (old.po_id,old.po_line_item,old.po_description,old.install_tag,old.install_discipline,old.install_description,old.quantity,old.uom) then
  raise exception 'Only an administrator can change a link''s PO or installation details, with a reason' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.material_link_guard() from public,anon,authenticated;
create trigger material_link_guard before insert or update on public.material_links for each row execute function public.material_link_guard();

-- p_changes: any of the eight details, by column name, each text, a number or
-- null. Text is trimmed, and empty text clears a detail; the PO number can't
-- be cleared. Only the details being changed are checked.
create function public.admin_update_material_link(p_link_id bigint,p_changes jsonb,p_reason text,p_expected jsonb default null)
returns public.material_links
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_keys constant text[]:=array['po_id','po_line_item','po_description','install_tag','install_discipline','install_description','quantity','uom'];
 v_old public.material_links; v_new public.material_links; v_reason text:=public.material_link_text(p_reason);
 v_values jsonb; v_before jsonb:='{}'; v_after jsonb:='{}'; v_key text;
begin
 if not public.is_admin(auth.uid()) then
  raise exception 'Only an administrator can edit a link' using errcode='42501';
 end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or p_changes='{}'::jsonb then
  raise exception 'Say what to change' using errcode='22023';
 end if;
 select string_agg(k,', ' order by k) into v_key from jsonb_object_keys(p_changes) k where k<>all(v_keys);
 if v_key is not null then
  raise exception 'Only a link''s PO and installation details can be edited here, not %',v_key using errcode='22023';
 end if;
 if exists(select 1 from jsonb_each(p_changes) e where jsonb_typeof(e.value) not in ('string','number','null')) then
  raise exception 'Each detail is text, a number or empty' using errcode='22023';
 end if;
 if p_expected is not null and jsonb_typeof(p_expected)<>'object' then
  raise exception 'What the form started from is a set of details' using errcode='22023';
 end if;
 if coalesce(length(v_reason),0) not between 5 and 500 then
  raise exception 'Give a reason of 5 to 500 characters' using errcode='22023';
 end if;
 select * into v_old from public.material_links where id=p_link_id for update;
 if not found or not public.can_work_project(v_old.project_id) then
  raise exception 'That link isn''t in a project you can change' using errcode='42501';
 end if;
 if p_expected is not null then
  select string_agg(k,', ' order by k) into v_key from jsonb_object_keys(p_changes) k
   where p_expected ? k and (to_jsonb(v_old)->k) is distinct from (p_expected->k);
  if v_key is not null then
   raise exception 'Link #% has changed since the form opened (%); open it again',v_old.id,replace(v_key,'_',' ') using errcode='40001';
  end if;
 end if;
 select jsonb_object_agg(e.key,case when jsonb_typeof(e.value)='string' then to_jsonb(public.material_link_text(e.value#>>'{}')) else e.value end)
   into v_values from jsonb_each(p_changes) e;
 begin
  v_new:=jsonb_populate_record(v_old,v_values);
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'The PO line must be a whole number and the quantity a number' using errcode='22023';
 end;
 if p_changes ? 'po_id' and v_new.po_id is null then
  raise exception 'A link needs a PO number' using errcode='22023';
 end if;
 select string_agg(case k when 'po_id' then 'PO number' when 'po_description' then 'PO description' when 'install_tag' then 'install tag'
   when 'install_description' then 'install description' else 'unit' end,', ' order by k) into v_key
  from jsonb_object_keys(p_changes) k
  where k in ('po_id','po_description','install_tag','install_description','uom') and length(to_jsonb(v_new)->>k)>2000;
 if v_key is not null then
  raise exception 'Too long, at most 2000 characters: %',v_key using errcode='22023';
 end if;
 if p_changes ? 'install_discipline' and v_new.install_discipline not in ('Civil','Electrical','Instrumentation','Mechanical','Steel') then
  raise exception 'The discipline is Civil, Electrical, Instrumentation, Mechanical or Steel' using errcode='22023';
 end if;
 if p_changes ? 'po_line_item' and v_new.po_line_item<0 then
  raise exception 'The PO line can''t be negative' using errcode='22023';
 end if;
 if p_changes ? 'quantity' and v_new.quantity is not null and not (v_new.quantity between 0 and 99999999.99) then
  raise exception 'The quantity must be a number, 0 or more' using errcode='22023';
 end if;
 foreach v_key in array v_keys loop
  if to_jsonb(v_new)->v_key is distinct from to_jsonb(v_old)->v_key then
   v_before:=v_before||jsonb_build_object(v_key,to_jsonb(v_old)->v_key);
   v_after:=v_after||jsonb_build_object(v_key,to_jsonb(v_new)->v_key);
  end if;
 end loop;
 if v_after='{}'::jsonb then
  raise exception 'Nothing would change' using errcode='22023';
 end if;
 update public.material_links set po_id=v_new.po_id,po_line_item=v_new.po_line_item,po_description=v_new.po_description,
  install_tag=v_new.install_tag,install_discipline=v_new.install_discipline,install_description=v_new.install_description,
  quantity=v_new.quantity,uom=v_new.uom,updated_at=now()
  where id=v_old.id returning * into v_new;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'material_link_edited','material_link',null,
   jsonb_build_object('link_id',v_old.id,'before',v_before,'after',v_after,'reason',v_reason),v_old.project_id);
 return v_new;
end $$;
revoke all on function public.admin_update_material_link(bigint,jsonb,text,jsonb) from public,anon;
grant execute on function public.admin_update_material_link(bigint,jsonb,text,jsonb) to authenticated;

create function public.admin_delete_material_link(p_link_id bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_link public.material_links; v_reason text:=public.material_link_text(p_reason); v_history jsonb; v_trackers jsonb;
begin
 if not public.is_admin(auth.uid()) then
  raise exception 'Only an administrator can delete a link' using errcode='42501';
 end if;
 if coalesce(length(v_reason),0) not between 5 and 500 then
  raise exception 'Give a reason of 5 to 500 characters' using errcode='22023';
 end if;
 select * into v_link from public.material_links where id=p_link_id for update;
 if not found or not public.can_work_project(v_link.project_id) then
  raise exception 'That link isn''t in a project you can change' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(to_jsonb(h)-'project_id' order by h.changed_at,h.id),'[]'::jsonb) into v_history
  from public.material_status_history h where h.link_id=v_link.id;
 select coalesce(jsonb_agg(t.id order by t.id),'[]'::jsonb) into v_trackers
  from public.samsara_trackers t where t.linked_material_id=v_link.id;
 insert into public.audit_log(user_id,action,entity_type,entity_id,details,project_id)
  values(auth.uid(),'material_link_deleted','material_link',null,
   jsonb_build_object('link_id',v_link.id,'link',to_jsonb(v_link),'status_history',v_history,'trackers_unlinked',v_trackers,'reason',v_reason),
   v_link.project_id);
 delete from public.material_links where id=v_link.id;
 return jsonb_build_object('link_id',v_link.id,'status_history_removed',jsonb_array_length(v_history),
  'trackers_unlinked',jsonb_array_length(v_trackers));
end $$;
revoke all on function public.admin_delete_material_link(bigint,text) from public,anon;
grant execute on function public.admin_delete_material_link(bigint,text) to authenticated;

COMMIT;

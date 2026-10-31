-- Administrators can edit and delete PO & Installation links, each with a
-- reason, and both are recorded. Office staff keep what they have today:
-- making links and changing a link's status, dates and notes.
--
-- admin_update_material_link(link, changes, reason) changes a link's PO and
-- installation details: PO number, PO line, PO description, install tag,
-- discipline, install description, quantity and unit. The audit log keeps the
-- old and new values and the reason. A trigger refuses those details from the
-- browser any other way, so every such change is recorded.
--
-- admin_delete_material_link(link, reason) deletes a link. Its status history
-- goes with it (on delete cascade) and any tracker pointing at it is unlinked
-- (on delete set null), so the audit log keeps the link, its history and the
-- trackers first. There is still no delete policy: this is the only way.
BEGIN;

-- A link never moves project, and its PO and installation details change only
-- through admin_update_material_link. The browser's roles are held to that;
-- the functions run as their owner.
create function public.material_link_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if current_user in ('anon','authenticated') then
  if new.project_id is distinct from old.project_id then
   raise exception 'A link stays in its project' using errcode='42501';
  end if;
  if (new.po_id,new.po_line_item,new.po_description,new.install_tag,new.install_discipline,new.install_description,new.quantity,new.uom)
     is distinct from (old.po_id,old.po_line_item,old.po_description,old.install_tag,old.install_discipline,old.install_description,old.quantity,old.uom) then
   raise exception 'Only an administrator can change a link''s PO or installation details, with a reason' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.material_link_guard() from public,anon,authenticated;
create trigger material_link_guard before update on public.material_links for each row execute function public.material_link_guard();

-- p_changes: any of the eight details, by column name. Text is trimmed, and
-- empty text clears a detail; the PO number can't be cleared.
create function public.admin_update_material_link(p_link_id bigint,p_changes jsonb,p_reason text) returns public.material_links
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_keys constant text[]:=array['po_id','po_line_item','po_description','install_tag','install_discipline','install_description','quantity','uom'];
 v_old public.material_links; v_new public.material_links; v_reason text:=btrim(coalesce(p_reason,''));
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
 if length(v_reason) not between 5 and 500 then
  raise exception 'Give a reason of 5 to 500 characters' using errcode='22023';
 end if;
 select * into v_old from public.material_links where id=p_link_id for update;
 if not found or not public.can_work_project(v_old.project_id) then
  raise exception 'That link isn''t in a project you can change' using errcode='42501';
 end if;
 select jsonb_object_agg(e.key,case when jsonb_typeof(e.value)='string' then to_jsonb(nullif(btrim(e.value#>>'{}'),'')) else e.value end)
   into v_values from jsonb_each(p_changes) e;
 begin
  v_new:=jsonb_populate_record(v_old,v_values);
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'The PO line must be a whole number and the quantity a number' using errcode='22023';
 end;
 if v_new.po_id is null then
  raise exception 'A link needs a PO number' using errcode='22023';
 end if;
 if length(v_new.po_id)>100 or length(v_new.install_tag)>120 or length(v_new.uom)>16
    or length(v_new.po_description)>500 or length(v_new.install_description)>500 then
  raise exception 'Too long: the PO number is at most 100 characters, the install tag 120, the unit 16 and each description 500' using errcode='22023';
 end if;
 if v_new.install_discipline not in ('Civil','Electrical','Instrumentation','Mechanical','Steel') then
  raise exception 'The discipline is Civil, Electrical, Instrumentation, Mechanical or Steel' using errcode='22023';
 end if;
 if v_new.po_line_item<0 or v_new.quantity<0 then
  raise exception 'The PO line and quantity can''t be negative' using errcode='22023';
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
revoke all on function public.admin_update_material_link(bigint,jsonb,text) from public,anon;
grant execute on function public.admin_update_material_link(bigint,jsonb,text) to authenticated;

create function public.admin_delete_material_link(p_link_id bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_link public.material_links; v_reason text:=btrim(coalesce(p_reason,'')); v_history jsonb; v_trackers jsonb;
begin
 if not public.is_admin(auth.uid()) then
  raise exception 'Only an administrator can delete a link' using errcode='42501';
 end if;
 if length(v_reason) not between 5 and 500 then
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

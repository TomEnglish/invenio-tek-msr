BEGIN;
create function public.project_staff(p_project_id uuid)
returns table(id uuid,full_name text) language sql stable security definer set search_path=public,pg_temp as $$
 select u.id,u.full_name from public.users u join public.user_projects up on up.user_id=u.id
 where public.has_project_access(p_project_id) and up.project_id=p_project_id
 and public.is_active_user(u.id) and u.role in ('office_staff','admin') order by u.full_name;
$$;
revoke all on function public.project_staff(uuid) from public,anon;
grant execute on function public.project_staff(uuid) to authenticated;

-- History is written only by this trigger, in the same transaction as its source.
create or replace function public.track_material_status_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.material_status is distinct from new.material_status then
  insert into public.material_status_history(link_id,old_status,new_status,changed_by,project_id)
   values(new.id,old.material_status,new.material_status,coalesce(auth.uid()::text,'service'),new.project_id);
 end if;
 return new;
end $$;
revoke all on function public.track_material_status_change() from public,anon,authenticated;

COMMIT;

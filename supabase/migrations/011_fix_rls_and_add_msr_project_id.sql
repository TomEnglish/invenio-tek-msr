-- ============================================
-- 010: FIX RLS RECURSION + ADD project_id TO MSR TABLES
-- Applied 2026-03-27 in 3 steps via SQL Editor
-- ============================================

-- STEP 1: Fix infinite recursion in users RLS
drop policy if exists "Users can read profiles based on shared projects" on public.users;
drop policy if exists "Users can update their own name, admins can update anything" on public.users;

create policy "Authenticated users can read users"
  on public.users for select
  using (auth.uid() is not null);

-- STEP 2: Admin helper + policies + project_id columns
create or replace function public.is_admin(check_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.users
    where id = check_user_id and role = 'admin'
  );
end;
$$;

drop policy if exists "Users can update own profile, admins can update any" on public.users;
create policy "Users can update own profile, admins can update any"
  on public.users for update
  using (id = auth.uid() or public.is_admin(auth.uid()))
  with check (id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "Admins can insert projects" on public.projects;
create policy "Admins can insert projects" on public.projects for insert
  with check (public.is_admin(auth.uid()));
drop policy if exists "Admins can update projects" on public.projects;
create policy "Admins can update projects" on public.projects for update
  using (public.is_admin(auth.uid()));
drop policy if exists "Admins can manage user_projects" on public.user_projects;
create policy "Admins can manage user_projects" on public.user_projects for all
  using (public.is_admin(auth.uid()));

alter table public.purchase_orders add column if not exists project_id uuid references public.projects(id);
update public.purchase_orders set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.purchase_orders alter column project_id set not null;

alter table public.shipments add column if not exists project_id uuid references public.projects(id);
update public.shipments set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.shipments alter column project_id set not null;

alter table public.dashboard_metrics add column if not exists project_id uuid references public.projects(id);
update public.dashboard_metrics set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.dashboard_metrics alter column project_id set not null;

alter table public.material_links add column if not exists project_id uuid references public.projects(id);
update public.material_links set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.material_links alter column project_id set not null;

alter table public.material_status_history add column if not exists project_id uuid references public.projects(id);
update public.material_status_history set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;

alter table public.samsara_trackers add column if not exists project_id uuid references public.projects(id);
update public.samsara_trackers set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.samsara_trackers alter column project_id set not null;

alter table public.samsara_location_history add column if not exists project_id uuid references public.projects(id);
update public.samsara_location_history set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;

alter table public.delivery_dates add column if not exists project_id uuid references public.projects(id);
update public.delivery_dates set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.delivery_dates alter column project_id set not null;

alter table public.project_schedule add column if not exists project_id uuid references public.projects(id);
update public.project_schedule set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.project_schedule alter column project_id set not null;

-- STEP 3: Recreate views with project_id
drop view if exists public.vw_po_summary;
create view public.vw_po_summary as
select project_id, count(distinct purchase_order_id) as total_pos, count(*) as total_line_items,
  coalesce(sum(net_value), 0) as total_value,
  count(case when status = 'Open' then 1 end) as open_pos,
  count(case when status = 'Closed' then 1 end) as closed_pos
from public.purchase_orders group by project_id;

drop view if exists public.vw_shipment_summary;
create view public.vw_shipment_summary as
select project_id, count(*) as total_shipments,
  count(case when status = 'Delivered' then 1 end) as delivered,
  count(case when status = 'In Transit' then 1 end) as in_transit,
  count(case when status = 'Not RTS' then 1 end) as not_rts
from public.shipments group by project_id;

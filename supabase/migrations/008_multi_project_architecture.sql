-- Migration: Add Multi-Project Architecture
-- Creates `projects`, `user_projects`, links existing tables to a default project,
-- updates RLS policies and dashboard views to respect `project_id`.

-- 1. Create projects table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz default now()
);

alter table public.projects enable row level security;

-- 2. Create user_projects table
create table if not exists public.user_projects (
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, project_id)
);

alter table public.user_projects enable row level security;

create policy "Users can read their own project assignments"
  on public.user_projects for select
  using (user_id = auth.uid());

create policy "Admins can manage user_projects"
  on public.user_projects for all
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );


-- 2.5 Create policies for projects table (needs user_projects to exist)
create policy "Users can read assigned projects"
  on public.projects for select
  using (
    exists (
      select 1 from public.user_projects up
      where up.user_id = auth.uid() and up.project_id = id
    )
  );

create policy "Admins can insert projects"
  on public.projects for insert
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

create policy "Admins can update projects"
  on public.projects for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );


-- 3. Insert Default Project & Assign Users
insert into public.projects (id, name, description)
values ('00000000-0000-0000-0000-000000000000', 'Main Yard', 'Default project for existing records')
on conflict (id) do nothing;

insert into public.user_projects (user_id, project_id)
select id, '00000000-0000-0000-0000-000000000000' from public.users
on conflict do nothing;


-- 4. Add project_id to tables and backfill
alter table public.locations add column project_id uuid references public.projects(id);
update public.locations set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.locations alter column project_id set not null;

alter table public.qr_codes add column project_id uuid references public.projects(id);
update public.qr_codes set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.qr_codes alter column project_id set not null;

alter table public.receiving_records add column project_id uuid references public.projects(id);
update public.receiving_records set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.receiving_records alter column project_id set not null;

alter table public.materials add column project_id uuid references public.projects(id);
update public.materials set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.materials alter column project_id set not null;

alter table public.material_movements add column project_id uuid references public.projects(id);
update public.material_movements set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.material_movements alter column project_id set not null;

alter table public.material_issues add column project_id uuid references public.projects(id);
update public.material_issues set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.material_issues alter column project_id set not null;

alter table public.shipments_out add column project_id uuid references public.projects(id);
update public.shipments_out set project_id = '00000000-0000-0000-0000-000000000000' where project_id is null;
alter table public.shipments_out alter column project_id set not null;


-- 5. Recreate RLS Policies to scope to project_id

-- LOCATIONS
drop policy if exists "Authenticated users can read locations" on public.locations;
create policy "Authenticated users can read locations" on public.locations for select
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = locations.project_id));

drop policy if exists "Office staff and admins can insert locations" on public.locations;
create policy "Office staff and admins can insert locations" on public.locations for insert
with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('office_staff', 'admin'))
  and exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id)
);

drop policy if exists "Office staff and admins can update locations" on public.locations;
create policy "Office staff and admins can update locations" on public.locations for update
using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('office_staff', 'admin'))
  and exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id)
);

-- QR CODES
drop policy if exists "Authenticated users can read qr_codes" on public.qr_codes;
create policy "Authenticated users can read qr_codes" on public.qr_codes for select
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = qr_codes.project_id));

drop policy if exists "Authenticated users can insert qr_codes" on public.qr_codes;
create policy "Authenticated users can insert qr_codes" on public.qr_codes for insert
with check (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));

drop policy if exists "Office staff and admins can update qr_codes" on public.qr_codes;
drop policy if exists "Authenticated users can update qr_codes" on public.qr_codes;
create policy "Authenticated users can update qr_codes" on public.qr_codes for update
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));

-- RECEIVING RECORDS
drop policy if exists "Authenticated users can read receiving_records" on public.receiving_records;
create policy "Authenticated users can read receiving_records" on public.receiving_records for select
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = receiving_records.project_id));

drop policy if exists "Authenticated users can insert receiving_records" on public.receiving_records;
create policy "Authenticated users can insert receiving_records" on public.receiving_records for insert
with check (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));

drop policy if exists "Office staff and admins can update receiving_records" on public.receiving_records;
create policy "Office staff and admins can update receiving_records" on public.receiving_records for update
using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('office_staff', 'admin'))
  and exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id)
);

-- MATERIALS
drop policy if exists "Authenticated users can read materials" on public.materials;
create policy "Authenticated users can read materials" on public.materials for select
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = materials.project_id));

drop policy if exists "Authenticated users can insert materials" on public.materials;
create policy "Authenticated users can insert materials" on public.materials for insert
with check (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));

drop policy if exists "Authenticated users can update materials" on public.materials;
create policy "Authenticated users can update materials" on public.materials for update
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));

-- MATERIAL MOVEMENTS
drop policy if exists "Authenticated users can read material_movements" on public.material_movements;
create policy "Authenticated users can read material_movements" on public.material_movements for select
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = material_movements.project_id));

drop policy if exists "Authenticated users can insert material_movements" on public.material_movements;
create policy "Authenticated users can insert material_movements" on public.material_movements for insert
with check (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));

-- MATERIAL ISSUES
drop policy if exists "Authenticated users can read material_issues" on public.material_issues;
create policy "Authenticated users can read material_issues" on public.material_issues for select
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = material_issues.project_id));

drop policy if exists "Authenticated users can insert material_issues" on public.material_issues;
create policy "Authenticated users can insert material_issues" on public.material_issues for insert
with check (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));

-- SHIPMENTS OUT
drop policy if exists "Authenticated users can read shipments_out" on public.shipments_out;
create policy "Authenticated users can read shipments_out" on public.shipments_out for select
using (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = shipments_out.project_id));

drop policy if exists "Authenticated users can insert shipments_out" on public.shipments_out;
create policy "Authenticated users can insert shipments_out" on public.shipments_out for insert
with check (exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = project_id));


-- 6. Recreate Dashboard Views with project_id

drop view if exists public.v_inventory_summary;
create or replace view public.v_inventory_summary as
select
  project_id,
  material_type,
  status,
  count(*) as item_count,
  coalesce(sum(current_quantity), 0) as total_quantity,
  coalesce(sum(weight), 0) as total_weight
from public.materials
group by project_id, material_type, status;

drop view if exists public.v_aging_report;
create or replace view public.v_aging_report as
select
  m.id,
  m.project_id,
  m.material_type,
  m.size,
  m.grade,
  m.current_quantity,
  m.status,
  l.zone,
  l.row,
  l.rack,
  m.created_at,
  extract(day from now() - m.created_at) as days_in_yard
from public.materials m
left join public.locations l on l.id = m.location_id
where m.status = 'in_yard';

drop view if exists public.v_exception_summary;
create or replace view public.v_exception_summary as
select
  r.id,
  r.project_id,
  r.material_type,
  r.exception_type,
  r.has_exception,
  r.exception_resolved,
  r.exception_resolution,
  r.vendor,
  r.po_number,
  r.condition,
  r.damage_notes,
  r.created_at,
  u.full_name as created_by_name
from public.receiving_records r
left join public.users u on u.id = r.created_by
where r.has_exception = true;

drop view if exists public.v_yard_overview;
create or replace view public.v_yard_overview as
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
group by l.id, l.project_id, l.zone, l.row, l.rack, l.is_hold_area, l.capacity;

-- Phase 4: Materials, movements, issues, shipments

-- ============================================
-- MATERIALS
-- ============================================
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  receiving_record_id uuid not null references public.receiving_records(id),
  qr_code_id uuid not null references public.qr_codes(id),
  material_type text not null,
  size text,
  grade text,
  qty integer not null,
  current_quantity integer not null,
  weight numeric,
  spec text,
  location_id uuid references public.locations(id),
  status text not null default 'in_yard'
    check (status in ('in_yard', 'issued', 'shipped', 'depleted')),
  created_at timestamptz default now()
);

alter table public.materials enable row level security;

create policy "Authenticated users can read materials"
  on public.materials for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert materials"
  on public.materials for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update materials"
  on public.materials for update
  using (auth.uid() is not null);

-- ============================================
-- MATERIAL MOVEMENTS
-- ============================================
create table if not exists public.material_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid not null references public.locations(id),
  moved_by uuid not null references public.users(id),
  reason text,
  created_at timestamptz default now()
);

alter table public.material_movements enable row level security;

create policy "Authenticated users can read material_movements"
  on public.material_movements for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert material_movements"
  on public.material_movements for insert
  with check (auth.uid() is not null);

-- ============================================
-- MATERIAL ISSUES
-- ============================================
create table if not exists public.material_issues (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id),
  job_number text not null,
  work_order text,
  quantity_issued integer not null,
  issued_by uuid not null references public.users(id),
  created_at timestamptz default now()
);

alter table public.material_issues enable row level security;

create policy "Authenticated users can read material_issues"
  on public.material_issues for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert material_issues"
  on public.material_issues for insert
  with check (auth.uid() is not null);

-- ============================================
-- SHIPMENTS OUT
-- ============================================
create table if not exists public.shipments_out (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id),
  destination text not null,
  carrier text,
  tracking_number text,
  quantity_shipped integer not null,
  created_at timestamptz default now()
);

alter table public.shipments_out enable row level security;

create policy "Authenticated users can read shipments_out"
  on public.shipments_out for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert shipments_out"
  on public.shipments_out for insert
  with check (auth.uid() is not null);

-- Phase 2: Receiving records and inspection photos

-- ============================================
-- RECEIVING RECORDS
-- ============================================
create table if not exists public.receiving_records (
  id uuid primary key default gen_random_uuid(),
  qr_code_id uuid not null references public.qr_codes(id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'partially_accepted', 'rejected')),
  material_type text not null,
  size text,
  grade text,
  qty integer not null,
  weight numeric,
  description text,
  spec text,
  vendor text,
  po_number text,
  delivery_ticket text,
  carrier text,
  condition text not null default 'good'
    check (condition in ('good', 'damaged', 'mixed')),
  damage_notes text,
  inspection_pass boolean default true,
  has_exception boolean default false,
  exception_type text check (exception_type in ('wrong_type', 'wrong_count', 'damage')),
  exception_resolved boolean default false,
  exception_resolution text check (exception_resolution in ('hold', 'return_to_vendor')),
  location_id uuid references public.locations(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz default now()
);

alter table public.receiving_records enable row level security;

-- All authenticated users can read receiving records
create policy "Authenticated users can read receiving_records"
  on public.receiving_records for select
  using (auth.uid() is not null);

-- Authenticated users can create receiving records
create policy "Authenticated users can insert receiving_records"
  on public.receiving_records for insert
  with check (auth.uid() is not null);

-- Office staff and admins can update (for exception resolution)
create policy "Office staff and admins can update receiving_records"
  on public.receiving_records for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('office_staff', 'admin')
    )
  );

-- ============================================
-- INSPECTION PHOTOS
-- ============================================
create table if not exists public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  receiving_record_id uuid not null references public.receiving_records(id) on delete cascade,
  storage_path text not null,
  photo_type text not null check (photo_type in ('damage', 'general', 'delivery_ticket')),
  created_at timestamptz default now()
);

alter table public.inspection_photos enable row level security;

create policy "Authenticated users can read inspection_photos"
  on public.inspection_photos for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert inspection_photos"
  on public.inspection_photos for insert
  with check (auth.uid() is not null);

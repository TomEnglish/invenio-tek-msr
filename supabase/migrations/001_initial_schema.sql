-- Phase 1: Core tables — users, locations, qr_codes
-- Run this in the Supabase SQL Editor or via supabase db push

-- ============================================
-- USERS
-- ============================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('field_worker', 'office_staff', 'admin')),
  created_at timestamptz default now()
);

alter table public.users enable row level security;

-- All authenticated users can read user profiles
-- (avoids infinite recursion from self-referencing role checks)
create policy "Authenticated users can read users"
  on public.users for select
  using (auth.uid() is not null);

-- ============================================
-- LOCATIONS
-- ============================================
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  zone text not null,
  row text not null,
  rack text not null,
  is_hold_area boolean default false,
  capacity integer,
  created_at timestamptz default now()
);

alter table public.locations enable row level security;

-- All authenticated users can read locations
create policy "Authenticated users can read locations"
  on public.locations for select
  using (auth.uid() is not null);

-- Only office staff and admins can manage locations
create policy "Office staff and admins can insert locations"
  on public.locations for insert
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('office_staff', 'admin')
    )
  );

create policy "Office staff and admins can update locations"
  on public.locations for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('office_staff', 'admin')
    )
  );

-- ============================================
-- QR CODES
-- ============================================
create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  code_value text unique not null,
  entity_type text not null check (entity_type in ('item', 'pallet', 'shipment')),
  entity_id uuid,
  created_at timestamptz default now()
);

alter table public.qr_codes enable row level security;

-- All authenticated users can read QR codes
create policy "Authenticated users can read qr_codes"
  on public.qr_codes for select
  using (auth.uid() is not null);

-- All authenticated users can insert QR codes (field workers create during scan)
create policy "Authenticated users can insert qr_codes"
  on public.qr_codes for insert
  with check (auth.uid() is not null);

-- Office staff and admins can update QR codes
create policy "Office staff and admins can update qr_codes"
  on public.qr_codes for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('office_staff', 'admin')
    )
  );

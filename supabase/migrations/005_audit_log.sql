-- Audit log for tracking all significant actions
create table public.audit_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id),
  action text not null,          -- e.g. 'receiving_created', 'material_transferred', 'material_issued', 'shipment_created', 'exception_resolved', 'qr_batch_created'
  entity_type text not null,     -- e.g. 'receiving_record', 'material', 'shipment', 'qr_code'
  entity_id uuid,
  details jsonb default '{}',    -- Additional context (qty, destination, etc.)
  created_at timestamptz default now()
);

-- Index for querying by entity
create index idx_audit_log_entity on public.audit_log(entity_type, entity_id);
-- Index for querying by user
create index idx_audit_log_user on public.audit_log(user_id);
-- Index for recent activity
create index idx_audit_log_created on public.audit_log(created_at desc);

-- RLS
alter table public.audit_log enable row level security;

-- All authenticated users can read the audit log
create policy "Authenticated users can read audit log"
  on public.audit_log for select
  using (auth.uid() is not null);

-- All authenticated users can insert (logging happens from the app)
create policy "Authenticated users can insert audit log"
  on public.audit_log for insert
  with check (auth.uid() is not null);

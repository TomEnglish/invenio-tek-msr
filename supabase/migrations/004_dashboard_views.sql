-- Phase 5: Dashboard views for reporting

-- Inventory summary by type and status
create or replace view public.v_inventory_summary as
select
  material_type,
  status,
  count(*) as item_count,
  coalesce(sum(current_quantity), 0) as total_quantity,
  coalesce(sum(weight), 0) as total_weight
from public.materials
group by material_type, status;

-- Aging report — materials in yard for X days
create or replace view public.v_aging_report as
select
  m.id,
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

-- Exception summary
create or replace view public.v_exception_summary as
select
  r.id,
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

-- Yard overview — location utilization
create or replace view public.v_yard_overview as
select
  l.id as location_id,
  l.zone,
  l.row,
  l.rack,
  l.is_hold_area,
  l.capacity,
  count(m.id) as items_stored,
  coalesce(sum(m.current_quantity), 0) as total_quantity
from public.locations l
left join public.materials m on m.location_id = l.id and m.status = 'in_yard'
group by l.id, l.zone, l.row, l.rack, l.is_hold_area, l.capacity;

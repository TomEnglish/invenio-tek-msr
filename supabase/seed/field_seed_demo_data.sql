-- ============================================
-- DEMO SEED DATA — QR Asset Scanner
-- Run this in Supabase SQL Editor after all migrations.
-- Creates realistic laydown yard demo data.
-- ============================================

-- NOTE: You must create auth users manually in Supabase Auth dashboard first,
-- then insert matching rows here with the correct UUIDs.
-- Replace the UUIDs below with your actual auth user IDs.

-- ============================================
-- 1. LOCATIONS — typical yard layout
-- ============================================
insert into public.locations (zone, row, rack, capacity, is_hold_area, project_id) values
  ('A', '1', '1', 50, false, '00000000-0000-0000-0000-000000000000'),
  ('A', '1', '2', 50, false, '00000000-0000-0000-0000-000000000000'),
  ('A', '1', '3', 50, false, '00000000-0000-0000-0000-000000000000'),
  ('A', '2', '1', 50, false, '00000000-0000-0000-0000-000000000000'),
  ('A', '2', '2', 50, false, '00000000-0000-0000-0000-000000000000'),
  ('B', '1', '1', 30, false, '00000000-0000-0000-0000-000000000000'),
  ('B', '1', '2', 30, false, '00000000-0000-0000-0000-000000000000'),
  ('B', '2', '1', 30, false, '00000000-0000-0000-0000-000000000000'),
  ('C', '1', '1', 20, false, '00000000-0000-0000-0000-000000000000'),
  ('C', '1', '2', 20, false, '00000000-0000-0000-0000-000000000000'),
  ('HOLD', '1', '1', 10, true, '00000000-0000-0000-0000-000000000000'),
  ('HOLD', '1', '2', 10, true, '00000000-0000-0000-0000-000000000000')
on conflict do nothing;

-- ============================================
-- 2. QR CODES — pre-generated labels
-- ============================================
insert into public.qr_codes (code_value, entity_type, project_id) values
  ('QR-A1B2C3D4', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-E5F6G7H8', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-I9J0K1L2', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-M3N4O5P6', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-Q7R8S9T0', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-U1V2W3X4', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-Y5Z6A7B8', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-C9D0E1F2', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-G3H4I5J6', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-K7L8M9N0', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-AVAIL001', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-AVAIL002', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-AVAIL003', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-AVAIL004', 'item', '00000000-0000-0000-0000-000000000000'),
  ('QR-AVAIL005', 'item', '00000000-0000-0000-0000-000000000000')
on conflict do nothing;

-- ============================================
-- 3. RECEIVING RECORDS, MATERIALS, MOVEMENTS, ISSUES, SHIPMENTS
-- ============================================
do $$
declare
  loc_a1_1 uuid; loc_a1_2 uuid; loc_a2_1 uuid;
  loc_b1_1 uuid; loc_b1_2 uuid; loc_c1_1 uuid; loc_hold uuid;
  qr1 uuid; qr2 uuid; qr3 uuid; qr4 uuid; qr5 uuid;
  qr6 uuid; qr7 uuid; qr8 uuid; qr9 uuid; qr10 uuid;
  rec1 uuid; rec2 uuid; rec3 uuid; rec4 uuid; rec5 uuid;
  rec6 uuid; rec7 uuid; rec8 uuid; rec9 uuid; rec10 uuid;
  demo_user uuid;
  proj uuid := '00000000-0000-0000-0000-000000000000';
begin
  select id into loc_a1_1 from locations where zone='A' and row='1' and rack='1' limit 1;
  select id into loc_a1_2 from locations where zone='A' and row='1' and rack='2' limit 1;
  select id into loc_a2_1 from locations where zone='A' and row='2' and rack='1' limit 1;
  select id into loc_b1_1 from locations where zone='B' and row='1' and rack='1' limit 1;
  select id into loc_b1_2 from locations where zone='B' and row='1' and rack='2' limit 1;
  select id into loc_c1_1 from locations where zone='C' and row='1' and rack='1' limit 1;
  select id into loc_hold  from locations where zone='HOLD' and row='1' and rack='1' limit 1;

  select id into qr1  from qr_codes where code_value='QR-A1B2C3D4';
  select id into qr2  from qr_codes where code_value='QR-E5F6G7H8';
  select id into qr3  from qr_codes where code_value='QR-I9J0K1L2';
  select id into qr4  from qr_codes where code_value='QR-M3N4O5P6';
  select id into qr5  from qr_codes where code_value='QR-Q7R8S9T0';
  select id into qr6  from qr_codes where code_value='QR-U1V2W3X4';
  select id into qr7  from qr_codes where code_value='QR-Y5Z6A7B8';
  select id into qr8  from qr_codes where code_value='QR-C9D0E1F2';
  select id into qr9  from qr_codes where code_value='QR-G3H4I5J6';
  select id into qr10 from qr_codes where code_value='QR-K7L8M9N0';

  select id into demo_user from users limit 1;

  if demo_user is null then
    raise notice 'No users found — create at least one user first, then re-run.';
    return;
  end if;

  -- RECEIVING RECORDS (10 items)
  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, inspection_pass, has_exception, location_id, created_by, project_id, created_at)
  values (qr1, 'accepted', 'Steel Pipe', '6 inch', 'A106-B', 100, 5200, 'US Steel Supply', 'PO-2024-001', 'FedEx Freight', 'good', true, false, loc_a1_1, demo_user, proj, now() - interval '60 days')
  returning id into rec1;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, inspection_pass, has_exception, location_id, created_by, project_id, created_at)
  values (qr2, 'accepted', 'Steel Plate', '1/2 inch', 'A516-70', 50, 12000, 'Metro Metals', 'PO-2024-002', 'XPO Logistics', 'good', true, false, loc_a1_2, demo_user, proj, now() - interval '45 days')
  returning id into rec2;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, inspection_pass, has_exception, location_id, created_by, project_id, created_at)
  values (qr3, 'accepted', 'Flanges', '8 inch 150#', 'A105', 200, 3400, 'Boltex Manufacturing', 'PO-2024-003', 'Estes Express', 'good', true, false, loc_a2_1, demo_user, proj, now() - interval '30 days')
  returning id into rec3;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, inspection_pass, has_exception, location_id, created_by, project_id, created_at)
  values (qr4, 'accepted', 'Valves', '4 inch Gate', 'A216-WCB', 30, 900, 'ValvTechnologies', 'PO-2024-004', 'Old Dominion', 'good', true, false, loc_b1_1, demo_user, proj, now() - interval '20 days')
  returning id into rec4;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, damage_notes, inspection_pass, has_exception, exception_type, location_id, created_by, project_id, created_at)
  values (qr5, 'partially_accepted', 'Fittings', '6 inch Elbow', 'A234-WPB', 80, 1600, 'Anvil International', 'PO-2024-005', 'R+L Carriers', 'damaged', '12 elbows have visible cracks on weld seams, separated to hold area', false, true, 'damage', loc_hold, demo_user, proj, now() - interval '15 days')
  returning id into rec5;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, inspection_pass, has_exception, location_id, created_by, project_id, created_at)
  values (qr6, 'accepted', 'Steel Pipe', '4 inch', 'A106-B', 150, 4500, 'US Steel Supply', 'PO-2024-006', 'FedEx Freight', 'good', true, false, loc_b1_2, demo_user, proj, now() - interval '10 days')
  returning id into rec6;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, inspection_pass, has_exception, location_id, created_by, project_id, created_at)
  values (qr7, 'accepted', 'Bolts/Studs', '3/4 x 4-1/2', 'B7/2H', 500, 800, 'Portland Bolt', 'PO-2024-007', 'UPS Freight', 'good', true, false, loc_c1_1, demo_user, proj, now() - interval '7 days')
  returning id into rec7;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, damage_notes, inspection_pass, has_exception, exception_type, location_id, created_by, project_id, created_at)
  values (qr8, 'partially_accepted', 'Gaskets', '8 inch Spiral Wound', 'SS316', 100, 120, 'Flexitallic', 'PO-2024-008', 'FedEx Ground', 'good', 'PO says 150, only 100 received. Carrier docs match 100.', true, true, 'wrong_count', loc_c1_1, demo_user, proj, now() - interval '5 days')
  returning id into rec8;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, inspection_pass, has_exception, location_id, created_by, project_id, created_at)
  values (qr9, 'accepted', 'Steel Plate', '3/4 inch', 'A516-70', 25, 8500, 'Metro Metals', 'PO-2024-009', 'XPO Logistics', 'good', true, false, loc_a1_1, demo_user, proj, now() - interval '3 days')
  returning id into rec9;

  insert into receiving_records (qr_code_id, status, material_type, size, grade, qty, weight, vendor, po_number, carrier, condition, damage_notes, inspection_pass, has_exception, exception_type, location_id, created_by, project_id, created_at)
  values (qr10, 'rejected', 'Steel Pipe', '8 inch', 'A106-B', 40, 2800, 'Gulf Pipe Supply', 'PO-2024-010', 'Saia LTL', 'good', 'Ordered 8 inch A333-6, received A106-B instead. Wrong spec for low-temp service.', true, true, 'wrong_type', loc_hold, demo_user, proj, now() - interval '1 day')
  returning id into rec10;

  update receiving_records set exception_resolved = true, exception_resolution = 'hold' where id = rec5;

  -- MATERIALS
  insert into materials (receiving_record_id, qr_code_id, material_type, size, grade, qty, current_quantity, weight, location_id, status, project_id, created_at) values
    (rec1, qr1, 'Steel Pipe', '6 inch', 'A106-B', 100, 72, 5200, loc_a1_1, 'in_yard', proj, now() - interval '60 days'),
    (rec2, qr2, 'Steel Plate', '1/2 inch', 'A516-70', 50, 50, 12000, loc_a1_2, 'in_yard', proj, now() - interval '45 days'),
    (rec3, qr3, 'Flanges', '8 inch 150#', 'A105', 200, 140, 3400, loc_a2_1, 'in_yard', proj, now() - interval '30 days'),
    (rec4, qr4, 'Valves', '4 inch Gate', 'A216-WCB', 30, 30, 900, loc_b1_1, 'in_yard', proj, now() - interval '20 days'),
    (rec5, qr5, 'Fittings', '6 inch Elbow', 'A234-WPB', 80, 80, 1600, loc_hold, 'in_yard', proj, now() - interval '15 days'),
    (rec6, qr6, 'Steel Pipe', '4 inch', 'A106-B', 150, 150, 4500, loc_b1_2, 'in_yard', proj, now() - interval '10 days'),
    (rec7, qr7, 'Bolts/Studs', '3/4 x 4-1/2', 'B7/2H', 500, 350, 800, loc_c1_1, 'in_yard', proj, now() - interval '7 days'),
    (rec8, qr8, 'Gaskets', '8 inch Spiral Wound', 'SS316', 100, 100, 120, loc_c1_1, 'in_yard', proj, now() - interval '5 days'),
    (rec9, qr9, 'Steel Plate', '3/4 inch', 'A516-70', 25, 25, 8500, loc_a1_1, 'in_yard', proj, now() - interval '3 days');

  -- MATERIAL MOVEMENTS
  insert into material_movements (material_id, from_location_id, to_location_id, moved_by, reason, project_id, created_at)
  select m.id, loc_b1_1, loc_hold, demo_user, 'Damaged items separated to hold area for inspection', proj, now() - interval '14 days'
  from materials m where m.qr_code_id = qr5;

  -- MATERIAL ISSUES
  insert into material_issues (material_id, job_number, work_order, quantity_issued, issued_by, project_id, created_at)
  select m.id, 'JOB-1001', 'WO-5501', 28, demo_user, proj, now() - interval '25 days'
  from materials m where m.qr_code_id = qr1;

  insert into material_issues (material_id, job_number, work_order, quantity_issued, issued_by, project_id, created_at)
  select m.id, 'JOB-1002', 'WO-5510', 150, demo_user, proj, now() - interval '3 days'
  from materials m where m.qr_code_id = qr7;

  -- SHIPMENTS OUT
  insert into shipments_out (material_id, destination, carrier, tracking_number, quantity_shipped, project_id, created_at)
  select m.id, 'Satellite Yard - Houston East', 'FedEx Freight', 'FX-7789001234', 60, proj, now() - interval '12 days'
  from materials m where m.qr_code_id = qr3;

  -- Link QR codes to materials
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr1) where id = qr1;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr2) where id = qr2;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr3) where id = qr3;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr4) where id = qr4;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr5) where id = qr5;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr6) where id = qr6;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr7) where id = qr7;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr8) where id = qr8;
  update qr_codes set entity_id = (select m.id from materials m where m.qr_code_id = qr9) where id = qr9;

  -- AUDIT LOG
  insert into audit_log (user_id, action, entity_type, details, created_at) values
    (demo_user, 'receiving_created', 'receiving_record', '{"material_type":"Steel Pipe","qty":100,"vendor":"US Steel Supply"}', now() - interval '60 days'),
    (demo_user, 'receiving_created', 'receiving_record', '{"material_type":"Steel Plate","qty":50,"vendor":"Metro Metals"}', now() - interval '45 days'),
    (demo_user, 'receiving_created', 'receiving_record', '{"material_type":"Flanges","qty":200,"vendor":"Boltex Manufacturing"}', now() - interval '30 days'),
    (demo_user, 'material_issued', 'material', '{"job_number":"JOB-1001","quantity":28,"type":"Steel Pipe 6 inch"}', now() - interval '25 days'),
    (demo_user, 'exception_flagged', 'receiving_record', '{"type":"damage","material":"Fittings 6 inch Elbow","vendor":"Anvil International"}', now() - interval '15 days'),
    (demo_user, 'material_transferred', 'material', '{"from":"B-1-1","to":"HOLD-1-1","reason":"Damaged items to hold"}', now() - interval '14 days'),
    (demo_user, 'exception_resolved', 'receiving_record', '{"resolution":"hold","material":"Fittings"}', now() - interval '13 days'),
    (demo_user, 'shipment_created', 'material', '{"destination":"Houston East","quantity":60,"type":"Flanges"}', now() - interval '12 days'),
    (demo_user, 'receiving_created', 'receiving_record', '{"material_type":"Bolts/Studs","qty":500,"vendor":"Portland Bolt"}', now() - interval '7 days'),
    (demo_user, 'exception_flagged', 'receiving_record', '{"type":"wrong_count","material":"Gaskets","expected":150,"received":100}', now() - interval '5 days'),
    (demo_user, 'receiving_created', 'receiving_record', '{"material_type":"Steel Plate","qty":25,"vendor":"Metro Metals"}', now() - interval '3 days'),
    (demo_user, 'material_issued', 'material', '{"job_number":"JOB-1002","quantity":150,"type":"Bolts/Studs"}', now() - interval '3 days'),
    (demo_user, 'exception_flagged', 'receiving_record', '{"type":"wrong_type","material":"Steel Pipe 8 inch","expected":"A333-6","received":"A106-B"}', now() - interval '1 day');

  raise notice 'Demo data seeded successfully!';
end $$;

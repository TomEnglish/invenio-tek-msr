-- ============================================
-- Sample yard records for three projects (Main Yard, North Site, South Site).
-- Part of supabase/seed/dev_seed.sql, which loads this only into a dev database
-- whose yard tables are empty. It adds rows only: it deletes nothing, changes no existing row,
-- and changes nobody's project access except to add the author to the sample projects.
-- ============================================

do $$
declare
  demo_user uuid;
  p_main uuid := '00000000-0000-0000-0000-000000000000';
  p_north uuid := '11111111-1111-1111-1111-111111111111';
  p_south uuid := '22222222-2222-2222-2222-222222222222';
  
  l_main_1 uuid; l_main_hold uuid;
  l_north_1 uuid; l_north_hold uuid;
  l_south_1 uuid;

  qr_m1 uuid; qr_m2 uuid; qr_m3 uuid;
  qr_n1 uuid; qr_n2 uuid;
  qr_s1 uuid; qr_s2 uuid;

  rec_m1 uuid; rec_m2 uuid; rec_m3 uuid;
  rec_n1 uuid; rec_n2 uuid;
  rec_s1 uuid; rec_s2 uuid;
begin
  -- 1. The sample records are written in the administrator's name: one who has
  -- finished setup if there is one, otherwise the one whose invitation is
  -- outstanding. A withdrawn or deactivated account is never used.
  select id into demo_user from public.users
   where role = 'admin' and is_active and invitation_status <> 'cancelled'
   order by (invitation_status = 'accepted') desc, created_at, id limit 1;
  if demo_user is null then
    raise exception 'Create the first administrator before loading sample data (scripts/create-first-admin.mjs)';
  end if;

  -- 2. Create Additional Projects
  insert into public.projects (id, name, description) values
    (p_north, 'North Site', 'Secondary laydown yard for pipeline expansion'),
    (p_south, 'South Site', 'Downtown distribution and staging area')
  on conflict (id) do nothing;

  -- 3. The author can open the three sample projects. Nobody else's access changes.
  insert into public.user_projects (user_id, project_id)
  select demo_user, p.id from public.projects p where p.id in (p_main, p_north, p_south)
  on conflict do nothing;

  -- 5. Create Locations per project
  -- Main Yard
  insert into public.locations (project_id, zone, row, rack, capacity, is_hold_area) values
    (p_main, 'A', '1', '1', 50, false) returning id into l_main_1;
  insert into public.locations (project_id, zone, row, rack, capacity, is_hold_area) values
    (p_main, 'HOLD', '1', '1', 10, true) returning id into l_main_hold;
  
  -- North Site
  insert into public.locations (project_id, zone, row, rack, capacity, is_hold_area) values
    (p_north, 'N1', 'A', '1', 100, false) returning id into l_north_1;
  insert into public.locations (project_id, zone, row, rack, capacity, is_hold_area) values
    (p_north, 'N-HOLD', '1', '1', 20, true) returning id into l_north_hold;

  -- South Site
  insert into public.locations (project_id, zone, row, rack, capacity, is_hold_area) values
    (p_south, 'S1', '1', 'A', 60, false) returning id into l_south_1;

  -- 6. Create QR Codes per project
  insert into public.qr_codes (project_id, code_value, entity_type) values (p_main, 'QR-MAIN-101', 'item') returning id into qr_m1;
  insert into public.qr_codes (project_id, code_value, entity_type) values (p_main, 'QR-MAIN-102', 'item') returning id into qr_m2;
  insert into public.qr_codes (project_id, code_value, entity_type) values (p_main, 'QR-MAIN-103', 'item') returning id into qr_m3;
  
  insert into public.qr_codes (project_id, code_value, entity_type) values (p_north, 'QR-NORTH-201', 'item') returning id into qr_n1;
  insert into public.qr_codes (project_id, code_value, entity_type) values (p_north, 'QR-NORTH-202', 'item') returning id into qr_n2;
  
  insert into public.qr_codes (project_id, code_value, entity_type) values (p_south, 'QR-SOUTH-301', 'item') returning id into qr_s1;
  insert into public.qr_codes (project_id, code_value, entity_type) values (p_south, 'QR-SOUTH-302', 'item') returning id into qr_s2;

  -- 7. Receiving Records
  -- MAIN YARD Records
  insert into public.receiving_records (project_id, qr_code_id, status, material_type, size, grade, qty, vendor, location_id, created_by, created_at, has_exception, inspection_pass)
  values (p_main, qr_m1, 'accepted', 'Steel Pipe', '6 inch', 'A106-B', 100, 'US Steel Supply', l_main_1, demo_user, now() - interval '10 days', false, true) returning id into rec_m1;

  insert into public.receiving_records (project_id, qr_code_id, status, material_type, size, grade, qty, vendor, location_id, created_by, created_at, has_exception, exception_type, exception_resolved, damage_notes)
  values (p_main, qr_m2, 'partially_accepted', 'Fittings', '6 inch Elbow', 'A234-WPB', 50, 'Anvil Intl', l_main_hold, demo_user, now() - interval '5 days', true, 'damage', false, 'Cracks on 5 items') returning id into rec_m2;

  -- NORTH SITE Records (Electrical & Tech)
  insert into public.receiving_records (project_id, qr_code_id, status, material_type, size, grade, qty, vendor, location_id, created_by, created_at, has_exception, inspection_pass)
  values (p_north, qr_n1, 'accepted', 'Transformer', '500kVA', 'T-Grade', 2, 'GE', l_north_1, demo_user, now() - interval '30 days', false, true) returning id into rec_n1;

  insert into public.receiving_records (project_id, qr_code_id, status, material_type, qty, vendor, location_id, created_by, created_at, has_exception, exception_type, exception_resolved, damage_notes)
  values (p_north, qr_n2, 'partially_accepted', 'Copper Spools', 15, 'WireCom', l_north_hold, demo_user, now() - interval '1 days', true, 'damage', false, 'Water damage on 2 spools') returning id into rec_n2;

  -- SOUTH SITE Records
  insert into public.receiving_records (project_id, qr_code_id, status, material_type, size, grade, qty, vendor, location_id, created_by, created_at, has_exception, inspection_pass)
  values (p_south, qr_s1, 'accepted', 'Valves', '4 inch Gate', 'A216-WCB', 30, 'ValvTechnologies', l_south_1, demo_user, now() - interval '20 days', false, true) returning id into rec_s1;


  -- 8. Materials (Only for accepted/partially accepted ones)
  insert into public.materials (project_id, receiving_record_id, qr_code_id, material_type, size, grade, qty, current_quantity, location_id, status, created_at)
  values 
    (p_main, rec_m1, qr_m1, 'Steel Pipe', '6 inch', 'A106-B', 100, 75, l_main_1, 'in_yard', now() - interval '10 days'),
    (p_main, rec_m2, qr_m2, 'Fittings', '6 inch Elbow', 'A234-WPB', 50, 50, l_main_hold, 'in_yard', now() - interval '5 days'),
    (p_north, rec_n1, qr_n1, 'Transformer', '500kVA', 'T-Grade', 2, 2, l_north_1, 'in_yard', now() - interval '30 days'),
    (p_north, rec_n2, qr_n2, 'Copper Spools', null, null, 15, 15, l_north_hold, 'in_yard', now() - interval '1 days'),
    (p_south, rec_s1, qr_s1, 'Valves', '4 inch Gate', 'A216-WCB', 30, 30, l_south_1, 'in_yard', now() - interval '20 days');

  -- Update entity_ids for QR codes
  update public.qr_codes set entity_id = (select id from public.materials m where m.qr_code_id = qr_m1) where id = qr_m1;
  update public.qr_codes set entity_id = (select id from public.materials m where m.qr_code_id = qr_m2) where id = qr_m2;
  update public.qr_codes set entity_id = (select id from public.materials m where m.qr_code_id = qr_n1) where id = qr_n1;
  update public.qr_codes set entity_id = (select id from public.materials m where m.qr_code_id = qr_n2) where id = qr_n2;
  update public.qr_codes set entity_id = (select id from public.materials m where m.qr_code_id = qr_s1) where id = qr_s1;

  -- 9. Add a Material Issue to Main to explain the 75 current_quantity
  insert into public.material_issues (project_id, material_id, job_number, quantity_issued, issued_by)
  select p_main, id, 'JOB-999', 25, demo_user from public.materials where qr_code_id = qr_m1;

end $$;

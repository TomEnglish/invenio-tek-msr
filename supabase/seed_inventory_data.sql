-- ============================================================
-- Demo Seed Data for Inventory & Outside Shop Tables
-- Fully fictional data for demo/sales purposes
-- ============================================================

-- Clear existing demo data (safe to re-run)
DELETE FROM outside_shop_inventory WHERE id > 0;
DELETE FROM inventory_records WHERE id > 0;
DELETE FROM shop_contacts WHERE id > 0;

-- ── Shop Contacts ───────────────────────────────────────────
INSERT INTO shop_contacts (shop_name, address, city, state, zip, contact_name, contact_phone, secondary_contact_name, secondary_contact_phone, notes) VALUES
('Riverbend Yard',    '1400 Industrial Blvd',          'Port Arthur',   'TX', '77640', 'Marcus Rivera',   '(409) 555-0171', 'Diana Chen',       '(409) 555-0182', 'Primary staging yard — RPS Logistics'),
('Hartwell Crating',  '820 Commerce Park Dr',          'Pasadena',      'TX', '77501', 'Kevin Hartwell',  '(713) 555-0234', 'Luis Garza',       '(713) 555-0245', 'Hartwell Industrial Crating & Export'),
('Cascade Controls',  '3300 Refinery Row',             'Texas City',    'TX', '77590', 'Alan Whitfield',  '(409) 555-0312', 'Brenda Oakes',     '(409) 555-0323', 'Cascade Flow Control Systems'),
('Meridian Turbine',  '5600 Energy Corridor Pkwy',     'Katy',          'TX', '77494', NULL,              '(281) 555-0419', NULL,               NULL,              'Meridian Turbine Services'),
('Pacific AirSys',    '290 Coyote Valley Rd',          'San Jose',      'CA', '95123', NULL,              '(408) 555-0501', NULL,               NULL,              'Pacific Air Systems Inc'),
('Gulf QA Services',  '7100 Airline Dr',               'Houston',       'TX', '77076', NULL,              '(832) 555-0614', NULL,               NULL,              'Gulf Quality Assurance & Inspection'),
('Invenio Tech',      '9250 Westheimer Rd Suite 400',  'Houston',       'TX', '77063', NULL,              '(832) 555-0720', NULL,               NULL,              'Invenio Tech — Project Management'),
('Apex Electric',     '1950 Regal Row',                'Dallas',        'TX', '75235', NULL,              '(214) 555-0833', NULL,               NULL,              'Apex Electrical & Transformer Services'),
('Cedar Creek Site',  '4200 FM 1092',                  'Cedar Creek',   'TX', '78612', 'Tom Nakamura',    '(512) 555-0901', 'Rachel Simmons',   '(512) 555-0912', 'Greenfield LNG Terminal — Project Site'),
('Pinnacle Rotating', '600 River Rd',                  'Ashland',       'KY', '41101', NULL,              '(606) 555-1044', NULL,               NULL,              'Pinnacle Rotating Equipment — Generator services'),
('Atlas Heavy Haul',  '1025 SE Tacoma Way',            'Tacoma',        'WA', '98402', NULL,              '(253) 555-1155', NULL,               NULL,              'Atlas Heavy Haul — Oversize transport specialist')
ON CONFLICT (shop_name) DO NOTHING;

-- ── Inventory Records (Master Inventory — Riverbend Yard) ───
INSERT INTO inventory_records (qr_code, inventory_item, item_description, unit, subsystem, location, status) VALUES
-- AIFH items
('AIFH-7',   'AIFH Expansion Joint',   'Expansion Joint — AIFH System',          'AIFH', 'AIFH', 'Riverbend Yard A', 'In Storage'),
('AIFH-8',   'AIFH Expansion Joint',   'Expansion Joint — AIFH System',          'AIFH', 'AIFH', 'Riverbend Yard A', 'In Storage'),
('AIFH-9',   'AIFH Expansion Joint',   'Expansion Joint — AIFH System',          'AIFH', 'AIFH', 'Riverbend Yard A', 'In Storage'),
('U1-0405',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U1-0406',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U1-0407',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U1-0408',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U2-0207',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U2-0208',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U2-0209',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U2-0210',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U3-0171',  'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U3-0172',  'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U3-01732', 'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('U3-0174',  'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Riverbend Yard B', 'In Storage'),
('AIFH-0007','GT1 Expansion Joint',    'Gas Turbine 1 Expansion Joint',          'AIFH', 'AIFH', 'Riverbend Yard A', 'In Storage'),
('AIFH-0008','GT2 Expansion Joint',    'Gas Turbine 2 Expansion Joint',          'AIFH', 'AIFH', 'Riverbend Yard A', 'In Storage'),
('AIFH-0009','GT3 Expansion Joint',    'Gas Turbine 3 Expansion Joint — Upper',  'AIFH', 'AIFH', 'Riverbend Yard A', 'In Storage'),
-- ACW items
('ACW-001',  'Aux Cooling Water Pump',     'ACW Pump Assembly 100HP',            'ACW',  'ACW',  'Riverbend Warehouse', 'In Storage'),
('ACW-002',  'ACW Pipe Spool 12"',         '12" Carbon Steel Pipe Spool',        'ACW',  'ACW',  'Riverbend Yard C', 'In Storage'),
('ACW-003',  'ACW Valve 8" Gate',          '8" Gate Valve — ACW System',         'ACW',  'ACW',  'Riverbend Warehouse', 'In Storage'),
('ACW-004',  'ACW Heat Exchanger',         'Shell & Tube Heat Exchanger',        'ACW',  'ACW',  'Riverbend Yard A', 'In Storage'),
-- Cooling Tower items
('CT-1',     'Main Circulating CW Motor',  'Cooling Tower Motor 697',            'COOLING TOWER', 'CT', 'Riverbend Yard D', 'In Storage'),
('CT-2',     'Main Circulating CW Motor',  'Cooling Tower Motor 686',            'COOLING TOWER', 'CT', 'Riverbend Yard D', 'In Storage'),
('CT-4',     'CW Fan Assembly',            'Cooling Tower Fan Assembly',          'COOLING TOWER', 'CT', 'Riverbend Yard D', 'In Storage'),
('CT-5',     'Aux Circ Water Pump',        'Auxiliary Circulating Water Pump',    'COOLING TOWER', 'CT', 'Riverbend Yard D', 'In Storage'),
('CT-10',    'CW Fill Media',              'Cooling Tower Fill Media Bundle',     'COOLING TOWER', 'CT', 'Riverbend Yard D', 'In Storage'),
-- Gas Turbine 1
('GT1-001',  'Gas Turbine Rotor',          'Unit 1 Turbine Rotor Assembly',      'Gas Turbine 1', 'GT1', 'Riverbend Warehouse', 'In Storage'),
('GT1-002',  'Combustion Liner',           'Unit 1 Combustion Liner Set',        'Gas Turbine 1', 'GT1', 'Riverbend Warehouse', 'In Storage'),
('GT1-003',  'Turbine Nozzle Stage 1',     'Unit 1 First Stage Nozzle',          'Gas Turbine 1', 'GT1', 'Riverbend Warehouse', 'In Storage'),
-- Gas Turbine 2
('GT2-001',  'Gas Turbine Rotor',          'Unit 2 Turbine Rotor Assembly',      'Gas Turbine 2', 'GT2', 'Riverbend Warehouse', 'In Storage'),
('GT2-002',  'Exhaust Diffuser',           'Unit 2 Exhaust Diffuser Section',    'Gas Turbine 2', 'GT2', 'Riverbend Yard A', 'In Storage'),
('GT2-003',  'Generator Stator',           'Unit 2 Generator Stator',            'Gas Turbine 2', 'GT2', 'Riverbend Warehouse', 'Shipped'),
-- Gas Turbine 3
('GT3-001',  'Gas Turbine Rotor',          'Unit 3 Turbine Rotor Assembly',      'Gas Turbine 3', 'GT3', 'Riverbend Warehouse', 'In Storage'),
('GT3-002',  'Inlet Air Filter House',     'Unit 3 AIFH Complete Assembly',      'Gas Turbine 3', 'GT3', 'Riverbend Yard A', 'In Storage'),
('GT3-003',  'Lube Oil Cooler',            'Unit 3 Lube Oil Cooler',             'Gas Turbine 3', 'GT3', 'Riverbend Warehouse', 'In Storage');

-- ── Outside Shop Inventory ──────────────────────────────────
-- Meridian Turbine items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Meridian Turbine', 'HOT-PATH-U2',     'CR-0018', 'UNIT #2 TURBINE',                                        '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'MTS-02',  'Stage 1 Bucket Shroud Blocks (3''7"x2''5"x1'')',          '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'MTS-03',  'Exhaust Plenum Ring Set (7''9"x4''9"x1'')',               '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'MTS-04',  'Stage 3 Shroud Assembly (6''1"x3''9"x1''6")',             '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'MTS-05',  'Bucket Lock Wire Kit (6''7"x3''6"x8")',                   '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'MTS-06',  'Nozzle Ring & Rack Assembly (6''3"x6''3"x1''1")',         '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'MTS-07',  'Stage 1 Bucket Kit (2''6"x2''6"x2''2")',                  '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'U1-0356', 'UNIT #1 TURBINE',                                        '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'HOT-PATH-U2',     'U3-0116', 'NID (TURBINE U3)',                                        '2025-11-17', 'At Shop'),
    ('Meridian Turbine', 'Turbine CAB U1',  'U1-0401', 'Turbine Control Cabinet Unit 1',                          '2025-12-15', 'At Shop'),
    ('Meridian Turbine', 'Turbine CAB U2',  'U2-0401', 'Turbine Control Cabinet Unit 2',                          '2025-12-15', 'At Shop'),
    ('Meridian Turbine', 'Turbine CAB U3',  'U3-0401', 'Turbine Control Cabinet Unit 3',                          '2025-12-20', 'At Shop')
) AS osi(shop, load_name, qr_id, scanner_comments, delivery_date, item_status)
JOIN shop_contacts sc ON sc.shop_name = osi.shop;

-- Hartwell Crating items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Hartwell Crating', 'CT#1', 'CT-2',  '(#2) Main Circulating Cooling Tower Motor 686',  '2025-11-24', 'Shipped'),
    ('Hartwell Crating', 'CT#2', 'CT-1',  '(#1) Main Circulating Cooling Tower Motor 697',  '2025-11-24', 'Shipped'),
    ('Hartwell Crating', 'CT#4', NULL,    NULL,                                               '2025-12-08', 'At Shop'),
    ('Hartwell Crating', 'CT#5', 'CT-10', 'Aux Circ Water Pump',                             '2025-12-08', 'At Shop')
) AS osi(shop, load_name, qr_id, scanner_comments, delivery_date, item_status)
JOIN shop_contacts sc ON sc.shop_name = osi.shop;

-- Cascade Controls items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Cascade Controls', 'Valve Package 1', 'CC-001', 'Flow Control Valve 6" — Rebuilt',    '2025-12-01', 'Ready to Ship'),
    ('Cascade Controls', 'Valve Package 1', 'CC-002', 'Gate Valve 8" — Tested',             '2025-12-01', 'Ready to Ship'),
    ('Cascade Controls', 'Valve Package 2', 'CC-003', 'Check Valve 4" — New Trim',          '2026-01-10', 'At Shop'),
    ('Cascade Controls', 'Valve Package 2', 'CC-004', 'Globe Valve 6" — Actuator Rework',   '2026-01-10', 'At Shop')
) AS osi(shop, load_name, qr_id, scanner_comments, delivery_date, item_status)
JOIN shop_contacts sc ON sc.shop_name = osi.shop;

-- Apex Electric items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Apex Electric', 'Generator Rotor U2', 'GT2-R01', 'Unit 2 Generator Rotor — Rewind',  '2026-01-20', 'At Shop'),
    ('Apex Electric', 'Generator Rotor U2', 'GT2-R02', 'Unit 2 Exciter — Rebuild',         '2026-01-20', 'At Shop'),
    ('Apex Electric', 'Transformer T1',     'TX-001',  'Main Power Transformer — Testing',  '2026-02-15', 'At Shop')
) AS osi(shop, load_name, qr_id, scanner_comments, delivery_date, item_status)
JOIN shop_contacts sc ON sc.shop_name = osi.shop;

-- ── Enhanced Shipment Data (add logistics columns to existing) ──
-- Update existing shipments with mode/ship_type/origin/destination
UPDATE shipments SET
    mode = CASE
        WHEN truck_type IS NOT NULL THEN 'ROAD'
        WHEN category ILIKE '%barge%' THEN 'BARGE'
        ELSE 'ROAD'
    END,
    ship_type = CASE
        WHEN ship_from ILIKE '%riverbend%' OR ship_from IS NULL THEN 'OUTSIDE SHOP'
        ELSE 'DIRECT SHIP'
    END,
    origin = COALESCE(ship_from, 'RIVERBEND YARD'),
    destination = COALESCE(ship_to, 'CEDAR CREEK SITE'),
    cargo_description = COALESCE(part_description, 'Cargo ' || shipment_number)
WHERE mode IS NULL;

-- Insert additional shipments matching logistics dashboard content
INSERT INTO shipments (shipment_number, cargo_description, mode, ship_type, origin, destination, status, delivery_date, rts_date, supplier, category, num_pieces, part_description, project_id) VALUES
('SHP-L001', '(1) Circulating Water Motor (2) Aux CW Motors (2) CT Fan Motors', 'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'HARTWELL CRATING', 'Delivered', '2025-10-15', '2025-10-10', 'Riverbend Yard', 'Cooling Tower', 5, 'CW Motors Package', '00000000-0000-0000-0000-000000000000'),
('SHP-L002', '(3) Cooling Tower Fan Motors (2) Circulating Water Motors', 'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'HARTWELL CRATING', 'Delivered', '2025-10-18', '2025-10-12', 'Riverbend Yard', 'Cooling Tower', 5, 'Fan Motors', '00000000-0000-0000-0000-000000000000'),
('SHP-L003', '(L17) MCC-4160 CRATES',                    NULL, 'OUTSIDE SHOP', 'RIVERBEND YARD', 'ATLAS HEAVY HAUL', 'In Transit', NULL, NULL, 'Riverbend Yard', 'Electrical', 3, 'MCC Crates', '00000000-0000-0000-0000-000000000000'),
('SHP-L004', '4160V Switchgear Unit 1',                   'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'PINNACLE ROTATING', 'Delivered', '2025-11-06', '2025-11-01', 'Riverbend Yard', 'Electrical', 1, '4160V Switchgear', '00000000-0000-0000-0000-000000000000'),
('SHP-L005', '4160V Switchgear Unit 2',                   'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'ATLAS HEAVY HAUL', 'Delivered', '2025-11-07', '2025-11-02', 'Riverbend Yard', 'Electrical', 1, '4160V Switchgear', '00000000-0000-0000-0000-000000000000'),
('SHP-L006', 'AIFH Section 1',                            'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Delivered', '2025-11-12', '2025-11-08', 'Invenio Tech', 'AIFH', 1, 'AIFH Section 1', '00000000-0000-0000-0000-000000000000'),
('SHP-L007', 'AIFH Section 2',                            'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Delivered', '2025-11-12', '2025-11-08', 'Invenio Tech', 'AIFH', 1, 'AIFH Section 2', '00000000-0000-0000-0000-000000000000'),
('SHP-L008', 'AIFH Section 3',                            'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Delivered', '2025-11-12', '2025-11-08', 'Invenio Tech', 'AIFH', 1, 'AIFH Section 3', '00000000-0000-0000-0000-000000000000'),
('SHP-L009', 'AIFH Section 4',                            'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Delivered', '2025-11-13', '2025-11-09', 'Invenio Tech', 'AIFH', 1, 'AIFH Section 4', '00000000-0000-0000-0000-000000000000'),
('SHP-L010', 'AIFH Section 5',                            'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Delivered', '2025-11-12', '2025-11-08', 'Invenio Tech', 'AIFH', 1, 'AIFH Section 5', '00000000-0000-0000-0000-000000000000'),
('SHP-L011', 'AIFH Section 6',                            'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Delivered', '2025-11-12', '2025-11-08', 'Invenio Tech', 'AIFH', 1, 'AIFH Section 6', '00000000-0000-0000-0000-000000000000'),
('SHP-L012', 'AIFH Support Columns (U1,U2,U3)',           'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Delivered', '2025-11-15', '2025-11-10', 'Invenio Tech', 'AIFH', 12, 'Support Columns', '00000000-0000-0000-0000-000000000000'),
('SHP-L013', 'Generator Rotor Unit 2',                    'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'APEX ELECTRIC', 'In Transit', NULL, '2025-12-01', 'Riverbend Yard', 'Generator', 1, 'Gen Rotor U2', '00000000-0000-0000-0000-000000000000'),
('SHP-L014', 'Turbine Cabinets U1/U2/U3',                'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'MERIDIAN TURBINE', 'Not RTS', NULL, NULL, 'Riverbend Yard', 'Gas Turbine', 3, 'Turbine Cabs', '00000000-0000-0000-0000-000000000000'),
('SHP-L015', 'Valve Package — Flow Control',              'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'CASCADE CONTROLS', 'Not RTS', NULL, NULL, 'Riverbend Yard', 'Piping', 4, 'Valve Pkg', '00000000-0000-0000-0000-000000000000'),
('SHP-L016', 'Main Power Transformer',                    'ROAD', 'OUTSIDE SHOP', 'RIVERBEND YARD', 'APEX ELECTRIC', 'Not RTS', NULL, NULL, 'Riverbend Yard', 'Electrical', 1, 'Transformer', '00000000-0000-0000-0000-000000000000'),
('SHP-L017', 'GT1 Expansion Joints',                      'ROAD', 'DIRECT SHIP', 'RIVERBEND YARD', 'CEDAR CREEK SITE', 'Not RTS', NULL, NULL, 'Invenio Tech', 'AIFH', 3, 'GT1 Exp Joints', '00000000-0000-0000-0000-000000000000')
ON CONFLICT (shipment_number) DO NOTHING;

-- ============================================================
-- Demo Seed Data for Inventory & Outside Shop Tables
-- Artificial data matching PowerBI dashboard content style
-- ============================================================

-- ── Shop Contacts ───────────────────────────────────────────
INSERT INTO shop_contacts (shop_name, address, city, state, zip, contact_name, contact_phone, secondary_contact_name, secondary_contact_phone, notes) VALUES
('Bayonne',     '250 E 22nd St',                    'Bayonne',   'NJ', '07002', 'Steven Molina',  '713.865.0591', 'Zach Meriman',    '409.853.6198', 'Main fabrication yard — Kindred Industrial'),
('Boaz',        '7430 Miller Road 2',               'Houston',   'TX', '77049', 'Javy',           '(281) 924-1953','Robert Boaz',     '(281) 924-1949','Boaz Export Crating Company'),
('Dooling',     '225 County Rd 792',                'Freeport',  'TX', '77541', 'Steve Gaskey',   '713.829.8900', 'Ross Evans',       '713.829.8900', 'Dooling/Flow Control Systems — Dooling Machine'),
('Ethos',       '3100 South Sam Houston Parkway E', 'Houston',   'TX', '77047', NULL,             '713.336.1300', NULL,               NULL,            'Ethos Energy'),
('MeeFog CA',   '465 Woodview Ave',                 'Morgan Hill','CA', '95037', NULL,             '(408) 779-0780',NULL,              NULL,            'MeeFog — Mee Industries Inc'),
('PetroTech',   '1220 Rankin Rd',                   'Houston',   'TX', '77073', NULL,             '(281) 821-6555',NULL,              NULL,            'PetroTech Inspection Services'),
('RPS',         '14701 St Marys Ln Suite 250',      'Houston',   'TX', '77079', NULL,             '(832) 770-7250',NULL,              NULL,            'Relevant Power Solutions'),
('Shermco',     '2425 Shovel Dr',                   'Irving',    'TX', '75038', NULL,             '(972) 793-5523',NULL,              NULL,            'Shermco Industries'),
('FERMI F6B',   '688 FM 683',                       'Panhandle', 'TX', '79068', 'Clarissa Dutra', '281.359.2003', 'Jerry Molina',     '832.993.9514', 'FERMI America — Frame 6B Site. GPS: 35.29487 N, 101.60227 W'),
('Sulzer Grayson','1910 S Main St',                 'Grayson',   'KY', '41143', NULL,             '(606) 474-5111',NULL,              NULL,            'Sulzer Turbo Services — Generator rotor work'),
('Omega Morgan','2315 SE Hanna Harvester Dr',       'Milwaukie', 'OR', '97222', NULL,             '(503) 653-3751',NULL,              NULL,            'Omega Morgan — Heavy transport specialist')
ON CONFLICT (shop_name) DO NOTHING;

-- ── Inventory Records (Master Inventory — Bayonne NJ site) ──
INSERT INTO inventory_records (qr_code, inventory_item, item_description, unit, subsystem, location, status) VALUES
-- AIFH items
('AIFH-7',   'AIFH Expansion Joint',   'Expansion Joint — AIFH System',          'AIFH', 'AIFH', 'Bayonne Yard A', 'In Storage'),
('AIFH-8',   'AIFH Expansion Joint',   'Expansion Joint — AIFH System',          'AIFH', 'AIFH', 'Bayonne Yard A', 'In Storage'),
('AIFH-9',   'AIFH Expansion Joint',   'Expansion Joint — AIFH System',          'AIFH', 'AIFH', 'Bayonne Yard A', 'In Storage'),
('U1-0405',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U1-0406',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U1-0407',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U1-0408',  'AIFH Support Column',    'Support Column Unit 1',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U2-0207',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U2-0208',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U2-0209',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U2-0210',  'AIFH Support Column',    'Support Column Unit 2',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U3-0171',  'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U3-0172',  'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U3-01732', 'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('U3-0174',  'AIFH Support Column',    'Support Column Unit 3',                  'AIFH', 'AIFH', 'Bayonne Yard B', 'In Storage'),
('AIFH-0007','GT1 Expansion Joint',    'Gas Turbine 1 Expansion Joint',          'AIFH', 'AIFH', 'Bayonne Yard A', 'In Storage'),
('AIFH-0008','GT2 Expansion Joint',    'Gas Turbine 2 Expansion Joint',          'AIFH', 'AIFH', 'Bayonne Yard A', 'In Storage'),
('AIFH-0009','GT3 Expansion Joint',    'Gas Turbine 3 Expansion Joint — Upper',  'AIFH', 'AIFH', 'Bayonne Yard A', 'In Storage'),
-- ACW items
('ACW-001',  'Aux Cooling Water Pump',     'ACW Pump Assembly 100HP',            'ACW',  'ACW',  'Bayonne Warehouse', 'In Storage'),
('ACW-002',  'ACW Pipe Spool 12"',         '12" Carbon Steel Pipe Spool',        'ACW',  'ACW',  'Bayonne Yard C', 'In Storage'),
('ACW-003',  'ACW Valve 8" Gate',          '8" Gate Valve — ACW System',         'ACW',  'ACW',  'Bayonne Warehouse', 'In Storage'),
('ACW-004',  'ACW Heat Exchanger',         'Shell & Tube Heat Exchanger',        'ACW',  'ACW',  'Bayonne Yard A', 'In Storage'),
-- Cooling Tower items
('CT-1',     'Main Circulating CW Motor',  'Cooling Tower Motor 697',            'COOLING TOWER', 'CT', 'Bayonne Yard D', 'In Storage'),
('CT-2',     'Main Circulating CW Motor',  'Cooling Tower Motor 686',            'COOLING TOWER', 'CT', 'Bayonne Yard D', 'In Storage'),
('CT-4',     'CW Fan Assembly',            'Cooling Tower Fan Assembly',          'COOLING TOWER', 'CT', 'Bayonne Yard D', 'In Storage'),
('CT-5',     'Aux Circ Water Pump',        'Auxiliary Circulating Water Pump',    'COOLING TOWER', 'CT', 'Bayonne Yard D', 'In Storage'),
('CT-10',    'CW Fill Media',              'Cooling Tower Fill Media Bundle',     'COOLING TOWER', 'CT', 'Bayonne Yard D', 'In Storage'),
-- Gas Turbine 1
('GT1-001',  'Gas Turbine Rotor',          'Unit 1 Turbine Rotor Assembly',      'Gas Turbine 1', 'GT1', 'Bayonne Warehouse', 'In Storage'),
('GT1-002',  'Combustion Liner',           'Unit 1 Combustion Liner Set',        'Gas Turbine 1', 'GT1', 'Bayonne Warehouse', 'In Storage'),
('GT1-003',  'Turbine Nozzle Stage 1',     'Unit 1 First Stage Nozzle',          'Gas Turbine 1', 'GT1', 'Bayonne Warehouse', 'In Storage'),
-- Gas Turbine 2
('GT2-001',  'Gas Turbine Rotor',          'Unit 2 Turbine Rotor Assembly',      'Gas Turbine 2', 'GT2', 'Bayonne Warehouse', 'In Storage'),
('GT2-002',  'Exhaust Diffuser',           'Unit 2 Exhaust Diffuser Section',    'Gas Turbine 2', 'GT2', 'Bayonne Yard A', 'In Storage'),
('GT2-003',  'Generator Stator',           'Unit 2 Generator Stator',            'Gas Turbine 2', 'GT2', 'Bayonne Warehouse', 'Shipped'),
-- Gas Turbine 3
('GT3-001',  'Gas Turbine Rotor',          'Unit 3 Turbine Rotor Assembly',      'Gas Turbine 3', 'GT3', 'Bayonne Warehouse', 'In Storage'),
('GT3-002',  'Inlet Air Filter House',     'Unit 3 AIFH Complete Assembly',      'Gas Turbine 3', 'GT3', 'Bayonne Yard A', 'In Storage'),
('GT3-003',  'Lube Oil Cooler',            'Unit 3 Lube Oil Cooler',             'Gas Turbine 3', 'GT3', 'Bayonne Warehouse', 'In Storage');

-- ── Outside Shop Inventory ──────────────────────────────────
-- Ethos items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Ethos', 'NAES2ETHOS', 'CR-0018', 'UNIT #2 TURBINE',                                   '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'NAES-02', '100402085 (1ST STAGE BUCKET SHROUD BLOCKS) (3''7"x2''5"x1'')', '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'NAES-03', '100601023 (EXHAUST PLENUM RINGS) (7''9"x4''9"x1'')',  '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'NAES-04', '100402095-R (STAGE 3 SHROUD) (6''1"x3''9"x1''6")',    '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'NAES-05', '(100402134-SEAL) (100102136-BKT LK WIRE 6000) (6''7"x3''6"8")', '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'NAES-06', '213B1445G002 (RING & RACK) (6''3"x6''3"x1''1")',      '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'NAES-07', '020101031 (1ST STAGE BUCKET KIT) (2''6"x2''6x2''2")', '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'U1-0356', 'UNIT #1 TURBINE',                                   '2025-11-17', 'At Shop'),
    ('Ethos', 'NAES2ETHOS', 'U3-0116', 'NID (TURBINE U3)',                                   '2025-11-17', 'At Shop'),
    ('Ethos', 'Turbine CAB U1', 'U1-0401', 'Turbine Cabinet Unit 1',                         '2025-12-15', 'At Shop'),
    ('Ethos', 'Turbine CAB U2', 'U2-0401', 'Turbine Cabinet Unit 2',                         '2025-12-15', 'At Shop'),
    ('Ethos', 'Turbine CAB U3', 'U3-0401', 'Turbine Cabinet Unit 3',                         '2025-12-20', 'At Shop')
) AS osi(shop, load_name, qr_id, scanner_comments, delivery_date, item_status)
JOIN shop_contacts sc ON sc.shop_name = osi.shop;

-- Boaz items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Boaz', 'CT#1', 'CT-2',  '(#2) Main Circulating Cooling Tower Motor 686',  '2025-11-24', 'Shipped'),
    ('Boaz', 'CT#2', 'CT-1',  '(#1) Main Circulating Cooling Tower Motor 697',  '2025-11-24', 'Shipped'),
    ('Boaz', 'CT#4', NULL,    NULL,                                               '2025-12-08', 'At Shop'),
    ('Boaz', 'CT#5', 'CT-10', 'Aux Circ Water Pump',                             '2025-12-08', 'At Shop')
) AS osi(shop, load_name, qr_id, scanner_comments, delivery_date, item_status)
JOIN shop_contacts sc ON sc.shop_name = osi.shop;

-- Dooling items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Dooling', 'Valve Package 1', 'DL-001', 'Flow Control Valve 6" — Rebuilt',    '2025-12-01', 'Ready to Ship'),
    ('Dooling', 'Valve Package 1', 'DL-002', 'Gate Valve 8" — Tested',             '2025-12-01', 'Ready to Ship'),
    ('Dooling', 'Valve Package 2', 'DL-003', 'Check Valve 4" — New Trim',          '2026-01-10', 'At Shop'),
    ('Dooling', 'Valve Package 2', 'DL-004', 'Globe Valve 6" — Actuator Rework',   '2026-01-10', 'At Shop')
) AS osi(shop, load_name, qr_id, scanner_comments, delivery_date, item_status)
JOIN shop_contacts sc ON sc.shop_name = osi.shop;

-- Shermco items
INSERT INTO outside_shop_inventory (shop_id, load_name, qr_id, scanner_comments, delivery_date, item_status)
SELECT sc.id, osi.load_name, osi.qr_id, osi.scanner_comments, osi.delivery_date::date, osi.item_status
FROM (VALUES
    ('Shermco', 'Generator Rotor U2', 'GT2-R01', 'Unit 2 Generator Rotor — Rewind',  '2026-01-20', 'At Shop'),
    ('Shermco', 'Generator Rotor U2', 'GT2-R02', 'Unit 2 Exciter — Rebuild',         '2026-01-20', 'At Shop'),
    ('Shermco', 'Transformer T1',     'TX-001',  'Main Power Transformer — Testing',  '2026-02-15', 'At Shop')
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
        WHEN ship_from ILIKE '%bayonne%' OR ship_from IS NULL THEN 'OUTSIDE SHOP'
        ELSE 'DIRECT SHIP'
    END,
    origin = COALESCE(ship_from, 'IMTT BAYONNE'),
    destination = COALESCE(ship_to, 'FERMI AMARILLO'),
    cargo_description = COALESCE(part_description, 'Cargo ' || shipment_number)
WHERE mode IS NULL;

-- Insert additional shipments matching logistics dashboard content
INSERT INTO shipments (shipment_number, cargo_description, mode, ship_type, origin, destination, status, delivery_date, rts_date, supplier, category, num_pieces, part_description, project_id) VALUES
('SHP-L001', '(1) Circulating Water Motor (2) Aux Circulating Water Motors (2) Cooling Tower Fan Motors', 'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'BOAZ', 'Delivered', '2025-10-15', '2025-10-10', 'Bayonne Yard', 'Cooling Tower', 5, 'CW Motors Package', '00000000-0000-0000-0000-000000000000'),
('SHP-L002', '(3) Cooling Tower Fan Motors (2) Circulating Water Motors', 'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'BOAZ', 'Delivered', '2025-10-18', '2025-10-12', 'Bayonne Yard', 'Cooling Tower', 5, 'Fan Motors', '00000000-0000-0000-0000-000000000000'),
('SHP-L003', '(L17) MCC-4160 CRATES',                    NULL, 'OUTSIDE SHOP', 'IMTT BAYONNE', 'OMEGA MORGAN', 'In Transit', NULL, NULL, 'Bayonne Yard', 'Electrical', 3, 'MCC Crates', '00000000-0000-0000-0000-000000000000'),
('SHP-L004', '4160s 1',                                  'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'SULZER GRAYSON', 'Delivered', '2025-11-06', '2025-11-01', 'Bayonne Yard', 'Electrical', 1, '4160V Switchgear', '00000000-0000-0000-0000-000000000000'),
('SHP-L005', '4160s 2',                                  'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'OMEGA MORGAN', 'Delivered', '2025-11-07', '2025-11-02', 'Bayonne Yard', 'Electrical', 1, '4160V Switchgear', '00000000-0000-0000-0000-000000000000'),
('SHP-L006', 'AIFH 1',                                   'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Delivered', '2025-11-12', '2025-11-08', 'Kindred Industrial', 'AIFH', 1, 'AIFH Section 1', '00000000-0000-0000-0000-000000000000'),
('SHP-L007', 'AIFH 2',                                   'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Delivered', '2025-11-12', '2025-11-08', 'Kindred Industrial', 'AIFH', 1, 'AIFH Section 2', '00000000-0000-0000-0000-000000000000'),
('SHP-L008', 'AIFH 3',                                   'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Delivered', '2025-11-12', '2025-11-08', 'Kindred Industrial', 'AIFH', 1, 'AIFH Section 3', '00000000-0000-0000-0000-000000000000'),
('SHP-L009', 'AIFH 4',                                   'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Delivered', '2025-11-13', '2025-11-09', 'Kindred Industrial', 'AIFH', 1, 'AIFH Section 4', '00000000-0000-0000-0000-000000000000'),
('SHP-L010', 'AIFH 5',                                   'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Delivered', '2025-11-12', '2025-11-08', 'Kindred Industrial', 'AIFH', 1, 'AIFH Section 5', '00000000-0000-0000-0000-000000000000'),
('SHP-L011', 'AIFH 6',                                   'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Delivered', '2025-11-12', '2025-11-08', 'Kindred Industrial', 'AIFH', 1, 'AIFH Section 6', '00000000-0000-0000-0000-000000000000'),
('SHP-L012', 'AIFH Support Columns (U1,U2,U3)',          'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Delivered', '2025-11-15', '2025-11-10', 'Kindred Industrial', 'AIFH', 12, 'Support Columns', '00000000-0000-0000-0000-000000000000'),
('SHP-L013', 'Generator Rotor Unit 2',                   'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'SHERMCO', 'In Transit', NULL, '2025-12-01', 'Bayonne Yard', 'Generator', 1, 'Gen Rotor U2', '00000000-0000-0000-0000-000000000000'),
('SHP-L014', 'Turbine Cabinets U1/U2/U3',               'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'ETHOS', 'Not RTS', NULL, NULL, 'Bayonne Yard', 'Gas Turbine', 3, 'Turbine Cabs', '00000000-0000-0000-0000-000000000000'),
('SHP-L015', 'Valve Package — Flow Control',             'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'DOOLING', 'Not RTS', NULL, NULL, 'Bayonne Yard', 'Piping', 4, 'Valve Pkg', '00000000-0000-0000-0000-000000000000'),
('SHP-L016', 'Main Power Transformer',                   'ROAD', 'OUTSIDE SHOP', 'IMTT BAYONNE', 'SHERMCO', 'Not RTS', NULL, NULL, 'Bayonne Yard', 'Electrical', 1, 'Transformer', '00000000-0000-0000-0000-000000000000'),
('SHP-L017', 'GT1 Expansion Joints',                     'ROAD', 'DIRECT SHIP', 'IMTT BAYONNE', 'FERMI AMARILLO', 'Not RTS', NULL, NULL, 'Kindred Industrial', 'AIFH', 3, 'GT1 Exp Joints', '00000000-0000-0000-0000-000000000000')
ON CONFLICT (shipment_number) DO NOTHING;

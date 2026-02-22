#!/usr/bin/env python3
"""
Generate Demo Data for Greenfield LNG Terminal MSR Dashboard
Inserts realistic construction/energy industry data into Supabase via REST API.
"""

import requests
import random
import json
import uuid
import math
from datetime import datetime, date, timedelta

# =============================================================================
# SUPABASE CONFIGURATION
# =============================================================================
SUPABASE_URL = "https://lzroduricxyshgyjdkki.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cm9kdXJpY3h5c2hneWpka2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NzgyMDIsImV4cCI6MjA4NzM1NDIwMn0.oX_nOPHGkUeaUKXHAb086MGCTjIwV2PQ1q1aDLvUCRs"
BATCH_SIZE = 50

HEADERS_INSERT = {
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

HEADERS_DELETE = {
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

PROJECT_NAME = "Greenfield LNG Terminal"

# =============================================================================
# REFERENCE DATA
# =============================================================================

SUPPLIERS = [
    "Atlas Industrial Supply", "Meridian Steel Co.", "Apex Electrical Systems",
    "Pacific Valve & Fitting", "Summit Fabrication Inc.", "Coastal Pipe Solutions",
    "Pinnacle Controls LLC", "Nova Engineering Works", "Titan Structural Steel",
    "Keystone Mechanical Services", "Gulf Coast Welding Supply", "Bayou Fabricators Inc.",
    "Lone Star Instrumentation", "Offshore Piping Specialists", "Continental Cable & Wire",
    "Southwest Concrete Products", "Heritage Industrial Coatings", "Ironclad Steel Distributors",
    "Delta Process Equipment", "Frontier Valve Technologies", "CrossRoads Electrical Supply",
    "SteelCraft Manufacturing", "ProFlow Piping Systems", "Vanguard Control Systems",
    "Alliance Structural Components", "Marathon Insulation Co.", "Precision Bolt & Fastener",
    "CastleRock Equipment", "Bluebonnet Industrial", "Eagle Crane & Rigging",
    "Magnolia Pump & Compressor", "Red River Fabrication", "Tidewater Coatings Inc.",
    "Brazos Valley Pipe & Supply", "Galveston Marine Services",
]

CATEGORIES = ["Mechanical", "Electrical", "Instrumentation", "Civil", "Steel", "Piping"]

SUB_CATEGORIES = {
    "Mechanical": ["Rotating Equipment", "Heat Exchangers", "Pressure Vessels", "Compressors", "Pumps", "Fans & Blowers"],
    "Electrical": ["Power Distribution", "Lighting", "Cable & Wire", "Motor Controls", "Transformers", "Switchgear"],
    "Instrumentation": ["Control Valves", "Transmitters", "Analyzers", "Flow Meters", "DCS/PLC", "Safety Systems"],
    "Civil": ["Concrete", "Foundations", "Piling", "Earthwork", "Roads & Paving", "Underground Utilities"],
    "Steel": ["Structural Steel", "Pipe Racks", "Platforms", "Stairs & Ladders", "Handrails", "Grating"],
    "Piping": ["Carbon Steel Pipe", "Stainless Pipe", "Fittings", "Flanges", "Gaskets", "Valves"],
}

# Item descriptions per category
ITEM_DESCRIPTIONS = {
    "Mechanical": [
        "Centrifugal Pump Assembly 150HP", "Shell & Tube Heat Exchanger", "BOG Compressor Module",
        "Cryogenic Expander Unit", "LNG Loading Arm Assembly", "Fin Fan Air Cooler",
        "Refrigerant Compressor Package", "Hydraulic Power Unit", "Gear Box Assembly",
        "Mechanical Seal Kit", "Coupling Assembly - Flexible", "Bearing Housing Assembly",
        "Turbine Rotor Assembly", "Impeller - SS316", "Lube Oil Console",
        "Condensate Pump - Vertical", "Booster Pump - Multi-Stage", "Compressor Suction Drum",
        "Knockout Drum - 48\" Dia", "Gas/Liquid Separator",
    ],
    "Electrical": [
        "Medium Voltage Switchgear 13.8kV", "Power Transformer 2500kVA", "Motor Control Center",
        "Emergency Generator 500kW", "UPS System 200kVA", "Lighting Panel Board",
        "Cable Tray - Ladder Type 24\"", "Cable Tray - Solid Bottom 18\"", "Power Cable 3/C 500MCM",
        "Control Cable 12/C #14AWG", "Junction Box - Explosion Proof", "LED Floodlight 400W Ex-d",
        "Grounding Cable 4/0 AWG", "Variable Frequency Drive 250HP", "Soft Starter 200HP",
        "Battery Charger 125VDC", "Distribution Transformer 750kVA", "Bus Duct Assembly",
        "Fire Alarm Control Panel", "Cathodic Protection Rectifier",
    ],
    "Instrumentation": [
        "Pressure Transmitter - Smart", "Temperature Transmitter RTD", "Level Transmitter - Radar",
        "Flow Meter - Coriolis 6\"", "Control Valve 6\" Globe CV=180", "Safety Relief Valve 8\"x10\"",
        "Gas Detector - Combustible", "Flame Detector - UV/IR", "DCS Controller Module",
        "PLC Rack Assembly", "Thermocouple Assembly Type-K", "Pressure Gauge 4\" SS",
        "Control Valve Actuator - Pneumatic", "Solenoid Valve 3-Way", "ESD Push Button Station",
        "Orifice Plate Assembly 4\"", "Analyzer Shelter - Complete", "RTU Cabinet Assembly",
        "Instrument Air Dryer Package", "Calibration Gas Cylinder Kit",
    ],
    "Civil": [
        "Ready Mix Concrete 5000 PSI", "Reinforcing Steel #8 Bar", "Precast Concrete Piles 24\"",
        "Aggregate Base Course", "Lean Concrete Fill", "Anchor Bolt Set - L-Type",
        "Epoxy Grout - Non-Shrink", "Expansion Joint Material", "Waterproofing Membrane",
        "Soil Cement Stabilization", "Concrete Form Materials", "Curing Compound",
        "Geotextile Fabric - Woven", "PVC Pipe 8\" SDR-35", "Manhole Frame & Cover",
        "Concrete Pipe 36\" RCP", "Jersey Barriers", "Precast Concrete Bollards",
        "Chain Link Fence 8ft", "Guard Rail Assembly",
    ],
    "Steel": [
        "W-Beam W24x76 A992", "W-Beam W14x48 A992", "HSS Column 12x12x1/2",
        "Pipe Rack Steel - Lot", "Platform Grating - 1\" Bar", "Stair Stringer Assembly",
        "Handrail - 42\" Pipe Rail", "Toe Plate 4\" Steel", "Base Plate 24\"x24\"x2\"",
        "Clip Angle L4x4x1/2", "Steel Decking - B-Deck", "Moment Connection Assembly",
        "Bracing Assembly - Chevron", "Column Splice Plates", "Shear Tab Plates",
        "Structural Bolts A325 3/4\"", "Steel Embed Plates", "Pipe Support Assembly",
        "Spring Hanger - Variable", "Trunnion Support",
    ],
    "Piping": [
        "CS Pipe 12\" Sch 40 A106-B", "CS Pipe 8\" Sch 80 A106-B", "SS Pipe 4\" Sch 10S 316L",
        "CS Elbow 12\" 90-Deg LR", "CS Tee 8\"x8\" Equal", "CS Reducer 12\"x8\" Conc",
        "Gate Valve 12\" 300# CS", "Ball Valve 4\" 150# SS316", "Check Valve 8\" 300# Swing",
        "Butterfly Valve 24\" 150#", "RF Flange 12\" 300# WN", "RTJ Flange 8\" 900# WN",
        "Gasket Set Spiral Wound 12\"", "Stud Bolt Set 3/4\" x 5\"", "Spectacle Blind 8\" 300#",
        "Steam Trap - Inverted Bucket", "Strainer - Y-Type 6\" 300#", "Expansion Joint 16\" SS",
        "Pipe Insulation - Calcium Silicate 4\"", "Pipe Shoe - Guided 12\"",
    ],
}

PO_STATUSES = ["Sent", "Follow-Up Document Created", "Finished", "Canceled"]
PO_STATUS_WEIGHTS = [0.45, 0.35, 0.15, 0.05]

ITEM_STATUSES = ["Open", "Partially Delivered", "Fully Delivered", "Canceled"]
DELIVERY_STATUSES = ["Not Delivered", "Partially Delivered", "Fully Delivered"]

UOM_OPTIONS = ["EA", "LF", "LB", "CY", "SF", "LOT", "SET", "GAL", "TON", "FT"]

SCOPES = ["Process", "Utilities", "Offsites", "Tank Farm", "Marine", "General"]

SHIP_FROM_CITIES = [
    "Houston, TX", "Beaumont, TX", "Lake Charles, LA", "Baton Rouge, LA",
    "New Orleans, LA", "Dallas, TX", "San Antonio, TX", "Tulsa, OK",
    "Corpus Christi, TX", "Port Arthur, TX", "Shreveport, LA", "Mobile, AL",
    "Pasadena, TX", "Victoria, TX", "Baytown, TX", "Channelview, TX",
    "Deer Park, TX", "La Porte, TX", "Nederland, TX", "Orange, TX",
    "Sulphur, LA", "Westlake, LA", "Gonzales, LA", "Plaquemine, LA",
]

TRUCK_TYPES = ["Flatbed", "Dry Van", "Specialized", "LTL"]
TRUCK_TYPE_WEIGHTS = [0.45, 0.25, 0.15, 0.15]

STORAGE_LOCATIONS = ["Laydown Area A", "Laydown Area B", "Warehouse 1", "Staging Area"]

SHIPMENT_STATUSES = ["Delivered", "In Transit", "Not RTS", "RTS"]
SHIPMENT_STATUS_COUNTS = {"Delivered": 35, "In Transit": 5, "Not RTS": 45, "RTS": 25}

PROJECT_PHASES = [
    "Phase 1 - Foundation",
    "Phase 2 - Structural",
    "Phase 3 - Mechanical",
    "Phase 4 - Electrical/Instrumentation",
    "Phase 5 - Commissioning",
]

TRACKER_EQUIPMENT = [
    "LNG Heat Exchanger-HX1", "LNG Heat Exchanger-HX2", "BOG Compressor-CM1",
    "BOG Compressor-CM2", "Compressor Module-CM3", "Refrigerant Compressor-RC1",
    "Pipe Rack Section-PR1", "Pipe Rack Section-PR2", "Pipe Rack Section-PR3",
    "Pipe Rack Section-PR4", "Pipe Rack Section-PR5", "Pipe Rack Section-PR6",
    "Pipe Rack Section-PR7", "Control Panel-CP1", "Control Panel-CP2",
    "Transformer-TX1", "Transformer-TX2", "MCC Building Module-MCC1",
    "Switchgear Module-SG1", "Generator Package-GEN1", "Loading Arm Assembly-LA1",
    "Loading Arm Assembly-LA2", "Cryogenic Tank Shell-CT1", "Cryogenic Tank Shell-CT2",
    "Flare Stack Section-FS1", "Flare Stack Section-FS2", "Process Column-PC1",
    "Separator Vessel-SV1", "KO Drum-KOD1", "Air Cooler Bundle-AC1",
    "Air Cooler Bundle-AC2", "Fin Fan Assembly-FF1", "Pump Package-PP1",
    "Pump Package-PP2", "LNG Pump Module-LP1", "Condensate Tank-CDT1",
    "Metering Skid-MS1", "Analyzer Shelter-AS1", "Instrument Air Package-IA1",
    "Fire Water Pump-FWP1",
]

# Freeport TX site coordinates
SITE_LAT = 28.954
SITE_LON = -95.359

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def random_date(start: date, end: date) -> str:
    """Return a random date string between start and end."""
    delta = (end - start).days
    if delta <= 0:
        return start.isoformat()
    return (start + timedelta(days=random.randint(0, delta))).isoformat()


def batch_insert(table: str, records: list) -> bool:
    """Insert records in batches. Returns True on success."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    total = len(records)
    inserted = 0

    for i in range(0, total, BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        try:
            response = requests.post(url, headers=HEADERS_INSERT, json=batch)
            if response.status_code in [200, 201]:
                inserted += len(batch)
                print(f"   Batch {i // BATCH_SIZE + 1}: {inserted}/{total} records inserted")
            else:
                print(f"   ERROR batch {i // BATCH_SIZE + 1}: {response.status_code} - {response.text[:200]}")
                return False
        except Exception as e:
            print(f"   ERROR batch {i // BATCH_SIZE + 1}: {e}")
            return False

    return True


def clear_table(table: str) -> bool:
    """Delete all records from a table."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=gte.0"
    try:
        response = requests.delete(url, headers=HEADERS_DELETE)
        if response.status_code in [200, 204]:
            print(f"   Cleared table: {table}")
            return True
        else:
            print(f"   Warning clearing {table}: {response.status_code} - {response.text[:200]}")
            return True  # Continue even if clear fails (table may be empty)
    except Exception as e:
        print(f"   Warning clearing {table}: {e}")
        return True


# =============================================================================
# DATA GENERATORS
# =============================================================================

def generate_purchase_orders():
    """Generate ~800 purchase order line items across ~95 unique POs."""
    print("\n[1/6] Generating Purchase Orders...")

    records = []
    po_count = 95
    target_total = 800
    # Pre-determine how many line items per PO
    # Average ~8.4 items per PO, with some variation
    items_per_po = []
    remaining = target_total
    for i in range(po_count):
        if i == po_count - 1:
            count = remaining
        else:
            avg = remaining / (po_count - i)
            count = max(1, int(random.gauss(avg, 3)))
            count = min(count, remaining - (po_count - i - 1))
        items_per_po.append(count)
        remaining -= count

    # Target total net value ~$80M
    target_value = 80_000_000
    running_value = 0

    for po_idx in range(po_count):
        po_id = f"PO-{20001 + po_idx}"
        category = random.choice(CATEGORIES)
        sub_cat = random.choice(SUB_CATEGORIES[category])
        supplier = random.choice(SUPPLIERS)
        scope = random.choice(SCOPES)
        po_status = random.choices(PO_STATUSES, weights=PO_STATUS_WEIGHTS, k=1)[0]
        created_on = random_date(date(2025, 6, 1), date(2026, 1, 15))

        descs = ITEM_DESCRIPTIONS[category]
        num_items = items_per_po[po_idx]

        for item_idx in range(num_items):
            item_desc = random.choice(descs)
            base_uom = random.choice(UOM_OPTIONS)
            ordered_qty = random.choice([1, 2, 4, 5, 6, 8, 10, 12, 16, 20, 24, 50, 100, 200, 500, 1000])

            # Generate net value that contributes to the overall target
            # Mix of small and large values
            roll = random.random()
            if roll < 0.15:
                net_value = round(random.uniform(500, 5000), 2)
            elif roll < 0.45:
                net_value = round(random.uniform(5000, 50000), 2)
            elif roll < 0.75:
                net_value = round(random.uniform(50000, 250000), 2)
            elif roll < 0.92:
                net_value = round(random.uniform(250000, 750000), 2)
            else:
                net_value = round(random.uniform(750000, 2000000), 2)

            running_value += net_value
            net_price = round(net_value / max(ordered_qty, 1), 2)

            delivery_date = random_date(date(2025, 9, 1), date(2026, 6, 30))

            item_status = random.choice(ITEM_STATUSES)
            delivery_status = random.choice(DELIVERY_STATUSES)

            record = {
                "purchase_order_id": po_id,
                "po_description": f"{category} - {sub_cat} Package",
                "purchase_order_item": str((item_idx + 1) * 10),
                "item_uuid": str(random.randint(100000, 999999)),
                "created_on": created_on,
                "status": po_status,
                "item_status": item_status,
                "delivery_status": delivery_status,
                "scope": scope,
                "category": category,
                "sub_category": sub_cat,
                "supplier": supplier,
                "item_description": item_desc,
                "base_uom": base_uom,
                "ordered_quantity": ordered_qty,
                "net_price": net_price,
                "net_value": net_value,
                "delivery_date_from": delivery_date,
            }
            records.append(record)

    # Scale values so total lands near $80M
    if running_value > 0:
        scale_factor = target_value / running_value
        for r in records:
            r["net_value"] = round(r["net_value"] * scale_factor, 2)
            qty = r["ordered_quantity"] if r["ordered_quantity"] else 1
            r["net_price"] = round(r["net_value"] / qty, 2)

    random.shuffle(records)
    print(f"   Generated {len(records)} PO line items across {po_count} POs")
    total_val = sum(r["net_value"] for r in records)
    print(f"   Total PO value: ${total_val:,.2f}")
    return records


def generate_shipments(po_records):
    """Generate ~110 shipment records."""
    print("\n[2/6] Generating Shipments...")

    records = []
    total = 110

    # Build status distribution
    status_list = []
    for status, count in SHIPMENT_STATUS_COUNTS.items():
        status_list.extend([status] * count)
    random.shuffle(status_list)

    # Get unique PO IDs and suppliers from PO data
    po_ids = list(set(r["purchase_order_id"] for r in po_records))
    po_supplier_map = {}
    po_category_map = {}
    for r in po_records:
        po_supplier_map[r["purchase_order_id"]] = r["supplier"]
        po_category_map[r["purchase_order_id"]] = r["category"]

    for i in range(total):
        shipment_num = f"SH-{1001 + i}"
        status = status_list[i] if i < len(status_list) else random.choice(SHIPMENT_STATUSES)
        po_id = random.choice(po_ids)
        supplier = po_supplier_map.get(po_id, random.choice(SUPPLIERS))
        category = po_category_map.get(po_id, random.choice(CATEGORIES))

        # Pick a matching item description
        descs = ITEM_DESCRIPTIONS.get(category, ITEM_DESCRIPTIONS["Mechanical"])
        part_desc = random.choice(descs)

        ship_from = random.choice(SHIP_FROM_CITIES)
        truck_type = random.choices(TRUCK_TYPES, weights=TRUCK_TYPE_WEIGHTS, k=1)[0]
        storage = random.choice(STORAGE_LOCATIONS)
        num_pieces = random.choice([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20])
        num_loads = random.choice([1, 1, 1, 1, 2, 2, 3, 4])

        # Date logic depends on status
        rts_date = None
        eta = None
        delivery_date = None

        if status == "Delivered":
            rts_date = random_date(date(2025, 8, 1), date(2025, 12, 31))
            eta_d = date.fromisoformat(rts_date) + timedelta(days=random.randint(3, 21))
            eta = eta_d.isoformat()
            delivery_date = (eta_d + timedelta(days=random.randint(-2, 5))).isoformat()
        elif status == "In Transit":
            rts_date = random_date(date(2026, 1, 10), date(2026, 2, 10))
            eta = random_date(date(2026, 2, 20), date(2026, 3, 15))
        elif status == "RTS":
            rts_date = random_date(date(2026, 1, 15), date(2026, 3, 15))
            eta = random_date(date(2026, 3, 1), date(2026, 4, 30))
        else:  # Not RTS
            eta = random_date(date(2026, 3, 1), date(2026, 6, 30))

        shipment_by = random.choice(["Invenio-Tek", "Supplier", "Invenio-Tek", "Invenio-Tek"])

        progress_notes = None
        if status == "Delivered":
            progress_notes = random.choice([
                "Received in good condition", "All items accounted for",
                "Minor packaging damage - no material impact", "Received and stored per plan",
                "QC inspection passed", "Received with COC documentation",
            ])
        elif status == "In Transit":
            progress_notes = random.choice([
                "Picked up, en route", "Loaded on truck, ETA on schedule",
                "Departed fabrication shop", "In transit - tracking active",
            ])
        elif status == "RTS":
            progress_notes = random.choice([
                "Ready at supplier dock", "Awaiting carrier pickup",
                "Fabrication complete - awaiting release", "Packaging complete, ready for pickup",
            ])
        else:
            progress_notes = random.choice([
                "Awaiting fabrication completion", "In fabrication",
                "Material on order from mill", "Vendor drawing approval pending",
                "Shop testing in progress", "Coating/painting in progress", None, None,
            ])

        record = {
            "shipment_number": shipment_num,
            "project": PROJECT_NAME,
            "po_number": po_id,
            "rts_date": rts_date,
            "eta": eta,
            "delivery_date": delivery_date,
            "status": status,
            "category": category,
            "supplier": supplier,
            "part_description": part_desc,
            "num_pieces": num_pieces,
            "num_loads": num_loads,
            "truck_type": truck_type,
            "storage_location": storage if status == "Delivered" else None,
            "ship_from": ship_from,
            "ship_to": "Freeport, TX",
            "shipment_by": shipment_by,
            "progress_notes": progress_notes,
        }
        records.append(record)

    print(f"   Generated {len(records)} shipment records")
    status_summary = {}
    for r in records:
        status_summary[r["status"]] = status_summary.get(r["status"], 0) + 1
    for s, c in sorted(status_summary.items()):
        print(f"     {s}: {c}")
    return records


def generate_dashboard_metrics(po_records, shipment_records):
    """Generate a single dashboard_metrics record from the generated data."""
    print("\n[3/6] Generating Dashboard Metrics...")

    # Procurement metrics
    unique_pos = set(r["purchase_order_id"] for r in po_records)
    total_value = sum(r["net_value"] for r in po_records)
    total_shipments = len(shipment_records)
    delivered = sum(1 for r in shipment_records if r["status"] == "Delivered")
    in_transit = sum(1 for r in shipment_records if r["status"] == "In Transit")
    not_rts = sum(1 for r in shipment_records if r["status"] == "Not RTS")
    rts = sum(1 for r in shipment_records if r["status"] == "RTS")

    procurement = {
        "total_pos": len(unique_pos),
        "total_po_value": round(total_value, 2),
        "total_shipments": total_shipments,
        "delivered_shipments": delivered,
        "in_transit_shipments": in_transit + rts,
        "not_ready_shipments": not_rts,
    }

    # PO status counts
    po_status_counts = {}
    for r in po_records:
        s = r["status"]
        po_status_counts[s] = po_status_counts.get(s, 0) + 1

    shipment_status_counts = {}
    for r in shipment_records:
        s = r["status"]
        shipment_status_counts[s] = shipment_status_counts.get(s, 0) + 1

    status_counts = {
        "po_status": po_status_counts,
        "shipment_status": shipment_status_counts,
    }

    # Installation metrics (placeholder structure)
    cat_counts = {}
    for r in po_records:
        c = r["category"]
        cat_counts[c] = cat_counts.get(c, 0) + 1

    installation = {
        "disciplines": list(cat_counts.keys()),
        "total_items": len(po_records),
        "by_discipline": cat_counts,
    }

    record = {
        "id": 1,
        "project_name": PROJECT_NAME,
        "procurement": json.dumps(procurement),
        "installation": json.dumps(installation),
        "status_counts": json.dumps(status_counts),
    }

    print(f"   Total POs: {len(unique_pos)}")
    print(f"   Total PO Value: ${total_value:,.2f}")
    print(f"   Total Shipments: {total_shipments}")
    return [record]


def generate_project_schedule():
    """Generate ~150 project schedule activities."""
    print("\n[4/6] Generating Project Schedule...")

    records = []
    activity_counter = 1000

    # Define schedule phases with date ranges and activities
    phases = [
        {
            "type": "Design/Engineering",
            "start": date(2025, 3, 1),
            "end": date(2025, 12, 31),
            "activities": [
                "FEED Study Completion", "Detailed Engineering - Process",
                "Detailed Engineering - Mechanical", "Detailed Engineering - Electrical",
                "Detailed Engineering - Civil/Structural", "Detailed Engineering - Instrumentation",
                "Piping Design & Isometrics", "3D Model Review",
                "Hazard & Operability Study (HAZOP)", "Design Basis Memorandum",
                "Plot Plan Finalization", "Equipment Specification Sheets",
                "Electrical Load Study", "Instrument Index Development",
                "Piping Stress Analysis", "Foundation Design Package",
            ],
        },
        {
            "type": "Procurement",
            "start": date(2025, 6, 1),
            "end": date(2026, 3, 31),
            "activities": [
                "Long-Lead Equipment Procurement", "Compressor Package Procurement",
                "Heat Exchanger Procurement", "Electrical Switchgear Procurement",
                "Transformer Procurement", "Control System (DCS) Procurement",
                "Structural Steel Procurement", "Piping Material Procurement",
                "Valve Procurement Package", "Instrumentation Bulk Procurement",
                "Cable & Wire Procurement", "Cryogenic Equipment Procurement",
                "Fire Protection System Procurement", "HVAC Equipment Procurement",
                "Insulation Material Procurement",
            ],
        },
        {
            "type": "Fabrication",
            "start": date(2025, 8, 1),
            "end": date(2026, 5, 31),
            "activities": [
                "Structural Steel Fabrication", "Pipe Spool Fabrication",
                "Pressure Vessel Fabrication", "Heat Exchanger Fabrication",
                "Module Assembly - Compressor", "Module Assembly - Electrical",
                "Pipe Rack Fabrication", "Platform & Stair Fabrication",
                "Control Panel Assembly", "Cable Tray Fabrication",
                "Tank Shell Plate Rolling", "Piping Pre-Fabrication Lot 1",
                "Piping Pre-Fabrication Lot 2", "Skid Package Fabrication",
            ],
        },
        {
            "type": "Transportation",
            "start": date(2025, 10, 1),
            "end": date(2026, 6, 30),
            "activities": [
                "Structural Steel Delivery", "Heavy Lift Equipment Transport",
                "Compressor Module Shipment", "Heat Exchanger Transport",
                "Pipe Spool Deliveries - Lot 1", "Pipe Spool Deliveries - Lot 2",
                "Electrical Equipment Delivery", "Transformer Heavy Haul",
                "Bulk Material Deliveries", "Cryogenic Equipment Transport",
                "Tank Shell Plates Transport", "Control System Delivery",
            ],
        },
        {
            "type": "Installation",
            "start": date(2025, 9, 1),
            "end": date(2026, 12, 31),
            "activities": [
                "Site Preparation & Grading", "Piling Installation",
                "Foundation Concrete Placement", "Underground Utilities Installation",
                "Structural Steel Erection - Area 1", "Structural Steel Erection - Area 2",
                "Pipe Rack Erection", "Equipment Setting - Major",
                "Equipment Setting - Minor", "Piping Installation - Above Grade",
                "Piping Installation - Underground", "Electrical Cable Pulling",
                "Cable Tray Installation", "Instrument Installation",
                "Control Wiring & Terminations", "Fireproofing Application",
                "Insulation Installation", "Painting & Coatings",
                "LNG Tank Erection", "Loading Arm Installation",
                "Flare System Installation", "Fire Protection Installation",
            ],
        },
        {
            "type": "Testing/Commissioning",
            "start": date(2026, 8, 1),
            "end": date(2027, 3, 31),
            "activities": [
                "Hydrostatic Testing - Piping", "Pressure Testing - Vessels",
                "Electrical Continuity Testing", "Loop Checking & Calibration",
                "Motor Run Testing", "Instrument Calibration",
                "Control System FAT", "Control System SAT",
                "Pre-Commissioning Walkdowns", "Flushing & Cleaning",
                "Dry Gas Purging", "Leak Testing",
                "Safety System Functional Testing", "Fire Protection Testing",
                "Electrical Switchgear Commissioning",
            ],
        },
        {
            "type": "Startup",
            "start": date(2027, 2, 1),
            "end": date(2027, 6, 30),
            "activities": [
                "Utility Systems Startup", "Refrigerant Charging",
                "Compressor Run-In", "Cool Down Procedure",
                "First LNG Production", "Performance Testing",
                "Reliability Run", "Final Acceptance",
            ],
        },
    ]

    # Key milestones
    milestones = [
        ("Project Sanction & NTP", date(2025, 3, 1)),
        ("FEED Completion", date(2025, 5, 15)),
        ("Site Mobilization", date(2025, 8, 1)),
        ("First Concrete Pour", date(2025, 9, 15)),
        ("Structural Steel Erection Start", date(2025, 11, 1)),
        ("Major Equipment Arrival", date(2026, 2, 15)),
        ("Pipe Rack Completion", date(2026, 5, 1)),
        ("Above Grade Piping Complete", date(2026, 9, 1)),
        ("Electrical Energization", date(2026, 10, 1)),
        ("Mechanical Completion", date(2026, 12, 15)),
        ("Pre-Commissioning Complete", date(2027, 1, 31)),
        ("Refrigerant Introduction", date(2027, 3, 1)),
        ("First LNG Production", date(2027, 4, 15)),
        ("Performance Test Complete", date(2027, 5, 15)),
        ("Final Acceptance", date(2027, 6, 15)),
        ("Plant Startup", date(2027, 6, 30)),
    ]

    today = date(2026, 2, 22)

    # Add milestones
    for name, ms_date in milestones:
        activity_id = f"A{activity_counter}"
        activity_counter += 10

        if ms_date < today:
            status = "Complete"
            pct = 100
        elif ms_date <= today + timedelta(days=30):
            status = "In Progress"
            pct = random.randint(60, 90)
        else:
            status = "Not Started"
            pct = 0

        # Milestones on the critical path
        is_critical = name in [
            "Project Sanction & NTP", "Site Mobilization", "Major Equipment Arrival",
            "Mechanical Completion", "First LNG Production", "Final Acceptance", "Plant Startup",
        ]

        records.append({
            "activity_id": activity_id,
            "activity_name": name,
            "remaining_duration": 0,
            "start_date": ms_date.isoformat(),
            "finish_date": ms_date.isoformat(),
            "is_milestone": True,
            "activity_type": "Milestone",
            "category": "Milestone",
            "status": status,
            "percent_complete": pct,
            "is_critical": is_critical,
        })

    # Add work activities from each phase
    for phase in phases:
        for act_name in phase["activities"]:
            activity_id = f"A{activity_counter}"
            activity_counter += 10

            # Compute start/finish within phase range
            phase_span = (phase["end"] - phase["start"]).days
            act_start_offset = random.randint(0, max(0, phase_span - 30))
            act_start = phase["start"] + timedelta(days=act_start_offset)
            duration = random.choice([10, 14, 20, 21, 28, 30, 42, 45, 60, 75, 90, 120])
            act_finish = act_start + timedelta(days=duration)

            # Determine status based on dates vs today
            if act_finish <= today:
                status = "Complete"
                pct = 100
                remaining = 0
            elif act_start <= today:
                status = "In Progress"
                elapsed = (today - act_start).days
                pct = min(95, int((elapsed / duration) * 100))
                remaining = max(1, duration - elapsed)
            else:
                status = "Not Started"
                pct = 0
                remaining = duration

            # Mark some critical path items
            is_critical = random.random() < 0.15

            records.append({
                "activity_id": activity_id,
                "activity_name": act_name,
                "remaining_duration": remaining,
                "start_date": act_start.isoformat(),
                "finish_date": act_finish.isoformat(),
                "is_milestone": False,
                "activity_type": phase["type"],
                "category": phase["type"],
                "status": status,
                "percent_complete": pct,
                "is_critical": is_critical,
            })

    # Sort by start date
    records.sort(key=lambda x: x["start_date"])

    milestone_count = sum(1 for r in records if r["is_milestone"])
    print(f"   Generated {len(records)} schedule activities ({milestone_count} milestones, {len(records) - milestone_count} work activities)")
    return records


def generate_samsara_trackers():
    """Generate ~40 Samsara tracker records."""
    print("\n[5/6] Generating Samsara Trackers...")

    records = []

    for i, name in enumerate(TRACKER_EQUIPMENT[:40]):
        tracker_id = str(281474999387855 + i)

        # ~60% on site (near Freeport TX), rest scattered
        if random.random() < 0.60:
            # On site - small random offset from site center
            lat = SITE_LAT + random.uniform(-0.003, 0.003)
            lon = SITE_LON + random.uniform(-0.003, 0.003)
            is_on_site = True
            distance = round(random.uniform(0.01, 0.4), 2)
        else:
            # Off site - scattered across TX/LA
            lat = random.uniform(28.5, 32.5)
            lon = random.uniform(-97.5, -93.0)
            is_on_site = False
            # Calculate approximate distance
            dlat = math.radians(SITE_LAT - lat)
            dlon = math.radians(SITE_LON - lon)
            a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(SITE_LAT)) * math.sin(dlon / 2) ** 2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            distance = round(6371 * c, 2)

        accuracy = round(random.uniform(5.0, 250.0), 2)

        # Last seen within last few days
        hours_ago = random.randint(1, 72)
        last_seen = (datetime.now(tz=None) - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%S") + "Z"

        record = {
            "id": tracker_id,
            "name": name,
            "type": "unpowered",
            "last_latitude": round(lat, 7),
            "last_longitude": round(lon, 7),
            "last_accuracy_meters": accuracy,
            "last_seen_at": last_seen,
            "is_on_site": is_on_site,
            "distance_from_site_km": distance,
        }
        records.append(record)

    on_site_count = sum(1 for r in records if r["is_on_site"])
    print(f"   Generated {len(records)} tracker records ({on_site_count} on site, {len(records) - on_site_count} off site)")
    return records


def generate_delivery_dates(po_records):
    """Generate ~80 delivery date records."""
    print("\n[6/6] Generating Delivery Dates...")

    records = []

    # Get unique POs and their suppliers
    po_supplier = {}
    for r in po_records:
        po_supplier[r["purchase_order_id"]] = r["supplier"]
    po_ids = list(po_supplier.keys())

    # Equipment/package descriptions per phase
    phase_packages = {
        "Phase 1 - Foundation": [
            "Concrete Piles 24\" - Lot A", "Pile Caps & Grade Beams",
            "Foundation Rebar Package", "Anchor Bolt Assemblies",
            "Slab on Grade Concrete", "Equipment Foundations - Area 1",
            "Equipment Foundations - Area 2", "Underground Piping Package",
        ],
        "Phase 2 - Structural": [
            "Pipe Rack Steel Section A", "Pipe Rack Steel Section B",
            "Main Structure Steel Package", "Platform & Access Steel",
            "Stair Tower Assemblies", "Grating & Checkered Plate",
            "Handrail Package", "Fireproofing Materials",
        ],
        "Phase 3 - Mechanical": [
            "BOG Compressor Package", "LNG Heat Exchanger HX-101",
            "LNG Heat Exchanger HX-102", "Refrigerant Compressor RC-101",
            "Air Cooler Bundle AC-101", "Separator Vessel V-201",
            "KO Drum D-301", "Centrifugal Pump P-101",
            "Centrifugal Pump P-102", "Loading Arm Assembly",
            "Cryogenic Piping Spools", "Carbon Steel Pipe Spools",
            "Large Bore Valve Package", "Small Bore Valve Package",
            "Steam Trap Assembly Package", "Gasket & Fastener Package",
        ],
        "Phase 4 - Electrical/Instrumentation": [
            "13.8kV Switchgear Assembly", "Main Power Transformer",
            "Motor Control Center MCC-1", "Motor Control Center MCC-2",
            "Emergency Generator Package", "UPS System",
            "DCS System Cabinet", "SIS Safety System",
            "Field Instruments Package A", "Field Instruments Package B",
            "Control Valves Package", "Power Cable Package",
            "Instrument Cable Package", "Junction Box Package",
            "Fire & Gas Detection System", "CCTV System Package",
        ],
        "Phase 5 - Commissioning": [
            "Commissioning Spares Package", "Startup Chemical Package",
            "Calibration Equipment", "Temporary Facilities",
            "First Fill Lubricants", "Refrigerant Charge",
        ],
    }

    tag_counters = {}

    for phase, packages in phase_packages.items():
        for pkg in packages:
            po_id = random.choice(po_ids)
            supplier = po_supplier.get(po_id, random.choice(SUPPLIERS))

            # Generate a tag number
            prefix = "".join(w[0] for w in pkg.split()[:2] if w[0].isalpha()).upper()
            if prefix not in tag_counters:
                tag_counters[prefix] = 100
            tag_counters[prefix] += 1
            tag_number = f"{prefix}-{tag_counters[prefix]}"

            # Delivery date based on phase
            if "Phase 1" in phase:
                del_date = random_date(date(2025, 9, 1), date(2025, 12, 31))
            elif "Phase 2" in phase:
                del_date = random_date(date(2025, 11, 1), date(2026, 3, 31))
            elif "Phase 3" in phase:
                del_date = random_date(date(2026, 1, 1), date(2026, 6, 30))
            elif "Phase 4" in phase:
                del_date = random_date(date(2026, 3, 1), date(2026, 7, 31))
            else:
                del_date = random_date(date(2026, 6, 1), date(2026, 8, 31))

            record = {
                "project_phase": phase,
                "package_description": pkg,
                "tag_number": tag_number,
                "supplier_name": supplier,
                "po_number": po_id,
                "delivery_date": del_date,
            }
            records.append(record)

    # Fill up to ~80 with additional items if needed
    while len(records) < 80:
        phase = random.choice(PROJECT_PHASES)
        pkg = random.choice(phase_packages[phase])
        po_id = random.choice(po_ids)
        supplier = po_supplier.get(po_id, random.choice(SUPPLIERS))

        prefix = "".join(w[0] for w in pkg.split()[:2] if w[0].isalpha()).upper()
        if prefix not in tag_counters:
            tag_counters[prefix] = 100
        tag_counters[prefix] += 1
        tag_number = f"{prefix}-{tag_counters[prefix]}"

        del_date = random_date(date(2025, 9, 1), date(2026, 8, 31))

        records.append({
            "project_phase": phase,
            "package_description": pkg + " - Additional",
            "tag_number": tag_number,
            "supplier_name": supplier,
            "po_number": po_id,
            "delivery_date": del_date,
        })

    # Trim to ~80
    records = records[:80]

    print(f"   Generated {len(records)} delivery date records")
    return records


# =============================================================================
# MAIN EXECUTION
# =============================================================================

def main():
    print("=" * 80)
    print("DEMO DATA GENERATOR - Greenfield LNG Terminal")
    print("Contractor: Invenio-Tek")
    print(f"Target: {SUPABASE_URL}")
    print("=" * 80)

    # Seed for reproducibility (optional - remove for different data each run)
    random.seed(42)

    # --- Generate all data ---
    po_records = generate_purchase_orders()
    shipment_records = generate_shipments(po_records)
    metrics_records = generate_dashboard_metrics(po_records, shipment_records)
    schedule_records = generate_project_schedule()
    tracker_records = generate_samsara_trackers()
    delivery_records = generate_delivery_dates(po_records)

    # --- Clear existing data ---
    print("\n" + "=" * 80)
    print("CLEARING EXISTING DATA...")
    print("=" * 80)

    tables_to_clear = [
        "dashboard_metrics",
        "shipments",
        "purchase_orders",
        "project_schedule",
        "delivery_dates",
    ]
    for table in tables_to_clear:
        clear_table(table)

    # Clear samsara_trackers with text PK
    url = f"{SUPABASE_URL}/rest/v1/samsara_trackers?id=neq."
    try:
        response = requests.delete(url, headers=HEADERS_DELETE)
        if response.status_code in [200, 204]:
            print(f"   Cleared table: samsara_trackers")
        else:
            print(f"   Warning clearing samsara_trackers: {response.status_code} - {response.text[:200]}")
    except Exception as e:
        print(f"   Warning clearing samsara_trackers: {e}")

    # --- Insert data ---
    print("\n" + "=" * 80)
    print("INSERTING DATA...")
    print("=" * 80)

    # 1. Purchase Orders
    print("\n>> Inserting Purchase Orders...")
    if not batch_insert("purchase_orders", po_records):
        print("   FAILED to insert purchase orders. Stopping.")
        return

    # 2. Shipments
    print("\n>> Inserting Shipments...")
    if not batch_insert("shipments", shipment_records):
        print("   FAILED to insert shipments. Stopping.")
        return

    # 3. Dashboard Metrics (upsert with resolution header)
    print("\n>> Inserting Dashboard Metrics...")
    url = f"{SUPABASE_URL}/rest/v1/dashboard_metrics"
    upsert_headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    try:
        response = requests.post(url, headers=upsert_headers, json=metrics_records)
        if response.status_code in [200, 201]:
            print("   Dashboard metrics inserted successfully")
        else:
            print(f"   ERROR: {response.status_code} - {response.text[:200]}")
    except Exception as e:
        print(f"   ERROR: {e}")

    # 4. Project Schedule
    print("\n>> Inserting Project Schedule...")
    if not batch_insert("project_schedule", schedule_records):
        print("   FAILED to insert project schedule. Stopping.")
        return

    # 5. Samsara Trackers (upsert since PK is text)
    print("\n>> Inserting Samsara Trackers...")
    url = f"{SUPABASE_URL}/rest/v1/samsara_trackers"
    try:
        response = requests.post(url, headers=upsert_headers, json=tracker_records)
        if response.status_code in [200, 201]:
            print(f"   Inserted {len(tracker_records)} tracker records")
        else:
            print(f"   ERROR: {response.status_code} - {response.text[:200]}")
    except Exception as e:
        print(f"   ERROR: {e}")

    # 6. Delivery Dates
    print("\n>> Inserting Delivery Dates...")
    if not batch_insert("delivery_dates", delivery_records):
        print("   FAILED to insert delivery dates. Stopping.")
        return

    # --- Summary ---
    print("\n" + "=" * 80)
    print("DEMO DATA GENERATION COMPLETE")
    print("=" * 80)
    print(f"  Purchase Orders:    {len(po_records)} records")
    print(f"  Shipments:          {len(shipment_records)} records")
    print(f"  Dashboard Metrics:  {len(metrics_records)} record")
    print(f"  Project Schedule:   {len(schedule_records)} records")
    print(f"  Samsara Trackers:   {len(tracker_records)} records")
    print(f"  Delivery Dates:     {len(delivery_records)} records")
    total = len(po_records) + len(shipment_records) + len(metrics_records) + len(schedule_records) + len(tracker_records) + len(delivery_records)
    print(f"  TOTAL:              {total} records")
    print("=" * 80)


if __name__ == "__main__":
    main()

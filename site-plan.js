/**
 * Synoptic Model — Repurposed Automobile Factory
 * Demo data + interactive floor-plan logic
 */

// ─────────────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────────────
const STATUS = {
    installed: { label: 'Installed', color: '#2563EB', icon: 'fa-check-circle' },
    on_site: { label: 'On Site', color: '#3a3a3a', icon: 'fa-warehouse' },
    in_transit: { label: 'In Transit', color: '#f5a623', icon: 'fa-truck' },
    at_vendor: { label: 'At Vendor', color: '#d0021b', icon: 'fa-industry' },
    staged_offsite: { label: 'Staged Off-site', color: '#999999', icon: 'fa-map-marker-alt' },
};

const CATEGORY_ICONS = {
    Mechanical: 'fa-cogs',
    Electrical: 'fa-bolt',
    Instrumentation: 'fa-tachometer-alt',
    Civil: 'fa-hard-hat',
    Steel: 'fa-building',
    Piping: 'fa-water',
};

// ─────────────────────────────────────────────────
// ZONE LAYOUT (used for dot placement)
// ─────────────────────────────────────────────────
const ZONES = {
    assembly_hall: { x: 70, y: 70, w: 360, h: 170, label: 'Assembly Hall' },
    mechanical_bay: { x: 460, y: 70, w: 300, h: 170, label: 'Mechanical Bay' },
    pipe_shop: { x: 70, y: 260, w: 210, h: 155, label: 'Pipe Shop' },
    instrument_shop: { x: 300, y: 260, w: 200, h: 155, label: 'Instrument Shop' },
    electrical_room: { x: 520, y: 260, w: 190, h: 155, label: 'Electrical Room' },
    warehouse: { x: 730, y: 260, w: 200, h: 155, label: 'Warehouse' },
    laydown_yard: { x: 70, y: 500, w: 420, h: 110, label: 'Laydown Yard' },
    loading_dock: { x: 610, y: 500, w: 280, h: 110, label: 'Loading Dock' },
};

// ─────────────────────────────────────────────────
// DEMO ASSET DATA (~60 items)
// ─────────────────────────────────────────────────
const ASSETS = [
    // ── Assembly Hall ──
    { id: 'A001', name: 'BOG Compressor Module', tag: 'CM-101', category: 'Mechanical', zone: 'assembly_hall', status: 'installed', po: 'PO-14723', supplier: 'Atlas Industrial Supply', eta: null, desc: 'Boil-off gas compressor package, 1500 HP' },
    { id: 'A002', name: 'LNG Heat Exchanger HX-1', tag: 'HX-201', category: 'Mechanical', zone: 'assembly_hall', status: 'installed', po: 'PO-14801', supplier: 'Summit Fabrication Inc.', eta: null, desc: 'Shell & tube heat exchanger, cryogenic service' },
    { id: 'A003', name: 'Cryogenic Expander Unit', tag: 'EX-301', category: 'Mechanical', zone: 'assembly_hall', status: 'on_site', po: 'PO-14856', supplier: 'Pacific Valve & Fitting', eta: null, desc: 'Turbo-expander for LNG process' },
    { id: 'A004', name: 'LNG Loading Arm Assembly', tag: 'LA-401', category: 'Mechanical', zone: 'assembly_hall', status: 'on_site', po: 'PO-14920', supplier: 'Coastal Pipe Solutions', eta: null, desc: 'Marine loading arm, 16" flanged' },
    { id: 'A005', name: 'Process Gas Compressor', tag: 'CM-102', category: 'Mechanical', zone: 'assembly_hall', status: 'installed', po: 'PO-14735', supplier: 'Atlas Industrial Supply', eta: null, desc: 'Centrifugal compressor, 2000 HP' },
    { id: 'A006', name: 'Refrigerant Compressor', tag: 'RC-501', category: 'Mechanical', zone: 'assembly_hall', status: 'on_site', po: 'PO-14990', supplier: 'Magnolia Pump & Compressor', eta: null, desc: 'Screw compressor for propane refrigerant' },
    { id: 'A007', name: 'Fin Fan Air Cooler', tag: 'AC-601', category: 'Mechanical', zone: 'assembly_hall', status: 'installed', po: 'PO-15001', supplier: 'Summit Fabrication Inc.', eta: null, desc: 'Forced-draft air cooler bank' },

    // ── Mechanical Bay ──
    { id: 'A008', name: 'Centrifugal Pump 150HP', tag: 'P-101', category: 'Mechanical', zone: 'mechanical_bay', status: 'installed', po: 'PO-14750', supplier: 'Magnolia Pump & Compressor', eta: null, desc: 'API 610 process pump' },
    { id: 'A009', name: 'Centrifugal Pump 75HP', tag: 'P-102', category: 'Mechanical', zone: 'mechanical_bay', status: 'on_site', po: 'PO-14751', supplier: 'Magnolia Pump & Compressor', eta: null, desc: 'Booster pump for firewater' },
    { id: 'A010', name: 'Cryogenic Pump Assembly', tag: 'P-201', category: 'Mechanical', zone: 'mechanical_bay', status: 'on_site', po: 'PO-14810', supplier: 'Atlas Industrial Supply', eta: null, desc: 'Submerged motor cryogenic pump' },
    { id: 'A011', name: 'Blower Assembly 50HP', tag: 'BL-101', category: 'Mechanical', zone: 'mechanical_bay', status: 'installed', po: 'PO-14880', supplier: 'Summit Fabrication Inc.', eta: null, desc: 'Positive displacement blower' },
    { id: 'A012', name: 'Lube Oil System Package', tag: 'LO-101', category: 'Mechanical', zone: 'mechanical_bay', status: 'on_site', po: 'PO-14900', supplier: 'Bayou City Instruments', eta: null, desc: 'Lube oil skid for compressors' },

    // ── Electrical Room ──
    { id: 'A013', name: 'MCC Panel 480V', tag: 'MCC-01', category: 'Electrical', zone: 'electrical_room', status: 'installed', po: 'PO-14760', supplier: 'Apex Electrical Systems', eta: null, desc: 'Motor control center, 480V 3PH 60HZ' },
    { id: 'A014', name: 'MCC Panel 480V #2', tag: 'MCC-02', category: 'Electrical', zone: 'electrical_room', status: 'installed', po: 'PO-14761', supplier: 'Apex Electrical Systems', eta: null, desc: 'Motor control center, 480V' },
    { id: 'A015', name: 'VFD Drive 200HP', tag: 'VFD-01', category: 'Electrical', zone: 'electrical_room', status: 'on_site', po: 'PO-14820', supplier: 'Apex Electrical Systems', eta: null, desc: 'Variable frequency drive for pump' },
    { id: 'A016', name: 'Distribution Transformer', tag: 'TX-01', category: 'Electrical', zone: 'electrical_room', status: 'installed', po: 'PO-14830', supplier: 'Lone Star Controls', eta: null, desc: '750kVA dry-type transformer' },
    { id: 'A017', name: 'UPS System 30kVA', tag: 'UPS-01', category: 'Electrical', zone: 'electrical_room', status: 'on_site', po: 'PO-14835', supplier: 'Apex Electrical Systems', eta: null, desc: 'Uninterruptible power supply' },
    { id: 'A018', name: 'Battery Charger 125VDC', tag: 'BC-01', category: 'Electrical', zone: 'electrical_room', status: 'installed', po: 'PO-14840', supplier: 'Apex Electrical Systems', eta: null, desc: 'DC battery charger for controls' },

    // ── Instrument Shop ──
    { id: 'A019', name: 'DCS Controller Cabinet', tag: 'DCS-01', category: 'Instrumentation', zone: 'instrument_shop', status: 'installed', po: 'PO-14770', supplier: 'Lone Star Controls', eta: null, desc: 'Distributed control system main cabinet' },
    { id: 'A020', name: 'SIS Logic Solver', tag: 'SIS-01', category: 'Instrumentation', zone: 'instrument_shop', status: 'on_site', po: 'PO-14780', supplier: 'Lone Star Controls', eta: null, desc: 'Safety instrumented system processor' },
    { id: 'A021', name: 'Control Valve 6" Globe', tag: 'CV-101', category: 'Instrumentation', zone: 'instrument_shop', status: 'on_site', po: 'PO-14850', supplier: 'Pacific Valve & Fitting', eta: null, desc: 'Control valve, 6" 300# globe, CV=180' },
    { id: 'A022', name: 'Pressure Transmitters (lot)', tag: 'PT-LOT-01', category: 'Instrumentation', zone: 'instrument_shop', status: 'installed', po: 'PO-14860', supplier: 'Bayou City Instruments', eta: null, desc: 'Smart pressure transmitters, 24 pcs' },
    { id: 'A023', name: 'Level Transmitter Radar', tag: 'LT-201', category: 'Instrumentation', zone: 'instrument_shop', status: 'on_site', po: 'PO-14870', supplier: 'Bayou City Instruments', eta: null, desc: 'Guided wave radar level transmitter' },

    // ── Pipe Shop ──
    { id: 'A024', name: 'CS Pipe Spools Lot 1', tag: 'SP-LOT-01', category: 'Piping', zone: 'pipe_shop', status: 'installed', po: 'PO-14700', supplier: 'Coastal Pipe Solutions', eta: null, desc: 'Carbon steel pipe spools, 12"-24"' },
    { id: 'A025', name: 'SS Pipe Spools Lot 1', tag: 'SP-LOT-02', category: 'Piping', zone: 'pipe_shop', status: 'on_site', po: 'PO-14710', supplier: 'Coastal Pipe Solutions', eta: null, desc: 'Stainless steel pipe spools, 4"-8"' },
    { id: 'A026', name: 'Flanges & Gaskets Kit', tag: 'FL-KIT-01', category: 'Piping', zone: 'pipe_shop', status: 'installed', po: 'PO-14715', supplier: 'Brazos Valley Pipe & Supply', eta: null, desc: 'Assorted flanges 300# and spiral wound gaskets' },
    { id: 'A027', name: 'Safety Relief Valves (lot)', tag: 'PSV-LOT-01', category: 'Piping', zone: 'pipe_shop', status: 'on_site', po: 'PO-14870', supplier: 'Pacific Valve & Fitting', eta: null, desc: 'Pressure safety valves, 6" & 8"' },

    // ── Warehouse ──
    { id: 'A028', name: 'Pipe Supports & Shoes', tag: 'PS-LOT-01', category: 'Steel', zone: 'warehouse', status: 'on_site', po: 'PO-14720', supplier: 'Red River Fabrication', eta: null, desc: 'Guided pipe shoes and spring hangers' },
    { id: 'A029', name: 'Bolting Hardware Kit', tag: 'BH-KIT-01', category: 'Piping', zone: 'warehouse', status: 'on_site', po: 'PO-14725', supplier: 'Brazos Valley Pipe & Supply', eta: null, desc: 'Studs, nuts, washers — alloy & CS' },
    { id: 'A030', name: 'Instrument Cable Reels', tag: 'IC-LOT-01', category: 'Instrumentation', zone: 'warehouse', status: 'on_site', po: 'PO-14790', supplier: 'Apex Electrical Systems', eta: null, desc: '18-AWG shielded instrument cable, 50 reels' },
    { id: 'A031', name: 'Power Cable 4/0 AWG', tag: 'PC-LOT-01', category: 'Electrical', zone: 'warehouse', status: 'on_site', po: 'PO-14795', supplier: 'Apex Electrical Systems', eta: null, desc: 'MV power cable, 20 reels' },
    { id: 'A032', name: 'Insulation Material Lot', tag: 'INS-LOT-01', category: 'Piping', zone: 'warehouse', status: 'on_site', po: 'PO-14800', supplier: 'Tidewater Coatings Inc.', eta: null, desc: 'Calcium silicate insulation, 4"' },

    // ── Laydown Yard ──
    { id: 'A033', name: 'W-Beam W24x76 (lot)', tag: 'STL-01', category: 'Steel', zone: 'laydown_yard', status: 'on_site', po: 'PO-14730', supplier: 'Meridian Steel Co.', eta: null, desc: 'Structural steel wide-flange beams' },
    { id: 'A034', name: 'Pipe Rack Steel Lot', tag: 'STL-02', category: 'Steel', zone: 'laydown_yard', status: 'installed', po: 'PO-14740', supplier: 'Meridian Steel Co.', eta: null, desc: 'Pipe rack structural steel, 12 bays' },
    { id: 'A035', name: 'Platform Grating', tag: 'STL-03', category: 'Steel', zone: 'laydown_yard', status: 'on_site', po: 'PO-14745', supplier: 'Red River Fabrication', eta: null, desc: '1" bearing bar grating panels' },
    { id: 'A036', name: 'Handrail Assemblies', tag: 'STL-04', category: 'Steel', zone: 'laydown_yard', status: 'on_site', po: 'PO-14747', supplier: 'Red River Fabrication', eta: null, desc: 'Galvanized pipe handrails, prefab sections' },
    { id: 'A037', name: 'Rebar Bundle #3-#8', tag: 'CIV-01', category: 'Civil', zone: 'laydown_yard', status: 'on_site', po: 'PO-14690', supplier: 'Meridian Steel Co.', eta: null, desc: 'Reinforcing steel, various sizes' },
    { id: 'A038', name: 'Precast Concrete Pads', tag: 'CIV-02', category: 'Civil', zone: 'laydown_yard', status: 'installed', po: 'PO-14695', supplier: 'Gulf Coast Specialty', eta: null, desc: 'Equipment foundation pads, precast' },
    { id: 'A039', name: 'Large Bore Pipe 24"', tag: 'PP-01', category: 'Piping', zone: 'laydown_yard', status: 'on_site', po: 'PO-14705', supplier: 'Coastal Pipe Solutions', eta: null, desc: 'API 5L X52 pipe, 24" OD, 120ft sections' },

    // ── Loading Dock ──
    { id: 'A040', name: 'VFD Drive 100HP', tag: 'VFD-02', category: 'Electrical', zone: 'loading_dock', status: 'on_site', po: 'PO-14825', supplier: 'Apex Electrical Systems', eta: null, desc: 'Variable frequency drive — just received' },
    { id: 'A041', name: 'Flow Meter Coriolis 6"', tag: 'FT-101', category: 'Instrumentation', zone: 'loading_dock', status: 'on_site', po: 'PO-14875', supplier: 'Bayou City Instruments', eta: null, desc: 'Coriolis mass flow meter, arrived yesterday' },
    { id: 'A042', name: 'Stair Stringer Assembly', tag: 'STL-05', category: 'Steel', zone: 'loading_dock', status: 'on_site', po: 'PO-14748', supplier: 'Red River Fabrication', eta: null, desc: 'Prefab stair stringers, 3 sets' },

    // ── OFF-SITE: In Transit ──
    { id: 'A043', name: 'LNG Heat Exchanger HX-2', tag: 'HX-202', category: 'Mechanical', zone: null, status: 'in_transit', po: 'PO-14802', supplier: 'Summit Fabrication Inc.', eta: '2026-03-10', desc: 'Second heat exchanger unit, heavy haul' },
    { id: 'A044', name: 'Emergency Generator 2MW', tag: 'GEN-01', category: 'Electrical', zone: null, status: 'in_transit', po: 'PO-14845', supplier: 'Apex Electrical Systems', eta: '2026-03-05', desc: 'Standby diesel generator package' },
    { id: 'A045', name: 'Fire Alarm Control Panel', tag: 'FACP-01', category: 'Electrical', zone: null, status: 'in_transit', po: 'PO-14848', supplier: 'Lone Star Controls', eta: '2026-03-02', desc: 'Main fire detection & alarm panel' },
    { id: 'A046', name: 'CS Pipe Spools Lot 2', tag: 'SP-LOT-03', category: 'Piping', zone: null, status: 'in_transit', po: 'PO-14702', supplier: 'Coastal Pipe Solutions', eta: '2026-03-08', desc: 'Carbon steel spools, remainder of order' },
    { id: 'A047', name: 'Cathodic Protection Kit', tag: 'CP-01', category: 'Electrical', zone: null, status: 'in_transit', po: 'PO-14849', supplier: 'Tidewater Coatings Inc.', eta: '2026-03-12', desc: 'Impressed current CP rectifier + anodes' },
    { id: 'A048', name: 'Concrete Batch (80 yd³)', tag: 'CIV-03', category: 'Civil', zone: null, status: 'in_transit', po: 'PO-14698', supplier: 'Gulf Coast Specialty', eta: '2026-02-28', desc: 'Ready-mix concrete delivery' },
    { id: 'A049', name: 'Bus Duct Assembly', tag: 'BD-01', category: 'Electrical', zone: null, status: 'in_transit', po: 'PO-14842', supplier: 'Apex Electrical Systems', eta: '2026-03-15', desc: 'Medium-voltage bus duct, 30ft sections' },
    { id: 'A050', name: 'HSS Columns 12x12', tag: 'STL-06', category: 'Steel', zone: null, status: 'in_transit', po: 'PO-14742', supplier: 'Meridian Steel Co.', eta: '2026-03-04', desc: 'Hollow structural sections for building steel' },

    // ── OFF-SITE: At Vendor ──
    { id: 'A051', name: 'Compressor Spare Rotor', tag: 'CM-101-SP', category: 'Mechanical', zone: null, status: 'at_vendor', po: 'PO-14950', supplier: 'Atlas Industrial Supply', eta: '2026-04-15', desc: 'Spare rotor assembly for BOG compressor' },
    { id: 'A052', name: 'ESD Valve 12" Ball', tag: 'XV-101', category: 'Instrumentation', zone: null, status: 'at_vendor', po: 'PO-14890', supplier: 'Pacific Valve & Fitting', eta: '2026-04-01', desc: 'Emergency shutdown valve, SIL-3 rated' },
    { id: 'A053', name: 'Flare Stack Assembly', tag: 'FL-01', category: 'Mechanical', zone: null, status: 'at_vendor', po: 'PO-14960', supplier: 'Gulf Coast Specialty', eta: '2026-05-01', desc: 'Enclosed flare, 150ft, being fabricated' },
    { id: 'A054', name: 'Pressure Vessel V-301', tag: 'V-301', category: 'Mechanical', zone: null, status: 'at_vendor', po: 'PO-14970', supplier: 'Summit Fabrication Inc.', eta: '2026-04-20', desc: 'Separator vessel, ASME U-stamp, 48" ID' },
    { id: 'A055', name: 'Switchgear 13.8kV', tag: 'SWG-01', category: 'Electrical', zone: null, status: 'at_vendor', po: 'PO-14850', supplier: 'Apex Electrical Systems', eta: '2026-04-10', desc: 'Medium-voltage metal-clad switchgear' },
    { id: 'A056', name: 'DCS I/O Marshalling', tag: 'DCS-02', category: 'Instrumentation', zone: null, status: 'at_vendor', po: 'PO-14775', supplier: 'Lone Star Controls', eta: '2026-03-25', desc: 'I/O marshalling cabinet with termination blocks' },
    { id: 'A057', name: 'Cooling Tower Package', tag: 'CT-01', category: 'Mechanical', zone: null, status: 'at_vendor', po: 'PO-15010', supplier: 'Summit Fabrication Inc.', eta: '2026-05-10', desc: 'Induced-draft cooling tower, FRP construction' },
    { id: 'A058', name: 'Chain Link Fence 8ft', tag: 'CIV-04', category: 'Civil', zone: null, status: 'at_vendor', po: 'PO-14693', supplier: 'Red River Fabrication', eta: '2026-03-20', desc: 'Perimeter security fencing with gates' },

    // ── OFF-SITE: Staged Off-site ──
    { id: 'A059', name: 'Firewater Pump Skid', tag: 'FWP-01', category: 'Mechanical', zone: null, status: 'staged_offsite', po: 'PO-14980', supplier: 'Magnolia Pump & Compressor', eta: '2026-03-15', desc: 'Staged at vendor yard, awaiting foundation' },
    { id: 'A060', name: 'Geotextile Fabric (Rolls)', tag: 'CIV-05', category: 'Civil', zone: null, status: 'staged_offsite', po: 'PO-14692', supplier: 'Gulf Coast Specialty', eta: '2026-03-01', desc: 'Woven geotextile, stored at offsite laydown' },
    { id: 'A061', name: 'Portable Substation', tag: 'PSS-01', category: 'Electrical', zone: null, status: 'staged_offsite', po: 'PO-14855', supplier: 'Apex Electrical Systems', eta: '2026-03-08', desc: 'Temp power substation, staged at contractor yard' },
];


// ─────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────
let filteredAssets = [...ASSETS];
let activeZone = null;

// ─────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderKPIs();
    renderFloorPlan();
    renderOffsitePanel();
    setupEventListeners();
});

// ─────────────────────────────────────────────────
// KPI RENDERING
// ─────────────────────────────────────────────────
function renderKPIs() {
    const counts = { installed: 0, on_site: 0, in_transit: 0, at_vendor: 0, staged_offsite: 0 };
    filteredAssets.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

    document.getElementById('kpiInstalled').textContent = counts.installed;
    document.getElementById('kpiOnSite').textContent = counts.on_site;
    document.getElementById('kpiInTransit').textContent = counts.in_transit;
    document.getElementById('kpiAtVendor').textContent = counts.at_vendor;
    document.getElementById('kpiTotal').textContent = filteredAssets.length;
}

// ─────────────────────────────────────────────────
// FLOOR PLAN RENDERING
// ─────────────────────────────────────────────────
function renderFloorPlan() {
    const svg = document.getElementById('floorPlanSvg');

    // Clear existing asset dots
    svg.querySelectorAll('.asset-dot').forEach(el => el.remove());
    svg.querySelectorAll('.zone-count-badge').forEach(el => el.remove());

    // Place dots for on-site assets
    Object.keys(ZONES).forEach(zoneKey => {
        const zone = ZONES[zoneKey];
        const zoneAssets = filteredAssets.filter(a => a.zone === zoneKey);
        const assetsGroup = svg.querySelector(`.zone-assets[data-zone="${zoneKey}"]`);

        if (!assetsGroup) return;

        // Clear  existing contents from assets group
        assetsGroup.innerHTML = '';

        // Grid layout for dots inside zone
        const padding = 20;
        const dotR = 6;
        const spacing = 22;
        const startX = zone.x + padding;
        const startY = zone.y + 115; // below labels
        const cols = Math.floor((zone.w - 2 * padding) / spacing);

        zoneAssets.forEach((asset, i) => {
            const col = i % Math.max(cols, 1);
            const row = Math.floor(i / Math.max(cols, 1));
            const cx = startX + col * spacing + dotR;
            const cy = startY + row * spacing + dotR;

            // Ensure dot stays within zone bounds
            if (cy + dotR > zone.y + zone.h - 5) return;

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', dotR);
            circle.setAttribute('fill', STATUS[asset.status].color);
            circle.setAttribute('class', 'asset-dot' + (isRecent(asset) ? ' recent' : ''));
            circle.setAttribute('data-asset-id', asset.id);
            circle.style.filter = `drop-shadow(0 0 3px ${STATUS[asset.status].color}40)`;

            // Tooltip on hover
            circle.addEventListener('mouseenter', (e) => showAssetTooltip(e, asset));
            circle.addEventListener('mouseleave', hideAssetTooltip);
            circle.addEventListener('click', () => showAssetModal(asset));

            assetsGroup.appendChild(circle);
        });

        // Zone count badge
        if (zoneAssets.length > 0) {
            const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeG.setAttribute('class', 'zone-count-badge');

            const badgeX = zone.x + zone.w - 30;
            const badgeY = zone.y + 15;

            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', badgeX);
            bg.setAttribute('y', badgeY);
            bg.setAttribute('width', 24);
            bg.setAttribute('height', 18);
            bg.setAttribute('rx', 9);
            bg.setAttribute('fill', 'rgba(37,99,235,0.15)');
            bg.setAttribute('stroke', 'rgba(37,99,235,0.3)');
            bg.setAttribute('stroke-width', '1');

            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', badgeX + 12);
            txt.setAttribute('y', badgeY + 13);
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('fill', '#3a3a3a');
            txt.setAttribute('font-size', '10');
            txt.setAttribute('font-weight', '600');
            txt.textContent = zoneAssets.length;

            badgeG.appendChild(bg);
            badgeG.appendChild(txt);
            assetsGroup.appendChild(badgeG);
        }
    });
}

function isRecent(asset) {
    // Simulate: loading dock items are "recently arrived"
    return asset.zone === 'loading_dock';
}

// ─────────────────────────────────────────────────
// ZONE TOOLTIP
// ─────────────────────────────────────────────────
function setupZoneTooltips() {
    const tooltip = document.getElementById('zoneTooltip');
    const zoneGroups = document.querySelectorAll('.zone-group');

    zoneGroups.forEach(group => {
        const zoneKey = group.dataset.zone;

        group.addEventListener('mouseenter', (e) => {
            const zone = ZONES[zoneKey];
            const zoneAssets = filteredAssets.filter(a => a.zone === zoneKey);
            const installed = zoneAssets.filter(a => a.status === 'installed').length;
            const onSite = zoneAssets.filter(a => a.status === 'on_site').length;
            const pct = zoneAssets.length > 0 ? Math.round((installed / zoneAssets.length) * 100) : 0;

            tooltip.innerHTML = `
                <div class="tt-title">${zone.label}</div>
                <div class="tt-row"><span>Total Assets</span><span>${zoneAssets.length}</span></div>
                <div class="tt-row"><span>Installed</span><span>${installed}</span></div>
                <div class="tt-row"><span>On Site</span><span>${onSite}</span></div>
                <div class="tt-row"><span>Completion</span><span>${pct}%</span></div>
            `;
            tooltip.classList.add('visible');
        });

        group.addEventListener('mousemove', (e) => {
            const rect = document.querySelector('.floor-plan-body').getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        });

        group.addEventListener('mouseleave', () => {
            tooltip.classList.remove('visible');
        });

        group.addEventListener('click', () => {
            if (activeZone === zoneKey) {
                activeZone = null;
                group.classList.remove('active');
                applyFilters();
            } else {
                document.querySelectorAll('.zone-group').forEach(g => g.classList.remove('active'));
                activeZone = zoneKey;
                group.classList.add('active');
                applyFilters();
            }
        });
    });
}

// ─────────────────────────────────────────────────
// ASSET TOOLTIP (on dot hover)
// ─────────────────────────────────────────────────
function showAssetTooltip(e, asset) {
    const tooltip = document.getElementById('zoneTooltip');
    const rect = document.querySelector('.floor-plan-body').getBoundingClientRect();

    tooltip.innerHTML = `
        <div class="tt-title">${asset.name}</div>
        <div class="tt-row"><span>Tag</span><span>${asset.tag}</span></div>
        <div class="tt-row"><span>Status</span><span style="color:${STATUS[asset.status].color}">${STATUS[asset.status].label}</span></div>
        <div class="tt-row"><span>Category</span><span>${asset.category}</span></div>
    `;
    tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
    tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
    tooltip.classList.add('visible');
}

function hideAssetTooltip() {
    document.getElementById('zoneTooltip').classList.remove('visible');
}

// ─────────────────────────────────────────────────
// ASSET DETAIL MODAL
// ─────────────────────────────────────────────────
function showAssetModal(asset) {
    const modal = new bootstrap.Modal(document.getElementById('assetModal'));
    document.getElementById('assetModalTitle').innerHTML = `
        <i class="fas ${CATEGORY_ICONS[asset.category] || 'fa-cube'} me-2" style="color:var(--lime-green);"></i>
        ${asset.name}
    `;

    const statusClass = 'status-' + asset.status;
    const zoneName = asset.zone ? ZONES[asset.zone].label : 'Off-site';
    const etaDisplay = asset.eta ? formatDate(asset.eta) : '—';

    document.getElementById('assetModalBody').innerHTML = `
        <div style="text-align:center; margin-bottom:1.25rem;">
            <span class="status-pill ${statusClass}">${STATUS[asset.status].label}</span>
        </div>
        <div class="detail-field">
            <span class="field-label">Tag Number</span>
            <span class="field-value">${asset.tag}</span>
        </div>
        <div class="detail-field">
            <span class="field-label">Category</span>
            <span class="field-value">${asset.category}</span>
        </div>
        <div class="detail-field">
            <span class="field-label">Location</span>
            <span class="field-value">${zoneName}</span>
        </div>
        <div class="detail-field">
            <span class="field-label">PO Number</span>
            <span class="field-value">${asset.po}</span>
        </div>
        <div class="detail-field">
            <span class="field-label">Supplier</span>
            <span class="field-value">${asset.supplier}</span>
        </div>
        <div class="detail-field">
            <span class="field-label">ETA</span>
            <span class="field-value">${etaDisplay}</span>
        </div>
        <div class="detail-field" style="border-bottom:none;">
            <span class="field-label">Description</span>
            <span class="field-value" style="max-width:60%; text-align:right;">${asset.desc}</span>
        </div>
    `;

    modal.show();
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─────────────────────────────────────────────────
// OFF-SITE PANEL
// ─────────────────────────────────────────────────
function renderOffsitePanel() {
    const container = document.getElementById('offsiteList');
    const offsite = filteredAssets.filter(a => !a.zone);

    const groups = {
        in_transit: offsite.filter(a => a.status === 'in_transit'),
        at_vendor: offsite.filter(a => a.status === 'at_vendor'),
        staged_offsite: offsite.filter(a => a.status === 'staged_offsite'),
    };

    let html = '';

    Object.keys(groups).forEach(statusKey => {
        const items = groups[statusKey];
        if (items.length === 0) return;
        const st = STATUS[statusKey];

        html += `
            <div class="status-group">
                <div class="status-group-header">
                    <div class="dot" style="background:${st.color};"></div>
                    <span class="label">${st.label}</span>
                    <span class="count">${items.length}</span>
                </div>
        `;

        items.forEach(asset => {
            const catIcon = CATEGORY_ICONS[asset.category] || 'fa-cube';
            const eta = asset.eta ? formatDate(asset.eta) : '';
            html += `
                <div class="offsite-asset-item" data-asset-id="${asset.id}" onclick="showAssetModal(ASSETS.find(a=>a.id==='${asset.id}'))">
                    <div class="asset-icon" style="background:${st.color}20; color:${st.color};">
                        <i class="fas ${catIcon}"></i>
                    </div>
                    <div class="asset-info">
                        <div class="asset-name">${asset.name}</div>
                        <div class="asset-meta">${asset.tag} · ${asset.category}</div>
                    </div>
                    ${eta ? `<div class="asset-eta"><i class="fas fa-clock me-1"></i>${eta}</div>` : ''}
                </div>
            `;
        });

        html += `</div>`;
    });

    if (html === '') {
        html = `<div style="text-align:center; padding:2rem; color:var(--dark-gray);">
            <i class="fas fa-check-circle" style="font-size:2rem; margin-bottom:0.5rem; display:block; color:var(--status-installed);"></i>
            All assets are on-site!
        </div>`;
    }

    container.innerHTML = html;
}


// ─────────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────────
function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase().trim();
    const category = document.getElementById('filterCategory').value;
    const status = document.getElementById('filterStatus').value;

    filteredAssets = ASSETS.filter(a => {
        // Text search
        if (search) {
            const searchFields = [a.name, a.tag, a.po, a.supplier, a.desc, a.category].join(' ').toLowerCase();
            if (!searchFields.includes(search)) return false;
        }

        // Category filter
        if (category && a.category !== category) return false;

        // Status filter
        if (status && a.status !== status) return false;

        // Zone filter (from floor plan click)
        if (activeZone) {
            if (a.zone !== activeZone && a.zone !== null) return false;
            // Allow off-site items to still show in off-site panel
            if (a.zone === null) return true;
        }

        return true;
    });

    renderKPIs();
    renderFloorPlan();
    renderOffsitePanel();
}

function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterStatus').value = '';
    activeZone = null;
    document.querySelectorAll('.zone-group').forEach(g => g.classList.remove('active'));
    filteredAssets = [...ASSETS];
    renderKPIs();
    renderFloorPlan();
    renderOffsitePanel();
}

// ─────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────
function setupEventListeners() {
    // Zone tooltips and click
    setupZoneTooltips();

    // Filters
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('filterCategory').addEventListener('change', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('btnReset').addEventListener('click', resetFilters);

    // Zoom fit (reset view)
    document.getElementById('btnZoomFit').addEventListener('click', () => {
        const svg = document.getElementById('floorPlanSvg');
        svg.setAttribute('viewBox', '0 0 1100 720');
    });
}

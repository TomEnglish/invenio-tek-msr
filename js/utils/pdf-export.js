/**
 * PDF Report Generator
 * Generates a professional Material Status Report PDF from dashboard data
 * Uses a new window with print-optimized layout
 */

async function generateMSRReport() {
    const btn = document.getElementById('export-pdf-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Generating...';
    }

    try {
        // Fetch live data from Supabase
        const [
            { data: metrics },
            { data: pos },
            { data: shipments },
            { data: schedule }
        ] = await Promise.all([
            supabaseClient.from('dashboard_metrics').select('*').order('last_updated', { ascending: false }).limit(1).single(),
            supabaseClient.from('purchase_orders').select('*'),
            supabaseClient.from('shipments').select('*'),
            supabaseClient.from('project_schedule').select('*').eq('is_milestone', true).order('finish_date', { ascending: true }).limit(10)
        ]);

        const parseField = (val, fallback) => {
            if (!val) return fallback;
            if (typeof val === 'string') try { return JSON.parse(val); } catch { return fallback; }
            return val;
        };

        const procurement = parseField(metrics?.procurement, {});
        const statusCounts = parseField(metrics?.status_counts, { shipment_status: {} });
        const projectName = BRANDING?.projectName || metrics?.project_name || 'Project';
        const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const brandColor = BRANDING?.colors?.primary || '#2563EB';
        const accentColor = BRANDING?.colors?.accent || '#B0A07A';

        // Shipment stats
        const totalShipments = shipments?.length || 0;
        const delivered = shipments?.filter(s => s.status === 'Delivered').length || 0;
        const inTransit = shipments?.filter(s => s.status === 'In Transit').length || 0;
        const notRTS = shipments?.filter(s => s.status === 'Not RTS').length || 0;

        // PO stats
        const uniquePOs = new Set(pos?.map(p => p.purchase_order_id)).size || 0;
        const totalValue = pos?.reduce((sum, p) => sum + (parseFloat(p.net_value) || 0), 0) || 0;

        // Top suppliers
        const supplierCounts = {};
        (pos || []).forEach(p => {
            if (p.supplier) supplierCounts[p.supplier] = (supplierCounts[p.supplier] || 0) + 1;
        });
        const topSuppliers = Object.entries(supplierCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // Recent shipments
        const recentShipments = (shipments || [])
            .filter(s => s.delivery_date)
            .sort((a, b) => new Date(b.delivery_date) - new Date(a.delivery_date))
            .slice(0, 10);

        // Build PDF HTML
        const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>MSR Report - ${projectName}</title>
<style>
    @page { margin: 0.75in; size: letter; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #333; font-size: 11px; line-height: 1.5; }
    .header { border-bottom: 3px solid ${brandColor}; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header h1 { font-size: 22px; color: ${brandColor}; }
    .header .subtitle { font-size: 13px; color: #666; }
    .header .date { font-size: 11px; color: #999; text-align: right; }
    .header .date strong { color: #333; }
    .section { margin-bottom: 20px; page-break-inside: avoid; }
    .section h2 { font-size: 14px; color: ${brandColor}; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 10px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .kpi-card { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; text-align: center; }
    .kpi-card .value { font-size: 24px; font-weight: 700; color: ${brandColor}; }
    .kpi-card .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #f5f5f5; text-align: left; padding: 6px 8px; font-weight: 600; border-bottom: 2px solid #ddd; }
    td { padding: 5px 8px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) { background: #fafafa; }
    .badge { padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 600; display: inline-block; }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-info { background: #d1ecf1; color: #0c5460; }
    .badge-secondary { background: #e2e3e5; color: #383d41; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 9px; color: #999; display: flex; justify-content: space-between; }
    .accent-bar { width: 4px; background: ${accentColor}; border-radius: 2px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head><body>

<div class="header">
    <div>
        <h1>${projectName}</h1>
        <div class="subtitle">Material Status Report</div>
    </div>
    <div class="date">
        <strong>Report Generated</strong><br>${reportDate}
        <br><span style="color:${accentColor};">Prepared by ${BRANDING?.clientName || 'InvenioTek'}</span>
    </div>
</div>

<div class="kpi-grid">
    <div class="kpi-card">
        <div class="value">${uniquePOs}</div>
        <div class="label">Purchase Orders</div>
    </div>
    <div class="kpi-card">
        <div class="value">$${(totalValue / 1e6).toFixed(1)}M</div>
        <div class="label">Total PO Value</div>
    </div>
    <div class="kpi-card">
        <div class="value">${totalShipments}</div>
        <div class="label">Shipments</div>
    </div>
    <div class="kpi-card">
        <div class="value">${delivered}</div>
        <div class="label">Delivered</div>
    </div>
</div>

<div class="section">
    <h2>Shipment Status Summary</h2>
    <div class="kpi-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="kpi-card">
            <div class="value" style="color: #155724;">${delivered}</div>
            <div class="label">Delivered</div>
        </div>
        <div class="kpi-card">
            <div class="value" style="color: #0c5460;">${inTransit}</div>
            <div class="label">In Transit</div>
        </div>
        <div class="kpi-card">
            <div class="value" style="color: #856404;">${notRTS}</div>
            <div class="label">Not Ready to Ship</div>
        </div>
    </div>
</div>

<div class="two-col">
    <div class="section">
        <h2>Top Suppliers</h2>
        <table>
            <thead><tr><th>Supplier</th><th>Line Items</th></tr></thead>
            <tbody>
                ${topSuppliers.map(([name, count]) => `<tr><td>${name}</td><td>${count}</td></tr>`).join('')}
            </tbody>
        </table>
    </div>
    <div class="section">
        <h2>Upcoming Milestones</h2>
        <table>
            <thead><tr><th>Milestone</th><th>Date</th></tr></thead>
            <tbody>
                ${(schedule || []).map(m => {
                    const d = new Date(m.finish_date);
                    return `<tr><td>${m.activity_name || 'N/A'}</td><td>${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>`;
                }).join('')}
            </tbody>
        </table>
    </div>
</div>

<div class="section">
    <h2>Recent Shipments</h2>
    <table>
        <thead><tr><th>Shipment #</th><th>PO</th><th>Description</th><th>Status</th><th>Supplier</th><th>Delivery Date</th></tr></thead>
        <tbody>
            ${recentShipments.map(s => {
                let badgeClass = 'badge-secondary';
                if (s.status === 'Delivered') badgeClass = 'badge-success';
                else if (s.status === 'In Transit') badgeClass = 'badge-info';
                else if (s.status === 'Not RTS') badgeClass = 'badge-warning';
                return `<tr>
                    <td>${s.shipment_number || 'N/A'}</td>
                    <td>${s.po_number || 'N/A'}</td>
                    <td>${s.part_description || 'N/A'}</td>
                    <td><span class="badge ${badgeClass}">${s.status || 'N/A'}</span></td>
                    <td>${s.supplier || 'N/A'}</td>
                    <td>${s.delivery_date || 'N/A'}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>
</div>

<div class="footer">
    <span>Confidential — ${BRANDING?.clientName || 'InvenioTek'}</span>
    <span>Generated from Invenio Field MSR on ${reportDate}</span>
</div>

</body></html>`;

        // Open in new window for print
        const printWindow = window.open('', '_blank');
        printWindow.document.write(html);
        printWindow.document.close();

        // Auto-trigger print after content loads
        printWindow.onload = () => {
            printWindow.print();
        };

    } catch (error) {
        console.error('PDF generation failed:', error);
        alert('Failed to generate report: ' + error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-file-pdf me-1"></i>Export PDF';
        }
    }
}

window.generateMSRReport = generateMSRReport;

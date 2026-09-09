/**
 * PDF Report Generator
 * Generates a professional Material Status Report PDF from dashboard data
 * Uses a new window with print-optimized layout
 */

async function generateMSRReport() {
    const btn = document.getElementById('export-pdf-btn');
    if (btn?.disabled) return;
    const originalButton = btn?.innerHTML;
    let printWindow;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating…';
    }
    try {
        // Reserve the window during the click gesture, before any asynchronous work.
        printWindow = window.open('', '_blank');
        if (!printWindow) throw new Error('Allow pop-ups for this site, then choose Export PDF again.');
        printWindow.opener = null;
        printWindow.document.write('<!doctype html><title>Preparing report</title><p>Preparing report…</p>');
        if (window.InvenioAuthReady && !(await window.InvenioAuthReady)) { printWindow.close(); return; }
        const [pos, shipments, scheduleResponse] = await Promise.all([
            InvenioDataHealth.loadAllRows(projectSupabaseClient, 'purchase_orders'),
            InvenioDataHealth.loadAllRows(projectSupabaseClient, 'shipments'),
            projectSupabaseClient.from('project_schedule').select('*').eq('is_milestone', true)
                .gte('finish_date', InvenioWorkSummary.localDate()).order('finish_date', { ascending: true }).order('id').limit(10),
        ]);
        if (scheduleResponse.error) throw scheduleResponse.error;
        const schedule = scheduleResponse.data || [];
        const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
        const branding = typeof BRANDING === 'undefined' ? {} : BRANDING;
        const projectName = escape(InvenioProjectScope.activeProject.name);
        const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
        const brandColor = safeColor(branding.colors?.primary, '#2563EB');
        const accentColor = safeColor(branding.colors?.accent, '#B0A07A');
        const clientName = escape(branding.clientName || 'InvenioTek');
        const { procurement } = InvenioDataHealth.procurementSummary(pos, shipments);

        // Shipment stats
        const totalShipments = shipments?.length || 0;
        const delivered = procurement.delivered_shipments;
        const inTransit = shipments?.filter(s => String(s.status || '').trim().toLowerCase() === 'in transit').length || 0;
        const notRTS = shipments?.filter(s => ['not rts', 'not ready', 'not ready to ship'].includes(String(s.status || '').trim().toLowerCase())).length || 0;

        // PO stats
        const uniquePOs = procurement.total_pos;
        const totalValue = procurement.total_po_value;

        // Top suppliers
        const supplierCounts = new Map();
        (pos || []).forEach(p => {
            if (p.supplier) supplierCounts.set(p.supplier, (supplierCounts.get(p.supplier) || 0) + 1);
        });
        const topSuppliers = [...supplierCounts]
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
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
    .kpi-card { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; text-align: center; }
    .kpi-card .value { overflow-wrap: anywhere; font-size: 20px; font-weight: 700; color: ${brandColor}; }
    .kpi-card .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #f5f5f5; text-align: left; padding: 6px 8px; font-weight: 600; border-bottom: 2px solid #ddd; }
    td { overflow-wrap: anywhere; padding: 5px 8px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) { background: #fafafa; }
    .badge { padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 600; display: inline-block; }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-info { background: #d1ecf1; color: #0c5460; }
    .badge-secondary { background: #e2e3e5; color: #383d41; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 9px; color: #999; display: flex; justify-content: space-between; }
    .accent-bar { width: 4px; background: ${accentColor}; border-radius: 2px; }
    @media print { .print-controls { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head><body>

<div class="print-controls" style="margin-bottom:20px"><button onclick="window.print()">Print / Save PDF</button></div>
<div class="header">
    <div>
        <h1>${projectName}</h1>
        <div class="subtitle">Material Status Report</div>
    </div>
    <div class="date">
        <strong>Report Generated</strong><br>${reportDate}
        <br><span style="color:${accentColor};">Prepared by ${clientName}</span>
    </div>
</div>

<div class="kpi-grid">
    <div class="kpi-card">
        <div class="value">${uniquePOs}</div>
        <div class="label">Purchase Orders</div>
    </div>
    <div class="kpi-card">
        <div class="value">${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalValue)}</div>
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
                ${topSuppliers.map(([name, count]) => `<tr><td>${escape(name)}</td><td>${count}</td></tr>`).join('')}
            </tbody>
        </table>
    </div>
    <div class="section">
        <h2>Upcoming Milestones</h2>
        <table>
            <thead><tr><th>Milestone</th><th>Date</th></tr></thead>
            <tbody>
                ${(schedule || []).map(m => {
                    const d = new Date(`${m.finish_date}T12:00:00`);
                    return `<tr><td>${escape(m.activity_name || 'N/A')}</td><td>${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>`;
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
                    <td>${escape(s.shipment_number || 'N/A')}</td>
                    <td>${escape(s.po_number || 'N/A')}</td>
                    <td>${escape(s.part_description || 'N/A')}</td>
                    <td><span class="badge ${badgeClass}">${escape(s.status || 'N/A')}</span></td>
                    <td>${escape(s.supplier || 'N/A')}</td>
                    <td>${escape(s.delivery_date || 'N/A')}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>
</div>

<div class="footer">
    <span>Confidential — ${clientName}</span>
    <span>Generated from Invenio Field MSR on ${reportDate}</span>
</div>

</body></html>`;

        if (printWindow.closed) return;
        printWindow.document.open();
        printWindow.onload = () => { if (!printWindow.closed) printWindow.print(); };
        printWindow.document.write(html);
        printWindow.document.close();

    } catch (error) {
        if (printWindow && !printWindow.closed) printWindow.close();
        console.error('PDF generation failed:', error);
        alert('Failed to generate report: ' + error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalButton;
        }
    }
}

window.generateMSRReport = generateMSRReport;

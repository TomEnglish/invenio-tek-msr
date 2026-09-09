const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const projectId = 'assigned-yard';

function exporter(options = {}) {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const caller = index.match(/<button\b([^>]*\bonclick="generateMSRReport\([^)]*\)"[^>]*)>([\s\S]*?)<\/button>/);
  assert.ok(caller, 'dashboard exposes the shared PDF export action');
  const buttonId = caller[1].match(/\bid="([^"]+)"/)?.[1];
  const button = { disabled: false, innerHTML: caller[2] };
  const alerts = [];
  const queries = [];
  let html = '';
  const popup = {
    document: { open() { html = ''; }, write(value) { html += value; }, close() {} },
    print() {}, focus() {}, close() { this.closed = true; }, closed: false,
  };
  const defaults = {
    dashboard_metrics: [{ id: 1, project_name: 'Obsolete metrics project', procurement: { total_pos: 999 }, last_updated: '2026-09-01T00:00:00Z' }],
    purchase_orders: [{ id: 1, purchase_order_id: 'PO-1', supplier: 'Valve Supplier', net_value: 5000 }],
    shipments: [{ id: 1, shipment_number: 'SHIP-1', po_number: 'PO-1', supplier: 'Valve Supplier', part_description: 'Isolation valve', status: 'Delivered', delivery_date: '2026-09-09' }],
    project_schedule: [{ id: 1, is_milestone: true, activity_name: 'Commissioning', finish_date: '2099-01-01' }],
  };
  const tables = Object.fromEntries(Object.entries({ ...defaults, ...options.tables })
    .map(([name, rows]) => [name, rows.map(row => ({ project_id: projectId, ...row }))]));
  const client = {
    from(table) {
      const filters = [];
      const orders = [];
      let start = 0;
      let end = 999;
      let singular = false;
      return {
        select() { return this; },
        eq(column, value) { filters.push(row => row[column] === value); return this; },
        gte(column, value) { filters.push(row => row[column] >= value); return this; },
        lte(column, value) { filters.push(row => row[column] <= value); return this; },
        order(column, settings = {}) { orders.push({ column, ascending: settings.ascending !== false }); return this; },
        limit(size) { end = start + size - 1; return this; },
        range(first, last) { start = first; end = last; return this; },
        single() { singular = true; return this; },
        maybeSingle() { singular = true; return this; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            queries.push({ table, start, buttonDisabled: button.disabled });
            if (options.fail?.(table, start)) return { data: null, error: { message: 'Database temporarily unavailable' } };
            let rows = (tables[table] || []).filter(row => filters.every(predicate => predicate(row)));
            rows = [...rows].sort((a, b) => {
              for (const { column, ascending } of orders) {
                const comparison = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
                if (comparison) return ascending ? comparison : -comparison;
              }
              return 0;
            });
            // Reproduce the hosted API's default maximum of 1,000 rows per request.
            const page = rows.slice(start, Math.min(end + 1, start + 1000));
            return { data: singular ? page[0] || null : page, error: null };
          }).then(resolve, reject);
        },
      };
    },
  };
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    Date: options.now ? class extends Date {
      constructor(...args) { super(...(args.length ? args : [options.now.getTime()])); }
      static now() { return options.now.getTime(); }
    } : Date,
    InvenioAuthReady: Promise.resolve(true),
    BRANDING: { projectName: 'Legacy branding project', clientName: 'Invenio' },
    supabaseClient: client,
    document: {
      getElementById(id) { return id === buttonId ? button : null; },
      querySelector(selector) { return selector.includes('generateMSRReport') ? button : null; },
    },
    alert(message) { alerts.push(message); },
    open() { return options.popupBlocked ? null : popup; },
  });
  context.window = context;
  for (const file of ['js/utils/formatting.js', 'js/utils/project-scope.js', 'js/utils/data-health.js', 'js/utils/work-summary.js', 'js/utils/pdf-export.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  context.InvenioProjectScope.availableProjects = [
    { id: 'other-yard', name: 'Other Yard' },
    { id: projectId, name: options.projectName || 'South Yard' },
  ];
  context.InvenioProjectScope.setActiveProjectId(projectId);
  return { run: () => context.generateMSRReport(), button, alerts, queries, get html() { return html; } };
}

function kpi(html, label) {
  const match = html.match(new RegExp('class="value"[^>]*>\\s*([^<]+)</div>\\s*<div class="label">' + label + '</div>'));
  assert.ok(match, `Report contains ${label} KPI`);
  return match[1].trim().replaceAll(',', '');
}

function manyRows() {
  return {
    purchase_orders: Array.from({ length: 1501 }, (_, index) => ({ id: index + 1, purchase_order_id: `PO-${index + 1}`, supplier: 'Bulk Supplier', net_value: 1000 })),
    shipments: Array.from({ length: 1201 }, (_, index) => ({
      id: index + 1, shipment_number: `SHIP-${index + 1}`, status: 'Delivered',
      part_description: index === 1200 ? 'Newest shipment beyond page one' : 'Earlier shipment',
      delivery_date: index === 1200 ? '2026-09-09' : '2026-09-01',
    })),
  };
}

test('PDF title and heading use the selected project instead of branding or imported metrics', async () => {
  const app = exporter();
  await app.run();
  assert.equal(app.alerts.length, 0);
  assert.ok(app.html.includes('<title>MSR Report - South Yard</title>'), 'PDF title names the selected project');
  assert.ok(app.html.includes('<h1>South Yard</h1>'), 'PDF heading names the selected project');
});

test('PDF totals and recent shipments include records beyond the first 1,000 API rows', async () => {
  const app = exporter({ tables: manyRows() });
  await app.run();
  assert.equal(app.alerts.length, 0);
  assert.equal(kpi(app.html, 'Purchase Orders'), '1501');
  assert.equal(kpi(app.html, 'Total PO Value'), '$1501000.00');
  assert.equal(kpi(app.html, 'Shipments'), '1201');
  assert.equal(kpi(app.html, 'Delivered'), '1201');
  assert.ok(app.html.includes('Newest shipment beyond page one'), 'Newest shipment is included even when returned on a later page');
});

test('PDF uses the local calendar cutoff for milestones and normalizes shipment status totals', async () => {
  const app = exporter({
    now: new Date(2026, 8, 9, 0, 1),
    tables: {
      project_schedule: [
        { id: 1, is_milestone: true, activity_name: 'Previous-day milestone', finish_date: '2026-09-08' },
        { id: 2, is_milestone: true, activity_name: 'Today milestone', finish_date: '2026-09-09' },
      ],
      shipments: [
        { id: 1, shipment_number: 'S1', status: ' delivered ' },
        { id: 2, shipment_number: 'S2', status: 'DELIVERED' },
        { id: 3, shipment_number: 'S3', status: ' in transit ' },
      ],
    },
  });
  await app.run();
  assert.equal(app.alerts.length, 0);
  assert.ok(!app.html.includes('Previous-day milestone'), 'Yesterday is excluded from upcoming milestones');
  assert.ok(app.html.includes('Today milestone'), 'Today remains included just after local midnight');
  assert.ok(app.html.includes('Sep 9, 2026'), 'A date-only milestone displays on its actual calendar day');
  assert.equal(kpi(app.html, 'Delivered'), '2');
  assert.equal(kpi(app.html, 'In Transit'), '1');
});

test('PDF counts both imported Not Ready and legacy Not RTS shipments as not ready to ship', async () => {
  const app = exporter({ tables: { shipments: [
    { id: 1, shipment_number: 'S1', status: ' Not Ready ' },
    { id: 2, shipment_number: 'S2', status: 'not rts' },
    { id: 3, shipment_number: 'S3', status: 'Delivered' },
  ] } });
  await app.run();
  assert.equal(app.alerts.length, 0);
  assert.equal(kpi(app.html, 'Not Ready to Ship'), '2');
});

for (const table of ['purchase_orders', 'shipments', 'project_schedule']) {
  test(`PDF export reports a ${table} query error instead of producing a plausible partial report`, async () => {
    const app = exporter({ fail: name => name === table });
    await app.run();
    assert.ok(app.alerts.some(message => /failed|unable|could not/i.test(message)), 'User receives an explicit export failure');
    assert.ok(!app.html.includes('class="kpi-card"'), 'No complete-looking report is written after a required query fails');
    assert.equal(app.button.disabled, false);
  });
}

test('PDF export fails explicitly if a later data page cannot be loaded', async () => {
  const app = exporter({ tables: manyRows(), fail: (table, start) => table === 'purchase_orders' && start >= 1000 });
  await app.run();
  assert.ok(app.alerts.length > 0, 'A later-page error is reported to the user');
  assert.ok(!app.html.includes('class="kpi-card"'), 'Previously loaded pages are not presented as a complete report');
  assert.equal(app.button.disabled, false);
});

const untrusted = {
  project: '<img src="project-source" onerror="alert(1)">',
  supplier: '<img src="supplier-source" onerror="alert(2)">',
  description: '<svg data-source="description-source" onload="alert(3)"></svg>',
};
for (const field of ['project', 'supplier', 'description']) {
  test(`PDF treats untrusted ${field} content as text`, async () => {
    const app = exporter({
      projectName: untrusted.project,
      tables: {
        purchase_orders: [{ id: 1, purchase_order_id: 'PO-1', supplier: untrusted.supplier, net_value: 1 }],
        shipments: [{ id: 1, shipment_number: 'SHIP-1', supplier: untrusted.supplier, part_description: untrusted.description, delivery_date: '2026-09-09' }],
      },
    });
    await app.run();
    assert.equal(app.alerts.length, 0);
    const element = field === 'description' ? 'svg' : 'img';
    assert.ok(!new RegExp(`<${element}[^>]*${field}-source`).test(app.html), 'Untrusted value cannot create a report HTML element');
    assert.ok(new RegExp(`&lt;${element}[^<]*${field}-source`).test(app.html), 'Escaped source text remains visible in the report');
  });
}

test('blocked print popup gives an actionable message and restores the export action', async () => {
  const app = exporter({ popupBlocked: true });
  await app.run();
  assert.ok(app.alerts.some(message => /pop[ -]?up|allow.*window/i.test(message)), 'User is told to allow the print popup');
  assert.equal(app.button.disabled, false);
  assert.ok(/Export PDF/.test(app.button.innerHTML), 'Export action is restored after the failure');
});

test('the actual dashboard export button is disabled while generating and restored afterward', async () => {
  const app = exporter();
  await app.run();
  assert.equal(app.alerts.length, 0);
  assert.ok(app.queries.length > 0 && app.queries.every(query => query.buttonDisabled), 'Dashboard button prevents duplicate generation while queries run');
  assert.equal(app.button.disabled, false);
  assert.ok(/Export PDF/.test(app.button.innerHTML));
});

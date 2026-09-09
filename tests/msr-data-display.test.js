const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const quietConsole = { log() {}, error() {} };

function loadScripts(context, files) {
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
}

async function loadMaterials(rows) {
  const nodes = new Map();
  function node() {
    let markup = '';
    let cards = [];
    return {
      textContent: '',
      get innerHTML() { return markup; },
      set innerHTML(value) {
        markup = value;
        cards = [...value.matchAll(/class="selection-item" data-index="(\d+)"/g)].map(match => {
          const listeners = {};
          const classes = new Set(['selection-item']);
          return {
            dataset: { index: match[1] },
            classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
            addEventListener(event, callback) { listeners[event] = callback; },
            click() { assert.ok(listeners.click, 'rendered card has a click handler'); listeners.click(); },
          };
        });
      },
      querySelectorAll: selector => selector === '.selection-item' ? cards : [],
    };
  }
  const context = vm.createContext({
    console: quietConsole,
    InvenioAuthReady: Promise.resolve(true),
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, node());
        return nodes.get(id);
      },
      querySelectorAll(selector) {
        const match = selector.match(/^#(poList|installList) \.selection-item$/);
        return match ? nodes.get(match[1])?.querySelectorAll('.selection-item') || [] : [];
      },
    },
    projectSupabaseClient: {
      from(table) {
        const response = { data: table === 'purchase_orders' ? rows : [], error: null };
        return {
          select() { return this; },
          order() { return this; },
          then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
        };
      },
    },
    showError(message) { assert.fail(message); },
  });
  context.window = context;
  loadScripts(context, ['js/utils/formatting.js', 'material-tracking-supabase.js']);
  await context.loadPOItems();
  return { html: nodes.get('poList').innerHTML, count: nodes.get('poCount').textContent, context, nodes };
}

test('material cards display the imported purchase-order line number', async () => {
  const view = await loadMaterials([{
    purchase_order_id: 'PO-20001',
    purchase_order_item: '00020',
    item_description: 'Six-inch isolation valve',
    po_description: 'Mechanical package',
  }]);
  assert.equal(view.count, '1 items');
  assert.match(view.html, /PO-20001 - Line 00020/);
  assert.doesNotMatch(view.html, /Line N\/A/);
});

test('material cards prefer the imported item description over the overall PO description', async () => {
  const view = await loadMaterials([{
    purchase_order_id: 'PO-20001',
    purchase_order_item: '00020',
    item_description: 'Six-inch isolation valve',
    po_description: 'Mechanical package',
  }]);
  assert.match(view.html, /Six-inch isolation valve/);
  assert.doesNotMatch(view.html, /Mechanical package|No description/);
});

test('imported material descriptions are displayed as text, not executable HTML', async () => {
  const view = await loadMaterials([{ purchase_order_id: 'PO-1', purchase_order_item: '10', item_description: '<img src=x onerror=alert(1)>' }]);
  assert.match(view.html, /&lt;img/);
  assert.doesNotMatch(view.html, /<img/);
});

test('material cards fall back to the PO description when the imported item description is absent', async () => {
  const view = await loadMaterials([{
    purchase_order_id: 'PO-20002',
    purchase_order_item: '00010',
    item_description: null,
    po_description: 'Cable tray supports',
  }, {
    purchase_order_id: 'PO-20003',
    purchase_order_item: '00030',
    item_description: '',
    po_description: 'Instrument mounting brackets',
  }]);
  assert.match(view.html, /Cable tray supports/);
  assert.match(view.html, /Instrument mounting brackets/);
  assert.doesNotMatch(view.html, /No description/);
});

test('clicking a filtered PO card selects that visible row rather than the first unfiltered PO', async () => {
  const view = await loadMaterials([
    { purchase_order_id: 'PO-20001', purchase_order_item: '00010', item_description: 'Mounting bolts' },
    { purchase_order_id: 'PO-20002', purchase_order_item: '00020', item_description: 'Six-inch isolation valve' },
  ]);
  view.context.handlePOSearch({ target: { value: 'isolation valve' } });
  const visibleCards = view.nodes.get('poList').querySelectorAll('.selection-item');
  assert.equal(visibleCards.length, 1);
  visibleCards[0].click();
  assert.equal(vm.runInContext('state.selectedPO.po_id', view.context), 'PO-20002');
  assert.equal(vm.runInContext('state.selectedPO.line_item', view.context), '00020');
  assert.equal(view.nodes.get('selectedPO').textContent, 'PO-20002 - Six-inch isolation valve');
});

test('clicking a filtered installation card selects that visible row rather than the first unfiltered item', async () => {
  const view = await loadMaterials([]);
  view.context.installRows = [
    { tag: 'CIV-001', description: 'Concrete foundation', discipline: 'Civil' },
    { tag: 'ELEC-002', description: 'Cable tray supports', discipline: 'Electrical' },
  ];
  vm.runInContext('state.installItems = installRows; renderInstallItems(state.installItems);', view.context);
  view.context.handleInstallSearch({ target: { value: 'Cable tray' } });
  const visibleCards = view.nodes.get('installList').querySelectorAll('.selection-item');
  assert.equal(visibleCards.length, 1);
  visibleCards[0].click();
  assert.equal(vm.runInContext('state.selectedInstall.tag', view.context), 'ELEC-002');
  assert.equal(view.nodes.get('selectedInstall').textContent, 'ELEC-002 - Cable tray supports');
});

test('dashboard heading uses the selected assigned project after the auth guard resolves', async () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const headingMatch = html.match(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/i);
  assert.ok(headingMatch, 'dashboard has a project heading');
  const headingIds = [...headingMatch[0].matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const heading = { textContent: headingMatch[2].replace(/<[^>]*>/g, ''), innerHTML: headingMatch[2] };
  const nodes = new Map(headingIds.map(id => [id, heading]));
  let start;
  let resolveAccess;
  const context = vm.createContext({
    console: quietConsole,
    isSupabaseConfigured: () => true,
    InvenioAuthReady: new Promise(resolve => { resolveAccess = resolve; }),
    document: {
      addEventListener(event, callback) { if (event === 'DOMContentLoaded') start = callback; },
      createElement: () => ({}),
      head: { appendChild() {} },
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { textContent: '' });
        return nodes.get(id);
      },
      querySelector(selector) {
        if (selector === 'h1' || selector === '.hero-banner h1') return heading;
        if (selector.startsWith('#')) return nodes.get(selector.slice(1)) || null;
        return null;
      },
    },
    supabaseClient: {
      channel() {
        return {
          on() { return this; },
          subscribe(callback) { callback('SUBSCRIBED'); },
        };
      },
    },
  });
  context.window = context;
  loadScripts(context, ['js/utils/project-scope.js', 'dashboard.js']);
  // Isolate the startup heading from the independently loaded charts and tables.
  context.loadAllData = () => {};
  const startup = start();
  assert.notEqual(heading.textContent, 'South Yard');
  context.InvenioProjectScope.availableProjects = [
    { id: 'main-yard', name: 'Main Yard', status: 'active' },
    { id: 'south-yard', name: 'South Yard', status: 'active' },
  ];
  context.InvenioProjectScope.setActiveProjectId('south-yard');
  resolveAccess(true);
  await startup;
  assert.equal(heading.textContent, 'South Yard');
});

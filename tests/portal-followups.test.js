const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('audit page initializes theme before paint', () => {
  const audit = fs.readFileSync('audit.html', 'utf8');
  assert.match(audit, /invenio-theme/);
  assert.match(audit, /Activity &amp; Audit - Invenio Field MSR/);
});

test('sidebar reapplies saved theme when the shell mounts', () => {
  const sidebar = fs.readFileSync('js/utils/sidebar.js', 'utf8');
  assert.match(sidebar, /getInitialTheme\(\)/);
  assert.match(sidebar, /applyTheme\(savedTheme\)/);
});

test('gps tracking uses clustered markers and an inline filter toolbar', () => {
  const page = fs.readFileSync('samsara-tracking.html', 'utf8');
  const script = fs.readFileSync('samsara-tracking.js', 'utf8');
  assert.match(page, /gps-filter-toolbar/);
  assert.match(page, /leaflet\.markercluster/);
  assert.match(script, /markerClusterGroup/);
  assert.doesNotMatch(script, /permanent:\s*true/);
});

test('dashboard export controls keep a stable width', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(css, /#realtime-indicator/);
  assert.match(css, /#export-pdf-btn/);
});

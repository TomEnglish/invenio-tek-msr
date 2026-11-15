const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The build is always for one environment; any production in the list will do here.
const environment = execFileSync(process.execPath, ['scripts/environments.mjs', 'list', '--kind', 'production'], { encoding: 'utf8' }).split('\n')[0];
execFileSync(process.execPath, ['scripts/build-site.mjs'], { stdio: 'pipe', env: { ...process.env, APP_ENV: environment } });

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(filePath) : [filePath];
  });
}

const published = listFiles('dist').map((filePath) => path.relative('dist', filePath));
for (const required of [
  'index.html',
  'login.html',
  'material-tracking.html',
  'project-schedule.html',
  'dashboard.js',
  'material-tracking-supabase.js',
  'project-schedule.js',
  path.join('js', 'utils', 'project-scope.js'),
  path.join('brand', 'invenio-mark.svg'),
]) {
  assert.ok(published.includes(required), `missing browser asset: ${required}`);
}

for (const privateDirectory of ['archive', 'dashboard_data', 'docs', 'scripts', 'supabase', 'tests']) {
  assert.equal(fs.existsSync(path.join('dist', privateDirectory)), false, `published private directory: ${privateDirectory}`);
}

const forbiddenExtensions = new Set(['.sql', '.xlsx', '.xls', '.py', '.ts']);
assert.deepEqual(published.filter((filePath) => forbiddenExtensions.has(path.extname(filePath))), []);
assert.deepEqual(published.filter((filePath) => path.extname(filePath) === '.json'), ['manifest.json', 'release.json']);
// The pages' connection file is generated for this environment, never copied from the source tree.
assert.ok(published.includes('supabase-config.js'));
assert.match(fs.readFileSync('dist/supabase-config.js', 'utf8'), new RegExp(`^// Generated for the "${environment}" environment`));

const indexPage = fs.readFileSync('dist/index.html', 'utf8');
const materialTrackingPage = fs.readFileSync('dist/material-tracking.html', 'utf8');
const projectSchedulePage = fs.readFileSync('dist/project-schedule.html', 'utf8');
assert.match(indexPage, /project-scope\.js\?v=20260909a/);
assert.match(indexPage, /dashboard\.js\?v=20261031activity/);
assert.match(indexPage, /data-health\.js\?v=20260909d/);
assert.match(materialTrackingPage, /material-tracking-supabase\.js\?v=20261101adminlinks/);
assert.match(projectSchedulePage, /project-schedule\.js\?v=20260909a/);

console.log('MSR publication boundary tests passed');

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const root = join(__dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');

// A table reports live changes only if migration 028 put it in the publication.
// A page that starts listening to a new table needs a new migration that adds it.
test('every table a page listens to for live changes is one the database reports', () => {
    const reported = new Set([...read('supabase/migrations/028_live_updates.sql').match(/ARRAY\[([^\]]+)\]/)[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]));
    assert.equal(reported.size, 13);
    const dashboard = read('dashboard.js');
    const watched = dashboard.slice(dashboard.indexOf('const watchTables = ['), dashboard.indexOf('watchTables.forEach'));
    const listened = new Set([...watched.matchAll(/'([a-z_]+)'/g)].map(match => match[1]));
    for (const file of ['samsara-tracking.js', 'material-tracking-supabase.js']) {
        for (const match of read(file).matchAll(/projectChangeOptions\('([a-z_]+)'/g)) listened.add(match[1]);
    }
    assert.ok(listened.size >= 13);
    assert.deepEqual([...listened].filter(table => !reported.has(table)), [], 'listened to but never reported');
    assert.deepEqual([...reported].filter(table => !listened.has(table)), [], 'reported but nothing listens');
});

test('no other page listens for live changes without being covered here', () => {
    const {execFileSync} = require('node:child_process');
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.js', '*.html'], {cwd: root, encoding: 'utf8'})
        .split('\n').filter(file => file && !/^(tests|archive|dist)\//.test(file));
    const listeners = files.filter(file => /postgres_changes/.test(read(file)));
    assert.deepEqual(listeners.sort(), ['dashboard.js', 'material-tracking-supabase.js', 'samsara-tracking.js']);
});

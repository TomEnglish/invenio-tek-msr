const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const {readFileSync, writeFileSync, mkdtempSync, rmSync} = require('node:fs');
const {join, resolve} = require('node:path');
const {tmpdir} = require('node:os');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const ready = import('../scripts/environments.mjs');
// A browser (anon) key for the given database reference; nothing is signed or checked against a server.
const key = (ref, role = 'anon') => `x.${Buffer.from(JSON.stringify({ref, role})).toString('base64url')}.y`;
const entry = (name, overrides = {}) => ({
    kind: 'production', label: name, siteUrl: `https://${name}.example.test`, databaseUrl: `https://${name}db.supabase.co`,
    publicKey: key(`${name}db`), defaultProjectId: '00000000-0000-0000-0000-000000000000', ...overrides,
});
const registry = (environments, extra = {}) => ({environments, ...extra});

test('environments.json is valid and every environment has its own site and its own database', async () => {
    const {loadEnvironments, listEnvironments} = await ready;
    const environments = listEnvironments(loadEnvironments());
    assert.ok(environments.some(environment => environment.kind === 'production'));
    for (const field of ['siteUrl', 'databaseUrl']) {
        assert.equal(new Set(environments.map(environment => environment[field])).size, environments.length, `${field} is shared`);
    }
});

test('an environment may not share a site or database, list a server key, or pair a key with another database', async () => {
    const {validateEnvironments} = await ready;
    const refuses = (environments, pattern, extra) => assert.throws(() => validateEnvironments(registry(environments, extra)), pattern);
    assert.ok(validateEnvironments(registry({acme: entry('acme'), dev: entry('dev', {kind: 'dev'})}, {previews: 'dev'})));
    refuses({}, /at least one environment/);
    refuses({acme: entry('acme'), other: entry('other', {databaseUrl: 'https://acmedb.supabase.co', publicKey: key('acmedb')})}, /databaseUrl is already used by "acme"/);
    refuses({acme: entry('acme'), other: entry('other', {siteUrl: 'https://acme.example.test'})}, /siteUrl is already used by "acme"/);
    refuses({acme: entry('acme', {publicKey: key('acmedb', 'service_role')})}, /only the browser \(anon\) key/);
    refuses({acme: entry('acme', {publicKey: 'sb_secret_0123456789abcdefghij'})}, /server key/);
    refuses({acme: entry('acme', {publicKey: key('demodb')})}, /belongs to a different database/);
    refuses({acme: entry('acme', {siteUrl: 'http://acme.example.test'})}, /siteUrl must be an https address/);
    refuses({acme: entry('acme', {siteUrl: 'https://acme.example.test/'})}, /siteUrl must be an https address/);
    refuses({acme: entry('acme', {databaseUrl: 'https://acmedb.supabase.co/rest'})}, /databaseUrl must be an https address/);
    refuses({acme: entry('acme', {kind: 'staging'})}, /kind must be one of/);
    refuses({acme: entry('acme', {serviceKey: 'x'})}, /unknown field "serviceKey"/);
    refuses({Acme: entry('acme')}, /name must be lowercase/);
    // One database written two ways is still one database.
    refuses({acme: entry('acme'), other: entry('other', {databaseUrl: 'https://acmedb.supabase.co.', publicKey: key('acmedb')})}, /databaseUrl must be an https address/);
    refuses({acme: entry('acme', {siteUrl: 'https://ACME.example.test'})}, /siteUrl must be an https address/);
    refuses({acme: entry('acme', {siteUrl: 'https://acme.example.test:443'})}, /siteUrl must be an https address/);
    // ...and so is one project under another domain, or this computer under its other name.
    refuses({acme: entry('acme'), other: entry('other', {databaseUrl: 'https://acmedb.supabase.in', publicKey: key('acmedb').replace('.y', '.z')})}, /databaseUrl is already used by "acme"/);
    const local = (name, overrides) => entry(name, {kind: 'dev', siteUrl: `http://localhost:${name === 'one' ? 8092 : 8093}`, databaseUrl: 'http://127.0.0.1:54321', publicKey: key(undefined).replace('.y', `.${name}`), ...overrides});
    refuses({one: local('one'), two: local('two', {databaseUrl: 'http://localhost:54321'})}, /databaseUrl is already used by "one"/);
    refuses({one: local('one'), two: local('two', {databaseUrl: 'http://127.0.0.1:54399', siteUrl: 'https://localhost:8092'})}, /siteUrl is already used by "one"/);
    refuses({one: local('one'), two: local('two', {databaseUrl: 'http://127.0.0.1:54399', siteUrl: 'http://127.0.0.1:8092'})}, /siteUrl is already used by "one"/);
    assert.ok(validateEnvironments(registry({one: local('one'), two: local('two', {databaseUrl: 'http://127.0.0.1:54399'})})));
    // A key opens one database, so no two environments may list the same one, whatever kind it is.
    refuses({acme: entry('acme', {publicKey: 'sb_publishable_0123456789abcdefghij'}), other: entry('other', {publicKey: 'sb_publishable_0123456789abcdefghij'})}, /publicKey is already used by "acme"/);
    refuses({acme: entry('acme'), other: entry('other', {publicKey: key('acmedb')})}, /belongs to a different database[\s\S]*already used by "acme"/);
    // A hosted database's legacy key must name its database; only a stack on this computer has keys that name none.
    refuses({acme: entry('acme', {publicKey: key(undefined)})}, /does not name its database/);
    assert.ok(validateEnvironments(registry({local: entry('local', {kind: 'dev', siteUrl: 'http://localhost:8092', databaseUrl: 'http://127.0.0.1:54321', publicKey: key(undefined)})})));
    assert.ok(validateEnvironments(registry({acme: entry('acme', {publicKey: 'sb_publishable_0123456789abcdefghij'})})));
    refuses({acme: entry('acme', {publicKey: 'short'})}, /not a recognized browser key/);
    refuses({acme: entry('acme', {publicKey: undefined})}, /not a recognized browser key/);
    refuses({acme: entry('acme'), dev: entry('dev', {kind: 'dev'})}, /previews must name a dev environment/, {previews: 'constructor'});
    refuses({acme: entry('acme', {defaultProjectId: 'main'})}, /defaultProjectId/);
    refuses({acme: entry('acme')}, /previews must name a dev environment/, {previews: 'acme'});
    // Every problem is reported at once.
    assert.throws(() => validateEnvironments(registry({acme: entry('acme', {kind: 'x', label: ''})})), error => /kind/.test(error.message) && /label/.test(error.message));
});

test('a build is for the named environment or the site it is publishing to, and never a default', async () => {
    const {validateEnvironments, resolveEnvironment} = await ready;
    const known = validateEnvironments(registry({acme: entry('acme'), dev: entry('dev', {kind: 'dev'})}));
    assert.equal(resolveEnvironment(known, {APP_ENV: 'acme'}).name, 'acme');
    assert.equal(resolveEnvironment(known, {URL: 'https://acme.example.test'}).name, 'acme');
    assert.equal(resolveEnvironment(known, {APP_ENV: 'dev', URL: 'https://dev.example.test'}).name, 'dev');
    // The web host may report the address without https; the host name identifies the site.
    assert.equal(resolveEnvironment(known, {URL: 'http://acme.example.test'}).name, 'acme');
    assert.equal(resolveEnvironment(known, {URL: 'https://acme.example.test/'}).name, 'acme');
    assert.throws(() => resolveEnvironment(known, {URL: 'ftp://acme.example.test'}), /unusable site address/);
    assert.throws(() => resolveEnvironment(known, {URL: 'https://acme.example.test.evil.test'}), /No environment/);
    assert.throws(() => resolveEnvironment(known, {}), /There is no default/);
    assert.throws(() => resolveEnvironment(known, {APP_ENV: 'unknown'}), /Unknown environment/);
    // Names every object has are not environments.
    for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        assert.throws(() => resolveEnvironment(known, {APP_ENV: inherited}), /Unknown environment/, inherited);
    }
    assert.throws(() => resolveEnvironment(known, {URL: 'https://stranger.example.test'}), /No environment/);
    assert.throws(() => resolveEnvironment(known, {URL: 'not an address'}), /unusable site address/);
    // A customer's site can never be published with another environment's connection.
    assert.throws(() => resolveEnvironment(known, {APP_ENV: 'dev', URL: 'https://acme.example.test'}), /Refusing to mix environments/);
});

test('preview builds use the previews environment only when one is set and none is named', async () => {
    const {validateEnvironments, resolveEnvironment} = await ready;
    const environments = {acme: entry('acme'), dev: entry('dev', {kind: 'dev'})};
    const plain = validateEnvironments(registry(environments));
    const withPreviews = validateEnvironments(registry(environments, {previews: 'dev'}));
    const preview = {URL: 'https://acme.example.test', CONTEXT: 'deploy-preview'};
    assert.equal(resolveEnvironment(plain, preview).name, 'acme');
    assert.equal(resolveEnvironment(withPreviews, preview).name, 'dev');
    assert.equal(resolveEnvironment(withPreviews, {...preview, CONTEXT: 'production'}).name, 'acme');
    assert.equal(resolveEnvironment(withPreviews, {...preview, APP_ENV: 'acme'}).name, 'acme');
    assert.throws(() => resolveEnvironment(withPreviews, {URL: 'https://stranger.example.test', CONTEXT: 'deploy-preview'}), /No environment/);
});

test('the generated connection file carries one environment and nothing that can end its script tag', async () => {
    const {validateEnvironments, getEnvironment, renderConfigScript} = await ready;
    const known = validateEnvironments(registry({acme: entry('acme', {label: 'Acme </script><b>'}), dev: entry('dev', {kind: 'dev'})}));
    const script = renderConfigScript(getEnvironment(known, 'acme'));
    assert.doesNotMatch(script, /<\/script>|devdb/);
    const window = {};
    vm.runInNewContext(script, {window});
    assert.deepEqual({...window.SUPABASE_CONFIG, options: undefined}, {
        environment: 'acme', kind: 'production', label: 'Acme </script><b>', siteUrl: 'https://acme.example.test',
        url: 'https://acmedb.supabase.co', anonKey: key('acmedb'), defaultProjectId: '00000000-0000-0000-0000-000000000000', options: undefined,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(window.SUPABASE_CONFIG.options)), {
        auth: {autoRefreshToken: true, persistSession: true, detectSessionInUrl: true}, realtime: {enabled: true},
    });
});

test('the site build writes that environment\'s connection and refuses to build without one', async () => {
    const {loadEnvironments, listEnvironments} = await ready;
    const environments = listEnvironments(loadEnvironments());
    const directory = mkdtempSync(join(tmpdir(), 'site-build-'));
    const out = join(directory, 'site');
    const build = (env, target = out) => spawnSync(process.execPath, ['scripts/build-site.mjs', '--out', target], {cwd: root, encoding: 'utf8', env: {PATH: process.env.PATH, ...env}});
    try {
        for (const environment of environments) {
            const built = build({APP_ENV: environment.name});
            assert.equal(built.status, 0, built.stderr);
            const window = {};
            vm.runInNewContext(readFileSync(join(out, 'supabase-config.js'), 'utf8'), {window});
            assert.equal(window.SUPABASE_CONFIG.url, environment.databaseUrl);
            assert.equal(window.SUPABASE_CONFIG.anonKey, environment.publicKey);
            assert.equal(window.SUPABASE_CONFIG.siteUrl, environment.siteUrl);
            assert.equal(JSON.parse(readFileSync(join(out, 'release.json'), 'utf8')).environment, environment.name);
            // The list of every environment is never published.
            assert.throws(() => readFileSync(join(out, 'environments.json')));
        }
        const before = readFileSync(join(out, 'release.json'), 'utf8');
        const refused = build({});
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /There is no default/);
        assert.equal(readFileSync(join(out, 'release.json'), 'utf8'), before, 'a refused build must leave the last output alone');
        assert.notEqual(build({APP_ENV: environments[0].name, URL: 'https://stranger.example.test'}).status, 0);
        const inherited = build({APP_ENV: 'constructor'});
        assert.notEqual(inherited.status, 0);
        assert.match(inherited.stderr, /Unknown environment "constructor"/);
        assert.equal(readFileSync(join(out, 'release.json'), 'utf8'), before, 'an unknown name must leave the last output alone');
        // --out never replaces a folder that is not an earlier build.
        writeFileSync(join(directory, 'keep.txt'), 'not a build');
        const unsafe = build({APP_ENV: environments[0].name}, directory);
        assert.notEqual(unsafe.status, 0);
        assert.match(unsafe.stderr, /Refusing to build into/);
        assert.equal(readFileSync(join(directory, 'keep.txt'), 'utf8'), 'not a build');
    } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('no environment\'s address is written into code; environments.json is the only place', async () => {
    const {loadEnvironments, listEnvironments} = await ready;
    const hosts = listEnvironments(loadEnvironments()).flatMap(environment => [new URL(environment.siteUrl).host, new URL(environment.databaseUrl).host]);
    const code = /\.(js|mjs|cjs|ts|html|css|py|sh|sql|yml|yaml|toml|json|bat)$/;
    const skip = /^(environments\.json$|docs\/|archive\/|supabase\/archive\/|tests\/|dashboard_data\/)/;
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8'})
        .split('\n').filter(file => code.test(file) && !skip.test(file));
    assert.ok(files.length > 50);
    const offenders = files.filter(file => {
        let source;
        try { source = readFileSync(join(root, file), 'utf8'); } catch { return false; }
        return hosts.some(host => source.includes(host));
    });
    assert.deepEqual(offenders, []);
});

test('the browser client has no fallback connection and stops without its settings', () => {
    const source = readFileSync(join(root, 'js/utils/supabase-client.js'), 'utf8');
    let created = 0;
    const run = config => vm.runInNewContext(source, {window: {SUPABASE_CONFIG: config, supabase: {createClient: (...args) => { created += 1; return {args}; }}}, console});
    assert.throws(() => run(undefined), /no connection settings/);
    assert.throws(() => run({url: 'https://acmedb.supabase.co'}), /no connection settings/);
    assert.throws(() => run({anonKey: 'k'}), /no connection settings/);
    assert.equal(created, 0);
    run({url: 'https://acmedb.supabase.co', anonKey: 'k'});
    assert.equal(created, 1);
});

test('the command line lists environments for workflows and writes a local connection file', async () => {
    const {loadEnvironments, listEnvironments} = await ready;
    const productions = listEnvironments(loadEnvironments(), 'production');
    const cli = (...args) => execFileSync(process.execPath, ['scripts/environments.mjs', ...args], {cwd: root, encoding: 'utf8'});
    assert.deepEqual(cli('list', '--kind', 'production').trim().split('\n'), productions.map(environment => environment.name));
    assert.deepEqual(JSON.parse(cli('matrix', '--kind', 'production')), {
        include: productions.map(({name, siteUrl, databaseUrl}) => ({environment: name, siteUrl, databaseUrl})),
    });
    const directory = mkdtempSync(join(tmpdir(), 'environments-'));
    try {
        cli('config', productions[0].name, '--out', join(directory, 'supabase-config.js'));
        assert.match(readFileSync(join(directory, 'supabase-config.js'), 'utf8'), new RegExp(`"environment": "${productions[0].name}"`));
        const unknown = spawnSync(process.execPath, ['scripts/environments.mjs', 'config', 'nowhere'], {cwd: root, encoding: 'utf8'});
        assert.equal(unknown.status, 1);
        assert.match(unknown.stderr, /Unknown environment "nowhere"/);
    } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('workflows read environments from the list and scope secrets to each one', () => {
    const purge = readFileSync(join(root, '.github/workflows/purge-driver-licences.yml'), 'utf8');
    assert.match(purge, /environments\.mjs matrix --kind production/);
    assert.match(purge, /environment: \$\{\{ matrix\.environment \}\}/);
    assert.match(purge, /SUPABASE_URL: \$\{\{ matrix\.databaseUrl \}\}/);
    assert.match(purge, /fail-fast: false/);
    const quality = readFileSync(join(root, '.github/workflows/quality.yml'), 'utf8');
    assert.match(quality, /smoke-deploy\.mjs --all "\$GITHUB_SHA"/);
    assert.match(quality, /--allow-env=[A-Z_,]*SITE_URL/);
});

test('a server key is checked against the database before it is ever sent there', async () => {
    const {keyProblem} = await ready;
    const server = ref => key(ref, 'service_role');
    assert.equal(keyProblem(server('acmedb'), 'https://acmedb.supabase.co', 'service_role'), null);
    assert.equal(keyProblem(server('demodb'), 'https://acmedb.supabase.co', 'service_role'), 'belongs to a different database');
    assert.equal(keyProblem(key('acmedb'), 'https://acmedb.supabase.co', 'service_role'), 'has the "anon" role, not "service_role"');
    assert.equal(keyProblem(server(undefined), 'https://acmedb.supabase.co', 'service_role'), 'does not name its database');
    assert.equal(keyProblem(server(undefined), 'http://127.0.0.1:54321', 'service_role'), null);
    assert.equal(keyProblem('not a key', 'https://acmedb.supabase.co', 'service_role'), 'is not a recognized key');
    assert.equal(keyProblem('', 'https://acmedb.supabase.co', 'service_role'), 'is not a recognized key');
    // A new-style key names no database, so it cannot be checked by reading it.
    assert.equal(keyProblem('sb_secret_0123456789abcdefghij', 'https://acmedb.supabase.co', 'service_role'), null);
    assert.equal(keyProblem('sb_publishable_0123456789abcdefghij', 'https://acmedb.supabase.co', 'service_role'), 'has the "anon" role, not "service_role"');
});

test('the license job refuses a key that names another environment\'s database, before any request', () => {
    const run = (url, serverKey) => spawnSync(process.execPath, ['scripts/purge-driver-licences.mjs'], {
        cwd: root, encoding: 'utf8', env: {PATH: process.env.PATH, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serverKey},
    });
    // The address does not resolve: reaching the network at all would fail differently.
    const wrong = run('https://acmedb.invalid', key('demodb', 'service_role'));
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /SUPABASE_SERVICE_ROLE_KEY belongs to a different database\. Set this environment's own secret; nothing was sent to acmedb\.invalid/);
    const browser = run('https://acmedb.invalid', key('acmedb'));
    assert.match(browser.stderr, /has the "anon" role/);
    for (const result of [wrong, browser]) assert.doesNotMatch(result.stdout + result.stderr, /eyJ|\.y\b/);
    const purge = readFileSync(join(root, 'scripts/purge-driver-licences.mjs'), 'utf8');
    assert.ok(purge.indexOf('keyProblem(key') < purge.indexOf('purgeDriverLicences({ url, key })'), 'the check comes before the run');
});

test('a page with no app header shows the label in the corner on a dev site only', () => {
    const source = readFileSync(join(root, 'js/utils/supabase-client.js'), 'utf8');
    const open = (config, {hasSidebar = false} = {}) => {
        const added = [];
        const document = {
            readyState: 'complete',
            querySelector: selector => (selector.includes('sidebar.js') && hasSidebar ? {} : null),
            createElement: () => ({}),
            body: {appendChild: element => added.push(element)},
        };
        vm.runInNewContext(source, {window: {SUPABASE_CONFIG: {url: 'https://acmedb.supabase.co', anonKey: 'k', ...config}, supabase: {createClient: () => ({})}}, document, console});
        return added;
    };
    assert.deepEqual(open({kind: 'production', label: 'Acme'}), []);
    assert.deepEqual(open({}), []);
    assert.deepEqual(open({kind: 'dev', label: 'Dev'}, {hasSidebar: true}), [], 'pages with the app header show it there instead');
    const [tag] = open({kind: 'dev', label: 'Dev <b>'});
    assert.equal(tag.textContent, 'Dev <b>');
    assert.equal(tag.className, 'environment-tag environment-tag-corner');
});

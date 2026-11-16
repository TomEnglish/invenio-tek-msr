const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {execFileSync} = require('node:child_process');
const {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} = require('node:fs');
const {join, resolve} = require('node:path');
const {tmpdir} = require('node:os');

const root = resolve(__dirname, '..');
const ready = import('../scripts/release.mjs');
const migrationsReady = import('../scripts/migrations.mjs');
const entry = (name, kind = 'production') => ({
    kind, label: name, siteUrl: `https://${name}.example.test`, databaseUrl: `https://${name}db.supabase.co`,
    publicKey: 'k', defaultProjectId: '00000000-0000-0000-0000-000000000000',
});
const registry = {environments: {demo: entry('demo'), acme: entry('acme'), dev: entry('dev', 'dev')}, previews: 'dev'};
const COMMIT = 'c'.repeat(40);
const STAMP = 'a'.repeat(64);

test('the admin function\'s release stamp is the checksum of its code, and every response carries it', async () => {
    const {readStamp, functionChecksum} = await ready;
    assert.equal(readStamp(), functionChecksum(), 'The admin function changed. Run: node scripts/release.mjs stamp');
    const source = readFileSync(join(root, 'supabase/functions/admin-users/index.ts'), 'utf8');
    assert.match(source, /function corsHeaders\(\)[\s\S]*?'X-Function-Release': FUNCTION_RELEASE,\n  \};\n\}/);
    // Every response is built from corsHeaders(), including the refusal when SITE_URL is missing.
    assert.equal(source.match(/new Response\(/g).length, source.match(/headers: (\{ \.\.\.)?corsHeaders\(\)/g).length);
});

test('the stamp changes with any source file and never depends on itself', async () => {
    const {functionChecksum, readStamp, writeStamp} = await ready;
    const directory = mkdtempSync(join(tmpdir(), 'function-'));
    try {
        writeFileSync(join(directory, 'index.ts'), 'one');
        writeFileSync(join(directory, 'validation.ts'), 'two');
        writeFileSync(join(directory, 'release.ts'), `export const FUNCTION_RELEASE = '${'0'.repeat(64)}';\n`);
        const first = writeStamp(directory);
        assert.equal(readStamp(directory), first);
        assert.equal(functionChecksum(directory), first, 'writing the stamp does not change the checksum');
        writeFileSync(join(directory, 'validation.ts'), 'two.');
        assert.notEqual(functionChecksum(directory), first);
        writeFileSync(join(directory, 'validation.ts'), 'two');
        writeFileSync(join(directory, 'added.ts'), '');
        assert.notEqual(functionChecksum(directory), first, 'a new file is part of the version');
        // Moving text from one file to the next is a different version.
        rmSync(join(directory, 'added.ts'));
        writeFileSync(join(directory, 'index.ts'), 'onet');
        writeFileSync(join(directory, 'validation.ts'), 'wo');
        assert.notEqual(functionChecksum(directory), first);
        writeFileSync(join(directory, 'release.ts'), 'nothing here');
        assert.throws(() => readStamp(directory), /holds no release stamp/);
    } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('dev publishes main; each production publishes its own release branch', async () => {
    const {releaseBranch, plan} = await ready;
    assert.equal(releaseBranch({name: 'dev', kind: 'dev'}), 'main');
    assert.equal(releaseBranch({name: 'acme', kind: 'production'}), 'release/acme');
    assert.deepEqual(plan(registry), {
        dev: {include: [{environment: 'dev', branch: 'main'}]},
        production: {include: [{environment: 'demo', branch: 'release/demo'}, {environment: 'acme', branch: 'release/acme'}]},
        all: {include: [{environment: 'demo', branch: 'release/demo'}, {environment: 'acme', branch: 'release/acme'}, {environment: 'dev', branch: 'main'}]},
    });
    assert.deepEqual(plan(registry, 'acme').production, {include: [{environment: 'acme', branch: 'release/acme'}]});
    assert.throws(() => plan(registry, 'dev'), /"dev" is a dev environment/);
    assert.throws(() => plan(registry, 'nowhere'), /Unknown environment "nowhere"/);
    // The real list, through the command line the workflows use.
    const real = JSON.parse(execFileSync(process.execPath, ['scripts/release.mjs', 'plan'], {cwd: root, encoding: 'utf8'}));
    assert.ok(real.dev.include.length >= 1 && real.dev.include.every(item => item.branch === 'main'));
    assert.ok(real.production.include.every(item => item.branch === `release/${item.environment}`));
});

test('the deployed function must answer its own site and be the released version', async () => {
    const {checkFunction, functionState} = await ready;
    const answer = {status: 200, origin: 'https://field.acme.test', release: STAMP};
    const seen = [];
    const server = createServer((req, res) => {
        seen.push([req.method, req.url, req.headers.origin, req.headers.authorization]);
        res.statusCode = answer.status;
        if (answer.origin) res.setHeader('Access-Control-Allow-Origin', answer.origin);
        if (answer.release) res.setHeader('X-Function-Release', answer.release);
        res.end('ok');
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    try {
        const environment = {name: 'acme', siteUrl: 'https://field.acme.test', databaseUrl: `http://127.0.0.1:${server.address().port}`};
        assert.match(await checkFunction(environment, STAMP), /answers only https:\/\/field\.acme\.test, version aaaaaaaaaaaa/);
        // Asked the way a browser asks before a request: no session, no key.
        assert.deepEqual(seen[0], ['OPTIONS', '/functions/v1/admin-users', 'https://field.acme.test', undefined]);
        assert.deepEqual(await functionState(environment), {status: 200, allowOrigin: 'https://field.acme.test', release: STAMP});
        answer.release = 'b'.repeat(64);
        await assert.rejects(checkFunction(environment, STAMP), /is version bbbbbbbbbbbb, not aaaaaaaaaaaa/);
        answer.release = null;
        await assert.rejects(checkFunction(environment, STAMP), /earlier version that does not report which version it is/);
        answer.release = STAMP; answer.origin = 'https://demo.example.test';
        await assert.rejects(checkFunction(environment, STAMP), /answers https:\/\/demo\.example\.test, not https:\/\/field\.acme\.test; its SITE_URL setting is wrong/);
        answer.origin = null; answer.status = 500;
        await assert.rejects(checkFunction(environment, STAMP), /answers no site; its SITE_URL setting must be https:\/\/field\.acme\.test/);
        answer.status = 404;
        await assert.rejects(checkFunction(environment, STAMP), /is not deployed/);
    } finally { await new Promise(done => server.close(done)); }
    await assert.rejects(checkFunction({name: 'gone', siteUrl: 'https://x.test', databaseUrl: 'http://127.0.0.1:9'}, STAMP), /could not be reached/);
});

// Stand-ins for the parts a check and a release touch; `order` records what ran.
function parts(overrides = {}) {
    const order = [];
    const state = {clean: true, onMain: true, site: {}, function: {}, database: null, ...overrides};
    const use = {
        commit: () => COMMIT, stamp: () => STAMP,
        clean: () => state.clean, onMain: () => state.onMain,
        site: async environment => { order.push(`site ${environment.name}`); if (state.site[environment.name]) throw new Error(state.site[environment.name]); return 'serves it'; },
        function: async environment => { order.push(`function ${environment.name}`); if (state.function[environment.name]) throw new Error(state.function[environment.name]); return 'right version'; },
        database: environment => { order.push(`database ${environment.name}`); if (state.database) throw new Error(state.database); return 'matches'; },
        migrate: environment => { order.push(`migrate ${environment.name}`); },
        deploy: async environment => { order.push(`deploy ${environment.name}`); },
        publish: (environment, commit) => { order.push(`publish ${environment.name} ${commit === COMMIT}`); },
    };
    return {order, state, use, lines: [], log(line) { this.lines.push(line); }};
}

test('a check reports every part and fails when any one differs', async () => {
    const {check} = await ready;
    const all = parts();
    assert.deepEqual(await check(registry, 'acme', {use: all.use, log: line => all.log(line)}), {environment: 'acme', commit: COMMIT, database: true});
    assert.deepEqual(all.order, ['site acme', 'function acme', 'database acme']);
    assert.match(all.lines.at(-1), /"acme" is entirely at cccccccccccc\.$/);

    // Every part is still checked after one differs, so one run shows everything that is behind.
    const behind = parts({site: {acme: 'This commit is not deployed'}, database: 'history differs'});
    await assert.rejects(check(registry, 'acme', {use: behind.use, log: line => behind.log(line)}),
        /"acme" is not at cccccccccccc:\n  site: This commit is not deployed\n  database: history differs$/);
    assert.deepEqual(behind.order, ['site acme', 'function acme', 'database acme']);
    assert.ok(behind.lines.some(line => /^function +ok: right version$/.test(line)));

    const skipped = parts();
    assert.equal((await check(registry, 'dev', {skipDatabase: true, use: skipped.use, log: line => skipped.log(line)})).database, false);
    assert.deepEqual(skipped.order, ['site dev', 'function dev']);
    assert.ok(skipped.lines.includes('database  not checked'));
    assert.match(skipped.lines.at(-1), /apart from the database, which was not checked/);
    await assert.rejects(check(registry, 'nowhere', {use: all.use}), /Unknown environment "nowhere"/);
});

test('a production release is dev first, then database, function, site, and a full check', async () => {
    const {release} = await ready;
    const env = {DATABASE_URL: 'postgres://x', SUPABASE_ACCESS_TOKEN: 't'};
    const run = (name, options, overrides) => { const p = parts(overrides); return {p, done: release(registry, name, {env, use: p.use, log: line => p.log(line), ...options})}; };

    const good = run('acme');
    assert.deepEqual(await good.done, {environment: 'acme', commit: COMMIT, database: true});
    assert.deepEqual(good.p.order, ['site dev', 'function dev', 'migrate acme', 'deploy acme', 'publish acme true', 'site acme', 'function acme', 'database acme']);

    // Dev first: a production is not touched until every dev site and function is at this commit.
    for (const overrides of [{site: {dev: 'This commit is not deployed'}}, {function: {dev: 'another version'}}]) {
        const early = run('acme', {}, overrides);
        await assert.rejects(early.done, /Dev first: "dev" is not at cccccccccccc .*Nothing was changed\.$/);
        assert.ok(early.p.order.every(step => step.endsWith(' dev')), 'nothing of the production may run');
    }
    const noDev = parts();
    await assert.rejects(release({environments: {demo: entry('demo')}, previews: null}, 'demo', {env, use: noDev.use, log: () => {}}), /no dev environment to release to first/);

    // Refused before anything runs.
    const refusals = [
        [{}, {clean: false}, /uncommitted changes/],
        [{}, {onMain: false}, /is not on main/],
        [{skipDatabase: true}, {}, /never released without its database/],
        [{env: {SUPABASE_ACCESS_TOKEN: 't'}}, {}, /Set DATABASE_URL to the acme database's connection string\. Nothing was changed\./],
    ];
    for (const [options, overrides, message] of refusals) {
        const refused = run('acme', options, overrides);
        await assert.rejects(refused.done, message);
        assert.deepEqual(refused.p.order, []);
    }

    // A branch that cannot be moved leaves the site as it was, and says what was already released.
    const stuck = parts();
    stuck.use.publish = () => { const error = new Error('push failed'); error.stderr = 'refusing to allow a GitHub App to create or update workflow'; throw error; };
    await assert.rejects(release(registry, 'acme', {env, use: stuck.use, log: () => {}}),
        /database and admin function of "acme" are released, but release\/acme could not be moved, so its site is unchanged\. This release changes a workflow file, which needs the RELEASE_DEPLOY_KEY secret/);
    assert.deepEqual(stuck.order, ['site dev', 'function dev', 'migrate acme', 'deploy acme']);

    // Without a deploy token the function is not deployed, and the check still decides.
    const noToken = run('acme', {env: {DATABASE_URL: 'postgres://x'}}, {function: {acme: 'another version'}});
    await assert.rejects(noToken.done, /"acme" is not at cccccccccccc:\n  function: another version$/);
    assert.ok(!noToken.p.order.includes('deploy acme'));
    assert.ok(noToken.p.lines.includes('Admin function: no deploy token here, so it is only checked.'));
});

test('a dev release needs no other environment, publishes nothing, and may run before its database is set up', async () => {
    const {release} = await ready;
    const full = parts();
    await release(registry, 'dev', {env: {DATABASE_URL: 'postgres://x', SUPABASE_ACCESS_TOKEN: 't'}, use: full.use, log: () => {}});
    assert.deepEqual(full.order, ['migrate dev', 'deploy dev', 'site dev', 'function dev', 'database dev']);
    const bare = parts();
    assert.equal((await release(registry, 'dev', {skipDatabase: true, env: {}, use: bare.use, log: line => bare.log(line)})).database, false);
    assert.deepEqual(bare.order, ['site dev', 'function dev']);
    assert.ok(bare.lines.includes('Database: skipped.'));
});

test('deploying the function sets its site address from the list and keeps the token out of the command', async () => {
    const {deployFunction} = await ready;
    const environment = {name: 'acme', kind: 'production', siteUrl: 'https://field.acme.test', databaseUrl: 'https://acmeref.supabase.co'};
    const setup = (overrides = {}) => {
        const calls = [];
        const use = {
            state: async () => ({status: 200, allowOrigin: environment.siteUrl, release: 'b'.repeat(64)}),
            changes: () => '', stamp: () => STAMP, checksum: () => STAMP,
            run: (args, token) => { calls.push({args, token}); return ''; },
            verify: async () => 'answers only its site',
            ...overrides,
        };
        return {calls, use};
    };
    const fresh = setup();
    assert.deepEqual(await deployFunction(environment, {token: 'secret-token', use: fresh.use, log: () => {}}), {deployed: true, release: STAMP});
    assert.deepEqual(fresh.calls.map(call => call.args), [
        ['secrets', 'set', 'SITE_URL=https://field.acme.test', '--project-ref', 'acmeref'],
        ['functions', 'deploy', 'admin-users', '--project-ref', 'acmeref', '--use-api'],
    ]);
    assert.ok(fresh.calls.every(call => call.token === 'secret-token' && !call.args.join(' ').includes('secret-token')));

    // Already this version, answering the right site: nothing is sent.
    const current = setup({state: async () => ({status: 200, allowOrigin: environment.siteUrl, release: STAMP})});
    assert.deepEqual(await deployFunction(environment, {token: 't', use: current.use, log: () => {}}), {deployed: false, release: STAMP});
    assert.deepEqual(current.calls, []);
    // Not deployed yet, or unreachable: deployed.
    const missing = setup({state: async () => { throw new Error('offline'); }});
    assert.equal((await deployFunction(environment, {token: 't', use: missing.use, log: () => {}})).deployed, true);

    const refusals = [
        [{token: ''}, {}, /Set SUPABASE_ACCESS_TOKEN/],
        [{token: 't'}, {checksum: () => 'd'.repeat(64)}, /changed without its release stamp/],
        [{token: 't'}, {changes: () => ' M supabase/functions/admin-users/index.ts'}, /changes that are not committed/],
    ];
    for (const [options, overrides, message] of refusals) {
        const refused = setup(overrides);
        await assert.rejects(deployFunction(environment, {use: refused.use, log: () => {}, ...options}), message);
        assert.deepEqual(refused.calls, []);
    }
    const local = setup();
    await assert.rejects(deployFunction({...environment, databaseUrl: 'http://127.0.0.1:54321'}, {token: 't', use: local.use}), /runs on this computer/);
    // A failure from the tool is reported without the token.
    const failing = setup({run: () => { const error = new Error('denied for secret-token'); error.stderr = 'bad token secret-token'; throw error; }});
    await assert.rejects(deployFunction(environment, {token: 'secret-token', use: failing.use, log: () => {}}),
        error => !error.message.includes('secret-token') && /denied for \[token\]/.test(error.message));
});

test('every migration is one transaction: none of its own, or BEGIN; first and COMMIT; last', async () => {
    const {migrationFiles, migrationShape, withoutCommit} = await migrationsReady;
    const files = migrationFiles();
    assert.ok(files.length >= 29);
    assert.ok(files.every(file => ['plain', 'wrapped'].includes(file.shape)));
    assert.ok(files.slice(11).every(file => file.shape === 'wrapped'), 'migrations from 012 on carry their own transaction');
    assert.deepEqual(files.map(file => file.file), [...files.map(file => file.file)].sort(), 'filename order');
    assert.equal(new Set(files.map(file => file.version)).size, files.length);

    assert.equal(migrationShape('create table a();\n'), 'plain');
    assert.equal(migrationShape('-- note\n\nBEGIN;\ncreate table a();\nCOMMIT;\n\n'), 'wrapped');
    assert.equal(migrationShape('begin;\nselect 1;\ncommit ;\n'), 'wrapped');
    // A block's own begin and end are not transaction lines.
    assert.equal(migrationShape('create function f() returns void language plpgsql as $$\nBEGIN\n  null;\nEND;\n$$;\n'), 'plain');
    for (const mixed of ['BEGIN;\nselect 1;\n', 'select 1;\nCOMMIT;\n', 'BEGIN;\nselect 1;\nCOMMIT;\nselect 2;\n', 'select 0;\nBEGIN;\nselect 1;\nCOMMIT;\n', 'BEGIN;\nselect 1;\nCOMMIT;\nBEGIN;\nselect 2;\nCOMMIT;\n']) {
        assert.equal(migrationShape(mixed), 'mixed', mixed);
    }
    assert.equal(migrationShape('BEGIN; select 1; COMMIT;\n'), 'wrapped');
    // Only top-level statements count: not a function body, a string or a comment.
    assert.equal(migrationShape("BEGIN;\ncreate function f() returns void language plpgsql as $body$\nBEGIN\n  perform 1;\nCOMMIT;\nEND;\n$body$;\nselect 'x;\nCOMMIT;\ny', E'it\\'s;\nCOMMIT;\n';\n/* COMMIT; */\n-- COMMIT;\nCOMMIT;\n"), 'wrapped');
    assert.equal(migrationShape('select case when true then 1 else 2 end;\nselect $1, \'a$b$c\';\n'), 'plain');
    // Any other way of starting, ending or splitting a transaction is refused.
    for (const mixed of ['START TRANSACTION;\nselect 1;\nCOMMIT;\n', 'select 1;\nEND;\n', 'BEGIN;\nselect 1;\nROLLBACK;\n', 'BEGIN;\nsavepoint a;\nselect 1;\nCOMMIT;\n', 'BEGIN ISOLATION LEVEL SERIALIZABLE;\nselect 1;\nCOMMIT;\n', 'BEGIN;\nselect 1;\nCOMMIT']) {
        assert.equal(migrationShape(mixed), 'mixed', mixed);
    }
    assert.equal(withoutCommit('-- note\nBEGIN;\nselect 1;\n\nCOMMIT;\n-- done\n'), '-- note\nBEGIN;\nselect 1;\n\n');
    assert.equal(withoutCommit("BEGIN;\nselect '\nCOMMIT;\n';\nCOMMIT;\n"), "BEGIN;\nselect '\nCOMMIT;\n';\n", 'a COMMIT; inside a string is not the one left out');
    assert.throws(() => withoutCommit('select 1;\n'), /Only a migration wrapped/);
});

test('migration files must be named and numbered so their order is the history\'s order', async () => {
    const {migrationFiles} = await migrationsReady;
    const directory = mkdtempSync(join(tmpdir(), 'migrations-'));
    const only = files => { rmSync(directory, {recursive: true, force: true}); mkdirSync(directory); for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text); };
    try {
        only({'001_first.sql': 'select 1;\n', '002_second.sql': 'BEGIN;\nselect 2;\nCOMMIT;\n', 'notes.txt': 'ignored'});
        assert.deepEqual(migrationFiles(directory).map(({version, name, shape}) => [version, name, shape]), [['001', 'first', 'plain'], ['002', 'second', 'wrapped']]);
        only({'001_first.sql': 'select 1;\n', '001_again.sql': 'select 1;\n'});
        assert.throws(() => migrationFiles(directory), /must have a later number/);
        // Filename order would run 10 before 1; the history, kept in number order, would list 1 first.
        only({'1_first.sql': 'select 1;\n', '10_tenth.sql': 'select 1;\n'});
        assert.throws(() => migrationFiles(directory), /must have a later number/);
        only({'003 Bad Name.sql': 'select 1;\n'});
        assert.throws(() => migrationFiles(directory), /must be named <number>_<lowercase_name>\.sql/);
        only({'004_two_transactions.sql': 'BEGIN;\nselect 1;\nCOMMIT;\nBEGIN;\nselect 2;\nCOMMIT;\n'});
        assert.throws(() => migrationFiles(directory), /must either have no transaction statement of its own, or start with BEGIN; and end with COMMIT;/);
    } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('a recorded history is compared with the files by number, name and text', async () => {
    const {compareHistory, parseRecorded, textChecksum} = await migrationsReady;
    const files = ['one', 'two', 'three'].map((name, index) => ({version: `00${index + 1}`, name, md5: textChecksum(`${name}\n`), path: `supabase/migrations/00${index + 1}_${name}.sql`}));
    const row = (file, overrides = {}) => ({version: file.version, name: file.name, md5: file.md5, parts: 1, ...overrides});
    assert.equal(textChecksum('one\n\n'), textChecksum('one'), 'trailing newlines do not count');
    assert.notEqual(textChecksum('one \n'), textChecksum('one'));
    assert.deepEqual(parseRecorded('001|one|abc|1\n002|two||13\n'), [{version: '001', name: 'one', md5: 'abc', parts: 1}, {version: '002', name: 'two', md5: '', parts: 13}]);

    assert.deepEqual(compareHistory(files.map(file => row(file)), files), {problems: [], differing: [], pending: []});
    assert.deepEqual(compareHistory([row(files[0])], files).pending, files.slice(1));
    assert.deepEqual(compareHistory([], files).pending, files);

    const edited = compareHistory([row(files[0]), row(files[1], {md5: 'other'}), row(files[2], {parts: 4})], files);
    assert.deepEqual(edited.problems, ['002_two was recorded with different text than the file has now', '003_three was recorded in 4 parts, not as the file']);
    assert.deepEqual(edited.pending, [], 'nothing is pending on a history that is not the files');
    // Names only: the same list, whatever the recorded text. This is what align-history requires.
    assert.deepEqual(compareHistory([row(files[0]), row(files[1], {md5: 'other'}), row(files[2], {parts: 4})], files, {namesOnly: true}),
        {problems: [], differing: [files[1], files[2]], pending: []});

    assert.deepEqual(compareHistory([row(files[0]), row(files[2])], files).problems, ['migration 2 is 003_three in the database and 002_two in the files']);
    assert.deepEqual(compareHistory([row(files[0], {name: 'uno'})], files, {namesOnly: true}).problems, ['migration 1 is 001_uno in the database and 001_one in the files']);
    assert.deepEqual(compareHistory([...files.map(file => row(file)), {version: '004', name: 'newer', md5: 'x', parts: 1}], files).problems,
        ['the database has 004_newer, which is not among the migration files']);
});

test('the workflows release dev on every merge and a production only through the routine', () => {
    const read = file => readFileSync(join(root, '.github/workflows', file), 'utf8');
    const quality = read('quality.yml');
    // A run on main is never cancelled part-way through a migration.
    assert.match(quality, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
    assert.match(quality, /\n  dev:[\s\S]*needs: \[quality, plan\]/);
    assert.match(quality, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.plan\)\.dev \}\}/);
    assert.match(quality, /release\.mjs release "\$ENVIRONMENT"\n/);
    assert.doesNotMatch(quality, /smoke-deploy\.mjs --all/, 'a merge to main no longer waits for, or expects, the productions');
    assert.doesNotMatch(quality, /\.production/, 'a merge to main releases to dev only');

    const release = read('release.yml');
    assert.match(release, /\non:\n  workflow_dispatch:/);
    assert.doesNotMatch(release, /\n  (push|pull_request|schedule):/, 'a production is released only on request');
    assert.match(release, /"\$GITHUB_REF" != refs\/heads\/main/);
    // Dev first: every dev environment, database included, before any production job starts.
    assert.match(release, /\n  dev-first:[\s\S]*release\.mjs check "\$ENVIRONMENT"\n  release:/);
    assert.match(release, /\n  release:\n    name: [^\n]+\n    needs: \[plan, dev-first\]/);
    assert.match(release, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.plan\)\.production \}\}/);
    assert.match(release, /max-parallel: 1/);
    assert.equal(release.match(/contents: write/g).length, 1, 'only the job that moves a release branch may write');

    const check = read('environments-check.yml');
    assert.match(check, /schedule:/);
    assert.match(check, /ref: \$\{\{ matrix\.branch \}\}/);
    assert.match(check, /fromJSON\(needs\.plan\.outputs\.plan\)\.all/);
    for (const workflow of [quality, release, check]) {
        // Each job takes its secrets from the repository environment named after its environment,
        // and a secret reaches a script only through its environment, never its command line.
        assert.match(workflow, /environment: \$\{\{ matrix\.environment \}\}/);
        assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
        assert.doesNotMatch(workflow, /run:[^\n]*\$\{\{/);
        assert.doesNotMatch(workflow.replace(/^ +[A-Z_]+: \$\{\{ [^\n]+\n/gm, ''), /\n\s+(node|echo|if|gh) [^\n]*\$\{\{/, 'no expression is pasted into a script');
    }
    for (const workflow of [quality, release]) assert.match(workflow, /group: release-\$\{\{ matrix\.environment \}\}\n\s+cancel-in-progress: false/);
});

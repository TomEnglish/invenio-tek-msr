const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {spawnSync} = require('node:child_process');
const {resolve} = require('node:path');

const ready = import('../scripts/create-first-admin.mjs');
const environment = {name: 'acme', siteUrl: 'https://acme.example.test', databaseUrl: 'https://acmedb.supabase.co'};
const USER = 'f1111111-1111-4111-8111-111111111111';
// A server key for the given database; nothing is signed or checked against a server.
const serverKey = (ref, role = 'service_role') => `x.${Buffer.from(JSON.stringify({ref, role})).toString('base64url')}.y`;
const KEY = serverKey('acmedb');
const NOW = Date.parse('2026-11-15T12:00:00Z');

// The sign-in and data services, in memory. `state` is what the database would hold.
function service(state = {}) {
    const calls = [];
    const reply = (status, data) => ({ok: status >= 200 && status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data))});
    const fetchImpl = async (url, options) => {
        const {pathname, searchParams} = new URL(url);
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({method: options.method, path: pathname, query: Object.fromEntries(searchParams), body, headers: options.headers});
        assert.equal(new URL(url).origin, environment.databaseUrl);
        if (pathname === '/rest/v1/users') return reply(200, state.profile ? [{id: USER}] : []);
        if (pathname === '/auth/v1/admin/users' && options.method === 'POST') {
            if (state.createFails) return reply(422, {msg: 'A user with this email address has already been registered'});
            state.profile = true; return reply(200, {id: USER, email: body.email});
        }
        if (pathname === '/rest/v1/rpc/bootstrap_first_admin') {
            if (state.hasAdmin) return reply(403, {code: '42501', message: 'This database already has an administrator. Add people from Users & Access.'});
            if (state.wrongKey) return reply(403, {code: '42501', message: 'permission denied for function bootstrap_first_admin'});
            return reply(200, {id: USER, role: 'admin', invitation_status: state.accepted ? 'accepted' : 'pending'});
        }
        if (pathname === `/auth/v1/admin/users/${USER}`) return reply(200, {id: USER, email_confirmed_at: state.confirmed ? '2026-11-01T00:00:00Z' : null});
        if (pathname === '/auth/v1/invite' || pathname === '/auth/v1/recover') return state.mailFails ? reply(500, {msg: 'smtp'}) : reply(200, {});
        return reply(404, {message: 'unexpected call'});
    };
    return {fetchImpl, calls};
}
const run = async (state, overrides = {}) => {
    const {createFirstAdmin} = await ready;
    const fake = service(state);
    const result = createFirstAdmin({environment, email: ' Lead@Acme.Example ', fullName: ' Lead Person ', key: KEY, fetchImpl: fake.fetchImpl, now: () => NOW, ...overrides});
    return {fake, result};
};

test('a new environment gets an unconfirmed account, the admin role, and an invitation to its own site', async () => {
    const {fake, result} = await run({});
    assert.deepEqual(await result, {userId: USER, email: 'lead@acme.example', invited: true, expiresAt: '2026-11-15T13:00:00.000Z'});
    assert.deepEqual(fake.calls.map(call => `${call.method} ${call.path}`), [
        'GET /rest/v1/users', 'POST /auth/v1/admin/users', 'POST /rest/v1/rpc/bootstrap_first_admin',
        `GET /auth/v1/admin/users/${USER}`, 'POST /auth/v1/invite',
    ]);
    assert.deepEqual(fake.calls[0].query, {select: 'id', email: 'eq.lead@acme.example'});
    assert.deepEqual(fake.calls[1].body, {email: 'lead@acme.example', email_confirm: false, user_metadata: {full_name: 'Lead Person'}});
    assert.deepEqual(fake.calls[2].body, {p_target: USER, p_full_name: 'Lead Person', p_expires_at: '2026-11-15T13:00:00.000Z'});
    assert.deepEqual(fake.calls[4].query, {redirect_to: 'https://acme.example.test/login.html?setup=invite'});
    assert.deepEqual(fake.calls[4].body, {email: 'lead@acme.example', data: {full_name: 'Lead Person'}});
    for (const call of fake.calls) assert.equal(call.headers.Authorization, `Bearer ${KEY}`);
});

test('running it again resends: no second account, and a confirmed email gets a setup code instead', async () => {
    const again = await run({profile: true});
    await again.result;
    assert.equal(again.fake.calls.some(call => call.path === '/auth/v1/admin/users' && call.method === 'POST'), false);
    assert.equal(again.fake.calls.at(-1).path, '/auth/v1/invite');
    const confirmed = await run({profile: true, confirmed: true});
    await confirmed.result;
    assert.equal(confirmed.fake.calls.at(-1).path, '/auth/v1/recover');
    assert.deepEqual(confirmed.fake.calls.at(-1).body, {email: 'lead@acme.example'});
    assert.deepEqual(confirmed.fake.calls.at(-1).query, {redirect_to: 'https://acme.example.test/login.html?setup=invite'});
});

test('an environment that already has an administrator is refused and nobody is emailed', async () => {
    const {fake, result} = await run({profile: true, hasAdmin: true});
    await assert.rejects(result, /acme already has an administrator\. Invite people from Users & Access on https:\/\/acme\.example\.test/);
    assert.equal(fake.calls.some(call => /invite|recover/.test(call.path)), false);
    // A different refusal (for example the wrong key) is not reported as "already has an administrator".
    const wrong = await run({profile: true, wrongKey: true});
    await assert.rejects(wrong.result, /Setting up the administrator failed \(403\): permission denied/);
});

test('an account that already finished setup is promoted without an email', async () => {
    const {fake, result} = await run({profile: true, accepted: true});
    assert.deepEqual(await result, {userId: USER, email: 'lead@acme.example', invited: false});
    assert.equal(fake.calls.length, 2);
});

test('a failed email says the administrator is set up and to run it again; other failures say which step', async () => {
    const mail = await run({mailFails: true});
    await assert.rejects(mail.result, /administrator is set up, but the invitation email could not be sent \(500\).*run this command again/);
    const create = await run({createFails: true});
    await assert.rejects(create.result, /Creating the account failed \(422\): A user with this email address has already been registered/);
    assert.equal(create.fake.calls.some(call => call.path.includes('bootstrap_first_admin')), false);
});

test('bad input is refused before anything is sent, and the key is never printed', async () => {
    for (const [overrides, pattern] of [
        [{email: 'not-an-email'}, /email address/], [{fullName: '  '}, /full name/], [{key: ''}, /SUPABASE_SERVICE_ROLE_KEY is required/],
        [{ttlSeconds: 30}, /between 60 seconds and 7 days/], [{ttlSeconds: 700000}, /between 60 seconds and 7 days/],
        // Another environment's server key, or a browser key, is never sent to this database.
        [{key: serverKey('demodb')}, /SUPABASE_SERVICE_ROLE_KEY belongs to a different database\. Use the server key of "acme"; nothing was sent/],
        [{key: serverKey('acmedb', 'anon')}, /has the "anon" role, not "service_role"/],
        [{key: 'not-a-recognizable-server-key'}, /is not a recognized key/],
    ]) {
        const {fake, result} = await run({}, overrides);
        await assert.rejects(result, pattern);
        assert.equal(fake.calls.length, 0);
    }
    const script = resolve(__dirname, '../scripts/create-first-admin.mjs');
    const usage = spawnSync(process.execPath, [script], {encoding: 'utf8', env: {PATH: process.env.PATH, SUPABASE_SERVICE_ROLE_KEY: 'server-key-value'}});
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /Usage:/);
    const unknown = spawnSync(process.execPath, [script, 'nowhere', 'lead@acme.example', 'Lead'], {encoding: 'utf8', env: {PATH: process.env.PATH, SUPABASE_SERVICE_ROLE_KEY: 'server-key-value'}});
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown environment "nowhere"/);
    assert.doesNotMatch(usage.stdout + usage.stderr + unknown.stdout + unknown.stderr, /server-key-value/);
    assert.doesNotMatch(readFileSync(script, 'utf8'), /console\.(log|error)\([^)]*key/);
});

test('the command prints the outcome and never the key, through success and every failure', async () => {
    const {createServer} = require('node:http');
    const {execFile} = require('node:child_process');
    const {mkdtempSync, writeFileSync, rmSync} = require('node:fs');
    const {tmpdir} = require('node:os');
    const {join} = require('node:path');
    const state = {};
    const requests = [];
    // The sign-in and data services of an environment on this computer.
    const server = createServer((request, response) => {
        const {pathname} = new URL(request.url, 'http://localhost');
        requests.push(`${request.method} ${pathname}`);
        const reply = (status, data) => { response.statusCode = status; response.end(JSON.stringify(data)); };
        request.resume().on('end', () => {
            if (state.reject) return reply(401, {message: `Invalid API key ${request.headers.apikey}`});
            if (pathname === '/rest/v1/users') return reply(200, state.profile ? [{id: USER}] : []);
            if (pathname === '/auth/v1/admin/users' && request.method === 'POST') { state.profile = true; return reply(200, {id: USER}); }
            if (pathname === '/rest/v1/rpc/bootstrap_first_admin') {
                return state.hasAdmin ? reply(403, {code: '42501', message: 'This database already has an administrator. Add people from Users & Access.'})
                    : reply(200, {id: USER, invitation_status: 'pending'});
            }
            if (pathname === `/auth/v1/admin/users/${USER}`) return reply(200, {id: USER, email_confirmed_at: null});
            if (pathname === '/auth/v1/invite') return state.mailFails ? reply(500, {msg: 'mail is down'}) : reply(200, {});
            reply(404, {message: 'unexpected call'});
        });
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const directory = mkdtempSync(join(tmpdir(), 'first-admin-'));
    const local = serverKey(undefined);
    try {
        writeFileSync(join(directory, 'environments.json'), JSON.stringify({environments: {devlocal: {
            kind: 'dev', label: 'Dev', siteUrl: 'http://localhost:8092', databaseUrl: `http://127.0.0.1:${server.address().port}`,
            publicKey: serverKey(undefined, 'anon'), defaultProjectId: '00000000-0000-0000-0000-000000000000',
        }}}));
        const script = resolve(__dirname, '../scripts/create-first-admin.mjs');
        const run = () => new Promise(done => execFile(process.execPath, [script, 'devlocal', 'lead@acme.example', 'Lead Person'], {
            env: {PATH: process.env.PATH, ENVIRONMENTS_FILE: join(directory, 'environments.json'), SUPABASE_SERVICE_ROLE_KEY: local},
        }, (error, stdout, stderr) => done({status: error ? error.code : 0, output: stdout + stderr})));
        const sent = await run();
        assert.equal(sent.status, 0, sent.output);
        assert.match(sent.output, /Invitation sent to lead@acme\.example for devlocal\. They finish setup at http:\/\/localhost:8092\/login\.html/);
        assert.deepEqual(requests, ['GET /rest/v1/users', 'POST /auth/v1/admin/users', 'POST /rest/v1/rpc/bootstrap_first_admin', `GET /auth/v1/admin/users/${USER}`, 'POST /auth/v1/invite']);
        state.mailFails = true;
        const mail = await run();
        assert.equal(mail.status, 1);
        assert.match(mail.output, /administrator is set up, but the invitation email could not be sent/);
        state.hasAdmin = true;
        const refused = await run();
        assert.equal(refused.status, 1);
        assert.match(refused.output, /devlocal already has an administrator/);
        // Even when the service echoes the key back in its refusal, the command does not repeat it.
        state.reject = true;
        const rejected = await run();
        assert.equal(rejected.status, 1);
        assert.match(rejected.output, /Looking up the account failed \(401\)/);
        for (const result of [sent, mail, refused, rejected]) assert.equal(result.output.includes(local), false, 'the server key was printed');
    } finally {
        rmSync(directory, {recursive: true, force: true});
        await new Promise(done => server.close(done));
    }
});

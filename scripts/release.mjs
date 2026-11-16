// One release routine for every environment (docs/ENVIRONMENTS.md, "Releasing").
// A release moves one commit of main onto an environment: its database, its
// admin function and its office site, in that order, then checks all three.
//
//   node scripts/release.mjs release <name> [--skip-database]
//       Runs the routine for the commit checked out here. For a production it
//       first confirms every dev site and dev admin function is at this commit.
//       Needs DATABASE_URL (that environment's database). With
//       SUPABASE_ACCESS_TOKEN it also deploys the admin function; without it
//       the function is only checked. --skip-database is for dev only.
//   node scripts/release.mjs check <name> [--skip-database] [--attempts N]
//       Read-only: is this environment entirely at the commit checked out here?
//   node scripts/release.mjs function <name>
//       Deploys the admin function alone (needs SUPABASE_ACCESS_TOKEN).
//   node scripts/release.mjs stamp
//       Rewrites the admin function's release stamp after its code changed.
//   node scripts/release.mjs plan [<production>|all]
//       JSON for the workflows: which environments, and the branch each site publishes.
//
// Secrets come from the environment and are never printed.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEnvironment, listEnvironments, loadEnvironments } from './environments.mjs';
import { smokeDeploy } from './smoke-deploy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FUNCTION = 'admin-users';
const FUNCTION_DIRECTORY = join(root, 'supabase', 'functions', FUNCTION);
const STAMP_FILE = 'release.ts';
export const RELEASE_HEADER = 'x-function-release';
const short = value => String(value).slice(0, 12);

// The branch an environment's office site publishes. Dev publishes main, so
// every merge reaches it. A production publishes its own branch, which only
// this routine moves, and only forward along main.
export function releaseBranch(environment) {
    return environment.kind === 'dev' ? 'main' : `release/${environment.name}`;
}

// The admin function's version: a checksum of its source files. The stamp
// file is left out, since it holds the checksum itself.
export function functionChecksum(directory = FUNCTION_DIRECTORY) {
    const hash = createHash('sha256');
    for (const file of readdirSync(directory).filter(name => name !== STAMP_FILE).sort()) {
        hash.update(file).update('\0').update(readFileSync(join(directory, file))).update('\0');
    }
    return hash.digest('hex');
}

export function readStamp(directory = FUNCTION_DIRECTORY) {
    const match = /FUNCTION_RELEASE = '([a-f0-9]{64})'/.exec(readFileSync(join(directory, STAMP_FILE), 'utf8'));
    if (!match) throw new Error(`${STAMP_FILE} holds no release stamp`);
    return match[1];
}

export function writeStamp(directory = FUNCTION_DIRECTORY) {
    const checksum = functionChecksum(directory);
    const source = readFileSync(join(directory, STAMP_FILE), 'utf8');
    writeFileSync(join(directory, STAMP_FILE), source.replace(/FUNCTION_RELEASE = '[a-f0-9]{64}'/, `FUNCTION_RELEASE = '${checksum}'`));
    return checksum;
}

// What the deployed admin function says about itself, read without signing
// in: which office site it answers (its SITE_URL setting) and which version
// it is. A browser's preflight request is the one call it answers for anyone.
export async function functionState(environment, request = fetch) {
    const response = await request(`${environment.databaseUrl}/functions/v1/${FUNCTION}`, {
        method: 'OPTIONS',
        headers: { Origin: environment.siteUrl, 'Access-Control-Request-Method': 'POST' },
        signal: AbortSignal.timeout(15000),
    });
    return {
        status: response.status,
        allowOrigin: response.headers.get('access-control-allow-origin'),
        release: response.headers.get(RELEASE_HEADER),
    };
}

// Why the deployed function is not the expected version for this environment, or null.
export function functionProblem(environment, state, expected) {
    if (state.status === 404) return 'the admin function is not deployed';
    if (state.allowOrigin !== environment.siteUrl) {
        return state.allowOrigin
            ? `the admin function answers ${state.allowOrigin}, not ${environment.siteUrl}; its SITE_URL setting is wrong`
            : `the admin function answers no site; its SITE_URL setting must be ${environment.siteUrl}`;
    }
    if (!state.release) return 'the admin function is an earlier version that does not report which version it is';
    if (state.release !== expected) return `the admin function is version ${short(state.release)}, not ${short(expected)}`;
    return null;
}

export async function checkFunction(environment, expected, attempts = 1, request = fetch) {
    let problem;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try { problem = functionProblem(environment, await functionState(environment, request), expected); }
        catch (error) { problem = `the admin function could not be reached (${error.message})`; }
        if (!problem) return `answers only ${environment.siteUrl}, version ${short(expected)}`;
        if (attempt < attempts - 1) await delay(5000);
    }
    throw new Error(problem);
}

function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }

const tools = {
    commit: () => git('rev-parse', 'HEAD'),
    stamp: () => readStamp(),
    site: (environment, commit, attempts, registry) => smokeDeploy(environment.siteUrl, commit, attempts, {
        environment: environment.name,
        databaseUrl: environment.databaseUrl,
        otherDatabaseUrls: listEnvironments(registry).filter(other => other.name !== environment.name).map(other => other.databaseUrl),
    }).then(() => `serves ${short(commit)} as "${environment.name}", connected to its own database`),
    function: (environment, expected, attempts) => checkFunction(environment, expected, attempts),
    // scripts/database.sh prints its own findings; only the outcome is needed here.
    database: environment => {
        if (!process.env.DATABASE_URL) throw new Error(`set DATABASE_URL to the ${environment.name} database's connection string`);
        const result = spawnSync(join(root, 'scripts', 'database.sh'), ['check', environment.name], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
        if (result.status !== 0) throw new Error('its history or schema is not what the migration files build (see above)');
        return 'history is exactly the migration files; schema matches a fresh build';
    },
};

// Is this environment entirely at one commit? Site, admin function and
// database are each checked and all reported, so one run shows everything
// that is behind. Throws when any part differs.
export async function check(registry, name, { skipDatabase = false, attempts = 1, log = console.log, use = tools } = {}) {
    const environment = getEnvironment(registry, name);
    const commit = use.commit();
    const parts = [
        ['site', () => use.site(environment, commit, attempts, registry)],
        // The site may still be building; a function is either this version or it is not.
        ['function', () => use.function(environment, use.stamp(), Math.min(attempts, 6))],
        ['database', skipDatabase ? null : () => use.database(environment)],
    ];
    const failures = [];
    for (const [part, run] of parts) {
        if (!run) { log(`${part.padEnd(9)} not checked`); continue; }
        try { log(`${part.padEnd(9)} ok: ${await run()}`); }
        catch (error) { failures.push(`${part}: ${error.message}`); log(`${part.padEnd(9)} DIFFERENT: ${error.message}`); }
    }
    if (failures.length) throw new Error(`"${name}" is not at ${short(commit)}:\n  ${failures.join('\n  ')}`);
    log(`"${name}" is entirely at ${short(commit)}${skipDatabase ? ', apart from the database, which was not checked' : ''}.`);
    return { environment: name, commit, database: !skipDatabase };
}

const hide = (text, secret) => (secret ? String(text).replaceAll(secret, '[token]') : String(text));
const deployTools = {
    state: environment => functionState(environment),
    // Only the function's own files, as committed, are deployed.
    changes: () => git('status', '--porcelain', '--', 'supabase/functions', 'supabase/config.toml'),
    run: (args, token) => execFileSync('supabase', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } }),
    verify: (environment, expected) => checkFunction(environment, expected, 24),
    stamp: () => readStamp(),
    checksum: () => functionChecksum(),
};

// Deploys the admin function to one environment. Its SITE_URL setting is
// written from environments.json first, so the function can only ever answer
// that environment's own site. Nothing is deployed when the environment
// already runs this version.
export async function deployFunction(environment, { token = process.env.SUPABASE_ACCESS_TOKEN, log = console.log, use = deployTools } = {}) {
    if (!token) throw new Error('Set SUPABASE_ACCESS_TOKEN to deploy the admin function.');
    const host = new URL(environment.databaseUrl).hostname;
    if (['127.0.0.1', 'localhost'].includes(host)) throw new Error(`"${environment.name}" runs on this computer; its function is served by the local stack, not deployed.`);
    const expected = use.stamp();
    if (expected !== use.checksum()) throw new Error('The admin function changed without its release stamp. Run: node scripts/release.mjs stamp');
    if (use.changes()) throw new Error('The admin function has changes that are not committed. Only committed code is deployed.');
    const before = await use.state(environment).catch(() => ({}));
    if (!functionProblem(environment, before, expected)) {
        log(`The admin function on "${environment.name}" is already version ${short(expected)}.`);
        return { deployed: false, release: expected };
    }
    const ref = host.split('.')[0];
    const run = args => {
        try { return use.run(args, token); }
        catch (error) { throw new Error(hide([error.message, error.stderr, error.stdout].filter(Boolean).join('\n'), token).slice(0, 1500)); }
    };
    run(['secrets', 'set', `SITE_URL=${environment.siteUrl}`, '--project-ref', ref]);
    run(['functions', 'deploy', FUNCTION, '--project-ref', ref, '--use-api']);
    log(`Deployed the admin function to "${environment.name}": ${await use.verify(environment, expected)}.`);
    return { deployed: true, release: expected };
}

const releaseTools = {
    ...tools,
    clean: () => git('status', '--porcelain', '--untracked-files=no') === '',
    onMain: () => { try { git('merge-base', '--is-ancestor', 'HEAD', 'origin/main'); return true; } catch { return false; } },
    migrate: environment => {
        const result = spawnSync(join(root, 'scripts', 'database.sh'), ['migrate', environment.name], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
        if (result.status !== 0) throw new Error(`The ${environment.name} database was not released (see above). The site and function were not touched.`);
    },
    deploy: environment => deployFunction(environment),
    // Fast-forward only: git itself refuses to move the branch anywhere but forward.
    publish: (environment, commit) => git('push', 'origin', `${commit}:refs/heads/${releaseBranch(environment)}`),
};

// The routine. Order matters: the database first, since new pages may need
// new tables; then the function; the site last, because it is what people see.
export async function release(registry, name, { skipDatabase = false, env = process.env, log = console.log, use = releaseTools } = {}) {
    const environment = getEnvironment(registry, name);
    const production = environment.kind === 'production';
    const commit = use.commit();
    if (!use.clean()) throw new Error('This checkout has uncommitted changes. A release is always of a commit.');
    if (!use.onMain()) throw new Error(`${short(commit)} is not on main. Only a commit of main is released.`);
    if (production && skipDatabase) throw new Error('A production is never released without its database.');
    if (!skipDatabase && !env.DATABASE_URL) throw new Error(`Set DATABASE_URL to the ${name} database's connection string. Nothing was changed.`);
    if (production) {
        // Dev first. What a dev site and its function show needs no secret, so
        // it is checked here too; the workflow checks the dev databases before this runs.
        const devs = listEnvironments(registry, 'dev');
        if (!devs.length) throw new Error('There is no dev environment to release to first.');
        for (const dev of devs) {
            try {
                await use.site(dev, commit, 1, registry);
                await use.function(dev, use.stamp(), 1);
            } catch (error) { throw new Error(`Dev first: "${dev.name}" is not at ${short(commit)} (${error.message}). Nothing was changed.`); }
        }
        log(`Dev first: ${devs.map(dev => `"${dev.name}"`).join(', ')} at ${short(commit)}.`);
    }
    log(`Releasing ${short(commit)} to "${name}".`);
    if (skipDatabase) log('Database: skipped.');
    else use.migrate(environment);
    if (env.SUPABASE_ACCESS_TOKEN) await use.deploy(environment);
    else log('Admin function: no deploy token here, so it is only checked.');
    if (production) {
        try { use.publish(environment, commit); }
        catch (error) {
            const detail = [error.stderr, error.message].filter(Boolean).join('\n').trim().slice(0, 600);
            const key = /workflow/i.test(detail) ? ' This release changes a workflow file, which needs the RELEASE_DEPLOY_KEY secret (docs/ENVIRONMENTS.md, "Secrets").' : '';
            throw new Error(`The database and admin function of "${name}" are released, but ${releaseBranch(environment)} could not be moved, so its site is unchanged.${key}\n${detail}`);
        }
        log(`Site: ${releaseBranch(environment)} now points at ${short(commit)}.`);
    }
    return check(registry, name, { skipDatabase, attempts: 90, log, use });
}

// Which environments a workflow run covers. `dev` and `production` are
// matrices; each entry carries the branch its site publishes.
export function plan(registry, target = 'all') {
    const entry = environment => ({ environment: environment.name, branch: releaseBranch(environment) });
    const productions = listEnvironments(registry, 'production');
    let chosen = productions;
    if (target !== 'all') {
        const found = getEnvironment(registry, target);
        if (found.kind !== 'production') throw new Error(`"${target}" is a dev environment. Dev is released by every merge to main.`);
        chosen = [found];
    }
    return {
        dev: { include: listEnvironments(registry, 'dev').map(entry) },
        production: { include: chosen.map(entry) },
        all: { include: listEnvironments(registry).map(entry) },
    };
}

async function main(args) {
    const [command, ...rest] = args;
    const attemptsFlag = rest.indexOf('--attempts');
    const name = rest.find((value, index) => !value.startsWith('--') && (attemptsFlag === -1 || index !== attemptsFlag + 1));
    const skipDatabase = rest.includes('--skip-database');
    if (command === 'stamp') { console.log(`Release stamp is now ${writeStamp()}`); return; }
    const registry = loadEnvironments();
    if (command === 'plan') { console.log(JSON.stringify(plan(registry, name))); return; }
    if (!name) throw new Error('Usage: release.mjs release <name> [--skip-database] | check <name> [--skip-database] [--attempts N] | function <name> | stamp | plan [<production>|all]');
    if (command === 'check') { await check(registry, name, { skipDatabase, attempts: attemptsFlag === -1 ? 1 : Number(rest[attemptsFlag + 1]) }); return; }
    if (command === 'function') { await deployFunction(getEnvironment(registry, name)); return; }
    if (command === 'release') { await release(registry, name, { skipDatabase }); return; }
    throw new Error(`Unknown command "${command}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

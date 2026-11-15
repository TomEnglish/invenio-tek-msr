// Environments: one code base, many complete and separate copies of the system
// (dev, demo and one per customer). environments.json holds each copy's public
// values; this module is the only place that reads it. Nothing here is secret.
//
//   node scripts/environments.mjs check                 validate environments.json
//   node scripts/environments.mjs list [--kind K]       names, one per line
//   node scripts/environments.mjs matrix [--kind K]     JSON for a workflow matrix
//   node scripts/environments.mjs config <name>         write ./supabase-config.js for local pages
//   node scripts/environments.mjs templates <name>      write that environment's email templates
//   node scripts/environments.mjs database <name>       confirm DATABASE_URL is that environment's database
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = ['production', 'dev'];
const NAME = /^[a-z][a-z0-9-]{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELDS = ['kind', 'label', 'siteUrl', 'databaseUrl', 'publicKey', 'defaultProjectId'];
export const SITE_PLACEHOLDER = '%SITE_URL%';
export const EMAIL_TEMPLATES = ['invite', 'recovery'];

// A host name as the list must write it: lowercase labels and no trailing dot,
// so one database cannot be listed twice under two spellings.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const isLocalHost = host => ['127.0.0.1', 'localhost'].includes(host);

// An address is an origin only: https, no path, query or trailing slash. Plain
// http is accepted for a stack running on this computer.
export function siteOrigin(value) {
    let url;
    try { url = new URL(String(value)); } catch { return null; }
    const local = url.protocol === 'http:' && isLocalHost(url.hostname);
    if (url.protocol !== 'https:' && !local) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (!HOSTNAME.test(url.hostname)) return null;
    return url.origin;
}

// What an address is, whatever way it is written. A site is its host and
// port: the web host tells a build only that, so http and https count as one
// site. A hosted database is its project reference, the first label of its
// address, under any domain. On this computer, localhost and 127.0.0.1 are
// one machine.
function addressIdentity(origin, field) {
    const url = new URL(origin);
    const host = isLocalHost(url.hostname) ? '127.0.0.1' : url.hostname;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (field === 'databaseUrl' && !isLocalHost(url.hostname)) return host.split('.')[0];
    return `${host}:${port}`;
}

// What a database key says about itself. Legacy keys are JWTs that name their
// role and their database (`ref`). Newer keys name only their kind in the
// prefix, so they cannot be matched to a database by reading them.
export function keyClaims(key) {
    if (typeof key !== 'string' || key.length < 20 || /\s/.test(key)) return null;
    if (key.startsWith('sb_secret_')) return { role: 'service_role', ref: null, namesDatabase: false };
    if (key.startsWith('sb_publishable_')) return { role: 'anon', ref: null, namesDatabase: false };
    try {
        const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
        if (typeof claims?.role !== 'string') return null;
        return { role: claims.role, ref: typeof claims.ref === 'string' ? claims.ref : null, namesDatabase: true };
    } catch { return null; }
}

// Why this key must not be used with this database, or null when it may be.
// `role` is 'anon' (browser) or 'service_role' (server). A key that names
// another database is refused before it is ever sent there.
export function keyProblem(key, databaseUrl, role) {
    const claims = keyClaims(key);
    if (!claims) return 'is not a recognized key';
    if (claims.role !== role) return `has the "${claims.role}" role, not "${role}"`;
    if (!claims.namesDatabase) return null;
    const host = new URL(databaseUrl).hostname;
    if (isLocalHost(host)) return null; // a local stack's keys name no database
    if (!claims.ref) return 'does not name its database';
    if (claims.ref !== host.split('.')[0]) return 'belongs to a different database';
    return null;
}

// The browser key is public by design, but a server key pasted here would be
// published to every visitor.
function publicKeyProblem(key, databaseUrl) {
    const claims = keyClaims(key);
    if (!claims) return 'publicKey is missing or is not a recognized browser key';
    if (claims.role !== 'anon') {
        return claims.namesDatabase
            ? `publicKey has the "${claims.role}" role; only the browser (anon) key may be listed`
            : 'publicKey is a server key; use the publishable key';
    }
    const problem = keyProblem(key, databaseUrl, 'anon');
    if (problem === 'belongs to a different database') return 'publicKey belongs to a different database than databaseUrl';
    return problem ? `publicKey ${problem}, so it cannot be matched to databaseUrl` : null;
}

// Returns { environments, previews } or throws one error listing every problem.
export function validateEnvironments(document) {
    const problems = [];
    const environments = document?.environments;
    if (!environments || typeof environments !== 'object' || Array.isArray(environments) || !Object.keys(environments).length) {
        throw new Error('environments.json must list at least one environment');
    }
    const seen = new Map();
    const keys = new Map();
    for (const [name, entry] of Object.entries(environments)) {
        const say = problem => problems.push(`${name}: ${problem}`);
        if (!NAME.test(name)) say('name must be lowercase letters, digits and hyphens');
        if (!entry || typeof entry !== 'object') { say('must be an object'); continue; }
        for (const key of Object.keys(entry)) if (!FIELDS.includes(key)) say(`unknown field "${key}"`);
        if (!KINDS.includes(entry.kind)) say(`kind must be one of ${KINDS.join(', ')}`);
        if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 40) say('label is required (up to 40 characters)');
        if (!UUID.test(entry.defaultProjectId || '')) say('defaultProjectId must be a project id');
        for (const field of ['siteUrl', 'databaseUrl']) {
            const origin = siteOrigin(entry[field]);
            if (!origin || origin !== entry[field]) { say(`${field} must be an https address with no path or trailing slash`); continue; }
            // Each environment is its own copy. Two entries sharing a site or a
            // database would let one customer's users reach another's data, so
            // they are compared by what they are, not by how they are spelled.
            const identity = `${field}:${addressIdentity(origin, field)}`;
            const owner = seen.get(identity);
            if (owner) say(`${field} is already used by "${owner}"`);
            else seen.set(identity, name);
        }
        if (siteOrigin(entry.databaseUrl)) {
            const problem = publicKeyProblem(entry.publicKey, entry.databaseUrl);
            if (problem) say(problem);
        }
        // A key opens one database. The same key under two environments means
        // one of them is wrong, whatever kind of key it is.
        if (typeof entry.publicKey === 'string' && entry.publicKey) {
            const owner = keys.get(entry.publicKey);
            if (owner) say(`publicKey is already used by "${owner}"`);
            else keys.set(entry.publicKey, name);
        }
    }
    const previews = document.previews ?? null;
    if (previews !== null && !(Object.hasOwn(environments, previews) && environments[previews]?.kind === 'dev')) problems.push('previews must name a dev environment');
    if (problems.length) throw new Error(`environments.json is not valid:\n  ${problems.join('\n  ')}`);
    return { environments, previews };
}

// Does this database connection string belong to this environment? Checked
// before anything is built or loaded, so a command meant for dev does not run
// against a production because of a pasted address. A hosted database is
// reached in exactly two ways, and nothing else is accepted: its direct
// address, db.<databaseUrl host>; or the database host's shared pooler, where
// the user names the project (postgres.<reference>). For an environment on
// this computer the check can only confirm that the connection is local too.
const CONNECTION_OPTIONS = ['sslmode', 'connect_timeout', 'application_name'];
const SHARED_POOLER = /^[a-z0-9-]+\.pooler\.supabase\.com$/;
export function databaseBelongsTo(environment, connectionString) {
    let connection;
    try { connection = new URL(connectionString); } catch { return false; }
    if (!/^postgres(ql)?:$/.test(connection.protocol)) return false;
    // Only the host written in the address may decide where a command goes.
    // The database client also accepts host, hostaddr, port and service as
    // ?options, and a list of hosts, any of which would send it elsewhere.
    for (const option of connection.searchParams.keys()) if (!CONNECTION_OPTIONS.includes(option)) return false;
    const host = connection.hostname;
    if (!HOSTNAME.test(host)) return false; // also refuses a list of hosts, a trailing dot and encoded characters
    const home = new URL(environment.databaseUrl).hostname;
    if (isLocalHost(home)) return isLocalHost(host);
    if (host === `db.${home}`) return true;
    // Only on the shared pooler does the user name choose the project.
    const user = decodeURIComponent(connection.username).split('.');
    return SHARED_POOLER.test(host) && user.length === 2 && user[1] === home.split('.')[0];
}

// ENVIRONMENTS_FILE points at another list; only the test harness uses it.
export function loadEnvironments(file = process.env.ENVIRONMENTS_FILE || join(root, 'environments.json')) {
    return validateEnvironments(JSON.parse(readFileSync(file, 'utf8')));
}

export function getEnvironment(registry, name) {
    // Own entries only: a name such as "constructor" is not an environment.
    const entry = Object.hasOwn(registry.environments, name) ? registry.environments[name] : null;
    if (!entry) throw new Error(`Unknown environment "${name}". Known: ${Object.keys(registry.environments).join(', ')}`);
    return { name, ...entry };
}

export function listEnvironments(registry, kind) {
    if (kind && !KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
    return Object.keys(registry.environments)
        .filter(name => !kind || registry.environments[name].kind === kind)
        .map(name => getEnvironment(registry, name));
}

// Which environment is this build for? APP_ENV names it. On the web host the
// build is also told the address it is publishing to (URL); with no APP_ENV
// that address picks the environment, and with one it must agree, so a site
// can never be published with another environment's connection. There is no
// default: an unknown site fails the build. A preview build (CONTEXT other
// than production) uses the `previews` environment when one is set.
export function resolveEnvironment(registry, env = process.env) {
    const named = (env.APP_ENV || '').trim();
    // The host may report the address with or without https; the host name is what identifies the site.
    let publishingTo = null;
    if (env.URL) {
        let reported = null;
        try { reported = new URL(env.URL); } catch { /* reported stays null */ }
        if (!reported || !/^https?:$/.test(reported.protocol) || !reported.host) throw new Error(`The web host reported an unusable site address: ${env.URL}`);
        publishingTo = reported.host;
    }
    const hostOf = entry => new URL(entry.siteUrl).host;
    let found;
    if (named) found = getEnvironment(registry, named);
    else if (publishingTo) {
        found = listEnvironments(registry).find(entry => hostOf(entry) === publishingTo);
        if (!found) throw new Error(`No environment in environments.json is published at ${publishingTo}. Add one, or set APP_ENV.`);
    } else throw new Error('Set APP_ENV to an environment in environments.json (for example APP_ENV=dev). There is no default.');
    if (publishingTo && hostOf(found) !== publishingTo) {
        throw new Error(`APP_ENV=${found.name} is published at ${found.siteUrl}, but this build is publishing to ${publishingTo}. Refusing to mix environments.`);
    }
    const preview = Boolean(env.CONTEXT) && env.CONTEXT !== 'production';
    if (preview && !named && registry.previews) return getEnvironment(registry, registry.previews);
    return found;
}

// The one file the pages read their connection from. `<` is escaped so no
// value can close the script tag it is loaded by.
export function renderConfigScript(environment) {
    const config = {
        environment: environment.name,
        kind: environment.kind,
        label: environment.label,
        siteUrl: environment.siteUrl,
        url: environment.databaseUrl,
        anonKey: environment.publicKey,
        defaultProjectId: environment.defaultProjectId,
        options: {
            auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
            realtime: { enabled: true },
        },
    };
    return `// Generated for the "${environment.name}" environment from environments.json. Do not edit.\n`
        + `window.SUPABASE_CONFIG = ${JSON.stringify(config, null, 2).replaceAll('<', '\\u003c')};\n`;
}

// Email templates are stored with a placeholder for the office site address
// and filled in per environment, because the sign-in service takes finished HTML.
export function renderEmailTemplate(source, environment) {
    if (!source.includes(SITE_PLACEHOLDER)) throw new Error('Email template has no site address placeholder');
    const rendered = source.replaceAll(SITE_PLACEHOLDER, environment.siteUrl);
    const left = rendered.match(/%[A-Z_]+%/);
    if (left) throw new Error(`Email template has an unknown placeholder: ${left[0]}`);
    return rendered;
}

export function renderEmailTemplates(environment, directory = join(root, 'supabase', 'templates')) {
    return Object.fromEntries(EMAIL_TEMPLATES.map(name => [
        name, renderEmailTemplate(readFileSync(join(directory, `${name}.html`), 'utf8'), environment),
    ]));
}

function option(args, flag) {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
}

function main(args) {
    const [command, ...rest] = args;
    const registry = loadEnvironments();
    const kind = option(rest, '--kind');
    if (command === 'check') {
        for (const entry of listEnvironments(registry)) console.log(`${entry.name}\t${entry.kind}\t${entry.siteUrl}`);
        return;
    }
    if (command === 'list') { for (const entry of listEnvironments(registry, kind)) console.log(entry.name); return; }
    if (command === 'matrix') {
        const include = listEnvironments(registry, kind).map(({ name, siteUrl, databaseUrl }) => ({ environment: name, siteUrl, databaseUrl }));
        console.log(JSON.stringify({ include }));
        return;
    }
    if (command === 'database') {
        // Prints the environment's kind when DATABASE_URL is that environment's database; fails otherwise.
        const environment = getEnvironment(registry, rest[0]);
        if (!databaseBelongsTo(environment, process.env.DATABASE_URL || '')) {
            throw new Error(`DATABASE_URL is not the "${environment.name}" database (${environment.databaseUrl}). Nothing was changed.`);
        }
        console.log(environment.kind);
        return;
    }
    if (command === 'config') {
        const environment = getEnvironment(registry, rest[0]);
        const target = resolve(option(rest, '--out') || join(root, 'supabase-config.js'));
        writeFileSync(target, renderConfigScript(environment));
        console.log(`Wrote ${target} for "${environment.name}" (${environment.kind}).`);
        return;
    }
    if (command === 'templates') {
        const environment = getEnvironment(registry, rest[0]);
        const directory = resolve(option(rest, '--out') || join(root, 'supabase', '.temp', 'email-templates', environment.name));
        mkdirSync(directory, { recursive: true });
        for (const [name, html] of Object.entries(renderEmailTemplates(environment))) writeFileSync(join(directory, `${name}.html`), html);
        console.log(`Wrote ${EMAIL_TEMPLATES.length} email templates for "${environment.name}" to ${directory}`);
        return;
    }
    throw new Error('Usage: environments.mjs check | list [--kind K] | matrix [--kind K] | config <name> [--out file] | templates <name> [--out dir] | database <name>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

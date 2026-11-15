import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// `expected` (optional) is the environment this site must be: its name, its own
// database address and every other environment's database address. A site
// that serves another environment's connection fails the check.
export async function smokeDeploy(base, expectedCommit, attempts = 1, expected = null) {
    const origin = new URL(base);
    if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))) throw new Error('Use HTTPS or a local test server');
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Supply only the site origin');
    if (!/^[a-f0-9]{40}$/.test(expectedCommit)) throw new Error('Expected commit must be a full Git SHA');
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 90) throw new Error('Attempts must be between 1 and 90');
    // Read the original HTTP entity with no intermediary fetch transformation.
    // Redirects are deliberately not followed; a login/SPA response must not pass.
    const get = path => new Promise((resolve, reject) => {
        const url = new URL(path, origin);
        const client = url.protocol === 'https:' ? https : http;
        const request = client.get(url, { signal: AbortSignal.timeout(10000), headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' } }, response => {
            const chunks = []; let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > 50 * 1024 * 1024) response.destroy(new Error('Asset exceeds smoke-test size limit'));
                else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
                const body = Buffer.concat(chunks), status = response.statusCode;
                resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(body.toString('utf8')), arrayBuffer: async () => body });
            });
        });
        request.on('error', reject);
    });
    let release;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await get(`/release.json?expected=${expectedCommit}`);
            release = response.ok ? await response.json() : null;
            if (release?.commit === expectedCommit) break;
        } catch { release = null; }
        if (attempt < attempts - 1) await delay(5000);
    }
    if (release?.commit !== expectedCommit) throw new Error('This commit is not deployed; refusing to pass an older release');
    const required = ['index.html', 'login.html', 'work-inbox.html', 'record.html', 'dashboard.js', 'work-pages.js', 'styles.css', 'js/utils/data-health.js', 'js/utils/work-summary.js', 'js/utils/pdf-export.js', 'js/utils/auth-guard.js', 'js/utils/project-scope.js'];
    for (const path of required) {
        if (!/^[a-f0-9]{64}$/.test(release.assets?.[path] || '')) throw new Error(`Missing release checksum: ${path}`);
        const response = await get(`/${path}?release=${expectedCommit}`);
        if (!response.ok) throw new Error(`Public asset unavailable: ${path}`);
        const body = Buffer.from(await response.arrayBuffer());
        if (createHash('sha256').update(body).digest('hex') !== release.assets[path]) throw new Error(`Deployed asset differs from release: ${path}`);
    }
    for (const path of ['/.env', '/sync_po_shipment_data.py', '/PO%20%26%20Shipment%20Log.xlsx', '/supabase/migrations/018_atomic_po_shipment_import.sql', '/dashboard_data/audit_data.json', '/tests/browser/backend.js', '/docs/MSR_NEXT_PHASES.md']) {
        const response = await get(path);
        if (response.status !== 404) throw new Error(`Private path must return 404: ${path} (${response.status})`);
    }
    if (expected) {
        if (release.environment !== expected.environment) throw new Error(`Site was built for "${release.environment}", expected "${expected.environment}"`);
        const response = await get(`/supabase-config.js?release=${expectedCommit}`);
        if (!response.ok) throw new Error('Connection settings unavailable: supabase-config.js');
        const config = Buffer.from(await response.arrayBuffer()).toString('utf8');
        if (!config.includes(JSON.stringify(expected.databaseUrl))) throw new Error(`Site does not connect to the "${expected.environment}" database`);
        for (const other of expected.otherDatabaseUrls || []) {
            if (config.includes(other)) throw new Error(`Site names another environment's database: ${other}`);
        }
    }
    return { commit: expectedCommit, assets: required.length, privatePaths: 7, ...(expected ? { environment: expected.environment } : {}) };
}

// Every environment in environments.json must be serving this commit with its
// own connection. Checked side by side; one failure fails the run.
export async function smokeDeployAll(environments, expectedCommit, attempts = 1, check = smokeDeploy) {
    const results = await Promise.allSettled(environments.map(environment => check(environment.siteUrl, expectedCommit, attempts, {
        environment: environment.name,
        databaseUrl: environment.databaseUrl,
        otherDatabaseUrls: environments.filter(other => other.name !== environment.name).map(other => other.databaseUrl),
    })));
    const failures = results.flatMap((result, index) => result.status === 'rejected' ? [`${environments[index].name}: ${result.reason.message}`] : []);
    if (failures.length) throw new Error(`Deployment check failed:\n  ${failures.join('\n  ')}`);
    return results.map(result => result.value);
}
// Usage: smoke-deploy.mjs <site origin> <commit> [attempts]
//        smoke-deploy.mjs --all <commit> [attempts]     every environment in environments.json
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [target, commit, attempts] = process.argv.slice(2);
    const run = target === '--all'
        ? import('./environments.mjs').then(({ loadEnvironments, listEnvironments }) => smokeDeployAll(listEnvironments(loadEnvironments()), commit, Number(attempts || 1)))
        : smokeDeploy(target, commit, Number(attempts || 1));
    run.then(result => console.log('Deployment verified:', JSON.stringify(result)))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}

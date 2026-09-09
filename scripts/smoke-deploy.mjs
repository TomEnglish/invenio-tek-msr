import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function smokeDeploy(base, expectedCommit, attempts = 1) {
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
    return { commit: expectedCommit, assets: required.length, privatePaths: 7 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    smokeDeploy(process.argv[2], process.argv[3], Number(process.argv[4] || 1))
        .then(result => console.log('Deployment verified:', JSON.stringify(result)))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { pathToFileURL } from 'node:url';

// Removes driver licences that are due: 365 days after a load closes, or after
// its last activity if it never closes, unless the office is keeping one
// (migrations 022 and 023). For each due load it deletes every file in the
// load's folder of the driver-licences bucket, then clears the licence number.
// Runs daily with the service role key; it prints load numbers and counts
// only, never file names or licence details.
export async function purgeDriverLicences({ url, key, fetchImpl = fetch, log = console.log }) {
    const base = new URL(url);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Use the project\'s HTTPS address');
    if (!key) throw new Error('A service role key is required');
    const origin = base.origin;
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const call = async (path, method, body) => {
        const response = await fetchImpl(`${origin}${path}`, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`${path.split('/').pop()} answered ${response.status}`);
        return response.status === 204 ? null : response.json();
    };
    const due = await call('/rest/v1/rpc/driver_licence_purge_queue', 'POST', {});
    const failed = [];
    let removed = 0;
    for (const load of due) {
        try {
            if (load.storage_paths?.length) await call('/storage/v1/object/driver-licences', 'DELETE', { prefixes: load.storage_paths });
            await call('/rest/v1/rpc/purge_driver_licence', 'POST', { p_load_id: load.load_id });
            removed += 1;
            log(`Removed the driver licence for load ${load.load_number}`);
        } catch (error) {
            failed.push(load.load_number);
            log(`Could not remove the driver licence for load ${load.load_number}: ${error.message}`);
        }
    }
    log(`${removed} of ${due.length} due driver licences removed`);
    if (failed.length) throw new Error(`Driver licences not removed for ${failed.join(', ')}`);
    return { due: due.length, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('::error::Add the SUPABASE_SERVICE_ROLE_KEY repository secret (and SUPABASE_URL, if the project moves) so expired driver licences are removed.');
        process.exitCode = 1;
    } else {
        purgeDriverLicences({ url, key }).catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
    }
}

const test = require('node:test');
const assert = require('node:assert/strict');

// A stand-in for the Supabase REST and Storage endpoints the job calls.
function fakeSupabase({ queue, failStorageFor = [] }) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const path = new URL(url).pathname, body = JSON.parse(options.body);
        calls.push({ path, method: options.method, body, auth: options.headers.Authorization });
        const reply = (status, json) => ({ ok: status < 300, status, json: async () => json });
        if (path === '/rest/v1/rpc/driver_licence_purge_queue') return reply(200, queue);
        if (path === '/storage/v1/object/driver-licences') {
            return body.prefixes.some(name => failStorageFor.some(id => name.startsWith(id))) ? reply(500, {}) : reply(200, []);
        }
        if (path === '/rest/v1/rpc/purge_driver_licence') return reply(200, { load_id: body.p_load_id, licence_removed: true });
        return reply(404, {});
    };
    return { calls, fetchImpl };
}

test('each due load has its files deleted before its licence is cleared, and nothing private is printed', async () => {
    const { purgeDriverLicences } = await import('../scripts/purge-driver-licences.mjs');
    const queue = [
        { load_id: 'a1', load_number: 'L-0001', storage_paths: ['a1/front.jpg', 'a1/stray.jpg'] },
        { load_id: 'b2', load_number: 'L-0002', storage_paths: [] },
    ];
    const { calls, fetchImpl } = fakeSupabase({ queue });
    const lines = [];
    const result = await purgeDriverLicences({ url: 'https://example.supabase.co/', key: 'service-key', fetchImpl, log: line => lines.push(line) });
    assert.deepEqual(result, { due: 2, removed: 2 });
    assert.deepEqual(calls.map(call => [call.method, call.path]), [
        ['POST', '/rest/v1/rpc/driver_licence_purge_queue'],
        ['DELETE', '/storage/v1/object/driver-licences'], ['POST', '/rest/v1/rpc/purge_driver_licence'],
        ['POST', '/rest/v1/rpc/purge_driver_licence']]);
    assert.deepEqual(calls[1].body, { prefixes: ['a1/front.jpg', 'a1/stray.jpg'] });
    assert.ok(calls.every(call => call.auth === 'Bearer service-key'));
    assert.ok(lines.every(line => !line.includes('.jpg')), 'file names are never printed');
});

test('a load whose files could not be deleted keeps its licence and fails the run, after the others are done', async () => {
    const { purgeDriverLicences } = await import('../scripts/purge-driver-licences.mjs');
    const queue = [
        { load_id: 'a1', load_number: 'L-0001', storage_paths: ['a1/front.jpg'] },
        { load_id: 'b2', load_number: 'L-0002', storage_paths: ['b2/front.jpg'] },
    ];
    const { calls, fetchImpl } = fakeSupabase({ queue, failStorageFor: ['a1'] });
    await assert.rejects(purgeDriverLicences({ url: 'https://example.supabase.co', key: 'k', fetchImpl, log: () => {} }), /L-0001/);
    assert.deepEqual(calls.filter(call => call.path.endsWith('purge_driver_licence')).map(call => call.body.p_load_id), ['b2']);
});

test('the job refuses a plain-HTTP project address', async () => {
    const { purgeDriverLicences } = await import('../scripts/purge-driver-licences.mjs');
    await assert.rejects(purgeDriverLicences({ url: 'http://example.supabase.co', key: 'k', fetchImpl: async () => assert.fail('no request') }), /HTTPS/);
});

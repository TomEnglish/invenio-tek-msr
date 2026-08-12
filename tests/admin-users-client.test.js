const assert = require('node:assert/strict');
const { createAdminUsersClient } = require('../js/utils/admin-users-client');

async function run() {
const requests = [];
const client = createAdminUsersClient({
  supabaseClient: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
  functionUrl: 'https://example.test/functions/v1/admin-users',
  anonKey: 'test-anon-key',
  fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({ data: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } }),
    };
  },
});

await client.listUsers({ page: 2, pageSize: 25, search: 'field user' });
await client.listProjects();
await client.inviteUser({
  email: 'user@example.com',
  fullName: 'Field User',
  role: 'field_worker',
  projectIds: [],
});
await client.updateUser({ userId: 'user-id', isActive: false });

assert.deepEqual(requests, [
  {
    url: 'https://example.test/functions/v1/admin-users?page=2&pageSize=25&search=field+user',
    options: {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-token',
        apikey: 'test-anon-key',
        'Content-Type': 'application/json',
      },
    },
  },
  {
    url: 'https://example.test/functions/v1/admin-users?resource=projects',
    options: {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-token',
        apikey: 'test-anon-key',
        'Content-Type': 'application/json',
      },
    },
  },
  {
    url: 'https://example.test/functions/v1/admin-users',
    options: {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        apikey: 'test-anon-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'invite',
        email: 'user@example.com',
        fullName: 'Field User',
        role: 'field_worker',
        projectIds: [],
      }),
    },
  },
  {
    url: 'https://example.test/functions/v1/admin-users',
    options: {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-token',
        apikey: 'test-anon-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user-id', isActive: false }),
    },
  },
]);

console.log('admin users client tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

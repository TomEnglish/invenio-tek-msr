import { handle } from '../supabase/functions/admin-users/index.ts';

type Clients = NonNullable<Parameters<typeof handle>[1]>;
type Row = Record<string, unknown>;
const ADMIN = 'a1111111-1111-4111-8111-111111111111';
const TARGET = 'f1111111-1111-4111-8111-111111111111';
const PROJECT = 'b1111111-1111-4111-8111-111111111111';
const VERSION = '2026-09-09T01:00:00.000Z';

function equal(actual: unknown, expected: unknown, label = 'Unexpected value') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function profile(id: string, overrides: Row = {}): Row {
  return {
    id, email: id === ADMIN ? 'admin@example.test' : 'worker@example.test',
    full_name: id === ADMIN ? 'Administrator' : 'Field Worker',
    role: id === ADMIN ? 'admin' : 'field_worker', is_active: true,
    invitation_status: 'accepted', invitation_expires_at: null,
    created_at: VERSION, updated_at: VERSION, ...overrides,
  };
}

function setup(options: { actor?: Row | null; target?: Row; authError?: boolean; rpcError?: { code: string; message: string } } = {}) {
  const actor = options.actor === undefined ? profile(ADMIN) : options.actor;
  const target = profile(TARGET, options.target);
  const tables: Record<string, Row[]> = {
    users: [actor, target].filter((row): row is Row => row !== null),
    user_projects: [{ user_id: TARGET, project_id: PROJECT }],
    projects: [{ id: PROJECT, name: 'Main Yard', status: 'active' }],
    user_admin_audit: [],
  };
  const calls = {
    rpc: [] as { name: string; args: Row }[],
    queries: [] as { table: string; steps: unknown[][] }[],
    mail: [] as { kind: string; email: string }[],
  };

  // This is an in-memory service boundary, not a replacement handler: the real
  // handler performs authorization, validation, routing, mapping, and errors.
  class Query {
    table: string;
    steps: unknown[][] = [];
    predicates: ((row: Row) => boolean)[] = [];
    bounds: [number, number] | null = null;
    constructor(table: string) {
      this.table = table;
      calls.queries.push({ table, steps: this.steps });
    }
    select(...args: unknown[]) { this.steps.push(['select', ...args]); return this; }
    eq(key: string, value: unknown) {
      this.steps.push(['eq', key, value]);
      this.predicates.push(key === 'user_projects.project_id'
        ? (row) => tables.user_projects.some((membership) => membership.user_id === row.id && membership.project_id === value)
        : (row) => row[key] === value);
      return this;
    }
    in(key: string, values: unknown[]) {
      this.steps.push(['in', key, values]);
      this.predicates.push((row) => values.includes(row[key]));
      return this;
    }
    lt(key: string, value: string) {
      this.steps.push(['lt', key, value]);
      this.predicates.push((row) => typeof row[key] === 'string' && String(row[key]) < value);
      return this;
    }
    or(expression: string) { this.steps.push(['or', expression]); return this; }
    order(...args: unknown[]) { this.steps.push(['order', ...args]); return this; }
    range(from: number, to: number) { this.steps.push(['range', from, to]); this.bounds = [from, to]; return this; }
    returns() { return this; }
    result() {
      const rows = tables[this.table].filter((row) => this.predicates.every((predicate) => predicate(row)));
      const data = this.bounds ? rows.slice(this.bounds[0], this.bounds[1] + 1) : rows;
      return { data, count: rows.length, error: null };
    }
    maybeSingle() { return Promise.resolve({ data: this.result().data[0] ?? null, error: null }); }
    then(resolve: (value: ReturnType<Query['result']>) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }

  const clients = {
    userClient: { auth: { getUser: async () => options.authError
      ? { data: { user: null }, error: { message: 'Invalid token' } }
      : { data: { user: { id: ADMIN } }, error: null } } },
    adminClient: {
      from: (table: string) => new Query(table),
      rpc: async (name: string, args: Row) => {
        calls.rpc.push({ name, args });
        if (options.rpcError) return { data: null, error: options.rpcError };
        const row = tables.users.find((candidate) => candidate.id === args.p_target);
        if (!row) throw new Error('Test fixture target not found');
        Object.assign(row, args.p_changes);
        if (Array.isArray(args.p_projects)) {
          tables.user_projects = tables.user_projects.filter((membership) => membership.user_id !== row.id);
          tables.user_projects.push(...args.p_projects.map((projectId) => ({ user_id: row.id, project_id: projectId })));
        }
        return { data: { ...row }, error: null };
      },
      auth: {
        admin: {
          getUserById: async (id: string) => ({ data: { user: { id, last_sign_in_at: VERSION, email_confirmed_at: null } }, error: null }),
          inviteUserByEmail: async (email: string) => { calls.mail.push({ kind: 'invite', email }); return { error: null }; },
        },
        resetPasswordForEmail: async (email: string) => { calls.mail.push({ kind: 'reset', email }); return { error: null }; },
      },
    },
  } as unknown as Clients;
  return { clients, calls, tables };
}

function request(method = 'GET', body?: unknown, query = '') {
  return new Request(`https://example.test/functions/v1/admin-users${query}`, {
    method, headers: { Authorization: 'Bearer verified-test-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

Deno.test('missing and malformed bearer headers return 401 before creating network clients', async () => {
  const environment = {
    SUPABASE_URL: 'https://example.test',
    SUPABASE_ANON_KEY: 'dummy-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-service',
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, Deno.env.get(key)]));
  try {
    for (const [key, value] of Object.entries(environment)) Deno.env.set(key, value);
    for (const authorization of [null, 'Basic unsupported', 'Bearer']) {
      const response = await handle(new Request('https://example.test/admin-users', {
        headers: authorization ? { Authorization: authorization } : {},
      }));
      equal(response.status, 401);
      equal((await response.json()).error.code, 'UNAUTHENTICATED');
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});

Deno.test('token rejected by Auth returns 401 without accessing privileged profile data', async () => {
  const { clients, calls } = setup({ authError: true });
  const response = await handle(request(), clients);
  equal(response.status, 401);
  equal((await response.json()).error.code, 'UNAUTHENTICATED');
  equal(calls.queries.length, 0);
  equal(calls.rpc.length, 0);
});

for (const [label, actor] of [
  ['field worker', profile(ADMIN, { role: 'field_worker' })],
  ['office staff', profile(ADMIN, { role: 'office_staff' })],
  ['inactive admin', profile(ADMIN, { is_active: false })],
  ['pending admin', profile(ADMIN, { invitation_status: 'pending' })],
  ['missing profile', null],
] as const) {
  Deno.test(`${label} is denied user administration before mutation`, async () => {
    const { clients, calls } = setup({ actor });
    const response = await handle(request('PATCH', { userId: TARGET, role: 'admin' }), clients);
    equal(response.status, 403);
    equal((await response.json()).error.code, 'FORBIDDEN');
    equal(calls.rpc.length, 0);
    equal(calls.mail.length, 0);
  });
}

Deno.test('admin update passes verified actor, version and assignments through one transactional RPC', async () => {
  const { clients, calls } = setup();
  const response = await handle(request('PATCH', {
    userId: TARGET, actorId: TARGET, fullName: ' Updated Name ', role: 'office_staff', isActive: false,
    projectIds: [], expectedUpdatedAt: VERSION,
  }), clients);
  equal(response.status, 200);
  equal(calls.rpc, [{ name: 'admin_update_user', args: {
    p_actor: ADMIN, p_target: TARGET,
    p_changes: { full_name: 'Updated Name', role: 'office_staff', is_active: false },
    p_projects: [], p_expected_updated_at: VERSION,
  } }]);
  const body = await response.json();
  equal(body.data.id, TARGET);
  equal(body.data.fullName, 'Updated Name');
  equal(body.data.projectIds, []);
  equal(calls.mail.length, 0);
});

for (const [databaseCode, message, publicCode] of [
  ['40001', 'Stale profile', 'STALE_USER'],
  ['23514', 'The last active administrator cannot be removed', 'LAST_ADMIN'],
]) {
  Deno.test(`${databaseCode} RPC rejection is caught and returned as HTTP 409 ${publicCode}`, async () => {
    const { clients, calls } = setup({ rpcError: { code: databaseCode, message } });
    const response = await handle(request('PATCH', { userId: TARGET, isActive: false }), clients);
    equal(response.status, 409);
    equal((await response.json()).error.code, publicCode);
    equal(calls.rpc.length, 1);
  });
}

for (const [query, code] of [
  ['?role=super_admin', 'INVALID_ROLE'],
  ['?status=unknown', 'INVALID_STATUS'],
  ['?projectId=not-a-uuid', 'INVALID_PROJECT_ID'],
]) {
  Deno.test(`invalid list filter ${query} returns 422 before listing identities`, async () => {
    const { clients, calls } = setup();
    const response = await handle(request('GET', undefined, query), clients);
    equal(response.status, 422);
    equal((await response.json()).error.code, code);
    equal(calls.queries.length, 1, 'Only the verified actor profile should be read');
  });
}

Deno.test('valid directory filters select matching users and retain pagination and named profile fields', async () => {
  const { clients, calls } = setup({ target: { role: 'office_staff' } });
  const response = await handle(request('GET', undefined, `?role=office_staff&status=active&projectId=${PROJECT}&pageSize=20`), clients);
  equal(response.status, 200);
  const body = await response.json();
  equal(body.data.map((row: Row) => row.id), [TARGET]);
  equal(body.data[0].projectIds, [PROJECT]);
  equal(body.data[0].lastSignInAt, VERSION);
  equal(body.pagination, { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
  const listing = calls.queries.find((query) => query.table === 'users' && query.steps.some((step) => step[0] === 'range'));
  equal(listing?.steps.filter((step) => step[0] === 'eq'), [
    ['eq', 'role', 'office_staff'], ['eq', 'user_projects.project_id', PROJECT],
    ['eq', 'is_active', true], ['eq', 'invitation_status', 'accepted'],
  ]);
});

for (const action of ['resend_invite', 'cancel_invite']) {
  for (const status of ['accepted', 'cancelled']) {
    Deno.test(`${action} rejects a ${status} invitation without RPC or email`, async () => {
      const { clients, calls } = setup({ target: { invitation_status: status } });
      const response = await handle(request('POST', { action, userId: TARGET }), clients);
      equal(response.status, 409);
      equal((await response.json()).error.code, 'INVITE_NOT_PENDING');
      equal(calls.rpc.length, 0);
      equal(calls.mail.length, 0);
    });
  }
}

Deno.test('cancelling a pending invitation atomically removes project access and deactivates profile', async () => {
  const { clients, calls } = setup({ target: { invitation_status: 'pending', invitation_expires_at: '2020-01-01T00:00:00Z' } });
  const response = await handle(request('POST', { action: 'cancel_invite', userId: TARGET }), clients);
  equal(response.status, 200);
  equal(calls.rpc, [{ name: 'admin_update_user', args: {
    p_actor: ADMIN, p_target: TARGET, p_changes: { invitation_status: 'cancelled', is_active: false },
    p_projects: [], p_expected_updated_at: null,
  } }]);
  const body = await response.json();
  equal(body.data.invitationStatus, 'cancelled');
  equal(body.data.isActive, false);
  equal(body.data.projectIds, []);
  equal(calls.mail.length, 0);
});

Deno.test('resending an expired pending invitation refreshes expiry and uses a stubbed mail boundary', async () => {
  const { clients, calls } = setup({ target: { invitation_status: 'pending', invitation_expires_at: '2020-01-01T00:00:00Z' } });
  const response = await handle(request('POST', { action: 'resend_invite', userId: TARGET }), clients);
  equal(response.status, 200);
  equal(calls.rpc.length, 1);
  equal(calls.rpc[0].args.p_actor, ADMIN);
  const changes = calls.rpc[0].args.p_changes as Row;
  equal(changes.invitation_status, 'pending');
  equal(changes.is_active, true);
  if (!(Date.parse(String(changes.invitation_expires_at)) > Date.now())) throw new Error('Expiry was not renewed');
  equal(calls.mail, [{ kind: 'invite', email: 'worker@example.test' }]);
});

Deno.test('disabled invitation email reports capability and rejects sends before mutation', async () => {
  const previous = Deno.env.get('INVITATION_EMAIL_ENABLED');
  Deno.env.set('INVITATION_EMAIL_ENABLED', 'false');
  try {
    const { clients, calls } = setup();
    const listing = await handle(request(), clients);
    equal((await listing.json()).capabilities, { invitationEmailEnabled: false });
    for (const action of ['invite', 'resend_invite']) {
      const result = await handle(request('POST', { action, userId: TARGET }), clients);
      equal(result.status, 503);
      equal((await result.json()).error.code, 'EMAIL_NOT_CONFIGURED');
    }
    equal(calls.rpc.length, 0);
    equal(calls.mail.length, 0);
  } finally {
    if (previous === undefined) Deno.env.delete('INVITATION_EMAIL_ENABLED');
    else Deno.env.set('INVITATION_EMAIL_ENABLED', previous);
  }
});

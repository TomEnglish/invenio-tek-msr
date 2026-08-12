import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import {
  parseListParams,
  validateInviteInput,
  validateUpdateInput,
  type InviteInput,
  type UpdateInput,
  type UserRole,
  ValidationError,
} from './validation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://invenio-field-msr.netlify.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type Project = { id: string; name: string; status: string };

type AdminUserRecord = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
  projectIds: string[];
};

type AppError = { status: number; code: string; message: string };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: AppError): Response {
  return json({ error: { code: error.code, message: error.message } }, error.status);
}

function getSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw { status: 401, code: 'UNAUTHENTICATED', message: 'A valid session is required' } satisfies AppError;
  return match[1];
}

function createClients(request: Request): { userClient: SupabaseClient; adminClient: SupabaseClient } {
  const url = getSecret('SUPABASE_URL');
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (!secretKey) throw new Error('Supabase secret key is not configured');

  const token = getBearerToken(request);
  const userClient = createClient(url, getSecret('SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return { userClient, adminClient };
}

async function requireAdmin(request: Request, userClient: SupabaseClient, adminClient: SupabaseClient): Promise<Profile> {
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    throw { status: 401, code: 'UNAUTHENTICATED', message: 'A valid session is required' } satisfies AppError;
  }

  const { data: profile, error: profileError } = await adminClient
    .from('users')
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile || profile.is_active !== true || profile.role !== 'admin') {
    throw { status: 403, code: 'FORBIDDEN', message: 'Administrator access is required' } satisfies AppError;
  }
  return profile as Profile;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('INVALID_BODY', 'Request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

async function fetchProfiles(
  adminClient: SupabaseClient,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ profiles: Profile[]; totalItems: number }> {
  let query = adminClient
    .from('users')
    .select('id, email, full_name, role, is_active, created_at, updated_at', { count: 'exact' });

  if (search) {
    const escaped = search.replace(/[%_,]/g, (character) => `\\${character}`);
    query = query.or(`email.ilike.%${escaped}%,full_name.ilike.%${escaped}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);
  if (error) throw new Error(error.message);

  return { profiles: (data || []) as Profile[], totalItems: count || 0 };
}

async function fetchProjects(adminClient: SupabaseClient, userIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (userIds.length === 0) return result;

  const { data, error } = await adminClient
    .from('user_projects')
    .select('user_id, project_id')
    .in('user_id', userIds);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    const current = result.get(row.user_id) || [];
    current.push(row.project_id);
    result.set(row.user_id, current);
  }
  return result;
}

async function fetchProjectIds(adminClient: SupabaseClient, projectIds: string[]): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const { data, error } = await adminClient.from('projects').select('id').in('id', projectIds);
  if (error) throw new Error(error.message);
  const found = new Set((data || []).map((project) => project.id));
  if (projectIds.some((projectId) => !found.has(projectId))) {
    throw { status: 404, code: 'PROJECT_NOT_FOUND', message: 'One or more selected projects were not found' } satisfies AppError;
  }
  return projectIds;
}

function toRecord(profile: Profile, lastSignInAt: string | null, projectIds: string[]): AdminUserRecord {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    isActive: profile.is_active,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    lastSignInAt,
    projectIds,
  };
}

async function getAuthUsers(adminClient: SupabaseClient, profiles: Profile[]): Promise<Map<string, User>> {
  const users = new Map<string, User>();
  for (const profile of profiles) {
    const { data, error } = await adminClient.auth.admin.getUserById(profile.id);
    if (!error && data.user) users.set(profile.id, data.user);
  }
  return users;
}

async function listUsers(adminClient: SupabaseClient, request: Request): Promise<Response> {
  const params = parseListParams(new URL(request.url));
  const { profiles, totalItems } = await fetchProfiles(adminClient, params.page, params.pageSize, params.search);
  const projectMap = await fetchProjects(adminClient, profiles.map((profile) => profile.id));
  const authUsers = await getAuthUsers(adminClient, profiles);

  const data = profiles.map((profile) => toRecord(
    profile,
    authUsers.get(profile.id)?.last_sign_in_at || null,
    projectMap.get(profile.id) || [],
  ));

  return json({
    data,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
    },
  });
}

async function audit(adminClient: SupabaseClient, actorUserId: string, targetUserId: string | null, action: string, details: Record<string, unknown>) {
  const { error } = await adminClient.from('user_admin_audit').insert({
    actor_user_id: actorUserId,
    target_user_id: targetUserId,
    action,
    details,
  });
  if (error) throw new Error(error.message);
}

async function inviteUser(adminClient: SupabaseClient, actor: Profile, input: InviteInput): Promise<Response> {
  const projectIds = await fetchProjectIds(adminClient, input.projectIds);
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(input.email, {
    data: { full_name: input.fullName },
    redirectTo: 'https://invenio-field-msr.netlify.app/login.html',
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      throw { status: 409, code: 'USER_EXISTS', message: 'A user with that email already exists' } satisfies AppError;
    }
    throw new Error(error.message);
  }
  if (!data.user) throw new Error('Auth provider did not return the invited user');

  const { data: profile, error: profileError } = await adminClient
    .from('users')
    .update({ full_name: input.fullName, role: input.role, is_active: true })
    .eq('id', data.user.id)
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .single();
  if (profileError || !profile) throw new Error(profileError?.message || 'Invited profile was not created');

  await replaceMemberships(adminClient, data.user.id, projectIds);
  await audit(adminClient, actor.id, data.user.id, 'invite', { role: input.role, projectCount: projectIds.length });
  return json({ data: toRecord(profile as Profile, data.user.last_sign_in_at || null, projectIds) }, 201);
}

async function replaceMemberships(adminClient: SupabaseClient, userId: string, projectIds: string[]) {
  const { error: deleteError } = await adminClient.from('user_projects').delete().eq('user_id', userId);
  if (deleteError) throw new Error(deleteError.message);
  if (projectIds.length === 0) return;

  const { error: insertError } = await adminClient.from('user_projects').insert(
    projectIds.map((projectId) => ({ user_id: userId, project_id: projectId })),
  );
  if (insertError) throw new Error(insertError.message);
}

async function updateUser(adminClient: SupabaseClient, actor: Profile, input: UpdateInput): Promise<Response> {
  const { data: existing, error: existingError } = await adminClient
    .from('users')
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .eq('id', input.userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw { status: 404, code: 'USER_NOT_FOUND', message: 'User was not found' } satisfies AppError;

  const projectIds = input.projectIds === undefined
    ? (await fetchProjects(adminClient, [input.userId])).get(input.userId) || []
    : await fetchProjectIds(adminClient, input.projectIds);

  const changes: Record<string, unknown> = {};
  if (input.fullName !== undefined) changes.full_name = input.fullName;
  if (input.role !== undefined) changes.role = input.role;
  if (input.isActive !== undefined) changes.is_active = input.isActive;

  if (Object.keys(changes).length > 0) {
    const { error } = await adminClient.from('users').update(changes).eq('id', input.userId);
    if (error) {
      if (/last active administrator|last administrator/i.test(error.message)) {
        throw { status: 409, code: 'LAST_ADMIN', message: 'The last active administrator cannot be demoted or deactivated' } satisfies AppError;
      }
      throw new Error(error.message);
    }
  }
  if (input.projectIds !== undefined) await replaceMemberships(adminClient, input.userId, projectIds);

  const { data: updated, error: updatedError } = await adminClient
    .from('users')
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .eq('id', input.userId)
    .single();
  if (updatedError || !updated) throw new Error(updatedError?.message || 'Updated user was not returned');

  if (input.isActive === false) {
    const { error } = await adminClient.auth.admin.signOut(input.userId, 'global');
    if (error) throw new Error(error.message);
  }

  await audit(adminClient, actor.id, input.userId, input.isActive === false ? 'deactivate' : input.isActive === true ? 'activate' : 'update', {
    changedFields: Object.keys(changes),
    projectCount: input.projectIds === undefined ? undefined : projectIds.length,
  });

  const { data: authUser } = await adminClient.auth.admin.getUserById(input.userId);
  return json({ data: toRecord(updated as Profile, authUser.user?.last_sign_in_at || null, projectIds) });
}

async function handle(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    return errorResponse({ status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  }

  try {
    const { userClient, adminClient } = createClients(request);
    const actor = await requireAdmin(request, userClient, adminClient);

    if (request.method === 'GET') return await listUsers(adminClient, request);
    const body = asRecord(await request.json());

    if (request.method === 'POST') {
      if (body.action !== 'invite') {
        throw new ValidationError('INVALID_ACTION', 'POST action must be invite');
      }
      return await inviteUser(adminClient, actor, validateInviteInput(body));
    }

    return await updateUser(adminClient, actor, validateUpdateInput(body));
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse({ status: 422, code: error.code, message: error.message });
    }
    if (error && typeof error === 'object' && 'status' in error && 'code' in error && 'message' in error) {
      return errorResponse(error as AppError);
    }
    console.error('admin-users function error', error instanceof Error ? error.message : error);
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Unable to complete user-management request' });
  }
}

Deno.serve(handle);

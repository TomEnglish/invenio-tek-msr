import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import {
  parseListParams,
  isUuid,
  validateInviteInput,
  validateUpdateInput,
  type InviteInput,
  type UpdateInput,
  type UserRole,
  ValidationError,
} from './validation.ts';

const PROFILE_FIELDS = 'id, email, full_name, role, is_active, created_at, updated_at, invitation_status, invitation_expires_at';

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
  invitation_status: string;
  invitation_expires_at: string | null;
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
  invitationStatus: string;
  invitationExpiresAt: string | null;
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
    .select(PROFILE_FIELDS)
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile || profile.is_active !== true || profile.role !== 'admin' || profile.invitation_status !== 'accepted') {
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
  filters: ReturnType<typeof parseListParams>,
): Promise<{ profiles: Profile[]; totalItems: number }> {
  let query = adminClient
    .from('users')
    .select(PROFILE_FIELDS + (filters.projectId ? ',user_projects!inner(project_id)' : ''), { count: 'exact' });
  if (filters.role) query = query.eq('role', filters.role);
  if (filters.projectId) query = query.eq('user_projects.project_id', filters.projectId);
  if (filters.status === 'active') query = query.eq('is_active', true).eq('invitation_status', 'accepted');
  if (filters.status === 'inactive') query = query.eq('is_active', false);
  if (filters.status === 'cancelled') query = query.eq('invitation_status', 'cancelled');
  if (filters.status === 'pending') query = query.eq('invitation_status', 'pending').or(`invitation_expires_at.is.null,invitation_expires_at.gte.${new Date().toISOString()}`);
  if (filters.status === 'expired') query = query.eq('invitation_status', 'pending').lt('invitation_expires_at', new Date().toISOString());

  if (search) {
    // Keep the PostgREST OR expression grammar out of the user-controlled
    // value. Search is convenience filtering, not a free-form query language.
    const safeSearch = search.replace(/[^a-zA-Z0-9@' -]/g, '').trim();
    if (safeSearch) query = query.or(`email.ilike.%${safeSearch}%,full_name.ilike.%${safeSearch}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to).returns<Profile[]>();
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
    invitationStatus: profile.invitation_status,
    invitationExpiresAt: profile.invitation_expires_at,
  };
}

async function getAuthUsers(adminClient: SupabaseClient, profiles: Profile[]): Promise<Map<string, User>> {
  const users = new Map<string, User>();
  // Bound concurrent Auth requests; a directory page must not make 100 serial round trips.
  for (let offset = 0; offset < profiles.length; offset += 10) {
    await Promise.all(profiles.slice(offset, offset + 10).map(async (profile) => {
      const { data, error } = await adminClient.auth.admin.getUserById(profile.id);
      if (!error && data.user) users.set(profile.id, data.user);
    }));
  }
  return users;
}

async function listUsers(adminClient: SupabaseClient, request: Request): Promise<Response> {
  const params = parseListParams(new URL(request.url));
  const { profiles, totalItems } = await fetchProfiles(adminClient, params.page, params.pageSize, params.search, params);
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

async function listProjects(adminClient: SupabaseClient): Promise<Response> {
  const { data, error } = await adminClient
    .from('projects')
    .select('id, name, description, status')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);

  return json({ data: (data || []) as Project[] });
}

function databaseError(error: { code?: string; message: string }): never {
  if (error.code === '40001') throw { status: 409, code: 'STALE_USER', message: 'This user changed. Refresh and review the latest values.' };
  if (error.code === '23514' && /last active administrator/i.test(error.message)) {
    throw { status: 409, code: 'LAST_ADMIN', message: 'The last active administrator cannot be removed.' };
  }
  if (error.code === '42501') throw { status: 403, code: 'FORBIDDEN', message: 'Administrator access is required.' };
  if (error.code === 'P0002') throw { status: 404, code: 'NOT_FOUND', message: 'The requested record no longer exists.' };
  throw new Error(error.message);
}

async function saveProfile(adminClient: SupabaseClient, actor: Profile, userId: string,
  changes: Record<string, unknown>, projects?: string[], expectedUpdatedAt?: string): Promise<Profile> {
  const { data, error } = await adminClient.rpc('admin_update_user', {
    p_actor: actor.id, p_target: userId, p_changes: changes,
    p_projects: projects ?? null, p_expected_updated_at: expectedUpdatedAt ?? null,
  });
  if (error) databaseError(error);
  return data as Profile;
}

async function profileResponse(adminClient: SupabaseClient, profile: Profile, status = 200) {
  const memberships = await fetchProjects(adminClient, [profile.id]);
  return json({ data: toRecord(profile, null, memberships.get(profile.id) || []) }, status);
}

async function sendInvitation(adminClient: SupabaseClient, actor: Profile, profile: Profile, action: 'invite' | 'resend_invite') {
  const { data: authUser, error: lookupError } = await adminClient.auth.admin.getUserById(profile.id);
  if (lookupError) throw new Error(lookupError.message);
  const seconds = Number(Deno.env.get('INVITATION_TTL_SECONDS') || 3600);
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 604800) throw new Error('Invalid invitation expiry configuration');
  const updated = await saveProfile(adminClient, actor, profile.id, {
    invitation_status: 'pending', is_active: true,
    invitation_expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
  });
  const redirectTo = 'https://invenio-field-msr.netlify.app/login.html?setup=invite';
  const { error } = authUser.user?.email_confirmed_at
    ? await adminClient.auth.resetPasswordForEmail(profile.email, { redirectTo })
    : await adminClient.auth.admin.inviteUserByEmail(profile.email, { data: { full_name: profile.full_name }, redirectTo });
  if (error) {
    console.error('Invitation email failed', action, error.message);
    throw { status: 502, code: 'INVITE_DELIVERY_FAILED', message: 'The account and assignments are saved, but the email could not be sent. Refresh the directory and use Resend invitation.' };
  }
  return profileResponse(adminClient, updated, action === 'invite' ? 201 : 200);
}

async function inviteUser(adminClient: SupabaseClient, actor: Profile, input: InviteInput): Promise<Response> {
  const projects = await fetchProjectIds(adminClient, input.projectIds);
  // Create an unconfirmed identity first. Membership setup can then succeed
  // before mail is sent; a partial failure leaves a visible recoverable account.
  const { data, error } = await adminClient.auth.admin.createUser({
    email: input.email, email_confirm: false, user_metadata: { full_name: input.fullName },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) throw { status: 409, code: 'USER_EXISTS', message: 'This account already exists. Find it in the directory to edit or resend its invitation.' };
    throw new Error(error.message);
  }
  if (!data.user) throw new Error('Auth provider did not return a user');
  const profile = await saveProfile(adminClient, actor, data.user.id, { full_name: input.fullName, role: input.role }, projects);
  return sendInvitation(adminClient, actor, profile, 'invite');
}

async function invitationAction(adminClient: SupabaseClient, actor: Profile, body: Record<string, unknown>) {
  const userId = String(body.userId || '');
  if (!isUuid(userId)) throw new ValidationError('INVALID_USER_ID', 'Invalid user id');
  const { data, error } = await adminClient.from('users').select(PROFILE_FIELDS).eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const profile = data as Profile | null;
  if (!profile) throw { status: 404, code: 'NOT_FOUND', message: 'User not found.' };
  if (profile.invitation_status !== 'pending') throw { status: 409, code: 'INVITE_NOT_PENDING', message: 'Only a pending or expired invitation can be changed.' };
  if (body.action === 'resend_invite') return sendInvitation(adminClient, actor, profile, 'resend_invite');
  const updated = await saveProfile(adminClient, actor, userId, { invitation_status: 'cancelled', is_active: false }, []);
  return profileResponse(adminClient, updated);
}

async function updateUser(adminClient: SupabaseClient, actor: Profile, input: UpdateInput): Promise<Response> {
  const changes: Record<string, unknown> = {};
  if (input.fullName !== undefined) changes.full_name = input.fullName;
  if (input.role !== undefined) changes.role = input.role;
  if (input.isActive !== undefined) changes.is_active = input.isActive;
  const profile = await saveProfile(adminClient, actor, input.userId, changes, input.projectIds, input.expectedUpdatedAt);
  return profileResponse(adminClient, profile);
}

async function listAudit(adminClient: SupabaseClient, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = parseListParams(url);
  let query = adminClient.from('user_admin_audit').select('*', { count: 'exact' });
  const target = url.searchParams.get('userId');
  if (target) {
    if (!isUuid(target)) throw new ValidationError('INVALID_USER_ID', 'Invalid user id');
    query = query.eq('target_user_id', target);
  }
  const { data, error, count } = await query.order('created_at', { ascending: false })
    .range((params.page - 1) * params.pageSize, params.page * params.pageSize - 1);
  if (error) throw new Error(error.message);
  const ids = [...new Set((data || []).flatMap(row => [row.actor_user_id, row.target_user_id]).filter(Boolean))];
  const { data: people, error: peopleError } = await adminClient.from('users').select('id,full_name,email').in('id', ids);
  if (peopleError) throw new Error(peopleError.message);
  const names = new Map((people || []).map(p => [p.id, p.full_name || p.email]));
  return json({ data: (data || []).map(row => ({ ...row, actorName: names.get(row.actor_user_id) || 'Former user', targetName: names.get(row.target_user_id) || 'Project' })),
    pagination: { page: params.page, totalPages: Math.max(1, Math.ceil((count || 0) / params.pageSize)) } });
}

async function saveProject(adminClient: SupabaseClient, actor: Profile, body: Record<string, unknown>) {
  const name = String(body.name || '').trim();
  const status = String(body.status || 'active');
  const id = body.projectId ? String(body.projectId) : null;
  if (!name || name.length > 120 || !['active', 'completed', 'archived'].includes(status) || (id && !isUuid(id))) {
    throw new ValidationError('INVALID_PROJECT', 'Provide a name (up to 120 characters), valid status, and project id.');
  }
  const description = String(body.description || '').trim();
  if (description.length > 2000) throw new ValidationError('INVALID_PROJECT', 'Description must be at most 2000 characters.');
  const { data, error } = await adminClient.rpc('admin_save_project', { p_actor: actor.id, p_id: id, p_name: name, p_description: description, p_status: status });
  if (error) databaseError(error);
  return json({ data });
}

export async function handle(request: Request, clients?: { userClient: SupabaseClient; adminClient: SupabaseClient }): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    return errorResponse({ status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  }

  try {
    const { userClient, adminClient } = clients || createClients(request);
    const actor = await requireAdmin(request, userClient, adminClient);

    if (request.method === 'GET') {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'projects') return await listProjects(adminClient);
      if (resource === 'audit') return await listAudit(adminClient, request);
      return await listUsers(adminClient, request);
    }
    const body = asRecord(await request.json());

    if (body.resource === 'projects') return await saveProject(adminClient, actor, body);
    if (request.method === 'POST') {
      if (body.action === 'resend_invite' || body.action === 'cancel_invite') return await invitationAction(adminClient, actor, body);
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

if (import.meta.main) Deno.serve((request) => handle(request));

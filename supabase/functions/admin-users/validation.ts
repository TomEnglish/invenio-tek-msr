export const SUPPORTED_ROLES = ['field_worker', 'office_staff', 'admin'] as const;
export type UserRole = (typeof SUPPORTED_ROLES)[number];

// The shared app intentionally uses the all-zero UUID for its default project,
// so validation checks UUID shape rather than RFC version/variant bits.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export interface InviteInput {
  email: string;
  fullName: string;
  role: UserRole;
  projectIds: string[];
}

export interface UpdateInput {
  userId: string;
  fullName?: string;
  role?: UserRole;
  isActive?: boolean;
  projectIds?: string[];
  expectedUpdatedAt?: string;
}

export interface ListParams {
  page: number;
  pageSize: number;
  search: string;
  role?: UserRole;
  status?: string;
  projectId?: string;
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('INVALID_BODY', 'Request body must be a JSON object');
  }
  return input as Record<string, unknown>;
}

function normalizeProjectIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new ValidationError('INVALID_PROJECT_IDS', 'projectIds must contain at most 100 ids');
  }

  const projectIds = [...new Set(value.map((item) => String(item).trim()))];
  if (projectIds.some((projectId) => !UUID_PATTERN.test(projectId))) {
    throw new ValidationError('INVALID_PROJECT_IDS', 'Every project id must be a valid UUID');
  }
  return projectIds;
}

function normalizeRole(value: unknown): UserRole {
  if (typeof value !== 'string' || !SUPPORTED_ROLES.includes(value as UserRole)) {
    throw new ValidationError('INVALID_ROLE', 'Role must be field_worker, office_staff, or admin');
  }
  return value as UserRole;
}

function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError('INVALID_EMAIL', 'Enter a valid email address');
  }
  return email;
}

function normalizeFullName(value: unknown, fallback: string): string {
  const fullName = value === undefined ? fallback : String(value).trim();
  if (!fullName || fullName.length > 120) {
    throw new ValidationError('INVALID_NAME', 'Full name must be between 1 and 120 characters');
  }
  return fullName;
}

export function validateInviteInput(input: unknown): InviteInput {
  const body = asObject(input);
  const email = normalizeEmail(body.email);
  const fallbackName = email.split('@')[0];

  return {
    email,
    fullName: normalizeFullName(body.fullName, fallbackName),
    role: normalizeRole(body.role ?? 'field_worker'),
    projectIds: normalizeProjectIds(body.projectIds),
  };
}

export function validateUpdateInput(input: unknown): UpdateInput {
  const body = asObject(input);
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!UUID_PATTERN.test(userId)) {
    throw new ValidationError('INVALID_USER_ID', 'userId must be a valid UUID');
  }

  const result: UpdateInput = { userId };
  if (body.fullName !== undefined) result.fullName = normalizeFullName(body.fullName, '');
  if (body.role !== undefined) result.role = normalizeRole(body.role);
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      throw new ValidationError('INVALID_ACTIVE_STATUS', 'isActive must be boolean');
    }
    result.isActive = body.isActive;
  }
  if (body.projectIds !== undefined) result.projectIds = normalizeProjectIds(body.projectIds);

  if (Object.keys(result).length === 1) {
    throw new ValidationError('EMPTY_UPDATE', 'Provide at least one user field to update');
  }
  if (body.expectedUpdatedAt !== undefined) {
    if (typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
      throw new ValidationError('INVALID_VERSION', 'A valid update timestamp is required');
    }
    result.expectedUpdatedAt = body.expectedUpdatedAt;
  }
  return result;
}

export function parseListParams(url: URL): ListParams {
  const requestedPage = Number.parseInt(url.searchParams.get('page') || '1', 10);
  const requestedPageSize = Number.parseInt(url.searchParams.get('pageSize') || '50', 10);
  const search = (url.searchParams.get('search') || '').trim().slice(0, 100);
  const role = url.searchParams.get('role') || undefined;
  const status = url.searchParams.get('status') || undefined;
  const projectId = url.searchParams.get('projectId') || undefined;
  if (role) normalizeRole(role);
  if (status && !['active', 'inactive', 'pending', 'expired', 'cancelled'].includes(status)) {
    throw new ValidationError('INVALID_STATUS', 'Invalid user status');
  }
  if (projectId && !isUuid(projectId)) throw new ValidationError('INVALID_PROJECT_ID', 'Invalid project id');

  return {
    page: Number.isFinite(requestedPage) ? Math.max(1, Math.min(requestedPage, 100000)) : 1,
    pageSize: Number.isFinite(requestedPageSize) ? Math.max(1, Math.min(requestedPageSize, 100)) : 50,
    search,
    role: role as UserRole | undefined,
    status,
    projectId,
  };
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

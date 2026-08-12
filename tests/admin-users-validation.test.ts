import {
  ValidationError,
  parseListParams,
  validateInviteInput,
  validateUpdateInput,
  isUuid,
} from '../supabase/functions/admin-users/validation.ts';

function expectValidationError(callback: () => unknown, expectedCode: string) {
  try {
    callback();
    throw new Error(`Expected ${expectedCode} validation error`);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    if (error.code !== expectedCode) {
      throw new Error(`Expected ${expectedCode}, received ${error.code}`);
    }
  }
}

Deno.test('normalizes invite input and removes duplicate project ids', () => {
  const result = validateInviteInput({
    email: '  USER@Example.COM ',
    fullName: '  Field User  ',
    role: 'field_worker',
    projectIds: [
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
    ],
  });

  if (result.email !== 'user@example.com') throw new Error('email was not normalized');
  if (result.fullName !== 'Field User') throw new Error('name was not normalized');
  if (result.projectIds.length !== 1) throw new Error('project ids were not deduplicated');
});

Deno.test('rejects unsupported roles and malformed emails', () => {
  expectValidationError(
    () => validateInviteInput({ email: 'user@example.com', role: 'super_admin' }),
    'INVALID_ROLE',
  );
  expectValidationError(
    () => validateInviteInput({ email: 'not-an-email', role: 'field_worker' }),
    'INVALID_EMAIL',
  );
});

Deno.test('rejects malformed project ids', () => {
  expectValidationError(
    () => validateInviteInput({ email: 'user@example.com', projectIds: ['not-a-uuid'] }),
    'INVALID_PROJECT_IDS',
  );
});

Deno.test('requires a meaningful update payload', () => {
  expectValidationError(
    () => validateUpdateInput({ userId: '00000000-0000-0000-0000-000000000000' }),
    'EMPTY_UPDATE',
  );

  const result = validateUpdateInput({
    userId: '00000000-0000-0000-0000-000000000000',
    isActive: false,
    projectIds: [],
  });

  if (result.isActive !== false || result.projectIds?.length !== 0) {
    throw new Error('update payload was not preserved');
  }
});

Deno.test('bounds list pagination and search', () => {
  const result = parseListParams(new URL('https://example.test/admin-users?page=0&pageSize=999&search=%20Field%20'));

  if (result.page !== 1) throw new Error('page was not bounded');
  if (result.pageSize !== 100) throw new Error('page size was not bounded');
  if (result.search !== 'Field') throw new Error('search was not trimmed');
});

Deno.test('accepts the shared all-zero default project UUID', () => {
  if (!isUuid('00000000-0000-0000-0000-000000000000')) {
    throw new Error('default project UUID should be accepted');
  }
});

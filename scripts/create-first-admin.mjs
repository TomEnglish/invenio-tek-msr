// Creates the first administrator of a new environment and emails their
// invitation. Everyone after that is invited from Users & Access. The database
// refuses once it has an active administrator (migration 029), so this cannot
// add a second one or take over an environment that is in use.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-first-admin.mjs <environment> <email> "<Full name>"
//
// Run it again with the same details to resend the invitation, or with another
// email to withdraw the first invitation and send a new one. It prints the
// outcome only, never the key.
import { pathToFileURL } from 'node:url';
import { keyProblem } from './environments.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createFirstAdmin({ environment, email, fullName, key, ttlSeconds = 86400, fetchImpl = fetch, now = Date.now }) {
    const address = String(email || '').trim().toLowerCase();
    const name = String(fullName || '').trim();
    if (!EMAIL.test(address) || address.length > 254) throw new Error('Give the administrator\'s email address');
    if (!name || name.length > 120) throw new Error('Give the administrator\'s full name (up to 120 characters)');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required; it is that environment\'s server key');
    // A key that names another environment's database is never sent to this one.
    const mismatch = keyProblem(key, environment.databaseUrl, 'service_role');
    if (mismatch) throw new Error(`SUPABASE_SERVICE_ROLE_KEY ${mismatch}. Use the server key of "${environment.name}"; nothing was sent.`);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 604800) throw new Error('Invitation expiry must be between 60 seconds and 7 days');

    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const call = async (path, method, body) => {
        const response = await fetchImpl(`${environment.databaseUrl}${path}`, {
            method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
        });
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        return { ok: response.ok, status: response.status, data };
    };
    // A service's own words are passed on, but never with the key in them.
    const said = result => String(result.data?.message || result.data?.msg || '').replaceAll(key, '[key]');
    const fail = (step, result) => new Error(`${step} failed (${result.status})${said(result) ? `: ${said(result)}` : ''}`);

    // Find the account, or create it unconfirmed exactly as Users & Access does.
    const existing = await call(`/rest/v1/users?select=id&email=eq.${encodeURIComponent(address)}`, 'GET');
    if (!existing.ok) throw fail('Looking up the account', existing);
    let userId = existing.data?.[0]?.id;
    if (!userId) {
        const created = await call('/auth/v1/admin/users', 'POST', { email: address, email_confirm: false, user_metadata: { full_name: name } });
        if (!created.ok) throw fail('Creating the account', created);
        userId = created.data?.id;
        if (!userId) throw new Error('The sign-in service did not return the new account');
    }

    const expiresAt = new Date(now() + ttlSeconds * 1000).toISOString();
    const made = await call('/rest/v1/rpc/bootstrap_first_admin', 'POST', { p_target: userId, p_full_name: name, p_expires_at: expiresAt });
    if (!made.ok) {
        if (made.data?.code === '42501' && /already has an administrator/i.test(made.data.message || '')) throw new Error(`${environment.name} already has an administrator. Invite people from Users & Access on ${environment.siteUrl}.`);
        throw fail('Setting up the administrator', made);
    }
    if (made.data?.invitation_status === 'accepted') return { userId, email: address, invited: false };

    // The same emails Users & Access sends: an invitation for a new account,
    // a setup code for one whose email is already confirmed.
    const account = await call(`/auth/v1/admin/users/${userId}`, 'GET');
    if (!account.ok) throw fail('Reading the account', account);
    const redirect = encodeURIComponent(`${environment.siteUrl}/login.html?setup=invite`);
    const sent = account.data?.email_confirmed_at
        ? await call(`/auth/v1/recover?redirect_to=${redirect}`, 'POST', { email: address })
        : await call(`/auth/v1/invite?redirect_to=${redirect}`, 'POST', { email: address, data: { full_name: name } });
    if (!sent.ok) {
        throw new Error(`The administrator is set up, but the invitation email could not be sent (${sent.status}). Check ${environment.name}'s email settings, then run this command again to resend.`);
    }
    return { userId, email: address, invited: true, expiresAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [name, email, fullName] = process.argv.slice(2);
    (async () => {
        if (!name || !email || !fullName) throw new Error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-first-admin.mjs <environment> <email> "<Full name>"');
        const { loadEnvironments, getEnvironment } = await import('./environments.mjs');
        const environment = getEnvironment(loadEnvironments(), name);
        const result = await createFirstAdmin({
            environment, email, fullName, key: process.env.SUPABASE_SERVICE_ROLE_KEY,
            ttlSeconds: Number(process.env.INVITATION_TTL_SECONDS || 86400),
        });
        console.log(result.invited
            ? `Invitation sent to ${result.email} for ${environment.name}. They finish setup at ${environment.siteUrl}/login.html before ${result.expiresAt}.`
            : `${result.email} already had an account on ${environment.name} and is now its administrator.`);
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

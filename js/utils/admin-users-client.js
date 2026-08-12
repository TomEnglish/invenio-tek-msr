/**
 * Browser client for the admin-users Edge Function.
 *
 * The current Supabase session is sent as a bearer token. This module has no
 * privileged key and never calls the Auth Admin API from the browser.
 */
(function initAdminUsersClient(global) {
    const DEFAULT_FUNCTION_NAME = 'admin-users';

    function getFunctionUrl(functionName) {
        const baseUrl = global.SUPABASE_CONFIG?.url;
        if (!baseUrl) throw new Error('Supabase URL is not configured');
        return `${baseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`;
    }

    function createAdminUsersClient({
        supabaseClient,
        functionUrl,
        functionName = DEFAULT_FUNCTION_NAME,
        anonKey = global.SUPABASE_CONFIG?.anonKey,
        fetchImpl = global.fetch,
    } = {}) {
        if (!supabaseClient?.auth?.getSession) {
            throw new Error('A Supabase client with auth.getSession is required');
        }
        if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
        const endpoint = functionUrl || getFunctionUrl(functionName);

        async function invoke(method, body, query) {
            const { data: { session } = {} } = await supabaseClient.auth.getSession();
            if (!session?.access_token) {
                const error = new Error('Your session has expired. Please sign in again.');
                error.code = 'UNAUTHENTICATED';
                throw error;
            }

            const url = new URL(endpoint);
            Object.entries(query || {}).forEach(([key, value]) => {
                if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
            });

            const response = await fetchImpl(url, {
                method,
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    apikey: anonKey || '',
                    'Content-Type': 'application/json',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });

            let payload = null;
            try { payload = await response.json(); } catch (error) { /* handled below */ }

            if (!response.ok || payload?.error) {
                const requestError = new Error(payload?.error?.message || 'Request failed');
                requestError.code = payload?.error?.code || `HTTP_${response.status}`;
                throw requestError;
            }
            return payload;
        }

        return {
            listUsers(params = {}) {
                return invoke('GET', undefined, {
                    page: params.page || 1,
                    pageSize: params.pageSize || 50,
                    search: params.search || '',
                });
            },
            listProjects() {
                return invoke('GET', undefined, { resource: 'projects' });
            },
            inviteUser(input) {
                return invoke('POST', { action: 'invite', ...input });
            },
            updateUser(input) {
                return invoke('PATCH', input);
            },
        };
    }

    global.createAdminUsersClient = createAdminUsersClient;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createAdminUsersClient };
    }
})(typeof window !== 'undefined' ? window : globalThis);

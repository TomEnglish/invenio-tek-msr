/**
 * Auth Guard - Redirects unauthenticated users to login.html
 * Include this script on every protected page AFTER supabase-client.js
 */
window.InvenioAuthReady = (async function authGuard() {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = 'login.html';
        return false;
    }

    const userId = session.user.id;
    let profile;
    let projectId = null;
    try {
        const [profileResult, scopeProjectId] = await Promise.all([
            supabaseClient
                .from('users')
                .select('id, email, full_name, role, is_active, invitation_status')
                .eq('id', userId)
                .maybeSingle(),
            window.InvenioProjectScope.initializeProjectScope(supabaseClient, userId),
        ]);
        const { data: profileData, error: profileError } = profileResult;
        if (profileError) throw new Error('Unable to verify account access. Check your connection and retry.');
        profile = profileData;
        projectId = scopeProjectId;
    } catch (error) {
        if (error.message === 'Unable to verify account access. Check your connection and retry.') throw error;
        document.body.replaceChildren();
        const message = document.createElement('p');
        message.textContent = error.message;
        const retry = document.createElement('button');
        retry.textContent = 'Try again';
        retry.onclick = () => window.location.reload();
        document.body.append(message, retry);
        document.documentElement.classList.add('auth-ready');
        return false;
    }

    if (!profile || !window.InvenioUserAccess?.canUseApp(profile)) {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
        return false;
    }

    window.InvenioCurrentProfile = profile;

    const requiredRole = document.body?.dataset?.requiredRole;
    if (requiredRole === 'admin' && !window.InvenioUserAccess.canAccessAdminPages(profile)) {
        window.location.href = 'index.html?access=denied';
        return false;
    }

    if (!projectId && document.body?.dataset?.projectOptional !== 'true') {
        window.location.href = 'access-pending.html';
        return false;
    }

    // Show the page body (hidden by default via auth-guard)
    document.documentElement.classList.add('auth-ready');

    // Listen for sign-out
    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            window.location.href = 'login.html';
        }
    });
    return true;
})().catch(() => {
    document.body.replaceChildren();
    const message = document.createElement('p'); message.textContent = 'Unable to verify your session. Check your connection and try again.';
    const retry = document.createElement('button'); retry.textContent = 'Try again'; retry.onclick = () => location.reload();
    document.body.append(message, retry); document.documentElement.classList.add('auth-ready');
    return false;
});

/**
 * Sign out the current user
 */
async function signOut() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

window.signOut = signOut;

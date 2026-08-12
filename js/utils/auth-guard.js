/**
 * Auth Guard - Redirects unauthenticated users to login.html
 * Include this script on every protected page AFTER supabase-client.js
 */
window.InvenioAuthReady = (async function authGuard() {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    const { data: profile, error: profileError } = await supabaseClient
        .from('users')
        .select('id, email, full_name, role, is_active')
        .eq('id', session.user.id)
        .maybeSingle();

    if (profileError || !profile || !window.InvenioUserAccess?.canUseApp(profile)) {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
        return;
    }

    window.InvenioCurrentProfile = profile;

    const requiredRole = document.body?.dataset?.requiredRole;
    if (requiredRole === 'admin' && !window.InvenioUserAccess.canAccessAdminPages(profile)) {
        window.location.href = 'index.html?access=denied';
        return;
    }

    if (window.InvenioProjectScope) {
        await window.InvenioProjectScope.initializeProjectScope(supabaseClient, session.user.id);
    }

    // Show the page body (hidden by default via auth-guard)
    document.documentElement.classList.add('auth-ready');

    // Listen for sign-out
    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            window.location.href = 'login.html';
        }
    });
})();

/**
 * Sign out the current user
 */
async function signOut() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

window.signOut = signOut;

/**
 * Auth Guard - Redirects unauthenticated users to login.html
 * Include this script on every protected page AFTER supabase-client.js
 */
(async function authGuard() {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = 'login.html';
        return;
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

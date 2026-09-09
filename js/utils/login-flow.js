(function (global) {
    function emailLinkHelp(mode, message = '', code = '') {
        if (code !== 'otp_expired' && !/(?:link|invitation|token).*(?:expired|invalid|already.*used)/i.test(message)) return null;
        const kind = /invitation expired/i.test(message) || mode === 'invite' ? 'invite' : mode === 'recovery' ? 'recovery' : 'unknown';
        return {
            kind,
            title: kind === 'invite' ? 'Invitation link unavailable' : kind === 'recovery' ? 'Password reset link unavailable' : 'Email link unavailable',
            explanation: 'This link has expired, has already been used, or is invalid. Email links expire after a limited time and can only be used once.',
        };
    }
    function createLoginFlow(hash = '', search = '') {
        const fragment = new URLSearchParams(hash.replace(/^#/, ''));
        const query = new URLSearchParams(search.replace(/^\?/, ''));
        const verification = query.get('verification');
        const verificationType = ['invite', 'recovery'].includes(verification) ? verification : null;
        const type = query.get('setup') || fragment.get('type') || query.get('type') || verificationType;
        let mode = type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : 'login';
        const errorCode = fragment.get('error_code') || query.get('error_code') || '';
        const error = fragment.get('error_description') || query.get('error_description') ||
            (errorCode || fragment.has('error') || query.has('error') ? 'This email link could not be opened. Please try again or contact your administrator.' : '');
        return {
            get mode() { return mode; },
            verificationType,
            error,
            get linkHelp() { return emailLinkHelp(mode, error, errorCode); },
            handleEvent(event) { if (event === 'PASSWORD_RECOVERY' && mode !== 'invite') mode = 'recovery'; },
            shouldRedirect(session) { return Boolean(session && mode === 'login' && !verificationType && !error); },
        };
    }
    async function verifyEmailCode(client, type, email, token) {
        email = String(email).trim().toLowerCase();
        token = String(token).trim();
        if (!['invite', 'recovery'].includes(type) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6,10}$/.test(token)) {
            throw new Error('Enter your invited email address and the code from your newest email.');
        }
        const { data, error } = await client.auth.verifyOtp({ email, token, type });
        if (error) throw error;
        if (!data?.session) throw new Error('A verified session was not returned. Please try again.');
    }
    async function completeSignIn(client) {
        // The server validates pending status, expiry, confirmed email and password.
        // Accepted accounts are a no-op; never navigate past a failed completion.
        const { error } = await client.rpc('complete_invitation');
        if (error) throw error;
    }
    global.InvenioLoginFlow = { createLoginFlow, emailLinkHelp, verifyEmailCode, completeSignIn };
    if (typeof module !== 'undefined') module.exports = global.InvenioLoginFlow;
})(typeof window !== 'undefined' ? window : globalThis);

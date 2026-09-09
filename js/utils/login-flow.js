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
        const type = fragment.get('type') || query.get('type') || query.get('setup');
        let mode = type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : 'login';
        const errorCode = fragment.get('error_code') || query.get('error_code') || '';
        const error = fragment.get('error_description') || query.get('error_description') ||
            (errorCode || fragment.has('error') || query.has('error') ? 'This email link could not be opened. Please try again or contact your administrator.' : '');
        return {
            get mode() { return mode; },
            error,
            get linkHelp() { return emailLinkHelp(mode, error, errorCode); },
            handleEvent(event) { if (event === 'PASSWORD_RECOVERY' && mode !== 'invite') mode = 'recovery'; },
            shouldRedirect(session) { return Boolean(session && mode === 'login' && !error); },
        };
    }
    global.InvenioLoginFlow = { createLoginFlow, emailLinkHelp };
    if (typeof module !== 'undefined') module.exports = { createLoginFlow, emailLinkHelp };
})(typeof window !== 'undefined' ? window : globalThis);

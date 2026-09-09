(function (global) {
    function createLoginFlow(hash = '', search = '') {
        const fragment = new URLSearchParams(hash.replace(/^#/, ''));
        const query = new URLSearchParams(search.replace(/^\?/, ''));
        const type = fragment.get('type') || query.get('type') || query.get('setup');
        let mode = type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : 'login';
        const error = fragment.get('error_description') || query.get('error_description') ||
            (fragment.has('error') || query.has('error') ? 'This link is invalid or expired. Request a new link.' : '');
        return {
            get mode() { return mode; },
            error,
            handleEvent(event) { if (event === 'PASSWORD_RECOVERY' && mode !== 'invite') mode = 'recovery'; },
            shouldRedirect(session) { return Boolean(session && mode === 'login' && !error); },
        };
    }
    global.InvenioLoginFlow = { createLoginFlow };
    if (typeof module !== 'undefined') module.exports = { createLoginFlow };
})(typeof window !== 'undefined' ? window : globalThis);

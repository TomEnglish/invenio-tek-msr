/**
 * Shared client-side profile helpers.
 *
 * These helpers improve UX and page routing only. Database RLS and the
 * admin-users Edge Function remain the authorization boundaries.
 */
(function initUserAccess(global) {
    const APP_ROLES = new Set(['field_worker', 'office_staff', 'admin']);

    function normalizeProfile(profile) {
        if (!profile || typeof profile !== 'object') return null;

        return {
            id: profile.id || '',
            fullName: String(profile.full_name || '').trim(),
            role: APP_ROLES.has(profile.role) ? profile.role : null,
            isActive: profile.is_active === true && profile.invitation_status === 'accepted',
        };
    }

    function canUseApp(profile) {
        const normalized = normalizeProfile(profile);
        return Boolean(normalized?.isActive && normalized.role);
    }

    function canAccessAdminPages(profile) {
        const normalized = normalizeProfile(profile);
        return Boolean(normalized?.isActive && normalized.role === 'admin');
    }

    function requiredRoleFromPage() {
        return document.body?.dataset?.requiredRole || null;
    }

    const api = {
        APP_ROLES,
        normalizeProfile,
        canUseApp,
        canAccessAdminPages,
        requiredRoleFromPage,
    };

    global.InvenioUserAccess = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

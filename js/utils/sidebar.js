/**
 * Shared Sidebar Navigation Component
 * Dynamically injects the left sidebar + top header bar into every page.
 */

(function () {
    const NAV_ITEMS = [
        { label: 'Dashboard',       icon: 'fa-tachometer-alt',    href: 'index.html' },
        { label: 'Work Inbox', icon: 'fa-inbox', href: 'work-inbox.html' },
        { label: 'Shipments',       icon: 'fa-shipping-fast',     href: 'shipment-visibility.html', section: 'Logistics' },
        { label: 'Yard Inventory',       icon: 'fa-warehouse',         href: 'inventory.html' },
        { label: 'Outside Shops',   icon: 'fa-store',             href: 'outside-shop-inventory.html' },
        { label: 'Shop Contacts',   icon: 'fa-address-book',      href: 'shop-contacts.html' },
        { label: 'Gap Analysis',    icon: 'fa-clipboard-check',   href: 'gap-analysis.html', section: 'Planning' },
        { label: 'PO & Installation',       icon: 'fa-cubes',             href: 'material-tracking.html' },
        { label: 'Delivery Dates',      icon: 'fa-truck',             href: 'delivery-dates.html' },
        { label: 'Schedule',        icon: 'fa-calendar-alt',      href: 'project-schedule.html' },
        { label: 'GPS Tracking',    icon: 'fa-map-marker-alt',    href: 'samsara-tracking.html', section: 'Field' },
        { label: 'Site Plan',       icon: 'fa-drafting-compass',  href: 'site-plan.html' },
        { label: 'Receiving',       icon: 'fa-clipboard-list',    href: 'receiving.html' },
        { label: 'Data Browser',           icon: 'fa-database',          href: 'admin.html', section: 'System', adminOnly: true },
        { label: 'Users & Access', icon: 'fa-users-cog',         href: 'user-admin.html', adminOnly: true },
        { label: 'Projects', icon: 'fa-folder', href: 'projects.html', adminOnly: true },
        { label: 'Activity & Audit', icon: 'fa-history', href: 'audit.html', adminOnly: true },
    ];

    // Page title map
    const PAGE_TITLES = {
        'index.html':                   'Dashboard',
        'shipment-visibility.html':     'Shipment Visibility',
        'inventory.html':               'Yard Inventory',
        'outside-shop-inventory.html':  'Outside Shop Inventory',
        'shop-contacts.html':           'Shop Contacts',
        'gap-analysis.html':            'Gap Analysis',
        'material-tracking.html':       'PO & Installation',
        'delivery-dates.html':          'Delivery Dates',
        'project-schedule.html':        'Project Schedule',
        'samsara-tracking.html':        'GPS Tracking',
        'site-plan.html':              'Site Plan',
        'receiving.html':              'Receiving',
        'admin.html':                  'Data Browser',
        'user-admin.html':              'Users & Access',
        'projects.html': 'Projects', 'audit.html': 'Activity & Audit', 'access-pending.html': 'Access pending', 'search.html': 'Search',
        'record.html': 'Record details',
        'work-inbox.html': 'Work Inbox',
    };

    function getCurrentPage() {
        const path = window.location.pathname;
        const file = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
        return file;
    }

    function buildNavLinks() {
        const current = getCurrentPage();
        let html = '';
        NAV_ITEMS.forEach(item => {
            if (item.section) {
                html += `<div class="nav-section-label">${item.section}</div>\n`;
            }
            const active = current === item.href ? ' active' : '';
            const adminOnly = item.adminOnly ? ' data-admin-only="true"' : '';
            html += `<a href="${item.href}" class="${active}"${adminOnly}><i class="fas ${item.icon}"></i>${item.label}</a>\n`;
        });
        return html;
    }

    function getPageTitle() {
        const current = getCurrentPage();
        return PAGE_TITLES[current] || 'Invenio Field MSR';
    }

    function getUserInitials() {
        // Try to get from Supabase session if available
        if (window.supabaseClient) {
            window.supabaseClient.auth.getUser().then(({ data }) => {
                if (data?.user?.email) {
                    const email = data.user.email;
                    const nameEl = document.getElementById('sidebar-user-name');
                    const emailEl = document.getElementById('sidebar-user-email');
                    const avatarEl = document.getElementById('sidebar-avatar');
                    if (nameEl) nameEl.textContent = email.split('@')[0];
                    if (emailEl) emailEl.textContent = email;
                    if (avatarEl) {
                        const parts = email.split('@')[0].split(/[._-]/);
                        const initials = parts.length > 1
                            ? (parts[0][0] + parts[1][0]).toUpperCase()
                            : email.substring(0, 2).toUpperCase();
                        avatarEl.textContent = initials;
                    }
                }
                const authReady = window.InvenioAuthReady || Promise.resolve();
                authReady.then(() => updateAdminNavVisibility(window.InvenioCurrentProfile));
            });
        }
    }

    function updateAdminNavVisibility(profile) {
        const canManageUsers = window.InvenioUserAccess?.canAccessAdminPages(profile);
        document.querySelectorAll('[data-admin-only="true"]').forEach((link) => {
            link.hidden = !canManageUsers;
        });
    }

    function getInitialTheme() {
        try {
            const saved = localStorage.getItem('invenio-theme');
            if (saved === 'dark' || saved === 'light') return saved;
        } catch (e) { /* localStorage blocked */ }
        return null; // null = follow OS preference
    }

    function applyTheme(theme) {
        if (theme === null) {
            document.documentElement.removeAttribute('data-theme');
            try { localStorage.removeItem('invenio-theme'); } catch (e) {}
        } else {
            document.documentElement.setAttribute('data-theme', theme);
            try { localStorage.setItem('invenio-theme', theme); } catch (e) {}
        }
    }

    function effectiveTheme() {
        const explicit = document.documentElement.getAttribute('data-theme');
        if (explicit === 'dark' || explicit === 'light') return explicit;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function injectShell() {
        const body = document.body;
        const existingContent = body.innerHTML;

        // Pick the theme-correct lockup at inject time. If dark mode is active
        // (explicit data-theme="dark" OR OS preference w/ no override), use the
        // dark variant — otherwise the light lockup's dark wordmark would be
        // invisible on the dark sidebar surface.
        const explicitTheme = document.documentElement.getAttribute('data-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = explicitTheme === 'dark' || (!explicitTheme && prefersDark);
        const lightLogo = window.BRANDING?.logo     || 'brand/invenio-lockup.svg';
        const darkLogo  = window.BRANDING?.logoDark || 'brand/invenio-lockup-dark.svg';
        const logo = isDark ? darkLogo : lightLogo;

        const shell = `
        <div class="app-shell">
            <!-- Sidebar -->
            <aside class="sidebar" id="app-sidebar">
                <div class="sidebar-logo"><button type="button" id="sidebar-close" class="sidebar-close" aria-label="Close navigation">×</button>
                    <img src="${logo}" alt="Invenio" class="lockup">
                </div>
                <nav class="sidebar-nav">
                    ${buildNavLinks()}
                </nav>
                <div class="sidebar-footer">
                    <div class="sidebar-user">
                        <div class="sidebar-avatar" id="sidebar-avatar">U</div>
                        <div class="sidebar-user-info">
                            <div class="sidebar-user-name" id="sidebar-user-name">User</div>
                            <div class="sidebar-user-email" id="sidebar-user-email">—</div>
                        </div>
                    </div>
                    <button class="sidebar-signout" onclick="signOut(); return false;">
                        <i class="fas fa-sign-out-alt"></i> Sign Out
                    </button>
                </div>
            </aside>

            <!-- Main Area -->
            <div class="main-area">
                <!-- Top Header -->
                <header class="top-header">
                    <button class="toggle-btn" id="sidebar-toggle" title="Toggle sidebar">
                        <i class="fas fa-bars"></i>
                    </button>
                    <span class="page-title">${getPageTitle()}</span>
                    <select id="active-project" class="form-select form-select-sm" aria-label="Active project" style="width:auto;max-width:240px" hidden></select>
                    <form class="header-search-wrap" action="search.html" role="search">
                        <i class="fas fa-search"></i>
                        <input type="text" class="header-search" placeholder="Search records..." aria-label="Search records" name="q" id="header-search">
                    </form>
                    <button class="theme-toggle" id="theme-toggle" title="Toggle color theme" aria-label="Toggle color theme">
                        <i class="icon-moon fas fa-moon"></i>
                        <i class="icon-sun fas fa-sun"></i>
                    </button>
                    <a class="header-icon-btn" href="work-inbox.html" title="Work inbox" aria-label="Work inbox">
                        <i class="far fa-bell"></i>
                    </a>
                </header>

                <!-- Page Content -->
                <main class="main-content" id="main-content">
                    ${existingContent}
                </main>
            </div>
        </div>`;

        body.innerHTML = shell;

        // Sidebar toggle
        const toggleBtn = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('app-sidebar');
        if (toggleBtn && sidebar) {
            const mobile = window.matchMedia('(max-width: 768px)');
            const setCollapsed = collapsed => {
                sidebar.classList.toggle('collapsed', collapsed);
                sidebar.inert = collapsed;
                toggleBtn.setAttribute('aria-expanded', String(!collapsed));
            };
            toggleBtn.setAttribute('aria-label', 'Toggle navigation');
            toggleBtn.setAttribute('aria-controls', 'app-sidebar');
            setCollapsed(mobile.matches);
            mobile.addEventListener('change', () => setCollapsed(mobile.matches));
            toggleBtn.addEventListener('click', () => setCollapsed(!sidebar.classList.contains('collapsed')));
            document.getElementById('sidebar-close').onclick = () => { setCollapsed(true); toggleBtn.focus(); };
            document.addEventListener('keydown', event => { if (event.key === 'Escape' && mobile.matches) { setCollapsed(true); toggleBtn.focus(); } });
        }

        // Theme toggle — cycles between light/dark, persists choice
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
                applyTheme(next);
            });
        }

        document.addEventListener('input', event => { if (event.target.closest('#main-content form')) window.InvenioUnsavedChanges = true; });
        // Load user info
        getUserInitials();
        (window.InvenioAuthReady || Promise.resolve(false)).then(ready => {
            if (!ready) return;
            const scope = window.InvenioProjectScope;
            const selector = document.getElementById('active-project');
            for (const project of scope.availableProjects) {
                const option = document.createElement('option'); option.value = project.id; option.textContent = project.name;
                selector.appendChild(option);
            }
            selector.hidden = !scope.availableProjects.length;
            selector.value = scope.activeProject?.id || '';
            selector.onchange = () => {
                if (window.InvenioUnsavedChanges && !confirm('Switch project and leave unsaved work on this page?')) { selector.value = scope.activeProject?.id || ''; return; }
                scope.setActiveProjectId(selector.value); location.reload();
            };
            if (scope.activeProject) document.title = `${getPageTitle()} — ${scope.activeProject.name} — Invenio`;
        });
    }

    // Provide global signOut if not already defined
    if (typeof window.signOut !== 'function') {
        window.signOut = async function () {
            if (window.supabaseClient) {
                await window.supabaseClient.auth.signOut();
            }
            window.location.href = 'login.html';
        };
    }

    // Wait for DOM ready then inject
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectShell);
    } else {
        injectShell();
    }
})();

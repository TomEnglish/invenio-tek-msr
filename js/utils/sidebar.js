/**
 * Shared Sidebar Navigation Component
 * Dynamically injects the left sidebar + top header bar into every page.
 */

(function () {
    const NAV_ITEMS = [
        { label: 'Dashboard',       icon: 'fa-tachometer-alt',    href: 'index.html' },
        { label: 'Shipments',       icon: 'fa-shipping-fast',     href: 'shipment-visibility.html', section: 'Logistics' },
        { label: 'Inventory',       icon: 'fa-warehouse',         href: 'inventory.html' },
        { label: 'Outside Shops',   icon: 'fa-store',             href: 'outside-shop-inventory.html' },
        { label: 'Shop Contacts',   icon: 'fa-address-book',      href: 'shop-contacts.html' },
        { label: 'Gap Analysis',    icon: 'fa-clipboard-check',   href: 'gap-analysis.html', section: 'Planning' },
        { label: 'Materials',       icon: 'fa-cubes',             href: 'material-tracking.html' },
        { label: 'Deliveries',      icon: 'fa-truck',             href: 'delivery-dates.html' },
        { label: 'Schedule',        icon: 'fa-calendar-alt',      href: 'project-schedule.html' },
        { label: 'GPS Tracking',    icon: 'fa-map-marker-alt',    href: 'samsara-tracking.html', section: 'Field' },
        { label: 'Site Plan',       icon: 'fa-drafting-compass',  href: 'site-plan.html' },
        { label: 'Receiving',       icon: 'fa-clipboard-list',    href: 'receiving.html' },
        { label: 'Admin',           icon: 'fa-database',          href: 'admin.html', section: 'System' },
    ];

    // Page title map
    const PAGE_TITLES = {
        'index.html':                   'Dashboard',
        'shipment-visibility.html':     'Shipment Visibility',
        'inventory.html':               'Master Inventory',
        'outside-shop-inventory.html':  'Outside Shop Inventory',
        'shop-contacts.html':           'Shop Contacts',
        'gap-analysis.html':            'Gap Analysis',
        'material-tracking.html':       'Material Tracking',
        'delivery-dates.html':          'Delivery Dates',
        'project-schedule.html':        'Project Schedule',
        'samsara-tracking.html':        'GPS Tracking',
        'site-plan.html':              'Site Plan',
        'receiving.html':              'Receiving',
        'admin.html':                  'Data Browser',
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
            html += `<a href="${item.href}" class="${active}"><i class="fas ${item.icon}"></i>${item.label}</a>\n`;
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
            });
        }
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
                <div class="sidebar-logo">
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
                    <div class="header-search-wrap">
                        <i class="fas fa-search"></i>
                        <input type="text" class="header-search" placeholder="Search..." id="header-search">
                    </div>
                    <button class="theme-toggle" id="theme-toggle" title="Toggle color theme" aria-label="Toggle color theme">
                        <i class="icon-moon fas fa-moon"></i>
                        <i class="icon-sun fas fa-sun"></i>
                    </button>
                    <button class="header-icon-btn" title="Notifications">
                        <i class="far fa-bell"></i>
                        <span class="notif-dot"></span>
                    </button>
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
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
                const icon = toggleBtn.querySelector('i');
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-times');
            });
        }

        // Theme toggle — cycles between light/dark, persists choice
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
                applyTheme(next);
            });
        }

        // Load user info
        getUserInitials();
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

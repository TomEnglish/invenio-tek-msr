/**
 * Client Branding Configuration
 *
 * Before a sales demo, update these values to match the prospect:
 * - clientName: Their company name
 * - projectName: The project/site name
 * - logo: Path or URL to their logo
 *
 * Then refresh the dashboard — all pages pick up the new branding.
 *
 * Color tokens live in styles.css (the Invenio design system) — do not
 * override them here unless a client demands their own palette.
 */

const BRANDING = {
    clientName: 'Invenio Tech',
    projectName: 'Greenfield LNG Terminal',
    projectSubtitle: 'Material Status Report',
    logo: 'brand/invenio-lockup.svg',         // light-theme lockup
    logoDark: 'brand/invenio-lockup-dark.svg', // swapped in by applyBranding when [data-theme="dark"]
};

function currentLogoFor(theme) {
    return theme === 'dark' ? BRANDING.logoDark : BRANDING.logo;
}

function applyBranding() {
    document.title = `Invenio Field MSR — ${BRANDING.projectName}`;

    const logoText = document.querySelector('.logo-text');
    if (logoText) logoText.textContent = 'Invenio Field MSR';

    const logoImg = document.querySelector('.sidebar-logo img');
    if (logoImg) {
        const theme = document.documentElement.getAttribute('data-theme');
        logoImg.src = currentLogoFor(theme);
    }

    const heroBanner = document.querySelector('.hero-banner h1');
    if (heroBanner && heroBanner.textContent.includes('Greenfield')) {
        heroBanner.innerHTML = `<i class="fas fa-industry" style="margin-right:10px; font-size:22px;"></i>${BRANDING.projectName}`;
    }
}

// Re-swap the logo whenever the theme changes
function watchThemeForLogoSwap() {
    const observer = new MutationObserver(() => {
        const logoImg = document.querySelector('.sidebar-logo img');
        if (logoImg) {
            const theme = document.documentElement.getAttribute('data-theme');
            logoImg.src = currentLogoFor(theme);
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

document.addEventListener('DOMContentLoaded', () => {
    applyBranding();
    watchThemeForLogoSwap();
});

window.BRANDING = BRANDING;
window.applyBranding = applyBranding;

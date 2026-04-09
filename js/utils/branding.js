/**
 * Client Branding Configuration
 *
 * Before a sales demo, update these values to match the prospect:
 * - clientName: Their company name
 * - projectName: The project/site name
 * - logo: Path or URL to their logo
 * - colors: Their brand colors (primary + accent)
 *
 * Then refresh the dashboard — all pages pick up the new branding.
 */

const BRANDING = {
    // === CHANGE THESE BEFORE A DEMO ===
    clientName: 'Relevant Power Solutions',
    projectName: 'Greenfield LNG Terminal',
    projectSubtitle: 'Material Status Report',
    logo: 'favicon-96x96.png',  // swap with client logo file
    colors: {
        primary: '#0369a1',     // Main brand color (sidebar active, buttons, charts)
        accent: '#0891b2',      // Accent color (gradients, secondary elements)
        dark: '#1e293b',        // Dark text
        navBg: '#FFFFFF',       // Sidebar / header background
        navText: '#64748b',     // Nav text color
        brandGold: '#A69872',   // Brand identity accent
    }
};

// Apply branding to the page
function applyBranding() {
    const root = document.documentElement.style;

    // Update CSS variables to match new design system
    root.setProperty('--primary', BRANDING.colors.primary);
    root.setProperty('--accent', BRANDING.colors.accent);
    root.setProperty('--text-primary', BRANDING.colors.dark);
    root.setProperty('--surface', BRANDING.colors.navBg);
    root.setProperty('--text-muted', BRANDING.colors.navText);
    root.setProperty('--brand-gold', BRANDING.colors.brandGold);

    // Legacy aliases for backward compatibility
    root.setProperty('--primary-blue', BRANDING.colors.primary);
    root.setProperty('--lime-green', BRANDING.colors.primary);
    root.setProperty('--navbar-bg', BRANDING.colors.navBg);
    root.setProperty('--navbar-text', BRANDING.colors.navText);
    root.setProperty('--navbar-active', BRANDING.colors.primary);

    // Update page title
    document.title = `MSR Dashboard - ${BRANDING.projectName}`;

    // Update sidebar logo text if present
    const logoText = document.querySelector('.logo-text');
    if (logoText) logoText.textContent = 'MSR Dashboard';

    // Update sidebar logo image if present
    const logoImg = document.querySelector('.sidebar-logo img');
    if (logoImg) logoImg.src = BRANDING.logo;

    // Update hero banner if present
    const heroBanner = document.querySelector('.hero-banner h1');
    if (heroBanner && heroBanner.textContent.includes('Greenfield')) {
        heroBanner.innerHTML = `<i class="fas fa-industry" style="margin-right:10px; font-size:22px;"></i>${BRANDING.projectName}`;
    }
}

// Auto-apply on load
document.addEventListener('DOMContentLoaded', applyBranding);

window.BRANDING = BRANDING;
window.applyBranding = applyBranding;

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
        primary: '#2563EB',     // Main brand color (buttons, links, charts)
        accent: '#B0A07A',      // Accent/gold color
        dark: '#1a1a1a',        // Dark backgrounds
        navBg: '#FFFFFF',       // Navbar background
        navText: '#64748B',     // Navbar text
    }
};

// Apply branding to the page
function applyBranding() {
    const root = document.documentElement.style;

    // Update CSS variables
    root.setProperty('--primary-blue', BRANDING.colors.primary);
    root.setProperty('--lime-green', BRANDING.colors.primary);
    root.setProperty('--brand-accent', BRANDING.colors.accent);
    root.setProperty('--navbar-bg', BRANDING.colors.navBg);
    root.setProperty('--navbar-text', BRANDING.colors.navText);

    // Update page title
    document.title = `MSR Dashboard - ${BRANDING.projectName}`;

    // Update navbar brand text
    const brandSpan = document.querySelector('.navbar-brand span');
    if (brandSpan) brandSpan.textContent = 'MSR Dashboard';

    // Update navbar logo
    const brandImg = document.querySelector('.navbar-brand img');
    if (brandImg) brandImg.src = BRANDING.logo;

    // Update project header if present
    const projectHeader = document.querySelector('.card-body h2');
    if (projectHeader && projectHeader.textContent.includes('Material Status Report')) {
        projectHeader.innerHTML = `<i class="fas fa-industry text-primary me-2"></i>${BRANDING.projectName} - ${BRANDING.projectSubtitle}`;
    }
}

// Auto-apply on load
document.addEventListener('DOMContentLoaded', applyBranding);

window.BRANDING = BRANDING;
window.applyBranding = applyBranding;

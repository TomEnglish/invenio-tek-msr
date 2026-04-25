/**
 * Chart.js global theme — reads live CSS custom properties so charts
 * track the active design-token theme (light <-> dark) without a reload.
 *
 * Include this AFTER chart.umd.min.js but BEFORE any chart instantiation.
 */

(function () {
    if (typeof Chart === 'undefined') return;

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    // Categorical palette tuned for visual punch. Leads with the teal/accent
    // (the "teal everywhere") and pink (Bootstrap <code> color, already
    // in the app). Then sky-700, amber, sky-400, success, info-purple,
    // danger. Drops the muted slates that made earlier charts look dull.
    Chart.invenioPalette = function () {
        return [
            cssVar('--accent')  || '#0891B2', // teal — primary chart color
            '#D63384',                         // pink — Bootstrap code accent
            cssVar('--primary') || '#0369A1', // sky-700
            cssVar('--warn')    || '#D97706', // amber
            '#38BDF8',                         // sky-400 bright
            cssVar('--success') || '#059669', // green
            cssVar('--info')    || '#7C3AED', // purple
            cssVar('--danger')  || '#DC2626', // red
        ];
    };

    // Surface color for chart slice borders / backgrounds — themes correctly.
    Chart.invenioSurface = function () { return cssVar('--surface') || '#ffffff'; };
    Chart.invenioToken = function (name) { return cssVar('--' + name); };

    function applyTheme() {
        const text       = cssVar('--text');
        const textMuted  = cssVar('--text-muted');
        const border     = cssVar('--border');
        const surface    = cssVar('--surface');

        Chart.defaults.color = textMuted || '#64748b';
        Chart.defaults.borderColor = border || '#e2e8f0';
        Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";

        // Tooltips
        Chart.defaults.plugins = Chart.defaults.plugins || {};
        Chart.defaults.plugins.tooltip = Chart.defaults.plugins.tooltip || {};
        Chart.defaults.plugins.tooltip.backgroundColor = surface || '#ffffff';
        Chart.defaults.plugins.tooltip.titleColor = text || '#1e293b';
        Chart.defaults.plugins.tooltip.bodyColor = textMuted || '#64748b';
        Chart.defaults.plugins.tooltip.borderColor = border || '#e2e8f0';
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.padding = 10;
        Chart.defaults.plugins.tooltip.cornerRadius = 8;

        // Grid lines on scales
        Chart.defaults.scale = Chart.defaults.scale || {};
        Chart.defaults.scale.grid = Chart.defaults.scale.grid || {};
        Chart.defaults.scale.grid.color = border || '#e2e8f0';
        Chart.defaults.scale.ticks = Chart.defaults.scale.ticks || {};
        Chart.defaults.scale.ticks.color = textMuted || '#64748b';
    }

    applyTheme();

    // Re-apply when the theme changes; also re-render any existing charts.
    const observer = new MutationObserver(() => {
        applyTheme();
        if (Chart.instances) {
            Object.values(Chart.instances).forEach((chart) => {
                try { chart.update('none'); } catch (e) { /* chart already disposed */ }
            });
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();

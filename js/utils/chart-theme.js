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

    // Categorical palette derived from Invenio tokens. Use this for any
    // dataset that needs N distinguishable colors (doughnut slices, bar
    // categories). Order is tuned for visual separation.
    Chart.invenioPalette = function () {
        return [
            cssVar('--primary')   || '#0369A1', // sky-700
            cssVar('--accent')    || '#0891B2', // cyan-600
            cssVar('--success')   || '#059669',
            cssVar('--warn')      || '#D97706',
            cssVar('--info')      || '#7C3AED',
            '#38BDF8',                          // sky-400 (lighter brand)
            '#475569',                          // slate-600
            cssVar('--text-muted')|| '#64748B',
            '#CBD5E1',                          // slate-300
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

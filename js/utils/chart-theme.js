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

    // Categorical palette in portal order: brand blue, teal accent, then
    // the status hues. Reads tokens so charts follow the active theme.
    Chart.invenioPalette = function () {
        return [
            cssVar('--primary') || '#174FDA', // brand blue — primary chart color
            cssVar('--accent')  || '#0891B2', // teal
            cssVar('--warn')    || '#D97706', // amber
            cssVar('--info')    || '#7C3AED', // purple
            cssVar('--success') || '#059669', // green
            '#60A5FA',                         // sidebar accent blue
            cssVar('--danger')  || '#DC2626', // red
            '#D63384',                         // pink
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

        Chart.defaults.color = textMuted || '#566983';
        Chart.defaults.borderColor = border || '#dde5ef';
        Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";

        // Tooltips
        Chart.defaults.plugins = Chart.defaults.plugins || {};
        Chart.defaults.plugins.tooltip = Chart.defaults.plugins.tooltip || {};
        Chart.defaults.plugins.tooltip.backgroundColor = surface || '#ffffff';
        Chart.defaults.plugins.tooltip.titleColor = text || '#122c4c';
        Chart.defaults.plugins.tooltip.bodyColor = textMuted || '#566983';
        Chart.defaults.plugins.tooltip.borderColor = border || '#dde5ef';
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.padding = 10;
        Chart.defaults.plugins.tooltip.cornerRadius = 8;

        // Grid lines on scales
        Chart.defaults.scale = Chart.defaults.scale || {};
        Chart.defaults.scale.grid = Chart.defaults.scale.grid || {};
        Chart.defaults.scale.grid.color = border || '#dde5ef';
        Chart.defaults.scale.ticks = Chart.defaults.scale.ticks || {};
        Chart.defaults.scale.ticks.color = textMuted || '#566983';
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

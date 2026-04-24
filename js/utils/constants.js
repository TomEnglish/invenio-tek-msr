/**
 * Application Constants
 * Centralized configuration values used across the application
 */

// Site Configuration (Greenfield LNG Terminal, Freeport TX)
const SITE_CONFIG = {
    LATITUDE: 28.954,
    LONGITUDE: -95.359,
    RADIUS_METERS: 500,
    NAME: 'Greenfield LNG Terminal',
    LOCATION: 'Freeport, TX'
};

// Timeframe Constants (in days)
const TIMEFRAMES = {
    DAYS_7: 7,
    DAYS_14: 14,
    DAYS_30: 30,
    DAYS_56: 56,
    TIMELINE_LOOK_BACK: 14,
    TIMELINE_LOOK_FORWARD: 56
};

// Chart palette — mirrors the Invenio design system tokens in styles.css.
// Keep these synced when tokens.ts in /InvenioStyle changes.
const COLORS = {
    // Brand
    PRIMARY: '#0369a1',      // sky-700
    ACCENT:  '#0891b2',      // cyan-600
    DARK:    '#1e293b',
    WHITE:   '#ffffff',

    // Status
    SUCCESS: '#059669',
    WARNING: '#d97706',
    ERROR:   '#dc2626',
    INFO:    '#7c3aed',

    // Neutrals
    LIGHT_GRAY:  '#f1f5f9',
    MEDIUM_GRAY: '#cbd5e1',
    DARK_GRAY:   '#64748b',
    OFF_WHITE:   '#f8fafc'
};

// Category Colors — Invenio palette extended with sky-400 / cyan-700 / slate
// for enough categorical distinguishability. Sourced from Tailwind ramps that
// match the InvenioStyle token surface.
const CATEGORY_COLORS = {
    'Design/Engineering':    '#0369A1', // primary (sky-700)
    'Procurement':           '#D97706', // warn (amber)
    'Fabrication':           '#059669', // success (green)
    'Transportation':        '#7C3AED', // info (purple)
    'Installation':          '#0891B2', // accent (cyan-600)
    'Testing/Commissioning': '#38BDF8', // sky-400 (lighter brand)
    'Startup':               '#DC2626', // danger (red)
    'Milestone':             '#475569', // slate-600
    'Other':                 '#94A3B8'  // text-subtle (slate-400)
};

// Status Badge Colors
const STATUS_COLORS = {
    'Complete': 'success',
    'In Progress': 'warning',
    'Not Started': 'secondary',
    'Overdue': 'danger',
    'On Site': 'success',
    'In Transit': 'warning',
    'Stale': 'danger',
    'No Data': 'secondary'
};

// Critical Keywords (for identifying key activities)
const CRITICAL_KEYWORDS = [
    'startup', 'first fire', 'commissioning', 'commission',
    'testing', 'synchronization', 'acceptance', 'complete',
    'delivery', 'ship', 'handover', 'final'
];

// Activity Categories
const ACTIVITY_CATEGORIES = [
    'Design/Engineering',
    'Procurement',
    'Fabrication',
    'Transportation',
    'Installation',
    'Testing/Commissioning',
    'Startup',
    'Milestone',
    'Other'
];

// Batch Sizes
const BATCH_SIZES = {
    TABLE_RENDER: 50,
    CSV_EXPORT: 1000,
    API_REQUEST: 100
};

// Export as globals for non-module scripts
window.SITE_CONFIG = SITE_CONFIG;
window.TIMEFRAMES = TIMEFRAMES;
window.COLORS = COLORS;
window.CATEGORY_COLORS = CATEGORY_COLORS;
window.STATUS_COLORS = STATUS_COLORS;
window.CRITICAL_KEYWORDS = CRITICAL_KEYWORDS;
window.ACTIVITY_CATEGORIES = ACTIVITY_CATEGORIES;
window.BATCH_SIZES = BATCH_SIZES;

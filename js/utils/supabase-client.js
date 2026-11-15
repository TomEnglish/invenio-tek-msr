/**
 * Centralized Supabase Client
 * Provides a single source of truth for Supabase configuration and client initialization
 */

// The connection comes only from supabase-config.js, which the site build
// writes for one environment (see environments.json). There is no fallback: a
// page without it must stop, never quietly reach some other environment's data.
const SUPABASE_URL = window.SUPABASE_CONFIG?.url || '';
const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.anonKey || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('This site has no connection settings (supabase-config.js). Build it with scripts/build-site.mjs, or write a local copy with scripts/environments.mjs config <name>.');
}

// Initialize Supabase client (singleton pattern)
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    window.SUPABASE_CONFIG?.options || {}
);

// A site that is not a production says so on every page (see environments.json).
// Pages with the app header show the label beside the title (sidebar.js); a
// page without one, such as sign-in, gets it in the top corner.
if (window.SUPABASE_CONFIG.kind && window.SUPABASE_CONFIG.kind !== 'production') {
    const showCornerLabel = () => {
        if (document.querySelector('script[src*="utils/sidebar.js"]') || document.querySelector('.environment-tag')) return;
        const tag = document.createElement('span');
        tag.className = 'environment-tag environment-tag-corner';
        tag.textContent = window.SUPABASE_CONFIG.label || window.SUPABASE_CONFIG.environment;
        tag.title = 'This is not a production site. Its data is sample data.';
        document.body.appendChild(tag);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showCornerLabel);
    else showCornerLabel();
}

/**
 * Get the Supabase client instance
 * @returns {Object} Supabase client
 */
function getSupabaseClient() {
    return supabaseClient;
}

/**
 * Check if Supabase is properly configured
 * @returns {boolean} True if configured
 */
function isSupabaseConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Generic data loader with error handling
 * @param {string} table - Table name
 * @param {Object} options - Query options (select, order, filter)
 * @returns {Promise<Array>} Data array
 */
async function loadFromSupabase(table, options = {}) {
    try {
        let query = supabaseClient.from(table).select(options.select || '*');

        if (options.order) {
            query = query.order(options.order.column, {
                ascending: options.order.ascending !== false,
                nullsFirst: options.order.nullsFirst || false
            });
        }

        if (options.filter) {
            Object.entries(options.filter).forEach(([key, value]) => {
                query = query.eq(key, value);
            });
        }

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) throw error;
        return data || [];

    } catch (error) {
        console.error(`Error loading from ${table}:`, error);
        throw error;
    }
}

// Export for use by other modules (also available as globals for non-module scripts)
window.supabaseClient = supabaseClient;
window.getSupabaseClient = getSupabaseClient;
window.isSupabaseConfigured = isSupabaseConfigured;
window.loadFromSupabase = loadFromSupabase;

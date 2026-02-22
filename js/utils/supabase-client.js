/**
 * Centralized Supabase Client
 * Provides a single source of truth for Supabase configuration and client initialization
 */

// Get Supabase configuration from global config or use defaults
const SUPABASE_URL = window.SUPABASE_CONFIG?.url || 'https://lzroduricxyshgyjdkki.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.anonKey || '';

// Validate configuration
if (!SUPABASE_ANON_KEY) {
    console.warn('Supabase anon key not configured. Check supabase-config.js');
}

// Initialize Supabase client (singleton pattern)
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    window.SUPABASE_CONFIG?.options || {}
);

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

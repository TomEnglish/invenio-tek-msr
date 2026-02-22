// ============================================================================
// Supabase Configuration File
// ============================================================================
// This file contains your Supabase credentials
// DO NOT commit this file to public repositories!
// ============================================================================

// Get these values from: https://app.supabase.com/project/YOUR_PROJECT/settings/api

const SUPABASE_CONFIG = {
    // Your Supabase Project URL
    // Example: https://abcdefghijklmnop.supabase.co
    url: 'https://lzroduricxyshgyjdkki.supabase.co',

    // Your Supabase Anon/Public Key
    // This is safe to use in the browser - it's designed to be public
    // Example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cm9kdXJpY3h5c2hneWpka2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NzgyMDIsImV4cCI6MjA4NzM1NDIwMn0.oX_nOPHGkUeaUKXHAb086MGCTjIwV2PQ1q1aDLvUCRs',

    // Optional: Additional configuration
    options: {
        auth: {
            // Auto refresh token
            autoRefreshToken: true,
            // Persist session in local storage
            persistSession: true,
            // Detect when user goes online/offline
            detectSessionInUrl: true
        },
        // Enable real-time subscriptions
        realtime: {
            enabled: true
        }
    }
};

// Validate configuration
function validateSupabaseConfig() {
    if (SUPABASE_CONFIG.url === 'YOUR_SUPABASE_URL_HERE') {
        console.error('❌ Supabase URL not configured!');
        console.error('Please update supabase-config.js with your Supabase URL');
        return false;
    }

    if (SUPABASE_CONFIG.anonKey === 'YOUR_SUPABASE_ANON_KEY_HERE') {
        console.error('❌ Supabase Anon Key not configured!');
        console.error('Please update supabase-config.js with your Supabase Anon Key');
        return false;
    }

    if (!SUPABASE_CONFIG.url.includes('supabase.co')) {
        console.warn('⚠️ Supabase URL format may be incorrect');
        console.warn('Expected format: https://xxxxx.supabase.co');
    }

    console.log('✓ Supabase configuration validated');
    return true;
}

// Export configuration
if (typeof window !== 'undefined') {
    window.SUPABASE_CONFIG = SUPABASE_CONFIG;
    window.validateSupabaseConfig = validateSupabaseConfig;
}

// For Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SUPABASE_CONFIG,
        validateSupabaseConfig
    };
}

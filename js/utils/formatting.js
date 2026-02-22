/**
 * Formatting Utilities
 * Shared formatting functions for dates, numbers, and strings
 */

/**
 * Format a date string for display
 * @param {string|Date} dateString - Date to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted date string
 */
function formatDate(dateString, options = {}) {
    if (!dateString) return options.fallback || 'N/A';

    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return options.fallback || 'N/A';

        const formatOptions = options.format || {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        };

        return date.toLocaleDateString('en-US', formatOptions);
    } catch (e) {
        return options.fallback || 'N/A';
    }
}

/**
 * Format a date with time
 * @param {string|Date} dateString - Date to format
 * @returns {string} Formatted date and time string
 */
function formatDateTime(dateString) {
    if (!dateString) return 'N/A';

    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'N/A';

        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    } catch (e) {
        return 'N/A';
    }
}

/**
 * Get relative time ago string
 * @param {Date} date - Date to compare
 * @returns {string} Relative time string
 */
function getTimeAgo(date) {
    if (!date) return 'Never';

    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

    return date.toLocaleDateString();
}

/**
 * Calculate days between two dates
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date (defaults to today)
 * @returns {number} Number of days
 */
function getDaysBetween(date1, date2 = new Date()) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);
    return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}

/**
 * Get today at midnight
 * @returns {Date} Today's date at midnight
 */
function getToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

/**
 * Format a number with locale-specific separators
 * @param {number} num - Number to format
 * @param {number} decimals - Decimal places (default 0)
 * @returns {string} Formatted number
 */
function formatNumber(num, decimals = 0) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return Number(num).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

/**
 * Format a number as currency
 * @param {number} value - Value to format
 * @param {string} currency - Currency code (default USD)
 * @returns {string} Formatted currency string
 */
function formatCurrency(value, currency = 'USD') {
    if (value === null || value === undefined || isNaN(value)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(value);
}

/**
 * Truncate a string to a maximum length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add (default '...')
 * @returns {string} Truncated string
 */
function truncate(str, maxLength, suffix = '...') {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Capitalize first letter of a string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Format percentage
 * @param {number} value - Value (0-100 or 0-1)
 * @param {boolean} isDecimal - Whether value is decimal (0-1)
 * @returns {string} Formatted percentage
 */
function formatPercent(value, isDecimal = false) {
    if (value === null || value === undefined || isNaN(value)) return '0%';
    const pct = isDecimal ? value * 100 : value;
    return `${Math.round(pct)}%`;
}

// Export as globals for non-module scripts
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.getTimeAgo = getTimeAgo;
window.getDaysBetween = getDaysBetween;
window.getToday = getToday;
window.formatNumber = formatNumber;
window.formatCurrency = formatCurrency;
window.truncate = truncate;
window.capitalizeFirst = capitalizeFirst;
window.formatPercent = formatPercent;

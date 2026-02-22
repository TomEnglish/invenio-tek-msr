/**
 * Export Utilities
 * Shared functions for exporting data to various formats
 */

/**
 * Export data to CSV file
 * @param {string} filename - Filename (without extension)
 * @param {Array<string>} headers - Column headers
 * @param {Array<Array>} rows - Data rows (array of arrays)
 * @param {Object} options - Export options
 */
function exportToCSV(filename, headers, rows, options = {}) {
    try {
        // Build CSV content
        const csvContent = [
            headers.join(','),
            ...rows.map(row =>
                row.map(cell => {
                    // Handle cells that need quoting
                    const cellStr = String(cell ?? '');
                    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                        return `"${cellStr.replace(/"/g, '""')}"`;
                    }
                    return cellStr;
                }).join(',')
            )
        ].join('\n');

        // Create and trigger download
        downloadFile(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');

        if (options.onSuccess) {
            options.onSuccess();
        }

        console.log(`Exported ${rows.length} rows to ${filename}.csv`);

    } catch (error) {
        console.error('Export failed:', error);
        if (options.onError) {
            options.onError(error);
        }
    }
}

/**
 * Export data from array of objects to CSV
 * @param {string} filename - Filename (without extension)
 * @param {Array<Object>} data - Data array
 * @param {Array<Object>} columns - Column definitions [{key, header, format}]
 */
function exportDataToCSV(filename, data, columns) {
    const headers = columns.map(col => col.header || col.key);

    const rows = data.map(item =>
        columns.map(col => {
            let value = item[col.key];
            if (col.format) {
                value = col.format(value, item);
            }
            return value;
        })
    );

    exportToCSV(filename, headers, rows);
}

/**
 * Download a file
 * @param {string} content - File content
 * @param {string} filename - Filename with extension
 * @param {string} mimeType - MIME type
 */
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(url);
}

/**
 * Generate timestamped filename
 * @param {string} baseName - Base filename
 * @param {string} extension - File extension (without dot)
 * @returns {string} Filename with timestamp
 */
function generateFilename(baseName, extension = 'csv') {
    const timestamp = new Date().toISOString().split('T')[0];
    return `${baseName}_${timestamp}.${extension}`;
}

/**
 * Export table to CSV by reading DOM
 * @param {string} tableId - Table element ID
 * @param {string} filename - Output filename
 */
function exportTableToCSV(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) {
        console.error(`Table ${tableId} not found`);
        return;
    }

    const rows = [];

    // Get headers
    const headerCells = table.querySelectorAll('thead th');
    const headers = Array.from(headerCells).map(th => th.textContent.trim());

    // Get data rows
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const rowData = Array.from(cells).map(td => td.textContent.trim());
        if (rowData.some(cell => cell)) { // Skip empty rows
            rows.push(rowData);
        }
    });

    exportToCSV(filename, headers, rows);
}

// Export as globals for non-module scripts
window.exportToCSV = exportToCSV;
window.exportDataToCSV = exportDataToCSV;
window.downloadFile = downloadFile;
window.generateFilename = generateFilename;
window.exportTableToCSV = exportTableToCSV;

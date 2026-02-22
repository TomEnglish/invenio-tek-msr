// Project Schedule Dashboard
// Displays and manages project schedule data from Supabase
// Uses shared utilities from js/utils/

// ============================================================================
// APPLICATION STATE
// ============================================================================
let scheduleData = [];
let filteredData = [];

// Supabase client is initialized by js/utils/supabase-client.js

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Project Schedule Dashboard initializing...');
    loadScheduleData();
    setupEventListeners();
});

// Load schedule data from Supabase
async function loadScheduleData() {
    try {
        console.log('Loading project schedule from Supabase...');

        const { data, error } = await supabaseClient
            .from('project_schedule')
            .select('*')
            .order('start_date', { ascending: true, nullsFirst: false });

        if (error) throw error;

        scheduleData = data || [];
        filteredData = scheduleData;

        console.log(`Loaded ${scheduleData.length} schedule activities`);

        updateStatistics();
        populateFilters();
        renderScheduleTable();
        renderUpcomingMilestones();
        renderCriticalPathAnalysis();
        renderScheduleHealth();
        renderCategoryChart();
        loadIntegrationInsights();

    } catch (error) {
        console.error('Error loading schedule data:', error);
        document.getElementById('scheduleTableBody').innerHTML =
            '<tr><td colspan="9" class="text-center py-4 text-danger">Error loading schedule data. Please refresh the page.</td></tr>';
    }
}

// Update statistics cards
function updateStatistics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const milestones = scheduleData.filter(a => a.is_milestone === true);
    const critical = scheduleData.filter(a => a.is_critical === true);

    const upcoming = scheduleData.filter(activity => {
        if (!activity.start_date && !activity.finish_date) return false;

        const startDate = activity.start_date ? new Date(activity.start_date) : null;
        const finishDate = activity.finish_date ? new Date(activity.finish_date) : null;

        if (startDate) {
            startDate.setHours(0, 0, 0, 0);
            if (startDate >= today && startDate <= thirtyDaysFromNow) return true;
        }

        if (finishDate) {
            finishDate.setHours(0, 0, 0, 0);
            if (finishDate >= today && finishDate <= thirtyDaysFromNow) return true;
        }

        return false;
    });

    document.getElementById('totalActivities').textContent = scheduleData.length;
    document.getElementById('totalMilestones').textContent = milestones.length;
    document.getElementById('upcomingActivities').textContent = upcoming.length;
    document.getElementById('criticalActivities').textContent = critical.length;
}

// Populate filter dropdowns
function populateFilters() {
    // Activity Types
    const types = [...new Set(scheduleData.map(a => a.activity_type).filter(Boolean))].sort();
    const typeSelect = document.getElementById('filterActivityType');
    typeSelect.innerHTML = '<option value="">All Types</option>';
    types.forEach(type => {
        typeSelect.innerHTML += `<option value="${type}">${type}</option>`;
    });

    // Categories
    const categories = [...new Set(scheduleData.map(a => a.category).filter(Boolean))].sort();
    const categorySelect = document.getElementById('filterCategory');
    categorySelect.innerHTML = '<option value="">All Categories</option>';
    categories.forEach(category => {
        categorySelect.innerHTML += `<option value="${category}">${category}</option>`;
    });
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('filterActivityType').addEventListener('change', applyFilters);
    document.getElementById('filterCategory').addEventListener('change', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterView').addEventListener('change', applyFilters);
    document.getElementById('btnExport').addEventListener('click', exportToExcel);

    // View toggles
    document.getElementById('btnTableView').addEventListener('click', () => switchView('table'));
    document.getElementById('btnTimelineView').addEventListener('click', () => switchView('timeline'));
}

// Apply filters
function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const typeFilter = document.getElementById('filterActivityType').value;
    const categoryFilter = document.getElementById('filterCategory').value;
    const statusFilter = document.getElementById('filterStatus').value;
    const viewFilter = document.getElementById('filterView').value;

    filteredData = scheduleData.filter(activity => {
        // Search filter
        if (searchTerm) {
            const searchableText = [
                activity.activity_id,
                activity.activity_name
            ].join(' ').toLowerCase();

            if (!searchableText.includes(searchTerm)) return false;
        }

        // Type filter
        if (typeFilter && activity.activity_type !== typeFilter) return false;

        // Category filter
        if (categoryFilter && activity.category !== categoryFilter) return false;

        // Status filter
        if (statusFilter && activity.status !== statusFilter) return false;

        // View filter
        if (viewFilter === 'milestones' && !activity.is_milestone) return false;
        if (viewFilter === 'work' && activity.is_milestone) return false;

        return true;
    });

    renderScheduleTable();
}

// Render schedule table
function renderScheduleTable() {
    const tbody = document.getElementById('scheduleTableBody');
    document.getElementById('resultCount').textContent = filteredData.length;

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No activities found</td></tr>';
        return;
    }

    const rows = filteredData.map(activity => {
        // Format dates
        const startDate = activity.start_date ? formatDate(activity.start_date) : 'N/A';
        const finishDate = activity.finish_date ? formatDate(activity.finish_date) : 'N/A';

        // Duration display
        const duration = activity.is_milestone ?
            '<span class="badge bg-success">Milestone</span>' :
            (activity.remaining_duration ? `${activity.remaining_duration} days` : 'N/A');

        // Status badge
        let statusBadge = '';
        switch(activity.status) {
            case 'Complete':
                statusBadge = '<span class="badge bg-success">Complete</span>';
                break;
            case 'In Progress':
                statusBadge = '<span class="badge bg-warning">In Progress</span>';
                break;
            case 'Not Started':
                statusBadge = '<span class="badge bg-secondary">Not Started</span>';
                break;
            default:
                statusBadge = '<span class="badge bg-light text-dark">Unknown</span>';
        }

        // Progress bar
        const progress = activity.percent_complete || 0;
        const progressBar = `
            <div class="progress" style="height: 20px;">
                <div class="progress-bar ${progress === 100 ? 'bg-success' : (progress > 0 ? 'bg-warning' : 'bg-secondary')}"
                     role="progressbar"
                     style="width: ${progress}%"
                     aria-valuenow="${progress}"
                     aria-valuemin="0"
                     aria-valuemax="100">
                    ${progress}%
                </div>
            </div>
        `;

        // Critical indicator
        const activityName = activity.is_critical ?
            `<i class="fas fa-exclamation-triangle text-danger me-1" title="Critical Path"></i>${activity.activity_name}` :
            activity.activity_name;

        return `
            <tr>
                <td><code>${activity.activity_id || 'N/A'}</code></td>
                <td>${activityName || 'N/A'}</td>
                <td>${activity.activity_type || 'N/A'}</td>
                <td>${activity.category || 'N/A'}</td>
                <td>${startDate}</td>
                <td>${finishDate}</td>
                <td>${duration}</td>
                <td>${statusBadge}</td>
                <td style="min-width: 120px;">${progressBar}</td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rows;
}

// Switch between table and timeline views
function switchView(view) {
    const tableView = document.getElementById('tableView');
    const timelineView = document.getElementById('timelineView');
    const btnTable = document.getElementById('btnTableView');
    const btnTimeline = document.getElementById('btnTimelineView');

    if (view === 'table') {
        tableView.style.display = 'block';
        timelineView.style.display = 'none';
        btnTable.classList.add('active');
        btnTimeline.classList.remove('active');
    } else {
        tableView.style.display = 'none';
        timelineView.style.display = 'block';
        btnTable.classList.remove('active');
        btnTimeline.classList.add('active');
        renderTimeline();
    }
}

// Render timeline (Gantt-style)
function renderTimeline() {
    const container = document.getElementById('timelineContainer');

    if (filteredData.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-4">No activities to display</p>';
        return;
    }

    // Get today's date for relevance filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Define the relevant time window: 2 weeks back to 8 weeks forward
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - 14); // 2 weeks ago

    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + 56); // 8 weeks from now

    // Get date range - filter for RELEVANT activities (active now or upcoming soon)
    const activitiesWithDates = filteredData.filter(a => {
        const hasValidDates = a.start_date && a.finish_date;
        const hasValidName = a.activity_name &&
                            a.activity_name.trim() !== '' &&
                            a.activity_name.toLowerCase() !== 'n/a';
        const hasCategory = a.category && a.category !== 'Other';

        if (!hasValidDates || !hasValidName || !hasCategory) return false;

        const startDate = new Date(a.start_date);
        const finishDate = new Date(a.finish_date);
        startDate.setHours(0, 0, 0, 0);
        finishDate.setHours(0, 0, 0, 0);

        // Include if activity overlaps with our viewing window
        // Activity is relevant if:
        // 1. Currently in progress (started before today, finishes after today)
        // 2. Starting soon (starts within our window)
        // 3. Finishing soon (finishes within our window)
        const isInProgress = startDate <= today && finishDate >= today;
        const startsInWindow = startDate >= windowStart && startDate <= windowEnd;
        const finishesInWindow = finishDate >= windowStart && finishDate <= windowEnd;
        const spansWindow = startDate <= windowStart && finishDate >= windowEnd;

        return isInProgress || startsInWindow || finishesInWindow || spansWindow;
    });

    if (activitiesWithDates.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-4">No activities in the current time window (2 weeks past to 8 weeks ahead). Try adjusting filters or check back later.</p>';
        return;
    }

    // Use the viewing window as our timeline bounds (centered on today)
    const minDate = windowStart;
    const maxDate = windowEnd;

    // Calculate total days
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
    const pixelsPerDay = 3; // Adjust for zoom level
    const timelineWidth = totalDays * pixelsPerDay;

    // Category colors
    const categoryColors = {
        'Design/Engineering': '#4a90e2',
        'Procurement': '#f5a623',
        'Fabrication': '#7ed321',
        'Transportation': '#9013fe',
        'Installation': '#50e3c2',
        'Testing/Commissioning': '#bd10e0',
        'Startup': '#d0021b',
        'Milestone': '#d4b896',
        'Other': '#9b9b9b'
    };

    // Build timeline HTML
    let html = `
        <div style="min-width: ${Math.max(timelineWidth, 800)}px; position: relative;">
            <!-- Timeline Header -->
            <div style="position: sticky; top: 0; background: white; z-index: 10; padding: 10px 0; border-bottom: 2px solid #ddd; margin-bottom: 10px;">
                <div style="display: flex; align-items: center;">
                    <div style="width: 300px; font-weight: bold; padding-left: 10px;">Activity</div>
                    <div style="flex: 1; position: relative; height: 40px;">
                        <div style="position: absolute; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 12px; color: #666;">
    `;

    // Add month markers
    const months = [];
    let currentDate = new Date(minDate);
    while (currentDate <= maxDate) {
        const month = currentDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const daysFromStart = Math.ceil((currentDate - minDate) / (1000 * 60 * 60 * 24));
        const position = daysFromStart * pixelsPerDay;

        html += `<div style="position: absolute; left: ${position}px; border-left: 1px solid #ccc; padding-left: 5px; height: 40px;">
                    <div style="font-weight: bold;">${month}</div>
                 </div>`;

        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    html += `
                        </div>
                    </div>
                </div>
            </div>

            <!-- Timeline Activities -->
            <div style="padding: 0; position: relative;">
    `;

    // Add "Today" marker if within date range
    if (today >= minDate && today <= maxDate) {
        const todayOffset = Math.ceil((today - minDate) / (1000 * 60 * 60 * 24));
        const todayPosition = todayOffset * pixelsPerDay + 300; // Add 300px for activity name column
        html += `
            <div style="position: absolute; left: ${todayPosition}px; top: 0; bottom: 0; width: 2px; background: #d0021b; z-index: 5;">
                <div style="position: sticky; top: 50px; background: #d0021b; color: white; padding: 2px 6px; font-size: 11px; font-weight: bold; border-radius: 3px; white-space: nowrap;">
                    TODAY
                </div>
            </div>
        `;
    }

    html += `
    `;

    // Sort by relevance to TODAY:
    // 1. In-progress activities (sorted by finish date - soonest first)
    // 2. Activities starting soon (sorted by start date)
    // 3. Milestones get priority within each group
    const sortedActivities = [...activitiesWithDates].sort((a, b) => {
        const aStart = new Date(a.start_date);
        const aFinish = new Date(a.finish_date);
        const bStart = new Date(b.start_date);
        const bFinish = new Date(b.finish_date);

        const aInProgress = aStart <= today && aFinish >= today;
        const bInProgress = bStart <= today && bFinish >= today;

        // In-progress activities come first
        if (aInProgress !== bInProgress) {
            return aInProgress ? -1 : 1;
        }

        // Within same group, milestones come first
        if (a.is_milestone !== b.is_milestone) {
            return a.is_milestone ? -1 : 1;
        }

        // Then by finish date (soonest first for urgency)
        if (aFinish.getTime() !== bFinish.getTime()) {
            return aFinish - bFinish;
        }

        // Finally by start date
        return aStart - bStart;
    });

    // Show more activities since we've already filtered to relevant window
    const maxActivities = 40;
    const displayActivities = sortedActivities.slice(0, maxActivities);

    // Render each activity
    displayActivities.forEach(activity => {
        const start = new Date(activity.start_date);
        const finish = new Date(activity.finish_date);

        const startOffset = Math.ceil((start - minDate) / (1000 * 60 * 60 * 24));
        const duration = Math.ceil((finish - start) / (1000 * 60 * 60 * 24));

        const left = startOffset * pixelsPerDay;
        const width = Math.max(duration * pixelsPerDay, 2);

        const color = categoryColors[activity.category] || categoryColors['Other'];
        const isMilestone = activity.is_milestone;
        const isCritical = activity.is_critical;
        const isInProgress = start <= today && finish >= today;

        // Activity row with better formatting
        const activityLabel = activity.activity_name.length > 40 ?
            activity.activity_name.substring(0, 40) + '...' :
            activity.activity_name;

        // Build badge HTML - prioritize showing status
        let badgeHtml = '';
        if (isMilestone) {
            badgeHtml = '<span class="badge bg-success" style="font-size: 9px; margin-left: 5px;">MILESTONE</span>';
        } else if (isInProgress) {
            badgeHtml = '<span class="badge bg-primary" style="font-size: 9px; margin-left: 5px;">IN PROGRESS</span>';
        } else if (isCritical) {
            badgeHtml = '<span class="badge bg-danger" style="font-size: 9px; margin-left: 5px;">CRITICAL</span>';
        }

        // Determine row background based on status
        let rowBg = 'white';
        if (isInProgress) rowBg = '#e8f4fd';  // Light blue for in-progress
        else if (isCritical) rowBg = '#fff5f5';  // Light red for critical
        else if (isMilestone) rowBg = '#f0fff4';  // Light green for milestones

        html += `
            <div style="display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0; min-height: 45px; background: ${rowBg};">
                <div style="width: 350px; padding-left: 10px; font-size: 13px;">
                    ${isInProgress ? '<i class="fas fa-play-circle text-primary me-1" title="In Progress"></i>' : ''}
                    ${isCritical ? '<i class="fas fa-exclamation-triangle text-danger me-1" title="Critical"></i>' : ''}
                    ${isMilestone ? '<i class="fas fa-flag text-success me-1" title="Milestone"></i>' : ''}
                    <span title="${activity.activity_name}"><strong>${activityLabel}</strong></span>
                    ${badgeHtml}
                    <br>
                    <small class="text-muted">
                        <i class="fas fa-hashtag" style="font-size: 9px;"></i> ${activity.activity_id || 'N/A'}
                        <span class="mx-1">|</span>
                        <i class="fas fa-tag" style="font-size: 9px;"></i> ${activity.category || 'N/A'}
                    </small>
                </div>
                <div style="flex: 1; position: relative; height: 30px;">
        `;

        if (isMilestone) {
            // Diamond shape for milestones
            html += `
                <div style="position: absolute; left: ${left}px; top: 5px; width: 0; height: 0;
                     border-left: 10px solid transparent; border-right: 10px solid transparent;
                     border-bottom: 10px solid ${color}; transform: rotate(45deg);"
                     title="${activity.activity_name} - ${formatDate(activity.finish_date)}">
                </div>
            `;
        } else {
            // Bar for regular activities
            const progress = activity.percent_complete || 0;
            html += `
                <div style="position: absolute; left: ${left}px; top: 8px; width: ${width}px; height: 16px;
                     background: ${color}; border-radius: 3px; opacity: 0.9; cursor: pointer;"
                     title="${activity.activity_name}
Start: ${formatDate(activity.start_date)}
Finish: ${formatDate(activity.finish_date)}
Progress: ${progress}%">
                    ${progress > 0 ? `<div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${progress}%; background: rgba(0,0,0,0.2); border-radius: 3px;"></div>` : ''}
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    });

    html += `
            </div>

            <!-- Info Message -->
            <div class="alert alert-info mt-3 mb-3">
                <i class="fas fa-info-circle me-2"></i>
                <strong>Timeline View:</strong> Showing ${displayActivities.length} activities relevant to today
                (${sortedActivities.length > maxActivities ? `${maxActivities} of ${sortedActivities.length} in window, ` : ''}2 weeks past → 8 weeks ahead).
                In-progress activities shown first, sorted by finish date.
            </div>
        </div>

        <!-- Legend -->
        <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
            <strong>Legend:</strong>
            <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-top: 10px;">
    `;

    Object.entries(categoryColors).forEach(([category, color]) => {
        html += `
            <div style="display: flex; align-items: center; gap: 5px;">
                <div style="width: 20px; height: 12px; background: ${color}; border-radius: 2px;"></div>
                <span style="font-size: 13px;">${category}</span>
            </div>
        `;
    });

    html += `
                <div style="display: flex; align-items: center; gap: 5px;">
                    <i class="fas fa-exclamation-triangle text-danger"></i>
                    <span style="font-size: 13px;">Critical Path</span>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

// Render upcoming milestones
function renderUpcomingMilestones() {
    const container = document.getElementById('upcomingMilestonesContainer');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get milestones that haven't finished yet
    const upcomingMilestones = scheduleData
        .filter(activity => {
            if (!activity.is_milestone) return false;
            if (!activity.finish_date) return false;

            const finishDate = new Date(activity.finish_date);
            finishDate.setHours(0, 0, 0, 0);

            return finishDate >= today;
        })
        .sort((a, b) => {
            const dateA = new Date(a.finish_date);
            const dateB = new Date(b.finish_date);
            return dateA - dateB;
        })
        .slice(0, 10); // Show top 10

    if (upcomingMilestones.length === 0) {
        container.innerHTML = '<p class="text-muted mb-0">No upcoming milestones found</p>';
        return;
    }

    const milestonesList = upcomingMilestones.map(milestone => {
        const finishDate = new Date(milestone.finish_date);
        finishDate.setHours(0, 0, 0, 0);

        const daysUntil = Math.ceil((finishDate - today) / (1000 * 60 * 60 * 24));

        let urgencyClass = '';
        let urgencyText = '';

        if (daysUntil === 0) {
            urgencyClass = 'text-danger';
            urgencyText = 'Today';
        } else if (daysUntil <= 7) {
            urgencyClass = 'text-warning';
            urgencyText = `In ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;
        } else if (daysUntil <= 30) {
            urgencyClass = 'text-info';
            urgencyText = `In ${daysUntil} days`;
        } else {
            urgencyClass = 'text-muted';
            urgencyText = `In ${daysUntil} days`;
        }

        const criticalIcon = milestone.is_critical ?
            '<i class="fas fa-exclamation-triangle text-danger me-2"></i>' : '';

        return `
            <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                <div class="flex-grow-1">
                    <div>
                        ${criticalIcon}
                        <strong>${milestone.activity_name}</strong>
                    </div>
                    <small class="text-muted">
                        <i class="fas fa-tag me-1"></i>${milestone.activity_id || 'N/A'}
                        ${milestone.category ? ` | ${milestone.category}` : ''}
                    </small>
                </div>
                <div class="text-end ms-3">
                    <div class="${urgencyClass}"><strong>${urgencyText}</strong></div>
                    <small class="text-muted">${formatDate(milestone.finish_date)}</small>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = milestonesList;
}

// Render key activities (smart identification for next 30 days)
function renderCriticalPathAnalysis() {
    const container = document.getElementById('criticalPathContainer');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysOut = new Date(today);
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);

    // Smart identification of key activities:
    // 1. Milestones finishing in next 30 days
    // 2. Activities with critical keywords finishing in next 30 days
    // 3. Activities marked as critical (if any)
    // 4. In-progress activities finishing soon

    const keyActivities = scheduleData.filter(activity => {
        // Must have valid finish date
        if (!activity.finish_date) return false;

        const finishDate = new Date(activity.finish_date);
        finishDate.setHours(0, 0, 0, 0);

        // Must finish within next 30 days
        if (finishDate < today || finishDate > thirtyDaysOut) return false;

        // Must have valid name
        if (!activity.activity_name || activity.activity_name.trim() === '' ||
            activity.activity_name.toLowerCase() === 'n/a') return false;

        // Include if any of these conditions:
        const isMilestone = activity.is_milestone === true;
        const isCriticalMarked = activity.is_critical === true;
        const isInProgress = activity.status === 'In Progress';

        // Check for critical keywords
        const nameText = activity.activity_name.toLowerCase();
        const criticalKeywords = [
            'startup', 'first fire', 'commissioning', 'commission',
            'testing', 'synchronization', 'acceptance', 'complete',
            'delivery', 'ship', 'handover', 'final'
        ];
        const hasCriticalKeyword = criticalKeywords.some(keyword => nameText.includes(keyword));

        return isMilestone || isCriticalMarked || isInProgress || hasCriticalKeyword;
    });

    if (keyActivities.length === 0) {
        container.innerHTML = `
            <div class="alert alert-success mb-0">
                <i class="fas fa-check-circle me-2"></i>
                No key activities or milestones finishing in the next 30 days
            </div>
        `;
        return;
    }

    // Sort by finish date (most urgent first)
    const sorted = keyActivities.sort((a, b) => {
        const dateA = new Date(a.finish_date);
        const dateB = new Date(b.finish_date);
        return dateA - dateB;
    });

    const html = `
        <div class="mb-3">
            <div class="alert alert-info mb-3">
                <i class="fas fa-star me-2"></i>
                <strong>${keyActivities.length}</strong> key activities identified in next 30 days
            </div>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
            ${sorted.slice(0, 15).map(activity => {
                const status = activity.status || 'Unknown';
                let statusClass = 'secondary';
                if (status === 'Complete') statusClass = 'success';
                else if (status === 'In Progress') statusClass = 'warning';
                else if (status === 'Not Started') statusClass = 'secondary';
                else if (status === 'Overdue') statusClass = 'danger';

                // Calculate days until finish
                const finishDate = new Date(activity.finish_date);
                const daysUntil = Math.ceil((finishDate - today) / (1000 * 60 * 60 * 24));

                let urgencyBadge = '';
                if (daysUntil <= 7) {
                    urgencyBadge = '<span class="badge bg-danger ms-2">Urgent</span>';
                } else if (daysUntil <= 14) {
                    urgencyBadge = '<span class="badge bg-warning ms-2">Soon</span>';
                }

                const milestoneBadge = activity.is_milestone ?
                    '<span class="badge bg-success ms-1">Milestone</span>' : '';

                return `
                    <div class="border-bottom pb-2 mb-2">
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="flex-grow-1">
                                <strong>${activity.activity_name || 'Unnamed'}</strong>
                                ${milestoneBadge}
                                ${urgencyBadge}
                                <br>
                                <small class="text-muted">
                                    ${activity.activity_id || 'N/A'} | ${activity.category || 'N/A'}
                                </small>
                            </div>
                            <span class="badge bg-${statusClass}">${status}</span>
                        </div>
                        <div class="mt-1">
                            <small>
                                <i class="fas fa-calendar me-1"></i>${formatDate(activity.start_date)} → ${formatDate(activity.finish_date)}
                                <span class="ms-2 text-primary"><strong>${daysUntil} day${daysUntil !== 1 ? 's' : ''}</strong></span>
                            </small>
                        </div>
                        <div class="progress mt-2" style="height: 8px;">
                            <div class="progress-bar bg-${statusClass}" style="width: ${activity.percent_complete || 0}%"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        ${sorted.length > 15 ? `<p class="text-muted mt-2 mb-0"><small>Showing 15 of ${sorted.length} key activities</small></p>` : ''}
    `;

    container.innerHTML = html;
}

// Render schedule health metrics
function renderScheduleHealth() {
    const container = document.getElementById('scheduleHealthContainer');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const complete = scheduleData.filter(a => a.status === 'Complete').length;
    const inProgress = scheduleData.filter(a => a.status === 'In Progress').length;
    const notStarted = scheduleData.filter(a => a.status === 'Not Started').length;

    // Calculate overdue activities (finish date in past but not complete)
    const overdue = scheduleData.filter(a => {
        if (a.status === 'Complete') return false;
        if (!a.finish_date) return false;
        const finishDate = new Date(a.finish_date);
        finishDate.setHours(0, 0, 0, 0);
        return finishDate < today;
    }).length;

    // Calculate on-time percentage
    const totalWithDates = scheduleData.filter(a => a.finish_date).length;
    const onTimePercentage = totalWithDates > 0 ? Math.round(((complete + inProgress - overdue) / totalWithDates) * 100) : 0;

    const html = `
        <div class="row g-3 mb-3">
            <div class="col-6">
                <div class="text-center p-3 border rounded">
                    <h2 class="mb-0 text-success">${complete}</h2>
                    <small class="text-muted">Complete</small>
                </div>
            </div>
            <div class="col-6">
                <div class="text-center p-3 border rounded">
                    <h2 class="mb-0 text-warning">${inProgress}</h2>
                    <small class="text-muted">In Progress</small>
                </div>
            </div>
            <div class="col-6">
                <div class="text-center p-3 border rounded">
                    <h2 class="mb-0 text-secondary">${notStarted}</h2>
                    <small class="text-muted">Not Started</small>
                </div>
            </div>
            <div class="col-6">
                <div class="text-center p-3 border rounded ${overdue > 0 ? 'bg-danger text-white' : ''}">
                    <h2 class="mb-0">${overdue}</h2>
                    <small>Overdue</small>
                </div>
            </div>
        </div>

        <div class="mb-3">
            <div class="d-flex justify-content-between mb-1">
                <span>Schedule Performance</span>
                <span><strong>${onTimePercentage}%</strong></span>
            </div>
            <div class="progress" style="height: 25px;">
                <div class="progress-bar ${onTimePercentage >= 80 ? 'bg-success' : onTimePercentage >= 60 ? 'bg-warning' : 'bg-danger'}"
                     style="width: ${onTimePercentage}%">
                    ${onTimePercentage >= 80 ? 'Healthy' : onTimePercentage >= 60 ? 'At Risk' : 'Critical'}
                </div>
            </div>
        </div>

        <div class="alert ${overdue > 0 ? 'alert-danger' : 'alert-success'} mb-0">
            <i class="fas ${overdue > 0 ? 'fa-exclamation-triangle' : 'fa-check-circle'} me-2"></i>
            ${overdue > 0 ?
                `<strong>Action Required:</strong> ${overdue} activities are past their finish date` :
                '<strong>On Track:</strong> No overdue activities'}
        </div>
    `;

    container.innerHTML = html;
}

// Render category chart
function renderCategoryChart() {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;

    // Group by category
    const categoryCounts = {};
    scheduleData.forEach(activity => {
        const category = activity.category || 'Other';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    const labels = Object.keys(categoryCounts);
    const data = Object.values(categoryCounts);

    const colors = [
        '#4a90e2', '#f5a623', '#7ed321', '#9013fe',
        '#50e3c2', '#bd10e0', '#d0021b', '#d4b896', '#9b9b9b'
    ];

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 15,
                        font: {
                            size: 11
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

// formatDate is now provided by js/utils/formatting.js

// Export to Excel
function exportToExcel() {
    console.log('Exporting to CSV...');

    const headers = ['Activity ID', 'Activity Name', 'Type', 'Category', 'Start Date', 'Finish Date', 'Duration (Days)', 'Status', 'Progress %', 'Is Milestone', 'Is Critical'];
    let csv = headers.join(',') + '\n';

    filteredData.forEach(activity => {
        const row = [
            activity.activity_id || '',
            `"${(activity.activity_name || '').replace(/"/g, '""')}"`,
            activity.activity_type || '',
            activity.category || '',
            activity.start_date || '',
            activity.finish_date || '',
            activity.is_milestone ? '0' : (activity.remaining_duration || ''),
            activity.status || '',
            activity.percent_complete || 0,
            activity.is_milestone ? 'Yes' : 'No',
            activity.is_critical ? 'Yes' : 'No'
        ];
        csv += row.join(',') + '\n';
    });

    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `project_schedule_${timestamp}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('Export complete');
}

// Load integration insights
async function loadIntegrationInsights() {
    try {
        console.log('Loading integration insights...');

        // Load POs, Shipments, and Installation data from Supabase
        const [posResult, shipmentsResult] = await Promise.all([
            supabaseClient.from('purchase_orders').select('*'),
            supabaseClient.from('shipments').select('*')
        ]);

        const poData = posResult.data || [];
        const shipmentData = shipmentsResult.data || [];

        // Also try to load installation data from JSON (fallback)
        let installationData = [];
        try {
            const installResp = await fetch('dashboard_data/audit_data.json');
            installationData = await installResp.json();
        } catch (e) {
            console.log('Installation data not available');
        }

        renderProcurementIntegration(poData);
        renderTransportationIntegration(shipmentData);
        renderInstallationIntegration(installationData);

    } catch (error) {
        console.error('Error loading integration insights:', error);
    }
}

// Render procurement integration
function renderProcurementIntegration(poData) {
    const container = document.getElementById('procurementIntegration');

    // Find procurement-related activities
    const procurementActivities = scheduleData.filter(a =>
        a.category === 'Procurement' || (a.activity_type && a.activity_type.toLowerCase().includes('procure'))
    );

    const html = `
        <div class="mb-2">
            <div class="d-flex justify-content-between">
                <span class="text-muted small">Schedule Activities:</span>
                <strong>${procurementActivities.length}</strong>
            </div>
            <div class="d-flex justify-content-between">
                <span class="text-muted small">Active POs:</span>
                <strong>${poData.length}</strong>
            </div>
        </div>
        <div class="progress mb-2" style="height: 20px;">
            <div class="progress-bar bg-warning" style="width: ${procurementActivities.length > 0 ? Math.round((procurementActivities.filter(a => a.status === 'Complete').length / procurementActivities.length) * 100) : 0}%">
                ${procurementActivities.length > 0 ? Math.round((procurementActivities.filter(a => a.status === 'Complete').length / procurementActivities.length) * 100) : 0}%
            </div>
        </div>
        <small class="text-muted">
            ${procurementActivities.filter(a => a.status === 'Complete').length} of ${procurementActivities.length} procurement activities complete
        </small>
    `;

    container.innerHTML = html;
}

// Render transportation integration
function renderTransportationIntegration(shipmentData) {
    const container = document.getElementById('transportationIntegration');

    // Find transportation-related activities
    const transportActivities = scheduleData.filter(a =>
        a.category === 'Transportation' ||
        (a.activity_name && (
            a.activity_name.toLowerCase().includes('ship') ||
            a.activity_name.toLowerCase().includes('transport') ||
            a.activity_name.toLowerCase().includes('deliver')
        ))
    );

    const deliveredShipments = shipmentData.filter(s => s.status === 'Delivered').length;

    const html = `
        <div class="mb-2">
            <div class="d-flex justify-content-between">
                <span class="text-muted small">Schedule Activities:</span>
                <strong>${transportActivities.length}</strong>
            </div>
            <div class="d-flex justify-content-between">
                <span class="text-muted small">Tracked Shipments:</span>
                <strong>${shipmentData.length}</strong>
            </div>
            <div class="d-flex justify-content-between">
                <span class="text-muted small">Delivered:</span>
                <strong class="text-success">${deliveredShipments}</strong>
            </div>
        </div>
        <div class="progress mb-2" style="height: 20px;">
            <div class="progress-bar bg-primary" style="width: ${shipmentData.length > 0 ? Math.round((deliveredShipments / shipmentData.length) * 100) : 0}%">
                ${shipmentData.length > 0 ? Math.round((deliveredShipments / shipmentData.length) * 100) : 0}%
            </div>
        </div>
        <small class="text-muted">
            ${deliveredShipments} of ${shipmentData.length} shipments delivered
        </small>
    `;

    container.innerHTML = html;
}

// Render installation integration
function renderInstallationIntegration(installationData) {
    const container = document.getElementById('installationIntegration');

    // Find installation-related activities
    const installActivities = scheduleData.filter(a =>
        a.category === 'Installation' ||
        (a.activity_type && a.activity_type.toLowerCase().includes('install'))
    );

    const totalInstallItems = installationData.length;

    const html = `
        <div class="mb-2">
            <div class="d-flex justify-content-between">
                <span class="text-muted small">Schedule Activities:</span>
                <strong>${installActivities.length}</strong>
            </div>
            <div class="d-flex justify-content-between">
                <span class="text-muted small">Installation Items:</span>
                <strong>${totalInstallItems}</strong>
            </div>
        </div>
        <div class="progress mb-2" style="height: 20px;">
            <div class="progress-bar bg-success" style="width: ${installActivities.length > 0 ? Math.round((installActivities.filter(a => a.status === 'Complete').length / installActivities.length) * 100) : 0}%">
                ${installActivities.length > 0 ? Math.round((installActivities.filter(a => a.status === 'Complete').length / installActivities.length) * 100) : 0}%
            </div>
        </div>
        <small class="text-muted">
            ${installActivities.filter(a => a.status === 'Complete').length} of ${installActivities.length} installation activities complete
        </small>
        ${totalInstallItems > 0 ? `<div class="mt-2"><a href="index.html#installation" class="btn btn-sm btn-outline-success w-100">View Installation Audit</a></div>` : ''}
    `;

    container.innerHTML = html;
}

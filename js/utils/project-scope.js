/**
 * Project scoping helpers for Supabase-backed MSR pages.
 *
 * The phone app writes project_id through getProjectClient(). This file gives
 * the static dashboard the same guardrail for shared/project-owned tables.
 */
(function initProjectScope(global) {
    const DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000000';

    const PROJECT_SCOPED_TABLES = new Set([
        'vw_po_summary',
        'vw_shipment_summary',
        'inventory_records',
        'outside_shop_inventory',
        'audit_log',
        'v_aging_report',
        'v_inventory_summary',
        'v_exception_summary',
        'v_yard_overview',
        'locations',
        'qr_codes',
        'receiving_records',
        'materials',
        'material_movements',
        'material_issues',
        'shipments_out',
        'purchase_orders',
        'shipments',
        'dashboard_metrics',
        'material_links',
        'material_status_history',
        'samsara_trackers',
        'samsara_location_history',
        'delivery_dates',
        'project_schedule',
        'vw_active_samsara_trackers',
        'vw_samsara_tracker_stats',
    ]);

    let currentUserId = null;
    function getActiveProjectId() {
        return api.activeProject?.id || null;
    }

    function setActiveProjectId(projectId) {
        const project = api.availableProjects.find(item => item.id === projectId);
        if (!project) throw new Error('This project is not assigned to your account.');
        api.activeProject = project;
        try { global.localStorage?.setItem(`invenio-project-${currentUserId}`, projectId); } catch (_) {}
    }

    function requireProject(projectId) {
        if (!projectId) throw new Error('No project access is assigned. Contact your administrator.');
        return projectId;
    }

    function isProjectScopedTable(table) {
        return PROJECT_SCOPED_TABLES.has(table);
    }

    function withProjectId(table, payload, projectId = getActiveProjectId()) {
        if (!isProjectScopedTable(table)) return payload;
        requireProject(projectId);

        if (Array.isArray(payload)) {
            return payload.map((record) => ({ ...record, project_id: projectId }));
        }

        return { ...payload, project_id: projectId };
    }

    function scopeSelect(table, query, projectId = getActiveProjectId()) {
        return isProjectScopedTable(table) ? query.eq('project_id', requireProject(projectId)) : query;
    }

    function projectChangeOptions(table, event = '*', projectId = getActiveProjectId()) {
        const options = {
            event,
            schema: 'public',
            table,
        };

        if (isProjectScopedTable(table)) {
            options.filter = `project_id=eq.${requireProject(projectId)}`;
        }

        return options;
    }

    function createProjectScopedClient(baseClient, getProjectId = getActiveProjectId) {
        return {
            from(table) {
                const baseTable = baseClient.from(table);

                return {
                    select(columns, options) {
                        return scopeSelect(table, baseTable.select(columns, options), getProjectId());
                    },
                    insert(values, options) {
                        return baseTable.insert(withProjectId(table, values, getProjectId()), options);
                    },
                    upsert(values, options) {
                        return baseTable.upsert(withProjectId(table, values, getProjectId()), options);
                    },
                    update(values, options) {
                        return scopeSelect(table, baseTable.update(values, options), getProjectId());
                    },
                    delete(options) {
                        return scopeSelect(table, baseTable.delete(options), getProjectId());
                    },
                };
            },
        };
    }

    async function initializeProjectScope(supabaseClient, userId) {
        api.activeProject = null;
        api.availableProjects = [];
        currentUserId = userId;
        if (!supabaseClient || !userId) return null;
        const { data, error } = await supabaseClient.from('user_projects')
            .select('project_id, projects(id, name, status)').eq('user_id', userId);
        if (error) throw new Error('Unable to load project access. Please try again.');
        api.availableProjects = (data || []).map(row => row.projects)
            .filter(project => project && project.status !== 'archived');
        let saved;
        try { saved = global.localStorage?.getItem(`invenio-project-${userId}`); } catch (_) {}
        const selected = api.availableProjects.find(project => project.id === saved) || api.availableProjects[0];
        if (selected) setActiveProjectId(selected.id);
        return getActiveProjectId();
    }

    const api = {
        DEFAULT_PROJECT_ID,
        PROJECT_SCOPED_TABLES,
        getActiveProjectId,
        setActiveProjectId,
        isProjectScopedTable,
        withProjectId,
        scopeSelect,
        projectChangeOptions,
        createProjectScopedClient,
        initializeProjectScope,
        activeProject: null,
        availableProjects: [],
    };

    global.InvenioProjectScope = api;
    if (global.supabaseClient) {
        global.projectSupabaseClient = createProjectScopedClient(global.supabaseClient);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

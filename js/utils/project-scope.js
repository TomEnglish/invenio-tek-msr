/**
 * Project scoping helpers for Supabase-backed MSR pages.
 *
 * The phone app writes project_id through getProjectClient(). This file gives
 * the static dashboard the same guardrail for shared/project-owned tables.
 */
(function initProjectScope(global) {
    const DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000000';

    const PROJECT_SCOPED_TABLES = new Set([
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

    function configuredDefaultProjectId() {
        return global.SUPABASE_CONFIG?.defaultProjectId || DEFAULT_PROJECT_ID;
    }

    function getActiveProjectId() {
        try {
            const saved = global.localStorage?.getItem('invenio-active-project-id');
            if (saved) return saved;
        } catch (error) {
            // localStorage can be blocked in private browsing or strict modes.
        }

        return configuredDefaultProjectId();
    }

    function setActiveProjectId(projectId) {
        if (!projectId) return;

        try {
            global.localStorage?.setItem('invenio-active-project-id', projectId);
        } catch (error) {
            // Non-fatal; current page can still use the in-memory/default value.
        }
    }

    function isProjectScopedTable(table) {
        return PROJECT_SCOPED_TABLES.has(table);
    }

    function withProjectId(table, payload, projectId = getActiveProjectId()) {
        if (!isProjectScopedTable(table)) return payload;

        if (Array.isArray(payload)) {
            return payload.map((record) => ({ ...record, project_id: projectId }));
        }

        return { ...payload, project_id: projectId };
    }

    function scopeSelect(table, query, projectId = getActiveProjectId()) {
        return isProjectScopedTable(table) ? query.eq('project_id', projectId) : query;
    }

    function projectChangeOptions(table, event = '*', projectId = getActiveProjectId()) {
        const options = {
            event,
            schema: 'public',
            table,
        };

        if (isProjectScopedTable(table)) {
            options.filter = `project_id=eq.${projectId}`;
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
        if (!supabaseClient || !userId) return getActiveProjectId();

        const fallbackProjectId = getActiveProjectId();

        try {
            const { data, error } = await supabaseClient
                .from('user_projects')
                .select('project_id, projects(id, name, status)')
                .eq('user_id', userId);

            if (error) {
                console.warn('Project scope lookup failed:', error.message);
                return fallbackProjectId;
            }

            const activeAssignments = (data || []).filter((assignment) => {
                return assignment.project_id && assignment.projects?.status !== 'archived';
            });

            const saved = getActiveProjectId();
            const savedStillAllowed = activeAssignments.some((assignment) => assignment.project_id === saved);
            const selected = savedStillAllowed
                ? saved
                : activeAssignments[0]?.project_id || fallbackProjectId;

            setActiveProjectId(selected);
            global.InvenioProjectScope.activeProject = activeAssignments.find(
                (assignment) => assignment.project_id === selected
            )?.projects || { id: selected, name: 'Default Project' };

            return selected;
        } catch (error) {
            console.warn('Project scope initialization failed:', error.message);
            return fallbackProjectId;
        }
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
    };

    global.InvenioProjectScope = api;
    if (global.supabaseClient) {
        global.projectSupabaseClient = createProjectScopedClient(global.supabaseClient);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

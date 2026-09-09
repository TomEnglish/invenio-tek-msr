(async function () {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!(await window.InvenioAuthReady)) return;
    const client = createAdminUsersClient({ supabaseClient });
    const $ = id => document.getElementById(id);
    function message(text, success = false) {
        $('pageMessage').textContent = text;
        $('pageMessage').className = `alert alert-${success ? 'success' : 'danger'}`;
    }
    function element(tag, text, className) {
        const el = document.createElement(tag); el.textContent = text;
        if (className) el.className = className;
        return el;
    }
    if ($('setupProjects')) {
        $('setupProjects').hidden = !InvenioUserAccess.canAccessAdminPages(InvenioCurrentProfile);
    }
    if ($('projectForm')) {
        let projects = [];
        async function load() {
            const result = await client.listProjects();
            projects = result.data;
            $('projectDirectory').replaceChildren();
            if (!projects.length) $('projectDirectory').textContent = 'No projects yet. Create the first project to assign your team.';
            for (const project of projects) {
                const row = element('div', '', 'd-flex justify-content-between align-items-center border-bottom py-3 gap-3');
                const text = element('div', '');
                text.append(element('strong', project.name), element('div', project.status, 'small text-muted'));
                const edit = element('button', 'Edit', 'btn btn-sm btn-outline-primary');
                edit.type = 'button';
                edit.onclick = () => {
                    $('projectId').value = project.id;
                    $('projectName').value = project.name;
                    $('projectDescription').value = project.description || '';
                    $('projectStatus').value = project.status;
                    $('projectFormTitle').textContent = 'Edit project';
                    $('projectName').focus();
                };
                row.append(text, edit); $('projectDirectory').append(row);
            }
        }
        $('projectNew').onclick = () => { $('projectForm').reset(); $('projectId').value = ''; $('projectFormTitle').textContent = 'Create project'; };
        $('projectForm').onsubmit = async event => {
            event.preventDefault();
            if ($('projectStatus').value === 'archived' && !confirm('Archive this project? Operational access will stop; its records will be retained.')) return;
            $('projectSave').disabled = true;
            try {
                await client.saveProject({ projectId: $('projectId').value || undefined, name: $('projectName').value, description: $('projectDescription').value, status: $('projectStatus').value });
                await load(); $('projectNew').click(); window.InvenioUnsavedChanges = false; message('Project saved. Reload a working page to refresh the project selector.', true);
            } catch (error) { message(error.message); }
            finally { $('projectSave').disabled = false; }
        };
        try { await load(); } catch (error) { message(error.message); }
    }
    if ($('auditEntries')) {
        let page = 1, totalPages = 1;
        const projects = (await client.listProjects()).data;
        const labels = { fullName: 'Full name', role: 'Role', isActive: 'Active account', projectIds: 'Projects', invitationStatus: 'Invitation status', invitationExpiresAt: 'Invitation expiry', name: 'Project name', description: 'Description', status: 'Status' };
        const userId = new URLSearchParams(location.search).get('userId') || undefined;
        async function load() {
            $('auditEntries').textContent = 'Loading history...';
            try {
                const result = await client.listAudit({ userId, page, pageSize: 25 });
                totalPages = result.pagination.totalPages;
                $('auditEntries').replaceChildren();
                if (!result.data.length) $('auditEntries').textContent = 'No administrator changes recorded.';
                for (const entry of result.data) {
                    const row = element('article', '', 'border-bottom py-3');
                    row.append(element('h2', `${entry.action.replaceAll('_', ' ')} · ${entry.targetName}`, 'h6 text-capitalize'));
                    row.append(element('p', `${entry.actorName} · ${new Date(entry.created_at).toLocaleString()}`, 'small text-muted'));
                    const before = entry.details.before || {}, after = entry.details.after || {};
                    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
                        if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
                        const value = v => Array.isArray(v) ? v.map(id => projects.find(p => p.id === id)?.name || 'Removed project').join(', ') || 'None' : v === null || v === undefined ? 'None' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v).replaceAll('_', ' ');
                        row.append(element('div', `${labels[key] || key}: ${value(before[key])} → ${value(after[key])}`, 'small text-break'));
                    }
                    $('auditEntries').append(row);
                }
                $('auditPage').textContent = `Page ${page} of ${totalPages}`;
            } catch (error) { $('auditEntries').textContent = 'History could not be loaded.'; message(error.message); }
            $('auditPrev').disabled = page <= 1;
            $('auditNext').disabled = page >= totalPages;
        }
        $('auditPrev').onclick = () => { if (page > 1) { page--; load(); } };
        $('auditNext').onclick = () => { if (page < totalPages) { page++; load(); } };
        await load();
    }
})();

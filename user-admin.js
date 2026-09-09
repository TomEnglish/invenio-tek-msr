/* global bootstrap, createAdminUsersClient, supabaseClient */

(async function initUserAdminPage() {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (window.InvenioAuthReady && !(await window.InvenioAuthReady)) return;

    const client = createAdminUsersClient({ supabaseClient });
    const state = {
        users: [],
        projects: [],
        page: 1,
        pageSize: 25,
        totalPages: 1,
        search: '',
        editingUser: null,
        requestId: 0,
        invitationEmailEnabled: false,
    };

    const elements = {
        message: document.getElementById('userPageMessage'),
        invite: document.getElementById('btnInviteUser'),
        emailNotice: document.getElementById('invitationEmailNotice'),
        formMessage: document.getElementById('formMessage'),
        search: document.getElementById('userSearch'),
        tableBody: document.getElementById('userTableBody'),
        userCount: document.getElementById('userCount'),
        pageInfo: document.getElementById('userPageInfo'),
        previous: document.getElementById('btnPrevUsers'),
        next: document.getElementById('btnNextUsers'),
        modal: document.getElementById('userModal'),
        modalTitle: document.getElementById('userModalTitle'),
        form: document.getElementById('userForm'),
        email: document.getElementById('userEmail'),
        fullName: document.getElementById('userFullName'),
        role: document.getElementById('userRole'),
        isActive: document.getElementById('userIsActive'),
        projectList: document.getElementById('projectList'),
        save: document.getElementById('btnSaveUser'),
    };

    const modal = bootstrap.Modal.getOrCreateInstance(elements.modal);

    function setMessage(target, message, type = 'danger') {
        target.textContent = message || '';
        target.className = message ? `alert alert-${type}` : 'alert d-none';
    }

    function setBusy(isBusy) {
        elements.save.disabled = isBusy;
        elements.save.textContent = isBusy ? 'Saving...' : 'Save User';
    }

    function formatDate(value) {
        if (!value) return 'Never';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Unknown';
        return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }

    function makeBadge(label, className) {
        const badge = document.createElement('span');
        badge.className = `user-badge ${className}`;
        badge.textContent = label;
        return badge;
    }

    function roleLabel(role) {
        return {
            field_worker: 'Field worker',
            office_staff: 'Office staff',
            admin: 'Administrator',
        }[role] || role;
    }

    function renderUsers() {
        elements.tableBody.replaceChildren();
        elements.userCount.textContent = `${state.users.length} shown`;
        elements.pageInfo.textContent = `Page ${state.page} of ${state.totalPages}`;
        elements.previous.disabled = state.page <= 1;
        elements.next.disabled = state.page >= state.totalPages;

        if (state.users.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 6;
            cell.className = 'user-empty';
            const icon = document.createElement('i');
            icon.className = 'fas fa-user-slash d-block';
            const text = document.createElement('div');
            text.textContent = state.search ? 'No users match this search.' : 'No users found.';
            cell.append(icon, text);
            row.appendChild(cell);
            elements.tableBody.appendChild(row);
            return;
        }

        state.users.forEach((user) => {
            const row = document.createElement('tr');

            const identity = document.createElement('td');
            const name = document.createElement('div');
            name.className = 'user-name';
            name.textContent = user.fullName || 'Unnamed user';
            const email = document.createElement('div');
            email.className = 'user-email';
            email.textContent = user.email;
            identity.append(name, email);

            const role = document.createElement('td');
            role.appendChild(makeBadge(roleLabel(user.role), 'role-badge'));

            const status = document.createElement('td');
            const statusLabel = user.invitationStatus === 'cancelled' ? 'Cancelled' : !user.isActive ? 'Inactive' : user.invitationStatus === 'pending' ? (user.invitationExpiresAt && new Date(user.invitationExpiresAt) < new Date() ? 'Expired invite' : 'Invitation pending') : 'Active';
            status.appendChild(makeBadge(statusLabel, statusLabel === 'Active' ? 'active' : 'inactive'));

            const projects = document.createElement('td');
            projects.textContent = (user.projectIds || []).map(id => state.projects.find(p => p.id === id)?.name || 'Archived project').join(', ') || 'Access pending';

            const lastSignIn = document.createElement('td');
            lastSignIn.textContent = formatDate(user.lastSignInAt);

            const actions = document.createElement('td');
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'btn btn-sm btn-outline-primary';
            edit.textContent = 'Edit';
            edit.addEventListener('click', () => openEditModal(user));
            actions.appendChild(edit);
            const history = document.createElement('a');
            history.className = 'btn btn-sm btn-outline-secondary ms-1';
            history.href = `audit.html?userId=${encodeURIComponent(user.id)}`;
            history.textContent = 'History';
            actions.appendChild(history);
            if (user.invitationStatus === 'pending') {
                for (const [label, method] of [['Resend', 'resendInvitation'], ['Cancel invite', 'cancelInvitation']]) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'btn btn-sm btn-outline-secondary mt-1 me-1';
                    button.textContent = label;
                    button.disabled = method === 'resendInvitation' && !state.invitationEmailEnabled;
                    button.addEventListener('click', async () => {
                        if (method === 'cancelInvitation' && !confirm(`Cancel the invitation for ${user.email}?`)) return;
                        button.disabled = true;
                        try {
                            await client[method](user.id);
                            await loadUsers();
                            setMessage(elements.message, method === 'resendInvitation' ? 'Invitation email sent.' : 'Invitation cancelled.', 'success');
                        } catch (error) { setMessage(elements.message, error.message); button.disabled = false; }
                    });
                    actions.appendChild(button);
                }
            }

            row.append(identity, role, status, projects, lastSignIn, actions);
            elements.tableBody.appendChild(row);
        });
    }

    function renderProjects(selectedIds = []) {
        elements.projectList.replaceChildren();
        if (state.projects.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'text-muted small';
            empty.textContent = 'No active projects are available.';
            elements.projectList.appendChild(empty);
            return;
        }

        const selected = new Set(selectedIds);
        state.projects.forEach((project) => {
            const label = document.createElement('label');
            label.className = 'project-option';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'form-check-input project-checkbox';
            checkbox.value = project.id;
            checkbox.checked = selected.has(project.id);
            const copy = document.createElement('span');
            copy.textContent = project.name;
            const status = document.createElement('small');
            status.textContent = project.status;
            copy.appendChild(status);
            label.append(checkbox, copy);
            elements.projectList.appendChild(label);
        });
    }

    async function loadProjects() {
        const result = await client.listProjects();
        state.projects = result.data || [];
        const filter = document.getElementById('userProjectFilter');
        for (const project of state.projects) {
            const option = document.createElement('option'); option.value = project.id; option.textContent = project.name;
            filter.appendChild(option);
        }
    }

    async function loadUsers() {
        const requestId = ++state.requestId;
        setMessage(elements.message, '');
        elements.tableBody.replaceChildren();
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'user-empty';
        cell.textContent = 'Loading users...';
        row.appendChild(cell);
        elements.tableBody.appendChild(row);

        try {
            const result = await client.listUsers({ page: state.page, pageSize: state.pageSize, search: state.search, role: document.getElementById('userRoleFilter').value, status: document.getElementById('userStatusFilter').value, projectId: document.getElementById('userProjectFilter').value });
            if (requestId !== state.requestId) return;
            state.users = result.data || [];
            state.totalPages = result.pagination?.totalPages || 1;
            state.invitationEmailEnabled = result.capabilities?.invitationEmailEnabled !== false;
            elements.invite.disabled = !state.invitationEmailEnabled;
            elements.emailNotice.classList.toggle('d-none', state.invitationEmailEnabled);
            renderUsers();
        } catch (error) {
            if (requestId !== state.requestId) return;
            state.users = [];
            renderUsers();
            setMessage(elements.message, error.message || 'Unable to load users.');
        }
    }

    function openInviteModal() {
        if (!state.invitationEmailEnabled) return;
        state.editingUser = null;
        elements.modalTitle.textContent = 'Invite User';
        elements.form.reset();
        elements.email.disabled = false;
        elements.isActive.checked = true;
        elements.isActive.disabled = true;
        elements.role.value = 'field_worker';
        setMessage(elements.formMessage, '');
        renderProjects([]);
        modal.show();
        elements.email.focus();
    }

    function openEditModal(user) {
        state.editingUser = user;
        elements.modalTitle.textContent = 'Edit User';
        elements.email.value = user.email;
        elements.email.disabled = true;
        elements.fullName.value = user.fullName || '';
        elements.role.value = user.role;
        elements.isActive.checked = user.isActive;
        elements.isActive.disabled = user.invitationStatus === 'cancelled';
        setMessage(elements.formMessage, '');
        renderProjects(user.projectIds || []);
        modal.show();
        elements.fullName.focus();
    }

    function selectedProjectIds() {
        return [...document.querySelectorAll('.project-checkbox:checked')].map((checkbox) => checkbox.value);
    }

    async function saveUser(event) {
        event.preventDefault();
        setMessage(elements.formMessage, '');
        const isEditing = Boolean(state.editingUser);
        const nextActive = elements.isActive.checked;

        if (isEditing && state.editingUser.isActive && !nextActive && !window.confirm('Deactivate this user? They will lose access to the application.')) {
            return;
        }

        setBusy(true);
        try {
            let result;
            if (isEditing) {
                result = await client.updateUser({
                    userId: state.editingUser.id,
                    expectedUpdatedAt: state.editingUser.updatedAt,
                    fullName: elements.fullName.value.trim(),
                    role: elements.role.value,
                    isActive: nextActive,
                    projectIds: selectedProjectIds(),
                });
            } else {
                result = await client.inviteUser({
                    email: elements.email.value.trim(),
                    fullName: elements.fullName.value.trim(),
                    role: elements.role.value,
                    projectIds: selectedProjectIds(),
                });
            }

            if (elements.modal.contains(document.activeElement)) document.activeElement.blur();
            modal.hide();
            window.InvenioUnsavedChanges = false;
            if (result?.data) await loadUsers();
            setMessage(elements.message, isEditing ? 'User updated.' : 'Invitation sent.', 'success');
            if (result?.data?.id === window.InvenioCurrentProfile.id && (!result.data.isActive || result.data.role !== 'admin')) location.href = 'index.html';
        } catch (error) {
            setMessage(elements.formMessage, error.message || 'Unable to save user.');
        } finally {
            setBusy(false);
        }
    }

    document.getElementById('btnInviteUser').addEventListener('click', openInviteModal);
    document.getElementById('btnSearchUsers').addEventListener('click', () => {
        state.search = elements.search.value.trim();
        state.page = 1;
        loadUsers();
    });
    elements.search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') document.getElementById('btnSearchUsers').click();
    });
    document.getElementById('btnRefreshUsers').addEventListener('click', loadUsers);
    elements.previous.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadUsers(); } });
    elements.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; loadUsers(); } });
    elements.form.addEventListener('submit', saveUser);
    for (const id of ['userRoleFilter','userStatusFilter','userProjectFilter']) document.getElementById(id).addEventListener('change', () => { state.page = 1; loadUsers(); });

    try {
        await loadProjects();
        await loadUsers();
        renderProjects([]);
    } catch (error) {
        setMessage(elements.message, error.message || 'Unable to initialize user management.');
    }
})();

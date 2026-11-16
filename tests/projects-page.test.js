// Runs the Projects page (admin-pages.js with the real admin-users client) against the fake DOM and a fake
// admin-users function, so a refused save is checked by what the page shows. The fake function passes the
// database's 22023 reason through, as admin-users has to for 022's open-loads refusal to reach the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fakeDocument, settle } = require('./support/fake-dom');

const client = fs.readFileSync('js/utils/admin-users-client.js', 'utf8'), page = fs.readFileSync('admin-pages.js', 'utf8');
const yardSetup = require('../js/utils/yard-setup');
const PROJECT = { id: 'pr1', name: 'North Yard', description: '', status: 'active' };

// `setup`: what 030's project_setup_status answers (rows, or an error); without it the page has no checklist helper,
// as on a page that doesn't load it. `projects`: what the directory lists.
async function openProjects(refusal, { setup, projects = [PROJECT] } = {}) {
    const { document } = fakeDocument();
    const sent = [], asked = [];
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    const fetch = async (url, init) => {
        const resource = new URL(url).searchParams.get('resource');
        if (init.method === 'GET') return reply(200, resource === 'projects' ? { data: projects } : { data: [], pagination: { page: 1, totalPages: 1 } });
        sent.push(JSON.parse(init.body));
        return refusal;
    };
    const context = {
        document, console, URL, URLSearchParams, location: { search: '' }, fetch, confirm: () => true, InvenioAuthReady: Promise.resolve(true),
        SUPABASE_CONFIG: { url: 'https://example.test', anonKey: 'anon' }, InvenioCurrentProfile: { role: 'admin' },
        InvenioUserAccess: { canAccessAdminPages: () => true },
        supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
            ...(setup ? { rpc: async name => { asked.push(name); return setup; } } : {}) },
        ...(setup ? { InvenioYardSetup: yardSetup } : {}),
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(client, context);
    vm.runInContext(page, context);
    await settle();
    return { $: id => document.getElementById(id), sent, asked };
}

test('each active project lists what it still needs before work can start, with links only for its members (030)', async () => {
    const projects = [PROJECT, { id: 'pr2', name: 'South Site', description: '', status: 'active' }, { id: 'pr3', name: 'Ready Yard', description: '', status: 'active' },
        { id: 'pr4', name: 'Closed Yard', description: '', status: 'completed' }];
    const row = (project_id, extra) => ({ project_id, is_member: true, own_yards: 1, shared_yards: 0, racks: 3, hold_racks: 1, site_plans: 1, ...extra });
    const setup = { data: [row('pr1', { own_yards: 0, racks: 0, hold_racks: 0, site_plans: 0 }), row('pr2', { is_member: false, site_plans: 0 }), row('pr3'), row('pr4', { racks: 0 })], error: null };
    const { $, asked } = await openProjects(null, { setup, projects });
    assert.deepEqual(asked, ['project_setup_status']);
    const blocks = $('projectDirectory').querySelectorAll('.project-setup');
    assert.equal(blocks.length, 3, 'active projects only: a completed one is not being set up');
    assert.equal(blocks[0].childNodes[0].textContent, 'Setup: 4 of 4 left (yard or site, racks, hold-area rack, site plan)');
    assert.deepEqual(blocks[0].querySelectorAll('a').map(link => [link.textContent, link.href]), [
        ['Add a yard or site', 'places.html?add=yard&project=pr1'], ['Add racks', 'racks.html?project=pr1'],
        ['Add a hold-area rack', 'racks.html?project=pr1'], ['Add a site plan', 'site-maps.html?project=pr1']]);
    assert.ok(blocks[0].textContent.includes('No racks yet. Nothing can be received until the project has a rack.'));
    assert.equal(blocks[1].childNodes[0].textContent, 'Setup: 1 of 4 left (site plan)');
    assert.equal(blocks[1].querySelectorAll('a').length, 0, 'no links into a project this administrator is not assigned to');
    assert.ok(blocks[1].textContent.includes('You are not assigned to this project.'));
    assert.equal(blocks[2].textContent, 'Set up: yard, racks and site plan');
});

test('the directory still lists projects when the setup checklist cannot be read; a new project says where its setup is', async () => {
    const saved = { ok: true, status: 200, json: async () => ({ data: { id: 'new' } }) };
    const { $, sent } = await openProjects(saved, { setup: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } });
    assert.equal($('projectDirectory').querySelectorAll('strong').map(node => node.textContent).join(), 'North Yard');
    assert.equal($('projectDirectory').querySelectorAll('.project-setup').length, 0);
    $('projectName').value = 'East Yard';
    $('projectForm').reset = () => {};  // the fake DOM has no form reset
    await $('projectForm').onsubmit({ preventDefault() {} });
    await settle();
    assert.equal(sent.length, 1);
    assert.equal($('pageMessage').textContent, 'Project created. What it still needs before work can start is listed under it: a yard or site, racks and a site plan.');
});

test("completing a project with open loads shows the database's 22023 reason as written", async () => {
    const refusal = { ok: false, status: 409, json: async () => ({ error: { code: 'PROJECT_REFUSED', message: "Close or cancel this project's open loads (2) first" } }) };
    const { $, sent } = await openProjects(refusal);
    $('projectDirectory').querySelectorAll('button').find(node => node.textContent === 'Edit').click();
    $('projectStatus').value = 'completed';
    await $('projectForm').onsubmit({ preventDefault() {} });
    await settle();
    assert.deepEqual(sent.map(body => [body.projectId, body.status]), [['pr1', 'completed']]);
    assert.equal($('pageMessage').textContent, "Close or cancel this project's open loads (2) first");
    assert.equal($('pageMessage').className, 'alert alert-danger');
    assert.equal($('projectSave').disabled, false, 'Save works again');
    assert.equal($('projectId').value, 'pr1', 'the form keeps the project being edited');
});

test('the audit view shows a canceled invitation in US English; the stored status stays cancelled', async () => {
    const { document } = fakeDocument();
    const entry = { action: 'cancel_invite', targetName: 'Sam Ortiz', actorName: 'Dana Ruiz', created_at: '2026-11-02T15:00:00Z',
        details: { before: { invitationStatus: 'pending', isActive: true, fullName: 'Sam' }, after: { invitationStatus: 'cancelled', isActive: false, fullName: 'cancelled' } } };
    const fetch = async url => {
        const resource = new URL(url).searchParams.get('resource');
        return { ok: true, status: 200, json: async () => resource === 'audit' ? { data: [entry], pagination: { page: 1, totalPages: 1 } } : { data: [PROJECT] } };
    };
    const context = {
        document, console, URL, URLSearchParams, location: { search: '' }, fetch, confirm: () => true, InvenioAuthReady: Promise.resolve(true),
        SUPABASE_CONFIG: { url: 'https://example.test', anonKey: 'anon' }, InvenioCurrentProfile: { role: 'admin' },
        InvenioUserAccess: { canAccessAdminPages: () => true },
        supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(client, context);
    vm.runInContext(page, context);
    await settle();
    const text = document.getElementById('auditEntries').textContent;
    assert.ok(text.includes('Invitation status: pending → canceled'), text);
    assert.ok(text.includes('Active account: Yes → No'));
    assert.ok(text.includes('Full name: Sam → cancelled'), 'free text is shown as stored');
});

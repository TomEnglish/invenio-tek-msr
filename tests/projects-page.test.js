// Runs the Projects page (admin-pages.js with the real admin-users client) against the fake DOM and a fake
// admin-users function, so a refused save is checked by what the page shows. The fake function passes the
// database's 22023 reason through, as admin-users has to for 022's open-loads refusal to reach the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fakeDocument, settle } = require('./support/fake-dom');

const client = fs.readFileSync('js/utils/admin-users-client.js', 'utf8'), page = fs.readFileSync('admin-pages.js', 'utf8');
const PROJECT = { id: 'pr1', name: 'North Yard', description: '', status: 'active' };

async function openProjects(refusal) {
    const { document } = fakeDocument();
    const sent = [];
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    const fetch = async (url, init) => {
        const resource = new URL(url).searchParams.get('resource');
        if (init.method === 'GET') return reply(200, resource === 'projects' ? { data: [PROJECT] } : { data: [], pagination: { page: 1, totalPages: 1 } });
        sent.push(JSON.parse(init.body));
        return refusal;
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
    return { $: id => document.getElementById(id), sent };
}

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

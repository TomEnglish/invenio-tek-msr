const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createLoginFlow} = require('../js/utils/login-flow');

// The templates carry a placeholder for the office site address; each
// environment's finished copy is rendered from environments.json.
const ready = import('../scripts/environments.mjs');

for (const name of ['invite', 'recovery']) {
    test(`${name} email links contain no consumable credentials and open the code form on that environment's own site`, async () => {
        const {loadEnvironments, listEnvironments, renderEmailTemplates} = await ready;
        const environments = listEnvironments(loadEnvironments());
        assert.ok(environments.length);
        for (const environment of environments) {
            const template = renderEmailTemplates(environment)[name];
            assert.match(template, /{{ \.Token }}/);
            assert.doesNotMatch(template, /ConfirmationURL|TokenHash|auth\/v1\/verify|%[A-Z_]+%/);
            const links = [...template.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1].replaceAll('&amp;', '&')));
            assert.ok(links.length);
            for (const link of links) {
                assert.equal(link.origin, environment.siteUrl);
                assert.equal(link.pathname, '/login.html');
                assert.deepEqual([...link.searchParams.keys()], ['setup', 'verification']);
                const flow = createLoginFlow(link.hash, link.search);
                assert.equal(flow.verificationType, name);
                assert.equal(flow.shouldRedirect({}), false);
            }
            // Every address in the email is this environment's office site.
            for (const [address] of template.matchAll(/https?:\/\/[^"'\s<]+/g)) assert.equal(new URL(address).origin, environment.siteUrl);
        }
    });
}

test('the resent-invitation branch matches the redirect the admin function sends', async () => {
    const {loadEnvironments, listEnvironments, renderEmailTemplates} = await ready;
    for (const environment of listEnvironments(loadEnvironments())) {
        const recovery = renderEmailTemplates(environment).recovery;
        assert.ok(recovery.includes(`{{ if eq .RedirectTo "${environment.siteUrl}/login.html?setup=invite" }}`));
    }
    const handler = readFileSync(`${__dirname}/../supabase/functions/admin-users/index.ts`, 'utf8');
    assert.ok(handler.includes('const redirectTo = `${getSiteOrigin()}/login.html?setup=invite`;'));
});

test('a template with no placeholder, or an unknown one, is refused', async () => {
    const {renderEmailTemplate} = await ready;
    const environment = {siteUrl: 'https://office.example.test'};
    assert.throws(() => renderEmailTemplate('<p>No link</p>', environment), /no site address placeholder/);
    assert.throws(() => renderEmailTemplate('<a href="%SITE_URL%/x">x</a> %OTHER_THING%', environment), /unknown placeholder/);
});

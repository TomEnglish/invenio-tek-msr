const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createLoginFlow} = require('../js/utils/login-flow');

for (const name of ['invite', 'recovery']) {
    test(`${name} email links contain no consumable credentials and open the code form`, () => {
        const template = readFileSync(`${__dirname}/../supabase/templates/${name}.html`, 'utf8');
        assert.match(template, /{{ \.Token }}/);
        assert.doesNotMatch(template, /ConfirmationURL|TokenHash|auth\/v1\/verify/);
        const links = [...template.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1].replaceAll('&amp;', '&')));
        assert.ok(links.length);
        for (const link of links) {
            assert.equal(link.origin, 'https://invenio-field-msr.netlify.app');
            assert.equal(link.pathname, '/login.html');
            assert.deepEqual([...link.searchParams.keys()], ['setup', 'verification']);
            const flow = createLoginFlow(link.hash, link.search);
            assert.equal(flow.verificationType, name);
            assert.equal(flow.shouldRedirect({}), false);
        }
    });
}

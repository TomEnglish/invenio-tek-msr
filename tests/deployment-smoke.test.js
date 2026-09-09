const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
test('deployment smoke rejects older releases, corrupt assets and exposed private files', async () => {
    const {smokeDeploy} = await import('../scripts/smoke-deploy.mjs');
    const commit='a'.repeat(40), content='verified browser asset';
    const paths=['index.html','login.html','work-inbox.html','record.html','dashboard.js','work-pages.js','styles.css','js/utils/data-health.js','js/utils/work-summary.js','js/utils/pdf-export.js','js/utils/auth-guard.js','js/utils/project-scope.js'];
    const assets=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(content).digest('hex')]));
    let corrupt=false, expose=false;
    const server=createServer((req,res)=>{
        const path=new URL(req.url,'http://localhost').pathname.slice(1);
        if(path==='release.json') return res.end(JSON.stringify({commit,assets}));
        if(paths.includes(path)) return res.end(corrupt?'wrong':content);
        res.statusCode=expose?200:404;res.end(expose?'private content':'not found');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
        const origin=`http://127.0.0.1:${server.address().port}`;
        assert.equal((await smokeDeploy(origin,commit)).assets,12);
        await assert.rejects(smokeDeploy(origin,'b'.repeat(40)),/not deployed/);
        corrupt=true;await assert.rejects(smokeDeploy(origin,commit),/differs from release/);
        corrupt=false;expose=true;await assert.rejects(smokeDeploy(origin,commit),/Private path must return 404/);
    } finally { await new Promise(resolve=>server.close(resolve)); }
});

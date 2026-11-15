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

test('deployment smoke requires each site to be its own environment with its own database', async () => {
    const {smokeDeploy, smokeDeployAll} = await import('../scripts/smoke-deploy.mjs');
    const commit='c'.repeat(40), content='verified browser asset';
    const paths=['index.html','login.html','work-inbox.html','record.html','dashboard.js','work-pages.js','styles.css','js/utils/data-health.js','js/utils/work-summary.js','js/utils/pdf-export.js','js/utils/auth-guard.js','js/utils/project-scope.js'];
    const assets=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(content).digest('hex')]));
    // One server plays a site: it says which environment it was built for and which database it connects to.
    const site={environment:'acme',database:'https://acmedb.supabase.co'};
    const server=createServer((req,res)=>{
        const path=new URL(req.url,'http://localhost').pathname.slice(1);
        if(path==='release.json') return res.end(JSON.stringify({commit,environment:site.environment,assets}));
        if(path==='supabase-config.js') return res.end(`window.SUPABASE_CONFIG = {"url": ${JSON.stringify(site.database)}, "other": ${JSON.stringify(site.other||'')}};`);
        if(paths.includes(path)) return res.end(content);
        res.statusCode=404;res.end('not found');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
        const origin=`http://127.0.0.1:${server.address().port}`;
        const expected={environment:'acme',databaseUrl:'https://acmedb.supabase.co',otherDatabaseUrls:['https://demodb.supabase.co']};
        assert.equal((await smokeDeploy(origin,commit,1,expected)).environment,'acme');
        site.environment='demo';
        await assert.rejects(smokeDeploy(origin,commit,1,expected),/built for "demo", expected "acme"/);
        site.environment='acme';site.database='https://demodb.supabase.co';
        await assert.rejects(smokeDeploy(origin,commit,1,expected),/does not connect to the "acme" database/);
        site.database='https://acmedb.supabase.co';site.other='https://demodb.supabase.co';
        await assert.rejects(smokeDeploy(origin,commit,1,expected),/names another environment's database/);
        site.other='';

        // Every environment is checked against its own address, and one failure fails the run.
        const calls=[];
        const environments=[{name:'acme',siteUrl:'https://acme.example.test',databaseUrl:'https://acmedb.supabase.co'},{name:'demo',siteUrl:'https://demo.example.test',databaseUrl:'https://demodb.supabase.co'}];
        const results=await smokeDeployAll(environments,commit,1,async(...args)=>{calls.push(args);return {environment:args[3].environment};});
        assert.deepEqual(results,[{environment:'acme'},{environment:'demo'}]);
        assert.deepEqual(calls.map(([siteUrl,,,expect])=>[siteUrl,expect.databaseUrl,expect.otherDatabaseUrls]),[
            ['https://acme.example.test','https://acmedb.supabase.co',['https://demodb.supabase.co']],
            ['https://demo.example.test','https://demodb.supabase.co',['https://acmedb.supabase.co']],
        ]);
        await assert.rejects(smokeDeployAll(environments,commit,1,async(siteUrl)=>{ if(siteUrl.includes('demo')) throw new Error('not deployed'); return {}; }),/demo: not deployed/);
    } finally { await new Promise(resolve=>server.close(resolve)); }
});

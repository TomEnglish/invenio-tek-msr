(() => {
    const project = { id: 'b1111111-1111-4111-8111-111111111111', name: 'North Yard', status: 'active' };
    const other = { id: 'b2222222-2222-4222-8222-222222222222', name: 'South Yard', status: 'active' };
    const me = { id: 'a1111111-1111-4111-8111-111111111111', email: 'admin@example.test', full_name: 'Avery Admin', role: sessionStorage.getItem('fixtureRole') || 'admin', is_active: true, invitation_status: 'accepted' };
    const session = { user: me, access_token: 'fixture-token' };
    const state = JSON.parse(sessionStorage.getItem('fixtureState') || 'null') || {
        projects: [project,other], audit: [],
        users: [{ id:me.id, email:me.email, fullName:me.full_name, role:me.role, isActive:true, invitationStatus:'accepted', projectIds:[project.id,other.id], updatedAt:'2026-09-08T12:00:00Z', lastSignInAt:'2026-09-08T12:00:00Z' },
        { id:'f1111111-1111-4111-8111-111111111111', email:'worker@example.test', fullName:'Jordan Field', role:'field_worker', isActive:true, invitationStatus:'pending', invitationExpiresAt:'2020-01-01T00:00:00Z', projectIds:[project.id], updatedAt:'2026-09-08T12:00:00Z' }],
        records: [{ id:'c1111111-1111-4111-8111-111111111111', project_id:project.id, material_type:'Steel Pipe', qty:10, current_quantity:8, po_number:'PO-100', status:'accepted', vendor:'Yard Supply', has_exception:true, exception_resolved:false, exception_type:'damage', damage_notes:'Inspect the bent end before release.', created_at:'2026-09-08T12:00:00Z' }],
    };
    const save = () => sessionStorage.setItem('fixtureState',JSON.stringify(state));
    const success = data => ({ data, error:null });
    const reportRows = {
        purchase_orders: [
            {id:1,project_id:project.id,purchase_order_id:'PO-20001',purchase_order_item:'00010',item_description:'Six-inch isolation valve',po_description:'Mechanical package',supplier:'Yard Supply',net_value:150,status:'Sent'},
            {id:2,project_id:project.id,purchase_order_id:'PO-20001',purchase_order_item:'00020',item_description:null,po_description:'Cable tray supports',supplier:'Yard Supply',net_value:50,status:'Sent'},
        ],
        shipments: [{id:1,project_id:project.id,shipment_number:'SHIP-10',po_number:'PO-20001',status:'Delivered'}, {id:2,project_id:project.id,shipment_number:'SHIP-20',po_number:'PO-20001',status:'In Transit'}],
        dashboard_metrics: [{id:1,project_id:project.id,project_name:'Wrong imported name',last_updated:'2026-02-22T12:37:00Z',procurement:{total_pos:999},installation:{total_items:0}}],
        installation_datasets: [{project_id:project.id,dataset_key:'audit_data',payload:{items:[]},updated_at:'2026-02-22T12:37:00Z'}, {project_id:project.id,dataset_key:'discipline_summary',payload:{},updated_at:'2026-02-22T12:37:00Z'}],
        samsara_trackers: [{id:'gps-1',project_id:project.id,synced_at:new Date().toISOString()}],
    };
    class Query {
        constructor(table) { this.table=table; this.filters=[]; this.one=false; this.start=0; this.end=1000; }
        select() { return this; } eq(k,v) { this.filters.push(r=>r[k]===v); return this; }
        order(){return this;} range(a,b){this.start=a;this.end=b;return this;} limit(n){this.end=n-1;return this;}
        single(){this.one=true;return this;} maybeSingle(){return this.single();}
        lt(k,v){this.filters.push(r=>r[k]<v);return this;} in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
        gte(k,v){this.filters.push(r=>r[k]>=v);return this;}
        or(){return this;} on(){return this;} subscribe(callback){if(callback)callback('SUBSCRIBED');return this;}
        then(resolve,reject) {
            let rows = this.table==='users' ? [me] : this.table==='projects' ? state.projects : this.table==='user_projects' ? (sessionStorage.getItem('fixtureNoProjects') ? [] : state.projects.map(p=>({user_id:me.id,project_id:p.id,projects:p}))) : this.table==='receiving_records'||this.table==='materials' ? state.records : this.table==='locations' ? [{id:'d1111111-1111-4111-8111-111111111111', project_id:project.id,zone:'A',row:'1',rack:'1'}] : [];
            const mode = new URLSearchParams(location.search).get('fixture');
            if (reportRows[this.table]) rows = mode==='empty' ? [] : reportRows[this.table];
            if ((mode==='error' && this.table==='purchase_orders') || (mode==='gps-error' && this.table==='samsara_trackers')) return Promise.resolve({data:null,error:{message:'Fixture source unavailable'}}).then(resolve,reject);
            rows=rows.filter(r=>this.filters.every(f=>f(r))).slice(this.start,this.end+1);
            return Promise.resolve({data:this.one?rows[0]||null:rows,error:null,count:rows.length}).then(resolve,reject);
        }
    }
    window.fixture = { state, me, calls: [] };
    window.supabase = { createClient: () => ({
        from: table => new Query(table), channel: () => new Query(''),
        auth: { getSession:async()=>success({session}),getUser:async()=>success({user:me}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>success(null), updateUser:async()=>success({user:me}) },
        rpc:async(name,payload)=>{
            window.fixture.calls.push({name,payload});
            if(name==='project_staff') return success([{id:me.id,full_name:me.full_name}]);
            if(name==='apply_field_operation') {
                if(payload.p_action==='exception') Object.assign(state.records[0],{exception_owner_id:payload.p_payload.ownerId,exception_due_date:payload.p_payload.dueDate,exception_notes:payload.p_payload.notes,exception_resolution:payload.p_payload.resolution,exception_resolved:payload.p_payload.resolution!=='hold'});
                save();return success({id:state.records[0].id});
            }
            return success(null);
        }, storage:{from:()=>({createSignedUrl:async()=>success({signedUrl:''}),upload:async()=>success({})})},
    }) };
    const originalFetch=window.fetch;
    window.fetch=async(url,options={})=>{
        const u=new URL(url,location.href);
        if(!u.pathname.startsWith('/functions/v1/admin-users')) return originalFetch(url,options);
        window.fixture.calls.push({method:options.method,url:u.href,body:options.body&&JSON.parse(options.body)});
        let payload;
        if(options.method==='GET') {
            if(u.searchParams.get('resource')==='projects') payload={data:state.projects};
            else if(u.searchParams.get('resource')==='audit') payload={data:state.audit,pagination:{page:1,totalPages:1,total:state.audit.length}};
            else {
                const q=u.searchParams;
                const users=state.users.filter(r=>(!q.get('role')||r.role===q.get('role'))&&(!q.get('search')||(r.fullName+r.email).toLowerCase().includes(q.get('search').toLowerCase()))&&(!q.get('projectId')||r.projectIds.includes(q.get('projectId'))));
                payload={data:users,pagination:{page:1,pageSize:25,totalPages:1,total:users.length}};
            }
        } else {
            const body=JSON.parse(options.body);
            if(body.resource==='projects') { const p=state.projects.find(p=>p.id===body.projectId)||{id:crypto.randomUUID()};Object.assign(p,body);if(!state.projects.includes(p))state.projects.push(p);payload={data:p}; }
            else {
                let user=state.users.find(r=>r.id===body.userId);
                const before=structuredClone(user||{});
                if(body.action==='invite') {user={...body,id:crypto.randomUUID(),invitationStatus:'pending',isActive:true};state.users.push(user);}
                else if(body.action==='resend_invite') user.invitationExpiresAt='2030-01-01T00:00:00Z';
                else if(body.action==='cancel_invite') Object.assign(user,{invitationStatus:'cancelled',isActive:false,projectIds:[]});
                else Object.assign(user,body);
                state.audit.unshift({id:crypto.randomUUID(),actorName:me.full_name,targetName:user.fullName,action:body.action||'update',created_at:new Date().toISOString(),details:{before,after:structuredClone(user)}});
                payload={data:user};
            }
            save();
        }
        return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
    };
})();

(() => {
    const project = { id: 'b1111111-1111-4111-8111-111111111111', name: 'North Yard', status: 'active' };
    const other = { id: 'b2222222-2222-4222-8222-222222222222', name: 'South Yard', status: 'active' };
    const me = { id: 'a1111111-1111-4111-8111-111111111111', email: 'admin@example.test', full_name: 'Avery Admin', role: sessionStorage.getItem('fixtureRole') || 'admin', is_active: true, invitation_status: 'accepted' };
    const session = { user: me, access_token: 'fixture-token' };
    const state = JSON.parse(sessionStorage.getItem('fixtureState') || 'null') || {
        projects: [project,other], audit: [],
        users: [{ id:me.id, email:me.email, fullName:me.full_name, role:me.role, isActive:true, invitationStatus:'accepted', projectIds:[project.id,other.id], updatedAt:'2026-09-08T12:00:00Z', lastSignInAt:'2026-09-08T12:00:00Z' },
        { id:'f1111111-1111-4111-8111-111111111111', email:'worker@example.test', fullName:'Jordan Field', role:'field_worker', isActive:true, invitationStatus:'pending', invitationExpiresAt:'2020-01-01T00:00:00Z', projectIds:[project.id], updatedAt:'2026-09-08T12:00:00Z' }],
        records: [{ id:'c1111111-1111-4111-8111-111111111111', project_id:project.id, qr_code_id:'q1111111-1111-4111-8111-111111111111', receiving_record_id:'c1111111-1111-4111-8111-111111111111', material_type:'Steel Pipe', qty:10, current_quantity:8, po_number:'PO-100', status:'accepted', vendor:'Yard Supply', has_exception:true, exception_resolved:false, exception_type:'damage', damage_notes:'Inspect the bent end before release.', created_at:'2026-09-08T12:00:00Z' }],
    };
    // Initial inventory fixtures. Names include markup so pages can be checked for escaping.
    const worker = 'f1111111-1111-4111-8111-111111111111', mapId = 'e1111111-1111-4111-8111-111111111111';
    const cat = (n, parent, name, extra = {}) => ({ id:`c${n}000000-0000-4000-8000-000000000000`, project_id:project.id, parent_id:parent && `c${parent}000000-0000-4000-8000-000000000000`, name, status:'active', sort_order:10, created_at:'2026-10-20T12:00:00Z', ...extra });
    const item = (n, tag, name, extra) => ({ id:n, uid:`a${n}000000-0000-4000-8000-000000000000`, project_id:project.id, qr_code:tag, inventory_item:name, quantity:1, uom:'EA', count_status:'expected', source:'import', site_map_id:null, pin_x:null, pin_y:null, zone_id:null, category_id:null, ...extra });
    state.inventory ||= {
        inventory_categories: [cat(1,null,'Gas Turbine 2'), cat(2,1,'Lube Oil'), cat(3,2,'Cooler'), cat(4,2,'Pressure Valve',{status:'proposed',proposed_by:worker,sort_order:20}),
            cat(5,1,'Fuel System',{sort_order:20}), cat(6,null,'Electrical',{sort_order:20}), cat(7,6,'Cable Drums'), cat(8,null,'Old Laydown',{status:'archived',sort_order:30}),
            cat(9,null,'<img src=x onerror=alert(1)> Spares',{status:'proposed',proposed_by:worker,sort_order:40})],
        site_maps: [{ id:mapId, project_id:project.id, name:'North Yard plan', storage_path:`${project.id}/${mapId}.png`, image_width:1600, image_height:1000, is_active:true }],
        // Nested areas as in migration 020: T1 Pipe Racks › Rack 1/2, Rack 2 drawn partly outside its parent,
        // a markup-named area inside Warehouse, and an inactive Old Bay whose active child is hidden from field crews.
        site_map_zones: [
            { id:'z1111111-1111-4111-8111-111111111111', map_id:mapId, project_id:project.id, parent_id:null, is_active:true, name:'T1 Pipe Racks', color:'#174fda', location_id:null, sort_order:10, shape:[[0.05,0.08],[0.38,0.08],[0.38,0.45],[0.05,0.45]] },
            { id:'z1a11111-1111-4111-8111-111111111111', map_id:mapId, project_id:project.id, parent_id:'z1111111-1111-4111-8111-111111111111', is_active:true, name:'Rack 1', color:'#0891b2', location_id:'d1111111-1111-4111-8111-111111111111', sort_order:10, shape:[[0.07,0.1],[0.2,0.1],[0.2,0.43],[0.07,0.43]] },
            { id:'z1b11111-1111-4111-8111-111111111111', map_id:mapId, project_id:project.id, parent_id:'z1111111-1111-4111-8111-111111111111', is_active:true, name:'Rack 2', color:'#7c3aed', location_id:null, sort_order:20, shape:[[0.22,0.1],[0.36,0.1],[0.42,0.43],[0.22,0.43]] },
            { id:'z2222222-2222-4222-8222-222222222222', map_id:mapId, project_id:project.id, parent_id:null, is_active:true, name:'Warehouse', color:'#059669', location_id:null, sort_order:20, shape:[[0.55,0.1],[0.92,0.1],[0.92,0.5],[0.55,0.5]] },
            { id:'z2a22222-2222-4222-8222-222222222222', map_id:mapId, project_id:project.id, parent_id:'z2222222-2222-4222-8222-222222222222', is_active:true, name:'<img src=x onerror=alert(1)> Bay', color:'#0891b2', location_id:null, sort_order:10, shape:[[0.6,0.15],[0.75,0.15],[0.75,0.3],[0.6,0.3]] },
            { id:'z3333333-3333-4333-8333-333333333333', map_id:mapId, project_id:project.id, parent_id:null, is_active:false, name:'Old Bay', color:'#d97706', location_id:null, sort_order:30, shape:[[0.05,0.7],[0.3,0.7],[0.3,0.95],[0.05,0.95]] },
            { id:'z3a33333-3333-4333-8333-333333333333', map_id:mapId, project_id:project.id, parent_id:'z3333333-3333-4333-8333-333333333333', is_active:true, name:'Old Bay A', color:'#dc2626', location_id:null, sort_order:10, shape:[[0.07,0.72],[0.18,0.72],[0.18,0.93],[0.07,0.93]] }],
        inventory_records: [
            item(1,'GT2-LO-001','Lube oil cooler',{category_id:cat(3).id,count_status:'counted',condition:'good',site_map_id:mapId,pin_x:0.2,pin_y:0.3,zone_id:'z1111111-1111-4111-8111-111111111111',location:'T1 Pipe Racks',counted_at:'2026-10-26T15:00:00Z',last_scanned_by:'Jordan Field',part_number:'LOC-77'}),
            item(2,'GT2-LO-002','Lube oil filter',{category_id:cat(2).id,part_number:'LOF-220'}),
            item(3,'GT2-FS-010','Fuel skid',{category_id:cat(5).id,count_status:'received',site_map_id:mapId,pin_x:0.7,pin_y:0.3,zone_id:'z2222222-2222-4222-8222-222222222222',counted_at:'2026-10-25T10:00:00Z',last_scanned_by:'Jordan Field',receiving_record_id:'c1111111-1111-4111-8111-111111111111'}),
            item(4,'EL-CD-100','Cable drum 240 m',{category_id:cat(7).id,quantity:3,count_status:'counted',source:'field',site_map_id:mapId,pin_x:0.3,pin_y:0.35,zone_id:'z1b11111-1111-4111-8111-111111111111',location:'T1 Pipe Racks › Rack 2',counted_at:'2026-10-27T09:00:00Z',last_scanned_by:'Jordan Field'}),
            item(5,'X-<i>1</i>','<img src=x onerror=alert(1)>',{category_id:cat(4).id,quantity:1.5,uom:'M',count_status:'counted',source:'field',site_map_id:mapId,pin_x:0.8,pin_y:0.4,scanner_comments:'"><script>alert(2)</script>',counted_at:'2026-10-27T10:00:00Z',last_scanned_by:'Jordan Field',condition:'damaged'}),
            item(6,'GT2-LO-003','Lube oil pump',{site_map_id:mapId,pin_x:0.68,pin_y:0.22,zone_id:'z2a22222-2222-4222-8222-222222222222'}),
        ],
        inventory_photos: [{ id:'p1', project_id:project.id, inventory_uid:'a1000000-0000-4000-8000-000000000000', storage_path:'a1000000-0000-4000-8000-000000000000/op-1.jpg', created_at:'2026-10-26T15:00:00Z' }],
    };
    // Places and crates (021). Made-up fixture rows: a markup-named shop, a retired yard, and a yard tied to a
    // project this user is not assigned to (read-only for them). Crates nest three deep under HU-AAAA11.
    const place = (n, name, kind, extra = {}) => ({ id:`f${n}000000-0000-4000-8000-000000000000`, kind, name, project_id:null, address:null, city:null, state:null, postal_code:null,
        latitude:null, longitude:null, geofence_radius_m:300, contact_name:null, contact_phone:null, contact_email:null, secondary_contact_name:null, secondary_contact_phone:null,
        notes:null, is_active:true, created_at:'2026-10-28T12:00:00Z', updated_at:'2026-10-28T12:00:00Z', ...extra });
    state.inventory.places ||= [
        place(1,'North Yard laydown','yard',{project_id:project.id,address:'1200 Fixture Rd',city:'Freeport',state:'TX',postal_code:'77541',latitude:28.954213,longitude:-95.359671,geofence_radius_m:400,contact_name:'Gate office',contact_phone:'555-0100'}),
        place(2,'Coastal Terminal site','site',{city:'Freeport',state:'TX',latitude:28.931,longitude:-95.312,geofence_radius_m:1500}),
        place(3,'Fixture Machine Works','outside_shop',{address:'48 Example Ave',city:'Houston',state:'TX',postal_code:'77002',latitude:29.7521,longitude:-95.3612,geofence_radius_m:250,contact_name:'Sam Rivera',contact_phone:'555-0142',contact_email:'sam@shop.example.test',secondary_contact_name:'Lee Chen',secondary_contact_phone:'555-0143',notes:'Loading dock on the north side.'}),
        place(4,'Gulf Valve Supply','vendor',{city:'Pasadena',state:'TX',contact_name:'Orders desk',contact_email:'orders@valves.example.test'}),
        place(5,'<img src=x onerror=alert(1)> Fab Shop','outside_shop',{city:'Baytown',state:'TX',latitude:29.7355,longitude:-94.9774,notes:'"><script>alert(2)</script>'}),
        place(6,'Old Pipe Yard','yard',{is_active:false,city:'Angleton',state:'TX',latitude:29.169,longitude:-95.431}),
        place(7,'West Yard gate','yard',{project_id:'b3333333-3333-4333-8333-333333333333',city:'Sweeny',state:'TX',latitude:29.04,longitude:-95.698}),
    ];
    const unit = (code, extra = {}) => ({ id:`h${code.slice(3,7)}000-0000-4000-8000-000000000000`, project_id:project.id, code, kind:'crate', description:null, is_high_value:false, status:'open',
        parent_id:null, parent_code:null, place_id:null, place_name:null, site_map_id:null, zone_id:null, location:null, item_count:0, unit_count:0, sealed_at:null,
        created_at:'2026-10-28T14:00:00Z', updated_at:'2026-10-28T14:00:00Z', ...extra });
    const top = { top_unit_id:'hAAAA000-0000-4000-8000-000000000000', top_code:'HU-AAAA11', place_id:'f1000000-0000-4000-8000-000000000000', place_name:'North Yard laydown', site_map_id:mapId, zone_id:'z1b11111-1111-4111-8111-111111111111', location:'T1 Pipe Racks › Rack 2' };
    state.inventory.handling_unit_overview ||= [
        unit('HU-AAAA11',{...top,description:'Lube oil spares',status:'sealed',item_count:2,unit_count:1,sealed_at:'2026-10-28T16:00:00Z'}),
        unit('HU-BBBB22',{...top,kind:'basket',description:'Small parts',parent_id:'hAAAA000-0000-4000-8000-000000000000',parent_code:'HU-AAAA11',item_count:1,unit_count:1}),
        unit('HU-CCCC33',{...top,description:'Filters',parent_id:'hBBBB000-0000-4000-8000-000000000000',parent_code:'HU-BBBB22',item_count:1}),
        unit('HU-DDDD44',{kind:'skid',description:'Turbine instruments',is_high_value:true,status:'on_load',item_count:1,top_unit_id:'hDDDD000-0000-4000-8000-000000000000',top_code:'HU-DDDD44',place_name:'North Yard laydown',sealed_at:'2026-10-27T10:00:00Z'}),
        unit('HU-EEEE55',{kind:'container',description:'Cable drums',status:'delivered',top_unit_id:'hEEEE000-0000-4000-8000-000000000000',top_code:'HU-EEEE55',place_name:'Coastal Terminal site',sealed_at:'2026-10-25T10:00:00Z'}),
        unit('HU-FFFF66',{status:'unpacked',top_unit_id:'hFFFF000-0000-4000-8000-000000000000',top_code:'HU-FFFF66',place_name:'North Yard laydown',location:'Warehouse'}),
        unit('HU-GGGG77',{description:'<img src=x onerror=alert(1)> crate',item_count:1,top_unit_id:'hGGGG000-0000-4000-8000-000000000000',top_code:'HU-GGGG77'}),
        unit('HU-ZZZZ99',{project_id:other.id,description:'South Yard crate (another project)',top_unit_id:'hZZZZ000-0000-4000-8000-000000000000',top_code:'HU-ZZZZ99'}),
    ];
    const packed = (n, code, tag, name, quantity, uom = 'EA') => ({ id:`i${n}000000-0000-4000-8000-000000000000`, project_id:project.id, unit_id:`h${code.slice(3,7)}000-0000-4000-8000-000000000000`, unit_code:code, tag, name, quantity, uom, packed_at:'2026-10-28T15:00:00Z' });
    state.inventory.handling_unit_items ||= [
        packed(1,'HU-AAAA11','GT2-LO-001','Lube oil cooler',1), packed(2,'HU-AAAA11','EL-CD-100','Cable drum 240 m',3), packed(3,'HU-BBBB22','GT2-LO-003','Lube oil pump',1),
        packed(4,'HU-CCCC33','GT2-FS-011','Fuel filter set',4), packed(5,'HU-DDDD44','QR-TEST','Steel Pipe',8), packed(6,'HU-GGGG77','X-<i>1</i>','<img src=x onerror=alert(1)>',1.5,'M'),
    ];
    const svg = body => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`;
    const planImage = svg('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#f4f1e8"/><rect x="0" y="560" width="1600" height="90" fill="#c9c3b3"/><rect x="900" y="100" width="560" height="380" fill="#ddd6c4" stroke="#8a8370" stroke-width="6"/><g fill="none" stroke="#8a8370" stroke-width="3">' + Array.from({length:8},(_,i)=>`<rect x="${100+i*60}" y="120" width="40" height="300"/>`).join('') + '</g><text x="60" y="980" font-size="40" fill="#5a5444" font-family="sans-serif">North Yard (fixture plan)</text></svg>');
    const photoImage = svg('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#cfd8e3"/><circle cx="240" cy="160" r="90" fill="#7d8ea3"/><text x="20" y="300" font-size="24" font-family="sans-serif">Fixture photo</text></svg>');
    const uploads = new Map();
    const save = () => sessionStorage.setItem('fixtureState',JSON.stringify(state));
    const success = data => ({ data, error:null });
    const reportRows = {
        qr_codes: [{id:'q1111111-1111-4111-8111-111111111111',project_id:project.id,code_value:'QR-TEST',entity_type:'item',entity_id:'not-a-receipt-id'}],
        purchase_orders: [
            {id:1,project_id:project.id,purchase_order_id:'PO-20001',purchase_order_item:'00010',item_description:'Six-inch isolation valve',po_description:'Mechanical package',supplier:'Yard Supply',net_value:150,status:'Sent'},
            {id:2,project_id:project.id,purchase_order_id:'PO-20001',purchase_order_item:'00020',item_description:null,po_description:'Cable tray supports',supplier:'Yard Supply',net_value:50,status:'Sent'},
        ],
        shipments: [{id:1,project_id:project.id,shipment_number:'SHIP-10',po_number:'PO-20001',status:'Delivered'}, {id:2,project_id:project.id,shipment_number:'SHIP-20',po_number:'PO-20001',status:'In Transit',eta:new Date().toISOString().slice(0,10)}],
        dashboard_metrics: [{id:1,project_id:project.id,project_name:'Wrong imported name',last_updated:'2026-02-22T12:37:00Z',procurement:{total_pos:999},installation:{total_items:0}}],
        installation_datasets: [{project_id:project.id,dataset_key:'audit_data',payload:{items:[]},updated_at:'2026-02-22T12:37:00Z'}, {project_id:project.id,dataset_key:'discipline_summary',payload:{},updated_at:'2026-02-22T12:37:00Z'}],
        samsara_trackers: [{id:'gps-1',project_id:project.id,synced_at:new Date().toISOString()}],
    };
    class Query {
        constructor(table) { this.table=table; this.filters=[]; this.one=false; this.start=0; this.end=1000; this.write=null; }
        select() { return this; } insert(values) { this.write={insert:[].concat(values)}; return this; } update(values) { this.write={update:values}; return this; } eq(k,v) { this.filters.push(r=>r[k]===v); return this; } is(k,v) {this.filters.push(r=>(r[k] ?? null)===v);return this;}
        order(){return this;} range(a,b){this.start=a;this.end=b;return this;} limit(n){this.end=n-1;return this;}
        single(){this.one=true;return this;} maybeSingle(){return this.single();}
        lt(k,v){this.filters.push(r=>r[k]<v);return this;} in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
        gte(k,v){this.filters.push(r=>r[k]>=v);return this;}
        or(){return this;} on(){return this;} subscribe(callback){if(callback)callback('SUBSCRIBED');return this;}
        then(resolve,reject) {
            if (state.inventory[this.table]) return Promise.resolve(this.inventory()).then(resolve,reject);
            let rows = this.table==='users' ? [me,{id:'f1111111-1111-4111-8111-111111111111',full_name:'Jordan Field',role:'field_worker'}] : this.table==='projects' ? state.projects : this.table==='user_projects' ? (sessionStorage.getItem('fixtureNoProjects') ? [] : state.projects.map(p=>({user_id:me.id,project_id:p.id,projects:p}))) : this.table==='receiving_records'||this.table==='materials' ? state.records : this.table==='locations' ? [{id:'d1111111-1111-4111-8111-111111111111', project_id:project.id,zone:'A',row:'1',rack:'1'}] : [];
            const mode = new URLSearchParams(location.search).get('fixture');
            if (reportRows[this.table]) rows = mode==='empty' ? [] : reportRows[this.table];
            if ((mode==='error' && this.table==='purchase_orders' || mode==='work-error' && this.table==='receiving_records') || (mode==='gps-error' && this.table==='samsara_trackers')) return Promise.resolve({data:null,error:{message:'Fixture source unavailable'}}).then(resolve,reject);
            rows=rows.filter(r=>this.filters.every(f=>f(r))).slice(this.start,this.end+1);
            return Promise.resolve({data:this.one?rows[0]||null:rows,error:null,count:rows.length}).then(resolve,reject);
        }
        inventory() {
            const table = state.inventory[this.table];
            // Sibling names are unique, ignoring case: categories among non-archived rows, map areas among active ones (020).
            const live = row => ['site_map_zones','places'].includes(this.table) ? row.is_active!==false : row.status!=='archived';
            const clash = row => ['inventory_categories','site_map_zones','places'].includes(this.table) && live(row) && table.some(c=>c.id!==row.id && live(c) && (c.map_id||null)===(row.map_id||null) && (c.parent_id||null)===(row.parent_id||null) && c.name.toLowerCase()===row.name.toLowerCase());
            const defaults = { inventory_categories:{status:'active'}, site_map_zones:{parent_id:null,is_active:true}, places:{is_active:true,geofence_radius_m:300} }[this.table] || {};
            // 021: only office staff write places, and only for places outside a project or in one of theirs.
            if (this.table==='places' && this.write && me.role==='field_worker') return {data:null,error:{code:'42501',message:'new row violates row-level security policy for table "places"'}};
            if (this.table==='places' && this.write) Object.assign(this.write.insert?.[0]||this.write.update, {updated_at:new Date().toISOString()});
            if (this.write?.insert) {
                const added = this.write.insert.map(values => ({ id: crypto.randomUUID(), sort_order: 0, created_at: new Date().toISOString(), ...defaults, ...values }));
                if (added.some(clash)) return {data:null,error:{code:'23505',message:'duplicate key value violates unique constraint'}};
                table.push(...added); save();
                return {data:this.one?added[0]:added,error:null};
            }
            const mine = row => this.table!=='places' || !row.project_id || state.projects.some(p=>p.id===row.project_id);
            const rows = table.filter(r=>this.filters.every(f=>f(r)) && (!this.write || mine(r)));
            if (this.write?.update) {
                if (rows.some(row => clash({...row,...this.write.update}))) return {data:null,error:{code:'23505',message:'duplicate key value violates unique constraint'}};
                // 020's guard: an area can't end up inside itself.
                const above = id => { const ids = []; for (let node = table.find(r=>r.id===id); node && ids.length < 50; node = table.find(r=>r.id===node.parent_id)) ids.push(node.id); return ids; };
                if (this.table==='site_map_zones' && this.write.update.parent_id && rows.some(row => above(this.write.update.parent_id).includes(row.id))) return {data:null,error:{code:'22023',message:'An area cannot be placed inside itself'}};
                rows.forEach(row => Object.assign(row, this.write.update)); save();
                return {data:rows.map(row=>({...row})),error:null};
            }
            const page = rows.slice(this.start,this.end+1);
            return {data:this.one?page[0]||null:page,error:null};
        }
    }
    window.fixture = { state, me, calls: [] };
    window.supabase = { createClient: () => ({
        from: table => new Query(table), channel: () => new Query(''),
        auth: { getSession:async()=>success({session}),getUser:async()=>success({user:me}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), signOut:async()=>success(null), updateUser:async()=>success({user:me}) },
        rpc:async(name,payload)=>{
            window.fixture.calls.push({name,payload});
            if(name==='project_staff' && new URLSearchParams(location.search).get('fixture')==='staff-error') return {data:null,error:{message:'Fixture staff unavailable'}};
            if(name==='project_staff') return success([{id:me.id,full_name:me.full_name}]);
            if(name==='apply_field_operation') {
                if(payload.p_action==='exception') Object.assign(state.records[0],{exception_owner_id:payload.p_payload.ownerId,exception_due_date:payload.p_payload.dueDate,exception_notes:payload.p_payload.notes,exception_resolution:payload.p_payload.resolution,exception_resolved:payload.p_payload.resolution!=='hold'});
                save();return success({id:state.records[0].id});
            }
            if(name==='reserve_handling_unit_labels') {
                if(!['office_staff','admin'].includes(me.role)) return {data:null,error:{code:'42501',message:'Office access to an active project is required'}};
                if(!Number.isInteger(payload.p_count)||payload.p_count<1||payload.p_count>500) return {data:null,error:{code:'22023',message:'Reserve between 1 and 500 labels at a time'}};
                const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                return success(Array.from({length:payload.p_count},()=>({code:'HU-'+Array.from({length:6},()=>alphabet[Math.floor(Math.random()*32)]).join('')})));
            }
            if(name==='merge_inventory_category') {
                const categories=state.inventory.inventory_categories, from=categories.find(c=>c.id===payload.p_from), into=categories.find(c=>c.id===payload.p_into);
                const items=state.inventory.inventory_records.filter(r=>r.category_id===from.id), children=categories.filter(c=>c.parent_id===from.id&&c.status!=='archived');
                items.forEach(r=>{r.category_id=into.id;}); children.forEach(c=>{c.parent_id=into.id;}); from.status='archived'; if(into.status==='proposed')into.status='active';
                save();return success({items_moved:items.length,children_moved:children.length});
            }
            if(name==='import_inventory_items') {
                const inv=state.inventory, errors=[], rows=[], counts={created:0,updated:0,skipped:0,new_categories:0}, tags=new Map();
                payload.p_items.forEach((item,index)=>{
                    const tag=String(item.tag||'').trim(); tags.set(tag,(tags.get(tag)||0)+1);
                    if(!tag) errors.push({row:index+1,tag,message:'Tag number is required'});
                    else if(item.quantity!==undefined&&!/^[0-9]{1,9}(\.[0-9]{1,3})?$/.test(item.quantity)) errors.push({row:index+1,tag,message:'Quantity must be a positive number'});
                });
                for(const [tag,count] of tags) if(tag&&count>1) errors.push({row:null,tag,message:'Tag appears more than once in the file'});
                if(errors.length) return success({applied:false,errors,rows:[],created:0,updated:0,skipped:0,new_categories:0});
                const seen=new Set();
                payload.p_items.forEach((item,index)=>{
                    const tag=item.tag.trim(); let parent=null, path='';
                    for(const segment of String(item.category_path||'').split('>').map(s=>s.trim()).filter(Boolean)) {
                        path+='>'+segment.toLowerCase();
                        let found=inv.inventory_categories.find(c=>(c.parent_id||null)===parent&&c.status!=='archived'&&c.name.toLowerCase()===segment.toLowerCase());
                        if(!found) { if(!seen.has(path)){seen.add(path);counts.new_categories++;} if(payload.p_dry_run){parent='dry'+path;continue;} found={id:crypto.randomUUID(),project_id:project.id,parent_id:parent,name:segment,status:'active',sort_order:0}; inv.inventory_categories.push(found); }
                        parent=found.id;
                    }
                    const existing=inv.inventory_records.find(r=>r.qr_code.trim()===tag);
                    const action=!existing?'create':existing.count_status==='expected'?'update':`skip_${existing.count_status}`;
                    counts[action==='create'?'created':action==='update'?'updated':'skipped']++;
                    const values={inventory_item:item.name||item.description||tag,item_description:item.description||null,part_number:item.part_number||null,quantity:Number(item.quantity||1),uom:item.uom||'EA'};
                    if(!payload.p_dry_run&&action==='create') inv.inventory_records.push({id:Date.now()+index,uid:crypto.randomUUID(),project_id:project.id,qr_code:tag,count_status:'expected',source:'import',category_id:parent,site_map_id:null,pin_x:null,pin_y:null,zone_id:null,...values});
                    if(!payload.p_dry_run&&action==='update') Object.assign(existing,values,parent?{category_id:parent}:{});
                    rows.push({row:index+1,tag,action});
                });
                if(!payload.p_dry_run) save();
                return success({applied:!payload.p_dry_run,errors:[],rows,...counts});
            }
            return success(null);
        }, storage:{from:bucket=>({
            createSignedUrl:async path=>success({signedUrl:uploads.get(path)||(bucket==='site-plans'?planImage:bucket==='inventory-photos'?photoImage:'')}),
            upload:async(path,blob)=>{uploads.set(path,URL.createObjectURL(blob));return success({path});},
        })},
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

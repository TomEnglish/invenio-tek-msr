// Local login fixture only. No remote Auth, records, passwords or emails.
(() => {
    const scenario = new URLSearchParams(location.search).get('fixture');
    const success = data => ({data,error:null});
    let signedIn = scenario === 'existing-session';
    let listener = () => {};
    const session = {user:{id:'fixture-user',email:'worker@example.test'}};
    window.fixture = {calls:[]};
    window.supabase = {createClient:()=>({
        auth:{
            getSession:async()=>success({session:signedIn ? session : null}),
            onAuthStateChange:callback=>{ listener=callback; return {data:{subscription:{unsubscribe(){}}}}; },
            signInWithPassword:async()=>{signedIn=true;window.fixture.calls.push('password-login');return success({session});},
            verifyOtp:async({type,token})=>{
                window.fixture.calls.push(`verify-${type}`);
                if(token !== '123456') return {data:null,error:{code:'otp_expired',message:'Invalid code'}};
                signedIn=true;
                if(type==='recovery') listener('PASSWORD_RECOVERY',session);
                return success({session});
            },
            updateUser:async()=>{window.fixture.calls.push('password-update');return success({user:session.user});},
            resetPasswordForEmail:async()=>{window.fixture.calls.push('reset-request');return success({});},
            signOut:async()=>{signedIn=false;return success({});},
        },
        rpc:async name=>{
            window.fixture.calls.push(name);
            if(!signedIn) return {error:{message:'Sign in first'}};
            if(scenario==='expired') return {error:{message:'Invitation expired'}};
            if(scenario==='cancelled') return {error:{message:'Invitation cancelled'}};
            if(scenario==='completion-error') return {error:{message:'Unable to connect'}};
            return success(null);
        },
    })};
})();

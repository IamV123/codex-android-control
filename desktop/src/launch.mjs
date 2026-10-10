import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Broker} from './broker.mjs';
import {startLocalTunnel} from './localtunnel.mjs';
import {StateStore} from './state-store.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const stateDir=resolve(process.env.CAC_RUNTIME||resolve(here,'../.runtime'));
mkdirSync(stateDir,{recursive:true,mode:0o700});
const state=resolve(stateDir,'broker.json');
let endpoint=process.env.CAC_PUBLIC_ORIGIN;
const provider=process.env.CAC_TUNNEL_PROVIDER||'cloudflare';
const temporary=process.env.CAC_TEMPORARY_TUNNEL==='1'||(provider==='cloudflare'&&!endpoint);
const store=temporary?null:new StateStore(resolve(stateDir,'continuity.json'));
const broker=await new Broker({store}).start();
let tunnel,backup,stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;tunnel?.kill();backup?.close();await broker.close();rmSync(state,{force:true});process.exit(code);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
async function verifyRoute(endpoint){for(let attempt=0;attempt<10;attempt++){try{const r=await fetch(endpoint+'/phone/v3/health',{headers:{'User-Agent':'CodexAndroidControl/0.1.8',Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(6000)});if(r.status===200&&(await r.json()).server===broker.healthId)return true;}catch{}await new Promise(r=>setTimeout(r,1500));}return false;}
if(!['localtunnel','cloudflare'].includes(provider)){console.error('Unknown tunnel provider.');await stop(1);}
if(!endpoint&&provider==='localtunnel'){
  console.log('Connecting or restoring the fixed encrypted phone channel...');
  try{backup=await startLocalTunnel(broker.phonePort,{subdomain:store?.value.tunnelName||null,cached:store?.value.tunnelCache||null,onAllocation:info=>{broker.restore(info.url);if(store)store.save({...store.value,tunnelCache:info});},verify:verifyRoute,onFailure:()=>{console.error('Phone tunnel stopped. Authorized phone waits for reconnection.');stop(1);}});endpoint=backup.url;}
  catch(e){console.error(e.message);await stop(1);}
}
if(!endpoint){
  const exe=resolve(here,'../bin/cloudflared.exe');
  if(!existsSync(exe)){console.error('Run Start-Desktop.ps1 first to download the verified tunnel client.');await stop(1);}
  tunnel=spawn(exe,['tunnel','--no-autoupdate','--url',`http://127.0.0.1:${broker.phonePort}`,'--protocol','http2'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  console.log('Connecting the temporary HTTPS tunnel (up to 45 seconds)...');
  endpoint=await new Promise((resolveEndpoint,reject)=>{
    let publicOrigin=null,registered=false,logTail='';
    const timeout=setTimeout(()=>reject(new Error('Tunnel did not become ready within 45 seconds.')),45000);
    tunnel.stderr.on('data',chunk=>{
      logTail=(logTail+chunk.toString()).slice(-12000);
      const match=logTail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if(match)publicOrigin=match[0];
      if(logTail.includes('Registered tunnel connection'))registered=true;
      if(publicOrigin&&registered){clearTimeout(timeout);resolveEndpoint(publicOrigin);}
    });
    tunnel.once('error',e=>{clearTimeout(timeout);reject(e);});
    tunnel.once('exit',()=>{clearTimeout(timeout);reject(new Error('Tunnel exited.'));});
  }).catch(async e=>{console.error(e.message+' Check whether this network permits Cloudflare Tunnel. No phone session was opened.');await stop(1);});
  tunnel.on('exit',()=>{if(!stopping){console.error('Tunnel stopped. Authorized phone waits for reconnection.');stop(1);}});
}
if(!endpoint)process.exit(1);
try {
  // An allocated URL is not evidence that the tunnel can carry traffic.
  broker.restore(endpoint);
  const reachable=backup?true:await verifyRoute(endpoint);
  if(!reachable)throw new Error('Public HTTPS route is unreachable. No ready session will be advertised.');
}catch(e){console.error(e.message);await stop(1);}
writeFileSync(state,JSON.stringify({port:broker.adminPort,key:broker.adminKey,pid:process.pid,version:'0.1.8'}),{mode:0o600});
console.log(`Desktop ready: http://127.0.0.1:${broker.adminPort}/`);
console.log('Pair only from the local dashboard. Closing this program pauses the connection; use the phone Stop or dashboard Revoke to end authorization.');
console.log('The endpoint is reachable. Wait for the dashboard to show the actual phone before requesting actions.');
if(process.platform==='win32'&&process.env.CAC_NO_OPEN_BROWSER!=='1')spawn('explorer.exe',[`http://127.0.0.1:${broker.adminPort}/`],{windowsHide:true,stdio:'ignore'}).unref();

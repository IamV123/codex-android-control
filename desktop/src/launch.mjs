import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Broker} from './broker.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const stateDir=resolve(process.env.CAC_RUNTIME||resolve(here,'../.runtime'));
mkdirSync(stateDir,{recursive:true,mode:0o700});
const state=resolve(stateDir,'broker.json');
const broker=await new Broker().start();
let tunnel,stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;tunnel?.kill();await broker.close();rmSync(state,{force:true});process.exit(code);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
let endpoint=process.env.CAC_PUBLIC_ORIGIN;
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
  tunnel.on('exit',()=>{if(!stopping){console.error('Tunnel stopped. Session revoked.');stop(1);}});
}
if(!endpoint)process.exit(1);
try {
  // An allocated URL is not evidence that the tunnel can carry traffic.
  broker.createSession(endpoint);
  let reachable=false;
  for(let attempt=0;attempt<3;attempt++){
    try{const r=await fetch(endpoint+'/phone/v1/exchange',{method:'POST',signal:AbortSignal.timeout(6000)});if(r.status===401){reachable=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,1500));
  }
  if(!reachable)throw new Error('Public HTTPS route is unreachable. No ready session will be advertised.');
}catch(e){console.error(e.message);await stop(1);}
writeFileSync(state,JSON.stringify({port:broker.adminPort,key:broker.adminKey}),{mode:0o600});
console.log(`Desktop ready: http://127.0.0.1:${broker.adminPort}/`);
console.log('Pair only from the local dashboard. Close this program to revoke the session.');
if(process.platform==='win32')spawn('explorer.exe',[`http://127.0.0.1:${broker.adminPort}/`],{windowsHide:true,stdio:'ignore'}).unref();

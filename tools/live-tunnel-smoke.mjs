// Explicit manual network smoke test. No real phone or private user data is used.
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Broker} from '../desktop/src/broker.mjs';
import {newPhone} from '../desktop/test/phone.mjs';
const broker=await new Broker({pollMs:10,commandMs:15000}).start({adminPort:0,phonePort:0});
const tunnel=spawn(resolve('desktop/bin/cloudflared.exe'),['tunnel','--no-autoupdate','--url',`http://127.0.0.1:${broker.phonePort}`,'--protocol','http2'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let logs='',seq=0,rx=0,lastProbe='';
try {
  const endpoint=await new Promise((resolveUrl,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Tunnel startup timeout')),45000);
    tunnel.stderr.on('data',chunk=>{logs=(logs+chunk.toString()).slice(-20000);const match=logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match){clearTimeout(timer);resolveUrl(match[0]);}});
    tunnel.on('error',reject);tunnel.on('exit',()=>{clearTimeout(timer);reject(new Error('Tunnel exited early'));});
  });
  broker.createSession(endpoint);
  let ready=false;
  for(let i=0;i<6;i++) {
    try {const r=await fetch(endpoint+'/phone/v3/challenge',{method:'POST',signal:AbortSignal.timeout(8000)});lastProbe='HTTP '+r.status;if(r.status===401){ready=true;break;}}catch(e){lastProbe=e.cause?.code||e.name;}
    await new Promise(r=>setTimeout(r,2000));
  }
  if(!ready && process.platform==='win32'){
    const probe=spawnSync('curl.exe',['--silent','--show-error','--max-time','10','--output','NUL','--write-out','%{http_code}','--request','POST',endpoint+'/phone/v3/challenge'],{encoding:'utf8',windowsHide:true,timeout:12000});
    console.error('Independent Windows curl HTTPS probe: '+(probe.stdout||'')+' / exit '+probe.status);
  }
  assert.equal(ready,true,'Public HTTPS route did not become ready');
  assert.equal((await fetch(endpoint+'/api/status',{signal:AbortSignal.timeout(8000)})).status,404);
  const p=JSON.parse(Buffer.from(new URL(broker.pairing()).searchParams.get('data'),'base64url'));
  const phone=newPhone(broker,p,[],undefined,{origin:endpoint});
  assert.equal((await phone.connect()).status,200);
  const pending=broker.command('phone_home',{});pending.catch(()=>{});
  const issued=(await phone.poll()).data.command;
  await phone.poll({event:'result',response:{id:issued.id,ok:true,data:{simulator:true}}});
  assert.deepEqual(await pending,{simulator:true});
  broker.revoke();assert.equal((await phone.poll()).status,401);
  console.log('PASS: live public HTTPS, unauthorized rejection, admin isolation, encrypted simulated command/result, revocation.');
  console.log('No real phone, mobile network or app operation was tested. Temporary tunnel will now close.');
} catch(e) {
  console.error(e.message);
  console.error('Last HTTPS probe: '+lastProbe);
  // Emit only known diagnostic categories, never the transient URL or credentials.
  for(const line of logs.split(/\r?\n/).filter(line=>/ERR|WRN|Registered tunnel connection|Initial protocol|Starting metrics|Settings:|tunnel connection/.test(line)).slice(-10))console.error(line.replace(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,'[temporary-tunnel]').replace(/token=[^ ]+/g,'token=[redacted]'));
  process.exitCode=1;
} finally {tunnel.kill();await broker.close();}

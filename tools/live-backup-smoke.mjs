// Explicit network check: simulated encrypted data only, never a real phone.
import assert from 'node:assert/strict';
import {Broker} from '../desktop/src/broker.mjs';
import {startLocalTunnel} from '../desktop/src/localtunnel.mjs';
import {credentials,seal,unseal} from '../desktop/src/protocol.mjs';
const broker=await new Broker({commandMs:15000}).start({adminPort:0,phonePort:0});
let tunnel,tx=0,rx=0,stage='allocate';
try {
  tunnel=await startLocalTunnel(broker.phonePort);
  const endpoint=tunnel.url;
  const pair=JSON.parse(Buffer.from(new URL(broker.createSession(endpoint)).searchParams.get('data'),'base64url'));
  const c=credentials(Buffer.from(pair.key,'base64url'),pair.session);
  const request=(path,options={})=>fetch(endpoint+path,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  stage='unauthorized';assert.equal((await request('/phone/v1/exchange',{method:'POST'})).status,401);
  stage='admin isolation';assert.equal((await request('/api/status')).status,404);
  async function poll(payload){
    const r=await request('/phone/v1/exchange',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:JSON.stringify(seal(c.key,pair.session,'phone',++tx,payload))});
    assert.equal(r.status,200);const frame=await r.json();const data=unseal(c.key,pair.session,'desktop',rx,frame);rx=frame.seq;return data;
  }
  stage='initial poll';await poll({event:'poll',phone:{apps:[],remainingSeconds:600}});
  const pending=broker.command('phone_home',{});
  pending.catch(()=>{});
  stage='command delivery';const issued=await poll({event:'poll'});assert.equal(issued.command.tool,'phone_home');
  stage='result return';await poll({event:'result',response:{id:issued.command.id,ok:true,data:{simulator:true}}});
  assert.deepEqual(await pending,{simulator:true});
  stage='revocation';broker.revoke();
  assert.equal((await request('/phone/v1/exchange',{method:'POST',headers:{Authorization:'Bearer '+c.token}})).status,401);
  console.log('PASS: public HTTPS route, unauthorized rejection, admin isolation, encrypted command/result round trip, revocation.');
  console.log('Simulated phone only. Actual Android and mobile-network acceptance remain untested.');
}catch(e){console.error(stage+': '+(e.cause?.code||e.message));process.exitCode=1;}
finally{tunnel?.close();await broker.close();}

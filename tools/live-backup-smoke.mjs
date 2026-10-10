// Explicit public-network test, with only a simulated phone and generated keys.
import assert from 'node:assert/strict';
import {Broker} from '../desktop/src/broker.mjs';
import {startLocalTunnel} from '../desktop/src/localtunnel.mjs';
import {newPhone} from '../desktop/test/phone.mjs';
const broker=await new Broker({commandMs:30000}).start({adminPort:0,phonePort:0});let tunnel,stage='allocate';
try{
  tunnel=await startLocalTunnel(broker.phonePort);const endpoint=tunnel.url,pair=JSON.parse(Buffer.from(new URL(broker.createSession(endpoint)).searchParams.get('data'),'base64url'));
  stage='admin isolation';assert.equal((await fetch(endpoint+'/api/status',{headers:{'User-Agent':'CodexAndroidControl/0.1.7'},signal:AbortSignal.timeout(10000)})).status,404);
  const phone=newPhone(broker,pair,[],undefined,{origin:endpoint});stage='v3 handshake';assert.equal((await phone.connect()).status,200);assert.equal((await phone.poll()).status,200);
  stage='simulated command';const pending=broker.command('phone_home',{});pending.catch(()=>{});const issued=(await phone.poll()).data.command;assert.equal(issued.tool,'phone_home');await phone.poll({event:'result',response:{id:issued.id,ok:true,data:{simulated:true}}});assert.deepEqual(await pending,{simulated:true});
  stage='revoke';broker.revoke();assert.equal((await phone.poll()).status,401);console.log('PASS: v3 public HTTPS handshake, admin isolation, encrypted simulated command/receipt, revocation. No real phone was operated.');
}catch(e){console.error(stage+': '+e.message);process.exitCode=1;}finally{tunnel?.close();await broker.close();}

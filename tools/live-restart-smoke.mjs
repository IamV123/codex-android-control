// Explicit network test with a simulated phone. It never controls a real device.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {Broker} from '../desktop/src/broker.mjs';
import {StateStore} from '../desktop/src/state-store.mjs';
import {startLocalTunnel} from '../desktop/src/localtunnel.mjs';
import {newPhone} from '../desktop/test/phone.mjs';
const build=resolve('tools/build');mkdirSync(build,{recursive:true});const runtime=mkdtempSync(resolve(build,'restart-')),file=resolve(runtime,'continuity.json');
let broker,tunnel,stage='initialize';const decode=raw=>JSON.parse(Buffer.from(new URL(raw).searchParams.get('data'),'base64url'));
async function verify(endpoint){for(let i=0;i<3;i++){try{const r=await fetch(endpoint+'/phone/v3/health',{headers:{'User-Agent':'CodexAndroidControl/0.1.7'},signal:AbortSignal.timeout(6000)});if(r.ok&&(await r.json()).server===broker.healthId)return true;}catch{}await new Promise(r=>setTimeout(r,1000));}return false;}
function options(store){return {subdomain:store.value.tunnelName,cached:store.value.tunnelCache||null,onAllocation:info=>{broker.restore(info.url);store.save({...store.value,tunnelCache:info});},verify};}
try{
  let store=new StateStore(file);store.initialize();broker=await new Broker({store,pollMs:10,commandMs:30000}).start({adminPort:0,phonePort:0});
  stage='allocate fixed tunnel';tunnel=await startLocalTunnel(broker.phonePort,options(store));const endpoint=tunnel.url;broker.restore(endpoint);const raw=broker.pairing(),pair=decode(raw),deadline=pair.expiresAt;
  const first=newPhone(broker,pair,['com.example.simulator'],undefined,{origin:endpoint});stage='initial authenticated handshake';assert.equal((await first.connect()).status,200);assert.equal((await first.poll()).status,200);
  stage='encrypted simulated command receipt';const pending=broker.command('phone_home',{});pending.catch(()=>{});const command=(await first.poll()).data.command;assert.ok(command);await first.poll({event:'result',response:{id:command.id,ok:true,data:{simulated:true}}});assert.deepEqual(await pending,{simulated:true});
  stage='stop desktop';tunnel.close();tunnel=null;await broker.close();broker=null;await new Promise(r=>setTimeout(r,2000));
  store=new StateStore(file);broker=await new Broker({store,pollMs:10}).start({adminPort:0,phonePort:0});stage='recover same public tunnel';tunnel=await startLocalTunnel(broker.phonePort,options(store));assert.equal(tunnel.url,endpoint);broker.restore(tunnel.url);assert.equal(broker.pairing(),raw);assert.equal(broker.session.expiresAt,deadline);
  stage='reconnect without new pairing';const second=newPhone(broker,pair,['com.example.simulator'],undefined,{origin:endpoint});assert.equal((await second.connect()).status,200);assert.equal((await second.poll()).status,200);assert.equal(broker.status().connected,true);assert.notEqual(second.c.id,first.c.id);assert.equal(broker.status().pending,false);
  stage='revocation';broker.revoke();assert.equal((await second.poll()).status,401);
  console.log('PASS: same public HTTPS address and pairing after desktop/tunnel restart; new transport connects; original expiry preserved; simulated command receipt; revocation.');
  console.log('This is a simulated phone and process restart. A real PC reboot and Android long-duration survival still need live acceptance.');
}catch(e){console.error(stage+': '+e.message);process.exitCode=1;}
finally{tunnel?.close();if(broker)await broker.close();const target=resolve(runtime);if(!target.startsWith(build+sep)||target===build)throw new Error('unsafe_temporary_cleanup');rmSync(target,{recursive:true,force:true});}

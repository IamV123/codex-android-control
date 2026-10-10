// Explicit public-network test of the exact HTTP utility included in the APK.
// Uses a separate broker and generated test credentials, never a user's session.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Broker} from '../desktop/src/broker.mjs';
import {startLocalTunnel} from '../desktop/src/localtunnel.mjs';
import {credentials,seal,unseal} from '../desktop/src/protocol.mjs';
const suffix=process.platform==='win32'?'.exe':'';
const exe=name=>process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',name+suffix):name;
const output=resolve('tools/build');
const compiled=spawnSync(exe('javac'),['-encoding','UTF-8','-d',output,'app/src/main/java/io/github/iamv123/codexandroid/PhoneHttp.java','tools/PhoneHttpProbe.java'],{encoding:'utf8'});
assert.equal(compiled.status,0,compiled.stderr);
function request(endpoint,token,body){return new Promise((resolve,reject)=>{
  const child=spawn(exe('java'),['-Dfile.encoding=UTF-8','-cp',output,'io.github.iamv123.codexandroid.PhoneHttpProbe'],{stdio:['pipe','pipe','pipe']});
  let out='',err='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Java probe timeout'));},30000);
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.once('error',e=>{clearTimeout(timeout);reject(e);});
  child.once('close',code=>{clearTimeout(timeout);resolve({code,out,err:err.trim()});});
  child.stdin.end(endpoint+'\n'+token+'\n'+JSON.stringify(body)+'\n');
});}
const broker=await new Broker({commandMs:15000}).start({adminPort:0,phonePort:0});
let tunnel,tx=0,rx=0,stage='allocate';
try{
  tunnel=await startLocalTunnel(broker.phonePort);
  const pair=JSON.parse(Buffer.from(new URL(broker.createSession(tunnel.url)).searchParams.get('data'),'base64url'));
  const c=credentials(Buffer.from(pair.key,'base64url'),pair.session);
  stage='unauthorized';let r=await request(tunnel.url,'invalid-test-token',{});assert.equal(r.err,'HTTP 401');
  console.log('PASS: Java HTTPS request reaches the broker; invalid token rejected.');
  async function poll(payload){
    const response=await request(tunnel.url,c.token,seal(c.key,pair.session,'phone',++tx,payload));
    assert.equal(response.code,0,response.err);
    const frame=JSON.parse(response.out),data=unseal(c.key,pair.session,'desktop',rx,frame);rx=frame.seq;return data;
  }
  stage='initial poll';await poll({event:'poll',phone:{apps:[],remainingSeconds:600}});
  stage='idle relay';console.log('Checking a 35-second idle interval before the next Java request.');await delay(35000);
  await poll({event:'poll'});
  const pending=broker.command('phone_home',{});pending.catch(()=>{});
  stage='command';const issued=await poll({event:'poll'});assert.equal(issued.command.tool,'phone_home');
  stage='result';await poll({event:'result',response:{id:issued.command.id,ok:true,data:{simulator:true}}});assert.deepEqual(await pending,{simulator:true});
  stage='revoke';broker.revoke();r=await request(tunnel.url,c.token,{});assert.equal(r.err,'HTTP 401');
  console.log('PASS: shared Java HTTP client, 35-second idle, encrypted command/result, revocation.');
  console.log('JVM simulated phone only; actual handset/carrier verification is still required.');
}catch(e){console.error(stage+': '+e.message);process.exitCode=1;}
finally{tunnel?.close();await broker.close();}

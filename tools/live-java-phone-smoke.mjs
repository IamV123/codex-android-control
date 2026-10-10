// Tests the APK's exact HTTP utility on a JVM using only generated test keys.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Broker} from '../desktop/src/broker.mjs';
import {startLocalTunnel} from '../desktop/src/localtunnel.mjs';
import {newPhone} from '../desktop/test/phone.mjs';
const suffix=process.platform==='win32'?'.exe':'',exe=name=>process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',name+suffix):name,output=resolve('tools/build');
const compiled=spawnSync(exe('javac'),['-encoding','UTF-8','-d',output,'app/src/main/java/io/github/iamv123/codexandroid/PhoneHttp.java','tools/PhoneHttpProbe.java'],{encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);
function request(endpoint,path,token,body){return new Promise((resolve,reject)=>{
  const child=spawn(exe('java'),['-Dfile.encoding=UTF-8','-cp',output,'io.github.iamv123.codexandroid.PhoneHttpProbe'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Java probe timeout'));},30000);
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',code=>{clearTimeout(timer);if(code===0)resolve({status:200,data:JSON.parse(out)});else if(/^HTTP \d+$/.test(err.trim()))resolve({status:Number(err.trim().slice(5)),data:{}});else reject(new Error(err.trim()||'Java probe failed'));});
  child.stdin.end(endpoint+'\n'+path+'\n'+token+'\n'+JSON.stringify(body)+'\n');
});}
const broker=await new Broker({commandMs:30000,pollMs:10}).start({adminPort:0,phonePort:0});let tunnel,stage='allocate';
try{
  tunnel=await startLocalTunnel(broker.phonePort);const endpoint=tunnel.url,pair=JSON.parse(Buffer.from(new URL(broker.createSession(endpoint)).searchParams.get('data'),'base64url'));
  stage='unauthorized';assert.equal((await request(endpoint,'/phone/v3/challenge','invalid-test-token',{})).status,401);
  const phone=newPhone(broker,pair,[],undefined,{transport:(path,token,body)=>request(endpoint,path,token,body)});
  stage='Java v3 handshake';assert.equal((await phone.connect()).status,200);assert.equal((await phone.poll()).status,200);console.log('PASS: shared Java HTTPS utility and v3 handshake. Checking a 35-second idle interval.');
  await delay(35000);stage='idle recovery';assert.equal((await phone.poll()).status,200);
  stage='simulated command';const pending=broker.command('phone_home',{});pending.catch(()=>{});const issued=(await phone.poll()).data.command;await phone.poll({event:'result',response:{id:issued.id,ok:true,data:{simulated:true}}});assert.deepEqual(await pending,{simulated:true});
  stage='revoke';broker.revoke();assert.equal((await phone.poll()).status,401);console.log('PASS: shared Java HTTP client, 35-second idle, encrypted simulated command/receipt, revocation. Actual Android/carrier acceptance is separate.');
}catch(e){console.error(stage+': '+e.message);process.exitCode=1;}finally{tunnel?.close();await broker.close();}

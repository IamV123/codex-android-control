import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {Broker} from '../src/broker.mjs';
import {credentials,seal,unseal} from '../src/protocol.mjs';
import {validateTool} from '../src/tools.mjs';

async function fixture(t,options={}) {
  const broker=await new Broker({pollMs:5,...options}).start({adminPort:0,phonePort:0});
  t.after(()=>broker.close());
  const pair=JSON.parse(Buffer.from(new URL(broker.createSession('https://example.test')).searchParams.get('data'),'base64url'));
  const c=credentials(Buffer.from(pair.key,'base64url'),pair.session);let seq=0,rx=0;
  async function poll(data={event:'poll',phone:{apps:[],remainingSeconds:600}},frame) {
    const r=await fetch(`http://127.0.0.1:${broker.phonePort}/phone/v1/exchange`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:JSON.stringify(frame||seal(c.key,pair.session,'phone',++seq,data))});
    const body=await r.json();
    if(r.ok){const clear=unseal(c.key,pair.session,'desktop',rx,body);rx=body.seq;return {status:r.status,data:clear,frame:body};}
    return {status:r.status,data:body};
  }
  return {broker,pair,c,poll};
}
test('AES-GCM detects tampering, wrong direction/session and replay',()=>{
  const master=randomBytes(32),id='0123456789abcdef0123456789abcdef',c=credentials(master,id);
  const frame=seal(c.key,id,'phone',1,{text:'你好'});
  assert.deepEqual(unseal(c.key,id,'phone',0,frame),{text:'你好'});
  assert.throws(()=>unseal(c.key,id,'phone',1,frame));
  assert.throws(()=>unseal(c.key,id,'desktop',0,frame));
  assert.throws(()=>unseal(c.key,'wrong','phone',0,frame));
  const bytes=Buffer.from(frame.data,'base64');bytes[0]^=1;
  assert.throws(()=>unseal(c.key,id,'phone',0,{...frame,data:bytes.toString('base64')}));
});
test('no arbitrary tools, extra arguments or oversized input',()=>{
  assert.throws(()=>validateTool('shell',{command:'id'}));
  assert.throws(()=>validateTool('phone_home',{package:'com.android.settings'}));
  assert.throws(()=>validateTool('phone_type',{node:'x',text:'x'.repeat(2001)}));
  assert.throws(()=>validateTool('phone_scroll',{node:'x',direction:'left'}));
  for(const direction of ['up','down','left','right'])assert.doesNotThrow(()=>validateTool('phone_swipe',{node:'x',direction}));
  assert.throws(()=>validateTool('phone_swipe',{node:'x',direction:'forward'}));
  assert.throws(()=>validateTool('phone_swipe',{node:'x',direction:'up',x:10,y:20}));
  assert.doesNotThrow(()=>validateTool('phone_back',{}));
});
test('phone channel cannot access admin routes; admin rejects foreign origin/host',async t=>{
  const {broker}=await fixture(t);
  assert.equal((await fetch(`http://127.0.0.1:${broker.phonePort}/api/status`)).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${broker.adminPort}/api/status`)).status,401);
  assert.equal((await fetch(`http://127.0.0.1:${broker.adminPort}/api/status`,{headers:{'X-Admin-Key':broker.adminKey,Origin:'https://evil.test'}})).status,403);
  const badHost=await new Promise((resolve,reject)=>{const r=http.get({hostname:'127.0.0.1',port:broker.adminPort,path:'/api/status',headers:{'X-Admin-Key':broker.adminKey,Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});
  assert.equal(badHost,403);
  assert.equal((await fetch(`http://127.0.0.1:${broker.phonePort}/phone/v1/exchange`,{method:'POST',body:'x'})).status,401);
});
test('encrypted command and result round trip without default app grants',async t=>{
  const {broker,poll}=await fixture(t);
  await poll();assert.deepEqual(broker.status().phone.apps,[]);
  const pending=broker.command('phone_home',{});
  const delivered=await poll();assert.equal(delivered.data.command.tool,'phone_home');
  const id=delivered.data.command.id;
  await poll({event:'result',response:{id,ok:true,data:{performed:true}}});
  assert.deepEqual(await pending,{performed:true});
});
test('replayed phone frame and malformed ciphertext are rejected',async t=>{
  const {pair,c,poll}=await fixture(t);
  const frame=seal(c.key,pair.session,'phone',1,{event:'poll'});
  assert.equal((await poll(null,frame)).status,200);
  assert.equal((await poll(null,frame)).status,400);
  assert.equal((await poll(null,{...frame,seq:2})).status,400);
});

test('restarting sequence with a used pair is diagnosed; copy creates a fresh usable pair',async t=>{
  const {broker,pair,c,poll}=await fixture(t);
  await poll();
  const restarted=seal(c.key,pair.session,'phone',1,{event:'poll'});
  const rejected=await poll(null,restarted);
  assert.equal(rejected.status,400);assert.equal(rejected.data.error,'pairing_reused');
  assert.equal(broker.status().connectionIssue,'pairing_reused');
  const response=await fetch(`http://127.0.0.1:${broker.adminPort}/api/copy-pair`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':broker.adminKey},body:'{}'});
  assert.equal(response.status,200);
  const prepared=await response.json();
  assert.match(prepared.qr,/^data:image\/png/);
  const fresh=JSON.parse(Buffer.from(new URL(prepared.pairing).searchParams.get('data'),'base64url'));
  assert.notEqual(fresh.session,pair.session);assert.equal(broker.status().connectionIssue,null);
  assert.equal((await poll()).status,401);
  const nc=credentials(Buffer.from(fresh.key,'base64url'),fresh.session);
  const connected=await fetch(`http://127.0.0.1:${broker.phonePort}/phone/v1/exchange`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+nc.token},body:JSON.stringify(seal(nc.key,fresh.session,'phone',1,{event:'poll',phone:{apps:['com.dianping.v1'],remainingSeconds:600}}))});
  assert.equal(connected.status,200);assert.equal(broker.status().connected,true);
  assert.deepEqual(broker.status().phone.apps,['com.dianping.v1']);
});

test('copying an unused current pair preserves it; preparing a pair cannot interrupt a command',async t=>{
  const {broker,poll}=await fixture(t);
  const original=broker.pairing();
  const call=path=>fetch(`http://127.0.0.1:${broker.adminPort}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':broker.adminKey},body:'{}'});
  assert.equal((await (await call('copy-pair')).json()).pairing,original);
  assert.equal((await (await call('copy-pair')).json()).pairing,original);
  await poll();const pending=broker.command('phone_home',{});
  const rejected=assert.rejects(pending,/revoked_by_user/);
  for(const path of ['new','copy-pair']){
    assert.equal((await call(path)).status,409);assert.equal(broker.pairing(),original);assert.equal(broker.status().pending,true);
  }
  broker.revoke();await rejected;
});
test('expired and manually revoked sessions cannot issue commands',async t=>{
  const {broker,poll}=await fixture(t,{sessionMs:80});
  await poll();await new Promise(r=>setTimeout(r,100));
  await assert.rejects(broker.command('phone_home',{}),/phone_not_connected/);
  assert.equal((await poll()).status,401);
  broker.createSession('https://example.test');broker.revoke();assert.equal(broker.status().active,false);
});
test('only one command pending and timeout revokes instead of retrying unknown action',async t=>{
  const {broker,poll}=await fixture(t,{commandMs:80});
  await poll();const pending=broker.command('phone_home',{});
  const rejection=assert.rejects(pending,/command_timeout_session_revoked/);
  await assert.rejects(broker.command('phone_back',{}),/another_command_pending/);
  await rejection;assert.equal(broker.status().active,false);
});
test('phone refusal reaches caller unchanged',async t=>{
  const {broker,poll}=await fixture(t);await poll();
  const pending=broker.command('phone_open_app',{package:'com.unapproved.app'});
  const rejection=assert.rejects(pending,/app_not_authorized/);
  const {data}=await poll();await poll({event:'result',response:{id:data.command.id,ok:false,error:'app_not_authorized'}});await rejection;
});
test('pairing only permits a clean HTTPS origin',async t=>{
  const {broker}=await fixture(t);
  for(const bad of ['http://example.test','https://u:p@example.test','https://example.test/path','https://example.test:8443','https://example.test/#x'])assert.throws(()=>broker.createSession(bad));
});
test('oversized authenticated body is rejected before JSON processing',async t=>{
  const {broker,c}=await fixture(t);
  const r=await fetch(`http://127.0.0.1:${broker.phonePort}/phone/v1/exchange`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:'x'.repeat(360001)});
  assert.equal(r.status,400);
});
test('dashboard has no third-party resources and cannot be framed',async t=>{
  const {broker}=await fixture(t);
  const r=await fetch(`http://127.0.0.1:${broker.adminPort}/`);const html=await r.text();
  assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.doesNotMatch(html,/<script[^>]+src=/);assert.match(html,/data:image\/png/);
});

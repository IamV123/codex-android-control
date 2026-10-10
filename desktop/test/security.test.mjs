import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {Broker} from '../src/broker.mjs';
import {credentials,seal,unseal} from '../src/protocol.mjs';
import {validateTool} from '../src/tools.mjs';
import {newPhone} from './phone.mjs';

async function fixture(t,options={}) {
  const broker=await new Broker({pollMs:5,...options}).start({adminPort:0,phonePort:0});
  t.after(()=>broker.close());
  const pair=JSON.parse(Buffer.from(new URL(broker.createSession('https://example.test')).searchParams.get('data'),'base64url'));
  const phone=newPhone(broker,pair);assert.equal((await phone.connect()).status,200);
  return {broker,pair,c:phone.c,poll:phone.poll,phone};
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
  const frame=seal(c.key,c.id,'phone',1,{event:'poll'});
  assert.equal((await poll(null,frame)).status,200);
  assert.equal((await poll(null,frame)).status,400);
  assert.equal((await poll(null,{...frame,seq:2})).status,400);
});

test('used QR, page reload and adding Douyin authorize a new connection without counter reuse',async t=>{
  const {broker,pair,c,poll}=await fixture(t);
  await poll();
  const original=broker.pairing();
  const page=await fetch(`http://127.0.0.1:${broker.adminPort}/`);assert.equal(page.status,200);
  assert.equal(broker.pairing(),original);
  const response=await fetch(`http://127.0.0.1:${broker.adminPort}/api/copy-pair`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':broker.adminKey},body:'{}'});
  assert.equal(response.status,200);
  const prepared=await response.json();
  assert.match(prepared.qr,/^data:image\/png/);
  assert.equal(prepared.pairing,original);
  const fresh=newPhone(broker,pair,['com.dianping.v1','com.ss.android.ugc.aweme']);
  assert.notEqual(fresh.c.id,c.id);assert.notDeepEqual(fresh.c.key,c.key);
  assert.equal((await fresh.connect()).status,200);
  assert.equal((await poll()).status,401);
  assert.equal((await fresh.poll()).status,200);assert.equal(broker.status().connected,true);
  assert.deepEqual(broker.status().phone.apps,['com.dianping.v1','com.ss.android.ugc.aweme']);
  assert.equal(broker.status().connectionIssue,null);
});

test('handshake replay never resets counters or replaces the current connection',async t=>{
  const {broker,pair,phone,poll}=await fixture(t);await poll();
  assert.equal((await phone.connect()).status,409);
  const fresh=newPhone(broker,pair,['com.ss.android.ugc.aweme']);assert.equal((await fresh.connect()).status,200);
  assert.equal((await phone.connect()).status,409);
  assert.equal((await fresh.poll()).status,200);
  assert.deepEqual(broker.status().phone.apps,['com.ss.android.ugc.aweme']);
});

test('reconnection cannot discard a dispatched operation; its receipt is preserved',async t=>{
  const {broker,pair,poll}=await fixture(t);await poll();
  const pending=broker.command('phone_home',{}),issued=await poll();
  const fresh=newPhone(broker,pair,['com.ss.android.ugc.aweme']);
  assert.equal((await fresh.connect()).status,409);assert.equal(broker.status().pending,true);
  assert.equal((await poll({event:'result',response:{id:issued.data.command.id,ok:true,data:{performed:true}}})).status,200);
  assert.deepEqual(await pending,{performed:true});
  assert.equal((await fresh.connect()).status,200);assert.equal((await fresh.poll()).status,200);
});

test('old long poll ends when a new locally authorized connection starts',async t=>{
  const {broker,pair,poll}=await fixture(t,{pollMs:1000});
  const waiting=poll();
  await new Promise(r=>setTimeout(r,30));
  const fresh=newPhone(broker,pair);assert.equal((await fresh.connect()).status,200);
  assert.equal((await waiting).status,401);assert.equal((await fresh.poll()).status,200);
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
test('only one command pending and an undelivered timeout preserves pairing without late dispatch',async t=>{
  const {broker,poll}=await fixture(t,{commandMs:80});
  const original=broker.pairing(),expiresAt=broker.session.expiresAt;
  await poll();const pending=broker.command('phone_home',{});
  const rejection=assert.rejects(pending,/command_not_dispatched_connection_interrupted/);
  await assert.rejects(broker.command('phone_back',{}),/another_command_pending/);
  await rejection;assert.equal(broker.status().active,true);assert.equal(broker.status().pending,false);assert.equal(broker.status().recoveryRequired,false);
  assert.equal(broker.pairing(),original);assert.equal(broker.session.expiresAt,expiresAt);assert.equal((await poll()).data.command,null);
});
test('phone refusal reaches caller unchanged',async t=>{
  const {broker,poll}=await fixture(t);await poll();
  const pending=broker.command('phone_open_app',{package:'com.unapproved.app'});
  const rejection=assert.rejects(pending,/app_not_authorized/);
  const {data}=await poll();await poll({event:'result',response:{id:data.command.id,ok:false,error:'app_not_authorized'}});await rejection;
});
test('a valid-looking old pairing frame is classified locally but never authorizes a phone',async t=>{
  const b=await new Broker().start({adminPort:0,phonePort:0});t.after(()=>b.close());const raw=b.createSession('https://example.test');
  const original=b.pairing(),oldId=b.session.id==='f'.repeat(32)?'e'.repeat(32):'f'.repeat(32);
  const response=await fetch('http://127.0.0.1:'+b.phonePort+'/phone/v3/challenge',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer invalid-token'},body:JSON.stringify({session:oldId,seq:1})});
  assert.equal(response.status,401);assert.equal(b.status().connectionIssue,'stale_pair_code');assert.equal(b.status().connected,false);assert.equal(b.status().phone,null);assert.equal(b.pairing(),original);assert.equal(raw,original);
});
test('a delayed invalid challenge cannot label a replacement pairing as stale',async t=>{
  const b=await new Broker().start({adminPort:0,phonePort:0});t.after(()=>b.close());b.createSession('https://example.test');
  const frame=JSON.stringify({session:'f'.repeat(32),seq:1});
  const received=new Promise(resolve=>b.phoneServer.once('request',resolve));
  let request;
  const response=new Promise((resolve,reject)=>{request=http.request({hostname:'127.0.0.1',port:b.phonePort,path:'/phone/v3/challenge',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(frame),Authorization:'Bearer invalid-token'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});request.on('error',reject);});
  request.write(frame.slice(0,1));await received;const replacement=b.createSession('https://example.test');request.end(frame.slice(1));
  assert.equal(await response,401);assert.equal(b.status().connectionIssue,null);assert.equal(b.status().connected,false);assert.equal(b.status().phone,null);assert.equal(b.pairing(),replacement);
});
test('pairing only permits a clean HTTPS origin',async t=>{
  const {broker}=await fixture(t);
  for(const bad of ['http://example.test','https://u:p@example.test','https://example.test/path','https://example.test:8443','https://example.test/#x'])assert.throws(()=>broker.createSession(bad));
});
test('oversized authenticated body is rejected before JSON processing',async t=>{
  const {broker,c}=await fixture(t);
  const r=await fetch(`http://127.0.0.1:${broker.phonePort}/phone/v3/exchange`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:'x'.repeat(360001)});
  assert.equal(r.status,400);
});
test('dashboard has no third-party resources and cannot be framed',async t=>{
  const {broker}=await fixture(t);
  const r=await fetch(`http://127.0.0.1:${broker.adminPort}/`);const html=await r.text();
  assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.doesNotMatch(html,/<script[^>]+src=/);assert.match(html,/data:image\/png/);
  assert.match(html,/<link rel="icon" type="image\/png" href="data:image\/png;base64,[A-Za-z0-9+/=]+">/);
  assert.match(r.headers.get('content-security-policy'),/default-src 'none'; img-src data:; style-src 'nonce-/);
});

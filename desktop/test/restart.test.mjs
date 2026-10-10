import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,basename,dirname} from 'node:path';
import {StateStore,durationMs} from '../src/state-store.mjs';
import {Broker} from '../src/broker.mjs';
import {newPhone} from './phone.mjs';
const codec={kind:'test-only',encode:b=>b,decode:b=>b};
function fixture(t){const root=mkdtempSync(resolve(tmpdir(),'cac-restart-'));t.after(()=>{const target=resolve(root);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('cac-restart-'))throw new Error('unsafe_test_cleanup');rmSync(target,{recursive:true,force:true});});const file=resolve(root,'state.json');return {file,open:()=>new StateStore(file,{codec})};}
function decode(raw){return JSON.parse(Buffer.from(new URL(raw).searchParams.get('data'),'base64url'));}
async function broker(store,options={}){const b=await new Broker({store,pollMs:5,...options}).start({adminPort:0,phonePort:0});b.restore('https://fixed.example.test');return b;}

test('desktop restart restores the same QR and original deadline, with fresh transport and no grant expansion',async t=>{
  const f=fixture(t),first=await broker(f.open()),raw=first.pairing(),pair=decode(raw),p=newPhone(first,pair,['com.ss.android.ugc.aweme']);await p.connect();await p.poll();const expiry=first.session.expiresAt;
  await first.close();const next=await broker(f.open());t.after(()=>next.close());assert.equal(next.pairing(),raw);assert.equal(next.session.expiresAt,expiry);assert.equal(next.status().restored,true);assert.equal(next.status().connected,false);
  const renewed=newPhone(next,pair,['com.ss.android.ugc.aweme']);assert.equal((await renewed.connect()).status,200);await renewed.poll();assert.notEqual(renewed.c.id,p.c.id);assert.notDeepEqual(renewed.c.key,p.c.key);assert.deepEqual(next.status().phone.apps,['com.ss.android.ugc.aweme']);
});
test('captured handshake cannot reconnect after a desktop restart',async t=>{
  const f=fixture(t),first=await broker(f.open()),pair=decode(first.pairing()),p=newPhone(first,pair);await p.connect();const frame=p.frame,token=p.bootstrap.token;await first.close();
  const next=await broker(f.open());t.after(()=>next.close());const response=await fetch('http://127.0.0.1:'+next.phonePort+'/phone/v3/connect',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(frame)});assert.equal(response.status,409);assert.equal(next.status().connected,false);
});
test('revocation remains revoked after restart and expiry never renews automatically',async t=>{
  const f=fixture(t),first=await broker(f.open());first.revoke();await first.close();const next=await broker(f.open());assert.equal(next.status().active,false);await next.close();
  const store=f.open();store.save({...store.value,pair:{id:'a'.repeat(32),master:Buffer.alloc(32,1).toString('base64url'),endpoint:'https://fixed.example.test',createdAt:Date.now()-120000,expiresAt:Date.now()-1000,pending:null}});
  const expired=await broker(f.open());t.after(()=>expired.close());assert.equal(expired.status().active,false);assert.equal(f.open().value.pair,null);
});
test('restart retains an unknown dispatched operation and does not resend it',async t=>{
  const f=fixture(t),first=await broker(f.open()),pair=decode(first.pairing()),p=newPhone(first,pair);await p.connect();
  const pending=first.command('phone_click',{node:'known-visible-node'});pending.catch(()=>{});const issued=(await p.poll()).data.command;await first.close();await assert.rejects(pending,/desktop_stopped/);
  const next=await broker(f.open());t.after(()=>next.close());const renewed=newPhone(next,pair);const connected=await renewed.connect();assert.equal(connected.status,200);assert.equal(connected.data.recoveryRequired,true);
  assert.equal(next.status().unconfirmedOperation.id,issued.id);assert.equal((await renewed.poll()).data.command,null);await assert.rejects(next.command('phone_click',{node:'new-node'}),/previous_operation_requires_review/);
});
test('a completed phone receipt recovers an interrupted operation without executing it twice',async t=>{
  const f=fixture(t),first=await broker(f.open()),pair=decode(first.pairing()),p=newPhone(first,pair);await p.connect();const pending=first.command('phone_home',{});pending.catch(()=>{});const issued=(await p.poll()).data.command;await first.close();
  const next=await broker(f.open());t.after(()=>next.close());const fresh=newPhone(next,pair);assert.equal((await fresh.connect({id:issued.id,ok:true,data:{performed:true}})).status,200);assert.equal(next.status().recoveryRequired,false);assert.equal((await fresh.poll()).data.command,null);assert.equal(f.open().value.pair.pending,null);
});
test('live connection replacement can return a lost receipt but cannot drop an unknown write',async t=>{
  const f=fixture(t),b=await broker(f.open());t.after(()=>b.close());const pair=decode(b.pairing()),p=newPhone(b,pair);await p.connect();const pending=b.command('phone_home',{}),issued=(await p.poll()).data.command;
  const renewed=newPhone(b,pair);assert.equal((await renewed.connect({id:issued.id,ok:true,data:{performed:true}})).status,200);assert.deepEqual(await pending,{performed:true});assert.equal(b.status().pending,false);assert.equal((await renewed.poll()).data.command,null);
});

test('a dispatched write timeout retains authorization and a durable review block through restart',async t=>{
  const f=fixture(t),b=await broker(f.open(),{commandMs:100}),raw=b.pairing(),pair=decode(raw),p=newPhone(b,pair);await p.connect();
  const pending=b.command('phone_click',{node:'observed-target'}),rejected=assert.rejects(pending,/command_timeout_result_unknown/),issued=(await p.poll()).data.command;await rejected;
  assert.equal(b.status().active,true);assert.equal(b.status().pending,false);assert.equal(b.status().recoveryRequired,true);assert.equal(b.pairing(),raw);assert.equal(f.open().value.pair.pending.id,issued.id);
  const renewed=newPhone(b,pair);assert.equal((await renewed.connect()).status,200);assert.equal((await renewed.poll()).data.command,null);await assert.rejects(b.command('phone_back',{}),/previous_operation_requires_review/);await b.close();
  const next=await broker(f.open());t.after(()=>next.close());assert.equal(next.pairing(),raw);assert.equal(next.status().unconfirmedOperation.id,issued.id);const fresh=newPhone(next,pair);assert.equal((await fresh.connect()).status,200);assert.equal((await fresh.poll()).data.command,null);
});

test('a late matching receipt resolves a dispatched timeout without replay or new pairing',async t=>{
  const f=fixture(t),b=await broker(f.open(),{commandMs:100});t.after(()=>b.close());const raw=b.pairing(),pair=decode(raw),p=newPhone(b,pair);await p.connect();
  const pending=b.command('phone_home',{}),rejected=assert.rejects(pending,/command_timeout_result_unknown/),issued=(await p.poll()).data.command;await rejected;
  const renewed=newPhone(b,pair);assert.equal((await renewed.connect({id:issued.id,ok:true,data:{performed:true}})).status,200);assert.equal(b.status().recoveryRequired,false);assert.equal(b.pairing(),raw);assert.equal(f.open().value.pair.pending,null);assert.equal((await renewed.poll()).data.command,null);
});
test('private-state failure prevents dispatch; locking pauses without revoking the pairing',async t=>{
  const f=fixture(t),store=f.open(),b=await broker(store);t.after(()=>b.close());const p=newPhone(b,decode(b.pairing()));await p.connect();await p.poll({event:'poll',phone:{apps:[],remainingSeconds:600,locked:true}});await assert.rejects(b.command('phone_home',{}),/phone_locked/);assert.equal(b.status().active,true);
  await p.poll({event:'poll',phone:{apps:[],remainingSeconds:600,locked:false}});store.save=()=>{throw new Error('disk_full');};await assert.rejects(b.command('phone_home',{}),/write_failed/);assert.equal((await p.poll()).data.command,null);assert.equal(b.status().persistenceFault,true);
});
test('custom minutes, hours and days enforce the duration boundary',()=>{assert.equal(durationMs('7','days'),604800000);assert.equal(durationMs(2,'hours'),7200000);assert.equal(durationMs(30,'minutes'),1800000);for(const [v,u]of [[0,'days'],[31,'days'],[1.5,'hours'],['7x','days'],[1,'weeks']])assert.throws(()=>durationMs(v,u));});
test('starting desktop returns a retryable status instead of rejecting valid old pairing before restore',async t=>{const b=await new Broker().start({adminPort:0,phonePort:0});t.after(()=>b.close());assert.equal((await fetch('http://127.0.0.1:'+b.phonePort+'/phone/v3/challenge',{method:'POST'})).status,503);});
test('damaged state and a large clock rollback fail closed',t=>{const f=fixture(t),store=f.open();store.initialize();assert.throws(()=>new StateStore(f.file,{codec,now:()=>store.value.lastWrittenAt-300000}),/clock_moved_back/);const wrong={...codec,kind:'wrong-account'};assert.throws(()=>new StateStore(f.file,{codec:wrong}),/another_account_or_format/);});
test('Windows private state uses DPAPI and remains readable by the same account',{skip:process.platform!=='win32'},t=>{const f=fixture(t),store=new StateStore(f.file);store.initialize();const secret=Buffer.alloc(32,7).toString('base64url');store.save({...store.value,pair:{id:'a'.repeat(32),master:secret,endpoint:'https://fixed.example.test',createdAt:Date.now(),expiresAt:Date.now()+60000,pending:null}});assert.ok(!readFileSync(f.file,'utf8').includes(secret));assert.equal(new StateStore(f.file).value.pair.master,secret);});

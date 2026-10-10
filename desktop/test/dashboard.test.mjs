import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {Broker} from '../src/broker.mjs';

test('rendered dashboard script parses and refreshes despite window.status',async t=>{
  const broker=await new Broker().start({adminPort:0,phonePort:0});t.after(()=>broker.close());
  broker.createSession('https://example.com');
  const html=await(await fetch('http://127.0.0.1:'+broker.adminPort+'/')).text();
  const source=html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];assert.ok(source);
  const script=new vm.Script(source);
  const nodes=Object.fromEntries(['status','pair','copy','new','stop','qr'].map(id=>['#'+id,{}]));
  let refresh,fail=false;
  const context=vm.createContext({
    status:'native Window.status string',
    document:{querySelector:selector=>nodes[selector]},
    navigator:{clipboard:{writeText:async()=>{}}},location:{reload:()=>{}},
    setInterval:fn=>{refresh=fn;},
    fetch:async(path,options)=>{
      assert.equal(path,'/api/status');assert.equal(options.headers['X-Admin-Key'],broker.adminKey);
      return {ok:!fail,json:async()=>({active:true,connected:true,remainingSeconds:123,phone:{apps:['com.example.app']},pairId:broker.session.id})};
    }
  });
  script.runInContext(context);await nextTurn();
  assert.match(nodes['#pair'].value,/^codexandroid:\/\/pair\?/);
  assert.match(nodes['#status'].textContent,/手机已连接.*123 秒\ncom\.example\.app/);
  assert.equal(typeof refresh,'function');
  fail=true;await refresh();assert.match(nodes['#status'].textContent,/无法读取电脑状态/);
});

test('refreshing two existing pages synchronizes their QR without rotating the pair; expiry clears the old QR',async t=>{
  const broker=await new Broker().start({adminPort:0,phonePort:0});t.after(()=>broker.close());broker.createSession('https://example.com');
  const origin='http://127.0.0.1:'+broker.adminPort,html=await(await fetch(origin+'/')).text(),source=html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const tabs=[];
  for(let i=0;i<2;i++){
    const nodes=Object.fromEntries(['status','pair','copy','new','stop','qr'].map(id=>['#'+id,{}]));let refresh;
    const context=vm.createContext({document:{querySelector:s=>nodes[s]},navigator:{clipboard:{writeText:async()=>{}}},location:{reload:()=>{}},setInterval:fn=>{refresh=fn;},fetch:(path,options)=>fetch(origin+path,options)});
    new vm.Script(source).runInContext(context);tabs.push({nodes,refresh});
  }
  broker.createSession('https://example.com');const current=broker.pairing();
  for(const tab of tabs){await tab.refresh();assert.equal(tab.nodes['#pair'].value,current);assert.match(tab.nodes['#qr'].src,/^data:image\/png/);}
  assert.equal(broker.pairing(),current);
  broker.revoke();
  for(const tab of tabs){await tab.refresh();assert.equal(tab.nodes['#qr'].hidden,true);assert.equal(tab.nodes['#qr'].src,'');assert.doesNotMatch(tab.nodes['#pair'].value,/codexandroid/);}
});

for(const manual of [false,true])test('copy retrieves the current pair instead of page-open data'+(manual?' even when clipboard is unavailable':''),async t=>{
  const broker=await new Broker().start({adminPort:0,phonePort:0});t.after(()=>broker.close());
  broker.createSession('https://example.com');const stale=broker.pairing();
  const origin='http://127.0.0.1:'+broker.adminPort;
  const html=await(await fetch(origin+'/')).text();
  const source=html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];assert.ok(source);
  broker.createSession('https://example.com');const current=broker.pairing();
  assert.notEqual(stale,current);
  const nodes=Object.fromEntries(['status','pair','copy','new','stop','qr'].map(id=>['#'+id,{}]));let copied;
  const context=vm.createContext({
    document:{querySelector:selector=>nodes[selector]},
    navigator:{clipboard:{writeText:async text=>{if(manual)throw new Error('not_available');copied=text;}}},
    location:{reload:()=>{}},setInterval:()=>{},fetch:(path,options)=>fetch(origin+path,options)
  });
  new vm.Script(source).runInContext(context);
  assert.equal(nodes['#pair'].value,stale);
  await nodes['#copy'].onclick();
  assert.equal(nodes['#pair'].value,current);assert.match(nodes['#qr'].src,/^data:image\/png/);
  if(manual){assert.equal(copied,undefined);assert.match(nodes['#status'].textContent,/新配对码已更新/);}
  else{assert.equal(copied,current);assert.match(nodes['#status'].textContent,/已复制当前新配对码/);}
});

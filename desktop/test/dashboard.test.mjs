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
  const nodes=Object.fromEntries(['status','pair','copy','new','stop'].map(id=>['#'+id,{}]));
  let refresh,fail=false;
  const context=vm.createContext({
    status:'native Window.status string',
    document:{querySelector:selector=>nodes[selector]},
    navigator:{clipboard:{writeText:async()=>{}}},location:{reload:()=>{}},
    setInterval:fn=>{refresh=fn;},
    fetch:async(path,options)=>{
      assert.equal(path,'/api/status');assert.equal(options.headers['X-Admin-Key'],broker.adminKey);
      return {ok:!fail,json:async()=>({active:true,connected:true,remainingSeconds:123,phone:{apps:['com.example.app']}})};
    }
  });
  script.runInContext(context);await nextTurn();
  assert.match(nodes['#pair'].value,/^codexandroid:\/\/pair\?/);
  assert.match(nodes['#status'].textContent,/手机已连接.*123 秒\ncom\.example\.app/);
  assert.equal(typeof refresh,'function');
  fail=true;await refresh();assert.match(nodes['#status'].textContent,/无法读取电脑状态/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Operator,validateAction,ACTION_TOOLS} from '../src/actions.mjs';
import {validateTool} from '../src/tools.mjs';
import {toolContent} from '../src/mcp-content.mjs';
import {Broker} from '../src/broker.mjs';
import {newPhone} from './phone.mjs';
import {seal,unseal} from '../src/protocol.mjs';

const pkg='com.example.app',id='00000000-0000-4000-8000-000000000001';
const node=(text='',extra={})=>({node:id,text,description:'',class:'android.view.View',bounds:[0,0,1080,2400],...extra});
const screen=(nodes=[node()])=>({package:pkg,nodes,truncated:false});
const picture={mimeType:'image/jpeg',width:540,height:1200,data:Buffer.from([255,216,255,217]).toString('base64'),package:pkg};
const readable=()=>screen([node('Alpha'),node('Beta'),node('Gamma')]);
function fixture({initial=screen(),allowed=true,handler=()=>({performed:true})}={}){
  let current=initial;const calls=[],status={phone:{screenshotAllowed:allowed}};
  const broker={status:()=>status,command:async(name,args)=>{calls.push({name,args});if(name==='phone_read_screen')return current;if(name==='phone_screenshot')return picture;return handler(name,args);}};
  let elapsed=0;const op=new Operator(broker,{sleep:async ms=>{elapsed+=ms;}});
  return {op,calls,status,setScreen:value=>current=value,elapsed:()=>elapsed};
}
const shots=calls=>calls.filter(c=>c.name==='phone_screenshot');

test('new arguments are validated at both compound and phone transport boundaries',()=>{
  for(const validate of [validateAction,validateTool]){
    for(const args of [{},{node:1},{node:'n0',x:1}])assert.throws(()=>validate('phone_long_press',args));
    for(const submit of ['true',1,null])assert.throws(()=>validate('phone_type',{node:id,text:'search',submit}));
    for(const args of [{x:1},{x:-1,y:0},{x:0.5,y:1},{x:'1',y:1},{x:1,y:NaN},{x:Infinity,y:1},{x:10001,y:0},{x:1,y:1,scale:2}])assert.throws(()=>validate('phone_tap_point',args));
    assert.throws(()=>validate('phone_screenshot',{allow:true}));
    assert.doesNotThrow(()=>validate('phone_long_press',{node:id}));
    assert.doesNotThrow(()=>validate('phone_type',{node:id,text:'计算器',submit:true}));
    assert.doesNotThrow(()=>validate('phone_type',{node:id,text:'',submit:false}));
    assert.doesNotThrow(()=>validate('phone_tap_point',{x:0,y:1200}));
    assert.doesNotThrow(()=>validate('phone_screenshot',{}));
  }
  assert.equal(ACTION_TOOLS.find(t=>t.name==='phone_type').inputSchema.properties.submit.default,false);
});

test('long press maps the node once, settles and reads; unknown completion is never retried',async()=>{
  const f=fixture({initial:readable()});await f.op.run('phone_read_screen',{});
  const result=await f.op.run('phone_long_press',{node:'n1'});
  assert.equal(result.performed,true);assert.equal(result.screen.package,pkg);assert.equal(f.elapsed(),700);
  assert.deepEqual(f.calls.map(c=>c.name),['phone_read_screen','phone_long_press','phone_read_screen']);
  assert.deepEqual(f.calls[1].args,{node:id});
  const failure=fixture({initial:readable(),handler:()=>{throw new Error('gesture_completion_unknown_do_not_retry');}});
  await failure.op.run('phone_read_screen',{});
  await assert.rejects(failure.op.run('phone_long_press',{node:'n0'}),/unknown_do_not_retry/);
  assert.equal(failure.calls.length,2);
  await assert.rejects(failure.op.run('phone_long_press',{node:'n0'}),/stale_node/);
});

test('typing defaults to no submit and forwards explicit submit on the same node with receipt',async()=>{
  for(const submit of [undefined,false,true]){
    const f=fixture({initial:readable(),handler:(name,args)=>({performed:true,submitted:args.submit})});
    await f.op.run('phone_read_screen',{});
    const result=await f.op.run('phone_type',{node:'n0',text:'计算器',...(submit===undefined?{}:{submit})});
    assert.equal(result.submitted,submit===true);
    assert.deepEqual(f.calls[1],{name:'phone_type',args:{node:id,text:'计算器',submit:submit??false}});
    assert.equal(f.calls.length,3);assert.equal(result.screen.package,pkg);
  }
  const f=fixture({initial:readable(),handler:()=>({performed:true,submitted:false,submit_error:'foreground_changed'})});
  await f.op.run('phone_read_screen',{});
  const r=await f.op.run('phone_type',{node:'n0',text:'x',submit:true});
  assert.equal(r.performed,true);assert.equal(r.submitted,false);assert.equal(r.submit_error,'foreground_changed');
});

test('missing text auto-attaches screenshot under the default enabled phone grant',async()=>{
  const f=fixture({initial:readable()});const result=await f.op.run('phone_tap_text',{text:'Missing'});
  assert.equal(result.found,false);assert.deepEqual(result.screenshot,picture);
  assert.equal(result.hint,'没找到这段文字；如果按钮是图片，请看截图，用 phone_tap_point 点它的位置。');
  assert.deepEqual(f.calls.map(c=>c.name),['phone_read_screen','phone_screenshot']);
});

test('unreadable screens attach once; changing text or package renews the signature, node IDs do not',async()=>{
  const f=fixture();const first=await f.op.run('phone_read_screen',{});
  assert.equal(first.hint,'screen_mostly_unreadable_screenshot_attached');assert.deepEqual(first.screenshot,picture);
  f.setScreen(screen([node('',{node:'different-read-id'})]));
  const same=await f.op.run('phone_read_screen',{});assert.equal(same.screenshot,undefined);assert.equal(shots(f.calls).length,1);
  f.setScreen(screen([node('Changed')]));await f.op.run('phone_read_screen',{});assert.equal(shots(f.calls).length,2);
  f.setScreen({...screen([node('Changed')]),package:'com.example.other'});await f.op.run('phone_read_screen',{});assert.equal(shots(f.calls).length,3);
});

test('large SurfaceView TextureView and WebView with unreadable content trigger fallback',async()=>{
  for(const type of ['SurfaceView','TextureView','WebView']){
    const f=fixture({initial:screen([node(),node('Toolbar',{bounds:[0,0,1080,80]}),node('Tab 1',{bounds:[0,80,300,150]}),node('Tab 2',{bounds:[300,80,600,150]}),node('',{class:'android.view.'+type,bounds:[0,200,1080,2400]})])});
    assert.deepEqual((await f.op.run('phone_read_screen',{})).screenshot,picture,type);
  }
  const f=fixture({initial:readable()});await f.op.run('phone_read_screen',{filter:'Absent'});assert.equal(shots(f.calls).length,0,'a text filter must not make a readable screen look unreadable');
  f.setScreen(screen([node('',{class:'android.webkit.WebView'}),node('one'),node('two'),node('three')]));await f.op.run('phone_read_screen',{});assert.equal(shots(f.calls).length,0,'readable WebView needs no image');
});

test('cancelled screenshot permission yields hints only, with no automatic image call or error',async()=>{
  const f=fixture({allowed:false});const r=await f.op.run('phone_read_screen',{});
  assert.equal(r.screenshot,undefined);assert.equal(r.screenshot_hint,'screenshot_not_allowed_on_phone');assert.ok(r.hint);
  const miss=await f.op.run('phone_tap_text',{text:'missing'});assert.equal(miss.found,false);assert.ok(miss.hint);assert.equal(miss.screenshot,undefined);
  assert.equal(shots(f.calls).length,0);
});

test('every compact action result supports fallback without recapturing the unchanged screen',async()=>{
  for(const [name,args] of [['phone_open_app',{package:pkg}],['phone_tap',{node:id}],['phone_long_press',{node:id}],['phone_type',{node:id,text:'a'}],['phone_swipe',{node:id,direction:'up'}],['phone_swipe_feed',{count:1,min_ms:0,max_ms:0}],['phone_back',{}],['phone_tap_point',{x:100,y:100}]]){
    const f=fixture();const r=await f.op.run(name,args);assert.ok(r.screenshot,name);assert.equal(r.hint,'screen_mostly_unreadable_screenshot_attached');
    assert.equal((await f.op.run('phone_read_screen',{})).screenshot,undefined,name);
  }
});

test('explicit screenshot and point calls preserve their paths and never retry failures',async()=>{
  const f=fixture({initial:readable()});assert.deepEqual(await f.op.run('phone_screenshot',{}),{screenshot:picture});
  const r=await f.op.run('phone_tap_point',{x:12,y:34});assert.equal(r.performed,true);
  assert.deepEqual(f.calls.map(c=>c.name),['phone_screenshot','phone_tap_point','phone_read_screen']);assert.deepEqual(f.calls[1].args,{x:12,y:34});
  const failure=fixture({handler:()=>{throw new Error('touch_path_obscured_read_again');}});
  await assert.rejects(failure.op.run('phone_tap_point',{x:1,y:2}),/touch_path_obscured/);assert.equal(failure.calls.length,1);
});

test('auto screenshot rejection keeps the completed action receipt and does not retry it',async()=>{
  const calls=[];const op=new Operator({status:()=>({phone:{screenshotAllowed:true}}),command:async(name)=>{calls.push(name);if(name==='phone_read_screen')return screen();if(name==='phone_screenshot')throw new Error('phone_locked_unlock_locally');return {performed:true};}},{sleep:async()=>{}});
  const result=await op.run('phone_long_press',{node:id});assert.equal(result.performed,true);assert.equal(result.screenshot,undefined);assert.equal(result.screenshot_error,'phone_locked_unlock_locally');
  assert.deepEqual(calls,['phone_long_press','phone_read_screen','phone_screenshot']);
});

test('MCP returns images and dimensions for explicit and automatic screenshots, without base64 in text',()=>{
  for(const result of [{screenshot:picture},{found:false,hint:'missing',screen:readable(),screenshot:picture}]){
    const rendered=toolContent(result);assert.deepEqual(rendered.content[0],{type:'image',data:picture.data,mimeType:'image/jpeg'});
    const text=JSON.parse(rendered.content[1].text);assert.equal(text.screenshot.width,540);assert.equal(text.screenshot.height,1200);assert.equal(text.screenshot.data,undefined);
  }
  assert.equal(toolContent({performed:true}).content[0].type,'text');
  assert.throws(()=>toolContent({screenshot:{...picture,mimeType:'text/html'}}),/invalid_screenshot/);
  assert.throws(()=>toolContent({screenshot:{...picture,width:0}}),/invalid_screenshot/);
  assert.throws(()=>toolContent({screenshot:{...picture,data:'not-base64'}}),/invalid_screenshot/);
});

test('broker gates explicit screenshot and coordinate commands on phone consent; encrypted image fits protocol',async t=>{
  const broker=await new Broker({pollMs:5}).start({adminPort:0,phonePort:0});t.after(()=>broker.close());
  const pair=JSON.parse(Buffer.from(new URL(broker.createSession('https://example.test')).searchParams.get('data'),'base64url'));
  const phone=newPhone(broker,pair,[pkg]);await phone.connect();
  assert.equal(broker.status().phone.screenshotAllowed,false,'old phones fail closed');
  for(const [tool,args] of [['phone_screenshot',{}],['phone_tap_point',{x:1,y:2}]])await assert.rejects(broker.command(tool,args),/screenshot_not_allowed_on_phone/);
  assert.equal(broker.status().pending,false);
  await phone.poll({event:'poll',phone:{apps:[pkg],remainingSeconds:600,screenshotAllowed:true}});
  assert.equal(broker.status().phone.screenshotAllowed,true);
  const pending=broker.command('phone_screenshot',{}),delivered=await phone.poll();assert.equal(delivered.data.command.tool,'phone_screenshot');
  const large={...picture,data:Buffer.alloc(150000,123).toString('base64')};
  const payload={event:'result',phone:{apps:[pkg],remainingSeconds:600,screenshotAllowed:true},response:{id:delivered.data.command.id,ok:true,data:large}};
  const frame=seal(phone.c.key,phone.c.id,'phone',100,payload);
  assert.ok(Buffer.from(frame.data,'base64').length<260000);assert.ok(Buffer.byteLength(JSON.stringify(frame))<360000);
  assert.deepEqual(unseal(phone.c.key,phone.c.id,'phone',0,frame),payload);
  assert.equal((await phone.poll(payload)).status,200);assert.deepEqual(await pending,large);
  await phone.poll({event:'poll',phone:{apps:[pkg],remainingSeconds:600,screenshotAllowed:false}});
  await assert.rejects(broker.command('phone_tap_point',{x:1,y:2}),/screenshot_not_allowed_on_phone/);
});

test('a dispatched screenshot read timeout preserves the session without retrying or blocking writes',async t=>{
  const broker=await new Broker({pollMs:5,commandMs:60}).start({adminPort:0,phonePort:0});t.after(()=>broker.close());
  const pair=JSON.parse(Buffer.from(new URL(broker.createSession('https://example.test')).searchParams.get('data'),'base64url'));
  const phone=newPhone(broker,pair,[pkg]);await phone.connect();
  await phone.poll({event:'poll',phone:{apps:[pkg],remainingSeconds:600,screenshotAllowed:true}});
  const pending=broker.command('phone_screenshot',{}),rejected=assert.rejects(pending,/screen_read_timeout_connection_preserved/);
  assert.equal((await phone.poll()).data.command.tool,'phone_screenshot');await rejected;
  assert.equal(broker.status().recoveryRequired,false);assert.equal(broker.status().active,true);assert.equal((await phone.poll()).data.command,null);
});

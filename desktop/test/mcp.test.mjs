import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createInterface} from 'node:readline';
import {Broker} from '../src/broker.mjs';

test('MCP initialize, tool enumeration, status and rejected offline action',async t=>{
  const broker=await new Broker().start({adminPort:0,phonePort:0});
  const dir=mkdtempSync(join(tmpdir(),'cac-mcp-test-')),state=join(dir,'state.json');
  writeFileSync(state,JSON.stringify({port:broker.adminPort,key:broker.adminKey}),{mode:0o600});
  const child=spawn(process.execPath,[resolve('src/mcp.mjs'),'--state',state],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const waiters=new Map();let nextId=0,stderr='';
  child.stderr.on('data',c=>stderr+=c);
  createInterface({input:child.stdout}).on('line',line=>{const msg=JSON.parse(line);waiters.get(msg.id)?.(msg);waiters.delete(msg.id);});
  t.after(async()=>{child.kill();await broker.close();if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith('cac-mcp-test-'))throw new Error('Unsafe cleanup target');rmSync(dir,{recursive:true,force:true});});
  function rpc(method,params={}) {const id=++nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('MCP timeout')),5000);waiters.set(id,r=>{clearTimeout(timer);resolve(r);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
  const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(initialized.result.protocolVersion,'2025-06-18');
  const list=await rpc('tools/list');assert.equal(list.result.tools.length,8);assert.equal(list.result.tools.some(t=>t.name.includes('grant')),false);
  const status=await rpc('tools/call',{name:'phone_status',arguments:{}});assert.equal(JSON.parse(status.result.content[0].text).active,false);
  const action=await rpc('tools/call',{name:'phone_home',arguments:{}});assert.equal(action.result.isError,true);assert.equal(action.result.content[0].text,'phone_not_connected');
  assert.equal(stderr,'');
});

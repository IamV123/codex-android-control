import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {allocation,fixedAllocation,forwardFirstRequest} from '../src/localtunnel.mjs';

test('relay allocation rejects HTTP, credentials, paths, query strings and other hosts',()=>{
  for(const url of ['http://x.loca.lt','https://u:p@x.loca.lt','https://x.loca.lt:8443','https://x.loca.lt/path','https://x.loca.lt/?x=1','https://x.loca.lt/#x','https://loca.lt.evil.test','https://127.0.0.1','https://x.localhost'])assert.throws(()=>allocation({url,port:40000}));
});

test('idle relay does not open an HTTP socket; fragmented first request is forwarded intact', {timeout:5000}, async t=>{
  let connections=0,body='';
  const backend=http.createServer(async(req,res)=>{for await(const chunk of req)body+=chunk;res.end('received:'+body);});
  backend.on('connection',()=>connections++);
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const relay=net.createServer(socket=>{socket.on('error',()=>{});forwardFirstRequest(socket,backend.address().port);});
  relay.listen(0,'127.0.0.1');await once(relay,'listening');
  let client;
  t.after(async()=>{client?.destroy();backend.closeAllConnections();await Promise.all([new Promise(r=>backend.close(r)),new Promise(r=>relay.close(r))]);});
  client=net.connect(relay.address().port,'127.0.0.1');await once(client,'connect');
  await delay(150);assert.equal(connections,0,'no backend socket may age while waiting for the first request');
  let response='';client.on('data',chunk=>response+=chunk);
  const done=once(client,'close');
  client.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhe');
  await delay(20);client.write('llo');await done;
  assert.equal(connections,1);assert.equal(body,'hello');assert.match(response,/200 OK/);assert.match(response,/received:hello/);
});

test('closing an unused relay never creates a backend connection', {timeout:3000}, async t=>{
  let connections=0;
  const backend=net.createServer(socket=>{connections++;socket.destroy();});backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const relay=net.createServer(socket=>{socket.on('error',()=>{});forwardFirstRequest(socket,backend.address().port);});relay.listen(0,'127.0.0.1');await once(relay,'listening');
  t.after(async()=>{await Promise.all([new Promise(r=>backend.close(r)),new Promise(r=>relay.close(r))]);});
  const client=net.connect(relay.address().port,'127.0.0.1');await once(client,'connect');client.destroy();await delay(50);
  assert.equal(connections,0);
});
test('relay allocation enforces port bounds and ignores returned connection targets',()=>{
  for(const port of [null,'40000',0,80,1023,65536,NaN,40000.5])assert.throws(()=>allocation({url:'https://test.loca.lt',port}));
  assert.deepEqual(allocation({url:'https://test.loca.lt',port:40000,ip:'127.0.0.1',host:'localhost'}),{url:'https://test.loca.lt',port:40000});
  assert.deepEqual(allocation({url:'https://test.localtunnel.me',port:65535}),{url:'https://test.localtunnel.me',port:65535});
});
test('fixed recovery refuses a silently changed hostname and keeps only validated relay metadata',()=>{
  const name='cac-'+'a'.repeat(32),url='https://'+name+'.loca.lt';
  assert.deepEqual(fixedAllocation({url,port:40000,ip:'127.0.0.1'},name),{url,port:40000});
  assert.throws(()=>fixedAllocation({url:'https://random.loca.lt',port:40000},name),/will_not_change_phone_address/);
});

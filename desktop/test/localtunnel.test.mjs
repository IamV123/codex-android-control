import test from 'node:test';
import assert from 'node:assert/strict';
import {allocation} from '../src/localtunnel.mjs';

test('relay allocation rejects HTTP, credentials, paths, query strings and other hosts',()=>{
  for(const url of ['http://x.loca.lt','https://u:p@x.loca.lt','https://x.loca.lt:8443','https://x.loca.lt/path','https://x.loca.lt/?x=1','https://x.loca.lt/#x','https://loca.lt.evil.test','https://127.0.0.1','https://x.localhost'])assert.throws(()=>allocation({url,port:40000}));
});
test('relay allocation enforces port bounds and ignores returned connection targets',()=>{
  for(const port of [null,'40000',0,80,1023,65536,NaN,40000.5])assert.throws(()=>allocation({url:'https://test.loca.lt',port}));
  assert.deepEqual(allocation({url:'https://test.loca.lt',port:40000,ip:'127.0.0.1',host:'localhost'}),{url:'https://test.loca.lt',port:40000});
  assert.deepEqual(allocation({url:'https://test.localtunnel.me',port:65535}),{url:'https://test.localtunnel.me',port:65535});
});

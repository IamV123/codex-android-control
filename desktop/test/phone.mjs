import {randomBytes} from 'node:crypto';
import {credentials,seal,unseal} from '../src/protocol.mjs';

export function newPhone(broker,pair,apps=[],client=randomBytes(16).toString('hex')) {
  const master=Buffer.from(pair.key,'base64url'),bootstrap=credentials(master,pair.session);
  const c={...credentials(master,pair.session+':'+client),id:pair.session+':'+client};
  let seq=0,rx=0;
  const frame=seal(bootstrap.key,pair.session,'phone-connect',1,{event:'connect',protocol:2,client,phone:{apps,version:'0.1.6',remainingSeconds:600}});
  async function send(path,token,frame){const r=await fetch(`http://127.0.0.1:${broker.phonePort}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(frame)});return {status:r.status,data:await r.json()};}
  async function connect(){const r=await send('/phone/v2/connect',bootstrap.token,frame);if(r.status===200){const data=unseal(c.key,c.id,'desktop',0,r.data);rx=r.data.seq;return {...r,data};}return r;}
  async function poll(data={event:'poll',phone:{apps,version:'0.1.6',remainingSeconds:600}},override){const r=await send('/phone/v2/exchange',c.token,override||seal(c.key,c.id,'phone',++seq,data));if(r.status===200){const data=unseal(c.key,c.id,'desktop',rx,r.data);rx=r.data.seq;return {...r,data,frame:r.data};}return r;}
  return {c,connect,poll,frame,bootstrap};
}

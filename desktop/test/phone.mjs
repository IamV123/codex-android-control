import {randomBytes} from 'node:crypto';
import {credentials,seal,unseal} from '../src/protocol.mjs';

export function newPhone(broker,pair,apps=[],client=randomBytes(16).toString('hex'),{origin='http://127.0.0.1:'+broker.phonePort,transport=null}={}) {
  const master=Buffer.from(pair.key,'base64url'),bootstrap=credentials(master,pair.session);
  const c={...credentials(master,pair.session+':'+client),id:pair.session+':'+client};
  let seq=0,rx=0;
  let frame;
  async function send(path,token,frame){if(transport)return transport(path,token,frame);const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'CodexAndroidControl/0.1.7',Accept:'application/json',Authorization:'Bearer '+token},body:JSON.stringify(frame),redirect:'error',signal:AbortSignal.timeout(25000)});return {status:r.status,data:await r.json()};}
  async function connect(receipt){
    if(!frame){const challenge=await send('/phone/v3/challenge',bootstrap.token,seal(bootstrap.key,pair.session,'phone-challenge',1,{event:'challenge',protocol:3,client}));if(challenge.status!==200)return challenge;const data=unseal(c.key,c.id,'desktop-challenge',0,challenge.data);frame=seal(bootstrap.key,pair.session,'phone-connect',1,{event:'connect',protocol:3,client,challenge:data.challenge,phone:{apps,version:'0.1.7',remainingSeconds:600},...(receipt?{receipt}:{})});}
    const r=await send('/phone/v3/connect',bootstrap.token,frame);if(r.status===200){const data=unseal(c.key,c.id,'desktop',0,r.data);rx=r.data.seq;return {...r,data};}return r;
  }
  async function poll(data={event:'poll',phone:{apps,version:'0.1.7',remainingSeconds:600}},override){const r=await send('/phone/v3/exchange',c.token,override||seal(c.key,c.id,'phone',++seq,data));if(r.status===200){const data=unseal(c.key,c.id,'desktop',rx,r.data);rx=r.data.seq;return {...r,data,frame:r.data};}return r;}
  return {c,connect,poll,get frame(){return frame;},bootstrap};
}

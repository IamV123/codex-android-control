import net from 'node:net';

// Only the authenticated, encrypted phone channel is forwarded. LocalTunnel's
// desktop hop is TCP, not TLS; it never receives the local dashboard/admin port.
export function allocation(info){
  const url=new URL(info?.url);
  if(url.protocol!=='https:'||!/^[a-z0-9-]+\.(loca\.lt|localtunnel\.me)$/.test(url.hostname)||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('unexpected_tunnel_origin');
  if(!Number.isInteger(info.port)||info.port<1024||info.port>65535)throw new Error('invalid_tunnel_port');
  // Service-supplied IP/host values cannot select arbitrary LAN destinations.
  return {url:url.origin,port:info.port};
}
export function forwardFirstRequest(remote,phonePort){
  let local;
  remote.once('data',first=>{remote.pause();if(remote.destroyed)return;local=net.connect({host:'127.0.0.1',port:phonePort});local.on('error',()=>remote.destroy());local.once('close',()=>remote.destroy());local.once('connect',()=>{if(remote.destroyed){local.destroy();return;}local.write(first);remote.pipe(local).pipe(remote);remote.resume();});});
  remote.once('close',()=>local?.destroy());
}
export function fixedAllocation(info,subdomain){
  const safe=allocation(info);if(subdomain&&new URL(safe.url).hostname.split('.')[0]!==subdomain)throw new Error('fixed_tunnel_name_unavailable_will_not_change_phone_address');return safe;
}
async function pool(info,phonePort,onFailure){
  const sockets=new Set(),timers=new Set();let closed=false,open=0,lastConnected=Date.now(),readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  const schedule=fn=>{const t=setTimeout(()=>{timers.delete(t);if(!closed)fn();},1000);timers.add(t);};
  function connect(){
    if(closed)return;const remote=net.connect({host:'localtunnel.me',port:info.port});sockets.add(remote);let counted=false;
    remote.setTimeout(7000,()=>remote.destroy());remote.on('error',()=>remote.destroy());
    remote.once('connect',()=>{if(closed){remote.destroy();return;}remote.setTimeout(0);remote.setKeepAlive(true,10000);counted=true;open++;lastConnected=Date.now();forwardFirstRequest(remote,phonePort);readyResolve();});
    remote.once('close',()=>{sockets.delete(remote);if(counted){open--;lastConnected=Date.now();}if(!closed)schedule(connect);});
  }
  function close(){closed=true;clearInterval(monitor);for(const t of timers)clearTimeout(t);timers.clear();for(const s of sockets)s.destroy();sockets.clear();}
  const monitor=setInterval(()=>{if(!closed&&open===0&&Date.now()-lastConnected>12000){close();onFailure(new Error('backup_tunnel_disconnected'));}},1000);
  connect();connect();let timeout;
  try{await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('backup_tunnel_connect_timeout')),12000);})]);}
  catch(e){close();throw e;}finally{clearTimeout(timeout);}
  return {url:info.url,allocation:info,close,get closed(){return closed;}};
}
export async function startLocalTunnel(phonePort,{onFailure=()=>{},subdomain=null,cached=null,onAllocation=()=>{},verify=null}={}){
  if(!Number.isInteger(phonePort)||phonePort<1||phonePort>65535)throw new Error('invalid_phone_port');
  if(subdomain!==null&&!/^cac-[a-f0-9]{32}$/.test(subdomain))throw new Error('invalid_fixed_tunnel_name');
  // A relay may keep the old allocation after the client disappears. Reattach
  // its TCP port first, but accept it only after verifying our actual HTTP route.
  if(cached){
    if(!subdomain||!verify)throw new Error('cached_tunnel_requires_route_verification');
    const info=fixedAllocation(cached,subdomain);let candidate,adopted=false;await onAllocation(info);
    try{candidate=await pool(info,phonePort,error=>{if(adopted)onFailure(error);});if(await verify(info.url)&&!candidate.closed){adopted=true;return {...candidate,reusedAllocation:true};}}
    catch{}candidate?.close();
  }
  const response=await fetch('https://localtunnel.me/'+(subdomain||'?new'),{headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('backup_tunnel_allocation_failed');
  let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>8192)throw new Error('invalid_tunnel_allocation');}
  const info=fixedAllocation(JSON.parse(text),subdomain);await onAllocation(info);const created=await pool(info,phonePort,onFailure);
  if(verify&&!(await verify(info.url))){created.close();throw new Error('public_route_verification_failed');}
  return {...created,reusedAllocation:false};
}

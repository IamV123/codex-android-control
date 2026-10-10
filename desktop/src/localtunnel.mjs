import net from 'node:net';

// LocalTunnel's desktop hop uses TCP, not TLS. Forward only authenticated,
// encrypted phone frames, never the dashboard/admin port. No third-party client
// code is loaded. See SECURITY.md for the additional transport limitation.
export function allocation(info) {
  const url=new URL(info?.url);
  if(url.protocol!=='https:' || !/^[a-z0-9-]+\.(loca\.lt|localtunnel\.me)$/.test(url.hostname) || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash)throw new Error('unexpected_tunnel_origin');
  if(!Number.isInteger(info.port) || info.port<1024 || info.port>65535)throw new Error('invalid_tunnel_port');
  // Ignore service-supplied IP/host fields; never select arbitrary LAN targets.
  return {url:url.origin,port:info.port};
}

// A pre-opened HTTP socket can expire before the relay sends its first request,
// leaving a stale 408 response in the stream. Open the local socket on data.
export function forwardFirstRequest(remote,phonePort){
  let local;
  remote.once('data',first=>{
    remote.pause();if(remote.destroyed)return;
    local=net.connect({host:'127.0.0.1',port:phonePort});
    local.on('error',()=>remote.destroy());local.once('close',()=>remote.destroy());
    local.once('connect',()=>{if(remote.destroyed){local.destroy();return;}local.write(first);remote.pipe(local).pipe(remote);remote.resume();});
  });
  remote.once('close',()=>local?.destroy());
}

export async function startLocalTunnel(phonePort,{onFailure=()=>{}}={}) {
  if(!Number.isInteger(phonePort)||phonePort<1||phonePort>65535)throw new Error('invalid_phone_port');
  const response=await fetch('https://localtunnel.me/?new',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('backup_tunnel_allocation_failed');
  let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>8192)throw new Error('invalid_tunnel_allocation');}
  const info=allocation(JSON.parse(text)),sockets=new Set(),timers=new Set();
  let closed=false,open=0,lastConnected=Date.now(),readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  const schedule=fn=>{const t=setTimeout(()=>{timers.delete(t);if(!closed)fn();},1000);timers.add(t);};
  function connect() {
    if(closed)return;
    const remote=net.connect({host:'localtunnel.me',port:info.port});sockets.add(remote);
    let counted=false;
    remote.setTimeout(7000,()=>remote.destroy());remote.on('error',()=>remote.destroy());
    remote.once('connect',()=>{
      if(closed){remote.destroy();return;}
      remote.setTimeout(0);remote.setKeepAlive(true,10000);counted=true;open++;lastConnected=Date.now();
      forwardFirstRequest(remote,phonePort);readyResolve();
    });
    remote.once('close',()=>{sockets.delete(remote);if(counted){open--;lastConnected=Date.now();}if(!closed)schedule(connect);});
  }
  function close(){closed=true;clearInterval(monitor);for(const t of timers)clearTimeout(t);timers.clear();for(const s of sockets)s.destroy();sockets.clear();}
  const monitor=setInterval(()=>{if(!closed&&open===0&&Date.now()-lastConnected>12000){close();onFailure(new Error('backup_tunnel_disconnected'));}},1000);
  connect();connect();
  let timeout;
  try{await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('backup_tunnel_connect_timeout')),12000);})]);}
  catch(e){close();throw e;}
  finally{clearTimeout(timeout);}
  return {url:info.url,close};
}

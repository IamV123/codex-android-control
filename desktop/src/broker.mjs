import {dashboardScript} from './dashboard.mjs';
import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {credentials, seal, unseal} from './protocol.mjs';
import {validateTool} from './tools.mjs';

const MAX_BODY = 360000;
const equal = (a,b) => { const x=Buffer.from(a||''), y=Buffer.from(b||''); return x.length===y.length && timingSafeEqual(x,y); };
const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); };
async function body(req) {
  if (Number(req.headers['content-length'] || 0)>MAX_BODY) throw new Error('body_too_large');
  let size=0; const chunks=[];
  for await(const chunk of req) { size+=chunk.length; if(size>MAX_BODY) throw new Error('body_too_large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function server(handler) {
  const s=http.createServer({maxHeaderSize:8192,requestTimeout:30000,headersTimeout:10000},(req,res)=>Promise.resolve(handler(req,res)).catch(()=> { if(!res.headersSent) json(res,400,{error:'invalid_request'}); else res.end(); }));
  s.maxConnections=24; s.maxHeadersCount=32; return s;
}
const listen = (s,port)=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',()=>resolve(s.address().port));});

export class Broker {
  constructor({sessionMs=30*60*1000,commandMs=80000,pollMs=5000}={}) {
    this.sessionMs=sessionMs; this.commandMs=commandMs; this.pollMs=pollMs;
    this.adminKey=randomBytes(32).toString('base64url'); this.session=null; this.endpoint='';this.lastPhoneError=null;
    this.phoneServer=server(this.phone.bind(this)); this.adminServer=server(this.admin.bind(this));
  }
  async start({adminPort=18765,phonePort=18766}={}) {
    this.adminPort=await listen(this.adminServer,adminPort);
    try {this.phonePort=await listen(this.phoneServer,phonePort);} catch(e) {this.adminServer.close(); throw e;}
    this.timer=setInterval(()=>{if(this.session && performance.now()>=this.session.expires) this.revoke('session_expired');},500);this.timer.unref();
    return this;
  }
  createSession(endpoint) {
    const u=new URL(endpoint);
    if(u.protocol!=='https:' || u.username || u.password || u.port || u.pathname!=='/' || u.search || u.hash) throw new Error('https_origin_required');
    this.revoke('session_replaced'); this.endpoint=u.origin;
    this.lastPhoneError=null;
    const master=randomBytes(32), id=randomBytes(16).toString('hex');
    this.session={id,master,...credentials(master,id),expires:performance.now()+this.sessionMs,connection:null,clients:new Set(),connectBusy:false};
    return this.pairing();
  }
  pairing() {
    const s=this.live();
    return s ? 'codexandroid://pair?data='+Buffer.from(JSON.stringify({v:2,url:this.endpoint,session:s.id,key:s.master.toString('base64url')})).toString('base64url') : null;
  }
  live() { if(this.session && performance.now()>=this.session.expires) this.revoke('session_expired'); return this.session; }
  revoke(reason='revoked_by_user') {
    const s=this.session; this.session=null;
    if(!s)return;
    s.master.fill(0);s.key.fill(0);s.token='';
    this.endConnection(s.connection,reason);
  }
  endConnection(c,reason) {
    if(!c)return;
    c.key.fill(0);c.token='';c.pending?.reject(new Error(reason));c.wake?.();c.queue=[];
  }
  status() {
    const s=this.live(),c=s?.connection;
    return {active:!!s,connected:!!c && performance.now()-c.lastSeen<35000,remainingSeconds:s?Math.max(0,Math.floor((s.expires-performance.now())/1000)):0,phone:c?.phone||null,pending:!!c?.pending,connectionIssue:this.lastPhoneError,pairId:s?.id||null,protocol:2};
  }
  async command(name,args={}) {
    validateTool(name,args);
    if(name==='phone_status')return this.status();
    const s=this.live(),c=s?.connection; if(!c || performance.now()-c.lastSeen>35000)throw new Error('phone_not_connected');
    if(c.pending)throw new Error('another_command_pending');
    return new Promise((resolve,reject)=>{
      const id=randomBytes(16).toString('hex');
      const t=setTimeout(()=>{this.revoke('command_timeout_session_revoked_check_phone_before_retry');},this.commandMs);
      c.pending={id,resolve:r=>{clearTimeout(t);c.pending=null;resolve(r);},reject:e=>{clearTimeout(t);c.pending=null;reject(e);}};
      c.queue.push({id,tool:name,args});c.wake?.();
    });
  }
  phoneStatus(phone) {
    if(!phone || !Array.isArray(phone.apps) || phone.apps.length>500 || phone.apps.some(p=>typeof p!=='string'||p.length>200))throw new Error('invalid_phone_status');
    const result={apps:phone.apps,remainingSeconds:Math.max(0,Math.min(1800,Number(phone.remainingSeconds)||0))};
    if(typeof phone.version==='string'&&/^\d+\.\d+\.\d+$/.test(phone.version)&&phone.version.length<32)result.version=phone.version;
    return result;
  }
  async connect(req,res) {
    const s=this.live();
    if(!s || !equal(req.headers.authorization,'Bearer '+s.token))return json(res,401,{error:'pair_not_authorized'});
    if(req.headers['content-type']!=='application/json'||s.connectBusy)return json(res,409,{error:'invalid_or_concurrent_connect'});
    s.connectBusy=true;
    try {
      const frame=await body(req);
      if(this.live()!==s)return json(res,401,{error:'pair_ended'});
      if(frame.seq!==1)throw new Error('invalid_connect_sequence');
      const data=unseal(s.key,s.id,'phone-connect',0,frame);
      if(data.event!=='connect'||data.protocol!==2||typeof data.client!=='string'||!/[a-f0-9]{32}/.test(data.client)||data.client.length!==32)throw new Error('invalid_connect');
      const phone=this.phoneStatus(data.phone);
      if(s.clients.has(data.client))return json(res,409,{error:'connect_already_used'});
      // Never replace a connection with a dispatched operation lacking a receipt.
      if(s.connection?.pending)return json(res,409,{error:'another_command_pending'});
      if(s.clients.size>=100)return json(res,429,{error:'new_pair_required'});
      const id=s.id+':'+data.client,c={id,...credentials(s.master,id),tx:1,rx:0,lastSeen:performance.now(),phone,pending:null,queue:[],wake:null,pollBusy:false};
      this.endConnection(s.connection,'connection_replaced');
      s.clients.add(data.client);s.connection=c;this.lastPhoneError=null;
      return json(res,200,seal(c.key,c.id,'desktop',1,{event:'connected',client:data.client}));
    }catch(e){this.lastPhoneError='invalid_connect_request';if(!res.headersSent)json(res,400,{error:'invalid_connect_request'});}
    finally{s.connectBusy=false;}
  }
  async phone(req,res) {
    if(req.method==='POST'&&req.url==='/phone/v2/connect')return this.connect(req,res);
    if(req.method==='POST'&&req.url==='/phone/v1/exchange')return json(res,401,{error:'phone_update_required'});
    if(req.method!=='POST' || req.url!=='/phone/v2/exchange') return json(res,404,{error:'not_found'});
    const s=this.live(),c=s?.connection;
    if(!c || !equal(req.headers.authorization,'Bearer '+c.token)) return json(res,401,{error:'not_authorized'});
    if(req.headers['content-type']!=='application/json' || c.pollBusy) return json(res,409,{error:'invalid_or_concurrent_poll'});
    c.pollBusy=true;
    try {
      const frame=await body(req);
      if(this.live()!==s||s.connection!==c)return json(res,401,{error:'connection_ended'});
      const data=unseal(c.key,c.id,'phone',c.rx,frame);
      if(!data || !['poll','result'].includes(data.event)) throw new Error('invalid_event');
      if(data.phone)c.phone=this.phoneStatus(data.phone);
      c.rx=frame.seq;c.lastSeen=performance.now();
      if(data.event==='result' && data.response?.id===c.pending?.id) {
        if(data.response.ok===true) c.pending.resolve(data.response.data);
        else c.pending.reject(new Error(String(data.response.error||'phone_rejected').slice(0,300)));
      }
      this.lastPhoneError=null;
      if(!c.queue.length && this.session===s && s.connection===c) await new Promise(resolve=>{
        const timer=setTimeout(()=>{c.wake=null;resolve();},this.pollMs);
        c.wake=()=>{clearTimeout(timer);c.wake=null;resolve();};
        res.once('close',()=>c.wake?.());
      });
      if(this.live()!==s||s.connection!==c) return json(res,401,{error:'connection_ended'});
      if(!res.destroyed)json(res,200,seal(c.key,c.id,'desktop',++c.tx,{command:c.queue.shift()||null}));
    } catch(e) {
      this.lastPhoneError=e.message==='replay_or_wrong_session'?'frame_replayed':'invalid_encrypted_request';
      if(!res.headersSent)json(res,400,{error:this.lastPhoneError});
    } finally {c.pollBusy=false;}
  }
  async admin(req,res) {
    const host='127.0.0.1:'+this.adminPort;
    if(req.headers.host!==host) return json(res,403,{error:'invalid_host'});
    if(req.headers.origin && req.headers.origin!=='http://'+host) return json(res,403,{error:'invalid_origin'});
    if(req.method==='GET' && req.url==='/') return this.dashboard(res);
    if(!equal(req.headers['x-admin-key'],this.adminKey))return json(res,401,{error:'not_authorized'});
    if(req.method==='GET' && req.url==='/api/status')return json(res,200,this.status());
    if(req.method==='GET' && req.url==='/api/pair')return json(res,200,await this.pairData());
    if(req.method!=='POST' || req.headers['content-type']!=='application/json') return json(res,404,{error:'not_found'});
    const data=await body(req);
    if(req.url==='/api/revoke'){this.revoke();return json(res,200,{ok:true});}
    if(req.url==='/api/new' || req.url==='/api/copy-pair'){
      const current=this.live();
      if(current?.connection?.pending)return json(res,409,{error:'another_command_pending'});
      if(req.url==='/api/new' || !current)this.createSession(this.endpoint);
      return json(res,200,{ok:true,...await this.pairData()});
    }
    if(req.url==='/api/tool') {
      try{return json(res,200,{ok:true,data:await this.command(data.name,data.args||{})});}
      catch(e){return json(res,200,{ok:false,error:e.message});}
    }
    json(res,404,{error:'not_found'});
  }
  async pairData() {
    const pairing=this.pairing();
    const QRCode=(await import('qrcode')).default;
    return {pairing,pairId:this.live()?.id||null,qr:pairing?await QRCode.toDataURL(pairing,{width:320,margin:2}):''};
  }
  async dashboard(res) {
    const {pairing,qr,pairId}=await this.pairData();
    const nonce=randomBytes(16).toString('base64');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Codex 安卓助手</title><style nonce="${nonce}">body{max-width:760px;margin:40px auto;padding:0 24px;font:17px/1.65 system-ui;background:#edf4f0;color:#123c35}main{background:white;padding:28px;border-radius:20px}h1{font-size:30px}button{padding:12px 20px;border:0;border-radius:10px;margin:6px;background:#123c35;color:white;cursor:pointer}textarea{width:100%;height:100px;font-size:13px}pre{white-space:pre-wrap;background:#edf4f0;padding:16px}img{max-width:100%}.muted{color:#54675e;font-size:14px}</style><main><h1>Codex 安卓助手</h1><p>1. 手机安装 APK，开启通知和无障碍服务。<br>2. 用手机扫码打开配对，或复制下面整段配对码到手机 App。<br>3. 在手机勾选允许操作的应用，确认后开始限时会话。</p><img id="qr" alt="仅供你自己的手机扫描的配对码" src="${qr}" ${qr?'':'hidden'}><textarea readonly id="pair"></textarea><p class="muted">配对码等同密码，只给自己的手机。不要发到聊天、公开仓库或截图分享。新版手机每次本机确认开始都会建立新的加密连接；配对码在有效期内可重复扫码。点击重新配对会撤销旧码。此测试版需要电脑在线；公网入口是临时测试通道。</p><button id="copy">复制配对码</button><button id="new">重新配对</button><button id="stop">立即撤销</button><pre id="status">正在读取状态</pre><p>已勾选应用可连续操作，无需逐次确认；未勾选应用不能读取或操作。状态中的应用包名来自手机主动授权。</p></main><script nonce="${nonce}">${dashboardScript(this.adminKey,pairing,pairId)}</script></html>`);
  }
  async close() {this.revoke('desktop_stopped');clearInterval(this.timer);this.phoneServer.closeAllConnections();this.adminServer.closeAllConnections();await Promise.all([new Promise(r=>this.phoneServer.close(r)),new Promise(r=>this.adminServer.close(r))]);}
}

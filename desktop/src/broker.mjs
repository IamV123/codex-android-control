import {dashboardScript} from './dashboard.mjs';
import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {credentials, seal, unseal} from './protocol.mjs';
import {validateTool} from './tools.mjs';
import {Operator} from './actions.mjs';
import {durationMs, MAX_DURATION_MS} from './state-store.mjs';

const MAX_BODY=360000;
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req){if(Number(req.headers['content-length']||0)>MAX_BODY)throw new Error('body_too_large');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw new Error('body_too_large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function server(handler){const s=http.createServer({maxHeaderSize:8192,requestTimeout:30000,headersTimeout:10000},(req,res)=>Promise.resolve(handler(req,res)).catch(()=>{if(!res.headersSent)json(res,400,{error:'invalid_request'});else res.end();}));s.maxConnections=24;s.maxHeadersCount=32;return s;}
const listen=(s,port)=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',()=>resolve(s.address().port));});
function origin(endpoint){const u=new URL(endpoint);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw new Error('https_origin_required');return u.origin;}

export class Broker {
  constructor({sessionMs=30*60*1000,commandMs=80000,pollMs=15000,store=null}={}){
    this.store=store;this.sessionMs=store?store.initialize().lifetimeMs:sessionMs;this.commandMs=commandMs;this.pollMs=pollMs;this.operator=new Operator(this);
    this.adminKey=randomBytes(32).toString('base64url');this.healthId=randomBytes(16).toString('hex');this.session=null;this.endpoint='';this.lastPhoneError=null;this.persistenceFault=false;this.restored=false;this.ready=false;
    this.phoneServer=server(this.phone.bind(this));this.adminServer=server(this.admin.bind(this));
  }
  async start({adminPort=18765,phonePort=18766}={}){
    this.adminPort=await listen(this.adminServer,adminPort);
    try{this.phonePort=await listen(this.phoneServer,phonePort);}catch(e){this.adminServer.close();throw e;}
    this.timer=setInterval(()=>{try{this.live();}catch{this.persistenceFault=true;}},500);this.timer.unref();return this;
  }
  makeSession(record){
    const master=Buffer.from(record.master,'base64url');
    return {id:record.id,master,...credentials(master,record.id),createdAt:record.createdAt,expiresAt:record.expiresAt,expires:performance.now()+Math.max(0,record.expiresAt-Date.now()),connection:null,clients:new Set(),challenges:new Map(),connectBusy:false,journal:record.pending||null,recovered:record.pending||null};
  }
  restore(endpoint){
    const normalized=origin(endpoint);
    if(this.session){if(this.endpoint!==normalized)throw new Error('fixed_endpoint_changed_restore_refused');return this.pairing();}
    this.endpoint=normalized;
    if(!this.store)return this.createSession(endpoint);
    const record=this.store.value.pair;
    if(record){
      if(record.endpoint!==this.endpoint)throw new Error('fixed_endpoint_changed_restore_refused');
      if(record.expiresAt>Date.now()){
        this.session=this.makeSession(record);this.restored=true;
        // A read cannot alter the phone; an unfinished write needs its receipt.
        if(this.session.recovered?.tool==='phone_read_screen'){this.session.recovered=null;this.session.journal=null;this.persist();}
        this.ready=true;return this.pairing();
      }
      this.persist();this.ready=true;return null;
    }
    if(this.store.value.initialized){this.ready=true;return null;}return this.createSession(endpoint);
  }
  persist(){
    if(!this.store)return;
    const s=this.session;
    try{this.store.save({...this.store.value,lifetimeMs:this.sessionMs,initialized:true,pair:s?{id:s.id,master:s.master.toString('base64url'),endpoint:this.endpoint,createdAt:s.createdAt,expiresAt:s.expiresAt,pending:s.journal}:null});}
    catch(e){this.persistenceFault=true;throw e;}
  }
  createSession(endpoint){
    const normalized=origin(endpoint);if(this.session?.connection?.pending)throw new Error('another_command_pending');
    if(this.session?.recovered)throw new Error('previous_operation_requires_review');
    this.revoke('session_replaced');this.endpoint=normalized;this.lastPhoneError=null;this.restored=false;
    const now=Date.now();this.session=this.makeSession({id:randomBytes(16).toString('hex'),master:randomBytes(32).toString('base64url'),createdAt:now,expiresAt:now+this.sessionMs});
    this.persist();this.ready=true;return this.pairing();
  }
  pairing(){const s=this.live();return s?'codexandroid://pair?data='+Buffer.from(JSON.stringify({v:3,url:this.endpoint,session:s.id,key:s.master.toString('base64url'),expiresAt:s.expiresAt})).toString('base64url'):null;}
  live(){if(this.session&&performance.now()>=this.session.expires)this.revoke('session_expired');return this.session;}
  revoke(reason='revoked_by_user'){
    const s=this.session;this.session=null;
    if(s){s.master.fill(0);s.key.fill(0);s.token='';this.endConnection(s.connection,reason);}
    this.persist();
  }
  endConnection(c,reason){if(!c)return;c.key.fill(0);c.token='';c.pending?.reject(new Error(reason));c.wake?.();c.queue=[];}
  status(){
    const s=this.live(),c=s?.connection;
    return {active:!!s,connected:!!c&&performance.now()-c.lastSeen<35000,remainingSeconds:s?Math.max(0,Math.floor((s.expires-performance.now())/1000)):0,phone:c?.phone||null,pending:!!c?.pending,recoveryRequired:!!s?.recovered,unconfirmedOperation:s?.recovered||null,persistenceFault:this.persistenceFault,restored:this.restored,persistent:!!this.store,pairLifetimeSeconds:this.sessionMs/1000,connectionIssue:this.lastPhoneError,pairId:s?.id||null,protocol:3};
  }
  async command(name,args={}){
    validateTool(name,args);if(name==='phone_status')return this.status();
    const s=this.live(),c=s?.connection;
    if(this.persistenceFault)throw new Error('private_state_write_failed_operation_not_dispatched');
    if(s?.recovered)throw new Error('previous_operation_requires_review_do_not_retry');
    if(!c||performance.now()-c.lastSeen>35000)throw new Error('phone_not_connected');
    if(c.phone?.locked)throw new Error('phone_locked_unlock_locally');
    if(c.phone?.remainingSeconds===0)throw new Error('phone_authorization_expired');
    if(c.pending)throw new Error('another_command_pending');
    return new Promise((resolve,reject)=>{
      const id=randomBytes(16).toString('hex');s.journal={id,tool:name,since:Date.now()};
      try{this.persist();}catch(e){s.journal=null;reject(new Error('private_state_write_failed_operation_not_dispatched'));return;}
      const timer=setTimeout(()=>this.commandTimeout(s,c,id),this.commandMs);
      c.pending={id,resolve:r=>{clearTimeout(timer);c.pending=null;resolve(r);},reject:e=>{clearTimeout(timer);c.pending=null;reject(e);}};
      c.queue.push({id,tool:name,args});c.wake?.();
    });
  }
  commandTimeout(s,c,id){
    if(this.session!==s||c.pending?.id!==id)return;
    const unsent=c.queue.some(command=>command.id===id),readOnly=s.journal?.tool==='phone_read_screen';
    // A queued request has never been handed to the transport. Remove it so a
    // delayed poll cannot execute it after the caller was told it timed out.
    // A dispatched write remains in the durable journal until its receipt or
    // local review arrives. Neither case revokes the remaining authorization.
    c.queue=c.queue.filter(command=>command.id!==id);
    s.recovered=unsent||readOnly?null:s.journal;s.journal=s.recovered;
    try{this.persist();}catch{this.persistenceFault=true;}
    const reason=unsent?'command_not_dispatched_connection_interrupted':readOnly?'screen_read_timeout_connection_preserved':'command_timeout_result_unknown_check_phone_before_retry';
    c.pending.reject(new Error(reason));c.wake?.();
  }
  phoneStatus(phone){
    if(!phone||!Array.isArray(phone.apps)||phone.apps.length>500||phone.apps.some(p=>typeof p!=='string'||p.length>200))throw new Error('invalid_phone_status');
    const result={apps:phone.apps,remainingSeconds:Math.max(0,Math.min(MAX_DURATION_MS/1000,Number(phone.remainingSeconds)||0))};
    if(typeof phone.version==='string'&&/^\d+\.\d+\.\d+$/.test(phone.version)&&phone.version.length<32)result.version=phone.version;
    if(typeof phone.locked==='boolean')result.locked=phone.locked;return result;
  }
  async challenge(req,res){
    const s=this.live();if(!s||this.persistenceFault||!equal(req.headers.authorization,'Bearer '+s.token)){
      // Classify stale-code attempts for the local dashboard without keeping
      // credentials or accepting any unauthenticated phone data or grants.
      if(s&&(!s.connection||performance.now()-s.connection.lastSeen>35000)&&req.headers['content-type']==='application/json'){
        const frame=await body(req).catch(()=>null);
        if(this.live()===s&&(!s.connection||performance.now()-s.connection.lastSeen>35000)&&typeof frame?.session==='string'&&/^[a-f0-9]{32}$/.test(frame.session))this.lastPhoneError=frame.session!==s.id?'stale_pair_code':'pair_not_authorized';
      }
      return json(res,401,{error:'pair_not_authorized'});
    }
    if(req.headers['content-type']!=='application/json')return json(res,400,{error:'invalid_challenge_request'});
    const frame=await body(req),data=unseal(s.key,s.id,'phone-challenge',0,frame);
    if(this.live()!==s||frame.seq!==1||data.event!=='challenge'||data.protocol!==3||!/^([a-f0-9]{32})$/.test(data.client))return json(res,400,{error:'invalid_challenge_request'});
    if(s.clients.has(data.client))return json(res,409,{error:'connect_already_used'});
    for(const [client,value]of s.challenges)if(value.expires<performance.now())s.challenges.delete(client);
    if(s.challenges.size>=32&&!s.challenges.has(data.client))return json(res,429,{error:'try_later'});
    const challenge=randomBytes(32).toString('base64url');s.challenges.set(data.client,{challenge,expires:performance.now()+30000});
    const id=s.id+':'+data.client,c=credentials(s.master,id);
    try{return json(res,200,seal(c.key,id,'desktop-challenge',1,{event:'challenge',client:data.client,challenge}));}finally{c.key.fill(0);}
  }
  finishReceipt(s,receipt){
    if(!receipt||!s.journal||receipt.id!==s.journal.id||typeof receipt.ok!=='boolean')return false;
    const c=s.connection,pending=c?.pending;
    const journal=s.journal,recovered=s.recovered;s.journal=null;s.recovered=null;
    try{this.persist();}catch(e){s.journal=journal;s.recovered=recovered;throw e;}
    if(pending?.id===receipt.id){if(receipt.ok)pending.resolve(receipt.data);else pending.reject(new Error(String(receipt.error||'phone_rejected').slice(0,300)));}
    return true;
  }
  async connect(req,res){
    const s=this.live();if(!s||this.persistenceFault||!equal(req.headers.authorization,'Bearer '+s.token))return json(res,401,{error:'pair_not_authorized'});
    if(req.headers['content-type']!=='application/json'||s.connectBusy)return json(res,409,{error:'invalid_or_concurrent_connect'});s.connectBusy=true;
    try{
      const frame=await body(req);if(this.live()!==s)return json(res,401,{error:'pair_ended'});if(frame.seq!==1)throw new Error('invalid_connect_sequence');
      const data=unseal(s.key,s.id,'phone-connect',0,frame);if(data.event!=='connect'||data.protocol!==3||!/^([a-f0-9]{32})$/.test(data.client))throw new Error('invalid_connect');
      const challenge=s.challenges.get(data.client);if(s.clients.has(data.client))return json(res,409,{error:'connect_already_used'});
      if(!challenge||challenge.expires<performance.now()||!equal(data.challenge,challenge.challenge))return json(res,409,{error:'fresh_challenge_required'});
      const phone=this.phoneStatus(data.phone);this.finishReceipt(s,data.receipt);
      if(s.connection?.pending)return json(res,409,{error:'another_command_pending'});
      const id=s.id+':'+data.client,c={id,...credentials(s.master,id),tx:1,rx:0,lastSeen:performance.now(),phone,pending:null,queue:[],wake:null,pollBusy:false};
      this.endConnection(s.connection,'connection_replaced');s.challenges.delete(data.client);s.clients.add(data.client);if(s.clients.size>4096)s.clients.delete(s.clients.values().next().value);s.connection=c;this.lastPhoneError=null;
      return json(res,200,seal(c.key,c.id,'desktop',1,{event:'connected',client:data.client,recoveryRequired:!!s.recovered}));
    }catch(e){this.lastPhoneError='invalid_connect_request';if(!res.headersSent)json(res,400,{error:'invalid_connect_request'});}finally{s.connectBusy=false;}
  }
  async phone(req,res){
    if(req.url.startsWith('/phone/v3/')&&!this.ready)return json(res,503,{error:'desktop_starting'});
    if(req.method==='GET'&&req.url==='/phone/v3/health')return json(res,200,{server:this.healthId});
    if(req.method==='POST'&&req.url==='/phone/v3/challenge')return this.challenge(req,res);
    if(req.method==='POST'&&req.url==='/phone/v3/connect')return this.connect(req,res);
    if(req.method==='POST'&&['/phone/v1/exchange','/phone/v2/connect','/phone/v2/exchange'].includes(req.url))return json(res,401,{error:'phone_update_required'});
    if(req.method!=='POST'||req.url!=='/phone/v3/exchange')return json(res,404,{error:'not_found'});
    const s=this.live(),c=s?.connection;if(!c||!equal(req.headers.authorization,'Bearer '+c.token))return json(res,401,{error:'not_authorized'});
    if(req.headers['content-type']!=='application/json'||c.pollBusy)return json(res,409,{error:'invalid_or_concurrent_poll'});c.pollBusy=true;
    try{
      const frame=await body(req);if(this.live()!==s||s.connection!==c)return json(res,401,{error:'connection_ended'});
      const data=unseal(c.key,c.id,'phone',c.rx,frame);if(!data||!['poll','result'].includes(data.event))throw new Error('invalid_event');
      if(data.phone)c.phone=this.phoneStatus(data.phone);c.rx=frame.seq;c.lastSeen=performance.now();
      if(data.event==='result')this.finishReceipt(s,data.response);this.lastPhoneError=null;
      if(!c.queue.length&&this.session===s&&s.connection===c)await new Promise(resolve=>{const timer=setTimeout(()=>{c.wake=null;resolve();},this.pollMs);c.wake=()=>{clearTimeout(timer);c.wake=null;resolve();};res.once('close',()=>c.wake?.());});
      if(this.live()!==s||s.connection!==c)return json(res,401,{error:'connection_ended'});
      if(!res.destroyed)json(res,200,seal(c.key,c.id,'desktop',++c.tx,{command:c.queue.shift()||null,recoveryRequired:!!s.recovered}));
    }catch(e){this.lastPhoneError=e.message==='replay_or_wrong_session'?'frame_replayed':'invalid_encrypted_request';if(!res.headersSent)json(res,400,{error:this.lastPhoneError});}finally{c.pollBusy=false;}
  }
  async admin(req,res){
    const host='127.0.0.1:'+this.adminPort;if(req.headers.host!==host)return json(res,403,{error:'invalid_host'});
    if(req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'invalid_origin'});
    if(req.method==='GET'&&req.url==='/')return this.dashboard(res);
    if(!equal(req.headers['x-admin-key'],this.adminKey))return json(res,401,{error:'not_authorized'});
    if(req.method==='GET'&&req.url==='/api/status')return json(res,200,this.status());
    if(req.method==='GET'&&req.url==='/api/pair')return json(res,200,await this.pairData());
    if(req.method!=='POST'||req.headers['content-type']!=='application/json')return json(res,404,{error:'not_found'});
    const data=await body(req);
    if(req.url==='/api/revoke'){this.revoke();return json(res,200,{ok:true});}
    if(req.url==='/api/new'||req.url==='/api/copy-pair'){
      const current=this.live();if(current?.connection?.pending)return json(res,409,{error:'another_command_pending'});if(current?.recovered)return json(res,409,{error:'previous_operation_requires_review'});
      if(req.url==='/api/new'||!current){if(data.value!==undefined||data.unit!==undefined)this.sessionMs=durationMs(data.value,data.unit);this.createSession(this.endpoint);}
      return json(res,200,{ok:true,...await this.pairData()});
    }
    if(req.url==='/api/acknowledge-operation'){
      const s=this.live();if(!s?.recovered||s.connection?.pending||data.confirm!=='checked_on_phone'||data.id!==s.recovered.id)return json(res,409,{error:'review_not_confirmed'});
      s.recovered=null;s.journal=null;this.persist();return json(res,200,{ok:true});
    }
    if(req.url==='/api/tool'){try{return json(res,200,{ok:true,data:await this.operator.run(data.name,data.args||{})});}catch(e){return json(res,200,{ok:false,error:e.message});}}
    json(res,404,{error:'not_found'});
  }
  async pairData(){const pairing=this.pairing(),QRCode=(await import('qrcode')).default;return {pairing,pairId:this.live()?.id||null,qr:pairing?await QRCode.toDataURL(pairing,{width:320,margin:2}):''};}
  async dashboard(res){
    const {pairing,qr,pairId}=await this.pairData(),nonce=randomBytes(16).toString('base64');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Codex 安卓助手</title><style nonce="${nonce}">body{max-width:760px;margin:32px auto;padding:0 20px;font:17px/1.65 system-ui;background:#edf4f0;color:#123c35}main{background:white;padding:28px;border-radius:20px}h1{font-size:28px}button{padding:12px 18px;border:0;border-radius:10px;margin:6px;background:#123c35;color:white;cursor:pointer}textarea{width:100%;height:90px;font-size:13px}input,select{padding:10px;font:inherit}input{width:90px}pre{white-space:pre-wrap;background:#edf4f0;padding:16px}img{max-width:100%}.muted{color:#54675e;font-size:14px}.danger{background:#9b3131}</style><main><h1>Codex 安卓助手</h1><p>手机安装 APK 后，复制配对码或扫码；在手机勾选应用、自选授权时长并确认开始。</p><img id="qr" alt="仅供你自己的手机扫描的配对码" src="${qr}" ${qr?'':'hidden'}><textarea readonly id="pair"></textarea><p class="muted">默认使用 Cloudflare 临时通道：电脑或电脑端程序重启后地址会变，需要在手机上用新配对码重新连接。临时关机不会撤销授权；要结束请点“立即撤销”。配对码等同密码，不要分享。</p><button id="copy">复制配对码</button><p>新配对有效期：<input id="duration-value" type="number" min="1" value="7"><select id="duration-unit"><option value="days">天</option><option value="hours">小时</option><option value="minutes">分钟</option></select>（最长30天；实际操作按手机授权时长）</p><button id="new">重新配对并使用此时长</button><button id="stop" class="danger">立即撤销</button><pre id="status">正在读取状态</pre><button id="review" class="danger" hidden>已核对手机，解除未确认操作阻塞</button><p class="muted">更改手机应用勾选、到期、停止或停用无障碍会结束授权。锁屏期间暂停操作，解锁后恢复；程序不能解锁手机。手机服务被系统结束或手机重启，需要本机重新授权。</p></main><script nonce="${nonce}">${dashboardScript(this.adminKey,pairing,pairId)}</script></html>`);
  }
  async close({revoke=false}={}){
    if(revoke)this.revoke('desktop_stopped');else{const s=this.session;this.session=null;if(s){this.endConnection(s.connection,'desktop_stopped_check_receipt_before_retry');s.master.fill(0);s.key.fill(0);}}
    clearInterval(this.timer);this.phoneServer.closeAllConnections();this.adminServer.closeAllConnections();await Promise.all([new Promise(r=>this.phoneServer.close(r)),new Promise(r=>this.adminServer.close(r))]);
  }
}

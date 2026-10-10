import {existsSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

export const MAX_DURATION_MS=30*24*60*60*1000;
export function durationMs(value,unit) {
  const multiplier={minutes:60000,hours:3600000,days:86400000}[unit];
  const number=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
  if(!multiplier||!Number.isSafeInteger(number)||number<1||number*multiplier>MAX_DURATION_MS)throw new Error('duration_must_be_between_one_minute_and_30_days');
  return number*multiplier;
}

// Credentials never appear on the command line. Windows protects the complete
// record for the current Windows account; the launcher also restricts its ACL.
function dpapi(bytes,protect) {
  const script="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$result=[Security.Cryptography.ProtectedData]::"+(protect?'Protect':'Unprotect')+"($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($result))";
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:65536});
  if(result.status!==0||!result.stdout||!/^[a-zA-Z0-9+/=]+$/.test(result.stdout))throw new Error('private_state_protection_failed');
  return Buffer.from(result.stdout,'base64');
}
export function accountCodec() {
  return process.platform==='win32'?{kind:'windows-dpapi-current-user',encode:b=>dpapi(b,true),decode:b=>dpapi(b,false)}:{kind:'private-user-file',encode:b=>b,decode:b=>b};
}

export class StateStore {
  constructor(file,{codec=accountCodec(),now=()=>Date.now()}={}) {
    this.file=resolve(file);this.codec=codec;this.now=now;this.value=null;
    if(existsSync(this.file)) {
      const raw=readFileSync(this.file);if(raw.length>65536)throw new Error('invalid_private_state');
      const envelope=JSON.parse(raw.toString('utf8'));
      if(envelope.v!==1||envelope.protection!==codec.kind||typeof envelope.data!=='string')throw new Error('private_state_belongs_to_another_account_or_format');
      const plain=codec.decode(Buffer.from(envelope.data,'base64'));
      try{this.value=this.validate(JSON.parse(plain.toString('utf8')));}finally{plain.fill(0);}
      if(now()+120000<this.value.lastWrittenAt)throw new Error('system_clock_moved_back_check_time_before_reconnecting');
    }
  }
  validate(value) {
    if(!value||value.v!==1||!/^cac-[a-f0-9]{32}$/.test(value.tunnelName)||!Number.isSafeInteger(value.lifetimeMs)||value.lifetimeMs<60000||value.lifetimeMs>MAX_DURATION_MS||!Number.isSafeInteger(value.lastWrittenAt))throw new Error('invalid_private_state');
    if(value.tunnelCache){const u=new URL(value.tunnelCache.url);if(u.protocol!=='https:'||u.origin!==value.tunnelCache.url||!['loca.lt','localtunnel.me'].some(domain=>u.hostname===value.tunnelName+'.'+domain)||!Number.isInteger(value.tunnelCache.port)||value.tunnelCache.port<1024||value.tunnelCache.port>65535)throw new Error('invalid_fixed_tunnel_cache');}
    const pair=value.pair;
    if(pair) {
      if(!/^[a-f0-9]{32}$/.test(pair.id)||typeof pair.master!=='string'||Buffer.from(pair.master,'base64url').length!==32||!Number.isSafeInteger(pair.createdAt)||!Number.isSafeInteger(pair.expiresAt)||pair.expiresAt<=pair.createdAt||pair.expiresAt-pair.createdAt>MAX_DURATION_MS)throw new Error('invalid_private_pair');
      const u=new URL(pair.endpoint);if(u.protocol!=='https:'||u.origin!==pair.endpoint)throw new Error('invalid_private_endpoint');
      if(pair.pending&&(!/^[a-f0-9]{32}$/.test(pair.pending.id)||typeof pair.pending.tool!=='string'||!Number.isSafeInteger(pair.pending.since)))throw new Error('invalid_operation_journal');
    }
    return structuredClone(value);
  }
  initialize() {
    if(!this.value)this.save({v:1,tunnelName:'cac-'+randomBytes(16).toString('hex'),lifetimeMs:86400000,pair:null,initialized:false,lastWrittenAt:this.now()});
    return this.value;
  }
  save(value) {
    const next=this.validate({...value,lastWrittenAt:Math.max(this.now(),this.value?.lastWrittenAt||0)});
    const plain=Buffer.from(JSON.stringify(next)),temporary=this.file+'.'+randomBytes(6).toString('hex')+'.tmp';
    let wrapped;
    try{wrapped=Buffer.from(this.codec.encode(plain));}finally{plain.fill(0);}
    const bytes=Buffer.from(JSON.stringify({v:1,protection:this.codec.kind,data:wrapped.toString('base64')}));wrapped.fill(0);
    mkdirSync(dirname(this.file),{recursive:true,mode:0o700});let fd;
    try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,this.file);this.value=next;}
    finally{if(fd!==undefined)closeSync(fd);rmSync(temporary,{force:true});bytes.fill(0);}
    return this.value;
  }
}

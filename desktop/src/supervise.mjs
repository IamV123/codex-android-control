import net from 'node:net';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync,statSync,renameSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),runtime=resolve(process.env.CAC_RUNTIME||resolve(root,'.runtime'));
mkdirSync(runtime,{recursive:true,mode:0o700});
const lock=net.createServer(socket=>socket.destroy());
try{await new Promise((resolve,reject)=>{lock.once('error',reject);lock.listen(18764,'127.0.0.1',resolve);});}
catch(e){if(e.code==='EADDRINUSE'){console.log('Desktop supervisor is already running, or its local port is occupied. Open http://127.0.0.1:18765/ to inspect the existing desktop.');process.exit(0);}throw e;}
const pidFile=resolve(runtime,'supervisor.pid');writeFileSync(pidFile,String(process.pid),{mode:0o600});
const logFile=resolve(runtime,'desktop.log');let child,ending=false,opened=false;
function log(text){if(existsSync(logFile)&&statSync(logFile).size>524288){rmSync(logFile+'.previous',{force:true});renameSync(logFile,logFile+'.previous');}appendFileSync(logFile,text,{mode:0o600});}
async function healthy(){try{const s=JSON.parse(readFileSync(resolve(runtime,'broker.json'),'utf8'));const r=await fetch('http://127.0.0.1:'+s.port+'/api/status',{headers:{'X-Admin-Key':s.key},signal:AbortSignal.timeout(2000)});return r.ok;}catch{return false;}}
async function end(){if(ending)return;ending=true;child?.kill();lock.close();rmSync(pidFile,{force:true});}
process.on('SIGINT',()=>end());process.on('SIGTERM',()=>end());
let failures=0;
while(!ending){
  if(await healthy()){console.log('An existing desktop is running. No duplicate was started.');await end();break;}
  log(new Date().toISOString()+' Starting desktop connection.\n');
  child=spawn(process.execPath,[resolve(root,'src/launch.mjs')],{cwd:root,env:{...process.env,CAC_RUNTIME:runtime,CAC_NO_OPEN_BROWSER:process.env.CAC_NO_OPEN_BROWSER==='1'||opened?'1':'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{const text=b.toString();if(text.includes('Desktop ready:'))opened=true;log(text);});child.stderr.on('data',b=>log(b.toString()));
  const started=Date.now();
  await new Promise(resolve=>{child.once('error',()=>resolve());child.once('exit',()=>resolve());});child=null;
  if(ending)break;failures=Date.now()-started>60000?0:failures+1;
  log(new Date().toISOString()+' Connection paused; will retry the same endpoint.\n');
  await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);lock.removeListener('close',finish);resolve();};const timer=setTimeout(finish,Math.min(30000,2000*2**Math.min(failures,4)));lock.once('close',finish);});
}

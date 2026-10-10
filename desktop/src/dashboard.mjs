// Keep browser code as a raw string so escaped newlines survive HTML rendering.
export function dashboardScript(adminKey,pairing) {
  return `(()=>{const key=${JSON.stringify(adminKey)};const pairing=${JSON.stringify(pairing)};`+String.raw`
const state=document.querySelector('#status');
document.querySelector('#pair').value=pairing||'会话已结束，点击重新配对';
async function api(path,data){
  const response=await fetch('/api/'+path,{method:data?'POST':'GET',headers:{'X-Admin-Key':key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  if(!response.ok)throw new Error('dashboard_request_failed');
  return response.json();
}
document.querySelector('#copy').onclick=async()=>{
  try{await navigator.clipboard.writeText(document.querySelector('#pair').value);}
  catch{state.textContent='无法自动复制，请选中上面的配对码手动复制。';}
};
document.querySelector('#new').onclick=async()=>{
  try{await api('new',{});location.reload();}
  catch{state.textContent='重新配对未成功，请刷新页面查看状态。';}
};
document.querySelector('#stop').onclick=async()=>{
  try{await api('revoke',{});location.reload();}
  catch{state.textContent='未确认撤销结果，请在手机点立即停止。';}
};
async function refreshDashboard(){
  try{
    const s=await api('status');
    state.textContent=(s.active?'配对有效':'已撤销')+' · '+(s.connected?'手机已连接':'等待手机')+' · 剩余 '+s.remainingSeconds+' 秒\n'+(s.phone?.apps?.join('\n')||'尚未授权任何应用');
  }catch{state.textContent='无法读取电脑状态，请刷新页面。连接情况可由 Codex 查询。';}
}
refreshDashboard();setInterval(refreshDashboard,3000);
})();`;
}

// Keep browser code as a raw string so escaped newlines survive HTML rendering.
export function dashboardScript(adminKey,pairing,pairId) {
  return `(()=>{const key=${JSON.stringify(adminKey)};const pairing=${JSON.stringify(pairing)};let displayedPairId=${JSON.stringify(pairId||null)};`+String.raw`
const state=document.querySelector('#status');
document.querySelector('#pair').value=pairing||'会话已结束，点击重新配对';
async function api(path,data){
  const response=await fetch('/api/'+path,{method:data?'POST':'GET',headers:{'X-Admin-Key':key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  if(!response.ok)throw new Error(response.status===409?'another_command_pending':'dashboard_request_failed');
  return response.json();
}
function showPair(data){
  displayedPairId=data.pairId;
  document.querySelector('#pair').value=data.pairing||'配对已过期，请点击重新配对';
  const qr=document.querySelector('#qr');if(qr){qr.src=data.qr||'';qr.hidden=!data.qr;}
}
document.querySelector('#copy').onclick=async()=>{
  let prepared;
  try{
    prepared=await api('copy-pair',{});
    showPair(prepared);
  }catch(error){
    state.textContent=error.message==='another_command_pending'?'手机操作仍在执行，完成后再复制新配对码。':'新配对码未准备成功，请重新打开电脑配对页。';return;
  }
  try{await navigator.clipboard.writeText(prepared.pairing);state.textContent='已复制当前新配对码，请粘贴到手机助手并开始。';}
  catch{state.textContent='新配对码已更新，请选中上面的整段配对码手动复制。';}
};
document.querySelector('#new').onclick=async()=>{
  try{showPair(await api('new',{}));await refreshDashboard();}
  catch(error){state.textContent=error.message==='another_command_pending'?'手机操作仍在执行，完成后再重新配对。':'重新配对未成功，请刷新页面查看状态。';}
};
document.querySelector('#stop').onclick=async()=>{
  try{await api('revoke',{});location.reload();}
  catch{state.textContent='未确认撤销结果，请在手机点立即停止。';}
};
async function refreshDashboard(){
  try{
    const s=await api('status');
    if(s.pairId!==displayedPairId)showPair(await api('pair'));
    state.textContent=(s.active?'配对有效':'已撤销')+' · '+(s.connected?'手机已连接':'等待手机')+' · 剩余 '+s.remainingSeconds+' 秒\n'+(s.phone?.apps?.join('\n')||'尚未授权任何应用');
    if(s.connectionIssue==='frame_replayed')state.textContent+='\n旧连接数据已被拒绝；新版手机重新确认开始会建立新连接。';
    else if(s.connectionIssue)state.textContent+='\n连接请求验证失败，请复制新配对码；若再次失败，请让 Codex 检查连接。';
  }catch{state.textContent='无法读取电脑状态，请刷新页面。连接情况可由 Codex 查询。';}
}
refreshDashboard();setInterval(refreshDashboard,3000);
})();`;
}

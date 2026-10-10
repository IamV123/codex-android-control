// Keep browser code as a raw string so escaped newlines survive HTML rendering.
export function dashboardScript(adminKey,pairing,pairId) {
  return `(()=>{const key=${JSON.stringify(adminKey)};const pairing=${JSON.stringify(pairing)};let displayedPairId=${JSON.stringify(pairId||null)};`+String.raw`
const state=document.querySelector('#status');
document.querySelector('#pair').value=pairing||'会话已结束，点击重新配对';
async function api(path,data){
  const response=await fetch('/api/'+path,{method:data?'POST':'GET',headers:{'X-Admin-Key':key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  if(!response.ok){if(response.status===401){location.reload();throw new Error('dashboard_auth_changed');}const issue=await response.json().catch(()=>({}));throw new Error(issue.error||'dashboard_request_failed');}
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
  try{const value=document.querySelector('#duration-value')?.value||'7',unit=document.querySelector('#duration-unit')?.value||'days';showPair(await api('new',{value,unit}));await refreshDashboard();}
  catch(error){state.textContent=error.message==='another_command_pending'?'手机操作仍在执行，完成后再重新配对。':error.message==='duration_must_be_between_one_minute_and_30_days'?'时长请输入整数，范围为1分钟至30天。':'重新配对未成功，请先查看未确认操作或刷新页面。';}
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
    if(s.phone?.locked)state.textContent+='\n手机已锁屏，暂停操作；本机解锁后恢复。';
    if(s.persistent)state.textContent+='\n配对已保存在本机，电脑端重启不会延长有效期。';
    if(s.persistenceFault)state.textContent+='\n本机保存失败，已阻止发送操作。请检查电脑端日志。';
    const review=document.querySelector('#review');if(review){review.hidden=!s.recoveryRequired;review.dataset.operation=s.unconfirmedOperation?.id||'';}
    if(s.recoveryRequired){const actions={phone_click:'触摸点击',phone_swipe:'滑动',phone_scroll:'翻页',phone_type:'输入文字',phone_open_app:'打开应用',phone_home:'返回桌面',phone_back:'返回'};state.textContent+='\n电脑中断时的“'+(actions[s.unconfirmedOperation.tool]||'手机操作')+'”没有收到回执，未自动重发。先核对手机再解除阻塞。';}
    if(s.connectionIssue==='frame_replayed')state.textContent+='\n旧连接数据已被拒绝；新版手机重新确认开始会建立新连接。';
    else if(s.connectionIssue)state.textContent+='\n连接请求验证失败，请复制新配对码；若再次失败，请让 Codex 检查连接。';
  }catch{state.textContent='无法读取电脑状态，请刷新页面。连接情况可由 Codex 查询。';}
}
const review=document.querySelector('#review');if(review)review.onclick=async()=>{if(!confirm('确认你已核对手机上次操作的实际结果？本程序不会重发该操作。'))return;try{await api('acknowledge-operation',{confirm:'checked_on_phone',id:review.dataset.operation});await refreshDashboard();}catch{state.textContent='未确认解除阻塞，请重新查看状态。';}};
refreshDashboard();setInterval(refreshDashboard,3000);
})();`;
}

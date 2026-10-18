const pillClass = {
  created: 'muted',
  uploaded: 'muted',
  scan_clean: 'ok',
  scan_infected: 'danger',
  otp_requested: 'muted',
  otp_failed: 'warn',
  otp_verified: 'ok',
  downloaded: 'ok',
  expired: 'muted',
  revoked: 'danger',
};

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

async function load() {
  setStatus('読み込み中...');
  const res = await fetch('/api/audit-logs', { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    setStatus(`エラー: HTTP ${res.status}`);
    return;
  }
  const { entries } = await res.json();
  setStatus('');

  if (entries.length === 0) {
    document.getElementById('empty-msg').style.display = 'block';
    return;
  }

  const tbody = document.querySelector('#log-table tbody');
  tbody.innerHTML = '';
  for (const e of entries) {
    const tr = document.createElement('tr');
    const when = new Date(e.createdAt).toLocaleString('ja-JP');
    const cls = pillClass[e.event] || 'muted';
    const values=[when,e.eventLabel,e.actor,e.filename,e.senderEmail,e.recipientEmail,e.ipAddress];
    values.forEach((value,i)=>{const td=document.createElement('td');
      if(i===1){const span=document.createElement('span');span.className='pill '+cls;span.textContent=value??'';td.appendChild(span);}
      else td.textContent=value??'';tr.appendChild(td);});
    tbody.appendChild(tr);
  }
  document.getElementById('log-table-wrap').style.display = 'block';
}

async function initializeAuditScreen() {
  const session=await fetch('/api/session');
  if(session.status===404){await load();return;} // Existing IAP-only deployment.
  if(!session.ok){setStatus('ログインが必要です。');return;}
  const user=await session.json();
  if(user.role!=='admin'){setStatus('企業管理者のみ閲覧・出力できます。');return;}
  await loadCommercialHistory();
}
initializeAuditScreen().catch(err=>setStatus(err.message));

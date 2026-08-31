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
    tr.innerHTML = `
      <td class="nowrap">${when}</td>
      <td><span class="pill ${cls}">${e.eventLabel}</span></td>
      <td>${e.actor ?? ''}</td>
      <td>${e.filename ?? ''}</td>
      <td>${e.senderEmail ?? ''}</td>
      <td>${e.recipientEmail ?? ''}</td>
      <td>${e.ipAddress ?? ''}</td>
    `;
    tbody.appendChild(tr);
  }
  document.getElementById('log-table-wrap').style.display = 'block';
}

load().catch((err) => setStatus(`エラー: ${err.message}`));

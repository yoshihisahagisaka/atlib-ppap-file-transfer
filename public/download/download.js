const token = window.location.pathname.split('/').pop();

const statusMessage = {
  scanning: 'ウイルススキャン中です。しばらくしてから再度アクセスしてください。',
  infected: 'このファイルはウイルス対策のため削除されました。送信者にお問い合わせください。',
  expired: '有効期限が切れているか、ダウンロード回数の上限に達しています。',
  revoked: 'この送信は取り消されました。',
  pending_upload: 'アップロード処理中です。しばらくしてから再度アクセスしてください。',
};

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function renderFileList(files) {
  const list = document.getElementById('file-list');
  list.innerHTML = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="fname">${f.filename}</span><span class="fsize">${formatSize(f.sizeBytes)}</span>`;
    list.appendChild(li);
  }
}

async function init() {
  try {
    const info = await api(`/api/d/${token}/status`);
    const parts = [];
    if (info.toEmailsMasked && info.toEmailsMasked.length > 0) {
      parts.push(`送信先: ${info.toEmailsMasked.join(', ')}`);
    }
    if (info.expiresAt) parts.push(`有効期限: ${new Date(info.expiresAt).toLocaleString('ja-JP')}`);
    if (typeof info.downloadsRemaining === 'number') parts.push(`残りダウンロード回数: ${info.downloadsRemaining}`);
    document.getElementById('info').innerHTML = parts.join('<br>');

    if (info.usable) {
      if (info.files) renderFileList(info.files);
      document.getElementById('request-section').style.display = 'block';
    } else {
      setStatus(statusMessage[info.status] || '現在この操作は利用できません。');
    }
  } catch (err) {
    document.getElementById('info').textContent =
      err.status === 404
        ? 'リンクが見つかりません。URLをご確認ください。'
        : '一時的なエラーが発生しました。しばらくしてから再度お試しください。';
  }
}

document.getElementById('request-otp').addEventListener('click', async () => {
  const email = document.getElementById('recipient-email').value.trim();
  if (!email) {
    setStatus('メールアドレスを入力してください。');
    return;
  }
  try {
    setStatus('送信中...');
    const result = await api(`/api/d/${token}/otp`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    document.getElementById('request-section').style.display = 'none';
    document.getElementById('otp-section').style.display = 'block';
    setStatus(`${result.sentTo} 宛に確認コードを送信しました。`);
  } catch (err) {
    const message =
      err.status === 403
        ? 'このメールアドレスは宛先として登録されていません。送信者に確認してください。'
        : err.message;
    setStatus(`エラー: ${message}`);
  }
});

// ブラウザのポップアップブロックを避けるため、一括ダウンロードは各リンクのクリックを
// 少しずつずらして発火させる(同時に大量発火すると複数タブ扱いでブロックされることがある)。
function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

document.getElementById('verify-otp').addEventListener('click', async () => {
  const code = document.getElementById('otp-code').value.trim();
  if (!code) return;
  try {
    setStatus('確認中...');
    const result = await api(`/api/d/${token}/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });

    document.getElementById('otp-section').style.display = 'none';
    document.getElementById('request-section').style.display = 'none';

    const downloadList = document.getElementById('download-list');
    downloadList.innerHTML = '';
    for (const f of result.files) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="fname">${f.filename}</span>`;
      const link = document.createElement('a');
      link.className = 'dl-btn';
      link.href = f.downloadUrl;
      link.textContent = 'ダウンロード';
      link.addEventListener('click', () => setStatus(''));
      li.appendChild(link);
      downloadList.appendChild(li);
    }

    document.getElementById('download-all').addEventListener('click', () => {
      result.files.forEach((f, i) => {
        setTimeout(() => triggerDownload(f.downloadUrl, f.filename), i * 400);
      });
    });

    document.getElementById('files-section').style.display = 'block';
    setStatus('');
  } catch (err) {
    const message = {
      invalid: 'コードが正しくありません。',
      expired: 'コードの有効期限が切れました。再度リクエストしてください。',
      locked: '試行回数の上限に達しました。再度コードをリクエストしてください。',
      not_found: 'コードが見つかりません。再度リクエストしてください。',
    }[err.message];
    setStatus(`エラー: ${message || err.message}`);
  }
});

init();

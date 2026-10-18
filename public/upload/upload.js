const statusLabel = {
  pending_upload: 'アップロード待ち',
  scanning: 'ウイルススキャン中',
  clean: '送信済み(利用可能)',
  infected: 'ウイルス検出(削除済み)',
  expired: '期限切れ/上限到達',
  revoked: '取り消し済み',
};

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

const progressLine = document.getElementById('progress-line');
const progressText = document.getElementById('progress-text');

function setProgress(text) {
  progressText.textContent = text;
  progressLine.classList.add('show');
}

function hideProgress() {
  progressLine.classList.remove('show');
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.details ? ` (${JSON.stringify(body.details)})` : '';
    throw new Error((body.error || `HTTP ${res.status}`) + detail);
  }
  return res.json();
}

async function loadHistory() {
  const { transfers } = await api('/api/transfers');
  const tbody = document.querySelector('#history tbody');
  tbody.innerHTML = '';
  for (const t of transfers) {
    const tr = document.createElement('tr');
    const expires = new Date(t.expiresAt).toLocaleString('ja-JP');
    tr.innerHTML = `
      <td>${t.recipientEmail}</td>
      <td>${t.filename}</td>
      <td>${statusLabel[t.status] || t.status}</td>
      <td>${t.downloadCount}/${t.maxDownloads}</td>
      <td>${expires}</td>
      <td>${t.status === 'clean' ? `<button data-group-id="${t.groupId}" class="revoke">取消</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('button.revoke').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/transfer-groups/${btn.dataset.groupId}/revoke`, { method: 'POST' });
      await loadHistory();
    });
  });
}

// ファイル選択は「行を追加していく」方式(OSのファイル選択ダイアログでCtrl+クリックする必要がない)。
// 常に最低1行は残す(最後の1行を消す操作は選択内容のクリアとして扱う)。
const fileRowsContainer = document.getElementById('file-rows');
const addFileRowBtn = document.getElementById('add-file-row');

function createFileRow() {
  const row = document.createElement('div');
  row.className = 'file-row';

  const input = document.createElement('input');
  input.type = 'file';
  input.className = 'file-input';
  row.appendChild(input);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-file-row';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    if (fileRowsContainer.children.length > 1) {
      row.remove();
    } else {
      input.value = '';
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  row.appendChild(removeBtn);

  return row;
}

function resetFileRows() {
  fileRowsContainer.innerHTML = '';
  fileRowsContainer.appendChild(createFileRow());
}

function getSelectedFiles() {
  return Array.from(fileRowsContainer.querySelectorAll('.file-input'))
    .map((input) => input.files[0])
    .filter(Boolean);
}

addFileRowBtn.addEventListener('click', () => {
  fileRowsContainer.appendChild(createFileRow());
});

resetFileRows();

// メッセージ欄のテンプレート内 {{ファイル名}} を、選択されたファイル名(複数可)の一覧に自動で
// 置き換える。一度置き換えた後に選び直した場合は、直前に挿入したブロックだけを新しい内容に
// 差し替える(本文を手で書き換えていた場合はそのブロックが見当たらなくなるので、上書きしない)。
const noteField = document.getElementById('recipientNote');
let lastInsertedBlock = null;

fileRowsContainer.addEventListener('change', (ev) => {
  if (!ev.target.classList.contains('file-input')) return;
  const files = getSelectedFiles();
  const block = files.map((f) => f.name).join('\n');
  const target = lastInsertedBlock ?? '{{ファイル名}}';
  if (files.length > 0 && noteField.value.includes(target)) {
    noteField.value = noteField.value.replace(target, block);
    lastInsertedBlock = block;
  }
});

// メッセージ欄のテンプレート内 {{送信者氏名}} も、送信者氏名欄の入力にあわせて同様に自動置換する。
const senderNameField = document.getElementById('senderName');
let lastInsertedSenderName = null;

senderNameField.addEventListener('input', () => {
  const newText = senderNameField.value.trim() || '{{送信者氏名}}';
  const target = lastInsertedSenderName ?? '{{送信者氏名}}';
  if (noteField.value.includes(target)) {
    noteField.value = noteField.value.replace(target, newText);
    lastInsertedSenderName = newText;
  }
});

document.getElementById('upload-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const files = getSelectedFiles();
  if (files.length === 0) {
    setStatus('ファイルを選択してください。');
    return;
  }

  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;
  setStatus('');

  try {
    setProgress('送信準備中...');

    const senderName = document.getElementById('senderName').value;
    const to = document.getElementById('to').value;
    const cc = document.getElementById('cc').value || undefined;
    const recipientNote = document.getElementById('recipientNote').value || undefined;
    const expiresInDays = Number(document.getElementById('expiresInDays').value);

    // グループ(1回のフォーム送信の入れ物)を先に作成する。ダウンロードURL・OTP認証・期限・
    // DL回数はこのグループに一本化されており、受信者は1つのリンク・1回のOTP認証でグループ内の
    // 全ファイルにアクセスできる。to/ccはカンマ区切り文字列のままサーバーに送り、パース・検証は
    // サーバー側(transferGroupRoutes.ts)で行う。
    const { groupId, downloadToken: groupToken } = await api('/api/transfer-groups', {
      method: 'POST',
      body: JSON.stringify({ senderName, to, cc, recipientNote, expiresInDays }),
    });

    // 1. 全ファイル分の送信レコード作成(署名付きアップロードURL発行)
    const created = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`送信準備中... (${i + 1}/${files.length})`);
      const c = await api('/api/transfers', {
        method: 'POST',
        body: JSON.stringify({
          groupId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
      created.push({ file, ...c });
    }

    // 2. 全ファイルを並行アップロード
    setProgress(files.length > 1 ? `アップロード中... (${files.length}件)` : 'アップロード中...');
    await Promise.all(
      created.map(async (c) => {
        const putRes = await fetch(c.uploadUrl, {
          method: 'PUT',
          headers: c.uploadHeaders ?? { 'Content-Type': c.file.type || 'application/octet-stream' },
          body: c.file,
        });
        if (!putRes.ok) throw new Error(`アップロード失敗: ${c.file.name} (HTTP ${putRes.status})`);
      }),
    );

    // 3. 全ファイルのスキャンを並行で同期呼び出し。受信者への統合通知メールは全ファイルの
    // スキャンが出揃った時点で自動送信されるため、受信者側が「スキャン中」の待ち状態を
    // 見ることはない(待ちは送信者側に寄せる設計)。
    setProgress(
      files.length > 1
        ? `ウイルススキャン中です。しばらくお待ちください(${files.length}件、この間、受信者にはまだ通知されません)...`
        : 'ウイルススキャン中です。しばらくお待ちください(この間、受信者にはまだ通知されません)...',
    );
    await Promise.all(
      created.map((c) =>
        api(`/api/transfers/${c.transferId}/complete`, {
          method: 'POST',
          body: JSON.stringify({ groupId, groupToken }),
        }),
      ),
    );

    hideProgress();
    setStatus(
      files.length > 1
        ? `送信しました。${files.length}件のウイルススキャンを完了し、受信者にダウンロードリンクをまとめて送信しました。`
        : '送信しました。ウイルススキャンを完了し、受信者にダウンロードリンクを送信しました。',
    );
    document.getElementById('upload-form').reset();
    resetFileRows();
    lastInsertedBlock = null; // フォームリセットでメッセージ欄もテンプレートに戻るため
    lastInsertedSenderName = null;
    await loadHistory();
  } catch (err) {
    hideProgress();
    setStatus(`エラー: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
  }
});

loadHistory().catch((err) => setStatus(`エラー: ${err.message}`));

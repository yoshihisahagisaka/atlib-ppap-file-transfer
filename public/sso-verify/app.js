(function () {
  const statusArea = document.getElementById('status-area');

  const PROVIDER_LABEL = { google: 'Google', microsoft: 'Microsoft' };

  function renderSignedOut() {
    statusArea.innerHTML = '<p class="signed-out-hint">未ログインです。上のボタンからログインしてください。</p>';
  }

  function renderSession(session) {
    const providerLabel = PROVIDER_LABEL[session.provider] || session.provider;
    const result = session.result;
    let statusClass = result.status;
    let body = '';

    if (result.status === 'provisioned') {
      body =
        '<span class="status-badge">provisioned</span><br>' +
        session.email + '(' + providerLabel + ')としてログインしました。<br>' +
        '所属企業: ' + result.companyName;
    } else if (result.status === 'over_cap') {
      body =
        '<span class="status-badge">over_cap</span><br>' +
        session.email + '(' + providerLabel + ')でログインしましたが、' +
        result.companyName + 'の座席上限(' + result.seatCap + ')に達しているため新規アカウントは発行されませんでした。';
    } else {
      body =
        '<span class="status-badge">domain_not_registered</span><br>' +
        session.email + '(' + providerLabel + ')でログインしましたが、このドメインは検証用の顧客として未登録です。';
    }

    statusArea.innerHTML =
      '<div class="status-card ' + statusClass + '">' + body + '</div>' +
      '<button id="logout-btn" type="button">ログアウト</button>';

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.reload();
    });
  }

  async function loadSession() {
    const res = await fetch('/api/session');
    const data = await res.json();
    if (data.authenticated) {
      renderSession(data);
    } else {
      renderSignedOut();
    }
  }

  loadSession().catch((err) => {
    statusArea.innerHTML = '<p class="signed-out-hint">状態の取得に失敗しました: ' + err.message + '</p>';
  });
})();

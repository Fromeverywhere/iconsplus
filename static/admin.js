(function () {
  const $ = (s) => document.querySelector(s);
  const api = (url, opts = {}) =>
    fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts));

  let statusFilter = 'all';

  // ---------- 鉴权 ----------
  async function me() {
    try {
      const r = await api('/api/admin/me');
      if (r.ok) return (await r.json()).username;
    } catch (_) {}
    return null;
  }

  function showDash(user) {
    $('#loginView').classList.add('hidden');
    $('#dashView').classList.remove('hidden');
    $('#who').textContent = '当前：' + user;
    loadSubs();
    loadSettings();
    loadStats();
  }
  function showLogin() {
    $('#dashView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#loginMsg');
    msg.className = 'form-msg'; msg.textContent = '';
    const fd = new FormData(e.target);
    const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
    if (r.ok) { const d = await r.json(); showDash(d.username); }
    else { const d = await r.json().catch(() => ({})); msg.className = 'form-msg err'; msg.textContent = d.error || '登录失败'; }
  });

  $('#logoutBtn').onclick = async () => {
    await api('/api/admin/logout', { method: 'POST' });
    showLogin();
  };

  // ---------- 提交审核 ----------
  async function loadSubs() {
    const url = '/api/admin/submissions' + (statusFilter === 'all' ? '' : '?status=' + statusFilter);
    const r = await api(url);
    const list = r.ok ? await r.json() : [];
    const body = $('#subsBody');
    body.innerHTML = '';
    if (!list.length) { body.innerHTML = '<tr><td colspan="6" class="muted">暂无数据</td></tr>'; return; }
    list.forEach((s) => {
      const tr = document.createElement('tr');
      const time = new Date(s.createdAt).toLocaleString();
      tr.innerHTML =
        '<td>' + esc(s.siteName) + '</td>' +
        '<td><a href="' + esc(s.siteUrl) + '" target="_blank" rel="noopener">' + esc(shorten(s.siteUrl)) + '</a></td>' +
        '<td><code>' + esc(shorten(s.apiUrl)) + '</code></td>' +
        '<td><span class="badge ' + s.status + '">' + statusText(s.status) + '</span>' +
          (s.status === 'failed' && s.imported && s.imported.error ? ' <span class="muted" title="' + esc(s.imported.error) + '">⚠</span>' : '') + '</td>' +
        '<td class="muted">' + time + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn" data-act="view" data-id="' + s.id + '">详情</button>' +
          (s.status === 'pending' ? '<button class="btn btn-primary" data-act="approve" data-id="' + s.id + '">通过</button>' : '') +
          (s.status === 'pending' ? '<button class="btn" data-act="reject" data-id="' + s.id + '">拒绝</button>' : '') +
          '<button class="btn" data-act="delete" data-id="' + s.id + '">删除</button>' +
        '</div></td>';
      body.appendChild(tr);
    });
  }

  $('#subsBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'view') return viewDetail(id);
    if (act === 'approve') return approve(id, btn);
    if (act === 'reject') {
      const reason = prompt('拒绝原因（选填）：') || '';
      await api('/api/admin/submissions/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason }) });
      loadSubs();
    }
    if (act === 'delete') {
      if (!confirm('确认删除该提交？')) return;
      await api('/api/admin/submissions/' + id, { method: 'DELETE' });
      loadSubs();
    }
  });

  async function approve(id, btn) {
    btn.disabled = true; btn.textContent = '导入中…';
    const r = await api('/api/admin/submissions/' + id + '/approve', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast('失败：' + (d.error || '未知错误'));
      btn.disabled = false; btn.textContent = '通过';
      return;
    }
    toast('已提交导入，后台正在拉取图标…');
    pollStatus(id);
  }

  // 轮询单个提交状态，直到导入完成（或失败/超时）
  function pollStatus(id) {
    const iv = setInterval(async () => {
      try {
        const r = await api('/api/admin/submissions/' + id);
        if (!r.ok) return;
        const s = await r.json();
        if (s.status !== 'importing') {
          clearInterval(iv);
          if (s.status === 'approved') {
            const res = s.imported || {};
            toast('导入完成：成功 ' + (res.imported || 0) + ' / 共 ' + (res.total || 0) + (res.failed && res.failed.length ? '，失败 ' + res.failed.length : ''));
          } else if (s.status === 'failed') {
            toast('导入失败：' + ((s.imported && s.imported.error) || '部分图标拉取失败'));
          }
          loadSubs();
          loadStats();
        }
      } catch (_) {}
    }, 1500);
    setTimeout(() => clearInterval(iv), 180000); // 3 分钟兜底
  }

  async function viewDetail(id) {
    const r = await api('/api/admin/submissions/' + id);
    const d = r.ok ? await r.json() : {};
    $('#detailTitle').textContent = d.siteName || id;
    $('#detailBody').textContent = JSON.stringify(d, null, 2);
    $('#detailModal').classList.remove('hidden');
  }
  $('#detailClose').onclick = () => $('#detailModal').classList.add('hidden');

  $('#statusFilters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-status]'); if (!b) return;
    statusFilter = b.dataset.status;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('active', c === b));
    loadSubs();
  });

  // ---------- 防盗链设置 ----------
  async function loadSettings() {
    const r = await api('/api/admin/settings');
    const d = r.ok ? (await r.json()).hotlink : {};
    $('#hlEnabled').checked = !!d.enabled;
    $('#hlAllow').value = (d.allowlist || []).join(', ');
    $('#hlDeny').value = (d.denylist || []).join(', ');
    $('#hlEmpty').checked = d.allowEmptyReferer !== false;
  }
  $('#saveSettings').onclick = async () => {
    const msg = $('#setMsg'); msg.className = 'form-msg';
    const payload = {
      hotlink: {
        enabled: $('#hlEnabled').checked,
        allowlist: $('#hlAllow').value.split(',').map((s) => s.trim()).filter(Boolean),
        denylist: $('#hlDeny').value.split(',').map((s) => s.trim()).filter(Boolean),
        allowEmptyReferer: $('#hlEmpty').checked
      }
    };
    const r = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
    if (r.ok) { msg.className = 'form-msg ok'; msg.textContent = '已保存'; }
    else { msg.className = 'form-msg err'; msg.textContent = '保存失败'; }
  };

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $('#panel-' + t.dataset.tab).classList.add('active');
    };
  });

  // ---------- utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function shorten(s) { s = String(s || ''); return s.length > 42 ? s.slice(0, 42) + '…' : s; }
  function statusText(s) { return { pending: '待审核', importing: '导入中', approved: '已通过', rejected: '已拒绝', failed: '失败' }[s] || s; }
  async function loadStats() {
    const r = await api('/api/admin/stats');
    const d = r.ok ? await r.json() : {};
    setText('#statTotal', d.total || 0);
    setText('#statPending', (d.byStatus && d.byStatus.pending) || 0);
    setText('#statApproved', (d.byStatus && d.byStatus.approved) || 0);
    setText('#statImported', d.importedIconsTotal || 0);
    setText('#statCats', d.categories || 0);
  }
  function setText(sel, v) { const el = $(sel); if (el) el.textContent = v; }
  let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(tt); tt = setTimeout(() => el.classList.add('hidden'), 2600); }

  // 启动
  me().then((u) => { if (u) showDash(u); else showLogin(); });
})();

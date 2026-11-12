(function () {
  const $ = (s) => document.querySelector(s);
  const api = (url, opts = {}) =>
    fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts));

  const ROLE_LABEL = { super: '超级管理员', uploader: '上传+调用', viewer: '仅调用' };
  const STATUS_TEXT = { pending: '待审核', importing: '导入中', approved: '已通过', rejected: '已拒绝', failed: '失败' };

  let state = { user: null, tab: null };
  let statusFilter = 'all';

  // ---------- 鉴权 ----------
  async function me() {
    try {
      const r = await api('/api/admin/me');
      if (r.ok) return await r.json();
    } catch (_) {}
    return null;
  }

  function canSeeRoles(el, role) {
    const roles = (el.dataset.roles || '').split(',').map((s) => s.trim());
    return roles.includes(role);
  }

  function showDash(user) {
    state.user = user;
    $('#loginView').classList.add('hidden');
    $('#dashView').classList.remove('hidden');

    // 头部用户信息
    $('#who').textContent = user.username;
    $('#whoAvatar').textContent = (user.username || 'U').slice(0, 1).toUpperCase();
    const rb = $('#whoRole');
    rb.textContent = ROLE_LABEL[user.role] || user.role;
    rb.className = 'role-badge role-' + user.role;

    // 统计仅超级管理员可见
    const superUser = user.role === 'super';
    $('#statsRow').classList.toggle('hidden', !superUser);

    // 按角色过滤页签
    const tabs = [...document.querySelectorAll('#tabs .tab')];
    tabs.forEach((t) => t.classList.toggle('hidden', !canSeeRoles(t, user.role)));
    const visible = tabs.filter((t) => !t.classList.contains('hidden'));
    if (visible.length) activateTab(visible[0].dataset.tab);

    if (superUser) loadStats();
  }

  function showLogin() {
    state.user = null;
    $('#dashView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#loginMsg');
    msg.className = 'form-msg'; msg.textContent = '';
    const fd = new FormData(e.target);
    const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
    if (r.ok) { const d = await r.json(); showDash(d); }
    else { const d = await r.json().catch(() => ({})); msg.className = 'form-msg err'; msg.textContent = d.error || '登录失败'; }
  });

  $('#logoutBtn').onclick = async () => {
    await api('/api/admin/logout', { method: 'POST' });
    showLogin();
  };

  // ---------- Tabs ----------
  function activateTab(name) {
    state.tab = name;
    document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'review') loadReview();
    else if (name === 'cats') loadCats();
    else if (name === 'mine') loadMine();
    else if (name === 'settings') loadSettings();
    else if (name === 'users') loadUsers();
    else if (name === 'api') loadApi();
  }
  document.querySelectorAll('#tabs .tab').forEach((t) => (t.onclick = () => activateTab(t.dataset.tab)));

  // ---------- 审核队列（super） ----------
  async function loadReview() {
    const url = '/api/admin/submissions' + (statusFilter === 'all' ? '' : '?status=' + statusFilter);
    const r = await api(url);
    const list = r.ok ? await r.json() : [];
    const body = $('#subsBody');
    body.innerHTML = '';
    if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="muted">暂无数据</td></tr>'; return; }
    list.forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(s.siteName) + '</td>' +
        '<td><a href="' + esc(s.siteUrl) + '" target="_blank" rel="noopener">' + esc(shorten(s.siteUrl)) + '</a></td>' +
        '<td><code>' + esc(shorten(s.apiUrl)) + '</code></td>' +
        '<td><span class="badge ' + s.status + '">' + statusText(s.status) + '</span>' +
          (s.status === 'failed' && s.imported && s.imported.error ? ' <span class="muted" title="' + esc(s.imported.error) + '">⚠</span>' : '') + '</td>' +
        '<td class="muted">' + esc(s.submittedBy || '—') + '</td>' +
        '<td class="muted">' + fmtTime(s.createdAt) + '</td>' +
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
      loadReview(); if (state.user.role === 'super') loadStats();
    }
    if (act === 'delete') {
      if (!confirm('确认删除该提交？')) return;
      await api('/api/admin/submissions/' + id, { method: 'DELETE' });
      loadReview(); if (state.user.role === 'super') loadStats();
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
          loadReview(); if (state.user.role === 'super') loadStats();
        }
      } catch (_) {}
    }, 1500);
    setTimeout(() => clearInterval(iv), 180000);
  }

  async function viewDetail(id) {
    const r = await api('/api/admin/submissions/' + id);
    const d = r.ok ? await r.json() : {};
    $('#detailTitle').textContent = d.siteName || id;
    $('#detailBody').textContent = JSON.stringify(d, null, 2);
    const dlg = $('#detailModal');
    dlg.showModal();
  }
  $('#detailClose').onclick = () => $('#detailModal').close();
  $('#detailModal').addEventListener('click', (e) => { if (e.target === $('#detailModal')) $('#detailModal').close(); });

  $('#statusFilters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-status]'); if (!b) return;
    statusFilter = b.dataset.status;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('active', c === b));
    loadReview();
  });

  // ---------- 分类管理（super） ----------
  async function loadCats() {
    const r = await api('/api/admin/categories');
    const list = r.ok ? await r.json() : [];
    const body = $('#catsBody');
    body.innerHTML = '';
    if (!list.length) { body.innerHTML = '<tr><td colspan="4" class="muted">images 目录下还没有分类文件夹</td></tr>'; return; }
    list.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><code>' + esc(c.folder) + '</code></td>' +
        '<td><input class="cat-label-input" value="' + esc(c.label) + '" maxlength="40" ' +
          'aria-label="显示名" data-folder="' + esc(c.folder) + '" placeholder="前台展示名" /></td>' +
        '<td>' + c.count + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn btn-primary" data-act="save-label" data-folder="' + esc(c.folder) + '">保存</button>' +
          '<button class="btn" data-act="manage" data-folder="' + esc(c.folder) + '">管理图片</button>' +
          '<button class="btn" data-act="rename" data-folder="' + esc(c.folder) + '">重命名文件夹</button>' +
        '</div></td>';
      body.appendChild(tr);
    });
  }

  $('#catsBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const folder = btn.dataset.folder;
    const act = btn.dataset.act;
    if (act === 'save-label') {
      const input = $('#catsBody input[data-folder="' + folder + '"]');
      const r = await api('/api/admin/categories/' + encodeURIComponent(folder) + '/label', {
        method: 'PUT', body: JSON.stringify({ label: input.value })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast('显示名已更新：' + d.label); loadCats(); }
      else toast('失败：' + (d.error || '未知错误'));
    } else if (act === 'manage') {
      return openCatImages(folder);
    } else if (act === 'rename') {
      const newName = (prompt('新的文件夹名（中文/字母/数字/中划线/下划线）：\n注意：外链 URL 会随之变化，旧链接将 404。', folder) || '').trim();
      if (!newName || newName === folder) return;
      if (!confirm('确认把文件夹「' + folder + '」重命名为「' + newName + '」？\n已发布的外链需要同步更新。')) return;
      const r = await api('/api/admin/categories/' + encodeURIComponent(folder) + '/rename', {
        method: 'PUT', body: JSON.stringify({ newName })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast('已重命名为「' + d.folder + '」'); loadCats(); if (state.user.role === 'super') loadStats(); }
      else toast('失败：' + (d.error || '未知错误'));
    }
  });

  // 显示名输入框回车即保存
  $('#catsBody').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.cat-label-input')) return;
    e.preventDefault();
    const folder = e.target.dataset.folder;
    const r = await api('/api/admin/categories/' + encodeURIComponent(folder) + '/label', {
      method: 'PUT', body: JSON.stringify({ label: e.target.value })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast('显示名已更新：' + d.label); loadCats(); }
    else toast('失败：' + (d.error || '未知错误'));
  });

  async function openCatImages(folder) {
    const dlg = $('#catImagesModal');
    $('#catImagesTitle').textContent = '分类图片：' + folder;
    const grid = $('#catImagesGrid');
    grid.innerHTML = '<span class="muted">加载中…</span>';
    dlg.showModal();
    const r = await api('/api/icons.json');
    const cats = r.ok ? await r.json() : [];
    const cat = cats.find((c) => c.name === folder);
    grid.innerHTML = '';
    if (!cat || !cat.icons.length) {
      grid.innerHTML = '<span class="muted">该分类暂无图片</span>';
      return;
    }
    cat.icons.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'cat-img-item';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = '/thumbs/' + encodeURIComponent(folder) + '/' + encodeURIComponent(file) + '.webp';
      img.onerror = function () { this.src = '/images/' + encodeURIComponent(folder) + '/' + encodeURIComponent(file); };
      const name = document.createElement('span');
      name.className = 'fname';
      name.textContent = file;
      name.title = file;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn';
      del.textContent = '删除';
      del.onclick = async () => {
        if (!confirm('确定删除 ' + folder + '/' + file + '？\n此操作不可恢复，引用该图的外链将 404。')) return;
        const rr = await api('/api/admin/categories/' + encodeURIComponent(folder) + '/icons/' + encodeURIComponent(file), { method: 'DELETE' });
        const dd = await rr.json().catch(() => ({}));
        if (rr.ok) { item.remove(); toast('已删除 ' + file); loadCats(); }
        else toast('删除失败：' + (dd.error || '未知错误'));
      };
      item.append(img, name, del);
      grid.appendChild(item);
    });
  }
  $('#catImagesClose').onclick = () => $('#catImagesModal').close();
  $('#catImagesModal').addEventListener('click', (e) => { if (e.target === $('#catImagesModal')) $('#catImagesModal').close(); });

  // ---------- 我的提交（super/uploader） ----------
  async function loadMine() {
    const r = await api('/api/my/submissions');
    const list = r.ok ? await r.json() : [];
    const body = $('#mineBody');
    body.innerHTML = '';
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" class="muted">还没有提交记录</td></tr>'; return; }
    list.forEach((s) => {
      const tr = document.createElement('tr');
      let note = '';
      if (s.status === 'rejected' && s.rejectReason) note = '拒绝原因：' + s.rejectReason;
      else if (s.status === 'failed' && s.imported && s.imported.error) note = '错误：' + s.imported.error;
      else if (s.status === 'approved' && s.imported) note = '成功 ' + (s.imported.imported || 0) + ' / 共 ' + (s.imported.total || 0);
      tr.innerHTML =
        '<td>' + esc(s.siteName) + '</td>' +
        '<td><code>' + esc(shorten(s.apiUrl)) + '</code></td>' +
        '<td><span class="badge ' + s.status + '">' + statusText(s.status) + '</span></td>' +
        '<td class="muted">' + esc(note || '—') + '</td>' +
        '<td class="muted">' + fmtTime(s.createdAt) + '</td>';
      body.appendChild(tr);
    });
  }

  $('#mySubmitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#mySubmitMsg');
    msg.className = 'form-msg'; msg.textContent = '提交中…';
    const payload = Object.fromEntries(new FormData(e.target).entries());
    try {
      const r = await api('/api/submissions', { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { msg.className = 'form-msg err'; msg.textContent = d.error || '提交失败'; return; }
      msg.className = 'form-msg ok'; msg.textContent = '已提交，等待审核（ID ' + d.id.slice(0, 8) + '）';
      e.target.reset();
      loadMine();
      if (state.user.role === 'super') loadStats();
    } catch (_) {
      msg.className = 'form-msg err'; msg.textContent = '网络错误';
    }
  });

  // ---------- 防盗链设置（super） ----------
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

  // ---------- 用户管理（super） ----------
  async function loadUsers() {
    const r = await api('/api/admin/users');
    const list = r.ok ? await r.json() : [];
    const body = $('#usersBody');
    body.innerHTML = '';
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" class="muted">暂无用户</td></tr>'; return; }
    list.forEach((u) => {
      const tr = document.createElement('tr');
      const roleOpts = ['super', 'uploader', 'viewer']
        .map((r) => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>')
        .join('');
      tr.innerHTML =
        '<td><b>' + esc(u.username) + '</b></td>' +
        '<td><select class="role-select" data-act="role" data-id="' + u.id + '">' + roleOpts + '</select></td>' +
        '<td>' + (u.enabled ? '<span class="badge approved">启用</span>' : '<span class="badge rejected">禁用</span>') + '</td>' +
        '<td class="muted">' + esc(u.createdBy || '—') + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn" data-act="toggle" data-id="' + u.id + '" data-enabled="' + (u.enabled ? '1' : '0') + '">' + (u.enabled ? '禁用' : '启用') + '</button>' +
          '<button class="btn" data-act="token" data-id="' + u.id + '">重置 Token</button>' +
          '<button class="btn" data-act="delete" data-id="' + u.id + '">删除</button>' +
        '</div></td>';
      body.appendChild(tr);
    });
  }

  $('#createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#createMsg'); msg.className = 'form-msg';
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const r = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { msg.className = 'form-msg ok'; msg.textContent = '已创建：' + d.username; e.target.reset(); loadUsers(); }
    else { msg.className = 'form-msg err'; msg.textContent = d.error || '创建失败'; }
  });

  $('#usersBody').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-act="role"]');
    if (!sel) return;
    const r = await api('/api/admin/users/' + sel.dataset.id, { method: 'PUT', body: JSON.stringify({ role: sel.value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast('修改失败：' + (d.error || '')); }
    else { toast('角色已更新'); }
    loadUsers();
  });

  $('#usersBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'toggle') {
      const enabled = btn.dataset.enabled === '1';
      const r = await api('/api/admin/users/' + id, { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast('操作失败：' + (d.error || ''));
      loadUsers();
    } else if (act === 'token') {
      if (!confirm('重置该用户的 API Token？旧 Token 会立即失效。')) return;
      const r = await api('/api/admin/users/' + id + '/regenerate-token', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast('已重置'); alert('新的 API Token：\n' + d.apiToken); }
      else toast('重置失败：' + (d.error || ''));
    } else if (act === 'delete') {
      if (!confirm('确认删除该用户？')) return;
      const r = await api('/api/admin/users/' + id, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast('删除失败：' + (d.error || ''));
      loadUsers();
    }
  });

  // ---------- 统计（super） ----------
  async function loadStats() {
    const r = await api('/api/admin/stats');
    const d = r.ok ? await r.json() : {};
    setText('#statTotal', d.total || 0);
    setText('#statPending', (d.byStatus && d.byStatus.pending) || 0);
    setText('#statApproved', (d.byStatus && d.byStatus.approved) || 0);
    setText('#statImported', d.importedIconsTotal || 0);
    setText('#statCats', d.categories || 0);
  }

  // ---------- API 调用（所有人） ----------
  async function loadApi() {
    const origin = location.origin;
    $('#docIcons').textContent = 'curl "' + origin + '/api/icons.json"';
    $('#docImage').textContent = origin + '/images/<分类>/<文件>';
    $('#docSubmit').textContent =
      'curl -X POST "' + origin + '/api/submissions" \\\n' +
      '  -H "Authorization: Bearer <你的Token>" \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      "  -d '{\"siteName\":\"MyIcons\",\"siteUrl\":\"https://example.com\",\"apiUrl\":\"https://example.com/api/icons\"}'";
    const r = await api('/api/my/profile');
    const d = r.ok ? await r.json() : {};
    $('#myToken').textContent = d.apiToken || '—';
  }
  // 剪贴板：http 部署（NAS）下 Async Clipboard 不可用，需 execCommand 回退
  function legacyCopy(text) {
    const field = Object.assign(document.createElement('textarea'), { value: text });
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;opacity:0';
    document.body.append(field);
    field.select();
    try { return document.execCommand('copy'); } finally { field.remove(); }
  }
  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg || '已复制');
    } catch (_) {
      if (legacyCopy(text)) toast(okMsg || '已复制');
      else toast('复制失败，请手动复制');
    }
  }
  $('#copyToken').onclick = () => {
    const t = $('#myToken').textContent;
    if (t && t !== '—') copyText(t, 'Token 已复制');
  };

  // ---------- utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function shorten(s) { s = String(s || ''); return s.length > 42 ? s.slice(0, 42) + '…' : s; }
  function statusText(s) { return STATUS_TEXT[s] || s; }
  function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '—'; }
  function setText(sel, v) { const el = $(sel); if (el) el.textContent = v; }
  let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(tt); tt = setTimeout(() => el.classList.add('hidden'), 2600); }

  // 启动
  me().then((u) => { if (u) showDash(u); else showLogin(); });
})();

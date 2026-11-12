(function () {
  const $ = (sel) => document.querySelector(sel);
  const grid = $('#iconGrid');
  const categoryList = $('#categoryList');
  const searchInput = $('#searchInput');
  const currentView = $('#currentView');
  const resultSummary = $('#resultSummary');
  const emptyState = $('#emptyState');
  const previewModal = $('#previewModal');
  const submitModal = $('#submitModal');

  let CONFIG = { SITE_NAME: 'icons+', THUMB_ENABLED: false };
  let CATEGORIES = []; // [{name, icons:[files]}]
  let activeCat = 'all';
  let keyword = '';
  let CURRENT_USER = null; // {username, role}
  const ROLE_LABEL = { super: '超级管理员', uploader: '上传+调用', viewer: '仅调用' };

  // ---------- 数据 ----------
  async function loadConfig() {
    try {
      CONFIG = await fetch('/api/config.json').then((r) => r.json());
    } catch (_) {}
    document.title = CONFIG.SITE_NAME || 'icons+';
    $('#siteTitle').textContent = CONFIG.SITE_NAME || 'icons+';
    if (CONFIG.LOGO_IMG && CONFIG.LOGO_IMG !== 'favicon.svg') {
      $('#siteLogo').src = CONFIG.LOGO_IMG.startsWith('http') ? CONFIG.LOGO_IMG : '/' + CONFIG.LOGO_IMG.replace(/^\/+/, '');
    }
  }

  async function loadIcons() {
    try {
      CATEGORIES = await fetch('/api/icons.json').then((r) => r.json());
    } catch (e) {
      CATEGORIES = [];
    }
    renderCategories();
    renderGrid();
  }

  // ---------- 登录态与角色 ----------
  async function loadMe() {
    try {
      const r = await fetch('/api/admin/me', { credentials: 'same-origin' });
      CURRENT_USER = r.ok ? await r.json() : null;
    } catch (_) {
      CURRENT_USER = null;
    }
    renderAccount();
  }

  function renderAccount() {
    const chip = $('#accountChip');
    const link = $('#adminLink');
    if (CURRENT_USER) {
      chip.classList.remove('hidden');
      link.classList.add('hidden');
      $('#accountName').textContent = CURRENT_USER.username;
      $('#accountAvatar').textContent = (CURRENT_USER.username || 'U').slice(0, 1).toUpperCase();
      const rb = $('#accountRole');
      rb.textContent = ROLE_LABEL[CURRENT_USER.role] || CURRENT_USER.role;
      rb.className = 'role-badge role-' + CURRENT_USER.role;
    } else {
      chip.classList.add('hidden');
      link.classList.remove('hidden');
    }
  }

  // 映射保持：图标对外 URL 永远是 /images/<分类>/<文件>
  function iconUrl(cat, file) {
    return '/images/' + encodeURIComponent(cat) + '/' + encodeURIComponent(file);
  }
  function thumbUrl(cat, file) {
    if (!CONFIG.THUMB_ENABLED) return iconUrl(cat, file);
    return '/thumbs/' + encodeURIComponent(cat) + '/' + encodeURIComponent(file) + '.webp';
  }

  // ---------- 渲染 ----------
  function renderCategories() {
    const total = CATEGORIES.reduce((n, c) => n + c.icons.length, 0);
    const items = [{ name: 'all', label: '全部', count: total }]
      .concat(CATEGORIES.map((c) => ({ name: c.name, label: c.name, count: c.icons.length })));
    categoryList.innerHTML = '';
    items.forEach((it) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-item' + (it.name === activeCat ? ' active' : '');
      btn.setAttribute('aria-pressed', it.name === activeCat ? 'true' : 'false');
      btn.innerHTML = '<span>' + escapeHtml(it.label) + '</span><span class="count">' + it.count + '</span>';
      btn.onclick = () => { activeCat = it.name; renderCategories(); renderGrid(); };
      li.appendChild(btn);
      categoryList.appendChild(li);
    });
  }

  function currentIcons() {
    let list = [];
    CATEGORIES.forEach((c) => {
      if (activeCat !== 'all' && c.name !== activeCat) return;
      c.icons.forEach((file) => list.push({ cat: c.name, file }));
    });
    if (keyword) {
      const k = keyword.toLowerCase();
      list = list.filter((i) => (i.cat + '/' + i.file).toLowerCase().includes(k));
    }
    return list;
  }

  function renderGrid() {
    const list = currentIcons();
    currentView.textContent = activeCat === 'all' ? '全部图标' : activeCat;
    resultSummary.textContent = '共 ' + list.length + ' 个图标';
    grid.innerHTML = '';
    emptyState.classList.toggle('hidden', list.length > 0);
    const frag = document.createDocumentFragment();
    list.forEach((i) => {
      // 可点击卡片用原生 button：键盘可达、语义正确
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.setAttribute('aria-label', '预览 ' + i.file);
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = thumbUrl(i.cat, i.file);
      img.alt = '';
      img.onerror = function () {
        if (this.src !== iconUrl(i.cat, i.file)) this.src = iconUrl(i.cat, i.file);
        else this.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22/%3E';
      };
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = i.file;
      card.appendChild(img);
      card.appendChild(name);
      card.onclick = () => openPreview(i.cat, i.file);
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  // ---------- 预览（原生 dialog） ----------
  function openPreview(cat, file) {
    const url = iconUrl(cat, file);
    const img = $('#previewImg');
    img.src = url;
    img.alt = file;
    $('#previewName').textContent = file;
    $('#previewUrl').textContent = location.origin + url;
    $('#downloadLink').href = url;
    $('#openLink').href = url;
    $('#copyLink').onclick = () => copyText(location.origin + url);
    previewModal.showModal();
  }
  $('#previewClose').onclick = () => previewModal.close();
  // 点击 ::backdrop（即 dialog 自身区域）关闭
  previewModal.addEventListener('click', (e) => { if (e.target === previewModal) previewModal.close(); });

  // ---------- 提交 ----------
  $('#submitBtn').onclick = () => {
    if (!CURRENT_USER) {
      toast('请先登录后再提交');
      setTimeout(() => (location.href = '/admin'), 600);
      return;
    }
    if (CURRENT_USER.role === 'viewer') {
      toast('你的角色（仅调用）无法提交图标');
      return;
    }
    submitModal.showModal();
  };
  $('#submitClose').onclick = () => submitModal.close();
  $('#submitCancel').onclick = () => submitModal.close();
  submitModal.addEventListener('click', (e) => { if (e.target === submitModal) submitModal.close(); });

  $('#submitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#submitMsg');
    msg.className = 'form-msg'; msg.textContent = '提交中…';
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const r = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      if (!r.ok) { msg.className = 'form-msg err'; msg.textContent = data.error || '提交失败'; return; }
      msg.className = 'form-msg ok'; msg.textContent = '已提交，等待管理员审核（ID: ' + data.id.slice(0, 8) + '）';
      e.target.reset();
      setTimeout(() => { if (submitModal.open) submitModal.close(); }, 1500);
    } catch (err) {
      msg.className = 'form-msg err'; msg.textContent = '网络错误，请重试';
    }
  });

  // ---------- 工具 ----------
  // 剪贴板：Async Clipboard 仅在安全上下文可用（NAS 部署常为 http），失败时回退 execCommand
  function legacyCopy(text) {
    const field = Object.assign(document.createElement('textarea'), { value: text });
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;opacity:0';
    document.body.append(field);
    field.select();
    try { return document.execCommand('copy'); } finally { field.remove(); }
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch (_) {
      if (legacyCopy(text)) toast('已复制');
      else toast('复制失败，请手动复制');
    }
  }
  let toastTimer;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1600);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  searchInput.addEventListener('input', (e) => { keyword = e.target.value.trim(); renderGrid(); });

  // 主题由共享的 theme.js 管理（system/light/dark 三态，localStorage 持久化）

  // 启动
  loadConfig().then(loadMe).then(loadIcons);
})();

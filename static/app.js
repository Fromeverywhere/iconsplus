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
      li.className = (it.name === activeCat ? 'active' : '');
      li.innerHTML = '<span>' + escapeHtml(it.label) + '</span><span class="count">' + it.count + '</span>';
      li.onclick = () => { activeCat = it.name; renderCategories(); renderGrid(); };
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
    list.forEach((i) => {
      const card = document.createElement('div');
      card.className = 'card';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = thumbUrl(i.cat, i.file);
      img.alt = i.file;
      img.onerror = function () {
        if (this.src !== iconUrl(i.cat, i.file)) this.src = iconUrl(i.cat, i.file);
        else this.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22/%3E';
      };
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = i.file;
      card.appendChild(img);
      card.appendChild(name);
      card.onclick = () => openPreview(i.cat, i.file);
      grid.appendChild(card);
    });
  }

  // ---------- 预览 ----------
  function openPreview(cat, file) {
    const url = iconUrl(cat, file);
    $('#previewImg').src = url;
    $('#previewName').textContent = file;
    $('#previewUrl').textContent = location.origin + url;
    $('#downloadLink').href = url;
    $('#openLink').href = url;
    $('#copyLink').onclick = () => copyText(location.origin + url);
    previewModal.classList.remove('hidden');
  }
  $('#previewClose').onclick = () => previewModal.classList.add('hidden');
  previewModal.onclick = (e) => { if (e.target === previewModal) previewModal.classList.add('hidden'); };

  // ---------- 提交 ----------
  $('#submitBtn').onclick = () => submitModal.classList.remove('hidden');
  $('#submitClose').onclick = () => submitModal.classList.add('hidden');
  $('#submitCancel').onclick = () => submitModal.classList.add('hidden');
  submitModal.onclick = (e) => { if (e.target === submitModal) submitModal.classList.add('hidden'); };

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
      setTimeout(() => submitModal.classList.add('hidden'), 1500);
    } catch (err) {
      msg.className = 'form-msg err'; msg.textContent = '网络错误，请重试';
    }
  });

  // ---------- 工具 ----------
  function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => toast('已复制链接'));
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

  // 主题
  const savedTheme = localStorage.getItem('icons_theme');
  if (savedTheme) document.body.setAttribute('data-theme', savedTheme);
  $('#themeToggle').onclick = () => {
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('icons_theme', next);
  };

  // Esc 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { previewModal.classList.add('hidden'); submitModal.classList.add('hidden'); }
  });

  // 启动
  loadConfig().then(loadIcons);
})();

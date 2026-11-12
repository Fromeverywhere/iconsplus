require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getIcons } = require('./services/iconScanner');
const { applyHtml } = require('./services/htmlTemplate');
const thumbnailer = require('./services/thumbnailer');
const auth = require('./services/auth');
const users = require('./services/users');
const store = require('./services/store');
const importer = require('./services/importer');
const { createHotlinkMiddleware } = require('./services/hotlink');
const categories = require('./services/categories');

const app = express();
const PORT = process.env.PORT || 5000;

// 首次运行时种子超级管理员（默认 admin / iconsplus）
users.ensure();

const CONFIG = {
  SITE_NAME: process.env.SITE_NAME || 'icons+',
  LOGO_IMG: process.env.LOGO_IMG || 'favicon.svg',
  COPYRIGHT: process.env.COPYRIGHT || 'icons+ · 基于 xg-icons-hub 构建',
  SEO_DESC: process.env.SEO_DESC || 'icons+ 图标托管：分类图标、外链加速、提交共建。',
  FAVICON: process.env.FAVICON || 'favicon.ico',
  ICP: process.env.ICP || '',
  UMAMI_URL: process.env.UMAMI_URL || '',
  UMAMI_SITE_ID: process.env.UMAMI_SITE_ID || '',
  THUMB_ENABLED: thumbnailer.isAvailable()
};

app.use(cors());
app.use(express.json({ limit: '256kb' }));

// 防盗链：覆盖原图与缩略图
const hotlinkMiddleware = createHotlinkMiddleware(store.getSettings);
app.use('/images', hotlinkMiddleware);
app.use('/thumbs', hotlinkMiddleware);

// 原图静态（映射保持不变：/images/<分类>/<文件>）
app.use('/images', express.static(path.join(__dirname, '../images')));

// 缩略图：容器内部生成，不污染 /images；缺失时回源原图
app.use(
  '/thumbs',
  express.static(thumbnailer.config.dir, {
    maxAge: '1h',
    index: false,
    dotfiles: 'ignore',
    fallthrough: true
  })
);
app.get('/thumbs/*', (req, res) => {
  const original = thumbnailer.resolveOriginal(req.params[0]);
  if (!original) return res.status(404).end();
  res.sendFile(original, (e) => {
    if (e && !res.headersSent) res.status(404).end();
  });
});

app.use('/static', express.static(path.join(__dirname, '../static'), { maxAge: '1d' }));

// ============ 公开 API（仅调用：所有人可读取，用于 CDN 引用） ============
app.get('/api/config.json', (req, res) => {
  const settings = store.getSettings();
  res.json({ ...CONFIG, HOTLINK_ENABLED: !!settings.hotlink.enabled });
});

app.get('/api/icons.json', (req, res) => {
  try {
    res.json(getIcons());
  } catch (e) {
    console.error('Error scanning icons:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============ 提交（需 超级管理员 / 上传+调用）：网址 + 接口 ============
const subHits = new Map();
app.post('/api/submissions', (req, res) => {
  // 鉴权：会话 cookie 或 API token（Bearer / ?token=）
  const user = auth.getSessionUser(req) || auth.getUserByApiToken(req);
  if (!user) return res.status(401).json({ error: '请先登录后再提交（或使用 API token）' });
  if (user.role !== 'super' && user.role !== 'uploader') {
    return res.status(403).json({ error: '当前角色（仅调用）无提交权限' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const max = parseInt(process.env.SUBMISSION_RATE_LIMIT || '20', 10);
  const now = Date.now();
  const arr = (subHits.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  arr.push(now);
  subHits.set(ip, arr);
  if (arr.length > max) {
    return res.status(429).json({ error: '提交过于频繁，请稍后再试' });
  }

  const { siteName, siteUrl, apiUrl, contact, note } = req.body || {};
  if (!siteName || !siteUrl || !apiUrl) {
    return res.status(400).json({ error: 'siteName、siteUrl、apiUrl 均为必填' });
  }
  try {
    // eslint-disable-next-line no-new
    new URL(siteUrl);
    new URL(apiUrl);
  } catch {
    return res.status(400).json({ error: 'siteUrl / apiUrl 不是合法 URL' });
  }

  // 去重：同一站点/接口若仍在流转中，直接拒绝重复提交
  const normApi = store.normalizeUrl(apiUrl);
  const normSite = store.normalizeUrl(siteUrl);
  const dup = store.findDuplicate(normApi, normSite);
  if (dup) {
    return res.status(409).json({
      error: '该站点或接口已提交过（状态：' + dup.status + '），请勿重复提交',
      id: dup.id,
      status: dup.status
    });
  }

  const item = store.createSubmission({
    siteName,
    siteUrl,
    apiUrl,
    contact,
    note,
    submittedBy: user.username
  });
  res.status(201).json({ ok: true, id: item.id, status: item.status });
});

// ============ 鉴权 ============
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = users.authenticate(username, password);
  if (!u) return res.status(401).json({ error: '用户名或密码错误，或账号已禁用' });
  const token = auth.createSessionToken(u.username, u.role);
  auth.setSessionCookie(res, token);
  res.json({ ok: true, username: u.username, role: u.role });
});

app.post('/api/admin/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', auth.requireAuth, (req, res) =>
  res.json({ username: req.user.username, role: req.user.role })
);

// 我的提交：超级管理员看全部，其余只看自己
app.get('/api/my/submissions', auth.requireAuth, (req, res) => {
  res.json(store.getMySubmissions(req.user.username, req.user.role === 'super'));
});

// 我的资料（含个人 API token，用于「仅调用 / 上传+调用」程序化接入）
app.get('/api/my/profile', auth.requireAuth, (req, res) => {
  const u = users.getUserByName(req.user.username);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ username: u.username, role: u.role, apiToken: u.apiToken });
});

// ============ 审核（仅超级管理员） ============
app.get('/api/admin/submissions', auth.requireSuper, (req, res) => {
  let list = store.listSubmissions();
  if (req.query.status) list = list.filter((s) => s.status === req.query.status);
  res.json(list);
});

app.get('/api/admin/submissions/:id', auth.requireSuper, (req, res) => {
  const item = store.getSubmission(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

app.post('/api/admin/submissions/:id/approve', auth.requireSuper, (req, res) => {
  const item = store.getSubmission(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (item.status === 'approved') {
    return res.json({ ok: true, already: true, status: item.status, imported: item.imported });
  }
  if (item.status === 'importing') {
    return res.json({ ok: true, already: 'importing', status: item.status });
  }
  // 先立即返回 importing，图标拉取在后台异步完成，避免长请求超时
  store.updateSubmission(item.id, {
    status: 'importing',
    reviewedAt: Date.now(),
    reviewedBy: req.user.username,
    importStartedAt: Date.now()
  });
  res.json({ ok: true, status: 'importing' });

  importer
    .importFromSubmission(item)
    .then((result) => {
      const finalStatus = result.imported === 0 && result.failed.length > 0 ? 'failed' : 'approved';
      store.updateSubmission(item.id, {
        status: finalStatus,
        imported: result,
        importFinishedAt: Date.now()
      });
      if (thumbnailer.isAvailable()) thumbnailer.start();
    })
    .catch((e) => {
      console.error('[import] 异步导入失败:', e);
      store.updateSubmission(item.id, {
        status: 'failed',
        imported: { error: e.message },
        importFinishedAt: Date.now()
      });
    });
});

app.post('/api/admin/submissions/:id/reject', auth.requireSuper, (req, res) => {
  const updated = store.updateSubmission(req.params.id, {
    status: 'rejected',
    reviewedAt: Date.now(),
    reviewedBy: req.user.username,
    rejectReason: (req.body || {}).reason || ''
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/admin/submissions/:id', auth.requireSuper, (req, res) => {
  const ok = store.deleteSubmission(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.get('/api/admin/stats', auth.requireSuper, (req, res) => {
  res.json(store.getStats());
});

app.get('/api/admin/settings', auth.requireSuper, (req, res) => res.json(store.getSettings()));
app.post('/api/admin/settings', auth.requireSuper, (req, res) => {
  const saved = store.saveSettings({ hotlink: (req.body || {}).hotlink });
  res.json(saved);
});

// ============ 分类管理（仅超级管理员） ============
// 注意：文件夹名 = 外链 URL 键（/images/<文件夹>/<文件>），显示名只是展示层
app.get('/api/admin/categories', auth.requireSuper, (req, res) => {
  try {
    const list = getIcons().map((c) => ({
      folder: c.name,
      label: c.label,
      count: c.icons.length
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 修改分类显示名（只改展示层，不影响外链 URL）
app.put('/api/admin/categories/:folder/label', auth.requireSuper, (req, res) => {
  try {
    const meta = categories.setLabel(req.params.folder, (req.body || {}).label);
    res.json({ ok: true, folder: req.params.folder, label: meta.label });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 重命名文件夹（磁盘目录 + 缩略图 + 显示名一起迁移；外链 URL 随之变化）
app.put('/api/admin/categories/:folder/rename', auth.requireSuper, (req, res) => {
  try {
    const r = categories.renameFolder(req.params.folder, ((req.body || {}).newName || '').trim());
    if (thumbnailer.isAvailable()) thumbnailer.start();
    res.json({ ok: true, ...r, warning: '文件夹已重命名，原 /images/' + encodeURIComponent(req.params.folder) + '/… 外链将 404，请更新引用' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 删除分类内的一张图片（原图 + 缩略图）
app.delete('/api/admin/categories/:folder/icons/:file', auth.requireSuper, (req, res) => {
  try {
    res.json(categories.deleteIcon(req.params.folder, req.params.file));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ 用户管理（仅超级管理员） ============
app.get('/api/admin/users', auth.requireSuper, (req, res) => res.json(users.listUsers()));

app.post('/api/admin/users', auth.requireSuper, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名与密码必填' });
  try {
    const u = users.createUser({ username, password, role, createdBy: req.user.username });
    res.status(201).json(u);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/admin/users/:id', auth.requireSuper, (req, res) => {
  const { password, role, enabled } = req.body || {};
  // 不允许把「最后一个启用的超级管理员」降级或禁用
  if (role || enabled === false) {
    const list = users.listUsers();
    const target = list.find((u) => u.id === req.params.id);
    const supers = list.filter((u) => u.role === 'super' && u.enabled);
    if (target && target.role === 'super' && supers.length <= 1) {
      if (role && role !== 'super') return res.status(409).json({ error: '不能降级最后一个超级管理员' });
      if (enabled === false) return res.status(409).json({ error: '不能禁用最后一个超级管理员' });
    }
  }
  try {
    const u = users.updateUser(req.params.id, { password, role, enabled });
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json(u);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/users/:id', auth.requireSuper, (req, res) => {
  const target = users.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (target.username === req.user.username) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }
  const list = users.listUsers();
  if (target.role === 'super' && list.filter((u) => u.role === 'super' && u.enabled).length <= 1) {
    return res.status(409).json({ error: '不能删除最后一个超级管理员' });
  }
  users.deleteUser(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/regenerate-token', auth.requireSuper, (req, res) => {
  const u = users.updateUser(req.params.id, { apiToken: crypto.randomBytes(18).toString('hex') });
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ apiToken: u.apiToken });
});

// ============ 页面 ============
app.get('/', (req, res) => {
  const html = applyHtml(
    fs.readFileSync(path.join(__dirname, '../views/index.html'), 'utf-8'),
    CONFIG
  );
  res.type('html').send(html);
});

app.get('/admin', (req, res) => {
  res.type('html').send(fs.readFileSync(path.join(__dirname, '../views/admin.html'), 'utf-8'));
});

// 友好 404（必须注册在所有路由之后）
app.use((req, res) => {
  if (req.accepts('html')) {
    res
      .status(404)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>404</title>' +
          '<div style="font-family:system-ui;max-width:480px;margin:18vh auto;text-align:center;color:#1f2329">' +
          '<h1>404</h1><p>页面不存在。</p><p><a href="/" style="color:#4f46e5">返回首页</a></p></div>'
      );
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
});

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  未设置 SESSION_SECRET，使用不安全默认密钥；生产环境请在 .env 中设置随机长串。');
}

app.listen(PORT, () => {
  console.log(`icons+ running at http://localhost:${PORT}`);
  console.log(`- Gallery: http://localhost:${PORT}/`);
  console.log(`- Admin:   http://localhost:${PORT}/admin  (default admin / iconsplus)`);
  console.log(`- API:     http://localhost:${PORT}/api/icons.json`);
  thumbnailer.start();
});

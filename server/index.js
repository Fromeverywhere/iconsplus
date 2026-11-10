require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const { getIcons } = require('./services/iconScanner');
const { applyHtml } = require('./services/htmlTemplate');
const thumbnailer = require('./services/thumbnailer');
const auth = require('./services/auth');
const store = require('./services/store');
const importer = require('./services/importer');
const { createHotlinkMiddleware } = require('./services/hotlink');

const app = express();
const PORT = process.env.PORT || 5000;

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

// ============ 公开 API ============
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

// 公开提交（管理员审核）：网址 + 接口
const subHits = new Map();
app.post('/api/submissions', (req, res) => {
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

  const item = store.createSubmission({ siteName, siteUrl, apiUrl, contact, note });
  res.status(201).json({ ok: true, id: item.id, status: item.status });
});

// ============ 管理员 API ============
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!auth.checkCredentials(username, password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = auth.createSessionToken(username);
  auth.setSessionCookie(res, token);
  res.json({ ok: true, username });
});

app.post('/api/admin/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', auth.requireAdmin, (req, res) => res.json({ username: req.admin }));

app.get('/api/admin/submissions', auth.requireAdmin, (req, res) => {
  const status = req.query.status;
  let list = store.listSubmissions();
  if (status) list = list.filter((s) => s.status === status);
  res.json(list);
});

app.get('/api/admin/submissions/:id', auth.requireAdmin, (req, res) => {
  const item = store.getSubmission(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

app.post('/api/admin/submissions/:id/approve', auth.requireAdmin, (req, res) => {
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
    reviewedBy: req.admin,
    importStartedAt: Date.now()
  });
  res.json({ ok: true, status: 'importing' });

  importer
    .importFromSubmission(item)
    .then((result) => {
      const finalStatus =
        result.imported === 0 && result.failed.length > 0 ? 'failed' : 'approved';
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

app.get('/api/admin/stats', auth.requireAdmin, (req, res) => {
  res.json(store.getStats());
});

app.post('/api/admin/submissions/:id/reject', auth.requireAdmin, (req, res) => {
  const updated = store.updateSubmission(req.params.id, {
    status: 'rejected',
    reviewedAt: Date.now(),
    reviewedBy: req.admin,
    rejectReason: (req.body || {}).reason || ''
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/admin/submissions/:id', auth.requireAdmin, (req, res) => {
  const ok = store.deleteSubmission(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.get('/api/admin/settings', auth.requireAdmin, (req, res) => res.json(store.getSettings()));
app.post('/api/admin/settings', auth.requireAdmin, (req, res) => {
  const saved = store.saveSettings({ hotlink: (req.body || {}).hotlink });
  res.json(saved);
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

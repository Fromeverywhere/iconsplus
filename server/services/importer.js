const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const { URL } = require('url');

const IMAGES_DIR = path.join(__dirname, '../../images');
const MAX_ICONS = 100; // 单次导入上限，防止恶意清单拖垮服务
const MAX_BYTES = 2 * 1024 * 1024; // 单图标 2MB 上限
const ALLOWED_EXT = {
  '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.gif': 'gif',
  '.webp': 'webp', '.avif': 'avif', '.svg': 'svg'
};
const FETCH_TIMEOUT = 15000;

// ---- SSRF 防护：拦截私有 / 回环 / 链路本地 / 保留地址 ----
function isPrivateIp(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false; // 仅处理 IPv4；IPv6 字面量另行处理
  const p = ip.split('.').map(Number);
  if (p.some((n) => n > 255)) return true;
  if (p[0] === 10) return true;
  if (p[0] === 127) return true;
  if (p[0] === 0) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] >= 224) return true; // 组播 / 保留
  return false;
}

function dnsLookup(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return reject(err);
      resolve(addresses.map((a) => a.address));
    });
  });
}

async function assertSafeTarget(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('非法 URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https');

  // 仅开发期：允许 localhost / 内网地址（方便本地 mock 接口自测），生产务必删除
  const allowLocal = process.env.ALLOW_LOCAL_IMPORT === '1';

  const hostname = u.hostname;
  // 字面量 IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (!allowLocal && isPrivateIp(hostname)) throw new Error('目标为内网/私有地址，已拦截(SSRF)');
  }
  // IPv6 字面量（含 :: 或冒号）
  if (hostname.includes(':')) {
    if (/^(::1|fe80:|fc|fd)/i.test(hostname) || hostname === '::1') {
      throw new Error('目标为内网/私有地址，已拦截(SSRF)');
    }
  }
  // 解析域名后逐个校验
  try {
    const ips = await dnsLookup(hostname);
    if (!allowLocal && ips.some(isPrivateIp)) throw new Error('目标解析到内网/私有地址，已拦截(SSRF)');
  } catch (e) {
    if (/SSRF/.test(e.message)) throw e;
    // DNS 失败：记录但不放行风险判断交由上层（管理端触发，已 warn）
    console.warn('[importer] DNS 解析失败，谨慎放行:', hostname, e.message);
  }
  return u;
}

// 单层分类名：统一归到 user_<站点>，避免覆盖官方分类，且兼容扫描器（不递归子目录）
function safeCategory(raw) {
  const base = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return ('user_' + (base || 'submitted')).slice(0, 60);
}

function sanitizeName(raw) {
  const cleaned = String(raw || '').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return (cleaned || ('icon_' + crypto.randomBytes(4).toString('hex'))).slice(0, 80);
}

async function downloadIcon(urlStr, destPath) {
  const u = await assertSafeTarget(urlStr);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const resp = await fetch(u.toString(), { signal: ctrl.signal, redirect: 'follow' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('文件过大(>2MB)');
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!/^image\//.test(ct) && !ct.includes('svg')) throw new Error('不是图片(' + ct + ')');
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(destPath, buf);
    return { ok: true, size: buf.length };
  } finally {
    clearTimeout(timer);
  }
}

// 从用户的"接口"拉取清单并导入图标
async function importFromSubmission(submission) {
  const manifestUrl = await assertSafeTarget(submission.apiUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  let manifest;
  try {
    const resp = await fetch(manifestUrl.toString(), { signal: ctrl.signal, redirect: 'follow' });
    if (!resp.ok) throw new Error('清单接口 HTTP ' + resp.status);
    manifest = await resp.json();
  } finally {
    clearTimeout(timer);
  }

  const icons = Array.isArray(manifest) ? manifest : (manifest.icons || []);
  const category = safeCategory(manifest.category || submission.siteName);
  const limited = icons.slice(0, MAX_ICONS);

  const result = { category, total: limited.length, imported: 0, failed: [] };
  for (const item of limited) {
    let name, url;
    if (typeof item === 'string') {
      url = item;
      name = null;
    } else {
      url = item.url;
      name = item.name;
    }
    if (!url) {
      result.failed.push({ url: String(item), error: '缺少 url' });
      continue;
    }
    let resolved;
    try {
      resolved = new URL(url, manifestUrl);
    } catch {
      result.failed.push({ url, error: '非法图标 URL' });
      continue;
    }
    const ext = path.extname(resolved.pathname).toLowerCase();
    const finalExt = ALLOWED_EXT[ext] ? ext : '.png';
    const baseName = name
      ? sanitizeName(name)
      : sanitizeName(path.basename(resolved.pathname, ext));
    const dest = path.join(IMAGES_DIR, category, baseName + finalExt);
    try {
      await downloadIcon(resolved.toString(), dest);
      result.imported++;
    } catch (e) {
      result.failed.push({ url, error: e.message });
    }
  }
  return result;
}

module.exports = { importFromSubmission, assertSafeTarget, safeCategory, MAX_ICONS };

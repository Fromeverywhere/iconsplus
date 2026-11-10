const crypto = require('crypto');

function getSecret() {
  return process.env.SESSION_SECRET || 'insecure-dev-secret-change-me';
}

function sign(payloadStr) {
  return crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('base64url');
}

function createSessionToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // 7 天过期
    if (data.t && Date.now() - data.t > 7 * 24 * 3600 * 1000) return null;
    return data.u;
  } catch {
    return null;
  }
}

function checkCredentials(username, password) {
  const u = process.env.ADMIN_USERNAME || 'admin';
  const p = process.env.ADMIN_PASSWORD || 'iconsplus';
  return username === u && password === p;
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((p) => {
    const idx = p.indexOf('=');
    if (idx > -1) {
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function setSessionCookie(res, token) {
  const maxAge = 7 * 24 * 3600;
  res.setHeader('Set-Cookie',
    `iconsplus_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    'iconsplus_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const username = verifySessionToken(cookies.iconsplus_session);
  if (!username) return res.status(401).json({ error: '未登录或会话已过期' });
  req.admin = username;
  next();
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  checkCredentials,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
  parseCookies
};

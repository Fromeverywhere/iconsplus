const crypto = require('crypto');
const users = require('./users');

function getSecret() {
  return process.env.SESSION_SECRET || 'insecure-dev-secret-change-me';
}

function sign(payloadStr) {
  return crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('base64url');
}

function createSessionToken(username, role) {
  const payload = Buffer.from(JSON.stringify({ u: username, r: role, t: Date.now() })).toString('base64url');
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
    return { username: data.u, role: data.r };
  } catch {
    return null;
  }
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

// 从会话 cookie 取当前用户（含 role），无则返回 null
function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies.iconsplus_session);
}

// 从 Bearer token 或 ?token= 取用户（用于程序化「调用 / 上传」）
function getUserByApiToken(req) {
  let token = null;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
  if (!token && req.query && req.query.token) token = String(req.query.token);
  if (!token) return null;
  return users.getUserByToken(token);
}

// 任意已登录用户
function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: '未登录或会话已过期' });
  req.user = user;
  next();
}

// 指定角色之一（缺省即仅要求登录）
function requireRole(...roles) {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: '未登录或会话已过期' });
    req.user = user;
    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ error: '权限不足（需要角色：' + roles.join('/') + '）' });
    }
    next();
  };
}

const requireSuper = requireRole('super');

module.exports = {
  createSessionToken,
  verifySessionToken,
  getSessionUser,
  getUserByApiToken,
  requireAuth,
  requireRole,
  requireSuper,
  setSessionCookie,
  clearSessionCookie,
  parseCookies
};

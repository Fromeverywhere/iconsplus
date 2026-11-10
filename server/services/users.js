const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const ROLES = ['super', 'uploader', 'viewer'];
const ROLE_LABEL = { super: '超级管理员', uploader: '上传+调用', viewer: '仅调用' };

// ---------- 密码哈希（scrypt + 随机盐） ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${h}`;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const check = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(18).toString('hex');
}

function makeUser(username, password, role, createdBy) {
  return {
    id: crypto.randomUUID(),
    username,
    pwHash: hashPassword(password),
    role,
    apiToken: newToken(),
    enabled: true,
    createdAt: Date.now(),
    createdBy: createdBy || 'system',
    updatedAt: Date.now()
  };
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    // 首次运行：用环境变量种子一个超级管理员（默认 admin / iconsplus）
    const username = (process.env.ADMIN_USERNAME || 'admin').trim();
    const password = process.env.ADMIN_PASSWORD || 'iconsplus';
    const u = makeUser(username, password, 'super', 'system-seed');
    fs.writeFileSync(USERS_FILE, JSON.stringify([u], null, 2));
  }
}

function readUsers() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2));
}

// 返回不含 pwHash 的安全视图
function publicView(u) {
  if (!u) return null;
  const { pwHash, ...rest } = u;
  return rest;
}

function listUsers() {
  return readUsers().map(publicView);
}

function getUserById(id) {
  return publicView(readUsers().find((u) => u.id === id));
}

function getUserByName(username) {
  return publicView(readUsers().find((u) => u.username === username));
}

function getUserByToken(token) {
  if (!token) return null;
  return publicView(readUsers().find((u) => u.enabled && u.apiToken === token));
}

function authenticate(username, password) {
  const u = readUsers().find((x) => x.username === username && x.enabled);
  if (!u) return null;
  if (!verifyPassword(password, u.pwHash)) return null;
  return publicView(u);
}

function createUser({ username, password, role, createdBy }) {
  username = String(username || '').trim();
  password = String(password || '');
  role = String(role || 'viewer');
  if (username.length < 2) throw new Error('用户名至少 2 个字符');
  if (password.length < 4) throw new Error('密码至少 4 个字符');
  if (!ROLES.includes(role)) throw new Error('角色非法');
  const list = readUsers();
  if (list.some((u) => u.username === username)) throw new Error('用户名已存在');
  const u = makeUser(username, password, role, createdBy);
  list.push(u);
  writeUsers(list);
  return publicView(u);
}

function updateUser(id, patch) {
  const list = readUsers();
  const idx = list.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  const u = list[idx];
  if (patch.password) {
    if (String(patch.password).length < 4) throw new Error('密码至少 4 个字符');
    u.pwHash = hashPassword(patch.password);
  }
  if (patch.role && ROLES.includes(patch.role)) u.role = patch.role;
  if (typeof patch.enabled === 'boolean') u.enabled = patch.enabled;
  if (patch.apiToken) u.apiToken = patch.apiToken;
  u.updatedAt = Date.now();
  list[idx] = u;
  writeUsers(list);
  return publicView(u);
}

function deleteUser(id) {
  const list = readUsers();
  const next = list.filter((u) => u.id !== id);
  if (next.length === list.length) return false;
  writeUsers(next);
  return true;
}

module.exports = {
  ROLES,
  ROLE_LABEL,
  ensure,
  listUsers,
  getUserById,
  getUserByName,
  getUserByToken,
  authenticate,
  createUser,
  updateUser,
  deleteUser,
  publicView
};

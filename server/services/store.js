const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getIcons } = require('./iconScanner');

const DATA_DIR = path.join(__dirname, '../../data');
const SUB_FILE = path.join(DATA_DIR, 'submissions.json');
const SET_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  hotlink: {
    enabled: process.env.HOTLINK_ENABLED !== 'false',
    allowlist: (process.env.HOTLINK_ALLOWLIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    denylist: (process.env.HOTLINK_DENYLIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    allowEmptyReferer: (process.env.HOTLINK_ALLOW_EMPTY_REFERER || 'true') !== 'false'
  }
};

// 仍处于流转中的状态：这些状态不允许重复提交
const ACTIVE_STATUSES = ['pending', 'importing', 'approved'];

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SUB_FILE)) fs.writeFileSync(SUB_FILE, '[]');
  if (!fs.existsSync(SET_FILE)) fs.writeFileSync(SET_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// 规范化 URL，用于去重：小写 host、去尾斜杠、去 fragment、去掉默认端口
function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }
    return u.toString();
  } catch {
    return String(raw || '').trim().toLowerCase();
  }
}

function listSubmissions() {
  ensure();
  return readJson(SUB_FILE, []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getSubmission(id) {
  ensure();
  return readJson(SUB_FILE, []).find((s) => s.id === id);
}

// 去重：同一站点或接口若仍处于流转状态，则不允许多次提交
function findDuplicate(normApi, normSite) {
  ensure();
  return (
    readJson(SUB_FILE, []).find((s) => {
      if (!ACTIVE_STATUSES.includes(s.status)) return false;
      return s.normApiUrl === normApi || s.normSiteUrl === normSite;
    }) || null
  );
}

function createSubmission(data) {
  ensure();
  const list = readJson(SUB_FILE, []);
  const item = {
    id: crypto.randomUUID(),
    siteName: String(data.siteName || '').trim(),
    siteUrl: String(data.siteUrl || '').trim(),
    apiUrl: String(data.apiUrl || '').trim(),
    normSiteUrl: normalizeUrl(data.siteUrl),
    normApiUrl: normalizeUrl(data.apiUrl),
    contact: String(data.contact || '').trim(),
    note: String(data.note || '').trim(),
    submittedBy: String(data.submittedBy || '').trim() || null,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reviewedAt: null,
    reviewedBy: null,
    imported: null,
    rejectReason: null,
    importStartedAt: null,
    importFinishedAt: null
  };
  list.push(item);
  writeJson(SUB_FILE, list);
  return item;
}

function updateSubmission(id, patch) {
  ensure();
  const list = readJson(SUB_FILE, []);
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, id, updatedAt: Date.now() };
  writeJson(SUB_FILE, list);
  return list[idx];
}

function deleteSubmission(id) {
  ensure();
  const list = readJson(SUB_FILE, []);
  const next = list.filter((s) => s.id !== id);
  writeJson(SUB_FILE, next);
  return list.length !== next.length;
}

// 我的提交：普通用户只看自己的；超级管理员传 includeAll=true 看全部
function getMySubmissions(username, includeAll) {
  const list = listSubmissions();
  if (includeAll) return list;
  return list.filter((s) => s.submittedBy === username);
}

function getStats() {
  const list = listSubmissions();
  const byStatus = {};
  let importedIconsTotal = 0;
  list.forEach((s) => {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    if (s.imported && typeof s.imported === 'object' && typeof s.imported.imported === 'number') {
      importedIconsTotal += s.imported.imported;
    }
  });
  let categories = 0;
  try {
    categories = getIcons().length;
  } catch {
    categories = 0;
  }
  return { total: list.length, byStatus, importedIconsTotal, categories };
}

function getSettings() {
  ensure();
  const stored = readJson(SET_FILE, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    hotlink: { ...DEFAULT_SETTINGS.hotlink, ...(stored.hotlink || {}) }
  };
}

function saveSettings(patch) {
  ensure();
  const cur = getSettings();
  if (patch && patch.hotlink) cur.hotlink = { ...cur.hotlink, ...patch.hotlink };
  writeJson(SET_FILE, cur);
  return cur;
}

module.exports = {
  listSubmissions,
  getSubmission,
  findDuplicate,
  normalizeUrl,
  createSubmission,
  updateSubmission,
  deleteSubmission,
  getMySubmissions,
  getStats,
  getSettings,
  saveSettings
};

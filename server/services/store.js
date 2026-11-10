const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    allowEmptyReferer: (process.env.HOTLINK_ALLOW_EMPTY_REFERER || 'true') !== 'false'
  }
};

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

function listSubmissions() {
  ensure();
  return readJson(SUB_FILE, []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getSubmission(id) {
  ensure();
  return readJson(SUB_FILE, []).find((s) => s.id === id);
}

function createSubmission(data) {
  ensure();
  const list = readJson(SUB_FILE, []);
  const item = {
    id: crypto.randomUUID(),
    siteName: String(data.siteName || '').trim(),
    siteUrl: String(data.siteUrl || '').trim(),
    apiUrl: String(data.apiUrl || '').trim(),
    contact: String(data.contact || '').trim(),
    note: String(data.note || '').trim(),
    status: 'pending',
    createdAt: Date.now(),
    reviewedAt: null,
    reviewedBy: null,
    imported: null,
    rejectReason: null
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
  list[idx] = { ...list[idx], ...patch, id };
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
  createSubmission,
  updateSubmission,
  deleteSubmission,
  getSettings,
  saveSettings
};

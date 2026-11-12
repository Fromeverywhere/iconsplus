'use strict';

/**
 * 分类元数据服务：把「分类显示名」与「图片文件夹名」解耦。
 *
 * - 文件夹名 = images/ 下的真实目录名，同时是外链 URL 的一部分
 *   （映射红线：/images/<文件夹名>/<文件名>，永不改变这个规则）。
 * - 显示名（label）仅用于前台/后台展示，可随意中文命名，存 data/categories.json。
 * - 支持重命名文件夹（会同时迁移缩略图目录，并提示外链 URL 随之变化）。
 */

const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '../../images');
const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'categories.json');

let thumbDir = null;
try {
  thumbDir = require('./thumbnailer').config.dir;
} catch (_) {
  thumbDir = path.join(__dirname, '../../.thumbs');
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
}

function readMap() {
  ensure();
  try {
    const m = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  ensure();
  fs.writeFileSync(DATA_FILE, JSON.stringify(map, null, 2));
}

// 文件夹名白名单：字母/数字/中文/下划线/中划线，1-64 位；不允许点开头（防 .hidden、防 .. 穿越）
function isValidFolderName(name) {
  return (
    typeof name === 'string' &&
    /^[\p{L}\p{N}_\-]{1,64}$/u.test(name) &&
    !name.startsWith('.')
  );
}

function folderExistsOnDisk(name) {
  if (!isValidFolderName(name)) return false;
  const p = path.join(IMAGES_DIR, name);
  return p.startsWith(IMAGES_DIR + path.sep) && fs.existsSync(p) && fs.statSync(p).isDirectory();
}

/** 修改显示名（不动文件夹，不影响外链 URL） */
function setLabel(folder, label) {
  if (!folderExistsOnDisk(folder)) throw new Error('分类文件夹不存在：' + folder);
  const clean = String(label || '').trim();
  if (!clean || clean.length > 40) throw new Error('显示名需为 1-40 个字符');
  const map = readMap();
  map[folder] = Object.assign({}, map[folder], { label: clean });
  writeMap(map);
  return map[folder];
}

/** 重命名文件夹（磁盘目录 + 缩略图目录 + 元数据一起迁移；外链 URL 会随之变化） */
function renameFolder(oldName, newName) {
  if (!folderExistsOnDisk(oldName)) throw new Error('分类文件夹不存在：' + oldName);
  if (!isValidFolderName(newName)) {
    throw new Error('新文件夹名只能包含中文、字母、数字、下划线、中划线（1-64 位），且不能以点开头');
  }
  if (newName === oldName) throw new Error('新名称与当前名称相同');
  if (folderExistsOnDisk(newName) || fs.existsSync(path.join(IMAGES_DIR, newName))) {
    throw new Error('已存在同名文件夹：' + newName);
  }

  const oldDir = path.join(IMAGES_DIR, oldName);
  const newDir = path.join(IMAGES_DIR, newName);
  fs.renameSync(oldDir, newDir);

  // 缩略图目录同步迁移（manifest 键不含目录名时会由缩略图对账逻辑自愈，best-effort 即可）
  try {
    const oldThumb = path.join(thumbDir, oldName);
    if (fs.existsSync(oldThumb)) fs.renameSync(oldThumb, path.join(thumbDir, newName));
  } catch (_) {
    /* 缩略图迁移失败不致命：对账逻辑会自动重建 */
  }

  // 元数据迁移：保留显示名与排序
  const map = readMap();
  const meta = map[oldName];
  if (meta) {
    delete map[oldName];
    map[newName] = meta;
    writeMap(map);
  }
  return { folder: newName, label: (meta && meta.label) || newName };
}

/** 删除分类内的一张图片（原图 + 对应缩略图 best-effort） */
function deleteIcon(folder, file) {
  if (!folderExistsOnDisk(folder)) throw new Error('分类文件夹不存在：' + folder);
  if (typeof file !== 'string' || file.includes('/') || file.includes('\\') || file.includes('..')) {
    throw new Error('非法文件名');
  }
  const imgPath = path.join(IMAGES_DIR, folder, file);
  if (!imgPath.startsWith(path.join(IMAGES_DIR, folder) + path.sep) || !fs.existsSync(imgPath)) {
    throw new Error('图片不存在：' + folder + '/' + file);
  }
  fs.rmSync(imgPath, { force: true });
  // 缩略图：/thumbs/<folder>/<file>.webp，best-effort（对账逻辑也会兜底清理）
  try {
    const thumbPath = path.join(thumbDir, folder, file + '.webp');
    if (thumbPath.startsWith(path.join(thumbDir, folder) + path.sep) && fs.existsSync(thumbPath)) {
      fs.rmSync(thumbPath, { force: true });
    }
  } catch (_) {}
  return { ok: true, folder, file };
}

module.exports = { ensure, readMap, setLabel, renameFolder, deleteIcon, isValidFolderName };

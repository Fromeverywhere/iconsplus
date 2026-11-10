'use strict';

/**
 * 缩略图服务（仅 Docker / Node 服务端使用，静态 Pages 部署不加载本模块）
 *
 * 原图目录：  /app/images（可能是 bind mount，路径保持项目原有约定，绝不改动）
 * 缩略图目录：THUMB_DIR，容器内默认 /app/thumbs，本地默认 .thumbs/
 *             刻意放在 images 之外，既不污染宿主机图标库，也不会被挂载覆盖。
 *
 * 命名规则：<THUMB_DIR>/<分类>/<原文件名>.webp
 *   例：images/ai/ChatGPT.png  ->  thumbs/ai/ChatGPT.png.webp
 *   保留原扩展名可避免 "a.png 与 a.webp" 这类重名冲突，且 .webp 后缀让 MIME 正确。
 *
 * 对账逻辑（每次扫库都跑，但只处理差异，成本很低）：
 *   - 新增原图 / 原图内容变化（size + mtime 变化）-> 生成或覆盖缩略图
 *   - 原图被删除 -> 删除对应缩略图，并清理空目录
 *   - THUMB_SIZE / THUMB_QUALITY 改变 -> 全量重建
 *   - .manifest.json 记录每个原图生成时的 size/mtime，避免重复编码与反复重试坏图
 *
 * 触发方式：Docker 启动时全量扫库（thumbnail-cli.js）+ fs.watch 目录监控 + 定时扫库兜底。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const IMAGES_DIR = path.resolve(__dirname, '../../images');
const SUPPORTED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif']);
const THUMB_SUFFIX = '.webp';
const MANIFEST_FILE = '.manifest.json';
const MANIFEST_VERSION = 1;
const TMP_PREFIX = '.tmp-';

function envBool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || String(raw).trim() === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function envInt(name, fallback, min, max) {
    const raw = process.env[name];
    if (raw === undefined || String(raw).trim() === '') return fallback;
    const value = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

const config = Object.freeze({
    // 总开关：关闭后前端自动回退到原图，/thumbs 也会兜底转发原图
    enabled: envBool('THUMB_ENABLED', true),
    // 目录监控开关（Docker Desktop 的 bind mount 常收不到 inotify 事件，靠定时扫库兜底）
    watch: envBool('THUMB_WATCH', true),
    // 定时全量扫库间隔（秒），0 = 关闭；只靠目录监控时可设 0
    scanIntervalSec: envInt('THUMB_SCAN_INTERVAL', 300, 0, 86400),
    // 目录监控防抖（毫秒）：批量拖入文件、编辑器原子替换时避免频繁触发
    debounceMs: envInt('THUMB_WATCH_DEBOUNCE', 1200, 100, 60000),
    dir: path.resolve(process.env.THUMB_DIR || path.join(__dirname, '../../.thumbs')),
    // 卡片实际显示 52px，128 足够覆盖 2x 高清屏
    size: envInt('THUMB_SIZE', 128, 32, 1024),
    quality: envInt('THUMB_QUALITY', 75, 10, 100),
    concurrency: envInt('THUMB_CONCURRENCY', Math.min(4, Math.max(2, os.cpus().length)), 1, 16)
});

// sharp 是可选能力：镜像里若没装成功，整个缩略图功能优雅关闭，站点仍按原图正常工作
let sharp = null;
let sharpError = null;
try {
    sharp = require('sharp');
} catch (error) {
    sharpError = error;
}

function isEnabled() { return config.enabled; }
function isAvailable() { return config.enabled && sharp !== null; }
function getConfig() { return config; }
function getImagesDir() { return IMAGES_DIR; }

function getUnavailableReason() {
    if (!config.enabled) return 'THUMB_ENABLED=false';
    if (!sharp) return 'sharp module unavailable: ' + (sharpError ? sharpError.message : 'unknown error');
    return '';
}

function log(...args) { console.log('[thumbs]', ...args); }
function warn(...args) { console.warn('[thumbs]', ...args); }

function thumbPathFor(sourceRel) {
    return path.join(config.dir, sourceRel + THUMB_SUFFIX);
}

/** 把 /thumbs/xx/yy.png.webp 还原成 /app/images/xx/yy.png，含目录穿越防护。 */
function resolveOriginal(thumbRel) {
    if (!thumbRel || !thumbRel.toLowerCase().endsWith(THUMB_SUFFIX)) return null;
    const sourceRel = thumbRel.slice(0, -THUMB_SUFFIX.length);
    if (!SUPPORTED_EXT.has(path.extname(sourceRel).toLowerCase())) return null;
    if (sourceRel.includes('\0')) return null;

    const abs = path.resolve(IMAGES_DIR, sourceRel);
    if (!abs.startsWith(IMAGES_DIR + path.sep)) return null;
    return abs;
}

/** 扫描原图目录（与 iconScanner.js 一致：只认一级分类目录下的图片文件） */
async function collectSources() {
    const sources = new Map();

    let categories;
    try {
        categories = await fsp.readdir(IMAGES_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return sources;
        throw error;
    }

    for (const category of categories) {
        if (!category.isDirectory() || category.name.startsWith('.')) continue;
        const categoryPath = path.join(IMAGES_DIR, category.name);

        let files;
        try {
            files = await fsp.readdir(categoryPath, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const file of files) {
            if (!file.isFile()) continue;
            if (!SUPPORTED_EXT.has(path.extname(file.name).toLowerCase())) continue;

            const srcPath = path.join(categoryPath, file.name);
            try {
                const stat = await fsp.stat(srcPath);
                sources.set(`${category.name}/${file.name}`, {
                    srcPath,
                    mtimeMs: stat.mtimeMs,
                    size: stat.size
                });
            } catch {
                // 文件可能正在写入或刚被删除，留到下一轮
            }
        }
    }

    return sources;
}

/** 扫描缩略图目录，返回已生成的缩略图与残留临时文件 */
async function collectThumbs() {
    const thumbs = [];
    const temps = [];
    const directories = [];

    async function walk(dir, prefix) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                directories.push(abs);
                await walk(abs, rel);
            } else if (entry.isFile()) {
                if (entry.name.startsWith(TMP_PREFIX)) temps.push(abs);
                else if (entry.name.toLowerCase().endsWith(THUMB_SUFFIX)) thumbs.push({ abs, rel });
            }
        }
    }

    await walk(config.dir, '');
    return { thumbs, temps, directories };
}

async function readManifest() {
    const empty = {
        version: MANIFEST_VERSION,
        size: config.size,
        quality: config.quality,
        files: {}
    };

    try {
        const parsed = JSON.parse(await fsp.readFile(path.join(config.dir, MANIFEST_FILE), 'utf8'));
        if (parsed && parsed.version === MANIFEST_VERSION && parsed.files && typeof parsed.files === 'object') {
            return parsed;
        }
    } catch {
        // 缺失或损坏都当作首次生成
    }
    return empty;
}

async function writeManifest(manifest) {
    const target = path.join(config.dir, MANIFEST_FILE);
    const tmp = path.join(config.dir, `${TMP_PREFIX}manifest-${process.pid}-${Date.now()}`);
    await fsp.writeFile(tmp, JSON.stringify(manifest));
    await fsp.rename(tmp, target);
}

/** 单张图编码：原子写入临时文件再改名，避免扫库期间读到半成品 */
async function generate(sourceRel, source) {
    const target = thumbPathFor(sourceRel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = path.join(path.dirname(target), `${TMP_PREFIX}${process.pid}-${Math.random().toString(36).slice(2)}`);

    try {
        await sharp(source.srcPath, { density: 96, failOn: 'none' })
            .rotate()
            .resize(config.size, config.size, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: config.quality, alphaQuality: Math.min(100, config.quality + 10), effort: 4 })
            .toFile(tmp);
        await fsp.rename(tmp, target);
    } catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw error;
    }
}

/** 限制并发，避免启动扫库一次把 CPU / 内存打满 */
async function runPool(tasks, limit) {
    let cursor = 0;
    const worker = async () => {
        while (true) {
            const index = cursor++;
            if (index >= tasks.length) return;
            const task = tasks[index];
            try {
                await task.run();
                task.onDone();
            } catch (error) {
                task.onError(error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

let syncPromise = null;
let watcher = null;
let scanTimer = null;
let debounceTimer = null;

/**
 * 全量对账（增量执行）：补齐缺失、重建变更、删除孤儿。
 * 并发调用会合并为同一次执行，避免 watch 与定时器互相打架。
 */
function sync() {
    if (syncPromise) return syncPromise;
    syncPromise = doSync().finally(() => { syncPromise = null; });
    return syncPromise;
}

async function doSync() {
    const started = Date.now();
    const stats = {
        enabled: isAvailable(),
        sources: 0,
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: 0,
        failed: 0,
        errors: [],
        ms: 0
    };

    if (!isAvailable()) {
        warn('sync skipped:', getUnavailableReason());
        return stats;
    }

    await fsp.mkdir(config.dir, { recursive: true });

    const [sources, thumbState, manifest] = await Promise.all([
        collectSources(),
        collectThumbs(),
        readManifest()
    ]);
    stats.sources = sources.size;

    // 生成参数变了，旧缩略图全部作废（下一轮覆盖写，不会留下垃圾）
    const paramsChanged = manifest.size !== config.size || manifest.quality !== config.quality;
    if (paramsChanged) manifest.files = {};

    const existingThumbs = new Set(thumbState.thumbs.map(item => item.rel));
    const tasks = [];

    for (const [sourceRel, source] of sources) {
        const entry = manifest.files[sourceRel];
        const sameSource = entry && entry.m === source.mtimeMs && entry.s === source.size;
        const thumbExists = existingThumbs.has(sourceRel + THUMB_SUFFIX);

        if (sameSource && !entry.failed && thumbExists) {
            stats.unchanged++;
            continue;
        }
        if (sameSource && entry.failed) {
            // 之前编码失败的文件不反复重试，等原图变化再说（前端会自动兜底到原图）
            stats.unchanged++;
            continue;
        }

        if (thumbExists) stats.updated++;
        else stats.added++;

        tasks.push({
            run: () => generate(sourceRel, source),
            onDone: () => { manifest.files[sourceRel] = { m: source.mtimeMs, s: source.size }; },
            onError: (error) => {
                stats.failed++;
                if (stats.errors.length < 10) stats.errors.push(`${sourceRel}: ${error.message}`);
                manifest.files[sourceRel] = { m: source.mtimeMs, s: source.size, failed: true };
            }
        });
    }

    // 原图已删除的缩略图：一并删掉，避免占用无限膨胀
    const removedDirs = new Set();
    for (const thumb of thumbState.thumbs) {
        const sourceRel = thumb.rel.slice(0, -THUMB_SUFFIX.length);
        if (sources.has(sourceRel)) continue;
        try {
            await fsp.rm(thumb.abs, { force: true });
            stats.removed++;
            removedDirs.add(path.dirname(thumb.abs));
        } catch {
            // 忽略，下一轮再试
        }
        delete manifest.files[sourceRel];
    }

    // manifest 中残留的、原图已不存在的条目
    for (const key of Object.keys(manifest.files)) {
        if (!sources.has(key)) delete manifest.files[key];
    }

    // 清掉残留临时文件 + 变空的分类目录
    for (const tmp of thumbState.temps) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
    }
    for (const dir of [...removedDirs, ...thumbState.directories]) {
        await fsp.rmdir(dir).catch(() => {});
    }

    if (tasks.length) {
        await runPool(tasks, config.concurrency);
    }

    manifest.version = MANIFEST_VERSION;
    manifest.size = config.size;
    manifest.quality = config.quality;
    await writeManifest(manifest);

    stats.ms = Date.now() - started;
    if (tasks.length || stats.removed || stats.failed) {
        log(`sync: ${stats.sources} sources, +${stats.added} ~${stats.updated} -${stats.removed}, ` +
            `${stats.unchanged} unchanged, ${stats.failed} failed (${stats.ms}ms)`);
        for (const message of stats.errors) warn('  ', message);
    } else {
        log(`sync: ${stats.sources} sources, all up to date (${stats.ms}ms)`);
    }

    return stats;
}

function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        sync().catch(error => warn('sync failed:', error.message));
    }, config.debounceMs);
    if (debounceTimer.unref) debounceTimer.unref();
}

/** 服务进程启动时调用：立即对账一次 + 开启监控与定时扫库（不阻塞 HTTP 监听） */
function start() {
    if (!isAvailable()) {
        warn('disabled:', getUnavailableReason(), '- serving original images instead');
        return false;
    }

    log(`enabled: dir=${config.dir} size=${config.size} quality=${config.quality} ` +
        `watch=${config.watch} interval=${config.scanIntervalSec}s`);

    sync().catch(error => warn('initial sync failed:', error.message));

    if (config.watch) {
        try {
            watcher = fs.watch(IMAGES_DIR, { recursive: true }, () => scheduleSync());
            log('watching', IMAGES_DIR);
        } catch (error) {
            watcher = null;
            warn('fs.watch unavailable (' + error.message + '); periodic scan will be used');
        }
    }

    if (config.scanIntervalSec > 0) {
        scanTimer = setInterval(() => {
            sync().catch(error => warn('periodic sync failed:', error.message));
        }, config.scanIntervalSec * 1000);
        if (scanTimer.unref) scanTimer.unref();
        log(`periodic scan every ${config.scanIntervalSec}s`);
    } else if (!watcher) {
        warn('both watcher and periodic scan are off; run thumbnail-cli.js manually after changing icons');
    }

    return true;
}

function stop() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (scanTimer) clearInterval(scanTimer);
    if (watcher) watcher.close();
    debounceTimer = null;
    scanTimer = null;
    watcher = null;
}

module.exports = {
    config,
    IMAGES_DIR,
    isEnabled,
    isAvailable,
    getUnavailableReason,
    resolveOriginal,
    sync,
    start,
    stop
};

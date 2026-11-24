/**
 * icons+ 调用侧适配文件
 * ------------------------------------------------------------------
 * 作用：调用方前端只写网址或一级域名，由本文件拼出 icons+ 的完整调用链接。
 *      不适配的调用方仍可手动拼明文长 URL，两者完全兼容。
 *
 * 使用三步：
 *   1. 在调用方后台「icons+ 适配栏」配置：域名(base)、前缀路径(apiPath)、token
 *   2. 把配置注入到前端（三种方式任选，见 README.md）
 *   3. 业务代码：IconPlus.icon('https://www.bilibili.com/video/xx') → 完整 URL
 *
 * 1.1.0 新增：
 *   - icon() 自动从完整网址提取一级域名（eTLD+1），调用方只需一个输入框
 *   - resolveAsync() / warm()：拉取签名直链并缓存到 localStorage，
 *     之后 <img> 直连 CDN 一跳命中，消除「302 两跳 → 空白跳一下」
 *   - diagnose()：真实跑一次调用并返回诊断（token 归属用户名、来源域名/IP、白名单命中、该加哪条）
 *
 * 依赖：无。ES5 语法，UMD 包装，浏览器 / CommonJS / ESM 均可。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.IconPlus = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var _cfg = {
    base: '',                 // icons+ 服务域名，如 https://icons.325hub.top（不带尾斜杠）
    apiPath: '/api/icon',     // 前缀路径，默认 /api/icon；改部署路径时只改这里
    token: '',                // 调用 Token（只读取自调用方后台配置）
    urlParam: 'url',          // 域名参数名，一般不用改
    tokenParam: 'token',      // token 参数名，一般不用改
    format: '',               // 可选：优先格式（如 svg），找不到该格式时自动回退其他格式
    formatParam: 'format',    // 优先格式参数名，一般不用改
    fallback: '',             // 可选：识别失败时的兜底图 URL（留空则用 icons+ 官方兜底）
    cacheEnabled: true,       // 是否缓存签名直链到 localStorage（消除闪烁的关键）
    cacheTtl: 6 * 3600 * 1000,// 缓存有效期；改了域名默认图标后可清缓存或等过期
    autoResolve: true,        // applyTo() 是否自动异步预热直链
    placeholder: ''           // 可选：加载中的占位图 data URI；留空用内置灰色圆
  };

  // 与服务端 iconResolver.parseTarget 保持一致的常见二级后缀
  var SECOND_LEVEL_SUFFIXES = {
    'co.uk': 1, 'org.uk': 1, 'ac.uk': 1, 'gov.uk': 1, 'me.uk': 1,
    'com.cn': 1, 'net.cn': 1, 'org.cn': 1, 'gov.cn': 1, 'edu.cn': 1, 'ac.cn': 1,
    'com.au': 1, 'net.au': 1, 'org.au': 1, 'edu.au': 1, 'co.nz': 1, 'co.jp': 1, 'ne.jp': 1, 'or.jp': 1,
    'co.kr': 1, 'com.br': 1, 'com.mx': 1, 'com.ar': 1, 'co.in': 1, 'com.sg': 1, 'com.hk': 1, 'com.tw': 1,
    'co.za': 1, 'com.tr': 1, 'com.ua': 1, 'com.pl': 1, 'co.il': 1, 'com.sa': 1, 'co.id': 1, 'com.vn': 1,
    'github.io': 1, 'gitlab.io': 1, 'pages.dev': 1, 'vercel.app': 1, 'netlify.app': 1,
    'blogspot.com': 1, 'wordpress.com': 1, 'weebly.com': 1, 'wixsite.com': 1
  };

  var _memCache = {}; // localStorage 不可用时的内存兜底

  function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

  /** 注入配置。可传完整对象或只传要改的字段（增量合并）。 */
  function configure(opts) {
    if (!opts || typeof opts !== 'object') return api;
    for (var k in opts) {
      if (Object.prototype.hasOwnProperty.call(opts, k) && Object.prototype.hasOwnProperty.call(_cfg, k)) {
        _cfg[k] = opts[k];
      }
    }
    _cfg.base = trimSlash(_cfg.base);
    // 调用方只填一个 URL 即可：若 base 自带 /api/... 路径，且未显式指定 apiPath，自动拆出来
    if (!opts.apiPath) {
      var m = String(_cfg.base).match(/^(https?:\/\/[^/]+)(\/api\/[^?]*)\/?$/i);
      if (m) { _cfg.base = m[1]; _cfg.apiPath = m[2].replace(/\/+$/, ''); }
    }
    if (_cfg.apiPath && _cfg.apiPath.charAt(0) !== '/') _cfg.apiPath = '/' + _cfg.apiPath;
    return api;
  }

  /** 从 <meta name="iconsplus-config" content='{"base":"...","token":"..."}'> 读取配置 */
  function configureFromMeta() {
    if (typeof document === 'undefined') return api;
    var el = document.querySelector('meta[name="iconsplus-config"]');
    if (el && el.getAttribute('content')) {
      try { configure(JSON.parse(el.getAttribute('content'))); } catch (e) { /* 忽略坏配置 */ }
    }
    return api;
  }

  /** 从全局变量读取配置（SSR 注入场景） */
  function configureFromGlobal(globalName) {
    var g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    var cfg = g[globalName || 'ICONSPLUS_CONFIG'];
    if (cfg && typeof cfg === 'object') configure(cfg);
    return api;
  }

  function ready() { return !!(_cfg.base && _cfg.token); }

  /** 从任意字符串（完整网址 / 裸域名 / 带路径 / host:port）提取一级域名 eTLD+1。
   *  与 icons+ 服务端 parseTarget 同规则；IP / 异常输入原样返回。 */
  function extractDomain(input) {
    var s = String(input || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    var host = '';
    try {
      host = new URL(s).hostname.toLowerCase();
    } catch (e) {
      var m = s.match(/^[a-z]+:\/\/([^/?#]+)/i);
      host = m ? m[1].split(':')[0].toLowerCase() : s.toLowerCase();
    }
    host = host.replace(/^www\./, '').replace(/^\[|\]$/g, '');
    if (!host || host.indexOf('*') !== -1) return host;
    if (/^\d+(\.\d+){3}$/.test(host)) return host; // IP 原样
    var parts = host.split('.');
    if (parts.length < 2) return host;
    if (parts.length >= 3 && SECOND_LEVEL_SUFFIXES[parts.slice(-2).join('.')]) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function buildApiUrl(domain, mode) {
    var q = [];
    q.push(encodeURIComponent(_cfg.urlParam) + '=' + encodeURIComponent(domain));
    q.push(encodeURIComponent(_cfg.tokenParam) + '=' + encodeURIComponent(_cfg.token));
    if (_cfg.format) q.push(encodeURIComponent(_cfg.formatParam) + '=' + encodeURIComponent(String(_cfg.format).replace(/^\./, '')));
    if (mode) q.push('mode=' + encodeURIComponent(mode));
    return _cfg.base + _cfg.apiPath + '?' + q.join('&');
  }

  function tokenHash() {
    var t = _cfg.token || '';
    var h = 0, i;
    for (i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
    return String(h);
  }

  function cacheKey(domain) {
    return 'iconsplus:direct:' + tokenHash() + ':' + (String(_cfg.format || '').toLowerCase()) + ':' + domain;
  }

  function cacheGet(domain) {
    if (!_cfg.cacheEnabled || !domain) return '';
    var key = cacheKey(domain), raw = null;
    try { raw = window.localStorage.getItem(key); } catch (e) { raw = _memCache[key] || null; }
    if (!raw) return '';
    try {
      var item = JSON.parse(raw);
      if (!item || !item.url || (Date.now() - item.at) > _cfg.cacheTtl) {
        cacheDel(domain); return '';
      }
      return item.url;
    } catch (e) { return ''; }
  }

  function cacheSet(domain, url) {
    if (!_cfg.cacheEnabled || !domain || !url) return;
    var key = cacheKey(domain);
    var raw = JSON.stringify({ url: url, at: Date.now() });
    try { window.localStorage.setItem(key, raw); } catch (e) { _memCache[key] = raw; }
  }

  function cacheDel(domain) {
    var key = cacheKey(domain);
    try { window.localStorage.removeItem(key); } catch (e) { delete _memCache[key]; }
  }

  function absUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
    return _cfg.base + (u.charAt(0) === '/' ? u : '/' + u);
  }

  /** 通用请求：fetch 优先，XMLHttpRequest 兜底；403 也能读到 JSON body */
  function requestJson(url, cb) {
    var done = false;
    function finish(obj) { if (!done) { done = true; cb && cb(obj || null); } }
    if (typeof fetch === 'function') {
      try {
        fetch(url, { credentials: 'omit', cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(finish)
          .catch(function () { finish(null); });
        return;
      } catch (e) { /* 落到 XHR */ }
    }
    if (typeof XMLHttpRequest === 'undefined') { finish(null); return; }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          try { finish(JSON.parse(xhr.responseText)); } catch (e) { finish(null); }
        }
      };
      xhr.onerror = function () { finish(null); };
      xhr.send();
    } catch (e) { finish(null); }
  }

  /** 核心：一级域名/网址 → 完整调用 URL（同步）。
   *  命中本地签名直链缓存时直接返回直链（一跳、不闪）；未命中返回 /api/icon 链接。 */
  function icon(domainOrUrl) {
    var d = extractDomain(domainOrUrl);
    if (!d || !ready()) return '';
    var cached = cacheGet(d);
    if (cached) return absUrl(cached);
    return buildApiUrl(d, '');
  }

  /** 异步解析签名直链，写入本地缓存，回调可直接放进 <img src> 的稳定 URL。
   *  force=true 强制回源刷新（在后台改了域名图标后用）。 */
  function resolveAsync(domainOrUrl, cb, force) {
    var d = extractDomain(domainOrUrl);
    if (!d || !ready()) { cb && cb(''); return api; }
    if (!force) {
      var cached = cacheGet(d);
      if (cached) { cb && cb(absUrl(cached)); return api; }
    }
    requestJson(buildApiUrl(d, 'json'), function (data) {
      if (data && data.ok && data.url) {
        cacheSet(d, data.url);
        cb && cb(absUrl(data.url));
      } else {
        cb && cb('');
      }
    });
    return api;
  }

  /** 批量预热常用域名，避免首屏空白 */
  function warm(domains, cb) {
    var list = domains || [], left = list.length, done = 0;
    if (!left) { cb && cb(0); return api; }
    for (var i = 0; i < list.length; i++) {
      (function (d) {
        resolveAsync(d, function () { done++; if (done >= left) cb && cb(done); });
      })(list[i]);
    }
    return api;
  }

  /** 真实跑一次调用并返回诊断对象（token 用户名 / 来源域名或 IP / 白名单 / 建议） */
  function diagnose(domainOrUrl, cb) {
    var d = extractDomain(domainOrUrl || 'bilibili.com');
    if (!ready()) { cb && cb(null); return api; }
    requestJson(buildApiUrl(d, 'diagnose'), function (data) { cb && cb(data); });
    return api;
  }

  /** 清缓存：不传域名则清空全部；改了域名默认图标后可调本方法 */
  function clearCache(domain) {
    if (!domain) {
      var prefix = 'iconsplus:direct:' + tokenHash() + ':';
      try {
        var keys = [];
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) keys.push(k);
        }
        for (var j = 0; j < keys.length; j++) window.localStorage.removeItem(keys[j]);
      } catch (e) { _memCache = {}; }
    } else {
      cacheDel(extractDomain(domain));
    }
    return api;
  }

  function defaultPlaceholder() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
      '<circle cx="24" cy="24" r="20" fill="#eef0f3"/>' +
      '<circle cx="24" cy="24" r="7" fill="#d5d9df"/></svg>';
    if (typeof encodeURIComponent === 'function') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return '';
  }

  function setSrc(node, url) {
    if (!url) return;
    if (_cfg.fadeIn && node.style) {
      node.style.transition = 'opacity .18s ease';
      node.style.opacity = '0';
      node.onload = function () { node.style.opacity = '1'; };
      node.onerror = function () { node.style.opacity = '1'; };
    }
    node.setAttribute('src', url);
  }

  /** 生成 <img> 标签字符串（适合服务端渲染 / 模板拼接）。
   *  src 用占位图，真正的图标由随后的 applyTo() / applyToAsync() 填充。 */
  function img(domainOrUrl, attrs) {
    var d = extractDomain(domainOrUrl);
    var a = attrs || {};
    var parts = [];
    var cached = cacheGet(d);
    parts.push('src="' + (cached ? absUrl(cached) : (_cfg.placeholder || defaultPlaceholder())) + '"');
    parts.push('data-icon-domain="' + String(d).replace(/"/g, '&quot;') + '"');
    for (var k in a) {
      if (Object.prototype.hasOwnProperty.call(a, k) && k !== 'src' && k !== 'data-icon-domain') {
        parts.push(k + '="' + String(a[k]).replace(/"/g, '&quot;') + '"');
      }
    }
    return '<img ' + parts.join(' ') + ' />';
  }

  /** 给已有 <img data-icon-domain="..."> 批量填充 src（无框架场景）。
   *  缓存命中直接填；未命中先占位再异步预热，消除空白跳动。 */
  function applyTo(selector) {
    if (typeof document === 'undefined') return 0;
    var nodes = document.querySelectorAll(selector || '[data-icon-domain]');
    var n = 0;
    for (var i = 0; i < nodes.length; i++) {
      (function (node) {
        var d = node.getAttribute('data-icon-domain');
        if (!d) return;
        var cached = cacheGet(d);
        if (cached) { setSrc(node, absUrl(cached)); n++; return; }
        if (!_cfg.autoResolve || !ready()) { setSrc(node, buildApiUrl(extractDomain(d), '')); n++; return; }
        if (!node.getAttribute('src')) {
          node.setAttribute('src', _cfg.placeholder || defaultPlaceholder());
        }
        resolveAsync(d, function (url) {
          if (url && node.getAttribute('data-icon-domain') === d) setSrc(node, url);
        });
        n++;
      })(nodes[i]);
    }
    return n;
  }

  /** 返回当前配置快照（脱敏 token），便于后台自检 */
  function status() {
    return {
      base: _cfg.base,
      apiPath: _cfg.apiPath,
      token: _cfg.token ? _cfg.token.slice(0, 6) + '…' : '',
      ready: ready(),
      cacheEnabled: _cfg.cacheEnabled,
      placeholder: !!(_cfg.placeholder || defaultPlaceholder())
    };
  }

  var api = {
    configure: configure,
    configureFromMeta: configureFromMeta,
    configureFromGlobal: configureFromGlobal,
    icon: icon,
    img: img,
    applyTo: applyTo,
    extractDomain: extractDomain,
    resolveAsync: resolveAsync,
    warm: warm,
    diagnose: diagnose,
    clearCache: clearCache,
    status: status,
    ready: ready,
    version: '1.1.0'
  };
  return api;
});

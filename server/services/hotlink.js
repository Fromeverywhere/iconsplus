const { URL } = require('url');

// 白名单按 host 后缀匹配，支持子域（如 example.com 命中 api.example.com）
function hostMatches(host, patterns) {
  if (!host) return false;
  host = host.toLowerCase();
  return (patterns || []).some((p) => {
    p = String(p).trim().toLowerCase();
    if (!p) return false;
    return host === p || host.endsWith('.' + p);
  });
}

// 防盗链中间件工厂：根据 getSettings() 实时读取配置（支持后台动态修改）
function createHotlinkMiddleware(getSettings) {
  return function hotlink(req, res, next) {
    const cfg = (getSettings().hotlink) || {};
    if (!cfg.enabled) return next();

    const referer = req.headers.referer || req.headers.referrer || '';
    const requestHost = req.headers.host ? req.headers.host.split(':')[0].toLowerCase() : '';

    // 无 Referer（直接访问 / 书签 / 某些客户端）
    if (!referer) {
      if (cfg.allowEmptyReferer) return next();
      return res.status(403).type('text/plain').send('403 Forbidden: empty referer');
    }

    let refHost = '';
    try {
      refHost = new URL(referer).host.split(':')[0].toLowerCase();
    } catch {
      // 非法 referer 视为拦截
    }

    // 同站永远放行（站点自身加载图标）
    if (refHost && refHost === requestHost) return next();

    // 白名单后缀匹配
    if (hostMatches(refHost, cfg.allowlist)) return next();

    return res.status(403).type('text/plain').send('403 Forbidden: hotlink protected');
  };
}

module.exports = { createHotlinkMiddleware, hostMatches };

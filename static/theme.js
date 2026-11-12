/* icons+ shared theme control — follows the dark-mode-toggle guidance:
   tri-state data model (system / light / dark) surfaced as a two-state toggle.
   CSS never depends on JS: the <meta name="color-scheme"> starts as
   "light dark" (system) and only the inline FOUC script may pin it early. */
(function () {
  var KEY = 'icons_theme';
  var meta = document.querySelector('meta[name="color-scheme"]');
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function systemScheme() { return mq.matches ? 'dark' : 'light'; }
  function rendered() {
    var s = stored();
    if (s === 'light' || s === 'dark') return s;
    return systemScheme();
  }
  function reflect() {
    var s = stored();
    if (meta) meta.content = (s === 'light' || s === 'dark') ? s : 'light dark';
    syncAria();
  }
  function ariaLabel() {
    return rendered() === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }
  function syncAria() {
    var b = document.getElementById('themeToggle');
    if (b) b.setAttribute('aria-label', ariaLabel());
  }
  function toggle() {
    var target = rendered() === 'dark' ? 'light' : 'dark';
    try {
      if (target === systemScheme()) localStorage.removeItem(KEY); // undo override
      else localStorage.setItem(KEY, target);
    } catch (e) { /* storage blocked: theme still applies for this visit */ }
    reflect();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('#themeToggle');
    if (b) { toggle(); b.blur(); }
  });

  // System preference can change at any time; keep the control in sync.
  if (mq.addEventListener) {
    mq.addEventListener('change', function () { reflect(); });
  } else if (mq.addListener) {
    mq.addListener(function () { reflect(); });
  }

  // Another tab may change the stored override.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) reflect();
  });

  reflect();
})();

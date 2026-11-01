/* ============================================================================
   界面外观（传统界面 / 玻璃质感）与背景主题
   ----------------------------------------------------------------------------
   - 界面风格保存在 localStorage 的 cet6_interface_style：classic | glass；
   - 背景主题按界面分别保存：cet6_theme_classic（默认 minimal）、
     cet6_theme_glass（默认 water），可选 minimal/water/aurora/peach/night；
   - <head> 里的内联预加载脚本会在首帧前把 html[data-interface] 与
     html[data-wallpaper] 设好，避免闪烁；
   - 本文件负责：应用界面与主题、同步设置面板选中态、处理切换与跨标签页同步、
     高速滚动时暂时隐藏玻璃卡片文字。
   ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'cet6_interface_style';
  var THEME_PREFIX = 'cet6_theme_';
  var CLASSIC = 'classic';
  var GLASS = 'glass';
  var STYLES = [CLASSIC, GLASS];
  var THEMES = ['minimal', 'water', 'aurora', 'peach', 'night'];
  var THEME_LABELS = {
    minimal: '极简',
    aurora: '极光',
    peach: '蜜桃',
    night: '深空',
    water: '水波'
  };
  var DEFAULT_THEMES = { classic: 'minimal', glass: 'water' };
  var THEME_COLORS = {
    minimal: '#f8fafc',
    aurora: '#eef0fb',
    peach: '#fff7ed',
    night: '#0b1026',
    water: '#8fd8d2'
  };
  var root = document.documentElement;
  var currentStyle = CLASSIC;
  var currentTheme = DEFAULT_THEMES[CLASSIC];

  function normalize(style) {
    return STYLES.indexOf(style) === -1 ? CLASSIC : style;
  }

  function normalizeTheme(theme, style) {
    if (THEMES.indexOf(theme) !== -1) return theme;
    return DEFAULT_THEMES[normalize(style)];
  }

  function themeKey(style) {
    return THEME_PREFIX + normalize(style);
  }

  function readStoredStyle() {
    try {
      return normalize(window.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return CLASSIC;
    }
  }

  function writeStoredStyle(style) {
    try {
      window.localStorage.setItem(STORAGE_KEY, style);
      return true;
    } catch (error) {
      return false;
    }
  }

  function readStoredTheme(style) {
    var normalized = normalize(style);
    var fallback = DEFAULT_THEMES[normalized];
    try {
      var stored = window.localStorage.getItem(themeKey(normalized));
      return normalizeTheme(stored, normalized);
    } catch (error) {
      return fallback;
    }
  }

  function writeStoredTheme(style, theme) {
    try {
      window.localStorage.setItem(themeKey(style), theme);
      return true;
    } catch (error) {
      return false;
    }
  }

  function radioInputs(name) {
    return Array.prototype.slice.call(document.querySelectorAll('input[name="' + name + '"]'));
  }

  function syncControls() {
    radioInputs('appearanceStyle').forEach(function (radio) {
      var selected = radio.value === currentStyle;
      radio.checked = selected;
      var option = radio.closest ? radio.closest('.appearance-option') : null;
      if (option) option.classList.toggle('is-selected', selected);
    });
    radioInputs('wallpaperTheme').forEach(function (radio) {
      var selected = radio.value === currentTheme;
      radio.checked = selected;
      var option = radio.closest ? radio.closest('.theme-option') : null;
      if (option) option.classList.toggle('is-selected', selected);
    });
  }

  function updateThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[currentTheme] || '#f8fafc');
  }

  function dispatchChange() {
    try {
      document.dispatchEvent(new CustomEvent('appearancechange', {
        detail: { style: currentStyle, theme: currentTheme }
      }));
    } catch (error) {
      /* CustomEvent 不可用时静默忽略，界面本身已经生效 */
    }
  }

  function applyTheme(theme, style) {
    currentTheme = normalizeTheme(theme, style || currentStyle);
    root.setAttribute('data-wallpaper', currentTheme);
    updateThemeColor();
    syncControls();
    return currentTheme;
  }

  function paint(style, themeOverride) {
    currentStyle = normalize(style);
    root.setAttribute('data-interface', currentStyle);
    applyTheme(typeof themeOverride === 'string' ? themeOverride : readStoredTheme(currentStyle), currentStyle);
    dispatchChange();
  }

  function announceStyle(style) {
    if (typeof window.toast !== 'function') return;
    window.toast(style === GLASS ? '已切换到玻璃质感界面（开发中）' : '已切换到传统界面');
  }

  function announceTheme(theme) {
    if (typeof window.toast !== 'function') return;
    window.toast('已切换主题：' + (THEME_LABELS[theme] || theme));
  }

  function applyStyle(style, options) {
    var settings = options || {};
    var next = normalize(style);
    if (next === currentStyle && settings.force !== true) {
      syncControls();
      return currentStyle;
    }
    paint(next);
    var saved = true;
    if (!settings.silent) saved = writeStoredStyle(next);
    if (settings.announce) {
      if (saved) announceStyle(next);
      else if (typeof window.toast === 'function') {
        window.toast('已切换界面，但浏览器未允许保存设置');
      }
    }
    return currentStyle;
  }

  function applyThemeOption(theme, options) {
    var settings = options || {};
    var next = normalizeTheme(theme, currentStyle);
    if (next === currentTheme) {
      syncControls();
      return currentTheme;
    }
    applyTheme(next);
    var saved = true;
    if (!settings.silent) saved = writeStoredTheme(currentStyle, next);
    if (settings.announce) {
      if (saved) announceTheme(next);
      else if (typeof window.toast === 'function') {
        window.toast('已切换主题，但浏览器未允许保存设置');
      }
    }
    dispatchChange();
    return currentTheme;
  }

  function getStyle() {
    return currentStyle;
  }

  function getTheme() {
    return currentTheme;
  }

  var settingsOpen = false;

  function openSettings() {
    var modal = document.getElementById('modalSettings');
    if (!modal) return;
    settingsOpen = true;
    if (typeof window.openModal === 'function') {
      window.openModal(modal);
    } else {
      // 页面脚本尚未就绪时的兜底：复用同一套 .modal-card / .modal-overlay 结构。
      var overlay = document.getElementById('modalOverlay');
      if (!overlay) return;
      overlay.style.display = 'flex';
      Array.prototype.forEach.call(document.querySelectorAll('.modal-card'), function (card) {
        card.classList.remove('active');
      });
      modal.classList.add('active');
      if (window.LiquidGlass && typeof LiquidGlass.flush === 'function') LiquidGlass.flush();
    }
    // 打开后把焦点交还给当前选中的界面选项，键盘用户可以直接用方向键切换。
    var selected = radioInputs('appearanceStyle').filter(function (radio) { return radio.checked; })[0];
    if (selected) {
      try { selected.focus({ preventScroll: true }); } catch (error) { selected.focus(); }
    }
  }

  // 关闭设置后把焦点还给齿轮按钮，避免键盘用户回到页面开头重新找入口。
  function watchSettingsClose(trigger) {
    var modal = document.getElementById('modalSettings');
    var overlay = document.getElementById('modalOverlay');
    if (!modal || !overlay || typeof window.MutationObserver !== 'function') return;
    new window.MutationObserver(function () {
      if (!settingsOpen || overlay.style.display !== 'none') return;
      settingsOpen = false;
      if (!trigger || !document.contains(trigger)) return;
      try { trigger.focus({ preventScroll: true }); } catch (error) { trigger.focus(); }
    }).observe(overlay, { attributes: true, attributeFilter: ['style'] });
  }

  function initSettings() {
    var trigger = document.getElementById('btnOpenSettings');
    if (trigger) {
      trigger.addEventListener('click', openSettings);
      watchSettingsClose(trigger);
    }

    radioInputs('appearanceStyle').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) applyStyle(radio.value, { announce: true });
      });
    });
    radioInputs('wallpaperTheme').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) applyThemeOption(radio.value, { announce: true });
      });
    });

    syncControls();

    // 同一浏览器的另一个标签页切换界面/主题，或站点数据被清空时保持同步。
    window.addEventListener('storage', function (event) {
      if (event.key !== null && event.key !== STORAGE_KEY && event.key.indexOf(THEME_PREFIX) !== 0) return;
      paint(readStoredStyle());
    });
  }

  function watchScrollText() {
    var lastY = window.scrollY, lastTime = performance.now();
    var hidden = false, slowSince = null, restoreTimer = 0;

    function showText() {
      clearTimeout(restoreTimer); restoreTimer = 0;
      hidden = false; slowSince = null;
      root.classList.remove('glass-fast-scroll');
      lastY = window.scrollY; lastTime = performance.now();
    }

    function onScroll() {
      if (currentStyle !== GLASS || document.hidden) { showText(); return; }
      var now = performance.now(), y = window.scrollY;
      var speed = Math.abs(y - lastY) * 1000 / Math.max(16, now - lastTime);
      lastY = y; lastTime = now;
      // Different thresholds plus a short slow period prevent text flickering
      // around the boundary. Observe native scrolling; never drive its motion.
      if (speed > Math.max(1200, window.innerHeight * 2.5)) {
        hidden = true; slowSince = null;
        root.classList.add('glass-fast-scroll');
      } else if (hidden && speed < Math.max(500, window.innerHeight)) {
        if (slowSince === null) slowSince = now;
        if (now - slowSince >= 90) showText();
      } else {
        slowSince = null;
      }
      clearTimeout(restoreTimer);
      // Also restore when a gesture ends without another scroll event.
      if (hidden) restoreTimer = window.setTimeout(showText, 120);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', showText);
    window.addEventListener('resize', showText);
    document.addEventListener('visibilitychange', showText);
    document.addEventListener('appearancechange', showText);
  }

  // 首帧前内联脚本已经设过一次；这里补齐选中态与监听器。
  paint(readStoredStyle());
  watchScrollText();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
  } else {
    initSettings();
  }

  window.Appearance = Object.freeze({
    KEY: STORAGE_KEY,
    THEME_PREFIX: THEME_PREFIX,
    STYLES: STYLES.slice(),
    THEMES: THEMES.slice(),
    THEME_LABELS: Object.freeze(Object.assign({}, THEME_LABELS)),
    DEFAULT_THEMES: Object.freeze(Object.assign({}, DEFAULT_THEMES)),
    get: getStyle,
    set: applyStyle,
    getTheme: getTheme,
    setTheme: applyThemeOption,
    openSettings: openSettings
  });
})();

/* Liquid glass: size-calibrated background refraction, with separate sharp content.
 * RGB displacement adapted from rdev/liquid-glass-react (Copyright 2025 MAX
 * ROVENSKY, MIT). Full license: assets/liquid-glass-react.LICENSE.
 * Retains the LiquidGlass API, saved preferences and conservative device fallbacks.
 */
(function () {
  'use strict';

  // 重复引入时保持第一个实例，避免重复创建 SVG / 重复监听。
  if (window.LiquidGlass) return;

  var VERSION = '2.0.0';
  var CLASS_NAME = 'glass-refraction';
  var ATTR_NAME = 'data-glass-refraction';
  var FILTER_ID = 'cet6-liquid-refract';
  var SVG_ID = 'cet6-liquid-glass-defs';
  var FILTER_URL = 'url(#' + FILTER_ID + ')';
  var STORAGE_PREF = 'cet6_liquid_glass';            // 'on' | 'off'（缺省 = 自动策略）
  var STORAGE_INTENSITY = 'cet6_liquid_glass_intensity';
  var NS = 'http://www.w3.org/2000/svg';
  var MAX_INTENSITY = 2;

  var INTEGRATION_CSS = 'html.glass-refraction[data-interface="glass"] .card::before { filter: var(--glass-filter, none); }';

  // ---------------------------------------------------------------------------
  // 参数
  // ---------------------------------------------------------------------------
  var DEFAULTS = {
    intensity: 1,
    // feDisplacementMap 的 scale（px，intensity=1 时）。实际最大位移 = scale / 2。
    // 48 + band 30：最大位移 24px < 折射带宽，边缘不会采到框外；肉眼上水体背景
    // 已有明显的透镜弯折，又不会像 72 那样在圆角处出现夸张的「波纹」。
    scale: 48,
    // 折射带宽度（px，以校准到的主玻璃表面尺寸为准；必须明显大于最大位移）。
    band: 30,
    // 位移图圆角半径（px，会被校准时的实际 border-radius 覆盖）。
    radius: 22,
    // 位移图纹理边长（越大越平滑，生成开销 ~O(n²)）。
    mapSize: 512,
    // 滤镜区域相对元素 bbox 的外扩比例：0.1 = x/y -10%、宽高 120%。
    // 保留一点外扩可以避免元素自带 box-shadow 被滤镜区域裁掉；外扩部分在位移图里
    // 保持中性（128），影子不会被位移。
    filterPadding: 0.1,
    // 是否按主玻璃表面实际尺寸校准折射带（让四个边的折射带物理宽度一致）。
    calibrate: true,
    // 参与校准的表面选择器（取面积最大的可见元素）。
    surfaceSelector: '.card, .modal-card, .btn-fav-nav',
    // 没有可校准表面时的参考尺寸（桌面主卡片：横向长条 / 中等高度）。
    reference: { width: 1000, height: 420 }
  };

  var config = {
    intensity: DEFAULTS.intensity,
    scale: DEFAULTS.scale,
    band: DEFAULTS.band,
    radius: DEFAULTS.radius,
    mapSize: DEFAULTS.mapSize,
    filterPadding: DEFAULTS.filterPadding,
    calibrate: DEFAULTS.calibrate,
    surfaceSelector: DEFAULTS.surfaceSelector,
    reference: { width: DEFAULTS.reference.width, height: DEFAULTS.reference.height }
  };

  // ---------------------------------------------------------------------------
  // 特性检测
  // ---------------------------------------------------------------------------
  var nav = window.navigator || {};
  var UA = nav.userAgent || '';

  function hasGlobal(name) {
    try { return typeof window[name] === 'object' && window[name] !== null; } catch (error) { return false; }
  }

  var isIOSWebKit = /(CriOS|FxiOS|EdgiOS|OPiOS)/.test(UA);
  var isFirefox = /(Firefox|FxiOS)\//.test(UA);
  var looksLikeSafari = !isIOSWebKit && /Safari\//.test(UA) && /Version\//.test(UA) &&
    !/(Chrome|Chromium|CriOS|Edg|OPR)\//.test(UA);
  var chromiumUA = /(Chrome|Chromium|Edg|OPR)\//.test(UA);
  var isChromium = !isFirefox && !looksLikeSafari && !isIOSWebKit && (chromiumUA || hasGlobal('chrome'));

  function cssSupports(property, value) {
    var api = window.CSS;
    if (!api || typeof api.supports !== 'function') return false;
    try { return api.supports(property, value) === true; } catch (error) { return false; }
  }

  var supportsFilterUrl = cssSupports('filter', 'url("#' + FILTER_ID + '-probe")');
  var supportsBackdropFilter = cssSupports('backdrop-filter', 'blur(1px)') ||
    cssSupports('-webkit-backdrop-filter', 'blur(1px)');

  var supportedReason = !isChromium ? 'not-chromium'
    : !supportsFilterUrl ? 'no-svg-filter-url'
      : !supportsBackdropFilter ? 'no-backdrop-filter'
        : '';
  // 判定依据：Blink 是唯一实测「backdrop-filter 结果可被 SVG 位移滤镜弯折」的引擎。
  var supported = supportedReason === '';

  var motionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function prefersReducedMotion() {
    return !!(motionQuery && motionQuery.matches);
  }

  function isLowEndDevice() {
    var cores = Number(nav.hardwareConcurrency) || 0;
    var memory = Number(nav.deviceMemory) || 0;
    var connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (connection && connection.saveData) return true;
    if (cores > 0 && cores <= 4) return true;
    if (memory > 0 && memory <= 4) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // 存储（任何异常都静默降级，不阻塞交互）
  // ---------------------------------------------------------------------------
  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function readPreference() {
    var value = storageGet(STORAGE_PREF);
    return value === 'on' || value === 'off' ? value : '';
  }

  function readIntensity() {
    var value = parseFloat(storageGet(STORAGE_INTENSITY));
    return clamp(Number.isFinite(value) ? value : DEFAULTS.intensity, 0, MAX_INTENSITY);
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  // ---------------------------------------------------------------------------
  // 运行时状态
  // ---------------------------------------------------------------------------
  var state = {
    enabled: false,
    intensity: readIntensity(),
    activeScale: 0,
    reference: { width: config.reference.width, height: config.reference.height },
    mapReady: false,
    svg: null,
    feImage: null,
    feDisplacement: null,
    lastError: ''
  };

  function root() {
    return document.documentElement;
  }

  function dispatchChange() {
    try {
      document.dispatchEvent(new CustomEvent('liquidglasschange', {
        detail: {
          supported: supported,
          enabled: state.enabled,
          intensity: state.intensity,
          scale: state.activeScale,
          reason: state.lastError || supportedReason
        }
      }));
    } catch (error) {
      /* CustomEvent 不可用时静默忽略 */
    }
  }

  // ---------------------------------------------------------------------------
  // SVG 滤镜：feImage(位移图) + feDisplacementMap
  // ---------------------------------------------------------------------------
  function createSvg() {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('id', SVG_ID);
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-glass-refraction-svg', '');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');

    var defs = document.createElementNS(NS, 'defs');

    var filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', FILTER_ID);
    // objectBoundingBox：滤镜随元素尺寸缩放；区域取元素自身，边缘采样全在元素内。
    filter.setAttribute('filterUnits', 'objectBoundingBox');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    // 避免默认 linearRGB 把位移图的编码值做 gamma 变换。
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    var feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('x', '0');
    feImage.setAttribute('y', '0');
    feImage.setAttribute('width', '100%');
    feImage.setAttribute('height', '100%');
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('result', 'map');

    filter.appendChild(feImage);
    // Upstream's separate RGB displacements produce actual optical dispersion,
    // rather than a painted rainbow border. Neutral center pixels stay unchanged.
    ['R', 'G', 'B'].forEach(function (channel, index) {
      var displacement = document.createElementNS(NS, 'feDisplacementMap');
      displacement.setAttribute('in', 'SourceGraphic');
      displacement.setAttribute('in2', 'map');
      displacement.setAttribute('scale', '0');
      displacement.setAttribute('xChannelSelector', 'R');
      displacement.setAttribute('yChannelSelector', 'G');
      displacement.setAttribute('result', channel + '_displaced');
      displacement.setAttribute('data-channel-factor', String(1 + index * 0.035));
      filter.appendChild(displacement);
      var matrix = document.createElementNS(NS, 'feColorMatrix');
      matrix.setAttribute('in', channel + '_displaced');
      matrix.setAttribute('type', 'matrix');
      matrix.setAttribute('values', [
        index === 0 ? '1 0 0 0 0' : '0 0 0 0 0',
        index === 1 ? '0 1 0 0 0' : '0 0 0 0 0',
        index === 2 ? '0 0 1 0 0' : '0 0 0 0 0', '0 0 0 1 0'
      ].join(' '));
      matrix.setAttribute('result', channel + '_channel');
      filter.appendChild(matrix);
    });
    [['G_channel', 'B_channel', 'GB'], ['R_channel', 'GB', 'RGB']].forEach(function (inputs) {
      var blend = document.createElementNS(NS, 'feBlend');
      blend.setAttribute('in', inputs[0]);
      blend.setAttribute('in2', inputs[1]);
      blend.setAttribute('mode', 'screen');
      blend.setAttribute('result', inputs[2]);
      filter.appendChild(blend);
    });
    // Keep the original displaced glass in the center. Limit RGB recombination
    // to a faint edge mask; accumulating translucent channel alpha over the whole
    // backdrop otherwise introduces a dark veil in Chromium.
    var edgeMask = document.createElementNS(NS, 'feColorMatrix');
    edgeMask.setAttribute('in', 'map');
    edgeMask.setAttribute('type', 'matrix');
    edgeMask.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0');
    edgeMask.setAttribute('result', 'edge_mask');
    filter.appendChild(edgeMask);
    var edgeColor = document.createElementNS(NS, 'feComposite');
    edgeColor.setAttribute('in', 'RGB');
    edgeColor.setAttribute('in2', 'edge_mask');
    edgeColor.setAttribute('operator', 'in');
    edgeColor.setAttribute('result', 'edge_color');
    filter.appendChild(edgeColor);
    var final = document.createElementNS(NS, 'feComposite');
    final.setAttribute('in', 'edge_color');
    final.setAttribute('in2', 'R_displaced');
    final.setAttribute('operator', 'over');
    filter.appendChild(final);
    var feDisplacement = filter.querySelector('feDisplacementMap');
    defs.appendChild(filter);
    svg.appendChild(defs);

    (document.body || document.documentElement).appendChild(svg);
    state.svg = svg;
    state.feImage = feImage;
    state.feDisplacement = feDisplacement;
    syncFilterGeometry();
    return svg;
  }

  // 滤镜区域与位移图的对应关系。
  // 实测（Chromium/Edge）：feImage 的 x/y/width/height 百分比按「元素 bbox」解析，
  // 且不受 filter region 外扩影响 —— 所以外扩必须写成负数百分比，
  // 让位移图铺满整个滤镜区域；外扩部分在位移图里保持中性（128），
  // 这样元素自带的 box-shadow 既不会被滤镜区域裁掉，也不会被位移。
  function syncFilterGeometry() {
    var filter = state.svg && state.svg.querySelector('filter');
    if (!filter) return;
    var padding = clamp(Number(config.filterPadding) || 0, 0, 0.25);
    var region = 1 + padding * 2;
    var percent = (padding * 100).toFixed(4) + '%';
    var span = (region * 100).toFixed(4) + '%';
    filter.setAttribute('x', '-' + percent);
    filter.setAttribute('y', '-' + percent);
    filter.setAttribute('width', span);
    filter.setAttribute('height', span);
    if (state.feImage) {
      state.feImage.setAttribute('x', '-' + percent);
      state.feImage.setAttribute('y', '-' + percent);
      state.feImage.setAttribute('width', span);
      state.feImage.setAttribute('height', span);
    }
  }

  function ensureSvg() {
    if (state.svg && state.svg.isConnected) return state.svg;
    var existing = document.getElementById(SVG_ID);
    if (existing) {
      var feImage = existing.querySelector('feImage');
      var feDisplacement = existing.querySelector('feDisplacementMap');
      if (feImage && feDisplacement) {
        state.svg = existing;
        state.feImage = feImage;
        state.feDisplacement = feDisplacement;
        syncFilterGeometry();
        return existing;
      }
      // 结构不对（被外部脚本改过）：移除重建，保证幂等。
      existing.parentNode.removeChild(existing);
    }
    return createSvg();
  }

  // 圆角矩形有符号距离场（px 空间，负值 = 在矩形内部）。
  function roundedRectSdf(px, py, halfWidth, halfHeight, radius) {
    var r = Math.min(radius, halfWidth, halfHeight);
    var qx = Math.abs(px) - (halfWidth - r);
    var qy = Math.abs(py) - (halfHeight - r);
    var ox = Math.max(qx, 0);
    var oy = Math.max(qy, 0);
    return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy) - r;
  }

  function toByte(value) {
    var rounded = Math.round(value);
    return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
  }

  /**
   * 生成位移图（canvas → PNG dataURL）。
   *
   * 约定：R 通道 = x 位移方向，G 通道 = y 位移方向，128 = 中性。
   * 中心区域（离边缘 > band）保持 (128,128,0)，B 通道存储微弱的边缘色散遮罩；
   * 边缘带内沿「指向元素内部」的法线方向做位移，越靠边强度越大：
   *   位移像素 = scale * (2 * p * n / 255) ≈ (scale/2) * p * n
   * 由于采样点始终朝内部推，SourceGraphic（磨砂背景）不会采到框外透明区域，
   * 因此不会出现透明破洞；同时伪元素上的文字不在滤镜范围内，保持清晰。
   *
   * 位移图覆盖整个滤镜区域（含 filterPadding 外扩），但只有元素 bbox 内才有
   * 位移值，外扩区域保持中性 —— 这样 box-shadow 既不会被区域裁掉，也不会被位移。
   */
  function buildMapDataUrl(reference, cornerRadius) {
    reference = reference || state.reference;
    cornerRadius = cornerRadius === undefined ? config.radius : cornerRadius;
    var size = Math.round(clamp(config.mapSize, 128, 1024));
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx || !ctx.createImageData) return '';

    var halfWidth = Math.max(1, reference.width / 2);
    var halfHeight = Math.max(1, reference.height / 2);
    var radius = clamp(cornerRadius, 0, Math.min(halfWidth, halfHeight));
    var band = Math.max(2, Math.min(config.band, Math.min(halfWidth, halfHeight) * 0.85));
    var padding = clamp(Number(config.filterPadding) || 0, 0, 0.25);
    var regionScale = 1 + padding * 2;
    var image = ctx.createImageData(size, size);
    var data = image.data;
    var amplitude = 127; // 编码幅度：127 → 最大约 ±0.5（feDisplacementMap 再乘 scale）
    var epsilon = Math.max(1, band * 0.25);

    for (var y = 0; y < size; y += 1) {
      // 位移图铺满「滤镜区域」：先换算到元素 bbox 坐标系（px），bbox 外保持中性。
      var py = ((y + 0.5) / size - 0.5) * regionScale * reference.height;
      for (var x = 0; x < size; x += 1) {
        var index = (y * size + x) * 4;
        var px = ((x + 0.5) / size - 0.5) * regionScale * reference.width;
        if (Math.abs(px) > halfWidth || Math.abs(py) > halfHeight) {
          data[index] = 128;
          data[index + 1] = 128;
          data[index + 2] = 0;
          data[index + 3] = 255;
          continue;
        }
        var sdf = roundedRectSdf(px, py, halfWidth, halfHeight, radius);
        var distance = -sdf; // 到元素边界（圆角矩形）的内部距离
        var profile;
        if (distance <= 0) {
          profile = 1; // 圆角外侧的框角像素（最终会被 border-radius 裁掉）
        } else if (distance >= band) {
          data[index] = 128;
          data[index + 1] = 128;
          data[index + 2] = 0;
          data[index + 3] = 255;
          continue;
        } else {
          var t = distance / band;
          var remaining = 1 - t;
          profile = remaining * remaining; // 边缘最强，向内平滑归零
        }

        // 数值梯度 → 内向单位法线
        var gx = roundedRectSdf(px + epsilon, py, halfWidth, halfHeight, radius) -
          roundedRectSdf(px - epsilon, py, halfWidth, halfHeight, radius);
        var gy = roundedRectSdf(px, py + epsilon, halfWidth, halfHeight, radius) -
          roundedRectSdf(px, py - epsilon, halfWidth, halfHeight, radius);
        var length = Math.sqrt(gx * gx + gy * gy);
        var nx = 0;
        var ny = 0;
        if (length > 1e-6) {
          nx = -gx / length;
          ny = -gy / length;
        }

        data[index] = toByte(128 + amplitude * profile * nx);
        data[index + 1] = toByte(128 + amplitude * profile * ny);
        data[index + 2] = toByte(profile * 20);
        data[index + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    try {
      return canvas.toDataURL('image/png');
    } catch (error) {
      return '';
    }
  }

  // 测量主玻璃表面尺寸，让折射带的物理宽度尽量一致（宽卡片不会被按长边拉宽）。
  function measureReference() {
    if (!config.calibrate || typeof document.querySelectorAll !== 'function') return null;
    var list;
    try {
      list = document.querySelectorAll(config.surfaceSelector);
    } catch (error) {
      return null;
    }
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < list.length; i += 1) {
      var element = list[i];
      if (!element || typeof element.getBoundingClientRect !== 'function') continue;
      var rect = element.getBoundingClientRect();
      if (!rect || rect.width < 120 || rect.height < 56) continue;
      var style = window.getComputedStyle ? window.getComputedStyle(element) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
      var area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        var radius = style ? parseFloat(style.borderTopLeftRadius) : NaN;
        best = {
          width: rect.width,
          height: rect.height,
          radius: Number.isFinite(radius) && radius > 0 ? radius : config.radius
        };
      }
    }
    return best;
  }

  // 返回 true 表示参考尺寸变了、需要重建位移图。
  function updateReference(force) {
    if (!config.calibrate) return force === true;
    var measured = measureReference();
    if (!measured) return force === true;
    var previous = state.reference;
    var changed = force === true ||
      Math.abs(measured.width - previous.width) / previous.width > 0.12 ||
      Math.abs(measured.height - previous.height) / previous.height > 0.12 ||
      Math.abs(measured.radius - config.radius) > 2;
    if (!changed) return false;
    state.reference = { width: measured.width, height: measured.height };
    config.radius = measured.radius;
    return true;
  }

  function applyMap(force) {
    if (!state.svg || !state.feImage) return false;
    if (state.mapReady && force !== true) return true;
    var dataUrl = buildMapDataUrl();
    if (!dataUrl) {
      state.lastError = 'map-generation-failed';
      return false;
    }
    state.feImage.setAttribute('href', dataUrl);
    // 兼容旧 Chromium 的 xlink:href 写法。
    state.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl);
    state.mapReady = true;
    state.lastError = '';
    return true;
  }

  function activeScale() {
    var scale = config.scale * state.intensity;
    return Math.round(clamp(scale, 0, 400) * 100) / 100;
  }

  function applyScale() {
    var scale = activeScale();
    state.activeScale = scale;
    if (state.feDisplacement) {
      state.svg.querySelectorAll('feDisplacementMap').forEach(function (node) {
        var localScale = scale;
        surfaces.forEach(function (entry) { if (entry.filter.contains(node)) localScale = Math.min(scale, entry.maxScale * state.intensity); });
        node.setAttribute('scale', String(localScale * Number(node.getAttribute('data-channel-factor') || 1)));
      });
    }
    root().style.setProperty('--glass-refract-scale', String(scale));
    return scale;
  }

  // ---------------------------------------------------------------------------
  // 开启 / 关闭 / 强度
  // ---------------------------------------------------------------------------
  function normalizeOptions(options) {
    var settings = options || {};
    return {
      persist: settings.persist !== false,
      silent: settings.silent === true
    };
  }

  function enable(options) {
    var settings = normalizeOptions(options);
    if (!supported) {
      state.lastError = supportedReason;
      return false;
    }
    var svg = ensureSvg();
    if (!svg) {
      state.lastError = 'svg-unavailable';
      return false;
    }
    var referenceChanged = updateReference(false);
    applyMap(referenceChanged || !state.mapReady);
    applyScale();
    root().classList.add(CLASS_NAME);
    root().setAttribute(ATTR_NAME, 'on');
    state.enabled = true;
    scheduleSurfaces();
    if (settings.persist) storageSet(STORAGE_PREF, 'on');
    if (!settings.silent) dispatchChange();
    return true;
  }

  function disable(options) {
    var settings = normalizeOptions(options);
    if (root()) {
      root().classList.remove(CLASS_NAME);
      root().removeAttribute(ATTR_NAME);
      root().style.removeProperty('--glass-refract-scale');
    }
    state.enabled = false;
    state.activeScale = 0;
    clearSurfaces();
    if (settings.persist) storageSet(STORAGE_PREF, 'off');
    if (!settings.silent) dispatchChange();
    return true;
  }

  function isEnabled() {
    return !!state.enabled && root().classList.contains(CLASS_NAME);
  }

  function setIntensity(value, options) {
    var settings = normalizeOptions(options);
    var next = parseFloat(value);
    if (!Number.isFinite(next)) return state.intensity;
    state.intensity = Math.round(clamp(next, 0, MAX_INTENSITY) * 100) / 100;
    applyScale();
    if (settings.persist) storageSet(STORAGE_INTENSITY, String(state.intensity));
    if (!settings.silent) dispatchChange();
    return state.intensity;
  }

  function configure(options) {
    var settings = options || {};
    if (settings.scale !== undefined) config.scale = clamp(Number(settings.scale) || 0, 0, 400);
    if (settings.band !== undefined) config.band = clamp(Number(settings.band) || 0, 2, 400);
    if (settings.radius !== undefined) config.radius = clamp(Number(settings.radius) || 0, 0, 400);
    if (settings.mapSize !== undefined) config.mapSize = Math.round(clamp(Number(settings.mapSize) || 0, 128, 1024));
    if (settings.filterPadding !== undefined) config.filterPadding = clamp(Number(settings.filterPadding) || 0, 0, 0.25);
    if (settings.calibrate !== undefined) config.calibrate = settings.calibrate !== false;
    if (typeof settings.surfaceSelector === 'string') config.surfaceSelector = settings.surfaceSelector;
    if (settings.reference && Number(settings.reference.width) > 0 && Number(settings.reference.height) > 0) {
      config.reference = {
        width: Number(settings.reference.width),
        height: Number(settings.reference.height)
      };
      state.reference = { width: config.reference.width, height: config.reference.height };
    }
    if (settings.intensity !== undefined) {
      state.intensity = clamp(parseFloat(settings.intensity) || 0, 0, MAX_INTENSITY);
      applyScale();
    }
    if (isEnabled()) {
      updateReference(false);
      syncFilterGeometry();
      applyMap(true); // 参数变了必须重建位移图
      applyScale();
    }
    mapCache.clear();
    clearSurfaces();
    scheduleSurfaces();
    return getState();
  }

  function refresh() {
    if (!state.svg) return false;
    var changed = updateReference(true) || !state.mapReady;
    applyMap(true);
    scheduleSurfaces();
    if (state.enabled) applyScale();
    return changed;
  }

  function toggle(options) {
    return isEnabled() ? disable(options) : enable(options);
  }

  function getState() {
    var connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    return {
      surfaces: surfaces.size,
      version: VERSION,
      supported: supported,
      supportedReason: supportedReason,
      enabled: isEnabled(),
      intensity: state.intensity,
      scale: state.activeScale,
      filterId: FILTER_ID,
      filterUrl: FILTER_URL,
      band: config.band,
      radius: config.radius,
      mapSize: config.mapSize,
      filterPadding: config.filterPadding,
      calibrate: config.calibrate,
      reference: { width: state.reference.width, height: state.reference.height },
      referenceMeasured: config.calibrate && state.reference.width !== DEFAULTS.reference.width,
      reducedMotion: prefersReducedMotion(),
      lowEndDevice: isLowEndDevice(),
      saveData: !!(connection && connection.saveData),
      hardwareConcurrency: Number(nav.hardwareConcurrency) || 0,
      deviceMemory: Number(nav.deviceMemory) || 0,
      userPreference: readPreference(),
      autoEligible: supported && !prefersReducedMotion() && !isLowEndDevice(),
      lastError: state.lastError
    };
  }

  function destroy() {
    clearTimeout(surfaceTimer);
    if (resizeObserver) resizeObserver.disconnect();
    if (mutationObserver) mutationObserver.disconnect();
    window.removeEventListener('scroll', scheduleSurfaces);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerout', onPointerOut);
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    clearSurfaces();
    mapCache.clear();
    var svg = state.svg || document.getElementById(SVG_ID);
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
    if (state.enabled) disable({ persist: false, silent: true });
    else if (root()) {
      root().classList.remove(CLASS_NAME);
      root().removeAttribute(ATTR_NAME);
      root().style.removeProperty('--glass-refract-scale');
    }
    state.svg = null;
    state.feImage = null;
    state.feDisplacement = null;
    state.mapReady = false;
    state.enabled = false;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('appearancechange', onAppearanceChange);
    window.removeEventListener('storage', onStorage);
    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', onMotionChange);
      else if (typeof motionQuery.removeListener === 'function') motionQuery.removeListener(onMotionChange);
    }
  }

  // ---------------------------------------------------------------------------
  // 生命周期与监听
  // ---------------------------------------------------------------------------
  // Only visible surfaces own a filter. Each map matches its actual aspect ratio
  // and corner radius; using the largest card's map on every card stretches edges.
  var surfaces = new Map();
  var mapCache = new Map();
  var surfaceSerial = 0;
  var surfaceTimer = 0;
  var resizeObserver = null;
  var mutationObserver = null;
  var pointerFrame = 0;
  var pointerEvent = null;

  function clearSurfaces() {
    surfaces.forEach(function (entry, element) {
      element.style.removeProperty('--glass-filter');
      element.style.removeProperty('--glass-light-x');
      element.style.removeProperty('--glass-light-y');
      if (resizeObserver) resizeObserver.unobserve(element);
      entry.filter.remove();
    });
    surfaces.clear();
  }

  function scheduleSurfaces() {
    if (surfaceTimer) return;
    surfaceTimer = window.setTimeout(function () {
      surfaceTimer = 0;
      syncSurfaces();
    }, 100);
  }

  function syncSurfaces() {
    if (!state.enabled || !state.svg || root().dataset.interface !== 'glass' || window.innerWidth <= 720) {
      clearSurfaces();
      return;
    }
    var visible = new Set();
    document.querySelectorAll(config.surfaceSelector).forEach(function (element) {
      var rect = element.getBoundingClientRect();
      if (rect.width < 32 || rect.height < 32 || rect.bottom < -100 || rect.top > window.innerHeight + 100) return;
      var style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      visible.add(element);
      var width = Math.round(element.offsetWidth || rect.width);
      var height = Math.round(element.offsetHeight || rect.height);
      var radius = parseFloat(style.borderTopLeftRadius) || config.radius;
      var key = [width, height, radius, config.band, config.mapSize, config.filterPadding].join(':');
      var entry = surfaces.get(element);
      if (entry && entry.key === key) return;
      var map = mapCache.get(key);
      if (!map) {
        map = buildMapDataUrl({ width: width, height: height }, radius);
        if (!map) return;
        if (mapCache.size >= 24) mapCache.delete(mapCache.keys().next().value);
        mapCache.set(key, map);
      }
      if (!entry) {
        var filter = state.svg.querySelector('filter').cloneNode(true);
        filter.id = FILTER_ID + '-surface-' + (++surfaceSerial);
        state.svg.querySelector('defs').appendChild(filter);
        entry = { filter: filter, key: key, maxScale: 64 };
        surfaces.set(element, entry);
        if (resizeObserver) resizeObserver.observe(element);
      }
      entry.key = key;
      entry.maxScale = Math.min(config.band * 1.65, Math.min(width, height) * 0.65);
      var image = entry.filter.querySelector('feImage');
      image.setAttribute('href', map);
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', map);
      element.style.setProperty('--glass-filter', 'url(#' + entry.filter.id + ')');
    });
    surfaces.forEach(function (entry, element) {
      if (!visible.has(element)) {
        element.style.removeProperty('--glass-filter');
        if (resizeObserver) resizeObserver.unobserve(element);
        entry.filter.remove();
        surfaces.delete(element);
      }
    });
    applyScale();
  }

  function onPointerMove(event) {
    if (!state.enabled || prefersReducedMotion() || event.pointerType === 'touch' || root().dataset.interface !== 'glass') return;
    pointerEvent = event;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(function () {
      pointerFrame = 0;
      var element = pointerEvent.target.closest && pointerEvent.target.closest(config.surfaceSelector);
      if (!element) return;
      var rect = element.getBoundingClientRect();
      element.style.setProperty('--glass-light-x', ((pointerEvent.clientX - rect.left) / rect.width * 100).toFixed(1) + '%');
      element.style.setProperty('--glass-light-y', ((pointerEvent.clientY - rect.top) / rect.height * 100).toFixed(1) + '%');
    });
  }

  function onPointerOut(event) {
    var element = event.target.closest && event.target.closest(config.surfaceSelector);
    if (element && !element.contains(event.relatedTarget)) {
      element.style.removeProperty('--glass-light-x');
      element.style.removeProperty('--glass-light-y');
    }
  }

  var resizeTimer = 0;

  function onResize() {
    scheduleSurfaces();
    if (!state.enabled) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (!state.enabled) return;
      if (updateReference(false)) applyMap(true);
      applyScale();
    }, 240);
  }

  function onAppearanceChange() {
    scheduleSurfaces();
    if (!state.enabled) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (updateReference(false)) applyMap(true);
      applyScale();
    }, 160);
  }

  function applyAutoPolicy() {
    if (!supported) return;
    var preference = readPreference();
    if (preference === 'on') {
      if (!isEnabled()) enable({ persist: false, silent: true });
      return;
    }
    if (preference === 'off') {
      if (isEnabled()) disable({ persist: false, silent: true });
      return;
    }
    var shouldEnable = !prefersReducedMotion() && !isLowEndDevice();
    if (shouldEnable && !isEnabled()) enable({ persist: false, silent: true });
    else if (!shouldEnable && isEnabled()) disable({ persist: false, silent: true });
  }

  function onStorage(event) {
    if (!event) return;
    if (event.key !== null && event.key !== STORAGE_PREF && event.key !== STORAGE_INTENSITY) return;
    if (event.key === STORAGE_INTENSITY) {
      setIntensity(readIntensity(), { persist: false, silent: true });
      return;
    }
    applyAutoPolicy();
  }

  function onMotionChange() {
    applyAutoPolicy();
  }

  function autoInit() {
    if (!supported) return;
    window.addEventListener('resize', onResize);
    document.addEventListener('appearancechange', onAppearanceChange);
    window.addEventListener('storage', onStorage);
    if (motionQuery) {
      if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onMotionChange);
      else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(onMotionChange);
    }
    if (window.ResizeObserver) resizeObserver = new ResizeObserver(scheduleSurfaces);
    if (window.MutationObserver) {
      mutationObserver = new MutationObserver(function (records) {
        if (records.some(function (record) { return record.target.namespaceURI !== NS; })) scheduleSurfaces();
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('scroll', scheduleSurfaces, { passive: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerOut, { passive: true });
    applyAutoPolicy();
  }

  window.LiquidGlass = Object.freeze({
    version: VERSION,
    supported: supported,
    supportedReason: supportedReason,
    filterId: FILTER_ID,
    filterUrl: FILTER_URL,
    svgId: SVG_ID,
    className: CLASS_NAME,
    storageKeys: Object.freeze({ preference: STORAGE_PREF, intensity: STORAGE_INTENSITY }),
    INTEGRATION_CSS: INTEGRATION_CSS,
    enabled: isEnabled,
    enable: enable,
    disable: disable,
    toggle: toggle,
    setIntensity: setIntensity,
    configure: configure,
    refresh: refresh,
    getState: getState,
    destroy: destroy
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();

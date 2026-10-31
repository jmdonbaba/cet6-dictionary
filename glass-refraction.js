/* ============================================================================
   玻璃折射（液态玻璃）实验模块 —— glass-refraction.js
   ----------------------------------------------------------------------------
   目标：在 Chromium 上给「玻璃质感」界面加一层真实的背景折射，而不扭曲文字。

   原理（已在 Edge / Chromium 实测）：
   - `backdrop-filter: url(#svgFilter)` 无效；但把 `filter: url(#feDisplacementMap)`
     加在**同时拥有 backdrop-filter 的伪元素**上时，Chromium 会先算完磨砂背景，
     再对磨砂结果做像素位移 → 边缘背景被弯折/放大，形成镜片感。
   - 因此本项目 appearance.css 把玻璃层放在 `.card::before` 上（元素背景透明、
     内容压在伪元素之上），本模块只负责提供位移滤镜 + 状态类：
       html.glass-refraction[data-interface="glass"] .card::before {
         filter: url(#cet6-liquid-refract);
       }
     该规则已写在 appearance.css 里，本模块不重复注入业务样式。
   - 位移图由本模块在运行时用 canvas 生成（R=dx, G=dy, 128=中性）：
     只把最外圈「折射带」里的采样点向元素内部推，中心区域保持中性；
     由此文字/内容不受影响，边缘也不会采到元素框外的透明像素（不会出现破洞）。
   - 滤镜区域比元素 bbox 外扩 10%（x/y=-10%、宽高=120%），位移图铺满整个区域、
     外扩部分保持中性：元素自带的 box-shadow 不会被滤镜区域裁掉，也不会被位移。
     （实测 Chromium 里 feImage 的百分比按元素 bbox 解析，所以要用负百分比外扩。）

   对外 API（window.LiquidGlass）：
     supported         Boolean，当前浏览器是否满足「Chromium + CSS filter url + backdrop-filter」
     supportedReason   String，不支持时的原因（not-chromium / no-svg-filter-url / no-backdrop-filter）
     enabled()         Boolean，当前是否已开启（class 是否存在）
     enable(opts)      开启（幂等：重复调用不会重复创建 SVG / 重复生成位移图）
     disable(opts)     关闭（幂等）
     toggle()          切换
     setIntensity(n)   位移强度 0..2（1 = 默认；0 = 不位移但保留状态）
     configure(opts)   调整参数（scale / band / radius / mapSize / filterPadding /
                       calibrate / surfaceSelector / reference），会重建位移图
     refresh()         重新测量主玻璃表面尺寸并重建位移图（布局大改后可手动调用）
     getState()        只读状态快照（调试 / 校验用）
     destroy()         移除 SVG、class、CSS 变量与监听器（测试收尾用）
     filterId / svgId / version / INTEGRATION_CSS  常量，便于集成方引用

   自动开启策略（可在本地记忆后覆盖）：
     - 非 Chromium / 缺少 CSS filter url / 缺少 backdrop-filter → 永不开启；
     - 用户显式开启/关闭过 → 以 localStorage 记忆为准（cet6_liquid_glass = on/off）；
     - 否则默认开启，但以下情况默认关闭：
         * prefers-reduced-motion: reduce（尊重减动效偏好）
         * 低端设备：navigator.hardwareConcurrency <= 4 或 deviceMemory <= 4 或 saveData
     - 自动开启只加 class / 生成滤镜，不改写用户偏好。

   接入建议（已由 appearance.css 实现，模块只提供 class + 滤镜）：
     - 只在「水波」这种有细节的壁纸上开启折射（纯极光渐变上几乎看不出位移，
       反而会让描边出现轻微重影）；
     - 开启时把 --glass-blur 降到 9~12px（模糊越重，边缘弯折越不明显）；
     - 手机（<=720px）关闭 filter。

   已知限制：
     - 只在 Chromium（Blink）内核生效；Safari / Firefox 会判定为不支持。
     - 折射在「有细节的背景」上才明显（水波焦散、条纹、文字），纯色/极缓渐变
       背景几乎看不出来（实测 aurora 壁纸 on/off 像素差异 < 0.5/255）。
     - 每屏同时可见的折射表面建议 <= 4 个（每个表面 = backdrop-filter + SVG 位移）；
       持续动画时实测（Edge headless、1440×900）：1 个表面 ~15ms/帧、3 个 ~21ms、
       6 个 ~29ms、12 个 ~49ms；静态页面几乎无额外每帧开销。
       移动端 / 低端设备默认关闭；appearance.css 在 <=720px 也已把 filter 关掉。
     - 默认参数 scale 48 / band 30（按主玻璃表面尺寸校准，四个边的折射带物理宽度
       一致）；需要更强可 setIntensity(1.2~1.5) 或 configure({ scale: 56, band: 34 })。

   用法：
     <script src="glass-refraction.js"></script>
     // 默认会按策略自动开启；也可显式控制：
     LiquidGlass.enable();
     LiquidGlass.setIntensity(1.2);
     LiquidGlass.disable();
   ========================================================================== */
(function () {
  'use strict';

  // 重复引入时保持第一个实例，避免重复创建 SVG / 重复监听。
  if (window.LiquidGlass) return;

  var VERSION = '1.0.0';
  var CLASS_NAME = 'glass-refraction';
  var ATTR_NAME = 'data-glass-refraction';
  var FILTER_ID = 'cet6-liquid-refract';
  var SVG_ID = 'cet6-liquid-glass-defs';
  var FILTER_URL = 'url(#' + FILTER_ID + ')';
  var STORAGE_PREF = 'cet6_liquid_glass';            // 'on' | 'off'（缺省 = 自动策略）
  var STORAGE_INTENSITY = 'cet6_liquid_glass_intensity';
  var NS = 'http://www.w3.org/2000/svg';
  var MAX_INTENSITY = 2;

  var INTEGRATION_CSS = [
    '/* 推荐：只在有细节的「水波」壁纸上开启折射；开启时降低玻璃模糊 */',
    'html.glass-refraction[data-interface="glass"][data-wallpaper="water"] {',
    '  --glass-blur: blur(11px) saturate(200%) brightness(1.05);',
    '}',
    'html.glass-refraction[data-interface="glass"][data-wallpaper="water"] .card::before,',
    'html.glass-refraction[data-interface="glass"][data-wallpaper="water"] .modal-card::before,',
    'html.glass-refraction[data-interface="glass"][data-wallpaper="water"] .btn-fav-nav::before {',
    '  filter: url(#' + FILTER_ID + ');',
    '}',
    '/* 手机端关闭：每屏可承受的「backdrop-filter + SVG 位移」表面有限 */',
    '@media (max-width: 720px) {',
    '  html.glass-refraction[data-interface="glass"][data-wallpaper="water"] .card::before,',
    '  html.glass-refraction[data-interface="glass"][data-wallpaper="water"] .modal-card::before,',
    '  html.glass-refraction[data-interface="glass"][data-wallpaper="water"] .btn-fav-nav::before {',
    '    filter: none;',
    '  }',
    '}'
  ].join('\n');

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

    var feDisplacement = document.createElementNS(NS, 'feDisplacementMap');
    feDisplacement.setAttribute('in', 'SourceGraphic');
    feDisplacement.setAttribute('in2', 'map');
    feDisplacement.setAttribute('scale', '0');
    feDisplacement.setAttribute('xChannelSelector', 'R');
    feDisplacement.setAttribute('yChannelSelector', 'G');

    filter.appendChild(feImage);
    filter.appendChild(feDisplacement);
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
    return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy);
  }

  function toByte(value) {
    var rounded = Math.round(value);
    return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
  }

  /**
   * 生成位移图（canvas → PNG dataURL）。
   *
   * 约定：R 通道 = x 位移方向，G 通道 = y 位移方向，128 = 中性。
   * 中心区域（离边缘 > band）保持 (128,128,128)；
   * 边缘带内沿「指向元素内部」的法线方向做位移，越靠边强度越大：
   *   位移像素 = scale * (2 * p * n / 255) ≈ (scale/2) * p * n
   * 由于采样点始终朝内部推，SourceGraphic（磨砂背景）不会采到框外透明区域，
   * 因此不会出现透明破洞；同时伪元素上的文字不在滤镜范围内，保持清晰。
   *
   * 位移图覆盖整个滤镜区域（含 filterPadding 外扩），但只有元素 bbox 内才有
   * 位移值，外扩区域保持中性 —— 这样 box-shadow 既不会被区域裁掉，也不会被位移。
   */
  function buildMapDataUrl() {
    var size = Math.round(clamp(config.mapSize, 128, 1024));
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx || !ctx.createImageData) return '';

    var halfWidth = Math.max(1, state.reference.width / 2);
    var halfHeight = Math.max(1, state.reference.height / 2);
    var radius = clamp(config.radius, 0, Math.min(halfWidth, halfHeight));
    var band = Math.max(2, Math.min(config.band, Math.min(halfWidth, halfHeight) * 1.5));
    var padding = clamp(Number(config.filterPadding) || 0, 0, 0.25);
    var regionScale = 1 + padding * 2;
    var image = ctx.createImageData(size, size);
    var data = image.data;
    var amplitude = 127; // 编码幅度：127 → 最大 ±1（feDisplacementMap 再乘 scale）
    var epsilon = Math.max(1, band * 0.25);

    for (var y = 0; y < size; y += 1) {
      // 位移图铺满「滤镜区域」：先换算到元素 bbox 坐标系（px），bbox 外保持中性。
      var py = ((y + 0.5) / size - 0.5) * regionScale * state.reference.height;
      for (var x = 0; x < size; x += 1) {
        var index = (y * size + x) * 4;
        var px = ((x + 0.5) / size - 0.5) * regionScale * state.reference.width;
        if (Math.abs(px) > halfWidth || Math.abs(py) > halfHeight) {
          data[index] = 128;
          data[index + 1] = 128;
          data[index + 2] = 128;
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
          data[index + 2] = 128;
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
        data[index + 2] = 128;
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
      state.feDisplacement.setAttribute('scale', String(scale));
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
    return getState();
  }

  function refresh() {
    if (!state.svg) return false;
    var changed = updateReference(true) || !state.mapReady;
    applyMap(true);
    if (state.enabled) applyScale();
    return changed;
  }

  function toggle(options) {
    return isEnabled() ? disable(options) : enable(options);
  }

  function getState() {
    var connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    return {
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
  var resizeTimer = 0;

  function onResize() {
    if (!state.enabled) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (!state.enabled) return;
      if (updateReference(false)) applyMap(true);
      applyScale();
    }, 240);
  }

  function onAppearanceChange() {
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

#!/usr/bin/env python3
"""Generate an original, seamless shallow-water caustics background.

Design goals
------------
* 清澈青绿浅水 + 阳光焦散：明度整体偏高、对比度低，亮纹是柔和的网状/丝状高光，
  不是规则条纹也不是纯噪声；有大尺度明暗 + 中尺度焦散亮纹 + 细尺度微波纹理。
* 全部由 numpy/Pillow 程序化生成（FFT 频谱合成海浪高度场，再由 Hessian 行列式
  做「光线聚焦」得到 caustics），固定随机种子可复现，**不依赖任何外部图片/网络**。
* 结果天然无缝（所有频率都是整数周期 + FFT 环绕卷积），适合 cover 全屏背景，
  也不会出现平铺接缝。

算法链路
--------
1. `_spectral_field`：白噪声 → rfft2 → 按波长带/方向/功率谱塑形 → irfft2，
   得到周期性、可重复的「海浪高度场 h」。低频谱 = 大涌浪，高频谱 = 细微波纹。
2. `_caustics_from_spectrum`：用高度场的频谱直接求二阶导 hxx/hxy/hyy（解析、无
   数值误差），构造折射映射的雅可比矩阵 J = I + s·Hessian(h)，
   其行列式 det(J) ≈ 0 的位置光线被聚焦 → 用高斯/洛伦兹脊线函数画亮纹。
   倒角宽度由 sigma 控制：sigma 越大亮纹越柔、越像照片；越小越锐利。
3. 两个尺度带各算一张焦散图（大涌浪的宽网状 + 细波的丝状），screen 方式叠加，
   再做轻微模糊/辉光（模拟镜头软焦），避免数字味的硬边。
4. `_colorize`：按亮度在青绿→浅青→奶白→白的调色板插值；再叠加大尺度明暗、
   顶部微暗/底部偏亮的浅水渐变、底部水汽白雾、轻微色相漂移；最后加细噪声和
   抖动（anti-banding）后降采样输出。

Usage
-----
    # 3 组参数候选图 → Cet6Dictionary/.gstack/water/
    python tools/generate-water-caustics.py --preview-all

    # 最终资产 → Cet6Dictionary/assets/water-caustics.webp（≤500KB）
    python tools/generate-water-caustics.py

    # 自定义
    python tools/generate-water-caustics.py --preset clear --width 1920 --height 1280 --out /tmp/x.webp

依赖：Python 3.10+、numpy、Pillow（本项目开发环境自带，无额外安装）。
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# ---------------------------------------------------------------------------
# 路径约定：脚本位于 Cet6Dictionary/tools/，资产输出到 Cet6Dictionary/assets/
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET = ROOT / "assets" / "water-caustics.webp"
CANDIDATE_DIR = ROOT / ".gstack" / "water"

# ---------------------------------------------------------------------------
# 调色板：对应用户参考图的青绿系（sRGB，0-255）
# 亮度 L(0..1) → 颜色。深青绿 → 湖青 → 浅青 → 奶白 → 纯白高光。
# ---------------------------------------------------------------------------
PALETTE_L = np.array([0.00, 0.12, 0.25, 0.40, 0.55, 0.70, 0.84, 0.93, 1.00], dtype=np.float64)
PALETTE_RGB = np.array(
    [
        [42, 102, 148],    # #2a6694 背光深蓝（少量，增加层次）
        [56, 124, 174],    # #387cae
        [74, 148, 198],    # #4a94c6
        [98, 172, 214],    # #62acd6
        [128, 196, 230],   # #80c4e6
        [162, 219, 241],   # #a2dbf1
        [200, 238, 250],   # #c8eefa
        [228, 249, 254],   # #e4f9fe  接近参考图的高光
        [246, 253, 255],   # 近白高光
    ],
    dtype=np.float64,
)

# ---------------------------------------------------------------------------
# 预设参数（--preview-all 会依次生成；最终资产默认用 DEFAULT_PRESET）
# ---------------------------------------------------------------------------
PRESETS: dict[str, dict] = {
    # A. 软焦照片感（默认 / 最终采用）：青绿底 + 细亮焦散网，整体柔和通透
    "soft": dict(
        swell_wl=(320.0, 1200.0),   # 大涌浪波长范围（px，按 1920 宽基准）：只提供大尺度明暗
        medium_wl=(200.0, 700.0),   # 中尺度波：主要焦散网状纹理（越大格子越疏朗）
        medium_sigma=0.30,          # 脊线宽度：越大亮纹越宽越柔
        medium_strength=1.45,       # 折射强度：越大焦散越密
        medium_weight=1.00,
        fine_wl=(40.0, 150.0),      # 细尺度微波：丝状细节
        fine_sigma=0.24,
        fine_strength=1.00,
        fine_weight=0.34,
        micro_wl=(12.0, 44.0),      # 极细微波：给毛玻璃折射提供高频细节
        micro_sigma=0.22,
        micro_strength=0.70,
        micro_weight=0.03,
        ridge_power=1.90,           # >1：把亮纹从“大片泛白”收成细亮线
        ridge_blur=1.50,            # 亮纹软焦（px，渲染分辨率）
        glow=0.22,                  # 亮纹辉光
        crest_weight=0.75,          # 波峰反光层权重（让焦散不全是闭合网格）
        crest_sigma=0.60,
        crest_power=1.80,
        caustic_gain=0.32,          # 亮纹对明度的增益（配合较暗 base 得到“青绿底 + 亮线”）
        base=0.250,                 # 基础明度（水色本体）
        ambient=0.090,              # 大尺度明暗起伏
        tone=0.100,                 # 对角方向的大尺度受光不均
        bottom_light=0.050,         # 底部提亮（浅水更透）
        haze=0.090,                 # 底部水汽白雾
        grain=0.0030,               # 照片颗粒
        saturation=0.99,
        sun=(0.64, 0.18, 0.050),    # 阳光方向光晕（x, y, 强度）
        light_dir=(0.85, -0.53),    # 水面法线着色的光方向
        sheen=0.040,                # 水面微波反光
        sheen_scale=10.0,
        ripple=0.024,               # 细微波纹明暗（丝绸质感）
        ripple_dir=(0.6, 0.8),
        focus_base=0.38,            # 焦散「清晰/失焦」大尺度调制
        focus_range=1.10,
        depth_base=0.12,            # 越靠下越失焦（水更深/更远）
        depth_gain=0.55,
        depth_focus=0.12,
        soft_blur=3.60,
        final_blur=0.85,            # 最终整图轻微软焦，贴近照片
    ),
    # B. 清澈见底：焦散更清晰、线条更细、水色更饱和
    "clear": dict(
        swell_wl=(280.0, 1000.0),
        medium_wl=(160.0, 560.0),
        medium_sigma=0.26,
        medium_strength=1.55,
        medium_weight=1.00,
        fine_wl=(32.0, 120.0),
        fine_sigma=0.21,
        fine_strength=1.05,
        fine_weight=0.40,
        micro_wl=(10.0, 36.0),
        micro_sigma=0.20,
        micro_strength=0.75,
        micro_weight=0.04,
        ridge_power=2.15,
        ridge_blur=1.25,
        glow=0.17,
        crest_weight=0.85,
        crest_sigma=0.55,
        crest_power=2.00,
        caustic_gain=0.37,
        base=0.235,
        ambient=0.085,
        tone=0.090,
        bottom_light=0.045,
        haze=0.070,
        grain=0.0032,
        saturation=1.06,
        sun=(0.66, 0.16, 0.045),
        light_dir=(0.80, -0.60),
        sheen=0.045,
        sheen_scale=11.0,
        ripple=0.026,
        ripple_dir=(0.7, 0.7),
        focus_base=0.34,
        focus_range=1.15,
        depth_base=0.10,
        depth_gain=0.52,
        depth_focus=0.10,
        soft_blur=3.20,
        final_blur=0.60,
    ),
    # C. 蓝调清澈：偏钴蓝/湖蓝的水色，焦散清晰锐利，用作当前默认壁纸
    "blue": dict(
        swell_wl=(300.0, 1100.0),
        medium_wl=(170.0, 600.0),
        medium_sigma=0.24,
        medium_strength=1.58,
        medium_weight=1.00,
        fine_wl=(32.0, 120.0),
        fine_sigma=0.19,
        fine_strength=1.08,
        fine_weight=0.40,
        micro_wl=(10.0, 36.0),
        micro_sigma=0.20,
        micro_strength=0.72,
        micro_weight=0.03,
        ridge_power=2.60,
        ridge_blur=0.70,
        glow=0.06,
        crest_weight=0.50,
        crest_sigma=0.50,
        crest_power=2.05,
        caustic_gain=0.55,
        base=0.190,
        ambient=0.065,
        tone=0.060,
        bottom_light=0.035,
        haze=0.015,
        grain=0.0024,
        saturation=1.08,
        sun=(0.64, 0.16, 0.025),
        light_dir=(0.82, -0.57),
        sheen=0.045,
        sheen_scale=11.0,
        ripple=0.026,
        ripple_dir=(0.7, 0.7),
        focus_base=0.28,
        focus_range=1.15,
        depth_base=0.07,
        depth_gain=0.46,
        depth_focus=0.07,
        soft_blur=1.60,
        final_blur=0.20,
        sharpen=1.3,
        sharpen_percent=110,
        sharpen_threshold=1,
    ),
    # C. 阳光午后：亮纹更亮更聚、下部牛奶感更强、整体更暖更雾
    "sunlit": dict(
        swell_wl=(360.0, 1400.0),
        medium_wl=(260.0, 900.0),
        medium_sigma=0.36,
        medium_strength=1.30,
        medium_weight=1.00,
        fine_wl=(50.0, 170.0),
        fine_sigma=0.28,
        fine_strength=0.95,
        fine_weight=0.30,
        micro_wl=(14.0, 50.0),
        micro_sigma=0.24,
        micro_strength=0.65,
        micro_weight=0.02,
        ridge_power=1.75,
        ridge_blur=1.70,
        glow=0.30,
        crest_weight=0.60,
        crest_sigma=0.66,
        crest_power=1.70,
        caustic_gain=0.28,
        base=0.285,
        ambient=0.100,
        tone=0.110,
        bottom_light=0.060,
        haze=0.120,
        grain=0.0028,
        saturation=0.96,
        sun=(0.72, 0.12, 0.085),
        light_dir=(0.90, -0.44),
        sheen=0.036,
        sheen_scale=9.0,
        ripple=0.022,
        ripple_dir=(0.5, 0.9),
        focus_base=0.42,
        focus_range=1.00,
        depth_base=0.16,
        depth_gain=0.60,
        depth_focus=0.14,
        soft_blur=4.00,
        final_blur=1.10,
    ),
}
DEFAULT_PRESET = "blue"


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def _smoothstep(x: np.ndarray | float) -> np.ndarray | float:
    """三次平滑：把 [0,1] 映射成 0→1 的 S 曲线。"""
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _bandpass(wavelength: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """在 log2 波长域做软带通：带内≈1，带外 0，过渡约 0.5 个八度。

    这样合成的高度场只包含指定尺度，且边界不会出现振铃/硬截止。
    """
    fade = 0.55  # 过渡宽度（octave）
    t_lo = np.clip(np.log2(np.maximum(wavelength, 1e-6) / lo) / fade, 0.0, 1.0)
    t_hi = np.clip(np.log2(hi / np.maximum(wavelength, 1e-6)) / fade, 0.0, 1.0)
    return _smoothstep(t_lo) * _smoothstep(t_hi)


def _rfft_freqs(h: int, w: int) -> tuple[np.ndarray, np.ndarray]:
    """rfft2 的周期频率网格（单位：cycles/px）。"""
    ky = np.fft.fftfreq(h).astype(np.float32)[:, None]
    kx = np.fft.fftfreq(w).astype(np.float32)[: w // 2 + 1][None, :]
    return ky, kx


def _spectral_field(
    rng: np.random.Generator,
    h: int,
    w: int,
    wavelength_min: float,
    wavelength_max: float,
    spectrum_power: float = 2.0,
    anisotropy: float = 0.0,
    direction: float = 0.0,
) -> np.ndarray:
    """用 FFT 合成一张周期性（无缝）的高度场 h，单位方差。

    频谱幅度 ∝ λ^spectrum_power（等价 |k|^-power）：power 越大越强调大尺度涌浪；
    可选各向异性让某个方向的波更多，模拟被风拉长的波纹。
    """
    noise = rng.standard_normal((h, w), dtype=np.float32)
    spectrum = np.fft.rfft2(noise)
    ky, kx = _rfft_freqs(h, w)
    k = np.sqrt(kx * kx + ky * ky, dtype=np.float32)
    k[0, 0] = 1e-6
    wavelength = 1.0 / k
    band = _bandpass(wavelength, wavelength_min, wavelength_max).astype(np.float32)
    # 径向功率谱塑形
    amplitude = np.power(np.maximum(wavelength, 1.0), spectrum_power).astype(np.float32)
    if anisotropy > 0.0:
        theta = np.arctan2(ky, kx)
        direction_weight = 1.0 + anisotropy * np.cos(2.0 * (theta - direction))
        amplitude *= direction_weight
    spectrum *= amplitude * band
    spectrum[0, 0] = 0.0  # 去掉直流分量（整体亮度偏移）
    field = np.fft.irfft2(spectrum, s=(h, w)).astype(np.float32)
    std = float(field.std())
    if std > 1e-8:
        field = (field - field.mean()) / std
    return field.astype(np.float32)


def _blur_periodic(image: np.ndarray, sigma: float) -> np.ndarray:
    """FFT 高斯模糊（周期边界，不破坏无缝性）。sigma 单位：像素。"""
    if sigma <= 0.05:
        return image
    h, w = image.shape
    fy = np.fft.fftfreq(h).astype(np.float32)[:, None]
    fx = np.fft.fftfreq(w).astype(np.float32)[None, :]
    kernel = np.exp(-2.0 * math.pi**2 * sigma**2 * (fx * fx + fy * fy)).astype(np.float32)
    spectrum = np.fft.fft2(image)
    return np.real(np.fft.ifft2(spectrum * kernel)).astype(np.float32)


def _normalize_percentile(image: np.ndarray, lo_pct: float = 12.0, hi_pct: float = 99.4) -> np.ndarray:
    """用百分位做稳健归一化到 [0,1]，避免个别极值把整张图压暗。"""
    lo = float(np.percentile(image, lo_pct))
    hi = float(np.percentile(image, hi_pct))
    if hi - lo < 1e-6:
        hi = lo + 1e-6
    return np.clip((image - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


# ---------------------------------------------------------------------------
# 焦散：高度场 Hessian → 光线聚焦强度
# ---------------------------------------------------------------------------
def _caustics_from_spectrum(
    spectrum: np.ndarray,
    h: int,
    w: int,
    strength: float,
    sigma: float,
    ridge_power: float = 1.0,
    normalize_lo: float = 30.0,
) -> np.ndarray:
    """由高度场频谱直接求 Hessian，再用 det(I + s·Hessian) 的脊线得到焦散图。

    * 位移映射近似为 p' = p + s·∇h，雅可比 J = I + s·H。
    * 光通量守恒 ⇒ 局部亮度 ∝ 1/|det J|；det J≈0 的地方形成亮纹（caustics）。
    * 这里用 C = exp(-(|det J|/sigma)^2) 画「细而亮」的脊线（高斯型，比如 1/(1+x^2)
      尾巴更短，不会让整片水面泛白）；sigma 越大纹路越宽越柔。
    * ridge_power > 1 会把亮纹进一步收细、拉高对比，得到「青绿底 + 细亮线」。
    返回 [0,1] 的亮度图（已做百分位归一化）。
    """
    ky, kx = _rfft_freqs(h, w)
    two_pi = 2.0 * np.pi
    # 二阶偏导的频域权重（解析求导，无差分误差）
    hxx = np.fft.irfft2(spectrum * (-((two_pi * kx) ** 2)).astype(np.complex64), s=(h, w)).astype(np.float32)
    hyy = np.fft.irfft2(spectrum * (-((two_pi * ky) ** 2)).astype(np.complex64), s=(h, w)).astype(np.float32)
    hxy = np.fft.irfft2(spectrum * (-(two_pi * two_pi * kx * ky)).astype(np.complex64), s=(h, w)).astype(np.float32)
    # 用 Hessian 的整体 RMS 归一化，使 strength 与波长尺度无关
    hessian_rms = float(np.sqrt(np.mean(hxx * hxx + hyy * hyy + 2.0 * hxy * hxy)))
    if hessian_rms < 1e-8:
        return np.zeros((h, w), dtype=np.float32)
    scale = strength / hessian_rms
    a = 1.0 + scale * hxx
    d = 1.0 + scale * hyy
    b = scale * hxy
    det = a * d - b * b
    ridge = np.exp(-((np.abs(det) / max(sigma, 1e-4)) ** 2)).astype(np.float32)
    caustic = _normalize_percentile(ridge, normalize_lo, 99.7)
    if ridge_power != 1.0:
        caustic = np.power(caustic, ridge_power, dtype=np.float32)
    return caustic.astype(np.float32)


def _build_caustic_layer(
    rng: np.random.Generator,
    h: int,
    w: int,
    params: dict,
    pixel_scale: float,
) -> tuple[np.ndarray, np.ndarray]:
    """生成焦散层：返回 (caustics 亮度图, 用于水面法线着色的 swell 高度场)。

    焦散只用「中/细/极细」三个尺度带（大涌浪只提供明暗起伏，不参与亮线，否则会
    出现大片泛白）。三个尺度带各自算一张焦散图后 screen 叠加；ridge_power 把亮纹
    收成细线，保证画面是「青绿水面 + 若干亮线」而不是「白底青斑」。
    """
    # 大涌浪：只用于水面法线着色/大尺度明暗，不参与焦散亮线
    swell = _spectral_field(
        rng,
        h,
        w,
        params["swell_wl"][0] * pixel_scale,
        params["swell_wl"][1] * pixel_scale,
        spectrum_power=2.15,
        anisotropy=0.18,
        direction=0.7,
    )

    bands = [
        # (波长范围, sigma, strength, weight, 额外模糊)
        (params["medium_wl"], params["medium_sigma"], params["medium_strength"], params["medium_weight"], 0.9),
        (params["fine_wl"], params["fine_sigma"], params["fine_strength"], params["fine_weight"], 0.75),
        (params["micro_wl"], params["micro_sigma"], params["micro_strength"], params["micro_weight"], 0.6),
    ]
    caustics = np.zeros((h, w), dtype=np.float32)
    for index, (wavelengths, sigma, strength, weight, extra_blur) in enumerate(bands):
        field = _spectral_field(
            rng,
            h,
            w,
            wavelengths[0] * pixel_scale,
            wavelengths[1] * pixel_scale,
            spectrum_power=1.9,
            anisotropy=0.34,
            direction=0.9 + 0.85 * index,
        )
        spectrum = np.fft.rfft2(field)
        layer = _caustics_from_spectrum(
            spectrum,
            h,
            w,
            strength,
            sigma * pixel_scale,
            ridge_power=params["ridge_power"],
        )
        layer = _blur_periodic(layer, extra_blur * params["ridge_blur"] * pixel_scale)
        # 叠一层「波峰反光」：沿波前方向的长丝状亮线（与 determinant 网格互补，
        # 让焦散不全是闭合网格，更像照片里被风拉长的丝状反光）
        crest_weight = params.get("crest_weight", 0.0)
        if crest_weight > 0:
            lx, ly = params.get("crest_dir", (0.8, -0.6))
            gy, gx = np.gradient(_blur_periodic(field, 1.2 * pixel_scale))
            slope = gx * lx + gy * ly
            slope /= float(np.std(slope) + 1e-6)
            crest = np.exp(-(slope / params.get("crest_sigma", 0.55)) ** 2).astype(np.float32)
            crest = _normalize_percentile(crest, 20.0, 99.5)
            crest = np.power(crest, params.get("crest_power", 1.6), dtype=np.float32)
            crest = _blur_periodic(crest, 0.9 * pixel_scale)
            layer = 1.0 - (1.0 - layer) * (1.0 - crest_weight * crest)
        # screen 叠加：1-(1-a)(1-b)，权重控制该尺度参与程度
        caustics = 1.0 - (1.0 - caustics) * (1.0 - weight * layer)
    caustics = np.clip(caustics, 0.0, 1.0).astype(np.float32)

    # 大范围辉光：亮纹周围轻微 blooming，避免数字锐利感
    glow = _blur_periodic(caustics, 7.0 * pixel_scale)
    caustics = np.clip(caustics + params["glow"] * glow, 0.0, 1.2).astype(np.float32)
    return caustics, swell


# ---------------------------------------------------------------------------
# 合成最终 RGB
# ---------------------------------------------------------------------------
def _lerp_palette(level: np.ndarray) -> np.ndarray:
    """按亮度在调色板上分段线性插值，返回 shape=(H,W,3) 的 float RGB（0..1）。"""
    level = np.clip(level, 0.0, 1.0)
    rgb = np.empty(level.shape + (3,), dtype=np.float32)
    for channel in range(3):
        rgb[..., channel] = np.interp(
            level, PALETTE_L, PALETTE_RGB[:, channel] / 255.0
        ).astype(np.float32)
    return rgb


def generate(
    preset: str = DEFAULT_PRESET,
    width: int = 1920,
    height: int = 1280,
    seed: int = 20261101,
    supersample: float = 1.5,
) -> Image.Image:
    """生成一张水波焦散背景，返回 PIL RGB 图像（目标分辨率）。"""
    if preset not in PRESETS:
        raise SystemExit(f"未知预设：{preset}，可选 {list(PRESETS)}")
    params = PRESETS[preset]
    rng = np.random.default_rng(seed)

    render_w = int(round(width * supersample))
    render_h = int(round(height * supersample))
    pixel_scale = render_w / 1920.0  # 让参数里的 px 数值以 1920 宽为基准，随分辨率缩放

    # 坐标网格（0..1）
    ys = np.linspace(0.0, 1.0, render_h, dtype=np.float32)[:, None]
    xs = np.linspace(0.0, 1.0, render_w, dtype=np.float32)[None, :]

    # ---------------- 1) 焦散层 ----------------
    caustics, broad = _build_caustic_layer(rng, render_h, render_w, params, pixel_scale)

    # 1b) 聚焦/失焦调制：真实照片里亮纹不是均匀铺满画面——
    #     有的区域清晰锐利，有的区域被水雾糊掉；越靠画面下方（水更深/更远）越柔。
    focus_field = _spectral_field(
        rng,
        render_h,
        render_w,
        450.0 * pixel_scale,
        1500.0 * pixel_scale,
        spectrum_power=2.1,
        anisotropy=0.0,
    )
    focus_field = _blur_periodic(focus_field, 18.0 * pixel_scale)
    focus_norm = _smoothstep((focus_field + 0.7) / 1.4)  # 大致映射到 0..1
    focus = (params.get("focus_base", 0.52) + params.get("focus_range", 0.85) * focus_norm).astype(np.float32)
    caustics *= focus
    depth = _smoothstep((ys - 0.10) / 0.90).astype(np.float32)  # 越靠下越失焦
    soft_caustics = _blur_periodic(caustics, params.get("soft_blur", 3.2) * pixel_scale)
    depth_mask = np.clip(
        params.get("depth_base", 0.08)
        + params.get("depth_gain", 0.55) * depth
        + params.get("depth_focus", 0.10) * focus_field,
        0.02,
        0.90,
    ).astype(np.float32)
    caustics = caustics * (1.0 - depth_mask) + soft_caustics * depth_mask
    caustics = np.clip(caustics, 0.0, 1.2).astype(np.float32)

    # ---------------- 2) 大尺度明暗 / 光晕 / 渐变 ----------------
    # 低频明暗场（比涌浪更大尺度，像水底地形/云影）
    ambient = _spectral_field(
        rng,
        render_h,
        render_w,
        500.0 * pixel_scale,
        2000.0 * pixel_scale,
        spectrum_power=2.2,
        anisotropy=0.0,
    )
    ambient = _blur_periodic(ambient, 12.0 * pixel_scale)
    ambient = np.clip(ambient / (np.std(ambient) + 1e-6), -2.5, 2.5).astype(np.float32)

    # 阳光方向的大范围光晕（参考图的光从画面上方偏右洒下来）
    sun_x, sun_y, sun_strength = params["sun"]
    dist2 = (xs - sun_x) ** 2 + (ys - sun_y) ** 2
    sun = (sun_strength * np.exp(-dist2 / (2.0 * 0.52**2))).astype(np.float32)

    # 顶部略深、底部略亮（浅水透光感）
    vertical = (ys - 0.5).astype(np.float32) * params["bottom_light"]

    # 对角方向的大尺度明暗（让画面不是一块纯色，接近照片的受光不均）
    tone = (params.get("tone", 0.0) * (0.55 * (ys - 0.5) + 0.45 * (xs - 0.5))).astype(np.float32)

    # 水面法线着色：低频高度场的坡面把光“扫”成柔和的明暗条带
    broad_h = _blur_periodic(broad, 8.0 * pixel_scale)
    gy, gx = np.gradient(broad_h)  # 注意 numpy 的 axis 顺序：gy 是沿行、gx 是沿列
    lx, ly = params["light_dir"]
    normal_light = np.clip((gx * lx + gy * ly) * params.get("sheen_scale", 6.0), -2.5, 2.5).astype(np.float32)
    sheen = (normal_light * params["sheen"]).astype(np.float32)

    # 细微波纹的反光/阴影（像照片里水面的丝绸质感）：高频坡面明暗，低对比
    ripple = _spectral_field(
        rng,
        render_h,
        render_w,
        14.0 * pixel_scale,
        70.0 * pixel_scale,
        spectrum_power=1.5,
        anisotropy=0.25,
        direction=1.7,
    )
    ripple = _blur_periodic(ripple, 1.2 * pixel_scale)
    rgx, rgy = np.gradient(ripple)
    ripple_slope = rgx * params.get("ripple_dir", (0.6, 0.8))[0] + rgy * params.get("ripple_dir", (0.6, 0.8))[1]
    ripple_slope = np.clip(ripple_slope / (float(np.std(ripple_slope)) + 1e-6), -2.2, 2.2).astype(np.float32)
    ripple_shade = (ripple_slope * params.get("ripple", 0.0)).astype(np.float32)

    # ---------------- 3) 亮度合成 ----------------
    level = (
        params["base"]
        + params["ambient"] * ambient
        + params["caustic_gain"] * caustics
        + sun
        + vertical
        + tone
        + sheen
        + ripple_shade
    )
    # 底部水汽白雾：把暗部提亮、对比降低，形成“清水见底”的乳白感
    haze = (_smoothstep((ys - 0.42) / 0.58) * params["haze"]).astype(np.float32)
    level = level * (1.0 - haze) + 0.93 * haze
    level = np.clip(level, 0.0, 1.10).astype(np.float32)

    # ---------------- 4) 上色 + 细微色相漂移 ----------------
    rgb = _lerp_palette(level)
    hue_field = _spectral_field(
        rng,
        render_h,
        render_w,
        700.0 * pixel_scale,
        1600.0 * pixel_scale,
        spectrum_power=2.4,
        anisotropy=0.0,
    )
    hue_field = np.clip(_blur_periodic(hue_field, 10.0 * pixel_scale), -1.5, 1.5)
    # 轻微的青↔绿漂移（+G / -B 表示更绿，反之更蓝）
    rgb[..., 0] *= 1.0 + 0.010 * hue_field
    rgb[..., 1] *= 1.0 + 0.016 * hue_field
    rgb[..., 2] *= 1.0 - 0.012 * hue_field
    # 轻微提高通透感（围绕中间灰拉一点对比，不破坏柔和）
    rgb = 0.5 + (rgb - 0.5) * params["saturation"]
    rgb = np.clip(rgb, 0.0, 1.0)

    # ---------------- 5) 降采样 + 颗粒 + 抖动 ----------------
    # 先在渲染分辨率加 0.5LSB 抖动，再 LANCZOS 降采样：双重抑制色带
    dither = rng.uniform(-0.5 / 255.0, 0.5 / 255.0, size=rgb.shape).astype(np.float32)
    rgb8 = np.clip((rgb + dither) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    image = Image.fromarray(rgb8, mode="RGB").resize((width, height), Image.LANCZOS)
    final_blur = params.get("final_blur", 0.0)
    if final_blur > 0:
        image = image.filter(ImageFilter.GaussianBlur(final_blur))

    # 清晰度：轻微 USM 让焦散亮边更利落（只增强边缘，不改变水体明暗结构）
    sharpen = params.get("sharpen", 0.0)
    if sharpen > 0:
        image = image.filter(ImageFilter.UnsharpMask(
            radius=sharpen,
            percent=int(params.get("sharpen_percent", 80)),
            threshold=int(params.get("sharpen_threshold", 2)),
        ))

    # 最终轻微颗粒（照片感 + 进一步 dither）
    final = np.asarray(image, dtype=np.float32) / 255.0
    grain = rng.normal(0.0, params["grain"], size=final.shape).astype(np.float32)
    final = np.clip(final + grain, 0.0, 1.0)
    return Image.fromarray(np.clip(final * 255.0 + 0.5, 0, 255).astype(np.uint8), mode="RGB")


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------
def save_webp_under(image: Image.Image, path: Path, max_bytes: int = 500 * 1024) -> int:
    """保存 WebP；从高质量往下降，直到体积 ≤ max_bytes。返回实际字节数。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    for quality in (92, 89, 86, 83, 80, 77, 74, 71, 68, 65, 60):
        image.save(path, format="WEBP", quality=quality, method=6)
        size = path.stat().st_size
        if size <= max_bytes:
            return size
    return path.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser(description="生成原创水波焦散背景（无缝、可复现）")
    parser.add_argument("--preset", default=DEFAULT_PRESET, choices=sorted(PRESETS), help="参数预设")
    parser.add_argument("--width", type=int, default=1920, help="输出宽度（默认 1920）")
    parser.add_argument("--height", type=int, default=1280, help="输出高度（默认 1280）")
    parser.add_argument("--seed", type=int, default=20261101, help="随机种子（可复现）")
    parser.add_argument("--supersample", type=float, default=1.5, help="超采样倍数（>=1.0）")
    parser.add_argument("--out", type=Path, default=DEFAULT_ASSET, help="输出文件（.webp/.jpg/.png）")
    parser.add_argument("--preview-all", action="store_true", help="生成全部候选图到 .gstack/water/ 并退出")
    parser.add_argument("--preview-size", type=int, default=1200, help="候选图短边尺寸（默认 1200，3:2 横图）")
    parser.add_argument("--candidate-dir", type=Path, default=CANDIDATE_DIR, help="候选图输出目录（默认 .gstack/water/）")
    args = parser.parse_args()

    if args.preview_all:
        args.candidate_dir.mkdir(parents=True, exist_ok=True)
        for name in PRESETS:
            preview_h = args.preview_size
            preview_w = int(round(preview_h * 3 / 2))  # 3:2 横图，与最终资产比例一致
            image = generate(preset=name, width=preview_w, height=preview_h, seed=args.seed, supersample=args.supersample)
            path = args.candidate_dir / f"candidate-{name}.png"
            image.save(path, format="PNG", optimize=True)
            print(f"[candidate] {name}: {path}  {image.width}x{image.height}  {path.stat().st_size / 1024:.0f} KB")
        print(f"\n候选图目录：{args.candidate_dir}")
        return

    image = generate(
        preset=args.preset,
        width=args.width,
        height=args.height,
        seed=args.seed,
        supersample=args.supersample,
    )
    out = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".webp":
        size = save_webp_under(image, out, max_bytes=500 * 1024)
    else:
        image.save(out)
        size = out.stat().st_size
    print(f"[asset] {out}  {image.width}x{image.height}  {size / 1024:.1f} KB  preset={args.preset} seed={args.seed}")


if __name__ == "__main__":
    main()

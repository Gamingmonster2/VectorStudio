/**
 * mkbitmap.js
 * Faithful JavaScript implementation of Peter Selinger's mkbitmap algorithms (from Potrace project):
 * - Greyscale conversion & optional inversion
 * - Exact 2-pass recursive IIR lowpass / Gaussian filter as implemented in mkbitmap.c
 * - Highpass filter normalization: original - lowpass + 128
 * - High-quality interpolated scaling (1x, 2x, 3x, 4x)
 * - Bilevel thresholding (black & white extraction)
 * - Optional color quantization for multi-color tracing
 */

/**
 * Peter Selinger's recursive IIR lowpass filter from mkbitmap.c
 * Lambda is the standard deviation (radius) of the filter kernel.
 */
function selingerLowpass(src, w, h, lambda) {
  if (w === 0 || h === 0 || lambda <= 0) {
    return new Float64Array(src);
  }

  const out = new Float64Array(src);
  const B = 1 + 2 / (lambda * lambda);
  const c = B - Math.sqrt(B * B - 1);
  const d = 1 - c;

  // Filter rows
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    let f = 0, g = 0;

    // Left to right
    for (let x = 0; x < w; x++) {
      f = f * c + out[rowOffset + x] * d;
      g = g * c + f * d;
      out[rowOffset + x] = g;
    }
    // Right to left
    for (let x = w - 1; x >= 0; x--) {
      f = f * c + out[rowOffset + x] * d;
      g = g * c + f * d;
      out[rowOffset + x] = g;
    }
    // Left to right mop-up
    for (let x = 0; x < w; x++) {
      f = f * c;
      g = g * c + f * d;
      if (f + g < 1 / 255.0) break;
      out[rowOffset + x] += g;
    }
  }

  // Filter columns
  for (let x = 0; x < w; x++) {
    let f = 0, g = 0;

    // Bottom to top
    for (let y = 0; y < h; y++) {
      const idx = y * w + x;
      f = f * c + out[idx] * d;
      g = g * c + f * d;
      out[idx] = g;
    }
    // Top to bottom
    for (let y = h - 1; y >= 0; y--) {
      const idx = y * w + x;
      f = f * c + out[idx] * d;
      g = g * c + f * d;
      out[idx] = g;
    }
    // Bottom to top mop-up
    for (let y = 0; y < h; y++) {
      const idx = y * w + x;
      f = f * c;
      g = g * c + f * d;
      if (f + g < 1 / 255.0) break;
      out[idx] += g;
    }
  }

  return out;
}

/**
 * Peter Selinger's Highpass filter:
 * highpass = original - lowpass(original, lambda) + 128
 */
function applyHighpass(grey, w, h, lambda) {
  if (lambda <= 0) return new Float64Array(grey);
  const low = selingerLowpass(grey, w, h, lambda);
  const out = new Float64Array(w * h);

  for (let i = 0; i < out.length; i++) {
    let val = grey[i] - low[i] + 128;
    out[i] = Math.max(0, Math.min(255, val));
  }
  return out;
}

/**
 * Bilinear interpolated scaling (as performed by mkbitmap -s N)
 */
function scaleGreymap(src, w, h, scale) {
  if (scale <= 1) return { data: src, w, h };

  const dstW = Math.floor(w * scale);
  const dstH = Math.floor(h * scale);
  const out = new Float64Array(dstW * dstH);

  const xRatio = (w - 1) / Math.max(1, dstW - 1);
  const yRatio = (h - 1) / Math.max(1, dstH - 1);

  for (let y = 0; y < dstH; y++) {
    const srcY = y * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, h - 1);
    const yFrac = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, w - 1);
      const xFrac = srcX - x0;

      const p00 = src[y0 * w + x0];
      const p10 = src[y0 * w + x1];
      const p01 = src[y1 * w + x0];
      const p11 = src[y1 * w + x1];

      const top = p00 + (p10 - p00) * xFrac;
      const btm = p01 + (p11 - p01) * xFrac;
      out[y * dstW + x] = top + (btm - top) * yFrac;
    }
  }

  return { data: out, w: dstW, h: dstH };
}

/**
 * Main mkbitmap preprocessor
 */
export function preprocessMkbitmap(imageData, options = {}) {
  const {
    filter = 2,          // -f radius (default 2 for comics)
    blur = 0,            // -b blur radius (optional noise smoothing)
    threshold = 0.48,    // -t threshold (default 0.48 as shown in video)
    invert = false,      // -i invert
    scale = 2,           // -s scale factor (default 2x for smooth curves)
    mode = 'monochrome', // 'monochrome' or 'color'
    posterizeLevel = 5
  } = options;

  const w = imageData.width;
  const h = imageData.height;
  const src = imageData.data;

  // Color Mode Handler
  if (mode === 'color') {
    return processColorPosterization(imageData, { invert, scale, posterizeLevel });
  }

  // Monochrome mkbitmap Pipeline:
  // Step 1: Greyscale conversion
  const len = w * h;
  let grey = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    let lum = 0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2];
    if (invert) lum = 255 - lum;
    grey[i] = lum;
  }

  // Step 2: Highpass filter
  if (filter > 0) {
    grey = applyHighpass(grey, w, h, filter);
  }

  // Step 3: Noise blur (if any)
  if (blur > 0) {
    grey = selingerLowpass(grey, w, h, blur);
  }

  // Step 4: Scaling (-s)
  let scaledW = w;
  let scaledH = h;
  let scaledData = grey;

  if (scale > 1) {
    const scaled = scaleGreymap(grey, w, h, scale);
    scaledW = scaled.w;
    scaledH = scaled.h;
    scaledData = scaled.data;
  }

  // Step 5: Thresholding (-t)
  const threshVal = threshold * 255;
  const totalPixels = scaledW * scaledH;
  const outData = new Uint8ClampedArray(totalPixels * 4);

  for (let i = 0; i < totalPixels; i++) {
    const isBlack = scaledData[i] < threshVal;
    const val = isBlack ? 0 : 255;
    const idx = i * 4;
    outData[idx] = val;
    outData[idx + 1] = val;
    outData[idx + 2] = val;
    outData[idx + 3] = 255;
  }

  return new ImageData(outData, scaledW, scaledH);
}

/**
 * Multi-color posterization
 */
function processColorPosterization(imageData, { invert, scale, posterizeLevel }) {
  const w = imageData.width;
  const h = imageData.height;
  const dstW = Math.floor(w * scale);
  const dstH = Math.floor(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(imageData, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(srcCanvas, 0, 0, dstW, dstH);

  const result = ctx.getImageData(0, 0, dstW, dstH);
  const d = result.data;
  const step = 255 / Math.max(1, posterizeLevel - 1);

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
      continue;
    }

    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    if (invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    if (posterizeLevel > 1) {
      r = Math.round(Math.round(r / step) * step);
      g = Math.round(Math.round(g / step) * step);
      b = Math.round(Math.round(b / step) * step);
    }

    d[i] = Math.min(255, Math.max(0, r));
    d[i + 1] = Math.min(255, Math.max(0, g));
    d[i + 2] = Math.min(255, Math.max(0, b));
    d[i + 3] = 255;
  }

  return result;
}

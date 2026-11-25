import * as THREE from 'three';

export const WATERCOLOR_TIME_UNIFORM: { value: number } = { value: 0 };

export function setWatercolorTime(timeSec: number): void {
  WATERCOLOR_TIME_UNIFORM.value = timeSec;
}

function hash2i(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function modInt(n: number, p: number): number {
  const m = n % p;
  return m < 0 ? m + p : m;
}

function tileableValueNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const x0 = modInt(ix, period);
  const x1 = modInt(ix + 1, period);
  const y0 = modInt(iy, period);
  const y1 = modInt(iy + 1, period);

  const a = hash2i(x0, y0, seed);
  const b = hash2i(x1, y0, seed);
  const c = hash2i(x0, y1, seed);
  const d = hash2i(x1, y1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

export function tileableFbm(u: number, v: number, basePeriod: number, seed: number): number {
  let sum = 0;
  let amp = 0.52;
  let freq = basePeriod;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += tileableValueNoise(u * freq, v * freq, freq, seed + o * 97) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function seededRand(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function bakePaperTileTexture(): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const coarse = tileableFbm(u, v, 8, 17);
      const medium = tileableFbm(u, v, 24, 53);
      const fine = tileableValueNoise(u * 96, v * 96, 96, 131);
      // Crossed cotton paper fibers + fine cold-press tooth
      const h = coarse * 0.45 + medium * 0.35 + fine * 0.2;
      heights[y * size + x] = h;
    }
  }

  for (let y = 0; y < size; y++) {
    const yPrev = modInt(y - 1, size);
    const yNext = modInt(y + 1, size);
    for (let x = 0; x < size; x++) {
      const xPrev = modInt(x - 1, size);
      const xNext = modInt(x + 1, size);
      const h = heights[y * size + x]!;
      const dx = heights[y * size + xNext]! - heights[y * size + xPrev]!;
      const dy = heights[yNext * size + x]! - heights[yPrev * size + x]!;
      // 135-deg top-left emboss light direction
      const emboss = (-dx - dy) * 1.8;
      const tone = Math.max(0, Math.min(255, Math.round(128 + (h - 0.5) * 64 + emboss * 44)));
      const warmShift = Math.round((h - 0.5) * 10);
      const idx = (y * size + x) * 4;
      data[idx] = Math.max(0, Math.min(255, tone + warmShift));
      data[idx + 1] = tone;
      data[idx + 2] = Math.max(0, Math.min(255, tone + 8 - warmShift));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function bakePaperCloudTexture(): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size);
  ctx.fillStyle = '#0e1424';
  ctx.fillRect(0, 0, size, size);

  const rand = seededRand(4021);
  // Deep indigo/navy watercolor washes concentrated subtly around margins and across substrate
  for (let i = 0; i < 48; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = (0.15 + rand() * 0.45) * size;
    const cx = size * 0.5 + Math.cos(angle) * dist;
    const cy = size * 0.5 + Math.sin(angle) * dist;
    const r = 65 + rand() * 145;
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    const isLight = i % 3 === 0;
    g.addColorStop(0, isLight ? 'rgba(28, 42, 74, 0.22)' : 'rgba(6, 9, 18, 0.34)');
    g.addColorStop(0.65, isLight ? 'rgba(18, 28, 52, 0.10)' : 'rgba(8, 12, 22, 0.16)');
    g.addColorStop(1, 'rgba(11, 15, 26, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Soft perimeter frame darkening like damp midnight paper corners
  const edgeGrad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.24, size * 0.5, size * 0.5, size * 0.68);
  edgeGrad.addColorStop(0, 'rgba(14, 20, 36, 0)');
  edgeGrad.addColorStop(1, 'rgba(5, 7, 15, 0.52)');
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function generateStarburstAngles(seed: number): Array<{ a: number; r: number }> {
  const rand = seededRand(seed);
  const spikes = 14 + Math.floor(rand() * 4) * 2; // 14..20 alternating spikes
  const pts: Array<{ a: number; r: number }> = [];
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + (rand() - 0.5) * 0.14;
    const isOuter = i % 2 === 0;
    const r = isOuter ? 0.68 + rand() * 0.24 : 0.28 + rand() * 0.14;
    pts.push({ a, r });
  }
  return pts;
}

function bakeStarburstPair(variantIdx: number): { wash: THREE.CanvasTexture; ink: THREE.CanvasTexture } {
  const size = 256;
  const half = size * 0.5;
  const maxR = half * 0.86;
  const seed = 9100 + variantIdx * 313;
  const basePts = generateStarburstAngles(seed);
  const rand = seededRand(seed + 71);

  const [washCanvas, wCtx] = makeCanvas(size);
  const [inkCanvas, iCtx] = makeCanvas(size);

  // Layer 20 stacked perturbed semi-transparent watercolor passes into R/G/B/A mask
  // R = outer fringe, G = mid wash, B = inner core, A = organic feathered wash alpha
  const [, bCtx] = makeCanvas(size);
  for (let pass = 0; pass < 20; pass++) {
    const scaleJitter = 0.92 + rand() * 0.16;
    bCtx.beginPath();
    for (let i = 0; i < basePts.length; i++) {
      const p = basePts[i]!;
      const pr = p.r * maxR * scaleJitter * (0.94 + rand() * 0.12);
      const px = half + Math.cos(p.a) * pr + (rand() - 0.5) * 6;
      const py = half + Math.sin(p.a) * pr + (rand() - 0.5) * 6;
      if (i === 0) bCtx.moveTo(px, py);
      else bCtx.lineTo(px, py);
    }
    bCtx.closePath();
    bCtx.fillStyle = 'rgba(255, 255, 255, 0.068)';
    bCtx.fill();
  }

  // Wet outer watercolor splatter lobes outside main spikes
  for (let s = 0; s < 16; s++) {
    const a = rand() * Math.PI * 2;
    const d = maxR * (0.55 + rand() * 0.42);
    const sr = 6 + rand() * 14;
    const g = bCtx.createRadialGradient(
      half + Math.cos(a) * d,
      half + Math.sin(a) * d,
      1,
      half + Math.cos(a) * d,
      half + Math.sin(a) * d,
      sr
    );
    g.addColorStop(0, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    bCtx.fillStyle = g;
    bCtx.beginPath();
    bCtx.arc(half + Math.cos(a) * d, half + Math.sin(a) * d, sr, 0, Math.PI * 2);
    bCtx.fill();
  }

  const rawBody = bCtx.getImageData(0, 0, size, size);
  const washImg = wCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const alphaNorm = (rawBody.data[idx + 3] ?? 0) / 255;
      if (alphaNorm <= 0.01) continue;
      const dx = (x - half) / maxR;
      const dy = (y - half) / maxR;
      const r = Math.hypot(dx, dy);
      const grain = 0.8 + 0.35 * tileableValueNoise(x / 6, y / 6, 48, 221 + variantIdx);
      const midBand = Math.max(0, Math.min(1, 1 - Math.abs(r - 0.36) * 2.1));
      const core = Math.max(0, Math.min(1, 1 - r / 0.34));
      const edgePool = Math.max(0, Math.min(1, 1 - Math.abs(alphaNorm - 0.38) * 3.0));

      washImg.data[idx] = Math.round(Math.min(1, alphaNorm * grain + edgePool * 0.3) * 255);
      washImg.data[idx + 1] = Math.round(Math.min(1, midBand * alphaNorm * 1.3) * 255);
      washImg.data[idx + 2] = Math.round(Math.min(1, core * core * 1.15) * 255);
      washImg.data[idx + 3] = Math.round(Math.min(1, alphaNorm * 1.18) * 255);
    }
  }
  wCtx.putImageData(washImg, 0, 0);

  // Matching jagged sumi-e ink outline with variable stroke width & overshot spikes
  iCtx.strokeStyle = '#08090d';
  iCtx.fillStyle = '#08090d';
  iCtx.lineCap = 'round';
  iCtx.lineJoin = 'round';
  for (let i = 0; i < basePts.length; i++) {
    const p1 = basePts[i]!;
    const p2 = basePts[(i + 1) % basePts.length]!;
    const x1 = half + Math.cos(p1.a) * p1.r * maxR * 0.94;
    const y1 = half + Math.sin(p1.a) * p1.r * maxR * 0.94;
    const x2 = half + Math.cos(p2.a) * p2.r * maxR * 0.94;
    const y2 = half + Math.sin(p2.a) * p2.r * maxR * 0.94;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLen = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / segLen;
    const uy = dy / segLen;
    const ov = i % 2 === 0 ? 4.5 : 2.5;
    const sx = x1 - ux * ov;
    const sy = y1 - uy * ov;
    const ex = x2 + ux * ov;
    const ey = y2 + uy * ov;
    const nx = -uy;
    const ny = ux;
    const midBend = (rand() - 0.5) * 4.5;

    iCtx.lineWidth = 2.6 + rand() * 2.4;
    iCtx.beginPath();
    iCtx.moveTo(sx, sy);
    iCtx.quadraticCurveTo((sx + ex) * 0.5 + nx * midBend, (sy + ey) * 0.5 + ny * midBend, ex, ey);
    iCtx.stroke();
  }

  // Scattered radial black ink splatter droplets etched into ink stamp
  for (let d = 0; d < 24; d++) {
    const a = rand() * Math.PI * 2;
    const dist = maxR * (0.58 + rand() * 0.48);
    const rx = 1.6 + rand() * 3.8;
    const ry = 1.0 + rand() * 2.0;
    iCtx.save();
    iCtx.translate(half + Math.cos(a) * dist, half + Math.sin(a) * dist);
    iCtx.rotate(a);
    iCtx.beginPath();
    iCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    iCtx.fill();
    iCtx.restore();
  }

  const wash = new THREE.CanvasTexture(washCanvas);
  wash.needsUpdate = true;
  const ink = new THREE.CanvasTexture(inkCanvas);
  ink.needsUpdate = true;
  return { wash, ink };
}

function bakeSplatterWashTexture(variantIdx: number): THREE.CanvasTexture {
  const size = 256;
  const half = size * 0.5;
  const rand = seededRand(5300 + variantIdx * 197);
  const [rawCanvas, rCtx] = makeCanvas(size);

  const lobes = 16;
  const radii: number[] = [];
  for (let i = 0; i < lobes; i++) {
    radii.push(half * (0.48 + rand() * 0.34));
  }

  for (let pass = 0; pass < 18; pass++) {
    rCtx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const idx = i % lobes;
      const next = (i + 1) % lobes;
      const a0 = (idx / lobes) * Math.PI * 2;
      const a1 = (next / lobes) * Math.PI * 2;
      const r0 = radii[idx]! * (0.9 + rand() * 0.2);
      const r1 = radii[next]! * (0.9 + rand() * 0.2);
      const x0 = half + Math.cos(a0) * r0;
      const y0 = half + Math.sin(a0) * r0;
      const x1 = half + Math.cos(a1) * r1;
      const y1 = half + Math.sin(a1) * r1;
      if (i === 0) rCtx.moveTo(x0, y0);
      rCtx.quadraticCurveTo(x0, y0, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
    }
    rCtx.closePath();
    rCtx.fillStyle = 'rgba(255,255,255,0.072)';
    rCtx.fill();
  }

  // Satellite watercolor drops
  for (let d = 0; d < 18; d++) {
    const a = rand() * Math.PI * 2;
    const dist = half * (0.58 + rand() * 0.34);
    const rr = 3 + rand() * 8;
    rCtx.fillStyle = 'rgba(255,255,255,0.38)';
    rCtx.beginPath();
    rCtx.arc(half + Math.cos(a) * dist, half + Math.sin(a) * dist, rr, 0, Math.PI * 2);
    rCtx.fill();
  }

  const src = rCtx.getImageData(0, 0, size, size);
  const [outCanvas, oCtx] = makeCanvas(size);
  const out = oCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const a = (src.data[idx + 3] ?? 0) / 255;
      if (a < 0.01) continue;
      const grain = 0.78 + 0.36 * tileableValueNoise(x / 7, y / 7, 40, 611 + variantIdx);
      const pool = Math.max(0, Math.min(1, 1 - Math.abs(a - 0.35) * 3.2));
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const core = Math.max(0, 1 - Math.hypot(dx, dy) * 1.45);
      out.data[idx] = Math.round(Math.min(1, a * grain) * 255);
      out.data[idx + 1] = Math.round(pool * 255);
      out.data[idx + 2] = Math.round(core * 255);
      out.data[idx + 3] = Math.round(Math.min(1, a * 1.15) * 255);
    }
  }
  oCtx.putImageData(out, 0, 0);
  void rawCanvas;
  const tex = new THREE.CanvasTexture(outCanvas);
  tex.needsUpdate = true;
  return tex;
}

function bakeInkDropletTexture(): THREE.CanvasTexture {
  const size = 64;
  const [canvas, ctx] = makeCanvas(size);
  const c = size * 0.5;
  ctx.fillStyle = '#08090d';
  ctx.beginPath();
  ctx.moveTo(c + 20, c);
  ctx.bezierCurveTo(c + 12, c + 12, c - 8, c + 14, c - 18, c + 4);
  ctx.bezierCurveTo(c - 22, c - 6, c - 6, c - 15, c + 10, c - 9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c - 15, c - 11, 3.2, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function bakeBrushStrokeTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ny = (y / (h - 1)) * 2 - 1;
    const cross = Math.exp(-ny * ny * 3.6);
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1);
      const endEnv = Math.sin(nx * Math.PI);
      const bristle = 0.72 + 0.28 * Math.sin(ny * 14 + nx * 9);
      const grain = 0.8 + 0.2 * tileableValueNoise(x / 5, y / 3, 32, 811);
      const val = Math.max(0, Math.min(1, cross * Math.pow(endEnv, 0.45) * bristle * grain));
      const idx = (y * w + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(val * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export interface WatercolorAssets {
  paperTileTex: THREE.CanvasTexture;
  paperCloudTex: THREE.CanvasTexture;
  starburstWashTextures: THREE.CanvasTexture[];
  starburstInkTextures: THREE.CanvasTexture[];
  splatterWashTextures: THREE.CanvasTexture[];
  inkDropletTex: THREE.CanvasTexture;
  brushStrokeTex: THREE.CanvasTexture;
}

let cachedAssets: WatercolorAssets | null = null;

export function getWatercolorAssets(): WatercolorAssets {
  if (cachedAssets) return cachedAssets;
  const starburstWashTextures: THREE.CanvasTexture[] = [];
  const starburstInkTextures: THREE.CanvasTexture[] = [];
  for (let i = 0; i < 6; i++) {
    const pair = bakeStarburstPair(i);
    starburstWashTextures.push(pair.wash);
    starburstInkTextures.push(pair.ink);
  }
  const splatterWashTextures: THREE.CanvasTexture[] = [];
  for (let i = 0; i < 4; i++) {
    splatterWashTextures.push(bakeSplatterWashTexture(i));
  }
  cachedAssets = {
    paperTileTex: bakePaperTileTexture(),
    paperCloudTex: bakePaperCloudTexture(),
    starburstWashTextures,
    starburstInkTextures,
    splatterWashTextures,
    inkDropletTex: bakeInkDropletTexture(),
    brushStrokeTex: bakeBrushStrokeTexture(),
  };
  return cachedAssets;
}

export interface PolygonWashStamp {
  texture: THREE.CanvasTexture;
  size: number;
  centerX: number;
  centerY: number;
}

const polygonWashCache = new Map<string, PolygonWashStamp>();

/**
 * Bakes and caches a 20-pass perturbed watercolor wash mask (R=body*grain, G=edge pooling, B=core highlight, A=wash alpha)
 * for any geometric polygon silhouette once at first request.
 */
export function getPolygonWashTexture(
  cacheKey: string,
  points: ReadonlyArray<{ x: number; y: number }>,
  padRatio = 0.28
): PolygonWashStamp {
  const hit = polygonWashCache.get(cacheKey);
  if (hit) return hit;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(12, maxX - minX, maxY - minY);
  const size = span * (1 + padRatio * 2);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;

  const pxSize = 192;
  const scale = pxSize / size;
  // Canvas Y points downward while world +Y points upward; flip Y cleanly via transform when mapping onto PlaneGeometry
  const toPxX = (wx: number): number => (wx - centerX) * scale + pxSize * 0.5;
  const toPxY = (wy: number): number => -(wy - centerY) * scale + pxSize * 0.5;

  const [, wCtx] = makeCanvas(pxSize);
  const [, edgeCtx] = makeCanvas(pxSize);
  const rand = seededRand(cacheKey.length * 7919 + Math.round(span * 13));

  // 20 stacked perturbed polygon watercolor passes
  for (let pass = 0; pass < 20; pass++) {
    wCtx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const rx = p.x - centerX;
      const ry = p.y - centerY;
      const radialNoise = 1 + (rand() - 0.5) * 0.11;
      const px = toPxX(centerX + rx * radialNoise) + (rand() - 0.5) * 2.2;
      const py = toPxY(centerY + ry * radialNoise) + (rand() - 0.5) * 2.2;
      if (i === 0) wCtx.moveTo(px, py);
      else wCtx.lineTo(px, py);
    }
    wCtx.closePath();
    wCtx.fillStyle = 'rgba(255, 255, 255, 0.064)';
    wCtx.fill();
  }

  // Crisp silhouette & inward pooling ring on secondary canvas
  edgeCtx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i === 0) edgeCtx.moveTo(toPxX(p.x), toPxY(p.y));
    else edgeCtx.lineTo(toPxX(p.x), toPxY(p.y));
  }
  edgeCtx.closePath();
  edgeCtx.fillStyle = 'rgba(255, 255, 255, 1.0)';
  edgeCtx.fill();
  edgeCtx.strokeStyle = 'rgba(0, 255, 0, 1.0)';
  edgeCtx.lineWidth = Math.max(6, pxSize * 0.09);
  edgeCtx.lineJoin = 'round';
  edgeCtx.stroke();

  const washRaw = wCtx.getImageData(0, 0, pxSize, pxSize);
  const edgeRaw = edgeCtx.getImageData(0, 0, pxSize, pxSize);
  const [outCanvas, oCtx] = makeCanvas(pxSize);
  const out = oCtx.createImageData(pxSize, pxSize);

  for (let y = 0; y < pxSize; y++) {
    for (let x = 0; x < pxSize; x++) {
      const idx = (y * pxSize + x) * 4;
      const wa = (washRaw.data[idx + 3] ?? 0) / 255;
      if (wa <= 0.01) continue;

      const er = (edgeRaw.data[idx] ?? 0) / 255;
      const eg = (edgeRaw.data[idx + 1] ?? 0) / 255;
      const pooling = Math.max(0, eg - er * 0.85) + (wa < 0.45 && wa > 0.12 ? 0.45 : 0);
      const grain = 0.78 + 0.32 * tileableValueNoise(x / 5, y / 5, 48, 337);
      const dx = (x - pxSize * 0.5) / (pxSize * 0.42);
      const dy = (y - pxSize * 0.5) / (pxSize * 0.42);
      const coreGlow = Math.max(0, 1 - Math.hypot(dx, dy) * 1.15) * er;

      out.data[idx] = Math.round(Math.min(1, wa * grain * 1.18) * 255);
      out.data[idx + 1] = Math.round(Math.min(1, pooling) * 255);
      out.data[idx + 2] = Math.round(Math.min(1, coreGlow * 0.95) * 255);
      out.data[idx + 3] = Math.round(Math.min(1, wa * 1.25) * 255);
    }
  }

  oCtx.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(outCanvas);
  texture.needsUpdate = true;
  const stamp: PolygonWashStamp = { texture, size, centerX, centerY };
  polygonWashCache.set(cacheKey, stamp);
  return stamp;
}

/**
 * Tapered, slightly overshot, hand-inked outline geometry (thickest mid-edge, tapering toward corners,
 * with subtle sinusoidal wobble and corner overshoot extensions).
 */
export function buildInkOutlineGeometry(
  points: ReadonlyArray<{ x: number; y: number }>,
  baseWidth: number,
  closed = true,
  z = 5.0,
  overshoot = 2.2,
  wobble = 0.55
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const n = points.length;
  if (n < 2) return geo;

  const segCount = closed ? n : n - 1;
  const subSegs = 5;
  const vertsPerEdge = (subSegs + 1) * 2;
  const positions = new Float32Array(segCount * vertsPerEdge * 3);
  const uvs = new Float32Array(segCount * vertsPerEdge * 2);
  const indices: number[] = [];

  let vOffset = 0;
  for (let e = 0; e < segCount; e++) {
    const pA = points[e]!;
    const pB = points[(e + 1) % n]!;
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const ovStart = closed || e > 0 ? Math.min(overshoot, len * 0.2) : 0;
    const ovEnd = closed || e < segCount - 1 ? Math.min(overshoot, len * 0.2) : 0;
    const sx = pA.x - ux * ovStart;
    const sy = pA.y - uy * ovStart;
    const ex = pB.x + ux * ovEnd;
    const ey = pB.y + uy * ovEnd;

    const edgeSeed = e * 1.91 + pA.x * 0.03 + pB.y * 0.05;
    for (let s = 0; s <= subSegs; s++) {
      const t = s / subSegs;
      const cx = sx + (ex - sx) * t;
      const cy = sy + (ey - sy) * t;
      const wOff = Math.sin(t * Math.PI * 2 + edgeSeed) * wobble * Math.sin(t * Math.PI);
      const px = cx + nx * wOff;
      const py = cy + ny * wOff;

      // Variable ribbon width: thickest in center (0.58 * baseWidth), tapering at corners (0.26 * baseWidth)
      const taper = 0.26 + 0.32 * Math.sin(t * Math.PI);
      const hw = baseWidth * taper;

      const pIdx = (vOffset + s * 2) * 3;
      positions[pIdx] = px + nx * hw;
      positions[pIdx + 1] = py + ny * hw;
      positions[pIdx + 2] = z;

      positions[pIdx + 3] = px - nx * hw;
      positions[pIdx + 4] = py - ny * hw;
      positions[pIdx + 5] = z;

      const uIdx = (vOffset + s * 2) * 2;
      uvs[uIdx] = t;
      uvs[uIdx + 1] = 0;
      uvs[uIdx + 2] = t;
      uvs[uIdx + 3] = 1;

      if (s < subSegs) {
        const b = vOffset + s * 2;
        indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      }
    }
    vOffset += vertsPerEdge;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vOffset * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs.subarray(0, vOffset * 2), 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Sumi-e black ink brush stroke material (#08090D) with 13 Hz quantized vertex boil.
 */
export function createSumiInkMaterial(opacity = 0.97, jitterAmp = 0.6): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: opacity },
      uJitter: { value: jitterAmp },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uJitter;
      varying vec2 vUv;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vUv = uv;
        float stepT = floor(uTime * 13.0);
        float jx = (hash2(position.xy * 0.37 + vec2(stepT, 1.3)) - 0.5) * 2.0 * uJitter;
        float jy = (hash2(position.yx * 0.37 + vec2(7.1, stepT)) - 0.5) * 2.0 * uJitter;
        vec3 pos = position + vec3(jx, jy, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        float edge = abs(vUv.y - 0.5) * 2.0;
        float aa = smoothstep(1.0, 0.72, edge);
        vec3 ink = vec3(0.031, 0.035, 0.051); // #08090D sumi-e ink
        gl_FragColor = vec4(ink, aa * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function darkenColor(hex: number, mult = 0.56): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(mult);
}

function brightenColor(hex: number, lerpWhite = 0.58): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), lerpWhite);
}

/**
 * Translucent luminous neon watercolor wash fill shader using pre-baked polygon texture.
 */
export function createWatercolorWashMaterial(
  washTex: THREE.Texture,
  colorHex: number,
  highlightHex?: number,
  poolHex?: number,
  opacity = 0.92
): THREE.ShaderMaterial {
  const hi = highlightHex !== undefined ? new THREE.Color(highlightHex) : brightenColor(colorHex, 0.56);
  const pool = poolHex !== undefined ? new THREE.Color(poolHex) : darkenColor(colorHex, 0.58);
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: washTex },
      uColor: { value: new THREE.Color(colorHex) },
      uHighlight: { value: hi },
      uPoolColor: { value: pool },
      uOpacity: { value: opacity },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform vec3 uHighlight;
      uniform vec3 uPoolColor;
      uniform float uOpacity;
      uniform float uFlash;
      varying vec2 vUv;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.02) discard;

        vec3 base = uColor * (0.72 + tex.r * 0.48);
        base = mix(base, uPoolColor, clamp(tex.g * 0.65, 0.0, 0.72));
        base = mix(base, uHighlight * 1.15, clamp(tex.b * 0.72, 0.0, 0.85));
        base = mix(base, vec3(1.12), uFlash);

        float alpha = clamp(tex.a * uOpacity, 0.0, 0.96);
        gl_FragColor = vec4(base, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function setWatercolorWashColor(
  mat: THREE.Material | THREE.Material[],
  colorHex: number,
  flash = 0,
  highlightHex?: number,
  poolHex?: number
): void {
  if (!(mat instanceof THREE.ShaderMaterial)) return;
  if (mat.uniforms.uColor) (mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
  if (mat.uniforms.uHighlight) {
    const hi = mat.uniforms.uHighlight.value as THREE.Color;
    if (highlightHex !== undefined) hi.setHex(highlightHex);
    else hi.setHex(colorHex).lerp(new THREE.Color(0xffffff), 0.56);
  }
  if (mat.uniforms.uPoolColor) {
    const pool = mat.uniforms.uPoolColor.value as THREE.Color;
    if (poolHex !== undefined) pool.setHex(poolHex);
    else pool.setHex(colorHex).multiplyScalar(0.58);
  }
  if (mat.uniforms.uFlash) mat.uniforms.uFlash.value = flash;
}

/**
 * Grounded offset drop shadow shader (#04060B at ~60% alpha) reusing polygon wash silhouette alpha.
 */
export function createDropShadowMaterial(washTex: THREE.Texture, opacity = 0.6): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: washTex },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float a = texture2D(uMap, vUv).a;
        if (a < 0.03) discard;
        vec3 shadow = vec3(0.016, 0.024, 0.043); // #04060B
        gl_FragColor = vec4(shadow, smoothstep(0.03, 0.68, a) * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Multi-stop watercolor starburst shader (#FFF380 -> #FF6A00 -> #FF1E6E or elemental variants).
 */
export function createWatercolorStarburstMaterial(
  starTex: THREE.Texture,
  coreHex: number,
  midHex: number,
  outerHex: number,
  opacity = 0.92
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: starTex },
      uCore: { value: new THREE.Color(coreHex) },
      uMid: { value: new THREE.Color(midHex) },
      uOuter: { value: new THREE.Color(outerHex) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uCore;
      uniform vec3 uMid;
      uniform vec3 uOuter;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.02) discard;

        vec3 col = uOuter * (0.7 + tex.r * 0.45);
        col = mix(col, uMid * 1.08, clamp(tex.g * 1.15, 0.0, 1.0));
        col = mix(col, uCore * 1.25, clamp(tex.b * 1.1, 0.0, 1.0));
        gl_FragColor = vec4(col, tex.a * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Pre-baked sumi-e ink starburst stamp shader with 13 Hz quantized micro-jitter.
 */
export function createInkStampMaterial(inkTex: THREE.Texture, opacity = 0.96): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: inkTex },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(41.1, 289.7))) * 43758.5453);
      }
      void main() {
        vUv = uv;
        float stepT = floor(uTime * 13.0);
        float jx = (hash2(position.xy + vec2(stepT, 2.1)) - 0.5) * 1.1;
        float jy = (hash2(position.yx + vec2(5.7, stepT)) - 0.5) * 1.1;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(jx, jy, 0.0), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float a = texture2D(uMap, vUv).a;
        if (a < 0.04) discard;
        gl_FragColor = vec4(vec3(0.031, 0.035, 0.051), a * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Layer 1 Textured Cold-Press Paper Substrate Shader.
 */
export function createPaperSubstrateMaterial(
  paperTileTex: THREE.Texture,
  paperCloudTex: THREE.Texture
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTile: { value: paperTileTex },
      uCloud: { value: paperCloudTex },
      uOffset: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTile;
      uniform sampler2D uCloud;
      uniform vec2 uOffset;
      varying vec2 vUv;

      void main() {
        vec2 cloudUv = clamp(vUv + uOffset * 0.04, vec2(0.0), vec2(1.0));
        vec3 base = texture2D(uCloud, cloudUv).rgb;
        vec3 grain = texture2D(uTile, vUv * vec2(14.0, 10.5) + uOffset).rgb;
        // Soft-light paper fiber modulation (8%-12% contrast)
        vec3 modulated = base + (grain - vec3(0.5)) * 0.22;
        gl_FragColor = vec4(modulated, 1.0);
      }
    `,
    depthWrite: false,
  });
}

/**
 * Layer 2 Brush-Stroke Spring Grid Shader with soft width taper & watercolor length variation.
 */
export function createWatercolorGridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.72 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vColor;

      void main() {
        float dist = abs(vUv.y - 0.5) * 2.0;
        float bristle = exp(-dist * dist * 3.4);
        float strokeDensity = 0.84 + 0.16 * sin(vUv.x * 12.56 + vUv.y * 5.0);
        float alpha = clamp(bristle * strokeDensity * uOpacity, 0.0, 0.92);
        gl_FragColor = vec4(vColor * alpha, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Tapered brush-stroke energy beam shader (3-4 parallel glowing watercolor streams + sumi-e ink edge accents).
 */
export function createWatercolorBeamMaterial(
  colorA: number,
  colorB: number,
  colorC: number,
  isVoid = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uColorC: { value: new THREE.Color(colorC) },
      uIsVoid: { value: isVoid ? 1.0 : 0.0 },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uLength: { value: 10 },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      uniform float uIsVoid;
      uniform float uTime;
      uniform float uLength;
      uniform float uFade;
      varying vec2 vUv;

      float hash1(float n) {
        return fract(sin(n) * 43758.5453123);
      }

      float noise1(float x) {
        float i = floor(x);
        float f = fract(x);
        float u = f * f * (3.0 - 2.0 * f);
        return mix(hash1(i), hash1(i + 1.0), u);
      }

      void main() {
        float x = vUv.x * max(uLength, 1.0);
        float y = (vUv.y - 0.5) * 2.0;
        float muzzle = smoothstep(0.0, 0.14, x);
        float tail = 1.0 - smoothstep(max(uLength - 0.35, 0.0), uLength, x);
        float env = muzzle * tail * uFade;

        float flutter = (noise1(x * 3.8 - uTime * 22.0) - 0.5) * 0.14;
        float yy = y + flutter;

        // 3 parallel watercolor brush streams + central core
        float streamC = exp(-pow(yy * 5.4, 2.0));
        float streamU = exp(-pow((yy - 0.32 + sin(x * 2.2 - uTime * 14.0) * 0.05) * 8.5, 2.0));
        float streamL = exp(-pow((yy + 0.32 + cos(x * 2.4 - uTime * 13.0) * 0.05) * 8.5, 2.0));
        float brushWash = exp(-yy * yy * 2.6) * (0.45 + 0.25 * noise1(x * 6.5 - uTime * 18.0));

        // Crisp sumi-e ink brush flank lines framing the neon wash
        float inkFlank = exp(-pow((abs(yy) - 0.54) * 16.0, 2.0)) * 0.65;

        if (uIsVoid > 0.5) {
          float blackCore = smoothstep(0.28, 0.08, abs(yy));
          vec3 neonRim = mix(uColorA, uColorB, 0.5 + 0.5 * sin(x * 2.5 - uTime * 12.0)) * 1.2;
          vec3 col = mix(neonRim * (streamU + streamL + brushWash), vec3(0.031, 0.035, 0.051), blackCore);
          float alpha = clamp((blackCore * 0.96 + (streamU + streamL + brushWash) * 0.78) * env, 0.0, 0.98);
          gl_FragColor = vec4(col, alpha);
          return;
        }

        vec3 mainCol = uColorA * (brushWash * 0.85 + streamC * 0.55)
          + uColorB * (streamU * 0.85)
          + uColorC * (streamL * 0.85)
          + vec3(1.15) * pow(streamC, 2.2) * 0.72;
        mainCol = mix(mainCol, vec3(0.031, 0.035, 0.051), inkFlank * 0.78);
        float alpha = clamp((brushWash * 0.62 + streamC * 0.88 + (streamU + streamL) * 0.6 + inkFlank * 0.55) * env, 0.0, 0.96);
        gl_FragColor = vec4(mainCol, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Watercolor Mist & Brush-Arc Spray Cone Shader.
 */
export function createWatercolorSprayConeMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: 1 },
      uHalfAngle: { value: 0.46 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uHalfAngle;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        float x = vUv.x;
        float y = (vUv.y - 0.5) * 2.0;
        float r = length(vec2(x, y));
        if (x <= 0.0 || r > 1.0) discard;

        float ang = abs(atan(y, x));
        float normAng = ang / max(uHalfAngle, 0.05);
        if (normAng > 1.0) discard;

        float n = noise(vec2(r * 7.5 - uTime * 6.0, ang * 9.0));
        float edgeInk = exp(-pow((normAng - 0.94) * 14.0, 2.0)) * smoothstep(0.08, 0.85, r);
        float brushArc = exp(-pow((fract(r * 4.2 - uTime * 3.6) - 0.5) * 7.0, 2.0));
        float env = smoothstep(1.0, 0.45, normAng) * smoothstep(0.0, 0.06, r) * smoothstep(1.0, 0.25, r);

        vec3 wash = mix(uColorA, uColorB, 0.25 + 0.6 * n) * (0.7 + n * 0.55);
        wash += vec3(0.95) * brushArc * 0.45;
        wash = mix(wash, vec3(0.031, 0.035, 0.051), edgeInk * 0.72);
        float alpha = clamp((env * (0.58 + brushArc * 0.35) + edgeInk * 0.5) * uOpacity, 0.0, 0.9);
        gl_FragColor = vec4(wash, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Watercolor & Ink Wall Panel Shader supporting all 7 elemental styles with sumi-e ink rims.
 */
export function createWatercolorWallMaterial(
  colorA: number,
  colorB: number,
  wallStyle = 6,
  isVoid = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uStyle: { value: wallStyle },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uStyle;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        int st = int(uStyle + 0.5);
        vec3 ink = vec3(0.031, 0.035, 0.051);
        float grain = 0.8 + 0.25 * noise(vUv * 18.0);

        if (st == 2) {
          float n1 = noise(vec2(vUv.x * 8.5, vUv.y * 3.8 - uTime * 4.2));
          float n2 = noise(vec2(vUv.x * 16.0 + 3.1, vUv.y * 7.5 - uTime * 6.5));
          float ridge = 0.55 + 0.45 * n1;
          float flame = smoothstep(vUv.y * 0.92, vUv.y * 0.92 + 0.26, ridge + n2 * 0.24);
          if (flame < 0.04) discard;
          float inkEdge = exp(-pow((flame - 0.22) * 8.0, 2.0));
          vec3 col = mix(uColorA, uColorB, clamp(n2 * 0.85, 0.0, 1.0)) * grain;
          col = mix(col, ink, inkEdge * 0.78);
          gl_FragColor = vec4(col, clamp(flame * 0.92 * uOpacity, 0.0, 0.95));
          return;
        }
        if (st == 1) {
          float spike1 = abs(fract(vUv.x * 5.0 + 0.2) * 2.0 - 1.0);
          float spike2 = abs(fract(vUv.x * 9.0 + 0.6) * 2.0 - 1.0);
          float topCut = 0.62 + 0.26 * (1.0 - spike1) + 0.12 * (1.0 - spike2);
          if (vUv.y > topCut) discard;
          float inkRim = exp(-pow((topCut - vUv.y) * 18.0, 2.0));
          float facet = smoothstep(0.35, 0.85, noise(vec2(vUv.x * 14.0, vUv.y * 10.0)));
          vec3 col = mix(uColorA, uColorB, facet * 0.65) * grain;
          col = mix(col, ink, inkRim * 0.9);
          gl_FragColor = vec4(col, 0.88 * uOpacity);
          return;
        }
        if (st == 3) {
          float waveTop = 0.72 + 0.14 * sin(vUv.x * 14.0 - uTime * 4.5) + 0.08 * cos(vUv.x * 23.0 + uTime * 3.2);
          if (vUv.y > waveTop) discard;
          float inkCrest = exp(-pow((waveTop - vUv.y) * 18.0, 2.0));
          float n = noise(vec2(vUv.x * 9.0 - uTime * 2.8, vUv.y * 7.0 + uTime * 1.8));
          vec3 col = mix(uColorA, uColorB, 0.35 + n * 0.45) * grain;
          col = mix(col, ink, inkCrest * 0.85);
          gl_FragColor = vec4(col, 0.86 * uOpacity);
          return;
        }
        if (st == 4) {
          float arcs = 0.0;
          for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float cy = 0.25 + fk * 0.26;
            float j = (noise(vec2(vUv.x * 22.0 + fk * 7.1, uTime * 16.0 + fk * 3.3)) - 0.5) * 0.16;
            arcs += exp(-pow((vUv.y - (cy + j)) * 24.0, 2.0));
          }
          float inkOutline = exp(-pow((min(vUv.y, 1.0 - vUv.y)) * 18.0, 2.0));
          vec3 col = mix(uColorA * 0.85, vec3(1.0, 0.98, 0.75), clamp(arcs, 0.0, 1.0));
          col = mix(col, ink, inkOutline * 0.82);
          gl_FragColor = vec4(col, clamp((0.35 + min(1.0, arcs) * 0.65) * uOpacity, 0.0, 0.95));
          return;
        }
        if (st == 5) {
          float edgeY = min(vUv.y, 1.0 - vUv.y);
          float rim = exp(-pow(edgeY * 10.0, 2.0));
          float tear = pow(0.5 + 0.5 * sin(vUv.x * 16.0 - uTime * 4.0), 4.0);
          vec3 col = mix(ink, mix(uColorA, uColorB, tear) * 1.15, clamp(rim + tear * 0.35, 0.0, 1.0));
          gl_FragColor = vec4(col, clamp((0.88 - abs(vUv.y - 0.5) * 0.2 + rim * 0.12) * uOpacity, 0.0, 0.96));
          return;
        }
        vec2 cell = fract(vec2(vUv.x * 10.0, vUv.y * 4.5 - uTime * 1.4)) - 0.5;
        float crossH = step(abs(cell.x), 0.24) * step(abs(cell.y), 0.065);
        float crossV = step(abs(cell.y), 0.24) * step(abs(cell.x), 0.065);
        float crossG = max(crossH, crossV);
        float inkRim = exp(-pow(min(vUv.y, 1.0 - vUv.y) * 18.0, 2.0));
        vec3 col = mix(uColorA * grain, uColorB * 1.15, crossG * 0.72);
        col = mix(col, ink, inkRim * 0.88);
        gl_FragColor = vec4(col, clamp((0.68 + crossG * 0.25) * uOpacity, 0.0, 0.92));
      }
    `,
    transparent: true,
    blending: isVoid ? THREE.NormalBlending : THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Watercolor Storm Ground Vortex Shader (6 elemental styles + ink rune outline accents).
 */
export function createWatercolorStormVortexMaterial(
  barrierColor: number,
  colorA: number,
  colorB: number,
  style = 0
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorBarrier: { value: new THREE.Color(barrierColor) },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: 1 },
      uStyle: { value: style },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorBarrier;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uStyle;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        float ang = atan(p.y, p.x);
        float n = noise(p * 4.5 + vec2(uTime * 0.4, -uTime * 0.35));
        float swirl = pow(0.5 + 0.5 * sin(ang * 3.0 - r * 7.5 + uTime * 3.8 + n * 2.2), 2.2);
        float outerInkRing = exp(-pow((r - 0.88) * 18.0, 2.0));
        float innerInkRing = exp(-pow((r - 0.52) * 20.0, 2.0)) * 0.55;
        float fade = smoothstep(1.0, 0.48, r);

        vec3 ink = vec3(0.031, 0.035, 0.051);
        vec3 col = mix(uColorA, uColorB, swirl * 0.72 + n * 0.25) * (0.65 + swirl * 0.55);
        if (uStyle > 3.5 && uStyle < 4.5) {
          float bh = smoothstep(0.35, 0.14, r);
          col = mix(col, ink, bh);
        }
        col = mix(col, ink, clamp(outerInkRing + innerInkRing, 0.0, 0.92));
        float alpha = clamp((fade * (0.34 + swirl * 0.42) + outerInkRing * 0.75) * uOpacity, 0.0, 0.92);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Overhead Watercolor Storm Cloud Canopy Shader.
 */
export function createWatercolorStormCloudMaterial(
  colorA: number,
  colorB: number,
  style = 0
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: 1 },
      uStyle: { value: style },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uStyle;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        float ang = atan(p.y, p.x);
        float lobe = 0.72 + 0.14 * sin(ang * 5.0 - uTime * 1.4) + 0.1 * noise(p * 3.8 + vec2(uTime * 0.35));
        if (r > lobe) discard;

        float normR = r / lobe;
        float poolInk = exp(-pow((normR - 0.93) * 14.0, 2.0));
        float cloud = noise(p * 3.5 - vec2(uTime * 0.4, -uTime * 0.35));
        vec3 col = mix(uColorA, uColorB, cloud * 0.75) * (0.72 + cloud * 0.48);
        if (uStyle > 3.5 && uStyle < 4.5) {
          col = mix(col, vec3(0.031, 0.035, 0.051), smoothstep(0.32, 0.12, r));
        }
        col = mix(col, vec3(0.031, 0.035, 0.051), poolInk * 0.85);
        float alpha = clamp((smoothstep(1.0, 0.25, normR) * 0.76 + poolInk * 0.5) * uOpacity, 0.0, 0.9);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Spilled Watercolor Liquid Pool Shader with capillary edge pooling and ink ripple lines.
 */
export function createWatercolorPoolMaterial(colorA: number, colorB: number, seed = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: 1 },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uSeed;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float ang = atan(p.y, p.x);
        float edgeRadius = 0.82 + 0.1 * sin(ang * 3.0 + uSeed) + 0.05 * cos(ang * 5.0 - uSeed * 1.7);
        if (r > edgeRadius) discard;

        float normR = r / edgeRadius;
        float poolEdge = exp(-pow((normR - 0.92) * 14.0, 2.0));
        float ripple = exp(-pow((fract(normR * 2.2 - uTime * 0.45) - 0.5) * 10.0, 2.0)) * 0.45;
        vec3 col = mix(uColorA * 0.78, uColorB * 1.1, ripple + (1.0 - normR) * 0.35);
        col = mix(col, vec3(0.031, 0.035, 0.051), poolEdge * 0.82);
        float alpha = clamp((0.46 + (1.0 - normR) * 0.2 + poolEdge * 0.45) * uOpacity, 0.0, 0.85);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Watercolor & Ink Barrier Shield Shader (Omnidirectional Dome or Directional Crescent).
 */
export function createWatercolorShieldMaterial(
  colorA: number,
  colorB: number,
  isDome: boolean
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: WATERCOLOR_TIME_UNIFORM,
      uOpacity: { value: 1 },
      uIsDome: { value: isDome ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uIsDome;
      varying vec2 vUv;

      void main() {
        if (uIsDome > 0.5) {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;
          float rimInk = exp(-pow((r - 0.96) * 24.0, 2.0));
          float rimWash = smoothstep(0.62, 0.98, r);
          float hatch = smoothstep(0.92, 1.0, abs(sin((p.x + p.y) * 18.0 + uTime * 0.5)));
          vec3 col = mix(uColorA, uColorB, rimWash * 0.6 + hatch * 0.3);
          col = mix(col, vec3(0.031, 0.035, 0.051), rimInk * 0.88);
          float alpha = clamp((0.14 + rimWash * 0.45 + rimInk * 0.65) * uOpacity, 0.0, 0.88);
          gl_FragColor = vec4(col, alpha);
          return;
        }
        float arcFade = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float topInk = exp(-pow((vUv.y - 0.94) * 16.0, 2.0));
        vec3 col = mix(uColorA, uColorB, vUv.y * 0.65);
        col = mix(col, vec3(0.031, 0.035, 0.051), topInk * 0.85);
        float alpha = clamp((0.36 + vUv.y * 0.35 + topInk * 0.4) * arcFade * uOpacity, 0.0, 0.9);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Sweeping Ink & Watercolor Crescent Slash Shader.
 */
export function createWatercolorSlashMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uFade;
      varying vec2 vUv;

      void main() {
        float arcEnv = sin(vUv.x * 3.14159265);
        float outerBlade = exp(-pow((vUv.y - 0.84) * 9.0, 2.0));
        float inkSpine = exp(-pow((vUv.y - 0.92) * 18.0, 2.0));
        vec3 col = mix(uColorB, uColorA, vUv.y) * (0.85 + outerBlade * 0.55);
        col = mix(col, vec3(0.031, 0.035, 0.051), inkSpine * 0.9);
        float alpha = clamp((smoothstep(0.15, 0.88, vUv.y) * 0.65 + outerBlade * 0.7 + inkSpine * 0.8) * arcEnv * uFade, 0.0, 0.95);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Brush-textured ribbon material for watercolor motion trails.
 */
export function createWatercolorTrailMaterial(brushTex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: brushTex },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float a = texture2D(uMap, vec2(0.5, vUv.y)).a;
        gl_FragColor = vec4(vColor, a * 0.78);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Sumi-e black ink droplet particle material with smooth per-particle alpha fade & size variation.
 */
export function createInkDropletPointsMaterial(dropletTex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dropletTex },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (950.0 / max(100.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      void main() {
        if (vAlpha <= 0.01) discard;
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.08) discard;
        gl_FragColor = vec4(vec3(0.031, 0.035, 0.051), tex.a * vAlpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
}

import * as THREE from 'three';
import { ArtStyle } from '../settings';
import { DEFAULT_RECT_BOUNDARY, pointInConvexPoly } from '../sim/ArenaGeometry';
import { ARENA_HALF_H, ARENA_HALF_W, Vec2 } from '../sim/types';
import { createWatercolorGridMaterial } from './WatercolorAssets';

export class WarpingGrid {
  private readonly cols = 56;
  private readonly rows = 38;
  private readonly count: number;

  private readonly restX: Float32Array;
  private readonly restY: Float32Array;
  private readonly posX: Float32Array;
  private readonly posY: Float32Array;
  private readonly velX: Float32Array;
  private readonly velY: Float32Array;
  private readonly splashR: Float32Array;
  private readonly splashG: Float32Array;
  private readonly splashB: Float32Array;

  private readonly linePositions: Float32Array;
  private readonly lineColors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  public readonly mesh: THREE.LineSegments;
  private readonly totalSegments: number;
  private readonly scene: THREE.Scene;
  private artStyle: ArtStyle = 'VECTOR_NEON';
  private brushMesh: THREE.Mesh | null = null;
  private brushGeo: THREE.BufferGeometry | null = null;
  private brushPos: Float32Array | null = null;
  private brushCol: Float32Array | null = null;
  private themeIdx = -1;
  private warpEnabled = true;
  private boundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY;
  private lastBoundaryKey = '';
  private baseRgb: [number, number, number] = [0.08, 0.14, 0.48];
  private warpRgb: [number, number, number] = [0.55, 0.80, 0.62];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.count = this.cols * this.rows;
    this.restX = new Float32Array(this.count);
    this.restY = new Float32Array(this.count);
    this.posX = new Float32Array(this.count);
    this.posY = new Float32Array(this.count);
    this.velX = new Float32Array(this.count);
    this.velY = new Float32Array(this.count);
    this.splashR = new Float32Array(this.count);
    this.splashG = new Float32Array(this.count);
    this.splashB = new Float32Array(this.count);

    const w = ARENA_HALF_W * 2;
    const h = ARENA_HALF_H * 2;
    for (let r = 0; r < this.rows; r++) {
      const ty = r / (this.rows - 1);
      const y = -ARENA_HALF_H + ty * h;
      for (let c = 0; c < this.cols; c++) {
        const tx = c / (this.cols - 1);
        const x = -ARENA_HALF_W + tx * w;
        const idx = r * this.cols + c;
        this.restX[idx] = x;
        this.restY[idx] = y;
        this.posX[idx] = x;
        this.posY[idx] = y;
      }
    }

    const horizSegments = this.rows * (this.cols - 1);
    const vertSegments = (this.rows - 1) * this.cols;
    this.totalSegments = horizSegments + vertSegments;

    this.linePositions = new Float32Array(this.totalSegments * 2 * 3);
    this.lineColors = new Float32Array(this.totalSegments * 2 * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.lineColors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.syncBuffers();
  }

  private ensureBrushMesh(): void {
    if (this.brushMesh) return;
    const nSeg = this.totalSegments;
    const pos = new Float32Array(nSeg * 4 * 3);
    const col = new Float32Array(nSeg * 4 * 3);
    const uvs = new Float32Array(nSeg * 4 * 2);
    const indices = new Uint32Array(nSeg * 6);
    for (let s = 0; s < nSeg; s++) {
      const uvBase = s * 8;
      uvs[uvBase] = 0;
      uvs[uvBase + 1] = 0;
      uvs[uvBase + 2] = 0;
      uvs[uvBase + 3] = 1;
      uvs[uvBase + 4] = 1;
      uvs[uvBase + 5] = 0;
      uvs[uvBase + 6] = 1;
      uvs[uvBase + 7] = 1;

      const v0 = s * 4;
      const iBase = s * 6;
      indices[iBase] = v0;
      indices[iBase + 1] = v0 + 1;
      indices[iBase + 2] = v0 + 2;
      indices[iBase + 3] = v0 + 2;
      indices[iBase + 4] = v0 + 1;
      indices[iBase + 5] = v0 + 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    const mesh = new THREE.Mesh(geo, createWatercolorGridMaterial());
    mesh.renderOrder = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.brushMesh = mesh;
    this.brushGeo = geo;
    this.brushPos = pos;
    this.brushCol = col;
  }

  public setArtStyle(style: ArtStyle): void {
    if (this.artStyle === style) return;
    this.artStyle = style;
    const isWatercolor = style === 'WATERCOLOR_INK';
    this.mesh.visible = !isWatercolor;
    if (isWatercolor) this.ensureBrushMesh();
    if (this.brushMesh) this.brushMesh.visible = isWatercolor;
    this.syncBuffers();
  }

  public setWarpEnabled(enabled: boolean): void {
    this.warpEnabled = enabled;
    if (!enabled) {
      for (let i = 0; i < this.count; i++) {
        this.posX[i] = this.restX[i]!;
        this.posY[i] = this.restY[i]!;
        this.velX[i] = 0;
        this.velY[i] = 0;
        this.splashR[i] = 0;
        this.splashG[i] = 0;
        this.splashB[i] = 0;
      }
      this.syncBuffers();
    }
  }

  public setArenaBoundary(boundary: readonly Vec2[]): void {
    const key = boundary.map((v) => `${v.x},${v.y}`).join(';');
    if (key === this.lastBoundaryKey) return;
    this.lastBoundaryKey = key;
    this.boundary = boundary;
    this.syncBuffers();
  }

  public stampColorSplash(wx: number, wy: number, radius: number, colorHex: number, intensity = 0.85): void {
    if (!this.warpEnabled) return;
    const effR = Math.max(40, radius * 1.25);
    const r2 = effR * effR;
    const cr = ((colorHex >> 16) & 0xff) / 255;
    const cg = ((colorHex >> 8) & 0xff) / 255;
    const cb = (colorHex & 0xff) / 255;

    for (let i = 0; i < this.count; i++) {
      const dx = this.restX[i]! - wx;
      const dy = this.restY[i]! - wy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < r2) {
        const falloff = 1 - Math.sqrt(dist2) / effR;
        const w = falloff * falloff * intensity;
        this.splashR[i] = Math.min(1.1, this.splashR[i]! + cr * w);
        this.splashG[i] = Math.min(1.1, this.splashG[i]! + cg * w);
        this.splashB[i] = Math.min(1.1, this.splashB[i]! + cb * w);
      }
    }
  }

  public applyRadialImpulse(wx: number, wy: number, strength: number, radius: number, colorHex?: number): void {
    if (!this.warpEnabled) return;
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      const dx = this.posX[i]! - wx;
      const dy = this.posY[i]! - wy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > 1e-4 && dist2 < r2) {
        const dist = Math.sqrt(dist2);
        const falloff = 1 - dist / radius;
        const f = strength * falloff * falloff;
        this.velX[i]! += (dx / dist) * f;
        this.velY[i]! += (dy / dist) * f;
      }
    }
    if (colorHex !== undefined) {
      this.stampColorSplash(wx, wy, radius, colorHex, Math.min(1.0, strength / 220));
    }
  }

  public applyGravityWell(wx: number, wy: number, strength: number, radius: number, colorHex?: number): void {
    if (!this.warpEnabled) return;
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      const dx = wx - this.posX[i]!;
      const dy = wy - this.posY[i]!;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > 4 && dist2 < r2) {
        const dist = Math.sqrt(dist2);
        const falloff = 1 - dist / radius;
        const f = strength * falloff;
        this.velX[i]! += (dx / dist) * f;
        this.velY[i]! += (dy / dist) * f;
      }
    }
    if (colorHex !== undefined) {
      this.stampColorSplash(wx, wy, radius, colorHex, Math.min(1.0, strength / 240));
    }
  }

  public update(dt: number): void {
    if (!this.warpEnabled) return;
    const stepDt = Math.min(dt, 0.033);
    const stiffness = 68;
    const neighborStiffness = 22;
    const damping = Math.exp(-6.2 * stepDt);
    const colorDecay = Math.exp(-2.4 * stepDt);

    for (let r = 0; r < this.rows; r++) {
      const isBorderY = r === 0 || r === this.rows - 1;
      for (let c = 0; c < this.cols; c++) {
        const isBorderX = c === 0 || c === this.cols - 1;
        const idx = r * this.cols + c;
        if (isBorderX || isBorderY) {
          this.posX[idx] = this.restX[idx]!;
          this.posY[idx] = this.restY[idx]!;
          this.velX[idx] = 0;
          this.velY[idx] = 0;
          continue;
        }

        const x = this.posX[idx]!;
        const y = this.posY[idx]!;
        let fx = (this.restX[idx]! - x) * stiffness;
        let fy = (this.restY[idx]! - y) * stiffness;

        const left = idx - 1;
        const right = idx + 1;
        const up = idx - this.cols;
        const down = idx + this.cols;
        const avgX = (this.posX[left]! + this.posX[right]! + this.posX[up]! + this.posX[down]!) * 0.25;
        const avgY = (this.posY[left]! + this.posY[right]! + this.posY[up]! + this.posY[down]!) * 0.25;
        fx += (avgX - x) * neighborStiffness;
        fy += (avgY - y) * neighborStiffness;

        this.velX[idx] = (this.velX[idx]! + fx * stepDt) * damping;
        this.velY[idx] = (this.velY[idx]! + fy * stepDt) * damping;
      }
    }

    for (let i = 0; i < this.count; i++) {
      this.posX[i]! += this.velX[i]! * stepDt;
      this.posY[i]! += this.velY[i]! * stepDt;
      this.splashR[i]! *= colorDecay;
      this.splashG[i]! *= colorDecay;
      this.splashB[i]! *= colorDecay;
    }

    this.syncBuffers();
  }

  public setSectorTheme(wave: number): void {
    const idx = Math.max(0, wave - 1) % 5;
    if (idx === this.themeIdx) return;
    this.themeIdx = idx;
    const themes: Array<{ base: [number, number, number]; warp: [number, number, number] }> = [
      { base: [0.08, 0.14, 0.48], warp: [0.55, 0.80, 0.62] },
      { base: [0.28, 0.08, 0.12], warp: [0.75, 0.42, 0.22] },
      { base: [0.06, 0.22, 0.44], warp: [0.35, 0.82, 0.72] },
      { base: [0.06, 0.26, 0.22], warp: [0.32, 0.85, 0.52] },
      { base: [0.22, 0.08, 0.44], warp: [0.72, 0.35, 0.85] },
    ];
    const t = themes[idx]!;
    this.baseRgb = t.base;
    this.warpRgb = t.warp;
    this.syncBuffers();
  }

  private syncBuffers(): void {
    const insideFlags = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) {
      insideFlags[i] = pointInConvexPoly(this.restX[i]!, this.restY[i]!, this.boundary, -16) ? 1 : 0;
    }

    if (this.artStyle === 'WATERCOLOR_INK' && this.brushPos && this.brushCol && this.brushGeo) {
      let ptr = 0;
      let cPtr = 0;
      const bPos = this.brushPos;
      const bCol = this.brushCol;

      const writeHiddenQuad = (): void => {
        for (let k = 0; k < 4; k++) {
          bPos[ptr++] = 0;
          bPos[ptr++] = 0;
          bPos[ptr++] = -9999;
          bCol[cPtr++] = 0;
          bCol[cPtr++] = 0;
          bCol[cPtr++] = 0;
        }
      };

      const writeBrushSeg = (idxA: number, idxB: number, isHoriz: boolean, seed: number): void => {
        const ax = this.posX[idxA]!;
        const ay = this.posY[idxA]!;
        const bx = this.posX[idxB]!;
        const by = this.posY[idxB]!;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        const dA = Math.min(1, Math.hypot(ax - this.restX[idxA]!, ay - this.restY[idxA]!) / 24);
        const dB = Math.min(1, Math.hypot(bx - this.restX[idxB]!, by - this.restY[idxB]!) / 24);
        const wA = 1.25 + dA * 1.15;
        const wB = 1.25 + dB * 1.15;
        const wobA = Math.sin(seed * 1.7) * 1.15;
        const wobB = Math.sin(seed * 1.7 + 1.4) * 1.15;

        const zA = -0.5 - dA * 8;
        const zB = -0.5 - dB * 8;

        bPos[ptr++] = ax + nx * (wA + wobA);
        bPos[ptr++] = ay + ny * (wA + wobA);
        bPos[ptr++] = zA;
        bPos[ptr++] = ax + nx * (-wA + wobA);
        bPos[ptr++] = ay + ny * (-wA + wobA);
        bPos[ptr++] = zA;
        bPos[ptr++] = bx + nx * (wB + wobB);
        bPos[ptr++] = by + ny * (wB + wobB);
        bPos[ptr++] = zB;
        bPos[ptr++] = bx + nx * (-wB + wobB);
        bPos[ptr++] = by + ny * (-wB + wobB);
        bPos[ptr++] = zB;

        const varTint = 0.86 + 0.24 * Math.sin(seed * 2.3);
        // Horizontal: electric cyan (#1FA2FF -> #38E8FF), Vertical: neon magenta-violet (#A838FF -> #E040FB)
        const baseR = isHoriz ? 0.14 * varTint : 0.62 * varTint;
        const baseG = isHoriz ? 0.62 * varTint : 0.20 * varTint;
        const baseB = isHoriz ? 0.96 * varTint : 0.92 * varTint;

        const boostA = 0.56 + dA * 0.72;
        const boostB = 0.56 + dB * 0.72;
        const ar = Math.min(1.25, baseR * boostA + this.splashR[idxA]!);
        const ag = Math.min(1.25, baseG * boostA + this.splashG[idxA]!);
        const ab = Math.min(1.25, baseB * boostA + this.splashB[idxA]!);
        const brC = Math.min(1.25, baseR * boostB + this.splashR[idxB]!);
        const bgC = Math.min(1.25, baseG * boostB + this.splashG[idxB]!);
        const bbC = Math.min(1.25, baseB * boostB + this.splashB[idxB]!);

        for (let k = 0; k < 2; k++) {
          bCol[cPtr++] = ar;
          bCol[cPtr++] = ag;
          bCol[cPtr++] = ab;
        }
        for (let k = 0; k < 2; k++) {
          bCol[cPtr++] = brC;
          bCol[cPtr++] = bgC;
          bCol[cPtr++] = bbC;
        }
      };

      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols - 1; c++) {
          const idx = r * this.cols + c;
          if (!insideFlags[idx] && !insideFlags[idx + 1]) writeHiddenQuad();
          else writeBrushSeg(idx, idx + 1, true, r * 31 + c);
        }
      }
      for (let r = 0; r < this.rows - 1; r++) {
        for (let c = 0; c < this.cols; c++) {
          const idx = r * this.cols + c;
          if (!insideFlags[idx] && !insideFlags[idx + this.cols]) writeHiddenQuad();
          else writeBrushSeg(idx, idx + this.cols, false, r * 17 + c * 43);
        }
      }

      (this.brushGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.brushGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      return;
    }

    let ptr = 0;
    const [br, bg, bb] = this.baseRgb;
    const [wr, wg, wb] = this.warpRgb;

    const writeHiddenSeg = (): void => {
      for (let k = 0; k < 2; k++) {
        this.linePositions[ptr] = 0;
        this.linePositions[ptr + 1] = 0;
        this.linePositions[ptr + 2] = -9999;
        this.lineColors[ptr] = 0;
        this.lineColors[ptr + 1] = 0;
        this.lineColors[ptr + 2] = 0;
        ptr += 3;
      }
    };

    const writeVertex = (idx: number): void => {
      const x = this.posX[idx]!;
      const y = this.posY[idx]!;
      const dx = x - this.restX[idx]!;
      const dy = y - this.restY[idx]!;
      const disp = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 26);

      this.linePositions[ptr] = x;
      this.linePositions[ptr + 1] = y;
      this.linePositions[ptr + 2] = -disp * 8;

      this.lineColors[ptr] = Math.min(1.15, br + disp * wr + this.splashR[idx]!);
      this.lineColors[ptr + 1] = Math.min(1.15, bg + disp * wg + this.splashG[idx]!);
      this.lineColors[ptr + 2] = Math.min(1.15, bb + disp * wb + this.splashB[idx]!);
      ptr += 3;
    };

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols - 1; c++) {
        const idx = r * this.cols + c;
        if (!insideFlags[idx] && !insideFlags[idx + 1]) {
          writeHiddenSeg();
        } else {
          writeVertex(idx);
          writeVertex(idx + 1);
        }
      }
    }

    for (let r = 0; r < this.rows - 1; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        if (!insideFlags[idx] && !insideFlags[idx + this.cols]) {
          writeHiddenSeg();
        } else {
          writeVertex(idx);
          writeVertex(idx + this.cols);
        }
      }
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

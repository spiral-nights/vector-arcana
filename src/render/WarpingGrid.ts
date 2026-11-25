import * as THREE from 'three';
import { ARENA_HALF_H, ARENA_HALF_W } from '../sim/types';

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

  private readonly linePositions: Float32Array;
  private readonly lineColors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  public readonly mesh: THREE.LineSegments;
  private themeIdx = -1;
  private baseRgb: [number, number, number] = [0.08, 0.14, 0.48];
  private warpRgb: [number, number, number] = [0.55, 0.80, 0.62];

  constructor(scene: THREE.Scene) {
    this.count = this.cols * this.rows;
    this.restX = new Float32Array(this.count);
    this.restY = new Float32Array(this.count);
    this.posX = new Float32Array(this.count);
    this.posY = new Float32Array(this.count);
    this.velX = new Float32Array(this.count);
    this.velY = new Float32Array(this.count);

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
    const totalSegments = horizSegments + vertSegments;

    this.linePositions = new Float32Array(totalSegments * 2 * 3);
    this.lineColors = new Float32Array(totalSegments * 2 * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.lineColors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.syncBuffers();
  }

  public applyRadialImpulse(wx: number, wy: number, strength: number, radius: number): void {
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
  }

  public applyGravityWell(wx: number, wy: number, strength: number, radius: number): void {
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
  }

  public update(dt: number): void {
    const stepDt = Math.min(dt, 0.033);
    const stiffness = 68;
    const neighborStiffness = 22;
    const damping = Math.exp(-6.2 * stepDt);

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

        // Neighbor coupling for ripple propagation
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
    }

    this.syncBuffers();
  }

  public setSectorTheme(wave: number): void {
    const idx = Math.max(0, wave - 1) % 5;
    if (idx === this.themeIdx) return;
    this.themeIdx = idx;
    const themes: Array<{ base: [number, number, number]; warp: [number, number, number] }> = [
      { base: [0.08, 0.14, 0.48], warp: [0.55, 0.80, 0.62] }, // Cyber Vault
      { base: [0.28, 0.08, 0.12], warp: [0.75, 0.42, 0.22] }, // Reactor Choke
      { base: [0.06, 0.22, 0.44], warp: [0.35, 0.82, 0.72] }, // Cryo Gauntlet
      { base: [0.06, 0.26, 0.22], warp: [0.32, 0.85, 0.52] }, // Bio-Core Ring
      { base: [0.22, 0.08, 0.44], warp: [0.72, 0.35, 0.85] }, // Void Sanctum
    ];
    const t = themes[idx]!;
    this.baseRgb = t.base;
    this.warpRgb = t.warp;
    this.syncBuffers();
  }

  private syncBuffers(): void {
    let ptr = 0;
    const [br, bg, bb] = this.baseRgb;
    const [wr, wg, wb] = this.warpRgb;
    const writeVertex = (idx: number): void => {
      const x = this.posX[idx]!;
      const y = this.posY[idx]!;
      const dx = x - this.restX[idx]!;
      const dy = y - this.restY[idx]!;
      const disp = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 26);

      this.linePositions[ptr] = x;
      this.linePositions[ptr + 1] = y;
      this.linePositions[ptr + 2] = -disp * 8;

      this.lineColors[ptr] = br + disp * wr;
      this.lineColors[ptr + 1] = bg + disp * wg;
      this.lineColors[ptr + 2] = bb + disp * wb;
      ptr += 3;
    };

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols - 1; c++) {
        const idx = r * this.cols + c;
        writeVertex(idx);
        writeVertex(idx + 1);
      }
    }

    for (let r = 0; r < this.rows - 1; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        writeVertex(idx);
        writeVertex(idx + this.cols);
      }
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

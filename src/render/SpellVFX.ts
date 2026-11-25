import * as THREE from 'three';
import { createGlowSprite } from './GlowUtil';
import {
  buildRibbonGeometry,
  createBeamCoreMaterial,
  createBraidedBeamMaterial,
  createCrystalBladeMaterial,
  createCurvedBarrierMaterial,
  createForcefieldWallMaterial,
  createHexDomeMaterial,
  createLiquidPoolMaterial,
  createNeonRibbonMaterial,
  createSlashMaterial,
  createSprayConeMaterial,
  createStormCloudMaterial,
  createStormVortexMaterial,
  setShaderUniform,
} from './NeonShaders';
import {
  ArenaBlock,
  ArenaPillar,
  BeamEntity,
  ELEMENT_META,
  HazardZoneEntity,
  MineEntity,
  PoolEntity,
  ProjectileEntity,
  QueueElement,
  SectorGate,
  ShieldBarrierEntity,
  SimSnapshot,
  SlashArcEntity,
  SpawnRiftEntity,
  StormEntity,
  WallPylonEntity,
} from '../sim/types';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

class ParticlePool {
  public readonly maxCount: number;
  private readonly items: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor(
    scene: THREE.Scene,
    maxCount: number,
    size: number,
    texture: THREE.Texture,
    opacity = 0.9
  ) {
    this.maxCount = maxCount;
    this.positions = new Float32Array(maxCount * 3);
    this.colors = new Float32Array(maxCount * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(this.geometry, mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  public add(p: Particle): void {
    if (this.items.length >= this.maxCount) this.items.shift();
    this.items.push(p);
  }

  public update(dt: number, drag = 0.94): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(1, p.z + p.vz * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
    }

    for (let i = 0; i < this.maxCount; i++) {
      const p = this.items[i];
      if (p) {
        const fade = p.life / p.maxLife;
        this.positions[i * 3] = p.x;
        this.positions[i * 3 + 1] = p.y;
        this.positions[i * 3 + 2] = p.z;
        this.colors[i * 3] = p.color.r * fade;
        this.colors[i * 3 + 1] = p.color.g * fade;
        this.colors[i * 3 + 2] = p.color.b * fade;
      } else {
        this.positions[i * 3] = 0;
        this.positions[i * 3 + 1] = 0;
        this.positions[i * 3 + 2] = -9999;
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface TransientObject {
  obj: THREE.Object3D;
  life: number;
  maxLife: number;
  expandRate?: number;
}

interface TransientWaveArc {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface GeometricShard {
  obj: THREE.Object3D;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotSpeed: number;
  life: number;
  maxLife: number;
}

interface StormStrikeAnim {
  group: THREE.Group;
  orb: THREE.Object3D;
  beam: THREE.Mesh;
  life: number;
  maxLife: number;
  x: number;
  y: number;
  colorHex: number;
  secondaryColorHex: number;
}

function createSoftOrbTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.28, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createStarSparkTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;

  const grad = ctx.createRadialGradient(half, half, 0, half, half, half * 0.65);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(half, 4);
  ctx.quadraticCurveTo(half, half, size - 4, half);
  ctx.quadraticCurveTo(half, half, half, size - 4);
  ctx.quadraticCurveTo(half, half, 4, half);
  ctx.quadraticCurveTo(half, half, half, 4);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createSnowflakeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size * 0.5;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + cos * 24, c + sin * 24);
    ctx.stroke();

    // Small crystal side branches
    const bx = c + cos * 14;
    const by = c + sin * 14;
    for (const off of [-0.65, 0.65]) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(a + off) * 8, by + Math.sin(a + off) * 8);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createCrossTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size * 0.5;

  const grad = ctx.createRadialGradient(c, c, 2, c, c, 28);
  grad.addColorStop(0, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(c - 5, c - 20, 10, 40);
  ctx.fillRect(c - 20, c - 5, 40, 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createPolygonPoints(sides: number, radius: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

function createArcPoints(startAngle: number, endAngle: number, radius: number, segs: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= segs; i++) {
    const a = startAngle + (i / segs) * (endAngle - startAngle);
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

function createCurvedStripGeometry(
  innerR: number,
  outerR: number,
  startA: number,
  endA: number,
  segs = 28,
  z = 2.0
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = startA + u * (endA - startA);
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    const pBase = i * 6;
    positions[pBase] = cos * innerR;
    positions[pBase + 1] = sin * innerR;
    positions[pBase + 2] = z;

    positions[pBase + 3] = cos * outerR;
    positions[pBase + 4] = sin * outerR;
    positions[pBase + 5] = z;

    const uvBase = i * 4;
    uvs[uvBase] = u;
    uvs[uvBase + 1] = 0;
    uvs[uvBase + 2] = u;
    uvs[uvBase + 3] = 1;

    if (i < segs) {
      const v0 = i * 2;
      indices.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function createStandingCurvedWallGeometry(
  radius: number,
  startA: number,
  endA: number,
  height: number,
  segs = 28,
  baseZ = 2
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = startA + u * (endA - startA);
    const cx = Math.cos(a) * radius;
    const cy = Math.sin(a) * radius;

    const pBase = i * 6;
    positions[pBase] = cx;
    positions[pBase + 1] = cy;
    positions[pBase + 2] = baseZ;

    positions[pBase + 3] = cx;
    positions[pBase + 4] = cy;
    positions[pBase + 5] = baseZ + height;

    const uvBase = i * 4;
    uvs[uvBase] = u;
    uvs[uvBase + 1] = 0;
    uvs[uvBase + 2] = u;
    uvs[uvBase + 3] = 1;

    if (i < segs) {
      const v0 = i * 2;
      indices.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

const SECTOR_PILLAR_COLORS = [0x00d8ff, 0xff5522, 0x44f5ff, 0x39ff88, 0xb429ff] as const;

export class SpellVFX {
  private readonly scene: THREE.Scene;
  private readonly orbTexture: THREE.CanvasTexture;
  private readonly starTexture: THREE.CanvasTexture;
  private readonly snowflakeTexture: THREE.CanvasTexture;
  private readonly crossTexture: THREE.CanvasTexture;
  private currentThemeIdx = 0;

  private readonly orbPool: ParticlePool;
  private readonly snowPool: ParticlePool;
  private readonly crossPool: ParticlePool;

  private readonly projMeshes = new Map<number, THREE.Group>();
  private readonly beamMeshes = new Map<number, THREE.Group>();
  private readonly wallMeshes = new Map<number, THREE.Group>();
  private readonly wallPanels = new Map<string, THREE.Group>();
  private readonly mineMeshes = new Map<number, THREE.Group>();
  private readonly stormMeshes = new Map<number, THREE.Group>();
  private readonly shieldMeshes = new Map<number, THREE.Group>();
  private readonly poolMeshes = new Map<number, THREE.Group>();
  private readonly slashMeshes = new Map<number, THREE.Group>();
  private readonly pillarMeshes = new Map<string, THREE.Group>();
  private readonly blockMeshes = new Map<string, THREE.Group>();
  private readonly riftMeshes = new Map<number, THREE.Group>();
  private readonly hazardMeshes = new Map<number, THREE.Group>();
  private gateGroup: THREE.Group | null = null;
  private gateLastOpen = false;

  private sprayConeMesh: THREE.Mesh | null = null;
  private sprayConeKey = '';

  private readonly transientObjs: TransientObject[] = [];
  private readonly waveArcs: TransientWaveArc[] = [];
  private readonly shards: GeometricShard[] = [];
  private readonly maxShards = 240;
  private readonly stormStrikes: StormStrikeAnim[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.orbTexture = createSoftOrbTexture();
    this.starTexture = createStarSparkTexture();
    this.snowflakeTexture = createSnowflakeTexture();
    this.crossTexture = createCrossTexture();

    this.orbPool = new ParticlePool(scene, 2200, 8.2, this.orbTexture, 0.9);
    this.snowPool = new ParticlePool(scene, 720, 14, this.snowflakeTexture, 0.92);
    this.crossPool = new ParticlePool(scene, 720, 13, this.crossTexture, 0.92);
  }

  private getVoidPalette(
    elements: readonly QueueElement[],
    colors: readonly number[],
    isEnemy = false
  ): { isVoid: boolean; outlineA: number; outlineB: number; outlineC: number; particleColors: number[] } {
    const isVoid = elements.includes('VOID');
    if (isVoid && isEnemy) {
      return {
        isVoid: true,
        outlineA: 0xb429ff,
        outlineB: 0xff2e97,
        outlineC: 0x581c87,
        particleColors: [0xb429ff, 0xff2e97],
      };
    }
    if (isVoid) {
      const otherEls = elements.filter((el) => el !== 'VOID' && el !== 'BARRIER');
      if (otherEls.length === 0) {
        return {
          isVoid: true,
          outlineA: ELEMENT_META.VOID.colorHex,
          outlineB: 0xc80a20,
          outlineC: 0xff5a68,
          particleColors: [ELEMENT_META.VOID.colorHex, 0xc80a20],
        };
      }
      const otherCols: number[] = [];
      for (const el of otherEls) {
        const hex = ELEMENT_META[el].colorHex;
        if (!otherCols.includes(hex)) otherCols.push(hex);
      }
      const a = otherCols[0]!;
      const b = otherCols[1] ?? a;
      const c = otherCols[2] ?? b;
      return { isVoid: true, outlineA: a, outlineB: b, outlineC: c, particleColors: otherCols };
    }
    const a = colors[0] ?? 0x00f5ff;
    const b = colors[1] ?? a;
    const c = colors[2] ?? b;
    return { isVoid: false, outlineA: a, outlineB: b, outlineC: c, particleColors: [...colors] };
  }

  public emitElementEmission(x: number, y: number, z: number, elements: readonly QueueElement[], radius = 14): void {
    const hasVoid = elements.includes('VOID');
    const hasNonVoid = elements.some((e) => e !== 'VOID' && e !== 'BARRIER');
    for (const el of elements) {
      if (el === 'BARRIER') continue;
      if (el === 'VOID' && hasVoid && hasNonVoid) continue;
      const ox = x + (Math.random() - 0.5) * radius * 2;
      const oy = y + (Math.random() - 0.5) * radius * 2;
      if (el === 'THERMAL' || el === 'PLASMA') {
        const flameCol = new THREE.Color(Math.random() < 0.5 ? 0xff6a00 : 0xffaa1d);
        this.orbPool.add({
          x: ox,
          y: oy,
          z: z + Math.random() * 8,
          vx: (Math.random() - 0.5) * 24,
          vy: (Math.random() - 0.5) * 24,
          vz: 45 + Math.random() * 65,
          life: 0.35 + Math.random() * 0.25,
          maxLife: 0.6,
          color: flameCol,
        });
      } else if (el === 'CRYO' || el === 'CRYSTAL') {
        this.snowPool.add({
          x: ox,
          y: oy,
          z: z + 4 + Math.random() * 14,
          vx: (Math.random() - 0.5) * 32,
          vy: (Math.random() - 0.5) * 32,
          vz: 14 + Math.random() * 24,
          life: 0.45 + Math.random() * 0.3,
          maxLife: 0.75,
          color: new THREE.Color(0x80ffff),
        });
      } else if (el === 'NANO') {
        this.crossPool.add({
          x: ox,
          y: oy,
          z: z + Math.random() * 12,
          vx: (Math.random() - 0.5) * 22,
          vy: (Math.random() - 0.5) * 22,
          vz: 38 + Math.random() * 44,
          life: 0.42 + Math.random() * 0.28,
          maxLife: 0.7,
          color: new THREE.Color(0x39ff14),
        });
      } else if (el === 'VOLT') {
        this.orbPool.add({
          x: ox,
          y: oy,
          z: z + Math.random() * 12,
          vx: (Math.random() - 0.5) * 110,
          vy: (Math.random() - 0.5) * 110,
          vz: 15 + Math.random() * 30,
          life: 0.16 + Math.random() * 0.14,
          maxLife: 0.3,
          color: new THREE.Color(0xfff733),
        });
      } else {
        const col = new THREE.Color(ELEMENT_META[el].colorHex);
        this.orbPool.add({
          x: ox,
          y: oy,
          z: z + Math.random() * 10,
          vx: (Math.random() - 0.5) * 28,
          vy: (Math.random() - 0.5) * 28,
          vz: 24 + Math.random() * 35,
          life: 0.35 + Math.random() * 0.25,
          maxLife: 0.6,
          color: col,
        });
      }
    }
  }

  private emitRockTrail(p: ProjectileEntity): void {
    const spd = Math.max(1, Math.hypot(p.vx, p.vy));
    const bx = -p.vx / spd;
    const by = -p.vy / spd;
    const nx = -by;
    const ny = bx;
    const r = p.radius * 0.9;
    const els = p.elements;
    const vp = this.getVoidPalette(els, p.colors);

    const addOrb = (colHex: number, count: number, zDrift = 38): void => {
      for (let i = 0; i < count; i++) {
        const lat = (Math.random() - 0.5) * r * 1.8;
        const back = Math.random() * r * 0.9;
        const slip = 55 + Math.random() * 95;
        const maxLife = 0.24 + Math.random() * 0.24;
        this.orbPool.add({
          x: p.x + bx * back + nx * lat,
          y: p.y + by * back + ny * lat,
          z: 10 + Math.random() * 12,
          vx: bx * slip + (Math.random() - 0.5) * 45,
          vy: by * slip + (Math.random() - 0.5) * 45,
          vz: (Math.random() - 0.25) * zDrift,
          life: maxLife,
          maxLife,
          color: new THREE.Color(colHex),
        });
      }
    };

    if (els.includes('THERMAL') || els.includes('PLASMA')) {
      addOrb(0xff6a00, 3, 68);
      addOrb(0xffbb22, 2, 75);
    }
    if (els.includes('CRYO') || els.includes('CRYSTAL')) {
      for (let i = 0; i < 4; i++) {
        const lat = (Math.random() - 0.5) * r * 1.9;
        this.snowPool.add({
          x: p.x + nx * lat,
          y: p.y + ny * lat,
          z: 12 + Math.random() * 12,
          vx: bx * (45 + Math.random() * 70) + (Math.random() - 0.5) * 35,
          vy: by * (45 + Math.random() * 70) + (Math.random() - 0.5) * 35,
          vz: 10 + Math.random() * 25,
          life: 0.35 + Math.random() * 0.22,
          maxLife: 0.57,
          color: new THREE.Color(0x80ffff),
        });
      }
      addOrb(0x00f5ff, 3, 30);
    }
    if (els.includes('NANO')) {
      for (let i = 0; i < 4; i++) {
        const lat = (Math.random() - 0.5) * r * 1.8;
        this.crossPool.add({
          x: p.x + nx * lat,
          y: p.y + ny * lat,
          z: 12 + Math.random() * 12,
          vx: bx * (40 + Math.random() * 65) + (Math.random() - 0.5) * 30,
          vy: by * (40 + Math.random() * 65) + (Math.random() - 0.5) * 30,
          vz: 20 + Math.random() * 35,
          life: 0.32 + Math.random() * 0.2,
          maxLife: 0.52,
          color: new THREE.Color(0x39ff14),
        });
      }
      addOrb(0x39ff14, 2, 35);
    }
    if (els.includes('FLUX')) {
      addOrb(0x1a6bff, 3, 30);
      addOrb(0x66b2ff, 2, 30);
    }
    if (els.includes('VOID')) {
      for (let i = 0; i < 5; i++) {
        const col = vp.particleColors[i % vp.particleColors.length]!;
        addOrb(col, 1, 35);
      }
    }

    // Always shed earthy stone sparks + occasional geometric stone chips
    addOrb(vp.isVoid ? vp.outlineA : ELEMENT_META.KINETIC.colorHex, 3, 45);
    if (Math.random() < 0.28) {
      const chipColors = vp.isVoid ? vp.particleColors : [ELEMENT_META.KINETIC.colorHex, ...p.colors];
      this.spawnShards(p.x, p.y, chipColors, 1, 0.45, Math.atan2(by, bx));
    }
  }

  public spawnThruster(x: number, y: number, angle: number, colorHex: number): void {
    const base = new THREE.Color(colorHex);
    const ember = new THREE.Color(0xff7722);
    for (let i = 0; i < 3; i++) {
      const backA = angle + Math.PI + (Math.random() - 0.5) * 0.65;
      const spd = 85 + Math.random() * 125;
      const maxLife = 0.16 + Math.random() * 0.16;
      const col = base.clone().lerp(ember, Math.random() * 0.6).multiplyScalar(0.95);
      this.orbPool.add({
        x: x - Math.cos(angle) * 16 + (Math.random() - 0.5) * 6,
        y: y - Math.sin(angle) * 16 + (Math.random() - 0.5) * 6,
        z: 12 + (Math.random() - 0.5) * 3,
        vx: Math.cos(backA) * spd,
        vy: Math.sin(backA) * spd,
        vz: (Math.random() - 0.5) * 20,
        life: maxLife,
        maxLife,
        color: col,
      });
    }
  }

  public spawnBeamFlowParticle(
    bx: number,
    by: number,
    cos: number,
    sin: number,
    nx: number,
    ny: number,
    len: number,
    width: number,
    weightedColors: number[],
    elements: readonly QueueElement[]
  ): void {
    const palette = weightedColors.length > 0 ? weightedColors : [0xf59e0b];
    for (let k = 0; k < 4; k++) {
      const dist = Math.random() * len;
      const lat = (Math.random() - 0.5) * width * 0.95;
      const cHex = palette[Math.floor(Math.random() * palette.length)]!;
      const color = new THREE.Color(cHex).lerp(new THREE.Color(0xffffff), Math.random() * 0.3).multiplyScalar(0.95);
      const spd = 460 + Math.random() * 320;
      const flutter = (Math.random() - 0.5) * 75;
      const maxLife = 0.18 + Math.random() * 0.18;
      this.orbPool.add({
        x: bx + cos * dist + nx * lat,
        y: by + sin * dist + ny * lat,
        z: 14 + (Math.random() - 0.5) * 8,
        vx: cos * spd + nx * flutter,
        vy: sin * spd + ny * flutter,
        vz: (Math.random() - 0.5) * 35,
        life: maxLife,
        maxLife,
        color,
      });
    }

    if (elements.includes('NANO') && Math.random() < 0.45) {
      const dist = Math.random() * len;
      const lat = (Math.random() - 0.5) * width * 0.85;
      this.crossPool.add({
        x: bx + cos * dist + nx * lat,
        y: by + sin * dist + ny * lat,
        z: 16,
        vx: cos * 380,
        vy: sin * 380,
        vz: 18,
        life: 0.25,
        maxLife: 0.25,
        color: new THREE.Color(0x39ff14),
      });
    }
    if ((elements.includes('CRYO') || elements.includes('CRYSTAL')) && Math.random() < 0.45) {
      const dist = Math.random() * len;
      const lat = (Math.random() - 0.5) * width * 0.85;
      this.snowPool.add({
        x: bx + cos * dist + nx * lat,
        y: by + sin * dist + ny * lat,
        z: 16,
        vx: cos * 340,
        vy: sin * 340,
        vz: 14,
        life: 0.28,
        maxLife: 0.28,
        color: new THREE.Color(0x80ffff),
      });
    }
  }

  public spawnBurst(x: number, y: number, colorHex: number, count: number, speedScale = 1): void {
    const base = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (80 + Math.random() * 250) * speedScale;
      const maxLife = 0.24 + Math.random() * 0.3;
      const col = base.clone().multiplyScalar(0.85 + Math.random() * 0.2);
      this.orbPool.add({
        x,
        y,
        z: 10 + Math.random() * 12,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: 20 + Math.random() * 75,
        life: maxLife,
        maxLife,
        color: col,
      });
    }
  }

  public spawnShards(x: number, y: number, colors: number[], count: number, speedScale = 1, dirAngle?: number): void {
    const palette = colors.length > 0 ? colors : [ELEMENT_META.KINETIC.colorHex];
    for (let i = 0; i < count; i++) {
      if (this.shards.length >= this.maxShards) {
        const oldest = this.shards.shift()!;
        this.scene.remove(oldest.obj);
        this.disposeObject(oldest.obj);
      }
      const cHex = palette[i % palette.length]!;
      const s = 3.5 + Math.random() * 4.5;
      const pts =
        i % 2 === 0
          ? [
              { x: s * 1.4, y: 0 },
              { x: -s * 0.85, y: s * 0.72 },
              { x: -s * 0.85, y: -s * 0.72 },
            ]
          : [
              { x: s * 1.3, y: 0 },
              { x: 0, y: s * 0.65 },
              { x: -s * 1.1, y: 0 },
              { x: 0, y: -s * 0.65 },
            ];

      const geo = buildRibbonGeometry(pts, 1.8, true, 12);
      const mat = createNeonRibbonMaterial(cHex, 1.15, 0.95);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0);
      const a = dirAngle !== undefined ? dirAngle + (Math.random() - 0.5) * 0.95 : Math.random() * Math.PI * 2;
      mesh.rotation.z = a;
      this.scene.add(mesh);

      const spd = (120 + Math.random() * 250) * speedScale;
      const maxLife = 0.26 + Math.random() * 0.28;
      this.shards.push({
        obj: mesh,
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        rotSpeed: (Math.random() - 0.5) * 14,
        life: maxLife,
        maxLife,
      });
    }
  }

  public spawnRing(x: number, y: number, radius: number, colorHex: number, duration = 0.28): void {
    const pts = createPolygonPoints(32, radius);
    const mesh = new THREE.Mesh(
      buildRibbonGeometry(pts, 4.2, true, 3.0),
      createNeonRibbonMaterial(colorHex, 1.25, 1.0)
    );
    mesh.position.set(x, y, 0);
    mesh.scale.set(0.25, 0.25, 1);
    this.scene.add(mesh);
    this.transientObjs.push({ obj: mesh, life: duration, maxLife: duration, expandRate: 1 / duration });
  }

  public spawnStormStrike(
    x: number,
    y: number,
    colorHex: number,
    secondaryColorHex: number,
    _radius: number
  ): void {
    const group = new THREE.Group();
    group.position.set(x, y, 0);

    const beamGeo = new THREE.PlaneGeometry(18, 128);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 64);
    const beam = new THREE.Mesh(
      beamGeo,
      createNeonRibbonMaterial(secondaryColorHex, 1.3, 0.92)
    );
    group.add(beam);

    const orb = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.orbTexture,
        color: colorHex,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    orb.scale.set(34, 34, 1);
    orb.position.set(0, 0, 125);
    group.add(orb);

    this.scene.add(group);
    this.stormStrikes.push({
      group,
      orb,
      beam,
      life: 0.19,
      maxLife: 0.19,
      x,
      y,
      colorHex,
      secondaryColorHex,
    });
  }

  public spawnSpray(
    x: number,
    y: number,
    angle: number,
    spread: number,
    range: number,
    colors: number[],
    isNova: boolean
  ): void {
    const palette = colors.length > 0 ? colors : [0x00f5ff];
    const count = isNova ? 76 : 32;
    const hasCryo = palette.includes(ELEMENT_META.CRYO.colorHex) || palette.includes(ELEMENT_META.CRYSTAL.colorHex);
    const hasNano = palette.includes(ELEMENT_META.NANO.colorHex);

    for (let i = 0; i < count; i++) {
      const cHex = palette[i % palette.length]!;
      const color = new THREE.Color(cHex).multiplyScalar(0.95);
      const a = isNova ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const spd = range * (1.8 + Math.random() * 1.55);
      const maxLife = 0.26 + Math.random() * 0.22;
      const p: Particle = {
        x,
        y,
        z: 10 + Math.random() * 8,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: (Math.random() - 0.5) * 30,
        life: maxLife,
        maxLife,
        color,
      };
      if (hasCryo && i % 3 === 0) this.snowPool.add(p);
      else if (hasNano && i % 3 === 0) this.crossPool.add(p);
      else this.orbPool.add(p);
    }

    const arcCount = isNova ? 5 : 2;
    for (let i = 0; i < arcCount; i++) {
      const a = isNova ? angle + (i / arcCount) * Math.PI * 2 : angle + (i - 0.5) * 0.08;
      const arcSpan = isNova ? Math.PI * 0.58 : spread * (i === 0 ? 0.88 : 0.65);
      const cHex = palette[i % palette.length]!;
      const layerR = i === 0 ? 28 : 20;
      const pts = createArcPoints(-arcSpan * 0.5, arcSpan * 0.5, layerR, 16);
      const mesh = new THREE.Mesh(
        buildRibbonGeometry(pts, i === 0 ? 3.8 : 2.6, false, 12),
        createNeonRibbonMaterial(cHex, 1.2, i === 0 ? 0.95 : 0.72)
      );
      mesh.position.set(x, y, 0);
      mesh.rotation.z = a;
      this.scene.add(mesh);
      const maxLife = 0.34;
      const spd = range * (i === 0 ? 2.35 : 2.05);
      this.waveArcs.push({
        mesh,
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: maxLife,
        maxLife,
      });
    }
  }

  public spawnLightning(points: Array<{ x: number; y: number }>, colors: number[]): void {
    if (points.length < 2) return;
    const palette = colors.length > 0 ? colors : [0xfff733];
    const jagged: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      jagged.push({ x: a.x, y: a.y });
      const steps = 7;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const jitter = (Math.random() - 0.5) * 32;
        jagged.push({ x: a.x + dx * t + nx * jitter, y: a.y + dy * t + ny * jitter });
      }
    }
    const last = points[points.length - 1]!;
    jagged.push({ x: last.x, y: last.y });

    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        buildRibbonGeometry(jagged, 5.5, false, 15),
        createNeonRibbonMaterial(palette[0]!, 1.25, 0.95)
      )
    );
    group.add(
      new THREE.Mesh(
        buildRibbonGeometry(jagged, 1.8, false, 16),
        createNeonRibbonMaterial(0xffffff, 1.35, 1.0)
      )
    );

    if (palette.length > 1) {
      const offsetPts = jagged.map((p) => ({
        x: p.x + (Math.random() - 0.5) * 14,
        y: p.y + (Math.random() - 0.5) * 14,
      }));
      group.add(
        new THREE.Mesh(
          buildRibbonGeometry(offsetPts, 3.5, false, 14),
          createNeonRibbonMaterial(palette[1]!, 1.15, 0.85)
        )
      );
    }

    this.scene.add(group);
    this.transientObjs.push({ obj: group, life: 0.16, maxLife: 0.16 });
  }

  public update(snapshot: SimSnapshot, dt: number, timeSec: number): void {
    this.currentThemeIdx = Math.max(0, snapshot.wave - 1) % SECTOR_PILLAR_COLORS.length;
    this.syncSprayCone(snapshot, timeSec);
    this.syncProjectiles(snapshot.projectiles, timeSec);
    this.syncBeams(snapshot.beams, timeSec, snapshot.player.channel?.beamId ?? null);
    this.syncWalls(snapshot.walls, timeSec);
    this.syncMines(snapshot.mines, timeSec);
    this.syncStorms(snapshot.storms, timeSec);
    this.syncShields(snapshot.shields, timeSec);
    this.syncPools(snapshot.pools, timeSec);
    this.syncSlashes(snapshot.slashes);
    this.syncPillars(snapshot.pillars);
    this.syncBlocks(snapshot.blocks);
    this.syncRifts(snapshot.rifts, timeSec);
    this.syncHazards(snapshot.hazards);
    this.syncGate(snapshot.gate, timeSec);
    this.syncEnemyStatusParticles(snapshot);

    // Update storm strikes
    for (let i = this.stormStrikes.length - 1; i >= 0; i--) {
      const st = this.stormStrikes[i]!;
      st.life -= dt;
      const t = Math.max(0, st.life / st.maxLife);
      st.orb.position.z = t * 125;
      setShaderUniform(st.beam.material, 'uOpacity', 0.45 + (1 - t) * 0.55);
      if (st.life <= 0) {
        this.spawnBurst(st.x, st.y, st.colorHex, 20, 1.25);
        this.spawnShards(st.x, st.y, [st.colorHex, st.secondaryColorHex], 6, 0.9);
        this.spawnRing(st.x, st.y, 48, st.colorHex, 0.28);
        this.scene.remove(st.group);
        this.disposeObject(st.group);
        this.stormStrikes.splice(i, 1);
      }
    }

    // Update wave arcs
    for (let i = this.waveArcs.length - 1; i >= 0; i--) {
      const wa = this.waveArcs[i]!;
      wa.life -= dt;
      if (wa.life <= 0) {
        this.scene.remove(wa.mesh);
        this.disposeObject(wa.mesh);
        this.waveArcs.splice(i, 1);
      } else {
        wa.x += wa.vx * dt;
        wa.y += wa.vy * dt;
        wa.mesh.position.set(wa.x, wa.y, 0);
        const prog = 1 - wa.life / wa.maxLife;
        const s = 1 + prog * 2.75;
        wa.mesh.scale.set(s, s, 1);
        setShaderUniform(wa.mesh.material, 'uOpacity', (wa.life / wa.maxLife) * 0.92);
      }
    }

    // Update geometric shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const sh = this.shards[i]!;
      sh.life -= dt;
      if (sh.life <= 0) {
        this.scene.remove(sh.obj);
        this.disposeObject(sh.obj);
        this.shards.splice(i, 1);
      } else {
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        sh.vx *= 0.93;
        sh.vy *= 0.93;
        sh.obj.position.set(sh.x, sh.y, 0);
        sh.obj.rotation.z += sh.rotSpeed * dt;
        const ratio = sh.life / sh.maxLife;
        sh.obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial && child.material.uniforms.uOpacity) {
            child.material.uniforms.uOpacity.value = ratio;
          }
        });
      }
    }

    // Update transient ribbons / rings / lightning
    for (let i = this.transientObjs.length - 1; i >= 0; i--) {
      const tl = this.transientObjs[i]!;
      tl.life -= dt;
      if (tl.life <= 0) {
        this.scene.remove(tl.obj);
        this.disposeObject(tl.obj);
        this.transientObjs.splice(i, 1);
      } else {
        const ratio = tl.life / tl.maxLife;
        if (tl.expandRate) {
          const s = 0.25 + (1 - ratio) * 0.95;
          tl.obj.scale.set(s, s, 1);
        }
        tl.obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial && child.material.uniforms.uOpacity) {
            child.material.uniforms.uOpacity.value = ratio;
          } else if (child instanceof THREE.Line && child.material instanceof THREE.LineBasicMaterial) {
            child.material.opacity = ratio;
          }
        });
      }
    }

    this.orbPool.update(dt, 0.94);
    this.snowPool.update(dt, 0.96);
    this.crossPool.update(dt, 0.95);
  }

  private syncEnemyStatusParticles(snapshot: SimSnapshot): void {
    if (snapshot.player.channel?.delivery === 'SELF_HEAL') {
      this.emitElementEmission(snapshot.player.x, snapshot.player.y, 14, ['NANO'], 18);
    }

    for (const e of snapshot.enemies) {
      if (e.statuses.IGNITED && Math.random() < 0.72) {
        this.emitElementEmission(e.x, e.y, 12, ['THERMAL'], e.radius * 0.85);
      }
      if ((e.statuses.FROZEN || e.statuses.CHILLED) && Math.random() < (e.statuses.FROZEN ? 0.65 : 0.35)) {
        this.emitElementEmission(e.x, e.y, 12, ['CRYO'], e.radius * 0.95);
      }
      if (e.statuses.CORRUPTED && Math.random() < 0.5) {
        this.emitElementEmission(e.x, e.y, 12, ['NANO'], e.radius * 0.85);
      }
      if (e.statuses.PRIMED && Math.random() < 0.35) {
        this.emitElementEmission(e.x, e.y, 6, ['FLUX'], e.radius * 0.9);
      }
    }
  }

  private syncSprayCone(snapshot: SimSnapshot, timeSec: number): void {
    const ch = snapshot.player.channel;
    if (!ch || ch.delivery !== 'SPRAY') {
      if (this.sprayConeMesh) {
        this.sprayConeMesh.visible = false;
      }
      return;
    }

    const comp = ch.composition;
    const range = 260;
    const key = `${comp.primaryColorHex}-${comp.secondaryColorHex}`;
    if (!this.sprayConeMesh || this.sprayConeKey !== key) {
      if (this.sprayConeMesh) {
        this.scene.remove(this.sprayConeMesh);
        this.disposeObject(this.sprayConeMesh);
      }
      const geo = new THREE.PlaneGeometry(range, range * 2);
      geo.translate(range * 0.5, 0, 12);
      const mat = createSprayConeMaterial(comp.primaryColorHex, comp.secondaryColorHex);
      setShaderUniform(mat, 'uHalfAngle', 0.46);
      this.sprayConeMesh = new THREE.Mesh(geo, mat);
      this.sprayConeKey = key;
      this.scene.add(this.sprayConeMesh);
    }

    const p = snapshot.player;
    this.sprayConeMesh.visible = true;
    this.sprayConeMesh.position.set(p.x + Math.cos(p.aimAngle) * 20, p.y + Math.sin(p.aimAngle) * 20, 0);
    this.sprayConeMesh.rotation.z = p.aimAngle;
    setShaderUniform(this.sprayConeMesh.material, 'uTime', timeSec);
    setShaderUniform(this.sprayConeMesh.material, 'uOpacity', Math.min(1, ch.remaining * 2.5));
  }

  private syncProjectiles(items: readonly ProjectileEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const p of items) {
      alive.add(p.id);
      let g = this.projMeshes.get(p.id);
      if (!g) {
        g = new THREE.Group();
        if (p.kind === 'ROCK') {
          const s = p.radius * 1.12;
          const rockGeo = new THREE.DodecahedronGeometry(s, 0);
          const wire = new THREE.WireframeGeometry(rockGeo);
          const vp = this.getVoidPalette(p.elements, p.colors);
          const infused = vp.isVoid
            ? vp.outlineA
            : p.colors.find((c) => c !== ELEMENT_META.KINETIC.colorHex) ?? p.colorHex;
          const isPureBrown = infused === ELEMENT_META.KINETIC.colorHex;
          const bodyTint = vp.isVoid
            ? new THREE.Color(0x060508)
            : new THREE.Color(0x3d281a).lerp(new THREE.Color(infused), isPureBrown ? 0.35 : 0.5);

          // Solid opaque shaded 3D boulder (pitch-black core for Void, earthy brown or infused for non-Void)
          g.add(
            new THREE.Mesh(
              rockGeo,
              new THREE.MeshStandardMaterial({
                color: bodyTint,
                emissive: infused,
                emissiveIntensity: vp.isVoid ? 0.22 : 0.55,
                roughness: 0.55,
                metalness: 0.25,
              })
            )
          );
          g.add(
            new THREE.LineSegments(
              wire,
              new THREE.LineBasicMaterial({ color: infused })
            )
          );
          g.add(createGlowSprite(infused, s * 2.8, 0.3));
        } else {
          const vp = this.getVoidPalette(p.elements, p.colors);
          // Crystal Shard Blade blending CRYSTAL cyan + any mixed element color cleanly (black core when Void)
          const mixedColor = vp.isVoid
            ? vp.outlineA
            : p.colors.find((c) => c !== ELEMENT_META.CRYSTAL.colorHex && c !== 0x80ffff) ?? p.colorHex;
          const r = p.radius;
          const tip = r * 2.7;
          const back = -r * 1.15;
          const w = r * 0.64;

          const bladeGeo = new THREE.BufferGeometry();
          bladeGeo.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(
              [
                tip, 0, 13,
                -r * 0.15, w, 13,
                back, 0, 13,
                -r * 0.15, -w, 13,
              ],
              3
            )
          );
          bladeGeo.setAttribute(
            'uv',
            new THREE.Float32BufferAttribute([1, 0.5, 0.45, 1, 0, 0.5, 0.45, 0], 2)
          );
          bladeGeo.setIndex([0, 1, 2, 0, 2, 3]);
          g.add(new THREE.Mesh(bladeGeo, createCrystalBladeMaterial(0x80ffff, mixedColor, vp.isVoid)));

          const edgePts = [
            { x: tip, y: 0 },
            { x: -r * 0.15, y: w },
            { x: back, y: 0 },
            { x: -r * 0.15, y: -w },
          ];
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(edgePts, 2.1, true, 13.4),
              createNeonRibbonMaterial(mixedColor, 1.25, 0.9)
            )
          );
          const contrail = [
            { x: back * 0.7, y: 0 },
            { x: -r * 4.8, y: 0 },
          ];
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(contrail, r * 0.44, false, 12.6),
              createNeonRibbonMaterial(mixedColor, 1.1, 0.65)
            )
          );
          g.add(createGlowSprite(mixedColor, r * 2.4, 0.22));
        }
        this.projMeshes.set(p.id, g);
        this.scene.add(g);
      }
      g.position.set(p.x, p.y, p.kind === 'ROCK' ? 14 : 0);
      if (p.kind === 'ROCK') {
        g.rotation.x = p.spin;
        g.rotation.y = p.spin * 0.7;
        this.emitRockTrail(p);
      } else {
        g.rotation.z = Math.atan2(p.vy, p.vx);
        const blade = g.children[0];
        if (blade instanceof THREE.Mesh) {
          setShaderUniform(blade.material, 'uTime', timeSec);
        }
        if (p.owner === 'PLAYER' && Math.random() < 0.25) {
          this.emitElementEmission(p.x, p.y, 13, p.elements, 4);
        }
      }
    }
    this.pruneMap(this.projMeshes, alive);
  }

  private syncBeams(items: readonly BeamEntity[], timeSec: number, channeledBeamId: number | null): void {
    const alive = new Set<number>();
    for (const b of items) {
      alive.add(b.id);
      let group = this.beamMeshes.get(b.id);
      const len = Math.max(8, b.clashing ? b.clashDist : b.length);
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const nx = -sin;
      const ny = cos;

      const vp = this.getVoidPalette(b.elements, b.colors, b.owner === 'ENEMY');
      const isVoid = vp.isVoid;
      let cA = vp.outlineA;
      let cB = vp.outlineB;
      let cC = vp.outlineC;

      if (!isVoid && b.colors.length === 1 && b.elements.includes('NANO')) {
        cA = 0x39ff14;
        cB = 0x00e676;
        cC = 0xa7f3d0;
      }

      if (!group) {
        group = new THREE.Group();
        const stripW = Math.max(40, Math.min(64, b.width * 2.1));

        // 0: Solid White-Hot (Nano/Standard) or Dark-Core (Void) Normal-blended beam body
        const corePlane = new THREE.PlaneGeometry(1, stripW);
        corePlane.translate(0.5, 0, 0);
        group.add(new THREE.Mesh(corePlane, createBeamCoreMaterial(cA, cB, isVoid)));

        // 1: Additive swirling colored braided wrappings around core
        const braidPlane = new THREE.PlaneGeometry(1, stripW * 1.15);
        braidPlane.translate(0.5, 0, 0);
        group.add(new THREE.Mesh(braidPlane, createBraidedBeamMaterial(cA, cB, cC, isVoid)));

        // 2: End impact crystal / flare
        const impactDiamond = [
          { x: 14, y: 0 },
          { x: 0, y: 9 },
          { x: -9, y: 0 },
          { x: 0, y: -9 },
        ];
        group.add(
          new THREE.Mesh(
            buildRibbonGeometry(impactDiamond, 2.4, true, 15.0),
            createNeonRibbonMaterial(cB, 1.25, 0.9)
          )
        );

        // 3: End impact sprite halo
        group.add(createGlowSprite(cB, 32, 0.28));

        // 4: Twinkling 4-point star-sparks riding along the beam
        const sparkContainer = new THREE.Group();
        for (let s = 0; s < 8; s++) {
          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: this.starTexture,
              color: s % 2 === 0 ? cB : 0xffffff,
              transparent: true,
              opacity: 0.88,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          const sz = 10 + (s % 3) * 5;
          sp.scale.set(sz, sz, 1);
          sparkContainer.add(sp);
        }
        group.add(sparkContainer);

        this.beamMeshes.set(b.id, group);
        this.scene.add(group);
      }

      const fade =
        b.id === channeledBeamId
          ? 1.0
          : Math.min(1, (b.life / Math.max(0.05, b.maxLife)) * 2.5);

      const coreMesh = group.children[0] as THREE.Mesh;
      coreMesh.position.set(b.x, b.y, 13.8);
      coreMesh.rotation.z = b.angle;
      coreMesh.scale.set(len, 1, 1);
      setShaderUniform(coreMesh.material, 'uTime', timeSec);
      setShaderUniform(coreMesh.material, 'uLength', len / 24);
      setShaderUniform(coreMesh.material, 'uFade', fade);

      const braidMesh = group.children[1] as THREE.Mesh;
      braidMesh.position.set(b.x, b.y, 14.4);
      braidMesh.rotation.z = b.angle;
      braidMesh.scale.set(len, 1, 1);
      setShaderUniform(braidMesh.material, 'uTime', timeSec);
      setShaderUniform(braidMesh.material, 'uLength', len / 24);
      setShaderUniform(braidMesh.material, 'uFade', fade);

      const impactMesh = group.children[2] as THREE.Mesh;
      impactMesh.position.set(b.x + cos * len, b.y + sin * len, 0);
      impactMesh.rotation.z = timeSec * 10 + b.id;

      group.children[3]!.position.set(b.x + cos * len, b.y + sin * len, 14);

      const sparks = group.children[4] as THREE.Group;
      for (let s = 0; s < sparks.children.length; s++) {
        const sp = sparks.children[s] as THREE.Sprite;
        const frac = (s / sparks.children.length + timeSec * 0.85) % 1;
        const along = frac * len;
        const lat = Math.sin(along * 0.04 - timeSec * 10 + s * 1.9) * (b.width * 0.42);
        sp.position.set(b.x + cos * along + nx * lat, b.y + sin * along + ny * lat, 15.5);
        sp.material.opacity = Math.sin(frac * Math.PI) * 0.88 * fade;
      }

      const flowColors = isVoid ? vp.particleColors : b.composition.weightedColors;
      this.spawnBeamFlowParticle(b.x, b.y, cos, sin, nx, ny, len, b.width, flowColors, b.elements);
      if (isVoid && Math.random() < 0.35) {
        const d = Math.random() * len;
        this.spawnShards(
          b.x + cos * d + nx * (Math.random() - 0.5) * b.width * 0.7,
          b.y + sin * d + ny * (Math.random() - 0.5) * b.width * 0.7,
          [cA, cB],
          1,
          0.85,
          b.angle
        );
      }
    }
    this.pruneMap(this.beamMeshes, alive);
  }

  private syncWalls(items: readonly WallPylonEntity[], timeSec: number): void {
    const alive = new Set<number>();
    const activePanelKeys = new Set<string>();
    const groups = new Map<number, WallPylonEntity[]>();

    for (const w of items) {
      alive.add(w.id);
      let arr = groups.get(w.groupId);
      if (!arr) {
        arr = [];
        groups.set(w.groupId, arr);
      }
      arr.push(w);

      let g = this.wallMeshes.get(w.id);
      const vp = this.getVoidPalette(w.elements, w.colors);
      const payloadColors = w.colors.filter((c) => c !== 0xe6f0ff);
      const p1 = vp.isVoid ? vp.outlineA : (payloadColors[0] ?? w.colorHex);
      const p2 = vp.isVoid ? vp.outlineB : (payloadColors[1] ?? p1);

      if (!g) {
        g = new THREE.Group();
        const cyl = new THREE.CylinderGeometry(7, 10, 56, 6, 1);
        cyl.rotateX(Math.PI / 2);
        const wire = new THREE.WireframeGeometry(cyl);
        g.add(
          new THREE.Mesh(
            cyl,
            new THREE.MeshStandardMaterial({
              color: vp.isVoid ? 0x060508 : 0x182236,
              emissive: p1,
              emissiveIntensity: vp.isVoid ? 0.15 : 0.45,
              roughness: 0.4,
              metalness: 0.4,
            })
          )
        );
        g.add(
          new THREE.LineSegments(
            wire,
            new THREE.LineBasicMaterial({ color: p1 })
          )
        );
        const cap = createGlowSprite(p2, 24, 0.25);
        cap.position.z = 28;
        g.add(cap);
        g.position.set(w.x, w.y, 28);
        this.wallMeshes.set(w.id, g);
        this.scene.add(g);
      }
    }

    const pairs: Array<{ a: WallPylonEntity; b: WallPylonEntity }> = [];
    for (const arr of groups.values()) {
      for (let i = 0; i < arr.length - 1; i++) {
        pairs.push({ a: arr[i]!, b: arr[i + 1]! });
      }
      if (arr.length >= 3 && arr[0]!.isNova) {
        pairs.push({ a: arr[arr.length - 1]!, b: arr[0]! });
      }
    }

    for (const { a, b } of pairs) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;

      const panelKey = `${a.id}-${b.id}`;
      activePanelKeys.add(panelKey);
      let panelGroup = this.wallPanels.get(panelKey);
      const vpPanel = this.getVoidPalette(a.elements, a.colors);
      const payloadColors = a.colors.filter((c) => c !== 0xe6f0ff);
      const p1 = vpPanel.isVoid ? vpPanel.outlineA : (payloadColors[0] ?? a.colorHex);
      const p2 = vpPanel.isVoid ? vpPanel.outlineB : (payloadColors[1] ?? p1);
      const isFire = a.elements.includes('THERMAL') || a.elements.includes('PLASMA');

      if (!panelGroup) {
        panelGroup = new THREE.Group();
        const panelGeo = new THREE.PlaneGeometry(dist, 54);
        panelGeo.rotateX(Math.PI / 2);
        const wallMesh = new THREE.Mesh(panelGeo, createForcefieldWallMaterial(p1, p2, isFire));
        wallMesh.position.z = 27;
        panelGroup.add(wallMesh);

        panelGroup.add(
          new THREE.Mesh(
            buildRibbonGeometry([{ x: -dist * 0.5, y: 0 }, { x: dist * 0.5, y: 0 }], 3.5, false, 1.5),
            createNeonRibbonMaterial(p1, 1.25, 0.9)
          ),
          new THREE.Mesh(
            buildRibbonGeometry([{ x: -dist * 0.5, y: 0 }, { x: dist * 0.5, y: 0 }], 3.0, false, 54),
            createNeonRibbonMaterial(p2, 1.2, 0.85)
          )
        );
        this.wallPanels.set(panelKey, panelGroup);
        this.scene.add(panelGroup);
      }

      panelGroup.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, 0);
      panelGroup.rotation.z = Math.atan2(dy, dx);
      const fade = Math.min(1, (Math.min(a.life, b.life) / Math.max(0.1, a.maxLife)) * 2.0);
      const wallMesh = panelGroup.children[0] as THREE.Mesh;
      setShaderUniform(wallMesh.material, 'uTime', timeSec);
      setShaderUniform(wallMesh.material, 'uOpacity', fade);
      setShaderUniform((panelGroup.children[1] as THREE.Mesh).material, 'uOpacity', fade);
      setShaderUniform((panelGroup.children[2] as THREE.Mesh).material, 'uOpacity', fade);

      // Emit themed elemental particles along forcefield span
      if (Math.random() < 0.35) {
        const t = Math.random();
        this.emitElementEmission(a.x + dx * t, a.y + dy * t, 6 + Math.random() * 28, a.elements, 6);
      }
    }

    for (const [k, obj] of this.wallPanels.entries()) {
      if (!activePanelKeys.has(k)) {
        this.scene.remove(obj);
        this.disposeObject(obj);
        this.wallPanels.delete(k);
      }
    }
    this.pruneMap(this.wallMeshes, alive);
  }

  private syncMines(items: readonly MineEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const m of items) {
      alive.add(m.id);
      let g = this.mineMeshes.get(m.id);
      if (!g) {
        g = new THREE.Group();
        const vp = this.getVoidPalette(m.elements, m.colors);
        const payloadColors = m.colors.filter((c) => c !== 0xe6f0ff);
        const p1 = vp.isVoid ? vp.outlineA : (payloadColors[0] ?? m.colorHex);
        const p2 = vp.isVoid ? vp.outlineB : (payloadColors[1] ?? p1);
        const p3 = vp.isVoid ? vp.outlineC : (payloadColors[2] ?? p2);

        // 0: Cybernetic Hexagonal Circuit Emitter Base Pad (pitch-black core when Void)
        const padGroup = new THREE.Group();
        const padGeo = new THREE.CylinderGeometry(m.radius * 0.85, m.radius * 0.96, 5, 6);
        padGeo.rotateX(Math.PI / 2);
        padGroup.add(
          new THREE.Mesh(
            padGeo,
            new THREE.MeshStandardMaterial({
              color: vp.isVoid ? 0x050508 : 0x162236,
              emissive: p1,
              emissiveIntensity: vp.isVoid ? 0.08 : 0.35,
              roughness: 0.4,
              metalness: 0.6,
            })
          ),
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(6, m.radius * 0.94), 2.4, true, 3.0),
            createNeonRibbonMaterial(p1, 1.25, 0.95)
          )
        );
        padGroup.position.z = 3;
        g.add(padGroup);

        // 1: Hovering Holographic Multi-Color Prism (black core + crisp neon wireframe for Void)
        const holoGroup = new THREE.Group();
        const octGeo = new THREE.OctahedronGeometry(m.radius * 0.46, 0);
        holoGroup.add(
          new THREE.Mesh(
            octGeo,
            new THREE.MeshStandardMaterial({
              color: vp.isVoid ? 0x060508 : p2,
              emissive: vp.isVoid ? p1 : p2,
              emissiveIntensity: vp.isVoid ? 0.14 : 0.75,
              roughness: 0.25,
              metalness: 0.35,
            })
          )
        );
        if (vp.isVoid) {
          holoGroup.add(
            new THREE.LineSegments(
              new THREE.WireframeGeometry(octGeo),
              new THREE.LineBasicMaterial({ color: p1 })
            )
          );
        }
        if (vp.isVoid || p3 !== p2 || p1 !== p2) {
          holoGroup.add(
            new THREE.Mesh(
              buildRibbonGeometry(createPolygonPoints(4, m.radius * 0.62), 2.0, true, 0),
              createNeonRibbonMaterial(vp.isVoid ? p2 : (p3 !== p2 ? p3 : p1), 1.25, 0.95)
            )
          );
        }
        g.add(holoGroup);

        // 2: Horizontal Animated Circuit Scan Ring
        const scanRing = new THREE.Mesh(
          buildRibbonGeometry(createPolygonPoints(16, m.radius * 1.15), 2.0, true, 0),
          createNeonRibbonMaterial(p2, 1.2, 0.85)
        );
        g.add(scanRing);

        // 3: Subtle Hologram Glow
        g.add(createGlowSprite(p1, 26, 0.24));

        // 4: Ground proximity trigger ring
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(24, m.triggerRadius), 2.0, true, 0.9),
            createNeonRibbonMaterial(p1, 1.05, payloadColors.length >= 2 ? 0.58 : 0.36)
          )
        );

        g.position.set(m.x, m.y, 0);
        this.mineMeshes.set(m.id, g);
        this.scene.add(g);
      }

      const bobZ = 15 + Math.sin(timeSec * 4.5 + m.id) * 3.5;
      const pulse = 0.88 + Math.sin(timeSec * 7.5 + m.id) * 0.14;

      const holoGroup = g.children[1]!;
      holoGroup.position.z = bobZ;
      holoGroup.rotation.z = timeSec * 2.8 + m.id;
      holoGroup.scale.set(pulse, pulse, pulse);

      const scanRing = g.children[2]!;
      scanRing.position.z = 8 + Math.sin(timeSec * 4.5 + m.id) * 1.5;
      const scanPulse = 0.85 + Math.sin(timeSec * 6.0 + m.id) * 0.18;
      scanRing.scale.set(scanPulse, scanPulse, 1);
      scanRing.rotation.z = -timeSec * 2.0;

      const glow = g.children[3]!;
      glow.position.z = bobZ;
      glow.scale.set(26 * pulse, 26 * pulse, 1);

      if (Math.random() < 0.32) {
        this.emitElementEmission(m.x, m.y, bobZ, m.elements, m.radius * 0.7);
      }
    }
    this.pruneMap(this.mineMeshes, alive);
  }

  private syncStorms(items: readonly StormEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const s of items) {
      alive.add(s.id);
      let g = this.stormMeshes.get(s.id);
      const vp = this.getVoidPalette(s.elements, s.colors);
      if (!g) {
        g = new THREE.Group();
        const barrierColor = s.colors.includes(0xe6f0ff) ? 0xe6f0ff : s.colorHex;
        const payloadColors = s.colors.filter((c) => c !== 0xe6f0ff);
        const payloadColor = vp.isVoid ? vp.outlineA : (payloadColors[0] ?? s.colorHex);
        const secondaryPayload = vp.isVoid ? vp.outlineB : (payloadColors[1] ?? payloadColor);
        const stormStyle = s.elements.includes('VOID')
          ? 4
          : s.elements.includes('NANO')
          ? 5
          : s.elements.includes('VOLT')
          ? 3
          : s.elements.includes('CRYO') || s.elements.includes('CRYSTAL')
          ? 1
          : s.elements.includes('FLUX') && !s.elements.includes('THERMAL') && !s.elements.includes('PLASMA')
          ? 2
          : 0;

        // 0: Soft ground vortex rune with per-element swirl style
        const vortexMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(s.radius * 2.05, s.radius * 2.05),
          createStormVortexMaterial(barrierColor, payloadColor, secondaryPayload, stormStyle)
        );
        vortexMesh.position.z = 1.2;
        g.add(vortexMesh);

        // 1: Overhead billowing 3D Storm Cloud disk floating at z=120
        const cloudMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(s.radius * 2.25, s.radius * 2.25),
          createStormCloudMaterial(payloadColor, secondaryPayload, stormStyle)
        );
        cloudMesh.position.z = 120;
        g.add(cloudMesh);

        g.position.set(s.x, s.y, 0);
        this.stormMeshes.set(s.id, g);
        this.scene.add(g);
      }
      const fade = Math.min(1, (s.life / Math.max(0.1, s.maxLife)) * 2.0);
      const vortex = g.children[0] as THREE.Mesh;
      setShaderUniform(vortex.material, 'uTime', timeSec);
      setShaderUniform(vortex.material, 'uOpacity', fade * 0.72);
      const cloud = g.children[1] as THREE.Mesh;
      setShaderUniform(cloud.material, 'uTime', timeSec);
      setShaderUniform(cloud.material, 'uOpacity', fade);

      // Distinct per-element atmospheric particle effects throughout storm volume
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2;
        const dist = Math.random() * s.radius * 0.85;
        const px = s.x + Math.cos(a) * dist;
        const py = s.y + Math.sin(a) * dist;
        if (s.elements.includes('CRYO') || s.elements.includes('CRYSTAL')) {
          this.snowPool.add({
            x: px,
            y: py,
            z: 65 + Math.random() * 55,
            vx: -Math.sin(a) * 45,
            vy: Math.cos(a) * 45,
            vz: -48 - Math.random() * 35,
            life: 0.75,
            maxLife: 0.75,
            color: new THREE.Color(0x80ffff),
          });
        }
        if (s.elements.includes('NANO')) {
          this.crossPool.add({
            x: px,
            y: py,
            z: 6 + Math.random() * 45,
            vx: (Math.random() - 0.5) * 20,
            vy: (Math.random() - 0.5) * 20,
            vz: 45 + Math.random() * 40,
            life: 0.65,
            maxLife: 0.65,
            color: new THREE.Color(0x39ff14),
          });
        }
        if (s.elements.includes('THERMAL') || s.elements.includes('PLASMA')) {
          this.orbPool.add({
            x: px,
            y: py,
            z: 50 + Math.random() * 65,
            vx: (Math.random() - 0.5) * 35,
            vy: (Math.random() - 0.5) * 35,
            vz: -75 - Math.random() * 65,
            life: 0.55,
            maxLife: 0.55,
            color: new THREE.Color(Math.random() < 0.5 ? 0xff6a00 : 0xffaa1d),
          });
        }
        if (s.elements.includes('FLUX')) {
          this.orbPool.add({
            x: px,
            y: py,
            z: 90 + Math.random() * 35,
            vx: 0,
            vy: 0,
            vz: -145 - Math.random() * 60,
            life: 0.45,
            maxLife: 0.45,
            color: new THREE.Color(0x3898ff),
          });
        }
        if (s.elements.includes('VOID')) {
          const voidCol = vp.particleColors[k % vp.particleColors.length]!;
          this.orbPool.add({
            x: px,
            y: py,
            z: 10 + Math.random() * 45,
            vx: (s.x - px) * 1.4 - Math.sin(a) * 65,
            vy: (s.y - py) * 1.4 + Math.cos(a) * 65,
            vz: -15,
            life: 0.5,
            maxLife: 0.5,
            color: new THREE.Color(voidCol),
          });
        }
      }
      if (s.elements.includes('VOLT') && Math.random() < 0.25) {
        const a1 = Math.random() * Math.PI * 2;
        const a2 = a1 + (Math.random() - 0.5) * 2.2;
        const r1 = s.radius * 0.7;
        this.spawnLightning(
          [
            { x: s.x + Math.cos(a1) * r1, y: s.y + Math.sin(a1) * r1 },
            { x: s.x + Math.cos(a2) * r1, y: s.y + Math.sin(a2) * r1 },
          ],
          [0xfff733]
        );
      }
    }
    this.pruneMap(this.stormMeshes, alive);
  }

  private syncShields(items: readonly ShieldBarrierEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const s of items) {
      alive.add(s.id);
      let g = this.shieldMeshes.get(s.id);
      const secondary = s.colors.find((c) => c !== s.colorHex) ?? ELEMENT_META.NANO.colorHex;

      if (!g) {
        g = new THREE.Group();
        if (s.isNova) {
          const dome = new THREE.Mesh(
            new THREE.PlaneGeometry(s.radius * 2.15, s.radius * 2.15),
            createHexDomeMaterial(s.colorHex, secondary)
          );
          dome.position.z = 14;
          g.add(dome);

          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(createPolygonPoints(36, s.radius), 3.2, true, 14),
              createNeonRibbonMaterial(s.colorHex, 1.2, 0.9)
            )
          );
        } else {
          const wallGeo = createStandingCurvedWallGeometry(s.radius, -s.arc, s.arc, 46, 28, 2);
          g.add(new THREE.Mesh(wallGeo, createCurvedBarrierMaterial(s.colorHex, secondary)));

          const cols = 10;
          const rows = 2;
          const grid: THREE.Vector3[][] = [];
          for (let r = 0; r <= rows; r++) {
            const rowPts: THREE.Vector3[] = [];
            const z = 2 + (r / rows) * 46;
            const radScale = 1 - Math.abs(r / rows - 0.5) * 0.08;
            for (let c = 0; c <= cols; c++) {
              const a = -s.arc + (c / cols) * (s.arc * 2);
              rowPts.push(new THREE.Vector3(Math.cos(a) * s.radius * radScale, Math.sin(a) * s.radius * radScale, z));
            }
            grid.push(rowPts);
          }
          const wirePts: THREE.Vector3[] = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const p00 = grid[r]![c]!;
              const p10 = grid[r]![c + 1]!;
              const p01 = grid[r + 1]![c]!;
              const p11 = grid[r + 1]![c + 1]!;
              wirePts.push(p00, p10, p10, p11, p11, p00, p00, p01, p01, p11);
            }
          }
          g.add(
            new THREE.LineSegments(
              new THREE.BufferGeometry().setFromPoints(wirePts),
              new THREE.LineBasicMaterial({
                color: new THREE.Color(secondary).multiplyScalar(1.15),
                transparent: true,
                opacity: 0.85,
              })
            )
          );

          const tetherPts: THREE.Vector3[] = [];
          for (const frac of [-0.62, 0, 0.62]) {
            const ta = frac * s.arc;
            tetherPts.push(
              new THREE.Vector3(16, frac * 14, 14),
              new THREE.Vector3(Math.cos(ta) * s.radius * 0.96, Math.sin(ta) * s.radius * 0.96, 22)
            );
          }
          const tetherLine = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(tetherPts),
            new THREE.LineDashedMaterial({
              color: secondary,
              dashSize: 6,
              gapSize: 4,
              transparent: true,
              opacity: 0.8,
            })
          );
          tetherLine.computeLineDistances();
          g.add(tetherLine);

          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(createArcPoints(-s.arc, s.arc, s.radius, 24), 3.4, false, 48),
              createNeonRibbonMaterial(s.colorHex, 1.3, 0.95)
            )
          );
        }

        this.shieldMeshes.set(s.id, g);
        this.scene.add(g);
      }

      g.position.set(s.x, s.y, 0);
      g.rotation.z = s.angle;
      const mainMesh = g.children[0] as THREE.Mesh;
      setShaderUniform(mainMesh.material, 'uTime', timeSec);
      const hpRatio = Math.max(0.25, s.hp / Math.max(1, s.maxHp));
      setShaderUniform(mainMesh.material, 'uOpacity', 0.55 + hpRatio * 0.45);
    }
    this.pruneMap(this.shieldMeshes, alive);
  }

  private syncPools(items: readonly PoolEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const p of items) {
      alive.add(p.id);
      let g = this.poolMeshes.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const poolDisk = new THREE.Mesh(
          new THREE.PlaneGeometry(p.radius * 2.15, p.radius * 2.15),
          createLiquidPoolMaterial(p.colorHex, 0x00f5ff, p.id * 1.37)
        );
        poolDisk.position.z = 1.0;
        g.add(poolDisk);
        g.position.set(p.x, p.y, 0);
        this.poolMeshes.set(p.id, g);
        this.scene.add(g);
      }
      const fade = Math.min(1, (p.life / p.maxLife) * 1.4);
      const disk = g.children[0] as THREE.Mesh;
      setShaderUniform(disk.material, 'uTime', timeSec);
      setShaderUniform(disk.material, 'uOpacity', fade);
    }
    this.pruneMap(this.poolMeshes, alive);
  }

  private syncSlashes(items: readonly SlashArcEntity[]): void {
    const alive = new Set<number>();
    for (const s of items) {
      alive.add(s.id);
      let g = this.slashMeshes.get(s.id);
      if (!g) {
        g = new THREE.Group();
        const secondary = s.colors.find((c) => c !== s.colorHex) ?? s.colorHex;
        const bladeGeo = createCurvedStripGeometry(s.radius * 0.56, s.radius * 1.05, -s.arc, s.arc, 24, 15);
        g.add(new THREE.Mesh(bladeGeo, createSlashMaterial(s.colorHex, secondary)));
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createArcPoints(-s.arc, s.arc, s.radius, 20), 4.0, false, 15.5),
            createNeonRibbonMaterial(0xffffff, 1.3, 0.95)
          )
        );
        g.position.set(s.x, s.y, 0);
        g.rotation.z = s.angle;
        this.slashMeshes.set(s.id, g);
        this.scene.add(g);
      }
      const alpha = Math.max(0, s.life / s.maxLife);
      setShaderUniform((g.children[0] as THREE.Mesh).material, 'uFade', alpha);
      setShaderUniform((g.children[1] as THREE.Mesh).material, 'uOpacity', alpha);
    }
    this.pruneMap(this.slashMeshes, alive);
  }

  private syncPillars(items: readonly ArenaPillar[]): void {
    const alive = new Set<string>();
    const colHex = SECTOR_PILLAR_COLORS[this.currentThemeIdx]!;
    for (const p of items) {
      const key = `${p.id}:${p.x}:${p.y}:${p.radius}:${this.currentThemeIdx}`;
      alive.add(key);
      if (!this.pillarMeshes.has(key)) {
        const g = new THREE.Group();
        const h = 76;
        const cyl = new THREE.CylinderGeometry(p.radius * 0.92, p.radius, h, p.sides, 1);
        cyl.rotateX(Math.PI / 2);
        g.add(
          new THREE.Mesh(
            cyl,
            new THREE.MeshStandardMaterial({
              color: 0x162238,
              emissive: colHex,
              emissiveIntensity: 0.22,
              roughness: 0.5,
              metalness: 0.4,
            })
          )
        );
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(p.sides, p.radius * 1.04), 3.0, true, -h * 0.5 + 1),
            createNeonRibbonMaterial(colHex, 1.15, 0.85)
          ),
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(p.sides, p.radius * 0.94), 2.8, true, h * 0.5 + 0.5),
            createNeonRibbonMaterial(colHex, 1.2, 0.9)
          )
        );
        g.position.set(p.x, p.y, h * 0.5);
        this.pillarMeshes.set(key, g);
        this.scene.add(g);
      }
    }
    for (const [k, obj] of this.pillarMeshes.entries()) {
      if (!alive.has(k)) {
        this.scene.remove(obj);
        this.disposeObject(obj);
        this.pillarMeshes.delete(k);
      }
    }
  }

  private syncBlocks(items: readonly ArenaBlock[]): void {
    const alive = new Set<string>();
    const colHex = SECTOR_PILLAR_COLORS[this.currentThemeIdx]!;
    for (const b of items) {
      const key = `${b.id}:${b.x}:${b.y}:${b.halfW}:${b.halfH}:${this.currentThemeIdx}`;
      alive.add(key);
      if (!this.blockMeshes.has(key)) {
        const g = new THREE.Group();
        const boxGeo = new THREE.BoxGeometry(b.halfW * 2, b.halfH * 2, b.height);
        g.add(
          new THREE.Mesh(
            boxGeo,
            new THREE.MeshStandardMaterial({
              color: 0x131d32,
              emissive: colHex,
              emissiveIntensity: 0.16,
              roughness: 0.55,
              metalness: 0.35,
            })
          )
        );
        const cornerPts = [
          { x: -b.halfW, y: -b.halfH },
          { x: b.halfW, y: -b.halfH },
          { x: b.halfW, y: b.halfH },
          { x: -b.halfW, y: b.halfH },
        ];
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(cornerPts, 3.0, true, b.height * 0.5 + 0.6),
            createNeonRibbonMaterial(colHex, 1.15, 0.88)
          ),
          new THREE.Mesh(
            buildRibbonGeometry(cornerPts, 3.2, true, -b.height * 0.5 + 1.0),
            createNeonRibbonMaterial(colHex, 1.05, 0.65)
          )
        );
        g.position.set(b.x, b.y, b.height * 0.5);
        this.blockMeshes.set(key, g);
        this.scene.add(g);
      }
    }
    for (const [k, obj] of this.blockMeshes.entries()) {
      if (!alive.has(k)) {
        this.scene.remove(obj);
        this.disposeObject(obj);
        this.blockMeshes.delete(k);
      }
    }
  }

  private syncRifts(items: readonly SpawnRiftEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const r of items) {
      alive.add(r.id);
      let g = this.riftMeshes.get(r.id);
      if (!g) {
        g = new THREE.Group();
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(16, r.radius), 3.2, true, 1.8),
            createNeonRibbonMaterial(0xb429ff, 1.2, 0.92)
          )
        );
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(8, r.radius), 2.8, true, 2.3),
            createNeonRibbonMaterial(0x00f5ff, 1.15, 0.95)
          )
        );
        g.add(createGlowSprite(0xb429ff, r.radius * 2.0, 0.2));
        g.position.set(r.x, r.y, 0);
        this.riftMeshes.set(r.id, g);
        this.scene.add(g);
      }
      const ratio = Math.max(0.05, r.timer / Math.max(0.1, r.maxTimer));
      g.children[0]!.rotation.z = timeSec * 2.5;
      g.children[1]!.scale.set(ratio, ratio, 1);
      g.children[1]!.rotation.z = -timeSec * 3.5;
    }
    this.pruneMap(this.riftMeshes, alive);
  }

  private syncHazards(items: readonly HazardZoneEntity[]): void {
    const alive = new Set<number>();
    for (const h of items) {
      alive.add(h.id);
      let g = this.hazardMeshes.get(h.id);
      if (!g) {
        g = new THREE.Group();
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(24, h.radius), 3.2, true, 1.2),
            createNeonRibbonMaterial(h.colorHex, 1.2, 0.9)
          )
        );
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(24, h.radius), 2.6, true, 1.6),
            createNeonRibbonMaterial(0xff1e2d, 1.2, 0.85)
          )
        );
        g.position.set(h.x, h.y, 0);
        this.hazardMeshes.set(h.id, g);
        this.scene.add(g);
      }
      const fill = Math.max(0.02, 1 - Math.max(0, h.timer / Math.max(0.1, h.maxTimer)));
      g.children[1]!.scale.set(fill, fill, 1);
    }
    this.pruneMap(this.hazardMeshes, alive);
  }

  private syncGate(gate: SectorGate, timeSec: number): void {
    if (!this.gateGroup || this.gateLastOpen !== gate.open) {
      if (this.gateGroup) {
        this.scene.remove(this.gateGroup);
        this.disposeObject(this.gateGroup);
      }
      this.gateLastOpen = gate.open;
      const g = new THREE.Group();
      const color = gate.open ? 0x39ff14 : 0x334466;
      const archPts = [
        { x: 0, y: -gate.radius },
        { x: -26, y: -gate.radius * 0.65 },
        { x: -26, y: gate.radius * 0.65 },
        { x: 0, y: gate.radius },
      ];
      g.add(
        new THREE.Mesh(
          buildRibbonGeometry(archPts, 4.0, false, 6),
          createNeonRibbonMaterial(color, gate.open ? 1.25 : 0.85, gate.open ? 0.95 : 0.45)
        )
      );
      if (gate.open) {
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(24, gate.radius * 0.52), 3.2, true, 8),
            createNeonRibbonMaterial(0x00f5ff, 1.2, 0.9)
          )
        );
        g.add(createGlowSprite(0x39ff14, gate.radius * 2.0, 0.22));
      }
      g.position.set(gate.x, gate.y, 0);
      this.gateGroup = g;
      this.scene.add(g);
    }
    if (this.gateGroup && gate.open && this.gateGroup.children[1]) {
      const pulse = 0.85 + Math.sin(timeSec * 6) * 0.2;
      this.gateGroup.children[1].scale.set(pulse, pulse, 1);
    }
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Sprite) {
        child.material.dispose();
        return;
      }
      if (
        child instanceof THREE.Line ||
        child instanceof THREE.LineLoop ||
        child instanceof THREE.LineSegments ||
        child instanceof THREE.Mesh
      ) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
  }

  private pruneMap<T extends THREE.Object3D>(map: Map<number, T>, alive: Set<number>): void {
    for (const [id, obj] of map.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(obj);
        this.disposeObject(obj);
        map.delete(id);
      }
    }
  }
}

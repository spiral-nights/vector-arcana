import * as THREE from 'three';
import { createGlowSprite } from './GlowUtil';
import {
  buildRibbonGeometry,
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
  ArenaPillar,
  BeamEntity,
  ELEMENT_META,
  HazardZoneEntity,
  MineEntity,
  PoolEntity,
  ProjectileEntity,
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
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.28)');
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

const SECTOR_PILLAR_COLORS = [0x1a6bff, 0xff5522, 0x00e5ff, 0x39ff88, 0xb429ff] as const;

export class SpellVFX {
  private readonly scene: THREE.Scene;
  private readonly orbTexture: THREE.CanvasTexture;
  private readonly starTexture: THREE.CanvasTexture;
  private currentThemeIdx = 0;

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
  private readonly riftMeshes = new Map<number, THREE.Group>();
  private readonly hazardMeshes = new Map<number, THREE.Group>();
  private gateGroup: THREE.Group | null = null;
  private gateLastOpen = false;

  private sprayConeMesh: THREE.Mesh | null = null;
  private sprayConeKey = '';

  private readonly transientObjs: TransientObject[] = [];
  private readonly waveArcs: TransientWaveArc[] = [];
  private readonly shards: GeometricShard[] = [];
  private readonly maxShards = 260;
  private readonly stormStrikes: StormStrikeAnim[] = [];

  private readonly particles: Particle[] = [];
  private readonly maxParticles = 1200;
  private readonly particlePositions: Float32Array;
  private readonly particleColors: Float32Array;
  private readonly particleGeometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.orbTexture = createSoftOrbTexture();
    this.starTexture = createStarSparkTexture();

    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));

    const mat = new THREE.PointsMaterial({
      size: 7.5,
      map: this.orbTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(this.particleGeometry, mat);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  public spawnThruster(x: number, y: number, angle: number, colorHex: number): void {
    const base = new THREE.Color(colorHex);
    const ember = new THREE.Color(0xff7722);
    for (let i = 0; i < 3; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const backA = angle + Math.PI + (Math.random() - 0.5) * 0.65;
      const spd = 85 + Math.random() * 125;
      const maxLife = 0.16 + Math.random() * 0.16;
      const col = base.clone().lerp(ember, Math.random() * 0.6).multiplyScalar(0.95);
      this.particles.push({
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
    weightedColors: number[]
  ): void {
    const palette = weightedColors.length > 0 ? weightedColors : [0xf59e0b];
    for (let k = 0; k < 4; k++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const dist = Math.random() * len;
      const lat = (Math.random() - 0.5) * width * 0.95;
      const cHex = palette[Math.floor(Math.random() * palette.length)]!;
      const color = new THREE.Color(cHex).lerp(new THREE.Color(0xffffff), Math.random() * 0.3).multiplyScalar(0.95);
      const spd = 460 + Math.random() * 320;
      const flutter = (Math.random() - 0.5) * 75;
      const maxLife = 0.18 + Math.random() * 0.18;
      this.particles.push({
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
  }

  public spawnBurst(x: number, y: number, colorHex: number, count: number, speedScale = 1): void {
    const base = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const spd = (80 + Math.random() * 250) * speedScale;
      const maxLife = 0.24 + Math.random() * 0.3;
      const col = base.clone().multiplyScalar(0.85 + Math.random() * 0.2);
      this.particles.push({
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
    const palette = colors.length > 0 ? colors : [0xe8741a];
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

    // Tall vertical glowing plasma column descending from overhead storm cloud (z=125 -> 0)
    const beamGeo = new THREE.PlaneGeometry(18, 128);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 64);
    const beam = new THREE.Mesh(
      beamGeo,
      createNeonRibbonMaterial(secondaryColorHex, 1.3, 0.92)
    );
    group.add(beam);

    // Glowing meteor orb plunging down
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
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const cHex = palette[i % palette.length]!;
      const color = new THREE.Color(cHex).multiplyScalar(0.95);
      const a = isNova ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const spd = range * (1.8 + Math.random() * 1.55);
      const maxLife = 0.26 + Math.random() * 0.22;
      this.particles.push({
        x,
        y,
        z: 10 + Math.random() * 8,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: (Math.random() - 0.5) * 30,
        life: maxLife,
        maxLife,
        color,
      });
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
    this.syncBeams(snapshot.beams, timeSec);
    this.syncWalls(snapshot.walls, timeSec);
    this.syncMines(snapshot.mines, timeSec);
    this.syncStorms(snapshot.storms, timeSec);
    this.syncShields(snapshot.shields, timeSec);
    this.syncPools(snapshot.pools, timeSec);
    this.syncSlashes(snapshot.slashes);
    this.syncPillars(snapshot.pillars);
    this.syncRifts(snapshot.rifts, timeSec);
    this.syncHazards(snapshot.hazards);
    this.syncGate(snapshot.gate, timeSec);

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

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(1, p.z + p.vz * dt);
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.vz *= 0.92;
    }

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (p) {
        const fade = p.life / p.maxLife;
        this.particlePositions[i * 3] = p.x;
        this.particlePositions[i * 3 + 1] = p.y;
        this.particlePositions[i * 3 + 2] = p.z;
        this.particleColors[i * 3] = p.color.r * fade;
        this.particleColors[i * 3 + 1] = p.color.g * fade;
        this.particleColors[i * 3 + 2] = p.color.b * fade;
      } else {
        this.particlePositions[i * 3] = 0;
        this.particlePositions[i * 3 + 1] = 0;
        this.particlePositions[i * 3 + 2] = -9999;
      }
    }
    (this.particleGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
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
          const s = p.radius * 1.1;
          const rockGeo = new THREE.DodecahedronGeometry(s, 0);
          const wire = new THREE.WireframeGeometry(rockGeo);
          const secondary = p.colors.find((c) => c !== p.colorHex) ?? 0xff9e44;

          // Dark mineral solid core + fiery/elemental ridge glow
          g.add(
            new THREE.Mesh(
              rockGeo,
              new THREE.MeshBasicMaterial({
                color: new THREE.Color(p.colorHex).multiplyScalar(0.28),
                transparent: true,
                opacity: 0.85,
              })
            )
          );
          g.add(
            new THREE.LineSegments(
              wire,
              new THREE.LineBasicMaterial({ color: new THREE.Color(p.colorHex).multiplyScalar(1.2) })
            )
          );
          g.add(createGlowSprite(secondary, s * 2.6, 0.26));
        } else {
          // Crystal Shard Blade blending CRYSTAL cyan + any mixed element color cleanly
          const mixedColor =
            p.colors.find((c) => c !== ELEMENT_META.CRYSTAL.colorHex && c !== 0x80ffff) ??
            p.colorHex;
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
          g.add(new THREE.Mesh(bladeGeo, createCrystalBladeMaterial(0x80ffff, mixedColor)));

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
          g.add(createGlowSprite(mixedColor, r * 2.6, 0.24));
        }
        this.projMeshes.set(p.id, g);
        this.scene.add(g);
      }
      g.position.set(p.x, p.y, p.kind === 'ROCK' ? 14 : 0);
      if (p.kind === 'ROCK') {
        g.rotation.x = p.spin;
        g.rotation.y = p.spin * 0.7;
      } else {
        g.rotation.z = Math.atan2(p.vy, p.vx);
        const blade = g.children[0];
        if (blade instanceof THREE.Mesh) {
          setShaderUniform(blade.material, 'uTime', timeSec);
        }
      }
    }
    this.pruneMap(this.projMeshes, alive);
  }

  private syncBeams(items: readonly BeamEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const b of items) {
      alive.add(b.id);
      let group = this.beamMeshes.get(b.id);
      const len = Math.max(8, b.clashing ? b.clashDist : b.length);
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const nx = -sin;
      const ny = cos;

      const isVoid = b.elements.includes('VOID');
      let cA = b.colors[0] ?? b.colorHex;
      let cB = b.colors[1] ?? b.composition.secondaryColorHex;
      let cC = b.colors[2] ?? cB;

      // Pure Nano -> golden amber / emerald silk weave matching bream.svg; pure Void -> dark violet/crimson
      if (!isVoid && b.colors.length === 1 && b.elements.includes('NANO')) {
        cA = 0xf59e0b;
        cB = 0xfef08a;
        cC = 0x39ff14;
      } else if (isVoid && b.colors.length === 1) {
        cA = 0x7a12ff;
        cB = 0xff2e97;
        cC = 0x4c0678;
      }

      if (!group) {
        group = new THREE.Group();
        const stripW = Math.max(54, b.width * 2.9);

        // 0: Volumetric silk-braided energy beam
        const beamPlane = new THREE.PlaneGeometry(1, stripW);
        beamPlane.translate(0.5, 0, 0);
        const beamMat = createBraidedBeamMaterial(cA, cB, cC, isVoid);
        group.add(new THREE.Mesh(beamPlane, beamMat));

        // 1: End impact crystal / flare
        const impactDiamond = [
          { x: 14, y: 0 },
          { x: 0, y: 9 },
          { x: -9, y: 0 },
          { x: 0, y: -9 },
        ];
        group.add(
          new THREE.Mesh(
            buildRibbonGeometry(impactDiamond, 2.4, true, 14.5),
            createNeonRibbonMaterial(cB, 1.25, 0.9)
          )
        );

        // 2: End impact sprite halo
        group.add(createGlowSprite(cB, 32, 0.24));

        // 3..10: Twinkling 4-point star-sparks riding along the beam (images/bream.svg)
        const sparkContainer = new THREE.Group();
        for (let s = 0; s < 8; s++) {
          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: this.starTexture,
              color: s % 2 === 0 ? cB : 0xffffff,
              transparent: true,
              opacity: 0.85,
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

      const beamMesh = group.children[0] as THREE.Mesh;
      beamMesh.position.set(b.x, b.y, 14);
      beamMesh.rotation.z = b.angle;
      beamMesh.scale.set(len, 1, 1);
      setShaderUniform(beamMesh.material, 'uTime', timeSec);
      setShaderUniform(beamMesh.material, 'uLength', len / 24);
      setShaderUniform(beamMesh.material, 'uFade', Math.min(1, (b.life / Math.max(0.05, b.maxLife)) * 2.5));

      const impactMesh = group.children[1] as THREE.Mesh;
      impactMesh.position.set(b.x + cos * len, b.y + sin * len, 0);
      impactMesh.rotation.z = timeSec * 10 + b.id;

      group.children[2]!.position.set(b.x + cos * len, b.y + sin * len, 14);

      const sparks = group.children[3] as THREE.Group;
      for (let s = 0; s < sparks.children.length; s++) {
        const sp = sparks.children[s] as THREE.Sprite;
        const frac = (s / sparks.children.length + timeSec * 0.85) % 1;
        const along = frac * len;
        const lat = Math.sin(along * 0.04 - timeSec * 10 + s * 1.9) * (b.width * 0.45);
        sp.position.set(b.x + cos * along + nx * lat, b.y + sin * along + ny * lat, 15.5);
        sp.material.opacity = Math.sin(frac * Math.PI) * 0.85;
      }

      this.spawnBeamFlowParticle(b.x, b.y, cos, sin, nx, ny, len, b.width, b.composition.weightedColors);
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
      const payloadColors = w.colors.filter((c) => c !== 0xe6f0ff);
      const p1 = payloadColors[0] ?? w.colorHex;
      const p2 = payloadColors[1] ?? p1;

      if (!g) {
        g = new THREE.Group();
        // Sleek vertical emitter pylon spire (clearly secondary to the tall forcefield barrier)
        const cyl = new THREE.CylinderGeometry(7, 10, 56, 6, 1);
        cyl.rotateX(Math.PI / 2);
        const wire = new THREE.WireframeGeometry(cyl);
        g.add(
          new THREE.LineSegments(
            wire,
            new THREE.LineBasicMaterial({ color: new THREE.Color(p1).multiplyScalar(1.15) })
          )
        );
        g.add(
          new THREE.Mesh(
            cyl,
            new THREE.MeshBasicMaterial({
              color: p1,
              transparent: true,
              opacity: 0.25,
              blending: THREE.AdditiveBlending,
            })
          )
        );
        const cap = createGlowSprite(p2, 26, 0.25);
        cap.position.z = 28;
        g.add(cap);
        g.position.set(w.x, w.y, 28);
        this.wallMeshes.set(w.id, g);
        this.scene.add(g);
      }
    }

    // Build continuous vertical 3D Forcefield Wall Panels between adjacent pylons in each group
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
      const payloadColors = a.colors.filter((c) => c !== 0xe6f0ff);
      const p1 = payloadColors[0] ?? a.colorHex;
      const p2 = payloadColors[1] ?? p1;

      if (!panelGroup) {
        panelGroup = new THREE.Group();
        const panelGeo = new THREE.PlaneGeometry(dist, 54);
        panelGeo.rotateX(Math.PI / 2);
        const wallMesh = new THREE.Mesh(panelGeo, createForcefieldWallMaterial(p1, p2));
        wallMesh.position.z = 27;
        panelGroup.add(wallMesh);

        // Glowing ground base rail + top containment rail
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
        const payloadColors = m.colors.filter((c) => c !== 0xe6f0ff);
        const p1 = payloadColors[0] ?? m.colorHex;
        const p2 = payloadColors[1] ?? p1;

        // 0: Hovering luminous energy sphere pod
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(m.radius * 0.5, 12, 10),
          new THREE.MeshBasicMaterial({ color: p1 })
        );
        sphere.position.set(0, 0, 14);
        g.add(sphere);

        // 1: Rotating containment ring
        const ring = new THREE.Mesh(
          buildRibbonGeometry(createPolygonPoints(16, m.radius * 0.9), 2.4, true, 0),
          createNeonRibbonMaterial(p2, 1.2, 0.92)
        );
        ring.position.set(0, 0, 14);
        g.add(ring);

        // 2: Pulsing core halo
        const glow = createGlowSprite(p1, 28, 0.26);
        glow.position.set(0, 0, 14);
        g.add(glow);

        // 3: Ground proximity trigger ring
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
      g.children[1]!.rotation.x = 0.65;
      g.children[1]!.rotation.z = timeSec * 3.4 + m.id;
      const pulse = 0.85 + Math.sin(timeSec * 9 + m.id) * 0.18;
      g.children[2]!.scale.set(28 * pulse, 28 * pulse, 1);
    }
    this.pruneMap(this.mineMeshes, alive);
  }

  private syncStorms(items: readonly StormEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const s of items) {
      alive.add(s.id);
      let g = this.stormMeshes.get(s.id);
      if (!g) {
        g = new THREE.Group();
        const barrierColor = s.colors.includes(0xe6f0ff) ? 0xe6f0ff : s.colorHex;
        const payloadColors = s.colors.filter((c) => c !== 0xe6f0ff);
        const payloadColor = payloadColors[0] ?? s.colorHex;
        const secondaryPayload = payloadColors[1] ?? payloadColor;

        // 0: Ground impact zone vortex rune
        const vortexMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(s.radius * 2.05, s.radius * 2.05),
          createStormVortexMaterial(barrierColor, payloadColor, secondaryPayload)
        );
        vortexMesh.position.z = 1.2;
        g.add(vortexMesh);

        // 1: Overhead billowing 3D Storm Cloud disk floating at z=120
        const cloudMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(s.radius * 2.25, s.radius * 2.25),
          createStormCloudMaterial(payloadColor, secondaryPayload)
        );
        cloudMesh.position.z = 120;
        g.add(cloudMesh);

        // 2: Outer ground boundary ribbon
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(32, s.radius), 2.6, true, 1.5),
            createNeonRibbonMaterial(payloadColor, 1.1, 0.72)
          )
        );

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
      setShaderUniform((g.children[2] as THREE.Mesh).material, 'uOpacity', fade * 0.72);
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
          // 0: 360-degree Hex-Mesh Fresnel Dome elevated slightly in 3D
          const dome = new THREE.Mesh(
            new THREE.PlaneGeometry(s.radius * 2.15, s.radius * 2.15),
            createHexDomeMaterial(s.colorHex, secondary)
          );
          dome.position.z = 14;
          g.add(dome);

          // 1: Crisp outer rim ribbon
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(createPolygonPoints(36, s.radius), 3.2, true, 14),
              createNeonRibbonMaterial(s.colorHex, 1.2, 0.9)
            )
          );
        } else {
          // 0: Vertical Standing 3D Curved Shield Wall (z = 2..48)
          const wallGeo = createStandingCurvedWallGeometry(s.radius, -s.arc, s.arc, 46, 28, 2);
          g.add(new THREE.Mesh(wallGeo, createCurvedBarrierMaterial(s.colorHex, secondary)));

          // 1: Triangulated 3D wireframe geodesic front
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

          // 2: 3 dashed tether lines from ship center to shield crescent back
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

          // 3: Top crisp curved edge ribbon
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
        const secondary = p.kind === 'PLASMA' ? 0xff9944 : 0x00f5ff;
        const poolDisk = new THREE.Mesh(
          new THREE.PlaneGeometry(p.radius * 2.15, p.radius * 2.15),
          createLiquidPoolMaterial(p.colorHex, secondary, p.id * 1.37)
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
        const wire = new THREE.WireframeGeometry(cyl);
        g.add(
          new THREE.LineSegments(
            wire,
            new THREE.LineBasicMaterial({ color: new THREE.Color(colHex).multiplyScalar(1.1), transparent: true, opacity: 0.85 })
          )
        );
        g.add(
          new THREE.Mesh(
            cyl,
            new THREE.MeshBasicMaterial({
              color: colHex,
              transparent: true,
              opacity: 0.14,
              blending: THREE.AdditiveBlending,
            })
          )
        );
        // Base & top illuminated neon rings
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(p.sides, p.radius * 1.04), 3.0, true, -h * 0.5 + 1),
            createNeonRibbonMaterial(colHex, 1.15, 0.82)
          ),
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(p.sides, p.radius * 0.94), 2.6, true, h * 0.5),
            createNeonRibbonMaterial(colHex, 1.15, 0.85)
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

import * as THREE from 'three';
import { createGlowSprite } from './GlowUtil';
import {
  buildRibbonGeometry,
  createBraidedBeamMaterial,
  createCrystalBladeMaterial,
  createCurvedBarrierMaterial,
  createHexDomeMaterial,
  createNeonRibbonMaterial,
  createSlashMaterial,
  createSprayConeMaterial,
  createStormVortexMaterial,
  createWallPanelMaterial,
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
  vx: number;
  vy: number;
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
  meteor: THREE.Object3D;
  beam: THREE.Mesh;
  life: number;
  maxLife: number;
  x: number;
  y: number;
  colorHex: number;
  secondaryColorHex: number;
}

function createSparkTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.28, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
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

function createCurvedStripGeometry(innerR: number, outerR: number, startA: number, endA: number, segs = 28, z = 2.0): THREE.BufferGeometry {
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
    positions[pBase + 2] = z - 2;

    positions[pBase + 3] = cos * outerR;
    positions[pBase + 4] = sin * outerR;
    positions[pBase + 5] = z + 2;

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

export class SpellVFX {
  private readonly scene: THREE.Scene;
  private readonly projMeshes = new Map<number, THREE.Group>();
  private readonly beamMeshes = new Map<number, THREE.Group>();
  private readonly wallMeshes = new Map<number, THREE.Group>();
  private readonly wallPanels = new Map<string, THREE.Mesh>();
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
  private readonly maxShards = 340;
  private readonly stormStrikes: StormStrikeAnim[] = [];

  private readonly particles: Particle[] = [];
  private readonly maxParticles = 1200;
  private readonly particlePositions: Float32Array;
  private readonly particleColors: Float32Array;
  private readonly particleGeometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));

    const mat = new THREE.PointsMaterial({
      size: 10,
      map: createSparkTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
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
      const col = base.clone().lerp(ember, Math.random() * 0.6).multiplyScalar(1.65);
      this.particles.push({
        x: x - Math.cos(angle) * 16 + (Math.random() - 0.5) * 6,
        y: y - Math.sin(angle) * 16 + (Math.random() - 0.5) * 6,
        vx: Math.cos(backA) * spd,
        vy: Math.sin(backA) * spd,
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
    const palette = weightedColors.length > 0 ? weightedColors : [0xb429ff];
    for (let k = 0; k < 5; k++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const dist = Math.random() * len;
      const lat = (Math.random() - 0.5) * width * 1.15;
      const cHex = palette[Math.floor(Math.random() * palette.length)]!;
      const color = new THREE.Color(cHex).multiplyScalar(1.65);
      const spd = 480 + Math.random() * 340;
      const flutter = (Math.random() - 0.5) * 85;
      const maxLife = 0.2 + Math.random() * 0.2;
      this.particles.push({
        x: bx + cos * dist + nx * lat,
        y: by + sin * dist + ny * lat,
        vx: cos * spd + nx * flutter,
        vy: sin * spd + ny * flutter,
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
      const maxLife = 0.25 + Math.random() * 0.32;
      const col = base.clone().multiplyScalar(1.35 + Math.random() * 0.65);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
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
      const shapeRoll = i % 3;
      const s = 3.5 + Math.random() * 5.2;

      let pts: Array<{ x: number; y: number }>;
      if (shapeRoll === 0) {
        // Sharp forward spearhead triangle (reference JPEG shard style)
        pts = [
          { x: s * 1.45, y: 0 },
          { x: -s * 0.85, y: s * 0.78 },
          { x: -s * 0.85, y: -s * 0.78 },
        ];
      } else if (shapeRoll === 1) {
        // Elongated diamond
        pts = [
          { x: s * 1.4, y: 0 },
          { x: 0, y: s * 0.65 },
          { x: -s * 1.1, y: 0 },
          { x: 0, y: -s * 0.65 },
        ];
      } else {
        // Tumbling square frame
        pts = [
          { x: -s * 0.8, y: -s * 0.8 },
          { x: s * 0.8, y: -s * 0.8 },
          { x: s * 0.8, y: s * 0.8 },
          { x: -s * 0.8, y: s * 0.8 },
        ];
      }

      const geo = buildRibbonGeometry(pts, 1.85, true, 3.3);
      const mat = createNeonRibbonMaterial(cHex, 2.2, 0.95);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0);
      const a = dirAngle !== undefined ? dirAngle + (Math.random() - 0.5) * 0.95 : Math.random() * Math.PI * 2;
      mesh.rotation.z = a;
      this.scene.add(mesh);

      const spd = (120 + Math.random() * 260) * speedScale;
      const maxLife = 0.28 + Math.random() * 0.3;
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
      buildRibbonGeometry(pts, 4.2, true, 2.6),
      createNeonRibbonMaterial(colorHex, 2.35, 1.0)
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
    radius: number
  ): void {
    const group = new THREE.Group();
    group.position.set(x, y, 0);

    // Vertical HDR strike column in XZ plane
    const beamGeo = new THREE.PlaneGeometry(10, 190);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 95);
    const beam = new THREE.Mesh(
      beamGeo,
      createNeonRibbonMaterial(secondaryColorHex, 2.4, 0.85)
    );
    group.add(beam);

    const oct = new THREE.OctahedronGeometry(Math.max(12, radius * 0.28), 0);
    const edges = new THREE.EdgesGeometry(oct);
    oct.dispose();
    const meteor = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: colorHex })
    );
    meteor.position.set(0, 0, 185);
    group.add(meteor);

    this.scene.add(group);
    this.stormStrikes.push({
      group,
      meteor,
      beam,
      life: 0.22,
      maxLife: 0.22,
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
      const color = new THREE.Color(cHex).multiplyScalar(1.55);
      const a = isNova ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const spd = range * (1.8 + Math.random() * 1.55);
      const maxLife = 0.26 + Math.random() * 0.22;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: maxLife,
        maxLife,
        color,
      });
    }

    // Thick HDR neon curved crescent wave arcs (images/flux.svg style)
    const arcCount = isNova ? 5 : 2;
    for (let i = 0; i < arcCount; i++) {
      const a = isNova ? angle + (i / arcCount) * Math.PI * 2 : angle + (i - 0.5) * 0.08;
      const arcSpan = isNova ? Math.PI * 0.58 : spread * (i === 0 ? 0.88 : 0.65);
      const cHex = palette[i % palette.length]!;
      const layerR = i === 0 ? 28 : 20;
      const pts = createArcPoints(-arcSpan * 0.5, arcSpan * 0.5, layerR, 16);
      const mesh = new THREE.Mesh(
        buildRibbonGeometry(pts, i === 0 ? 3.8 : 2.6, false, 2.6),
        createNeonRibbonMaterial(cHex, 2.2, i === 0 ? 0.95 : 0.72)
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
    // Primary glowing HDR outer bolt
    group.add(
      new THREE.Mesh(
        buildRibbonGeometry(jagged, 7.2, false, 3.8),
        createNeonRibbonMaterial(palette[0]!, 2.45, 0.95)
      )
    );
    // White-hot crisp inner arc
    group.add(
      new THREE.Mesh(
        buildRibbonGeometry(jagged, 2.5, false, 4.1),
        createNeonRibbonMaterial(0xffffff, 2.9, 1.0)
      )
    );

    if (palette.length > 1) {
      const offsetPts = jagged.map((p) => ({
        x: p.x + (Math.random() - 0.5) * 14,
        y: p.y + (Math.random() - 0.5) * 14,
      }));
      group.add(
        new THREE.Mesh(
          buildRibbonGeometry(offsetPts, 4.4, false, 3.5),
          createNeonRibbonMaterial(palette[1]!, 2.2, 0.85)
        )
      );
    }

    this.scene.add(group);
    this.transientObjs.push({ obj: group, life: 0.16, maxLife: 0.16 });
  }

  public update(snapshot: SimSnapshot, dt: number, timeSec: number): void {
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
      st.meteor.position.z = t * 185;
      st.meteor.rotation.z += dt * 14;
      st.meteor.rotation.x += dt * 9;
      setShaderUniform(st.beam.material, 'uOpacity', 0.45 + (1 - t) * 0.55);
      if (st.life <= 0) {
        this.spawnBurst(st.x, st.y, st.colorHex, 20, 1.25);
        this.spawnShards(st.x, st.y, [st.colorHex, st.secondaryColorHex], 8, 1.0);
        this.spawnRing(st.x, st.y, 44, st.colorHex, 0.26);
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

    // Update transient HDR ribbons / rings / lightning
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
      p.vx *= 0.94;
      p.vy *= 0.94;
    }

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (p) {
        const fade = p.life / p.maxLife;
        this.particlePositions[i * 3] = p.x;
        this.particlePositions[i * 3 + 1] = p.y;
        this.particlePositions[i * 3 + 2] = 3.1;
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
    const range = 250;
    const key = `${comp.primaryColorHex}-${comp.secondaryColorHex}`;
    if (!this.sprayConeMesh || this.sprayConeKey !== key) {
      if (this.sprayConeMesh) {
        this.scene.remove(this.sprayConeMesh);
        this.disposeObject(this.sprayConeMesh);
      }
      const geo = new THREE.PlaneGeometry(range, range * 2);
      geo.translate(range * 0.5, 0, 2.3);
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
    setShaderUniform(this.sprayConeMesh.material as THREE.Material, 'uTime', timeSec);
    setShaderUniform(this.sprayConeMesh.material as THREE.Material, 'uOpacity', Math.min(1, ch.remaining * 2.5));
  }

  private syncProjectiles(items: readonly ProjectileEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const p of items) {
      alive.add(p.id);
      let g = this.projMeshes.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const secondary = p.colors.find((c) => c !== p.colorHex) ?? 0xffffff;
        if (p.kind === 'ROCK') {
          const s = p.radius * 1.5;
          const box = new THREE.BoxGeometry(s, s, s, 2, 2, 2);
          const wire = new THREE.WireframeGeometry(box);
          // Subdivided HDR glowing wire cube (matching Gemini_Generated_Image(3).jpeg)
          const colBright = new THREE.Color(p.colorHex).multiplyScalar(1.85);
          g.add(new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color: colBright })));
          g.add(
            new THREE.Mesh(
              box,
              new THREE.MeshBasicMaterial({
                color: p.colorHex,
                transparent: true,
                opacity: 0.28,
                blending: THREE.AdditiveBlending,
              })
            )
          );
          g.add(createGlowSprite(p.colorHex, s * 2.8, 0.48));
          if (secondary !== p.colorHex) {
            const oct = new THREE.OctahedronGeometry(p.radius * 0.72, 0);
            const octWire = new THREE.WireframeGeometry(oct);
            oct.dispose();
            g.add(
              new THREE.LineSegments(
                octWire,
                new THREE.LineBasicMaterial({ color: new THREE.Color(secondary).multiplyScalar(1.6) })
              )
            );
          }
        } else {
          // Crystal Shard Blade + tapered contrail (images/crystal-shards.svg)
          const r = p.radius;
          const tip = r * 2.6;
          const back = -r * 1.1;
          const w = r * 0.62;
          const bladeGeo = new THREE.BufferGeometry();
          bladeGeo.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(
              [
                tip, 0, 2.8,
                -r * 0.15, w, 2.8,
                back, 0, 2.8,
                -r * 0.15, -w, 2.8,
              ],
              3
            )
          );
          bladeGeo.setAttribute(
            'uv',
            new THREE.Float32BufferAttribute([1, 0.5, 0.45, 1, 0, 0.5, 0.45, 0], 2)
          );
          bladeGeo.setIndex([0, 1, 2, 0, 2, 3]);
          const bladeMat = createCrystalBladeMaterial(p.colorHex, secondary);
          g.add(new THREE.Mesh(bladeGeo, bladeMat));

          // Crisp HDR edge ribbon + tapered contrail wake
          const edgePts = [
            { x: tip, y: 0 },
            { x: -r * 0.15, y: w },
            { x: back, y: 0 },
            { x: -r * 0.15, y: -w },
          ];
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(edgePts, 2.2, true, 3.0),
              createNeonRibbonMaterial(0xffffff, 2.2, 0.88)
            )
          );
          const contrail = [
            { x: back * 0.8, y: 0 },
            { x: -r * 4.5, y: 0 },
          ];
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(contrail, r * 0.42, false, 2.4),
              createNeonRibbonMaterial(p.colorHex, 1.9, 0.65)
            )
          );
          g.add(createGlowSprite(p.colorHex, r * 3.0, 0.42));
        }
        this.projMeshes.set(p.id, g);
        this.scene.add(g);
      }
      g.position.set(p.x, p.y, 2);
      if (p.kind === 'ROCK') {
        g.rotation.x = p.spin;
        g.rotation.y = p.spin * 0.7;
        if (g.children[3]) {
          g.children[3].rotation.z = -p.spin * 1.5;
        }
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

      const cA = b.colors[0] ?? b.colorHex;
      const cB = b.colors[1] ?? (b.composition.secondaryColorHex || cA);
      const cC = b.colors[2] ?? cB;

      if (!group) {
        group = new THREE.Group();
        const stripW = Math.max(36, b.width * 2.2);
        // 0: Volumetric HDR braided plasma strip
        const beamPlane = new THREE.PlaneGeometry(1, stripW);
        beamPlane.translate(0.5, 0, 0);
        const beamMat = createBraidedBeamMaterial(cA, cB, cC);
        const beamMesh = new THREE.Mesh(beamPlane, beamMat);
        group.add(beamMesh);

        // 1: Crisp HDR inner spine filament
        const corePlane = new THREE.PlaneGeometry(1, Math.max(5, b.width * 0.35));
        corePlane.translate(0.5, 0, 0);
        group.add(new THREE.Mesh(corePlane, createNeonRibbonMaterial(cA, 2.6, 0.85)));

        // 2: End impact shard crystal (no muzzle white blob)
        const impactDiamond = [
          { x: 14, y: 0 },
          { x: 0, y: 10 },
          { x: -10, y: 0 },
          { x: 0, y: -10 },
        ];
        const impactMesh = new THREE.Mesh(
          buildRibbonGeometry(impactDiamond, 2.8, true, 3.6),
          createNeonRibbonMaterial(cB, 2.6, 0.92)
        );
        group.add(impactMesh);

        // 3: Subtle end impact halo
        group.add(createGlowSprite(cB, 38, 0.45));

        this.beamMeshes.set(b.id, group);
        this.scene.add(group);
      }

      const beamMesh = group.children[0] as THREE.Mesh;
      beamMesh.position.set(b.x, b.y, 2.9);
      beamMesh.rotation.z = b.angle;
      beamMesh.scale.set(len, 1, 1);
      setShaderUniform(beamMesh.material, 'uTime', timeSec);
      setShaderUniform(beamMesh.material, 'uLength', len / 22);
      setShaderUniform(beamMesh.material, 'uFade', Math.min(1, (b.life / Math.max(0.05, b.maxLife)) * 2.5));

      const spineMesh = group.children[1] as THREE.Mesh;
      spineMesh.position.set(b.x, b.y, 3.2);
      spineMesh.rotation.z = b.angle;
      spineMesh.scale.set(len, 1, 1);

      const impactMesh = group.children[2] as THREE.Mesh;
      impactMesh.position.set(b.x + cos * len, b.y + sin * len, 0);
      impactMesh.rotation.z = timeSec * 11 + b.id;

      group.children[3]!.position.set(b.x + cos * len, b.y + sin * len, 3.1);

      // Stream dense glowing plasma sparks & directional geometric shards along full beam length
      this.spawnBeamFlowParticle(b.x, b.y, cos, sin, nx, ny, len, b.width, b.composition.weightedColors);
      if (Math.random() < 0.72) {
        const d = Math.random() * len;
        this.spawnShards(
          b.x + cos * d + nx * (Math.random() - 0.5) * b.width * 0.7,
          b.y + sin * d + ny * (Math.random() - 0.5) * b.width * 0.7,
          b.colors,
          1,
          0.9,
          b.angle
        );
      }
    }
    this.pruneMap(this.beamMeshes, alive);
  }

  private syncWalls(items: readonly WallPylonEntity[], timeSec: number): void {
    const alive = new Set<number>();
    const activePanelKeys = new Set<string>();

    for (let idx = 0; idx < items.length; idx++) {
      const w = items[idx]!;
      alive.add(w.id);
      let g = this.wallMeshes.get(w.id);
      const barrierColor = w.colors.includes(0xe6f0ff) ? 0xe6f0ff : w.colorHex;
      const payloadColors = w.colors.filter((c) => c !== 0xe6f0ff);
      const p1 = payloadColors[0] ?? w.colorHex;
      const p2 = payloadColors[1] ?? p1;

      if (!g) {
        g = new THREE.Group();
        const cyl = new THREE.CylinderGeometry(w.radius * 0.65, w.radius * 0.88, 46, 6, 1);
        cyl.rotateX(Math.PI / 2);
        const wire = new THREE.WireframeGeometry(cyl);
        g.add(
          new THREE.LineSegments(
            wire,
            new THREE.LineBasicMaterial({ color: new THREE.Color(barrierColor).multiplyScalar(1.6) })
          )
        );
        g.add(
          new THREE.Mesh(
            cyl,
            new THREE.MeshBasicMaterial({
              color: p1,
              transparent: true,
              opacity: 0.28,
              blending: THREE.AdditiveBlending,
            })
          )
        );
        // Base HDR neon ring around fortress obelisk
        const baseRing = new THREE.Mesh(
          buildRibbonGeometry(createPolygonPoints(6, w.radius * 1.05), 3.0, true, -20),
          createNeonRibbonMaterial(p2, 2.2, 0.9)
        );
        g.add(baseRing);
        g.add(createGlowSprite(p1, w.radius * 3.0, 0.45));
        g.position.set(w.x, w.y, 23);
        this.wallMeshes.set(w.id, g);
        this.scene.add(g);
      }

      if (idx > 0) {
        const prev = items[idx - 1]!;
        const dx = w.x - prev.x;
        const dy = w.y - prev.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1 && dist < 120) {
          const panelKey = `${prev.id}-${w.id}`;
          activePanelKeys.add(panelKey);
          let panel = this.wallPanels.get(panelKey);
          if (!panel) {
            const panelGeo = new THREE.PlaneGeometry(dist, 34);
            panelGeo.rotateX(Math.PI / 2);
            panel = new THREE.Mesh(panelGeo, createWallPanelMaterial(p1, p2));
            this.wallPanels.set(panelKey, panel);
            this.scene.add(panel);
          }
          panel.position.set((prev.x + w.x) * 0.5, (prev.y + w.y) * 0.5, 22);
          panel.rotation.z = Math.atan2(dy, dx);
          setShaderUniform(panel.material, 'uTime', timeSec);
          setShaderUniform(panel.material, 'uOpacity', Math.min(1, (w.life / Math.max(0.1, w.maxLife)) * 2.0));
        }
      }
    }

    for (const [k, mesh] of this.wallPanels.entries()) {
      if (!activePanelKeys.has(k)) {
        this.scene.remove(mesh);
        this.disposeObject(mesh);
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
        const barrierColor = m.colors.includes(0xe6f0ff) ? 0xe6f0ff : m.colorHex;
        const payloadColors = m.colors.filter((c) => c !== 0xe6f0ff);
        const p1 = payloadColors[0] ?? m.colorHex;
        const p2 = payloadColors[1] ?? p1;

        const ico = new THREE.IcosahedronGeometry(m.radius * 0.78, 0);
        const wire = new THREE.WireframeGeometry(ico);
        ico.dispose();
        const pod = new THREE.LineSegments(
          wire,
          new THREE.LineBasicMaterial({ color: new THREE.Color(barrierColor).multiplyScalar(1.7) })
        );
        pod.position.set(0, 0, 10);
        g.add(pod);

        // HDR spiked cross blades
        const spike1 = [
          { x: -m.radius * 0.95, y: 0 },
          { x: m.radius * 0.95, y: 0 },
        ];
        const spike2 = [
          { x: 0, y: -m.radius * 0.95 },
          { x: 0, y: m.radius * 0.95 },
        ];
        const crossGroup = new THREE.Group();
        crossGroup.add(
          new THREE.Mesh(buildRibbonGeometry(spike1, 3.0, false, 10), createNeonRibbonMaterial(p2, 2.3, 0.95)),
          new THREE.Mesh(buildRibbonGeometry(spike2, 3.0, false, 10), createNeonRibbonMaterial(p2, 2.3, 0.95))
        );
        g.add(crossGroup);

        const glow = createGlowSprite(p1, 30, 0.65);
        glow.position.set(0, 0, 10);
        g.add(glow);

        // Trigger proximity ring as glowing HDR ribbon
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(24, m.triggerRadius), 2.2, true, 0.9),
            createNeonRibbonMaterial(p1, 1.9, payloadColors.length >= 2 ? 0.7 : 0.45)
          )
        );

        g.position.set(m.x, m.y, 0);
        this.mineMeshes.set(m.id, g);
        this.scene.add(g);
      }
      g.children[0]!.rotation.x = timeSec * 2.2 + m.id;
      g.children[0]!.rotation.y = timeSec * 1.7;
      g.children[1]!.rotation.z = -timeSec * 3.8;
      const pulse = 0.85 + Math.sin(timeSec * 9 + m.id) * 0.2;
      g.children[2]!.scale.set(30 * pulse, 30 * pulse, 1);
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

        // 0: Volumetric swirling vortex disk
        const vortexMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(s.radius * 2.15, s.radius * 2.15),
          createStormVortexMaterial(barrierColor, payloadColor, secondaryPayload)
        );
        vortexMesh.position.z = 1.2;
        g.add(vortexMesh);

        // 1: Crisp HDR octagon ring
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(8, s.radius * 0.64), 3.2, true, 1.8),
            createNeonRibbonMaterial(payloadColor, 2.2, 0.9)
          )
        );

        g.position.set(s.x, s.y, 0);
        this.stormMeshes.set(s.id, g);
        this.scene.add(g);
      }
      const vortex = g.children[0] as THREE.Mesh;
      setShaderUniform(vortex.material, 'uTime', timeSec);
      setShaderUniform(vortex.material, 'uOpacity', Math.min(1, (s.life / Math.max(0.1, s.maxLife)) * 2.0));
      g.children[1]!.rotation.z = -timeSec * 2.3;
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
          // 360-degree Hex-Mesh Fresnel Dome (images/barrier-ciruclar.svg)
          const dome = new THREE.Mesh(
            new THREE.PlaneGeometry(s.radius * 2.15, s.radius * 2.15),
            createHexDomeMaterial(s.colorHex, secondary)
          );
          dome.position.z = 2.2;
          g.add(dome);

          // Crisp outer glowing rim ribbon
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(createPolygonPoints(36, s.radius), 3.4, true, 2.7),
              createNeonRibbonMaterial(s.colorHex, 2.3, 0.9)
            )
          );
        } else {
          // Forward Curved Geodesic Crescent Barrier + 3 Tether Lines (images/barrier.svg)
          const stripGeo = createCurvedStripGeometry(s.radius * 0.82, s.radius * 1.08, -s.arc, s.arc, 28, 2.4);
          g.add(new THREE.Mesh(stripGeo, createCurvedBarrierMaterial(s.colorHex, secondary)));

          // Triangulated 3D wireframe lattice along crescent
          const cols = 10;
          const rows = 2;
          const grid: THREE.Vector3[][] = [];
          for (let r = 0; r <= rows; r++) {
            const rowPts: THREE.Vector3[] = [];
            const z = (r / rows - 0.5) * 32;
            const radScale = 1 - Math.abs(r / rows - 0.5) * 0.14;
            for (let c = 0; c <= cols; c++) {
              const a = -s.arc + (c / cols) * (s.arc * 2);
              rowPts.push(new THREE.Vector3(Math.cos(a) * s.radius * radScale, Math.sin(a) * s.radius * radScale, z + 3));
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
                color: new THREE.Color(secondary).multiplyScalar(1.55),
                transparent: true,
                opacity: 0.85,
              })
            )
          );

          // 3 green/element dashed tether lines from ship to crescent back
          const tetherPts: THREE.Vector3[] = [];
          for (const frac of [-0.62, 0, 0.62]) {
            const ta = frac * s.arc;
            tetherPts.push(
              new THREE.Vector3(16, frac * 14, 2.0),
              new THREE.Vector3(Math.cos(ta) * s.radius * 0.84, Math.sin(ta) * s.radius * 0.84, 2.0)
            );
          }
          const tetherLine = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(tetherPts),
            new THREE.LineDashedMaterial({
              color: secondary,
              dashSize: 6,
              gapSize: 4,
              transparent: true,
              opacity: 0.78,
            })
          );
          tetherLine.computeLineDistances();
          g.add(tetherLine);

          // Outer crisp crescent edge ribbon
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(createArcPoints(-s.arc, s.arc, s.radius * 1.04, 24), 3.4, false, 3.2),
              createNeonRibbonMaterial(s.colorHex, 2.4, 0.95)
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
        const seed = p.id * 1.7;
        // 3 nested organically-wobbling HDR neon contour ribbons (images/flux.svg puddles)
        for (let ring = 0; ring < 3; ring++) {
          const baseR = p.radius * (1 - ring * 0.28);
          const pts: Array<{ x: number; y: number }> = [];
          for (let i = 0; i < 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const wobble = 1 + 0.14 * Math.sin(3 * a + seed + ring) + 0.08 * Math.cos(5 * a - seed);
            pts.push({ x: Math.cos(a) * baseR * wobble, y: Math.sin(a) * baseR * wobble });
          }
          g.add(
            new THREE.Mesh(
              buildRibbonGeometry(pts, ring === 0 ? 3.4 : 2.5, true, 0.6 + ring * 0.25),
              createNeonRibbonMaterial(p.colorHex, ring === 0 ? 2.15 : 1.75, 0.85 - ring * 0.15)
            )
          );
        }
        g.add(createGlowSprite(p.colorHex, p.radius * 2.1, 0.28));
        g.position.set(p.x, p.y, 0);
        this.poolMeshes.set(p.id, g);
        this.scene.add(g);
      }
      const breathe = 1 + Math.sin(timeSec * 3.5 + p.id) * 0.045;
      g.scale.set(breathe, breathe, 1);
      const fade = Math.min(1, (p.life / p.maxLife) * 1.4);
      for (let r = 0; r < 3; r++) {
        const child = g.children[r] as THREE.Mesh;
        setShaderUniform(child.material, 'uOpacity', (0.85 - r * 0.15) * fade);
      }
      (g.children[3] as THREE.Sprite).material.opacity = 0.28 * fade;
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
        // Curved HDR energy crescent blade
        const bladeGeo = createCurvedStripGeometry(s.radius * 0.56, s.radius * 1.05, -s.arc, s.arc, 24, 3.4);
        g.add(new THREE.Mesh(bladeGeo, createSlashMaterial(s.colorHex, secondary)));

        // Sharp outer HDR neon cutting arc
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createArcPoints(-s.arc, s.arc, s.radius, 20), 4.0, false, 3.8),
            createNeonRibbonMaterial(0xffffff, 2.5, 0.95)
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
    for (const p of items) {
      const key = `${p.id}:${p.x}:${p.y}:${p.radius}`;
      alive.add(key);
      if (!this.pillarMeshes.has(key)) {
        const g = new THREE.Group();
        const cyl = new THREE.CylinderGeometry(p.radius, p.radius, 48, p.sides, 1);
        cyl.rotateX(Math.PI / 2);
        const wire = new THREE.WireframeGeometry(cyl);
        g.add(
          new THREE.LineSegments(
            wire,
            new THREE.LineBasicMaterial({ color: new THREE.Color(0x1a6bff).multiplyScalar(1.45), transparent: true, opacity: 0.85 })
          )
        );
        g.add(
          new THREE.Mesh(
            cyl,
            new THREE.MeshBasicMaterial({
              color: 0x00f5ff,
              transparent: true,
              opacity: 0.11,
              blending: THREE.AdditiveBlending,
            })
          )
        );
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(p.sides, p.radius * 1.03), 3.0, true, -21),
            createNeonRibbonMaterial(0x00f5ff, 1.9, 0.78)
          )
        );
        g.position.set(p.x, p.y, 23);
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
            buildRibbonGeometry(createPolygonPoints(16, r.radius), 3.2, true, 1.6),
            createNeonRibbonMaterial(0xb429ff, 2.2, 0.92)
          )
        );
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(8, r.radius), 2.8, true, 2.1),
            createNeonRibbonMaterial(0x00f5ff, 2.1, 0.95)
          )
        );
        g.add(createGlowSprite(0xb429ff, r.radius * 2.3, 0.35));
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
            createNeonRibbonMaterial(h.colorHex, 2.2, 0.9)
          )
        );
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(24, h.radius), 2.6, true, 1.6),
            createNeonRibbonMaterial(0xff1e2d, 2.2, 0.85)
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
          buildRibbonGeometry(archPts, 4.0, false, 2.2),
          createNeonRibbonMaterial(color, gate.open ? 2.35 : 1.2, gate.open ? 0.95 : 0.45)
        )
      );
      if (gate.open) {
        g.add(
          new THREE.Mesh(
            buildRibbonGeometry(createPolygonPoints(24, gate.radius * 0.52), 3.2, true, 2.6),
            createNeonRibbonMaterial(0x00f5ff, 2.3, 0.9)
          )
        );
        g.add(createGlowSprite(0x39ff14, gate.radius * 2.2, 0.35));
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

import * as THREE from 'three';
import {
  ArenaPillar,
  BeamEntity,
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

interface TransientLine {
  line: THREE.Object3D;
  life: number;
  maxLife: number;
  expandRate?: number;
}

interface TransientWaveArc {
  line: THREE.Line;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface GeometricShard {
  line: THREE.LineLoop;
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
  life: number;
  maxLife: number;
  x: number;
  y: number;
  colorHex: number;
  secondaryColorHex: number;
}

const BEAM_SEGMENTS = 44;

export class SpellVFX {
  private readonly scene: THREE.Scene;
  private readonly projMeshes = new Map<number, THREE.Group>();
  private readonly beamMeshes = new Map<number, THREE.Group>();
  private readonly wallMeshes = new Map<number, THREE.Group>();
  private readonly wallConnectors: THREE.LineSegments;
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

  private readonly transientLines: TransientLine[] = [];
  private readonly waveArcs: TransientWaveArc[] = [];
  private readonly shards: GeometricShard[] = [];
  private readonly maxShards = 160;
  private readonly stormStrikes: StormStrikeAnim[] = [];

  private readonly particles: Particle[] = [];
  private readonly maxParticles = 750;
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
      size: 6,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(this.particleGeometry, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    const connGeo = new THREE.BufferGeometry();
    connGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.wallConnectors = new THREE.LineSegments(
      connGeo,
      new THREE.LineBasicMaterial({ color: 0xe6f0ff, transparent: true, opacity: 0.6 })
    );
    this.wallConnectors.frustumCulled = false;
    this.scene.add(this.wallConnectors);
  }

  public spawnThruster(x: number, y: number, angle: number, colorHex: number): void {
    const color = new THREE.Color(colorHex);
    for (let i = 0; i < 2; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const backA = angle + Math.PI + (Math.random() - 0.5) * 0.45;
      const spd = 70 + Math.random() * 90;
      const maxLife = 0.16 + Math.random() * 0.14;
      this.particles.push({
        x: x - Math.cos(angle) * 16,
        y: y - Math.sin(angle) * 16,
        vx: Math.cos(backA) * spd,
        vy: Math.sin(backA) * spd,
        life: maxLife,
        maxLife,
        color,
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
    for (let k = 0; k < 2; k++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const dist = Math.random() * len;
      const lat = (Math.random() - 0.5) * width * 0.9;
      const cHex = palette[Math.floor(Math.random() * palette.length)]!;
      const color = new THREE.Color(cHex).multiplyScalar(0.78);
      const spd = 420 + Math.random() * 260;
      const flutter = (Math.random() - 0.5) * 45;
      const maxLife = 0.22 + Math.random() * 0.18;
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
    const color = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const spd = (65 + Math.random() * 210) * speedScale;
      const maxLife = 0.24 + Math.random() * 0.32;
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
  }

  public spawnShards(x: number, y: number, colors: number[], count: number, speedScale = 1): void {
    const palette = colors.length > 0 ? colors : [0xe8741a];
    for (let i = 0; i < count; i++) {
      if (this.shards.length >= this.maxShards) {
        const oldest = this.shards.shift()!;
        this.scene.remove(oldest.line);
        this.disposeObject(oldest.line);
      }
      const cHex = palette[i % palette.length]!;
      const isSquare = i % 2 === 0;
      const s = 3.5 + Math.random() * 4.5;
      const pts = isSquare
        ? [
            new THREE.Vector3(-s, -s, 3),
            new THREE.Vector3(s, -s, 3),
            new THREE.Vector3(s, s, 3),
            new THREE.Vector3(-s, s, 3),
          ]
        : [
            new THREE.Vector3(s * 1.3, 0, 3),
            new THREE.Vector3(-s, s * 0.9, 3),
            new THREE.Vector3(-s, -s * 0.9, 3),
          ];
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: cHex, transparent: true, opacity: 0.95 })
      );
      line.position.set(x, y, 0);
      this.scene.add(line);

      const a = Math.random() * Math.PI * 2;
      const spd = (95 + Math.random() * 220) * speedScale;
      const maxLife = 0.32 + Math.random() * 0.3;
      this.shards.push({
        line,
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
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 2.5));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 })
    );
    line.position.set(x, y, 0);
    line.scale.set(0.25, 0.25, 1);
    this.scene.add(line);
    this.transientLines.push({ line, life: duration, maxLife: duration, expandRate: 1 / duration });
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

    const colPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 180)];
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(colPts),
        new THREE.LineBasicMaterial({ color: secondaryColorHex, transparent: true, opacity: 0.45 })
      )
    );

    const oct = new THREE.OctahedronGeometry(Math.max(10, radius * 0.24), 0);
    const edges = new THREE.EdgesGeometry(oct);
    oct.dispose();
    const meteor = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: colorHex }));
    meteor.position.set(0, 0, 180);
    group.add(meteor);

    this.scene.add(group);
    this.stormStrikes.push({
      group,
      meteor,
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
    const count = isNova ? 68 : 26;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const cHex = palette[i % palette.length]!;
      const color = new THREE.Color(cHex);
      const a = isNova ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const spd = range * (1.75 + Math.random() * 1.45);
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

    // Propagating Wave-Pulse Crescent Arcs (Image 3 style)
    const arcCount = isNova ? 4 : 1;
    for (let i = 0; i < arcCount; i++) {
      const a = isNova ? angle + (i / arcCount) * Math.PI * 2 : angle;
      const arcSpan = isNova ? Math.PI * 0.65 : spread * 0.85;
      const arcR = 26;
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 14; s++) {
        const sa = -arcSpan * 0.5 + (s / 14) * arcSpan;
        pts.push(new THREE.Vector3(Math.cos(sa) * arcR, Math.sin(sa) * arcR, 2.5));
      }
      const cHex = palette[i % palette.length]!;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: cHex, transparent: true, opacity: 0.9 })
      );
      line.position.set(x, y, 0);
      line.rotation.z = a;
      this.scene.add(line);
      const maxLife = 0.34;
      const spd = range * 2.35;
      this.waveArcs.push({
        line,
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
    const jagged: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      jagged.push(new THREE.Vector3(a.x, a.y, 4));
      const steps = 6;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const jitter = (Math.random() - 0.5) * 28;
        jagged.push(new THREE.Vector3(a.x + dx * t + nx * jitter, a.y + dy * t + ny * jitter, 4));
      }
    }
    const last = points[points.length - 1]!;
    jagged.push(new THREE.Vector3(last.x, last.y, 4));

    const group = new THREE.Group();
    // White-hot inner core
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(jagged),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
      )
    );
    // Element-colored outer jagged glow
    const glowPts = jagged.map((p) => new THREE.Vector3(p.x + (Math.random() - 0.5) * 5, p.y + (Math.random() - 0.5) * 5, 3.6));
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(glowPts),
        new THREE.LineBasicMaterial({ color: palette[0]!, transparent: true, opacity: 0.92 })
      )
    );

    if (palette.length > 1) {
      const offsetPts = jagged.map((p) => new THREE.Vector3(p.x + (Math.random() - 0.5) * 12, p.y + (Math.random() - 0.5) * 12, 3.3));
      group.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(offsetPts),
          new THREE.LineBasicMaterial({ color: palette[1]!, transparent: true, opacity: 0.85 })
        )
      );
    }

    this.scene.add(group);
    this.transientLines.push({ line: group, life: 0.14, maxLife: 0.14 });
  }

  public update(snapshot: SimSnapshot, dt: number, timeSec: number): void {
    this.syncProjectiles(snapshot.projectiles);
    this.syncBeams(snapshot.beams, timeSec);
    this.syncWalls(snapshot.walls);
    this.syncMines(snapshot.mines, timeSec);
    this.syncStorms(snapshot.storms, timeSec);
    this.syncShields(snapshot.shields);
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
      st.meteor.position.z = t * 180;
      st.meteor.rotation.z += dt * 12;
      st.meteor.rotation.x += dt * 8;
      if (st.life <= 0) {
        this.spawnBurst(st.x, st.y, st.colorHex, 14, 1.1);
        this.spawnShards(st.x, st.y, [st.colorHex, st.secondaryColorHex], 6, 0.9);
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
        this.scene.remove(wa.line);
        this.disposeObject(wa.line);
        this.waveArcs.splice(i, 1);
      } else {
        wa.x += wa.vx * dt;
        wa.y += wa.vy * dt;
        wa.line.position.set(wa.x, wa.y, 0);
        const prog = 1 - wa.life / wa.maxLife;
        const s = 1 + prog * 2.6;
        wa.line.scale.set(s, s, 1);
        (wa.line.material as THREE.LineBasicMaterial).opacity = (wa.life / wa.maxLife) * 0.9;
      }
    }

    // Update geometric shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const sh = this.shards[i]!;
      sh.life -= dt;
      if (sh.life <= 0) {
        this.scene.remove(sh.line);
        this.disposeObject(sh.line);
        this.shards.splice(i, 1);
      } else {
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        sh.vx *= 0.93;
        sh.vy *= 0.93;
        sh.line.position.set(sh.x, sh.y, 0);
        sh.line.rotation.z += sh.rotSpeed * dt;
        (sh.line.material as THREE.LineBasicMaterial).opacity = sh.life / sh.maxLife;
      }
    }

    // Update transient lines & expanding rings
    for (let i = this.transientLines.length - 1; i >= 0; i--) {
      const tl = this.transientLines[i]!;
      tl.life -= dt;
      if (tl.life <= 0) {
        this.scene.remove(tl.line);
        this.disposeObject(tl.line);
        this.transientLines.splice(i, 1);
      } else {
        const ratio = tl.life / tl.maxLife;
        if (tl.expandRate) {
          const s = 0.25 + (1 - ratio) * 0.9;
          tl.line.scale.set(s, s, 1);
        }
        tl.line.traverse((child) => {
          if (child instanceof THREE.Line && child.material instanceof THREE.LineBasicMaterial) {
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
        this.particlePositions[i * 3 + 2] = 3;
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

  private syncProjectiles(items: readonly ProjectileEntity[]): void {
    const alive = new Set<number>();
    for (const p of items) {
      alive.add(p.id);
      let g = this.projMeshes.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const secondary = p.colors.find((c) => c !== p.colorHex) ?? p.colorHex;
        if (p.kind === 'ROCK') {
          const s = p.radius * 1.45;
          const box = new THREE.BoxGeometry(s, s, s, 2, 2, 2);
          const wire = new THREE.WireframeGeometry(box);
          g.add(new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color: p.colorHex })));
          g.add(
            new THREE.Mesh(
              box,
              new THREE.MeshBasicMaterial({
                color: p.colorHex,
                transparent: true,
                opacity: 0.14,
                blending: THREE.AdditiveBlending,
              })
            )
          );
          if (secondary !== p.colorHex) {
            const oct = new THREE.OctahedronGeometry(p.radius * 0.72, 0);
            const octWire = new THREE.WireframeGeometry(oct);
            oct.dispose();
            g.add(new THREE.LineSegments(octWire, new THREE.LineBasicMaterial({ color: secondary })));
          }
        } else {
          const r = p.radius;
          const pts = [
            new THREE.Vector3(r * 2.2, 0, 2),
            new THREE.Vector3(-r, r * 0.6, 2),
            new THREE.Vector3(-r * 0.45, 0, 2),
            new THREE.Vector3(-r, -r * 0.6, 2),
          ];
          g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: p.colorHex })));
          if (secondary !== p.colorHex) {
            const spine = [new THREE.Vector3(r * 1.8, 0, 2.5), new THREE.Vector3(-r * 0.7, 0, 2.5)];
            g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(spine), new THREE.LineBasicMaterial({ color: secondary })));
          }
        }
        this.projMeshes.set(p.id, g);
        this.scene.add(g);
      }
      g.position.set(p.x, p.y, 2);
      if (p.kind === 'ROCK') {
        g.rotation.x = p.spin;
        g.rotation.y = p.spin * 0.7;
        if (g.children[2]) {
          g.children[2].rotation.z = -p.spin * 1.5;
        }
      } else {
        g.rotation.z = Math.atan2(p.vy, p.vx);
      }
    }
    this.pruneMap(this.projMeshes, alive);
  }

  private syncBeams(items: readonly BeamEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const b of items) {
      alive.add(b.id);
      let group = this.beamMeshes.get(b.id);
      const len = b.clashing ? b.clashDist : b.length;
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const nx = -sin;
      const ny = cos;

      if (!group) {
        group = new THREE.Group();
        // 0: Crisp primary-colored inner core (no white blowout)
        group.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
            new THREE.LineBasicMaterial({ color: b.colorHex, transparent: true, opacity: 0.88 })
          )
        );
        // 1..3: 3 Helical braided ribbons
        for (let s = 0; s < 3; s++) {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= BEAM_SEGMENTS; i++) pts.push(new THREE.Vector3());
          const cHex = b.colors[s % b.colors.length]!;
          group.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({ color: cHex, transparent: true, opacity: 0.72 })
            )
          );
        }
        this.beamMeshes.set(b.id, group);
        this.scene.add(group);
      }

      const corePos = (group.children[0] as THREE.Line).geometry.attributes.position as THREE.BufferAttribute;
      corePos.setXYZ(0, b.x, b.y, 3.4);
      corePos.setXYZ(1, b.x + cos * len, b.y + sin * len, 3.4);
      corePos.needsUpdate = true;

      for (let s = 0; s < 3; s++) {
        const strand = group.children[1 + s] as THREE.Line;
        const pos = strand.geometry.attributes.position as THREE.BufferAttribute;
        const phaseOffset = (s / 3) * Math.PI * 2;
        for (let i = 0; i <= BEAM_SEGMENTS; i++) {
          const t = i / BEAM_SEGMENTS;
          const dist = t * len;
          const envelope = Math.sin(Math.min(1, t * 5) * Math.PI * 0.5);
          const wave = Math.sin(t * 22 - timeSec * 24 + phaseOffset) * (b.width * 0.55) * envelope;
          pos.setXYZ(i, b.x + cos * dist + nx * wave, b.y + sin * dist + ny * wave, 2.8);
        }
        pos.needsUpdate = true;
      }

      // Stream fine particles & tiny directional shards along the entire beam length
      this.spawnBeamFlowParticle(b.x, b.y, cos, sin, nx, ny, len, b.width, b.composition.weightedColors);
      if (Math.random() < 0.35) {
        const d = Math.random() * len;
        this.spawnShards(b.x + cos * d, b.y + sin * d, b.colors, 1, 0.65);
      }
    }
    this.pruneMap(this.beamMeshes, alive);
  }

  private syncWalls(items: readonly WallPylonEntity[]): void {
    const alive = new Set<number>();
    const connPts: THREE.Vector3[] = [];
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
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * w.radius, Math.sin(a) * w.radius, 2));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: barrierColor })));

        const inner: THREE.Vector3[] = [];
        for (let i = 0; i <= 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          inner.push(new THREE.Vector3(Math.cos(a) * (w.radius * 0.56), Math.sin(a) * (w.radius * 0.56), 2.5));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), new THREE.LineBasicMaterial({ color: p1 })));

        const cross = [
          new THREE.Vector3(-w.radius * 0.36, 0, 3), new THREE.Vector3(w.radius * 0.36, 0, 3),
          new THREE.Vector3(0, -w.radius * 0.36, 3), new THREE.Vector3(0, w.radius * 0.36, 3),
        ];
        g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cross), new THREE.LineBasicMaterial({ color: p2 })));

        g.position.set(w.x, w.y, 0);
        this.wallMeshes.set(w.id, g);
        this.scene.add(g);
      }
      if (idx > 0) {
        const prev = items[idx - 1]!;
        if (Math.hypot(w.x - prev.x, w.y - prev.y) < 120) {
          connPts.push(new THREE.Vector3(prev.x, prev.y, 2), new THREE.Vector3(w.x, w.y, 2));
        }
      }
      (this.wallConnectors.material as THREE.LineBasicMaterial).color.setHex(p2);
    }
    this.wallConnectors.geometry.setFromPoints(connPts);
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

        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * m.radius, Math.sin(a) * m.radius, 2));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: barrierColor })));

        const inner: THREE.Vector3[] = [];
        for (let i = 0; i <= 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          inner.push(new THREE.Vector3(Math.cos(a) * (m.radius * 0.62), Math.sin(a) * (m.radius * 0.62), 2.5));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), new THREE.LineBasicMaterial({ color: p1 })));

        const cross = [
          new THREE.Vector3(-m.radius * 0.42, -m.radius * 0.42, 3), new THREE.Vector3(m.radius * 0.42, m.radius * 0.42, 3),
          new THREE.Vector3(-m.radius * 0.42, m.radius * 0.42, 3), new THREE.Vector3(m.radius * 0.42, -m.radius * 0.42, 3),
        ];
        g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cross), new THREE.LineBasicMaterial({ color: p2 })));

        const trig: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          trig.push(new THREE.Vector3(Math.cos(a) * m.triggerRadius, Math.sin(a) * m.triggerRadius, 0.8));
        }
        const trigOpacity = payloadColors.length >= 2 ? 0.55 : 0.28;
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(trig), new THREE.LineBasicMaterial({ color: p2, transparent: true, opacity: trigOpacity })));

        g.position.set(m.x, m.y, 0);
        this.mineMeshes.set(m.id, g);
        this.scene.add(g);
      }
      g.children[0]!.rotation.z = timeSec * 2 + m.id;
      g.children[1]!.rotation.z = -timeSec * 3.5;
      g.children[2]!.rotation.z = timeSec * 4.5;
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

        const outer: THREE.Vector3[] = [];
        for (let i = 0; i <= 36; i++) {
          const a = (i / 36) * Math.PI * 2;
          outer.push(new THREE.Vector3(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 1));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outer), new THREE.LineBasicMaterial({ color: barrierColor, transparent: true, opacity: 0.75 })));

        const inner: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          inner.push(new THREE.Vector3(Math.cos(a) * s.radius * 0.62, Math.sin(a) * s.radius * 0.62, 1.5));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), new THREE.LineBasicMaterial({ color: payloadColor, transparent: true, opacity: 0.9 })));

        const spokes: THREE.Vector3[] = [];
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI;
          spokes.push(
            new THREE.Vector3(Math.cos(a) * s.radius * 0.88, Math.sin(a) * s.radius * 0.88, 1.2),
            new THREE.Vector3(-Math.cos(a) * s.radius * 0.88, -Math.sin(a) * s.radius * 0.88, 1.2)
          );
        }
        g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), new THREE.LineBasicMaterial({ color: secondaryPayload, transparent: true, opacity: 0.45 })));

        g.position.set(s.x, s.y, 0);
        this.stormMeshes.set(s.id, g);
        this.scene.add(g);
      }
      g.children[0]!.rotation.z = timeSec * 1.1;
      g.children[1]!.rotation.z = -timeSec * 2.2;
      g.children[2]!.rotation.z = timeSec * 1.6;
    }
    this.pruneMap(this.stormMeshes, alive);
  }

  private syncShields(items: readonly ShieldBarrierEntity[]): void {
    const alive = new Set<number>();
    for (const s of items) {
      alive.add(s.id);
      let g = this.shieldMeshes.get(s.id);
      if (!g) {
        g = new THREE.Group();
        const cols = s.isNova ? 18 : 10;
        const rows = 3;
        const start = s.isNova ? 0 : -s.arc;
        const end = s.isNova ? Math.PI * 2 : s.arc;

        // Geodesic triangulated 3D faceted curved arc (Image 1 style)
        const wirePts: THREE.Vector3[] = [];
        const grid: THREE.Vector3[][] = [];
        for (let r = 0; r <= rows; r++) {
          const rowPts: THREE.Vector3[] = [];
          const z = (r / rows - 0.5) * 44;
          const radScale = 1 - Math.abs(r / rows - 0.5) * 0.16;
          for (let c = 0; c <= cols; c++) {
            const a = start + (c / cols) * (end - start);
            rowPts.push(new THREE.Vector3(Math.cos(a) * s.radius * radScale, Math.sin(a) * s.radius * radScale, z));
          }
          grid.push(rowPts);
        }
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
            new THREE.LineBasicMaterial({ color: s.colorHex, transparent: true, opacity: 0.92 })
          )
        );
        this.shieldMeshes.set(s.id, g);
        this.scene.add(g);
      }
      g.position.set(s.x, s.y, 0);
      g.rotation.z = s.angle;
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
        // 3 nested organically-wobbling topographic contour rings (Image 3 style)
        for (let ring = 0; ring < 3; ring++) {
          const baseR = p.radius * (1 - ring * 0.28);
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const wobble = 1 + 0.14 * Math.sin(3 * a + seed + ring) + 0.08 * Math.cos(5 * a - seed);
            pts.push(new THREE.Vector3(Math.cos(a) * baseR * wobble, Math.sin(a) * baseR * wobble, 0.5 + ring * 0.2));
          }
          g.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({ color: p.colorHex, transparent: true, opacity: 0.65 - ring * 0.12 })
            )
          );
        }
        g.position.set(p.x, p.y, 0);
        this.poolMeshes.set(p.id, g);
        this.scene.add(g);
      }
      const breathe = 1 + Math.sin(timeSec * 3.5 + p.id) * 0.04;
      g.scale.set(breathe, breathe, 1);
      const fade = Math.min(1, (p.life / p.maxLife) * 1.4);
      for (let r = 0; r < g.children.length; r++) {
        const child = g.children[r] as THREE.Line;
        (child.material as THREE.LineBasicMaterial).opacity = (0.65 - r * 0.12) * fade;
      }
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
        const pts1: THREE.Vector3[] = [];
        const pts2: THREE.Vector3[] = [];
        for (let i = 0; i <= 18; i++) {
          const a = -s.arc + (i / 18) * s.arc * 2;
          pts1.push(new THREE.Vector3(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 3.5));
          pts2.push(new THREE.Vector3(Math.cos(a) * (s.radius * 0.78), Math.sin(a) * (s.radius * 0.78), 3.2));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts1), new THREE.LineBasicMaterial({ color: s.colorHex, transparent: true, opacity: 1 })));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), new THREE.LineBasicMaterial({ color: secondary, transparent: true, opacity: 0.85 })));
        g.position.set(s.x, s.y, 0);
        g.rotation.z = s.angle;
        this.slashMeshes.set(s.id, g);
        this.scene.add(g);
      }
      const alpha = Math.max(0, s.life / s.maxLife);
      for (const child of g.children) {
        if (child instanceof THREE.Line && child.material instanceof THREE.LineBasicMaterial) {
          child.material.opacity = alpha;
        }
      }
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
        const cyl = new THREE.CylinderGeometry(p.radius, p.radius, 46, p.sides, 1);
        cyl.rotateX(Math.PI / 2);
        const wire = new THREE.WireframeGeometry(cyl);
        g.add(
          new THREE.LineSegments(
            wire,
            new THREE.LineBasicMaterial({ color: 0x1a6bff, transparent: true, opacity: 0.78 })
          )
        );
        g.add(
          new THREE.Mesh(
            cyl,
            new THREE.MeshBasicMaterial({
              color: 0x00f5ff,
              transparent: true,
              opacity: 0.08,
              blending: THREE.AdditiveBlending,
            })
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
        const outerPts: THREE.Vector3[] = [];
        const innerPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          outerPts.push(new THREE.Vector3(Math.cos(a) * r.radius, Math.sin(a) * r.radius, 1.5));
          innerPts.push(new THREE.Vector3(Math.cos(a) * r.radius, Math.sin(a) * r.radius, 2));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outerPts), new THREE.LineBasicMaterial({ color: 0xb429ff, transparent: true, opacity: 0.85 })));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(innerPts), new THREE.LineBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.9 })));
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
        const outerPts: THREE.Vector3[] = [];
        const innerPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          outerPts.push(new THREE.Vector3(Math.cos(a) * h.radius, Math.sin(a) * h.radius, 1.2));
          innerPts.push(new THREE.Vector3(Math.cos(a) * h.radius, Math.sin(a) * h.radius, 1.5));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outerPts), new THREE.LineBasicMaterial({ color: h.colorHex, transparent: true, opacity: 0.85 })));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(innerPts), new THREE.LineBasicMaterial({ color: 0xff1e2d, transparent: true, opacity: 0.7 })));
        g.position.set(h.x, h.y, 0);
        this.hazardMeshes.set(h.id, g);
        this.scene.add(g);
      }
      const fill = 1 - Math.max(0, h.timer / Math.max(0.1, h.maxTimer));
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
        new THREE.Vector3(0, -gate.radius, 2),
        new THREE.Vector3(-24, -gate.radius * 0.65, 2),
        new THREE.Vector3(-24, gate.radius * 0.65, 2),
        new THREE.Vector3(0, gate.radius, 2),
      ];
      g.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(archPts),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: gate.open ? 0.95 : 0.45 })
        )
      );
      if (gate.open) {
        const ringPts: THREE.Vector3[] = [];
        for (let i = 0; i <= 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          ringPts.push(new THREE.Vector3(Math.cos(a) * (gate.radius * 0.5), Math.sin(a) * (gate.radius * 0.5), 2.5));
        }
        g.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(ringPts),
            new THREE.LineBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.85 })
          )
        );
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
      if (child instanceof THREE.Line || child instanceof THREE.LineLoop || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
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

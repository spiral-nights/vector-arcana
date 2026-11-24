import * as THREE from 'three';
import {
  BeamEntity,
  MineEntity,
  PoolEntity,
  ProjectileEntity,
  ShieldBarrierEntity,
  SimSnapshot,
  SlashArcEntity,
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
  line: THREE.Line;
  life: number;
  maxLife: number;
}

export class SpellVFX {
  private readonly scene: THREE.Scene;
  private readonly projMeshes = new Map<number, THREE.Group>();
  private readonly beamMeshes = new Map<number, THREE.LineSegments>();
  private readonly wallMeshes = new Map<number, THREE.Line>();
  private readonly mineMeshes = new Map<number, THREE.Line>();
  private readonly stormMeshes = new Map<number, THREE.Group>();
  private readonly shieldMeshes = new Map<number, THREE.Line>();
  private readonly poolMeshes = new Map<number, THREE.Line>();
  private readonly slashMeshes = new Map<number, THREE.Line>();

  private readonly transientLines: TransientLine[] = [];
  private readonly particles: Particle[] = [];
  private readonly maxParticles = 420;
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
      size: 4.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(this.particleGeometry, mat);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  public spawnBurst(x: number, y: number, colorHex: number, count: number, speedScale = 1): void {
    const color = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const spd = (55 + Math.random() * 190) * speedScale;
      const maxLife = 0.22 + Math.random() * 0.3;
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

  public spawnSpray(
    x: number,
    y: number,
    angle: number,
    spread: number,
    range: number,
    colorHex: number,
    isNova: boolean
  ): void {
    const color = new THREE.Color(colorHex);
    const count = isNova ? 34 : 18;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const a = isNova ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const spd = range * (1.8 + Math.random() * 1.4);
      const maxLife = 0.22 + Math.random() * 0.18;
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

  public spawnLightning(points: Array<{ x: number; y: number }>, colorHex: number): void {
    if (points.length < 2) return;
    const jagged: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      jagged.push(new THREE.Vector3(a.x, a.y, 4));
      const steps = 4;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const jitter = (Math.random() - 0.5) * 18;
        jagged.push(new THREE.Vector3(a.x + dx * t + nx * jitter, a.y + dy * t + ny * jitter, 4));
      }
    }
    const last = points[points.length - 1]!;
    jagged.push(new THREE.Vector3(last.x, last.y, 4));

    const geo = new THREE.BufferGeometry().setFromPoints(jagged);
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.transientLines.push({ line, life: 0.16, maxLife: 0.16 });
  }

  public update(snapshot: SimSnapshot, dt: number, timeSec: number): void {
    this.syncProjectiles(snapshot.projectiles);
    this.syncBeams(snapshot.beams);
    this.syncWalls(snapshot.walls);
    this.syncMines(snapshot.mines, timeSec);
    this.syncStorms(snapshot.storms, timeSec);
    this.syncShields(snapshot.shields);
    this.syncPools(snapshot.pools);
    this.syncSlashes(snapshot.slashes);

    // Update transient lightning lines
    for (let i = this.transientLines.length - 1; i >= 0; i--) {
      const tl = this.transientLines[i]!;
      tl.life -= dt;
      if (tl.life <= 0) {
        this.scene.remove(tl.line);
        tl.line.geometry.dispose();
        (tl.line.material as THREE.Material).dispose();
        this.transientLines.splice(i, 1);
      } else {
        (tl.line.material as THREE.LineBasicMaterial).opacity = tl.life / tl.maxLife;
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
        if (p.kind === 'ROCK') {
          const box = new THREE.BoxGeometry(p.radius * 1.4, p.radius * 1.4, p.radius * 1.4);
          const edges = new THREE.EdgesGeometry(box);
          box.dispose();
          g.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: p.colorHex })));
        } else {
          const r = p.radius;
          const pts = [
            new THREE.Vector3(r * 1.6, 0, 2),
            new THREE.Vector3(-r, r * 0.6, 2),
            new THREE.Vector3(-r * 0.5, 0, 2),
            new THREE.Vector3(-r, -r * 0.6, 2),
          ];
          g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: p.colorHex })));
        }
        this.projMeshes.set(p.id, g);
        this.scene.add(g);
      }
      g.position.set(p.x, p.y, 2);
      if (p.kind === 'ROCK') {
        g.rotation.x = p.spin;
        g.rotation.y = p.spin * 0.7;
      } else {
        g.rotation.z = Math.atan2(p.vy, p.vx);
      }
    }
    this.pruneMap(this.projMeshes, alive);
  }

  private syncBeams(items: readonly BeamEntity[]): void {
    const alive = new Set<number>();
    for (const b of items) {
      alive.add(b.id);
      let line = this.beamMeshes.get(b.id);
      const len = b.clashing ? b.clashDist : b.length;
      const ex = b.x + Math.cos(b.angle) * len;
      const ey = b.y + Math.sin(b.angle) * len;
      const nx = -Math.sin(b.angle) * (b.width * 0.4);
      const ny = Math.cos(b.angle) * (b.width * 0.4);

      if (!line) {
        const pts = [
          new THREE.Vector3(b.x, b.y, 3),
          new THREE.Vector3(ex, ey, 3),
          new THREE.Vector3(b.x + nx, b.y + ny, 2.5),
          new THREE.Vector3(ex + nx, ey + ny, 2.5),
          new THREE.Vector3(b.x - nx, b.y - ny, 2.5),
          new THREE.Vector3(ex - nx, ey - ny, 2.5),
        ];
        line = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: b.colorHex, transparent: true, opacity: 0.95 })
        );
        this.beamMeshes.set(b.id, line);
        this.scene.add(line);
      } else {
        const pos = line.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, b.x, b.y, 3);
        pos.setXYZ(1, ex, ey, 3);
        pos.setXYZ(2, b.x + nx, b.y + ny, 2.5);
        pos.setXYZ(3, ex + nx, ey + ny, 2.5);
        pos.setXYZ(4, b.x - nx, b.y - ny, 2.5);
        pos.setXYZ(5, ex - nx, ey - ny, 2.5);
        pos.needsUpdate = true;
      }
    }
    this.pruneMap(this.beamMeshes, alive);
  }

  private syncWalls(items: readonly WallPylonEntity[]): void {
    const alive = new Set<number>();
    for (const w of items) {
      alive.add(w.id);
      let line = this.wallMeshes.get(w.id);
      if (!line) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * w.radius, Math.sin(a) * w.radius, 2));
        }
        line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: w.colorHex })
        );
        line.position.set(w.x, w.y, 0);
        this.wallMeshes.set(w.id, line);
        this.scene.add(line);
      }
    }
    this.pruneMap(this.wallMeshes, alive);
  }

  private syncMines(items: readonly MineEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const m of items) {
      alive.add(m.id);
      let line = this.mineMeshes.get(m.id);
      if (!line) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * m.radius, Math.sin(a) * m.radius, 2));
        }
        line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: m.colorHex })
        );
        line.position.set(m.x, m.y, 0);
        this.mineMeshes.set(m.id, line);
        this.scene.add(line);
      }
      line.rotation.z = timeSec * 2 + m.id;
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
        const outer: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const a = (i / 32) * Math.PI * 2;
          outer.push(new THREE.Vector3(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 1));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outer), new THREE.LineBasicMaterial({ color: s.colorHex, transparent: true, opacity: 0.65 })));
        const inner: THREE.Vector3[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          inner.push(new THREE.Vector3(Math.cos(a) * s.radius * 0.45, Math.sin(a) * s.radius * 0.45, 1.5));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), new THREE.LineBasicMaterial({ color: s.colorHex, transparent: true, opacity: 0.85 })));
        g.position.set(s.x, s.y, 0);
        this.stormMeshes.set(s.id, g);
        this.scene.add(g);
      }
      g.rotation.z = timeSec * 1.4;
    }
    this.pruneMap(this.stormMeshes, alive);
  }

  private syncShields(items: readonly ShieldBarrierEntity[]): void {
    const alive = new Set<number>();
    for (const s of items) {
      alive.add(s.id);
      let line = this.shieldMeshes.get(s.id);
      if (!line) {
        const segs = s.isNova ? 32 : 14;
        const pts: THREE.Vector3[] = [];
        const start = s.isNova ? 0 : -s.arc;
        const end = s.isNova ? Math.PI * 2 : s.arc;
        for (let i = 0; i <= segs; i++) {
          const a = start + (i / segs) * (end - start);
          pts.push(new THREE.Vector3(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 2.5));
        }
        line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: s.colorHex, transparent: true, opacity: 0.9 })
        );
        this.shieldMeshes.set(s.id, line);
        this.scene.add(line);
      }
      line.position.set(s.x, s.y, 0);
      line.rotation.z = s.angle;
    }
    this.pruneMap(this.shieldMeshes, alive);
  }

  private syncPools(items: readonly PoolEntity[]): void {
    const alive = new Set<number>();
    for (const p of items) {
      alive.add(p.id);
      let line = this.poolMeshes.get(p.id);
      if (!line) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * p.radius, Math.sin(a) * p.radius, 0.5));
        }
        line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: p.colorHex, transparent: true, opacity: 0.55 })
        );
        line.position.set(p.x, p.y, 0);
        this.poolMeshes.set(p.id, line);
        this.scene.add(line);
      }
      (line.material as THREE.LineBasicMaterial).opacity = Math.min(0.6, (p.life / p.maxLife) * 0.7);
    }
    this.pruneMap(this.poolMeshes, alive);
  }

  private syncSlashes(items: readonly SlashArcEntity[]): void {
    const alive = new Set<number>();
    for (const s of items) {
      alive.add(s.id);
      let line = this.slashMeshes.get(s.id);
      if (!line) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 16; i++) {
          const a = -s.arc + (i / 16) * s.arc * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 3.5));
        }
        line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: s.colorHex, transparent: true, opacity: 1 })
        );
        line.position.set(s.x, s.y, 0);
        line.rotation.z = s.angle;
        this.slashMeshes.set(s.id, line);
        this.scene.add(line);
      }
      (line.material as THREE.LineBasicMaterial).opacity = Math.max(0, s.life / s.maxLife);
    }
    this.pruneMap(this.slashMeshes, alive);
  }

  private pruneMap<T extends THREE.Object3D>(map: Map<number, T>, alive: Set<number>): void {
    for (const [id, obj] of map.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(obj);
        obj.traverse((child) => {
          if (child instanceof THREE.Line || child instanceof THREE.LineLoop || child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
        map.delete(id);
      }
    }
  }
}

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
  line: THREE.Object3D;
  life: number;
  maxLife: number;
  expandRate?: number;
}

interface StormStrikeAnim {
  group: THREE.Group;
  meteor: THREE.Object3D;
  life: number;
  maxLife: number;
  x: number;
  y: number;
  colorHex: number;
}

export class SpellVFX {
  private readonly scene: THREE.Scene;
  private readonly projMeshes = new Map<number, THREE.Group>();
  private readonly beamMeshes = new Map<number, THREE.Group>();
  private readonly wallMeshes = new Map<number, THREE.Group>();
  private readonly wallConnectors: THREE.LineSegments;
  private readonly mineMeshes = new Map<number, THREE.Group>();
  private readonly stormMeshes = new Map<number, THREE.Group>();
  private readonly shieldMeshes = new Map<number, THREE.Group>();
  private readonly poolMeshes = new Map<number, THREE.Line>();
  private readonly slashMeshes = new Map<number, THREE.Group>();

  private readonly transientLines: TransientLine[] = [];
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
      size: 7.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(this.particleGeometry, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    // Wall connector lines
    const connGeo = new THREE.BufferGeometry();
    connGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.wallConnectors = new THREE.LineSegments(
      connGeo,
      new THREE.LineBasicMaterial({ color: 0xe6f0ff, transparent: true, opacity: 0.55 })
    );
    this.wallConnectors.frustumCulled = false;
    this.scene.add(this.wallConnectors);
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

    // Vertical orbital column
    const colPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 180)];
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(colPts),
        new THREE.LineBasicMaterial({ color: secondaryColorHex, transparent: true, opacity: 0.45 })
      )
    );

    // Falling wireframe diamond meteor
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
    const count = isNova ? 64 : 26;
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

    // Brief cone guide rays in combined colors
    if (!isNova) {
      const primary = palette[0]!;
      const secondary = palette[1] ?? primary;
      const conePts = [
        new THREE.Vector3(x + Math.cos(angle - spread * 0.5) * range * 0.85, y + Math.sin(angle - spread * 0.5) * range * 0.85, 2),
        new THREE.Vector3(x, y, 2),
        new THREE.Vector3(x + Math.cos(angle + spread * 0.5) * range * 0.85, y + Math.sin(angle + spread * 0.5) * range * 0.85, 2),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(conePts),
        new THREE.LineBasicMaterial({ color: secondary, transparent: true, opacity: 0.42 })
      );
      this.scene.add(line);
      this.transientLines.push({ line, life: 0.09, maxLife: 0.09 });
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
      const steps = 5;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const jitter = (Math.random() - 0.5) * 26;
        jagged.push(new THREE.Vector3(a.x + dx * t + nx * jitter, a.y + dy * t + ny * jitter, 4));
      }
    }
    const last = points[points.length - 1]!;
    jagged.push(new THREE.Vector3(last.x, last.y, 4));

    const group = new THREE.Group();
    const mainGeo = new THREE.BufferGeometry().setFromPoints(jagged);
    group.add(new THREE.Line(mainGeo, new THREE.LineBasicMaterial({ color: palette[0]!, transparent: true, opacity: 1 })));

    if (palette.length > 1) {
      const offsetPts = jagged.map((p) => new THREE.Vector3(p.x + (Math.random() - 0.5) * 10, p.y + (Math.random() - 0.5) * 10, 3.5));
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
    this.syncPools(snapshot.pools);
    this.syncSlashes(snapshot.slashes);

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
        this.scene.remove(st.group);
        this.disposeObject(st.group);
        this.stormStrikes.splice(i, 1);
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
          const box = new THREE.BoxGeometry(p.radius * 1.45, p.radius * 1.45, p.radius * 1.45);
          const edges = new THREE.EdgesGeometry(box);
          box.dispose();
          g.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: p.colorHex })));

          if (secondary !== p.colorHex) {
            const oct = new THREE.OctahedronGeometry(p.radius * 0.72, 0);
            const octEdges = new THREE.EdgesGeometry(oct);
            oct.dispose();
            g.add(new THREE.LineSegments(octEdges, new THREE.LineBasicMaterial({ color: secondary })));
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
        if (g.children[1]) {
          g.children[1].rotation.z = -p.spin * 1.4;
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
      const ex = b.x + Math.cos(b.angle) * len;
      const ey = b.y + Math.sin(b.angle) * len;
      const pulse = 1 + Math.sin(timeSec * 36) * 0.16;
      const nx = -Math.sin(b.angle) * (b.width * 0.42 * pulse);
      const ny = Math.cos(b.angle) * (b.width * 0.42 * pulse);
      const secondary = b.colors.find((c) => c !== b.colorHex) ?? b.colorHex;

      if (!group) {
        group = new THREE.Group();
        const corePts = [new THREE.Vector3(b.x, b.y, 3.2), new THREE.Vector3(ex, ey, 3.2)];
        group.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(corePts),
            new THREE.LineBasicMaterial({ color: 0xffffff })
          )
        );
        const railPts = [
          new THREE.Vector3(b.x + nx, b.y + ny, 2.6),
          new THREE.Vector3(ex + nx, ey + ny, 2.6),
          new THREE.Vector3(b.x - nx, b.y - ny, 2.6),
          new THREE.Vector3(ex - nx, ey - ny, 2.6),
        ];
        group.add(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(railPts),
            new THREE.LineBasicMaterial({ color: b.colorHex, transparent: true, opacity: 0.95 })
          )
        );
        const outerPts = [
          new THREE.Vector3(b.x + nx * 1.55, b.y + ny * 1.55, 2.2),
          new THREE.Vector3(ex + nx * 1.55, ey + ny * 1.55, 2.2),
          new THREE.Vector3(b.x - nx * 1.55, b.y - ny * 1.55, 2.2),
          new THREE.Vector3(ex - nx * 1.55, ey - ny * 1.55, 2.2),
        ];
        group.add(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(outerPts),
            new THREE.LineBasicMaterial({ color: secondary, transparent: true, opacity: 0.72 })
          )
        );
        this.beamMeshes.set(b.id, group);
        this.scene.add(group);
      } else {
        const corePos = (group.children[0] as THREE.Line).geometry.attributes.position as THREE.BufferAttribute;
        corePos.setXYZ(0, b.x, b.y, 3.2);
        corePos.setXYZ(1, ex, ey, 3.2);
        corePos.needsUpdate = true;

        const railPos = (group.children[1] as THREE.LineSegments).geometry.attributes.position as THREE.BufferAttribute;
        railPos.setXYZ(0, b.x + nx, b.y + ny, 2.6);
        railPos.setXYZ(1, ex + nx, ey + ny, 2.6);
        railPos.setXYZ(2, b.x - nx, b.y - ny, 2.6);
        railPos.setXYZ(3, ex - nx, ey - ny, 2.6);
        railPos.needsUpdate = true;

        const outerPos = (group.children[2] as THREE.LineSegments).geometry.attributes.position as THREE.BufferAttribute;
        outerPos.setXYZ(0, b.x + nx * 1.55, b.y + ny * 1.55, 2.2);
        outerPos.setXYZ(1, ex + nx * 1.55, ey + ny * 1.55, 2.2);
        outerPos.setXYZ(2, b.x - nx * 1.55, b.y - ny * 1.55, 2.2);
        outerPos.setXYZ(3, ex - nx * 1.55, ey - ny * 1.55, 2.2);
        outerPos.needsUpdate = true;
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
      const aegisColor = w.colors.includes(0xe6f0ff) ? 0xe6f0ff : w.colorHex;
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
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: aegisColor })));

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
        const aegisColor = m.colors.includes(0xe6f0ff) ? 0xe6f0ff : m.colorHex;
        const payloadColors = m.colors.filter((c) => c !== 0xe6f0ff);
        const p1 = payloadColors[0] ?? m.colorHex;
        const p2 = payloadColors[1] ?? p1;

        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * m.radius, Math.sin(a) * m.radius, 2));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: aegisColor })));

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
        const aegisColor = s.colors.includes(0xe6f0ff) ? 0xe6f0ff : s.colorHex;
        const payloadColor = s.colorHex;
        const secondaryPayload = s.colors.find((c) => c !== aegisColor && c !== payloadColor) ?? payloadColor;

        const outer: THREE.Vector3[] = [];
        for (let i = 0; i <= 36; i++) {
          const a = (i / 36) * Math.PI * 2;
          outer.push(new THREE.Vector3(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 1));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outer), new THREE.LineBasicMaterial({ color: aegisColor, transparent: true, opacity: 0.75 })));

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
        const segs = s.isNova ? 36 : 18;
        const start = s.isNova ? 0 : -s.arc;
        const end = s.isNova ? Math.PI * 2 : s.arc;

        const pts1: THREE.Vector3[] = [];
        const pts2: THREE.Vector3[] = [];
        for (let i = 0; i <= segs; i++) {
          const a = start + (i / segs) * (end - start);
          pts1.push(new THREE.Vector3(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 2.5));
          pts2.push(new THREE.Vector3(Math.cos(a) * (s.radius - 7), Math.sin(a) * (s.radius - 7), 2.5));
        }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts1), new THREE.LineBasicMaterial({ color: s.colorHex, transparent: true, opacity: 0.95 })));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), new THREE.LineBasicMaterial({ color: 0x80d8ff, transparent: true, opacity: 0.55 })));

        this.shieldMeshes.set(s.id, g);
        this.scene.add(g);
      }
      g.position.set(s.x, s.y, 0);
      g.rotation.z = s.angle;
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
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * p.radius, Math.sin(a) * p.radius, 0.5));
        }
        line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: p.colorHex, transparent: true, opacity: 0.65 })
        );
        line.position.set(p.x, p.y, 0);
        this.poolMeshes.set(p.id, line);
        this.scene.add(line);
      }
      (line.material as THREE.LineBasicMaterial).opacity = Math.min(0.65, (p.life / p.maxLife) * 0.75);
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

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineLoop || child instanceof THREE.LineSegments) {
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

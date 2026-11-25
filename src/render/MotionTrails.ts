import * as THREE from 'three';
import { ParticleQuality } from '../settings';
import { getShipDef } from '../sim/Ships';
import { ELEMENT_META, SimSnapshot } from '../sim/types';
import { buildRibbonGeometry, createNeonRibbonMaterial } from './NeonShaders';

interface TrailSample {
  x: number;
  y: number;
  z: number;
}

interface TrailRecord {
  samples: TrailSample[];
  maxPts: number;
  halfWidth: number;
  mesh: THREE.Mesh;
  positions: Float32Array;
  colors: Float32Array;
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  tailColor: THREE.Color;
}

interface DashGhost {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

export class MotionTrails {
  private readonly scene: THREE.Scene;
  private readonly trails = new Map<string, TrailRecord>();
  private readonly ghosts: DashGhost[] = [];
  private dashGhostCooldown = 0;
  private particleQuality: ParticleQuality = 'HIGH';
  private readonly lastStalkerPos = new Map<number, { x: number; y: number }>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public setParticleQuality(quality: ParticleQuality): void {
    this.particleQuality = quality;
  }

  private createTrailRecord(
    maxPts: number,
    halfWidth: number,
    colorHex: number,
    tailColorHex = colorHex
  ): TrailRecord {
    const positions = new Float32Array(maxPts * 2 * 3);
    const colors = new Float32Array(maxPts * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i < maxPts - 1; i++) {
      const v0 = i * 2;
      indices.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    return {
      samples: [],
      maxPts,
      halfWidth,
      mesh,
      positions,
      colors,
      geometry,
      color: new THREE.Color(colorHex),
      tailColor: new THREE.Color(tailColorHex),
    };
  }

  private pushSample(rec: TrailRecord, x: number, y: number, z: number): void {
    const first = rec.samples[0];
    if (!first || Math.hypot(x - first.x, y - first.y) >= 3.5) {
      rec.samples.unshift({ x, y, z });
      if (rec.samples.length > rec.maxPts) rec.samples.pop();
    } else {
      first.x = x;
      first.y = y;
      first.z = z;
    }

    const n = rec.samples.length;
    if (n < 2) {
      rec.positions.fill(0);
      (rec.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      return;
    }

    const colTmp = new THREE.Color();
    for (let i = 0; i < rec.maxPts; i++) {
      const s = rec.samples[Math.min(i, n - 1)]!;
      const prev = rec.samples[Math.min(Math.max(0, i - 1), n - 1)]!;
      const next = rec.samples[Math.min(i + 1, n - 1)]!;
      let dx = prev.x - next.x;
      let dy = prev.y - next.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-3) {
        dx /= len;
        dy /= len;
      } else {
        dx = 1;
        dy = 0;
      }
      const nx = -dy;
      const ny = dx;

      const t = i / Math.max(1, n - 1);
      const fade = i >= n ? 0 : Math.pow(1 - t, 1.45);
      const hw = rec.halfWidth * (1 - t * 0.92);

      colTmp.copy(rec.color).lerp(rec.tailColor, t);
      const cr = colTmp.r * fade;
      const cg = colTmp.g * fade;
      const cb = colTmp.b * fade;

      const vBase = i * 6;
      rec.positions[vBase] = s.x + nx * hw;
      rec.positions[vBase + 1] = s.y + ny * hw;
      rec.positions[vBase + 2] = s.z;

      rec.positions[vBase + 3] = s.x - nx * hw;
      rec.positions[vBase + 4] = s.y - ny * hw;
      rec.positions[vBase + 5] = s.z;

      rec.colors[vBase] = cr;
      rec.colors[vBase + 1] = cg;
      rec.colors[vBase + 2] = cb;
      rec.colors[vBase + 3] = cr;
      rec.colors[vBase + 4] = cg;
      rec.colors[vBase + 5] = cb;
    }

    (rec.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (rec.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateEntityTrail(
    key: string,
    x: number,
    y: number,
    z: number,
    maxPts: number,
    halfWidth: number,
    colorHex: number,
    tailColorHex = colorHex
  ): void {
    let rec = this.trails.get(key);
    if (!rec) {
      rec = this.createTrailRecord(maxPts, halfWidth, colorHex, tailColorHex);
      this.trails.set(key, rec);
    } else {
      rec.halfWidth = halfWidth;
      rec.color.setHex(colorHex);
      rec.tailColor.setHex(tailColorHex);
    }
    this.pushSample(rec, x, y, z);
  }

  private spawnDashGhost(x: number, y: number, angle: number, colorHex: number): void {
    const pts = [
      { x: 24, y: 0 },
      { x: -14, y: 15.5 },
      { x: -8, y: 0 },
      { x: -14, y: -15.5 },
    ];
    const mesh = new THREE.Mesh(
      buildRibbonGeometry(pts, 2.8, true, 13.5),
      createNeonRibbonMaterial(colorHex, 1.25, 0.72)
    );
    mesh.position.set(x, y, 0);
    mesh.rotation.z = angle;
    this.scene.add(mesh);
    this.ghosts.push({ mesh, life: 0.28, maxLife: 0.28 });
  }

  public update(snapshot: SimSnapshot, dt: number): void {
    const alive = new Set<string>();
    const p = snapshot.player;
    const shipCol = p.queue[0] ? ELEMENT_META[p.queue[0]].colorHex : getShipDef(snapshot.shipId).colorHex;

    // 1. Player wake ribbon & Phase Dash ghost afterimages
    if (snapshot.phase === 'PLAYING' && p.hp > 0) {
      alive.add('player');
      const isDash = p.dashTimer > 0;
      const tailX = p.x - Math.cos(p.aimAngle) * 14;
      const tailY = p.y - Math.sin(p.aimAngle) * 14;
      this.updateEntityTrail('player', tailX, tailY, 12.5, 16, isDash ? 11.5 : 5.6, shipCol, 0x1a6bff);

      this.dashGhostCooldown = Math.max(0, this.dashGhostCooldown - dt);
      if (isDash && this.dashGhostCooldown <= 0) {
        this.dashGhostCooldown = 0.032;
        this.spawnDashGhost(p.x, p.y, p.aimAngle, shipCol);
      }
    }

    // 2. Projectile tapered ribbons
    const allowFullTrails = this.particleQuality !== 'LOW';
    for (const pr of snapshot.projectiles) {
      if (!allowFullTrails && pr.kind !== 'ROCK' && pr.kind !== 'STORM_BOMB') continue;
      const key = `p:${pr.id}`;
      alive.add(key);
      const isHeavy = pr.kind === 'ROCK' || pr.kind === 'ENEMY_ROCK' || pr.kind === 'STORM_BOMB';
      const tailCol = pr.colors[1] ?? pr.colorHex;
      this.updateEntityTrail(
        key,
        pr.x,
        pr.y,
        12,
        isHeavy ? 9 : 11,
        isHeavy ? pr.radius * 0.55 : 4.2,
        pr.colorHex,
        tailCol
      );
    }

    // 3. Stalker & Swarmer enemy ribbons + teleport streak detection
    const stalkersAlive = new Set<number>();
    if (allowFullTrails) {
      for (const e of snapshot.enemies) {
        if (e.archetype !== 'STALKER' && e.archetype !== 'SWARMER') continue;
        const key = `e:${e.id}`;
        alive.add(key);
        const col = e.archetype === 'STALKER' ? 0x00f5ff : 0xff2e97;
        if (e.archetype === 'STALKER') {
          stalkersAlive.add(e.id);
          const prev = this.lastStalkerPos.get(e.id);
          if (prev && Math.hypot(e.x - prev.x, e.y - prev.y) > 75) {
            const flashMesh = new THREE.Mesh(
              buildRibbonGeometry([prev, { x: e.x, y: e.y }], 4.6, false, 14),
              createNeonRibbonMaterial(0x00f5ff, 1.35, 0.92)
            );
            this.scene.add(flashMesh);
            this.ghosts.push({ mesh: flashMesh, life: 0.24, maxLife: 0.24 });
          }
          this.lastStalkerPos.set(e.id, { x: e.x, y: e.y });
        }
        this.updateEntityTrail(key, e.x, e.y, 12, 9, e.archetype === 'STALKER' ? 5.2 : 3.2, col);
      }
    }
    for (const id of this.lastStalkerPos.keys()) {
      if (!stalkersAlive.has(id)) this.lastStalkerPos.delete(id);
    }

    // Prune dead trail records
    for (const [key, rec] of this.trails.entries()) {
      if (!alive.has(key)) {
        this.scene.remove(rec.mesh);
        rec.geometry.dispose();
        (rec.mesh.material as THREE.Material).dispose();
        this.trails.delete(key);
      }
    }

    // Fade dash ghosts & teleport streaks
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const gh = this.ghosts[i]!;
      gh.life -= dt;
      if (gh.life <= 0) {
        this.scene.remove(gh.mesh);
        gh.mesh.geometry.dispose();
        (gh.mesh.material as THREE.Material).dispose();
        this.ghosts.splice(i, 1);
      } else {
        const mat = gh.mesh.material as THREE.ShaderMaterial;
        if (mat.uniforms.uOpacity) {
          mat.uniforms.uOpacity.value = (gh.life / gh.maxLife) * 0.78;
        }
      }
    }
  }
}

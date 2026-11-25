import * as THREE from 'three';
import { ArtStyle, ParticleQuality } from '../settings';
import { getShipDef } from '../sim/Ships';
import { ELEMENT_META, SimSnapshot } from '../sim/types';
import { buildRibbonGeometry, createNeonRibbonMaterial } from './NeonShaders';
import {
  buildInkOutlineGeometry,
  createSumiInkMaterial,
  createWatercolorRibbonMaterial,
  createWatercolorTrailMaterial,
  getWatercolorAssets,
} from './WatercolorAssets';

interface TrailSample {
  x: number;
  y: number;
  z: number;
  age: number;
}

interface TrailRecord {
  samples: TrailSample[];
  maxPts: number;
  maxAge: number;
  halfWidth: number;
  mesh: THREE.Mesh;
  positions: Float32Array;
  colors: Float32Array;
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  tailColor: THREE.Color;
}

interface DashGhost {
  mesh: THREE.Object3D;
  life: number;
  maxLife: number;
}

export class MotionTrails {
  private readonly scene: THREE.Scene;
  private readonly trails = new Map<string, TrailRecord>();
  private readonly ghosts: DashGhost[] = [];
  private dashGhostCooldown = 0;
  private particleQuality: ParticleQuality = 'HIGH';
  private artStyle: ArtStyle = 'VECTOR_NEON';
  private readonly lastStalkerPos = new Map<number, { x: number; y: number }>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public setArtStyle(style: ArtStyle): void {
    if (this.artStyle === style) return;
    this.artStyle = style;
    for (const rec of this.trails.values()) {
      this.scene.remove(rec.mesh);
      rec.geometry.dispose();
      (rec.mesh.material as THREE.Material).dispose();
    }
    this.trails.clear();
    for (const gh of this.ghosts) {
      this.scene.remove(gh.mesh);
      gh.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }
    this.ghosts.length = 0;
  }

  public setParticleQuality(quality: ParticleQuality): void {
    this.particleQuality = quality;
  }

  private createTrailRecord(
    maxPts: number,
    maxAge: number,
    halfWidth: number,
    colorHex: number,
    tailColorHex = colorHex
  ): TrailRecord {
    const positions = new Float32Array(maxPts * 2 * 3);
    const colors = new Float32Array(maxPts * 2 * 3);
    const uvs = new Float32Array(maxPts * 2 * 2);
    const indices: number[] = [];
    for (let i = 0; i < maxPts; i++) {
      const u = i / Math.max(1, maxPts - 1);
      uvs[i * 4] = u;
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = u;
      uvs[i * 4 + 3] = 1;
    }
    for (let i = 0; i < maxPts - 1; i++) {
      const v0 = i * 2;
      indices.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    const isWc = this.artStyle === 'WATERCOLOR_INK';
    const material = isWc
      ? createWatercolorTrailMaterial(getWatercolorAssets().brushStrokeTex)
      : new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.82,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    if (isWc) mesh.renderOrder = 9;
    this.scene.add(mesh);

    return {
      samples: [],
      maxPts,
      maxAge,
      halfWidth: isWc ? halfWidth * 1.35 : halfWidth,
      mesh,
      positions,
      colors,
      geometry,
      color: new THREE.Color(colorHex),
      tailColor: new THREE.Color(tailColorHex),
    };
  }

  private updateTrailBuffer(
    rec: TrailRecord,
    x: number,
    y: number,
    z: number,
    dt: number,
    emitNew: boolean
  ): void {
    for (let i = rec.samples.length - 1; i >= 0; i--) {
      const s = rec.samples[i]!;
      s.age += dt;
      if (s.age >= rec.maxAge) {
        rec.samples.splice(i, 1);
      }
    }

    if (emitNew) {
      if (rec.samples.length > 0 && Math.hypot(x - rec.samples[0]!.x, y - rec.samples[0]!.y) > 120) {
        rec.samples.length = 0;
      }
      const first = rec.samples[0];
      if (!first) {
        rec.samples.push({ x, y, z, age: 0 });
      } else if (Math.hypot(x - first.x, y - first.y) >= 4.0) {
        rec.samples.unshift({ x, y, z, age: 0 });
        if (rec.samples.length > rec.maxPts) rec.samples.pop();
      } else {
        first.x = x;
        first.y = y;
        first.z = z;
        first.age = 0;
      }
    }

    const n = rec.samples.length;
    if (n < 2) {
      for (let i = 0; i < rec.maxPts * 2; i++) {
        rec.positions[i * 3] = 0;
        rec.positions[i * 3 + 1] = 0;
        rec.positions[i * 3 + 2] = -9999;
        rec.colors[i * 3] = 0;
        rec.colors[i * 3 + 1] = 0;
        rec.colors[i * 3 + 2] = 0;
      }
      (rec.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (rec.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      return;
    }

    const colTmp = new THREE.Color();
    for (let i = 0; i < rec.maxPts; i++) {
      const idx = Math.min(i, n - 1);
      const s = rec.samples[idx]!;
      const prev = rec.samples[Math.max(0, idx - 1)]!;
      const next = rec.samples[Math.min(n - 1, idx + 1)]!;
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

      const t = Math.min(1, s.age / rec.maxAge);
      const isTailDup = i >= n;
      const fade = isTailDup ? 0 : Math.pow(1 - t, 1.65);
      const hw = isTailDup ? 0 : rec.halfWidth * (1 - t * 0.92);

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
    dt: number,
    emitNew: boolean,
    maxPts: number,
    maxAge: number,
    halfWidth: number,
    colorHex: number,
    tailColorHex = colorHex
  ): void {
    let rec = this.trails.get(key);
    if (!rec) {
      rec = this.createTrailRecord(maxPts, maxAge, halfWidth, colorHex, tailColorHex);
      this.trails.set(key, rec);
    } else {
      rec.maxAge = maxAge;
      rec.halfWidth = this.artStyle === 'WATERCOLOR_INK' ? halfWidth * 1.35 : halfWidth;
      rec.color.setHex(colorHex);
      rec.tailColor.setHex(tailColorHex);
    }
    this.updateTrailBuffer(rec, x, y, z, dt, emitNew);
  }

  private spawnDashGhost(x: number, y: number, angle: number, colorHex: number): void {
    const pts = [
      { x: 24, y: 0 },
      { x: -14, y: 15.5 },
      { x: -8, y: 0 },
      { x: -14, y: -15.5 },
    ];
    const isWc = this.artStyle === 'WATERCOLOR_INK';
    const mesh = new THREE.Mesh(
      isWc ? buildInkOutlineGeometry(pts, 3.2, true, 13.5, 2.0, 0.45) : buildRibbonGeometry(pts, 2.8, true, 13.5),
      isWc ? createSumiInkMaterial(0.75, 0.5) : createNeonRibbonMaterial(colorHex, 1.25, 0.72)
    );
    mesh.position.set(x, y, 0);
    mesh.rotation.z = angle;
    if (isWc) mesh.renderOrder = 14;
    this.scene.add(mesh);
    this.ghosts.push({ mesh, life: 0.28, maxLife: 0.28 });
  }

  public update(snapshot: SimSnapshot, dt: number): void {
    const safeDt = Math.max(0.001, Math.min(0.05, dt));
    const alive = new Set<string>();
    const p = snapshot.player;
    const shipCol = p.queue[0] ? ELEMENT_META[p.queue[0]].colorHex : getShipDef(snapshot.shipId).colorHex;

    // 1. Velocity-anchored Player Wake (retracts cleanly when stationary, never tethered to mouse)
    if (snapshot.phase === 'PLAYING' && p.hp > 0) {
      alive.add('player');
      const isDash = p.dashTimer > 0;
      const spd = Math.hypot(p.vx, p.vy);
      const emitNew = spd > 28 || isDash;
      const headX = spd > 28 ? p.x - (p.vx / spd) * 10 : p.x;
      const headY = spd > 28 ? p.y - (p.vy / spd) * 10 : p.y;
      this.updateEntityTrail(
        'player',
        headX,
        headY,
        12.5,
        safeDt,
        emitNew,
        16,
        0.22,
        isDash ? 11.0 : 5.4,
        shipCol,
        0x1a6bff
      );

      this.dashGhostCooldown = Math.max(0, this.dashGhostCooldown - safeDt);
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
        safeDt,
        true,
        isHeavy ? 9 : 11,
        0.16,
        isHeavy ? pr.radius * 0.55 : 4.2,
        pr.colorHex,
        tailCol
      );
    }

    // 3. Stalker, Swarmer, Lancer & Volt Sprinter ribbons + teleport streak detection
    const stalkersAlive = new Set<number>();
    if (allowFullTrails) {
      for (const e of snapshot.enemies) {
        if (
          e.archetype !== 'STALKER' &&
          e.archetype !== 'SWARMER' &&
          e.archetype !== 'LANCER' &&
          e.archetype !== 'VOLT_SPRINTER'
        ) {
          continue;
        }
        const key = `e:${e.id}`;
        alive.add(key);
        const col =
          e.archetype === 'STALKER'
            ? 0x00f5ff
            : e.archetype === 'LANCER'
            ? 0xff4518
            : e.archetype === 'VOLT_SPRINTER'
            ? 0xfff733
            : 0xff2e97;
        const eSpd = Math.hypot(e.vx, e.vy);
        if (e.archetype === 'STALKER') {
          stalkersAlive.add(e.id);
          const prev = this.lastStalkerPos.get(e.id);
          if (prev && Math.hypot(e.x - prev.x, e.y - prev.y) > 75) {
            if (this.artStyle === 'WATERCOLOR_INK') {
              const g = new THREE.Group();
              const wash = new THREE.Mesh(
                buildRibbonGeometry([prev, { x: e.x, y: e.y }], 6.2, false, 14),
                createWatercolorRibbonMaterial(0x00f5ff, 0.88, 0.4)
              );
              wash.renderOrder = 13;
              const ink = new THREE.Mesh(
                buildInkOutlineGeometry([prev, { x: e.x, y: e.y }], 3.0, false, 14.6, 2.0, 0.45),
                createSumiInkMaterial(0.94, 0.55)
              );
              ink.renderOrder = 15;
              g.add(wash, ink);
              this.scene.add(g);
              this.ghosts.push({ mesh: g, life: 0.24, maxLife: 0.24 });
            } else {
              const flashMesh = new THREE.Mesh(
                buildRibbonGeometry([prev, { x: e.x, y: e.y }], 4.6, false, 14),
                createNeonRibbonMaterial(0x00f5ff, 1.35, 0.92)
              );
              this.scene.add(flashMesh);
              this.ghosts.push({ mesh: flashMesh, life: 0.24, maxLife: 0.24 });
            }
          }
          this.lastStalkerPos.set(e.id, { x: e.x, y: e.y });
        }
        this.updateEntityTrail(
          key,
          e.x,
          e.y,
          12,
          safeDt,
          eSpd > 22,
          9,
          0.18,
          e.archetype === 'LANCER' && e.aiState === 'FIRE'
            ? 6.4
            : e.archetype === 'STALKER'
            ? 5.0
            : e.archetype === 'VOLT_SPRINTER' || e.archetype === 'LANCER'
            ? 4.2
            : 3.2,
          col
        );
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
      gh.life -= safeDt;
      if (gh.life <= 0) {
        this.scene.remove(gh.mesh);
        gh.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
        this.ghosts.splice(i, 1);
      } else {
        const op = (gh.life / gh.maxLife) * 0.78;
        gh.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial && child.material.uniforms.uOpacity) {
            child.material.uniforms.uOpacity.value = op;
          }
        });
      }
    }
  }
}

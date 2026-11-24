import * as THREE from 'three';
import { ELEMENT_META, EnemyEntity, QueueElement, SimSnapshot } from '../sim/types';

export class EntityRenderer {
  private readonly scene: THREE.Scene;
  private readonly playerGroup = new THREE.Group();
  private readonly hullArcLine: THREE.Line;
  private readonly wardArcLine: THREE.Line;
  private readonly wardInnerArcLine: THREE.Line;
  private readonly channelArcLine: THREE.Line;
  private readonly chargeGroup = new THREE.Group();
  private readonly chargeCore: THREE.Line;
  private readonly chargeRing: THREE.Line;
  private readonly noseCone: THREE.LineLoop;
  private readonly thrusterLine: THREE.Line;
  private readonly reticleGroup = new THREE.Group();
  private readonly waypointGroup = new THREE.Group();
  private readonly pipMeshes: THREE.Group[] = [];
  private readonly pipSlots: Array<QueueElement | null> = [null, null, null];

  private readonly enemyMeshes = new Map<number, THREE.Group>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Player asymmetrical razor-sharp arrow-ship construct
    const bodyPts = [
      new THREE.Vector3(20, 0, 2),
      new THREE.Vector3(-12, 13, 1),
      new THREE.Vector3(-6, 4, 1),
      new THREE.Vector3(-15, 0, 1),
      new THREE.Vector3(-6, -4, 1),
      new THREE.Vector3(-12, -13, 1),
    ];
    const bodyGeo = new THREE.BufferGeometry().setFromPoints(bodyPts);
    const bodyMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
    this.playerGroup.add(new THREE.LineLoop(bodyGeo, bodyMat));

    // Bright front nose-cone highlight
    const nosePts = [
      new THREE.Vector3(23, 0, 3),
      new THREE.Vector3(6, 5, 2.5),
      new THREE.Vector3(10, 0, 2.5),
      new THREE.Vector3(6, -5, 2.5),
    ];
    this.noseCone = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(nosePts),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    this.playerGroup.add(this.noseCone);

    // Thruster wake
    const thrustPts = [
      new THREE.Vector3(-14, 3, 1),
      new THREE.Vector3(-25, 0, 1),
      new THREE.Vector3(-14, -3, 1),
    ];
    this.thrusterLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(thrustPts),
      new THREE.LineBasicMaterial({ color: 0x00a8ff, transparent: true, opacity: 0.85 })
    );
    this.playerGroup.add(this.thrusterLine);

    // Diegetic Hull Arc (rear semi-circle)
    this.hullArcLine = this.createArcLine(28, 0x00e676);
    this.playerGroup.add(this.hullArcLine);

    // Diegetic Ward Arcs (Barrier silver-white outer + element-colored inner)
    this.wardArcLine = this.createArcLine(35, 0xe6f0ff);
    this.wardArcLine.visible = false;
    this.playerGroup.add(this.wardArcLine);

    this.wardInnerArcLine = this.createArcLine(31, 0x00f5ff);
    this.wardInnerArcLine.visible = false;
    this.playerGroup.add(this.wardInnerArcLine);

    // Forward Channel Charge Arc
    const chPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = -0.65 + (i / 16) * 1.3;
      chPts.push(new THREE.Vector3(Math.cos(a) * 26, Math.sin(a) * 26, 2));
    }
    this.channelArcLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(chPts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    this.channelArcLine.visible = false;
    this.playerGroup.add(this.channelArcLine);

    // Forward Charge Indicator
    const corePts = [
      new THREE.Vector3(-8, -8, 2.5), new THREE.Vector3(8, -8, 2.5),
      new THREE.Vector3(8, 8, 2.5), new THREE.Vector3(-8, 8, 2.5), new THREE.Vector3(-8, -8, 2.5),
    ];
    this.chargeCore = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(corePts),
      new THREE.LineBasicMaterial({ color: 0xe8741a })
    );
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 12, Math.sin(a) * 12, 2.2));
    }
    this.chargeRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
    );
    this.chargeGroup.add(this.chargeCore, this.chargeRing);
    this.chargeGroup.position.set(28, 0, 0);
    this.chargeGroup.visible = false;
    this.playerGroup.add(this.chargeGroup);

    this.scene.add(this.playerGroup);

    // 3 Orbiting Elemental Pips
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.visible = false;
      this.scene.add(g);
      this.pipMeshes.push(g);
    }

    // Aim reticle
    const retPts = [
      new THREE.Vector3(-9, 0, 2),
      new THREE.Vector3(-3, 0, 2),
      new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(9, 0, 2),
      new THREE.Vector3(0, -9, 2),
      new THREE.Vector3(0, -3, 2),
      new THREE.Vector3(0, 3, 2),
      new THREE.Vector3(0, 9, 2),
    ];
    const retGeo = new THREE.BufferGeometry().setFromPoints(retPts);
    this.reticleGroup.add(new THREE.LineSegments(retGeo, new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85 })));
    this.scene.add(this.reticleGroup);

    // Click-to-move waypoint marker
    const wpDiamond = [
      new THREE.Vector3(0, 9, 1.5),
      new THREE.Vector3(9, 0, 1.5),
      new THREE.Vector3(0, -9, 1.5),
      new THREE.Vector3(-9, 0, 1.5),
    ];
    this.waypointGroup.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(wpDiamond),
        new THREE.LineBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.85 })
      )
    );
    const wpRing: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      wpRing.push(new THREE.Vector3(Math.cos(a) * 14, Math.sin(a) * 14, 1.2));
    }
    this.waypointGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(wpRing),
        new THREE.LineBasicMaterial({ color: 0x1a6bff, transparent: true, opacity: 0.55 })
      )
    );
    this.waypointGroup.visible = false;
    this.scene.add(this.waypointGroup);
  }

  private createArcLine(radius: number, colorHex: number): THREE.Line {
    const segs = 24;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = Math.PI * 0.55 + t * Math.PI * 0.9;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 1.5));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 });
    return new THREE.Line(geo, mat);
  }

  private updateArcRatio(line: THREE.Line, ratio: number, radius: number, colorHex: number): void {
    const clamped = Math.max(0.01, Math.min(1, ratio));
    const segs = 24;
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    const span = Math.PI * 0.9 * clamped;
    const start = Math.PI - span * 0.5;
    for (let i = 0; i <= segs; i++) {
      const a = start + (i / segs) * span;
      pos.setXYZ(i, Math.cos(a) * radius, Math.sin(a) * radius, 1.5);
    }
    pos.needsUpdate = true;
    (line.material as THREE.LineBasicMaterial).color.setHex(colorHex);
  }

  private buildPipMesh(el: QueueElement): THREE.Group {
    const group = new THREE.Group();
    const meta = ELEMENT_META[el];
    const mat = new THREE.LineBasicMaterial({ color: meta.colorHex });

    const ringPts: THREE.Vector3[] = [];
    const sides =
      el === 'THERMAL' ? 3 :
      el === 'KINETIC' ? 4 :
      el === 'CRYO' || el === 'CRYSTAL' ? 6 :
      el === 'BARRIER' ? 8 : 12;

    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + (el === 'THERMAL' ? Math.PI / 2 : 0);
      ringPts.push(new THREE.Vector3(Math.cos(a) * 6.5, Math.sin(a) * 6.5, 2));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), mat));

    if (el === 'NANO') {
      const cross = [
        new THREE.Vector3(-4, 0, 2), new THREE.Vector3(4, 0, 2),
        new THREE.Vector3(0, -4, 2), new THREE.Vector3(0, 4, 2),
      ];
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cross), mat));
    } else if (el === 'VOLT') {
      const bolt = [
        new THREE.Vector3(2, 5, 2),
        new THREE.Vector3(-2, 0.5, 2),
        new THREE.Vector3(2, -0.5, 2),
        new THREE.Vector3(-2, -5, 2),
      ];
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bolt), mat));
    }
    return group;
  }

  public update(snapshot: SimSnapshot, aimWorld: { x: number; y: number }, timeSec: number): void {
    const p = snapshot.player;
    this.playerGroup.position.set(p.x, p.y, 0);
    this.playerGroup.rotation.z = p.aimAngle;

    this.reticleGroup.position.set(aimWorld.x, aimWorld.y, 0);
    this.reticleGroup.rotation.z = timeSec * 1.5;

    if (p.moveTarget) {
      this.waypointGroup.visible = true;
      this.waypointGroup.position.set(p.moveTarget.x, p.moveTarget.y, 0);
      this.waypointGroup.rotation.z = -timeSec * 2.5;
      const pulse = 0.85 + Math.sin(timeSec * 8) * 0.2;
      this.waypointGroup.scale.set(pulse, pulse, 1);
    } else {
      this.waypointGroup.visible = false;
    }

    // Thruster flicker
    this.thrusterLine.visible = p.moving || p.dashTimer > 0;
    const thrustScale = p.dashTimer > 0 ? 1.9 : 0.8 + Math.sin(timeSec * 40) * 0.25;
    this.thrusterLine.scale.set(thrustScale, 1, 1);

    // Diegetic Hull Arc
    const hpRatio = p.hp / Math.max(1, p.maxHp);
    const hullColor = hpRatio > 0.35 ? 0x00e676 : 0xff2a2a;
    this.updateArcRatio(this.hullArcLine, hpRatio, 27, hullColor);

    // Diegetic Ward Arcs
    if (p.wardRemaining > 0) {
      this.wardArcLine.visible = true;
      const wardRatio = p.wardRemaining / Math.max(0.1, p.wardMaxDuration);
      this.updateArcRatio(this.wardArcLine, wardRatio, 35, 0xe6f0ff);
      if (p.wardElement) {
        this.wardInnerArcLine.visible = true;
        this.updateArcRatio(this.wardInnerArcLine, wardRatio, 31, ELEMENT_META[p.wardElement].colorHex);
      } else {
        this.wardInnerArcLine.visible = false;
      }
    } else {
      this.wardArcLine.visible = false;
      this.wardInnerArcLine.visible = false;
    }

    // Channel charge arc
    if (p.channel) {
      this.channelArcLine.visible = true;
      (this.channelArcLine.material as THREE.LineBasicMaterial).color.setHex(p.channel.composition.primaryColorHex);
    } else {
      this.channelArcLine.visible = false;
    }

    // Forward charge indicator
    if (p.charge) {
      this.chargeGroup.visible = true;
      const scale = 0.4 + p.charge.ratio * 1.05;
      this.chargeGroup.scale.set(scale, scale, 1);
      this.chargeCore.rotation.z = timeSec * (4 + p.charge.ratio * 10);
      this.chargeRing.rotation.z = -timeSec * 3;
      (this.chargeCore.material as THREE.LineBasicMaterial).color.setHex(p.charge.composition.primaryColorHex);
      (this.chargeRing.material as THREE.LineBasicMaterial).color.setHex(p.charge.composition.secondaryColorHex);
    } else {
      this.chargeGroup.visible = false;
    }

    // Orbiting elemental pips
    for (let i = 0; i < 3; i++) {
      const el = p.queue[i] ?? null;
      const pip = this.pipMeshes[i]!;
      if (el !== this.pipSlots[i]) {
        this.pipSlots[i] = el;
        while (pip.children.length > 0) {
          const child = pip.children[0]!;
          pip.remove(child);
          if ((child as THREE.Line).geometry) (child as THREE.Line).geometry.dispose();
        }
        if (el) {
          pip.add(this.buildPipMesh(el));
        }
      }
      if (el) {
        pip.visible = true;
        const count = p.queue.length;
        const orbitAngle = timeSec * 2.8 + (i / Math.max(1, count)) * Math.PI * 2;
        pip.position.set(p.x + Math.cos(orbitAngle) * 32, p.y + Math.sin(orbitAngle) * 32, 3);
        pip.rotation.z = -timeSec * 3;
      } else {
        pip.visible = false;
      }
    }

    this.syncEnemies(snapshot.enemies, timeSec);
  }

  private syncEnemies(enemies: readonly EnemyEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const e of enemies) {
      alive.add(e.id);
      let group = this.enemyMeshes.get(e.id);
      if (!group) {
        group = this.createEnemyMesh(e);
        this.enemyMeshes.set(e.id, group);
        this.scene.add(group);
      }
      group.position.set(e.x, e.y, 0);
      group.rotation.z = e.archetype === 'SWARMER' || e.archetype === 'SPLITTER'
        ? timeSec * 3.5 + e.id
        : e.angle;

      // Status tint on primary wireframe
      const statusColor = e.hitFlash > 0
        ? 0xffffff
        : e.statuses.FROZEN
        ? 0x00ffff
        : e.statuses.IGNITED
        ? 0xff5522
        : e.statuses.PRIMED
        ? 0x00a8ff
        : e.statuses.CORRUPTED
        ? 0x39ff14
        : null;

      const mainLine = group.children[0] as THREE.Line | undefined;
      if (mainLine && mainLine.material instanceof THREE.LineBasicMaterial) {
        const baseColor = (group.userData.baseColor as number) ?? 0xff2e97;
        mainLine.material.color.setHex(statusColor ?? baseColor);
      }

      // Bastion front shield visibility
      if (e.archetype === 'BASTION') {
        const shieldChild = group.children[1];
        if (shieldChild) {
          shieldChild.visible = e.hasFrontShield && e.shieldHp > 0;
        }
      }

      // Boss rotating shield plates
      if (e.archetype === 'WARDEN') {
        for (let i = 0; i < e.bossShieldAngles.length; i++) {
          const plate = group.children[1 + i];
          if (plate) {
            plate.rotation.z = e.bossShieldAngles[i]! - e.angle;
          }
        }
      }
    }

    for (const [id, group] of this.enemyMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(group);
        this.disposeGroup(group);
        this.enemyMeshes.delete(id);
      }
    }
  }

  private createEnemyMesh(e: EnemyEntity): THREE.Group {
    const group = new THREE.Group();
    const r = e.radius;
    let baseColor = 0xff2e97;

    if (e.archetype === 'SWARMER') {
      baseColor = 0xff2e97;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rad = i % 2 === 0 ? r : r * 0.42;
        pts.push(new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, 1.5));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: baseColor })));
    } else if (e.archetype === 'BASTION') {
      baseColor = 0x00e676;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 2));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: baseColor })));
      // Front directional shield arc
      const arcPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = -e.shieldArc + (i / 14) * e.shieldArc * 2;
        arcPts.push(new THREE.Vector3(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8), 2.5));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), new THREE.LineBasicMaterial({ color: 0x66ffaa })));
    } else if (e.archetype === 'STALKER') {
      baseColor = 0x00ffff;
      const pts = [
        new THREE.Vector3(r * 1.2, 0, 2),
        new THREE.Vector3(0, r * 0.85, 2),
        new THREE.Vector3(-r * 1.2, 0, 2),
        new THREE.Vector3(0, -r * 0.85, 2),
        new THREE.Vector3(r * 1.2, 0, 2),
      ];
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: baseColor })));
    } else if (e.archetype === 'WEAVER') {
      baseColor = 0xbd00ff;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 2));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: baseColor })));
    } else if (e.archetype === 'SPLITTER') {
      baseColor = 0xff9e00;
      const outer = [
        new THREE.Vector3(-r, -r, 2), new THREE.Vector3(r, -r, 2),
        new THREE.Vector3(r, r, 2), new THREE.Vector3(-r, r, 2), new THREE.Vector3(-r, -r, 2),
      ];
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outer), new THREE.LineBasicMaterial({ color: baseColor })));
      const innerR = r * 0.52;
      const inner = [
        new THREE.Vector3(0, innerR, 3), new THREE.Vector3(innerR, 0, 3),
        new THREE.Vector3(0, -innerR, 3), new THREE.Vector3(-innerR, 0, 3), new THREE.Vector3(0, innerR, 3),
      ];
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), new THREE.LineBasicMaterial({ color: 0xbd00ff })));
    } else {
      // WARDEN Boss
      baseColor = 0xff2e97;
      const corePts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        corePts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 2.5));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(corePts), new THREE.LineBasicMaterial({ color: baseColor })));
      for (let p = 0; p < 3; p++) {
        const platePts: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = -0.45 + (i / 8) * 0.9;
          platePts.push(new THREE.Vector3(Math.cos(a) * (r + 14), Math.sin(a) * (r + 14), 3));
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(platePts), new THREE.LineBasicMaterial({ color: 0x00e676 })));
      }
    }

    group.userData.baseColor = baseColor;
    return group;
  }

  private disposeGroup(group: THREE.Group): void {
    for (const child of group.children) {
      if (child instanceof THREE.Line || child instanceof THREE.LineLoop || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
  }
}

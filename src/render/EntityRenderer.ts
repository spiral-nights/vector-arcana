import * as THREE from 'three';
import { ELEMENT_META, EnemyEntity, QueueElement, SimSnapshot } from '../sim/types';

export class EntityRenderer {
  private readonly scene: THREE.Scene;
  private readonly playerGroup = new THREE.Group();
  private readonly shipChevrons: THREE.LineLoop[] = [];
  private readonly noseTipMesh: THREE.Mesh;
  private readonly muzzleSparkle: THREE.LineSegments;
  private readonly thrusterLine: THREE.Line;
  private readonly rearHaloLine: THREE.Line;
  private readonly hullArcLine: THREE.Line;
  private readonly wardArcLine: THREE.Line;
  private readonly wardInnerArcLine: THREE.Line;
  private readonly channelArcLine: THREE.Line;
  private readonly chargeGroup = new THREE.Group();
  private readonly chargeCore: THREE.Line;
  private readonly chargeRing: THREE.Line;
  private readonly armorCage: THREE.Line;
  private readonly reticleGroup = new THREE.Group();
  private readonly waypointGroup = new THREE.Group();
  private readonly pipMeshes: THREE.Group[] = [];
  private readonly pipSlots: Array<QueueElement | null> = [null, null, null];

  private readonly enemyMeshes = new Map<number, THREE.Group>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 3 Nested Concentric Chevrons (matching reference construct silhouette)
    const chevronDefs: Array<Array<[number, number, number]>> = [
      [[24, 0, 2], [-15, 16, 1.5], [-9, 0, 1.5], [-15, -16, 1.5]],
      [[16, 0, 2.3], [-11, 11, 1.8], [-6, 0, 1.8], [-11, -11, 1.8]],
      [[9, 0, 2.6], [-7, 6.5, 2.1], [-3, 0, 2.1], [-7, -6.5, 2.1]],
    ];
    for (const ptsDef of chevronDefs) {
      const pts = ptsDef.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x00f5ff })
      );
      this.shipChevrons.push(loop);
      this.playerGroup.add(loop);
    }

    // Glowing Solid Additive Nose Tip
    const tipGeo = new THREE.BufferGeometry();
    tipGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([25, 0, 3, 11, 5, 2.8, 11, -5, 2.8], 3)
    );
    this.noseTipMesh = new THREE.Mesh(
      tipGeo,
      new THREE.MeshBasicMaterial({
        color: 0x00f5ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.playerGroup.add(this.noseTipMesh);

    // Very small 4-point muzzle sparkle when actively shooting
    const sparklePts = [
      new THREE.Vector3(-9, 0, 3.5), new THREE.Vector3(9, 0, 3.5),
      new THREE.Vector3(0, -9, 3.5), new THREE.Vector3(0, 9, 3.5),
      new THREE.Vector3(-3.5, -3.5, 3.5), new THREE.Vector3(3.5, 3.5, 3.5),
      new THREE.Vector3(-3.5, 3.5, 3.5), new THREE.Vector3(3.5, -3.5, 3.5),
    ];
    this.muzzleSparkle = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(sparklePts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    );
    this.muzzleSparkle.position.set(25, 0, 0);
    this.muzzleSparkle.visible = false;
    this.playerGroup.add(this.muzzleSparkle);

    // Thruster wake
    const thrustPts = [
      new THREE.Vector3(-12, 4, 1.2),
      new THREE.Vector3(-28, 0, 1.2),
      new THREE.Vector3(-12, -4, 1.2),
    ];
    this.thrusterLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(thrustPts),
      new THREE.LineBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.85 })
    );
    this.playerGroup.add(this.thrusterLine);

    // Diegetic Rear Double Halo (outer bracket + inner hull integrity arc)
    this.rearHaloLine = this.createArcLine(31, 0x00f5ff, 0.48, Math.PI * 1.15);
    this.playerGroup.add(this.rearHaloLine);

    this.hullArcLine = this.createArcLine(28, 0x39ff14, 0.92, Math.PI * 0.95);
    this.playerGroup.add(this.hullArcLine);

    // Diegetic Ward Arcs (Barrier silver-white outer + element-colored inner)
    this.wardArcLine = this.createArcLine(36, 0xe6f0ff, 0.9, Math.PI * 1.05);
    this.wardArcLine.visible = false;
    this.playerGroup.add(this.wardArcLine);

    this.wardInnerArcLine = this.createArcLine(33, 0x00f5ff, 0.9, Math.PI * 1.05);
    this.wardInnerArcLine.visible = false;
    this.playerGroup.add(this.wardInnerArcLine);

    // Forward Channel Charge Arc
    const chPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = -0.65 + (i / 16) * 1.3;
      chPts.push(new THREE.Vector3(Math.cos(a) * 28, Math.sin(a) * 28, 2));
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
    this.chargeGroup.position.set(29, 0, 0);
    this.chargeGroup.visible = false;
    this.playerGroup.add(this.chargeGroup);

    // Kinetic Self-Cast Armor Cage
    const armorPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      armorPts.push(new THREE.Vector3(Math.cos(a) * 25, Math.sin(a) * 25, 2.2));
    }
    this.armorCage = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(armorPts),
      new THREE.LineBasicMaterial({ color: 0xe8741a, transparent: true, opacity: 0.85 })
    );
    this.armorCage.visible = false;
    this.playerGroup.add(this.armorCage);

    this.scene.add(this.playerGroup);

    // 3 Rear-Arc Queued Elemental Pips
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

  private createArcLine(radius: number, colorHex: number, opacity: number, span: number): THREE.Line {
    const segs = 26;
    const pts: THREE.Vector3[] = [];
    const start = Math.PI - span * 0.5;
    for (let i = 0; i <= segs; i++) {
      const a = start + (i / segs) * span;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 1.5));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity });
    return new THREE.Line(geo, mat);
  }

  private updateArcRatio(line: THREE.Line, ratio: number, radius: number, colorHex: number, maxSpan = Math.PI * 0.95): void {
    const clamped = Math.max(0.01, Math.min(1, ratio));
    const segs = 26;
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    const span = maxSpan * clamped;
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
      ringPts.push(new THREE.Vector3(Math.cos(a) * 6.8, Math.sin(a) * 6.8, 2));
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

    // Tint ship chevrons & rear halo toward active element / channel / charge
    const activeColor = p.channel
      ? p.channel.composition.primaryColorHex
      : p.charge
      ? p.charge.composition.primaryColorHex
      : p.queue[0]
      ? ELEMENT_META[p.queue[0]].colorHex
      : 0x00f5ff;
    for (const ch of this.shipChevrons) {
      (ch.material as THREE.LineBasicMaterial).color.setHex(activeColor);
    }
    (this.noseTipMesh.material as THREE.MeshBasicMaterial).color.setHex(activeColor);
    (this.rearHaloLine.material as THREE.LineBasicMaterial).color.setHex(activeColor);
    (this.thrusterLine.material as THREE.LineBasicMaterial).color.setHex(activeColor);

    const isShooting =
      (p.channel !== null && p.channel.delivery !== 'SELF_HEAL') ||
      snapshot.beams.some((b) => b.owner === 'PLAYER') ||
      snapshot.slashes.length > 0;
    this.muzzleSparkle.visible = isShooting;
    if (isShooting) {
      this.muzzleSparkle.rotation.z = timeSec * 14;
      const pulse = 0.75 + Math.sin(timeSec * 45) * 0.25;
      this.muzzleSparkle.scale.set(pulse, pulse, 1);
      (this.muzzleSparkle.material as THREE.LineBasicMaterial).color.setHex(activeColor);
    }

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
    const hullColor = hpRatio > 0.35 ? 0x39ff14 : 0xff1e2d;
    this.updateArcRatio(this.hullArcLine, hpRatio, 28, hullColor, Math.PI * 0.95);

    // Diegetic Ward Arcs
    if (p.wardRemaining > 0) {
      this.wardArcLine.visible = true;
      const wardRatio = p.wardRemaining / Math.max(0.1, p.wardMaxDuration);
      this.updateArcRatio(this.wardArcLine, wardRatio, 36, 0xe6f0ff, Math.PI * 1.05);
      if (p.wardElement) {
        this.wardInnerArcLine.visible = true;
        this.updateArcRatio(this.wardInnerArcLine, wardRatio, 33, ELEMENT_META[p.wardElement].colorHex, Math.PI * 1.05);
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

    // Kinetic armor cage
    if (p.armorHp > 0) {
      this.armorCage.visible = true;
      this.armorCage.rotation.z = timeSec * 1.8;
      (this.armorCage.material as THREE.LineBasicMaterial).opacity = 0.35 + (p.armorHp / Math.max(1, p.maxArmorHp)) * 0.6;
    } else {
      this.armorCage.visible = false;
    }

    // Rear-Arc Queued Elemental Pips
    const count = p.queue.length;
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
        const offset = (i - (count - 1) * 0.5) * 0.55;
        const pipAngle = p.aimAngle + Math.PI + offset;
        const pulseR = 42 + Math.sin(timeSec * 5 + i) * 1.5;
        pip.position.set(p.x + Math.cos(pipAngle) * pulseR, p.y + Math.sin(pipAngle) * pulseR, 3);
        pip.rotation.z = -timeSec * 2.5;
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

      const statusColor = e.hitFlash > 0
        ? 0xffffff
        : e.statuses.FROZEN
        ? 0x00f5ff
        : e.statuses.IGNITED
        ? 0xff5522
        : e.statuses.PRIMED
        ? 0x1a6bff
        : e.statuses.CORRUPTED
        ? 0x39ff14
        : null;

      const mainLine = group.children[0] as THREE.Line | undefined;
      if (mainLine && mainLine.material instanceof THREE.LineBasicMaterial) {
        const baseColor = (group.userData.baseColor as number) ?? 0xff2e97;
        mainLine.material.color.setHex(statusColor ?? baseColor);
      }

      if (e.archetype === 'BASTION') {
        const shieldChild = group.children[1];
        if (shieldChild) {
          shieldChild.visible = e.hasFrontShield && e.shieldHp > 0;
        }
      }

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
      baseColor = 0xe6f0ff;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 2));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: baseColor })));
      const arcPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = -e.shieldArc + (i / 14) * e.shieldArc * 2;
        arcPts.push(new THREE.Vector3(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8), 2.5));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), new THREE.LineBasicMaterial({ color: 0xe6f0ff })));
    } else if (e.archetype === 'STALKER') {
      baseColor = 0x00f5ff;
      const pts = [
        new THREE.Vector3(r * 1.2, 0, 2),
        new THREE.Vector3(0, r * 0.85, 2),
        new THREE.Vector3(-r * 1.2, 0, 2),
        new THREE.Vector3(0, -r * 0.85, 2),
        new THREE.Vector3(r * 1.2, 0, 2),
      ];
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: baseColor })));
    } else if (e.archetype === 'WEAVER') {
      baseColor = 0xb429ff;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 2));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: baseColor })));
    } else if (e.archetype === 'SPLITTER') {
      baseColor = 0xe8741a;
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
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), new THREE.LineBasicMaterial({ color: 0xb429ff })));
    } else {
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
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(platePts), new THREE.LineBasicMaterial({ color: 0xe6f0ff })));
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

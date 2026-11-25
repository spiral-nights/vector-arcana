import * as THREE from 'three';
import { createGlowSprite } from './GlowUtil';
import { buildRibbonGeometry, createNeonRibbonMaterial, setShaderUniform } from './NeonShaders';
import { ELEMENT_META, EnemyEntity, QueueElement, SimSnapshot } from '../sim/types';

function createArcPts(radius: number, span: number, segs = 26): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const start = Math.PI - span * 0.5;
  for (let i = 0; i <= segs; i++) {
    const a = start + (i / segs) * span;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

function createPolygonPts(sides: number, radius: number, rotOffset = 0): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + rotOffset;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

function setRibbonColor(mesh: THREE.Mesh, colorHex: number): void {
  const mat = mesh.material;
  if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uColor) {
    (mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
  } else if (mat instanceof THREE.MeshBasicMaterial) {
    mat.color.setHex(colorHex);
  }
}

export class EntityRenderer {
  private readonly scene: THREE.Scene;
  private readonly playerGroup = new THREE.Group();
  private readonly shipChevrons: THREE.Mesh[] = [];
  private readonly noseTipMesh: THREE.Mesh;
  private readonly shipGlow: THREE.Sprite;
  private readonly muzzleSparkle: THREE.Group;
  private readonly thrusterMesh: THREE.Mesh;
  private readonly rearHaloMesh: THREE.Mesh;
  private readonly hullArcMesh: THREE.Mesh;
  private lastHullRatio = -1;
  private readonly wardArcMesh: THREE.Mesh;
  private readonly wardInnerArcMesh: THREE.Mesh;
  private lastWardRatio = -1;
  private readonly channelArcMesh: THREE.Mesh;
  private readonly chargeGroup = new THREE.Group();
  private readonly chargeCore: THREE.Mesh;
  private readonly chargeRing: THREE.Mesh;
  private readonly armorCage: THREE.Mesh;
  private readonly reticleGroup = new THREE.Group();
  private readonly waypointGroup = new THREE.Group();
  private readonly gatePointer: THREE.Mesh;
  private readonly pipMeshes: THREE.Group[] = [];
  private readonly pipSlots: Array<QueueElement | null> = [null, null, null];

  private readonly enemyMeshes = new Map<number, THREE.Group>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Ground altitude shadow ring for pseudo-3D depth
    const groundRing = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(24, 18), 2.2, true, -13.2),
      createNeonRibbonMaterial(0x00a8ff, 0.75, 0.32)
    );
    this.playerGroup.add(groundRing);

    // Subtle dark metallic extruded fuselage backing
    const hullBackGeo = new THREE.BufferGeometry();
    hullBackGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([25, 0, -2, -15, 16, -4, -9, 0, -2, -15, -16, -4], 3)
    );
    hullBackGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.playerGroup.add(
      new THREE.Mesh(
        hullBackGeo,
        new THREE.MeshBasicMaterial({ color: 0x0b1628, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
      )
    );

    // 3 Nested Concentric Chevrons with staggered 3D Z heights
    const chevronDefs: Array<{ pts: Array<{ x: number; y: number }>; width: number; z: number; boost: number }> = [
      { pts: [{ x: 25, y: 0 }, { x: -15, y: 16.5 }, { x: -9, y: 0 }, { x: -15, y: -16.5 }], width: 2.8, z: 0.5, boost: 1.2 },
      { pts: [{ x: 16.5, y: 0 }, { x: -11, y: 11 }, { x: -6, y: 0 }, { x: -11, y: -11 }], width: 2.2, z: 2.0, boost: 1.1 },
      { pts: [{ x: 9.5, y: 0 }, { x: -7, y: 6.5 }, { x: -3, y: 0 }, { x: -7, y: -6.5 }], width: 1.8, z: 3.5, boost: 1.0 },
    ];
    for (const def of chevronDefs) {
      const ribbon = new THREE.Mesh(
        buildRibbonGeometry(def.pts, def.width, true, def.z),
        createNeonRibbonMaterial(0x00f5ff, def.boost, 1.0)
      );
      this.shipChevrons.push(ribbon);
      this.playerGroup.add(ribbon);
    }

    // Glowing Solid Additive Nose Tip
    const tipGeo = new THREE.BufferGeometry();
    tipGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([26, 0, 3.8, 11, 5.2, 3.2, 11, -5.2, 3.2], 3)
    );
    this.noseTipMesh = new THREE.Mesh(
      tipGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x00f5ff).multiplyScalar(1.05),
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.playerGroup.add(this.noseTipMesh);

    this.shipGlow = createGlowSprite(0x00f5ff, 40, 0.16);
    this.playerGroup.add(this.shipGlow);

    // Very crisp tiny 4-point muzzle sparkle ONLY when actively shooting
    this.muzzleSparkle = new THREE.Group();
    this.muzzleSparkle.add(
      new THREE.Mesh(
        buildRibbonGeometry([{ x: -7, y: 0 }, { x: 7, y: 0 }], 1.6, false, 4.2),
        createNeonRibbonMaterial(0xffffff, 1.35, 0.9)
      ),
      new THREE.Mesh(
        buildRibbonGeometry([{ x: 0, y: -7 }, { x: 0, y: 7 }], 1.6, false, 4.2),
        createNeonRibbonMaterial(0xffffff, 1.35, 0.9)
      )
    );
    this.muzzleSparkle.position.set(26, 0, 0);
    this.muzzleSparkle.visible = false;
    this.playerGroup.add(this.muzzleSparkle);

    // Vivid Thruster Wake
    const thrustPts = [
      { x: -12, y: 4.5 },
      { x: -28, y: 0 },
      { x: -12, y: -4.5 },
    ];
    this.thrusterMesh = new THREE.Mesh(
      buildRibbonGeometry(thrustPts, 2.6, false, 0.5),
      createNeonRibbonMaterial(0x00f5ff, 1.2, 0.95)
    );
    this.playerGroup.add(this.thrusterMesh);

    // Diegetic Rear Double Halo
    this.rearHaloMesh = new THREE.Mesh(
      buildRibbonGeometry(createArcPts(32, Math.PI * 1.15, 26), 2.4, false, 0.6),
      createNeonRibbonMaterial(0x00f5ff, 1.0, 0.65)
    );
    this.playerGroup.add(this.rearHaloMesh);

    this.hullArcMesh = new THREE.Mesh(
      buildRibbonGeometry(createArcPts(28, Math.PI * 0.95, 26), 2.8, false, 1.0),
      createNeonRibbonMaterial(0x39ff14, 1.15, 0.95)
    );
    this.playerGroup.add(this.hullArcMesh);

    // Diegetic Ward Arcs
    this.wardArcMesh = new THREE.Mesh(
      buildRibbonGeometry(createArcPts(37, Math.PI * 1.05, 26), 3.0, false, 1.4),
      createNeonRibbonMaterial(0xe6f0ff, 1.2, 0.92)
    );
    this.wardArcMesh.visible = false;
    this.playerGroup.add(this.wardArcMesh);

    this.wardInnerArcMesh = new THREE.Mesh(
      buildRibbonGeometry(createArcPts(33.5, Math.PI * 1.05, 26), 2.5, false, 1.6),
      createNeonRibbonMaterial(0x00f5ff, 1.15, 0.92)
    );
    this.wardInnerArcMesh.visible = false;
    this.playerGroup.add(this.wardInnerArcMesh);

    // Forward Channel Charge Arc
    const chPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 16; i++) {
      const a = -0.68 + (i / 16) * 1.36;
      chPts.push({ x: Math.cos(a) * 28, y: Math.sin(a) * 28 });
    }
    this.channelArcMesh = new THREE.Mesh(
      buildRibbonGeometry(chPts, 2.8, false, 2.0),
      createNeonRibbonMaterial(0xffffff, 1.2, 0.92)
    );
    this.channelArcMesh.visible = false;
    this.playerGroup.add(this.channelArcMesh);

    // Forward Charge Indicator
    this.chargeCore = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(4, 9.5, Math.PI / 4), 2.5, true, 2.4),
      createNeonRibbonMaterial(0xe8741a, 1.2, 0.95)
    );
    this.chargeRing = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(18, 12.5), 2.2, true, 2.0),
      createNeonRibbonMaterial(0xffffff, 1.05, 0.8)
    );
    this.chargeGroup.add(this.chargeCore, this.chargeRing);
    this.chargeGroup.position.set(29, 0, 0);
    this.chargeGroup.visible = false;
    this.playerGroup.add(this.chargeGroup);

    // Kinetic Self-Cast Armor Cage
    this.armorCage = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(6, 26), 2.6, true, 1.8),
      createNeonRibbonMaterial(0xe8741a, 1.1, 0.9)
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
    const retSegments: Array<[Array<{ x: number; y: number }>, number]> = [
      [[{ x: -10, y: 0 }, { x: -3.5, y: 0 }], 2.0],
      [[{ x: 3.5, y: 0 }, { x: 10, y: 0 }], 2.0],
      [[{ x: 0, y: -10 }, { x: 0, y: -3.5 }], 2.0],
      [[{ x: 0, y: 3.5 }, { x: 0, y: 10 }], 2.0],
    ];
    for (const [pts, w] of retSegments) {
      this.reticleGroup.add(
        new THREE.Mesh(
          buildRibbonGeometry(pts, w, false, 3.0),
          createNeonRibbonMaterial(0x00e5ff, 1.1, 0.9)
        )
      );
    }
    this.scene.add(this.reticleGroup);

    // Click-to-move waypoint marker
    const wpDiamond = [
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      { x: -10, y: 0 },
    ];
    this.waypointGroup.add(
      new THREE.Mesh(
        buildRibbonGeometry(wpDiamond, 2.4, true, 1.8),
        createNeonRibbonMaterial(0x00f5ff, 1.15, 0.9)
      ),
      new THREE.Mesh(
        buildRibbonGeometry(createPolygonPts(16, 15), 2.0, true, 1.4),
        createNeonRibbonMaterial(0x1a6bff, 1.0, 0.65)
      )
    );
    this.waypointGroup.visible = false;
    this.scene.add(this.waypointGroup);

    // Diegetic East Gate Pointer
    const ptrPts = [
      { x: 11, y: 0 },
      { x: -4.5, y: 6.5 },
      { x: -2, y: 0 },
      { x: -4.5, y: -6.5 },
    ];
    this.gatePointer = new THREE.Mesh(
      buildRibbonGeometry(ptrPts, 2.4, true, 16),
      createNeonRibbonMaterial(0x39ff14, 1.25, 0.95)
    );
    this.gatePointer.visible = false;
    this.scene.add(this.gatePointer);
  }

  private replaceArcRibbon(mesh: THREE.Mesh, radius: number, ratio: number, maxSpan: number, width: number, z: number): void {
    const clamped = Math.max(0.02, Math.min(1, ratio));
    const span = maxSpan * clamped;
    mesh.geometry.dispose();
    mesh.geometry = buildRibbonGeometry(createArcPts(radius, span, 26), width, false, z);
  }

  private buildPipMesh(el: QueueElement): THREE.Group {
    const group = new THREE.Group();
    const meta = ELEMENT_META[el];
    const sides =
      el === 'THERMAL' ? 3 :
      el === 'KINETIC' ? 4 :
      el === 'CRYO' || el === 'CRYSTAL' ? 6 :
      el === 'BARRIER' ? 8 : 12;

    const ringPts = createPolygonPts(sides, 7.2, el === 'THERMAL' ? Math.PI / 2 : 0);
    group.add(
      new THREE.Mesh(
        buildRibbonGeometry(ringPts, 2.4, true, 0),
        createNeonRibbonMaterial(meta.colorHex, 1.25, 0.95)
      )
    );

    if (el === 'NANO') {
      group.add(
        new THREE.Mesh(buildRibbonGeometry([{ x: -4.5, y: 0 }, { x: 4.5, y: 0 }], 2.0, false, 0.3), createNeonRibbonMaterial(meta.colorHex, 1.25, 0.95)),
        new THREE.Mesh(buildRibbonGeometry([{ x: 0, y: -4.5 }, { x: 0, y: 4.5 }], 2.0, false, 0.3), createNeonRibbonMaterial(meta.colorHex, 1.25, 0.95))
      );
    } else if (el === 'VOLT') {
      const bolt = [
        { x: 2.2, y: 5.2 },
        { x: -2.2, y: 0.6 },
        { x: 2.2, y: -0.6 },
        { x: -2.2, y: -5.2 },
      ];
      group.add(new THREE.Mesh(buildRibbonGeometry(bolt, 2.0, false, 0.3), createNeonRibbonMaterial(meta.colorHex, 1.25, 0.95)));
    }
    group.add(createGlowSprite(meta.colorHex, 20, 0.2));
    return group;
  }

  public update(snapshot: SimSnapshot, aimWorld: { x: number; y: number }, timeSec: number): void {
    const p = snapshot.player;
    this.playerGroup.position.set(p.x, p.y, 14);
    this.playerGroup.rotation.z = p.aimAngle;

    const activeColor = p.channel
      ? p.channel.composition.primaryColorHex
      : p.charge
      ? p.charge.composition.primaryColorHex
      : p.queue[0]
      ? ELEMENT_META[p.queue[0]].colorHex
      : 0x00f5ff;

    for (const ch of this.shipChevrons) {
      setRibbonColor(ch, activeColor);
    }
    (this.noseTipMesh.material as THREE.MeshBasicMaterial).color.setHex(activeColor).multiplyScalar(1.05);
    this.shipGlow.material.color.setHex(activeColor);
    setRibbonColor(this.rearHaloMesh, activeColor);
    setRibbonColor(this.thrusterMesh, activeColor);

    const isShooting =
      (p.channel !== null && p.channel.delivery !== 'SELF_HEAL') ||
      snapshot.beams.some((b) => b.owner === 'PLAYER') ||
      snapshot.slashes.length > 0;
    this.muzzleSparkle.visible = isShooting;
    if (isShooting) {
      this.muzzleSparkle.rotation.z = timeSec * 16;
      const pulse = 0.72 + Math.sin(timeSec * 45) * 0.25;
      this.muzzleSparkle.scale.set(pulse, pulse, 1);
      for (const child of this.muzzleSparkle.children) {
        if (child instanceof THREE.Mesh) setRibbonColor(child, activeColor);
      }
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

    if (snapshot.gate.open) {
      const ga = Math.atan2(snapshot.gate.y - p.y, snapshot.gate.x - p.x);
      this.gatePointer.visible = true;
      this.gatePointer.position.set(p.x + Math.cos(ga) * 52, p.y + Math.sin(ga) * 52, 0);
      this.gatePointer.rotation.z = ga;
    } else {
      this.gatePointer.visible = false;
    }

    this.thrusterMesh.visible = p.moving || p.dashTimer > 0;
    const thrustScale = p.dashTimer > 0 ? 1.95 : 0.85 + Math.sin(timeSec * 40) * 0.28;
    this.thrusterMesh.scale.set(thrustScale, 1, 1);

    const hpRatio = p.hp / Math.max(1, p.maxHp);
    if (Math.abs(hpRatio - this.lastHullRatio) > 0.015) {
      this.lastHullRatio = hpRatio;
      this.replaceArcRibbon(this.hullArcMesh, 28, hpRatio, Math.PI * 0.95, 2.8, 1.0);
    }
    setRibbonColor(this.hullArcMesh, hpRatio > 0.35 ? 0x39ff14 : 0xff1e2d);

    if (p.wardRemaining > 0) {
      this.wardArcMesh.visible = true;
      const wardRatio = p.wardRemaining / Math.max(0.1, p.wardMaxDuration);
      if (Math.abs(wardRatio - this.lastWardRatio) > 0.015) {
        this.lastWardRatio = wardRatio;
        this.replaceArcRibbon(this.wardArcMesh, 37, wardRatio, Math.PI * 1.05, 3.0, 1.4);
        this.replaceArcRibbon(this.wardInnerArcMesh, 33.5, wardRatio, Math.PI * 1.05, 2.5, 1.6);
      }
      if (p.wardElement) {
        this.wardInnerArcMesh.visible = true;
        setRibbonColor(this.wardInnerArcMesh, ELEMENT_META[p.wardElement].colorHex);
      } else {
        this.wardInnerArcMesh.visible = false;
      }
    } else {
      this.wardArcMesh.visible = false;
      this.wardInnerArcMesh.visible = false;
      this.lastWardRatio = -1;
    }

    if (p.channel) {
      this.channelArcMesh.visible = true;
      setRibbonColor(this.channelArcMesh, p.channel.composition.primaryColorHex);
    } else {
      this.channelArcMesh.visible = false;
    }

    if (p.charge) {
      this.chargeGroup.visible = true;
      const scale = 0.45 + p.charge.ratio * 1.05;
      this.chargeGroup.scale.set(scale, scale, 1);
      this.chargeCore.rotation.z = timeSec * (4 + p.charge.ratio * 10);
      this.chargeRing.rotation.z = -timeSec * 3;
      setRibbonColor(this.chargeCore, p.charge.composition.primaryColorHex);
      setRibbonColor(this.chargeRing, p.charge.composition.secondaryColorHex);
    } else {
      this.chargeGroup.visible = false;
    }

    if (p.armorHp > 0) {
      this.armorCage.visible = true;
      this.armorCage.rotation.z = timeSec * 1.8;
      setShaderUniform(this.armorCage.material, 'uOpacity', 0.45 + (p.armorHp / Math.max(1, p.maxArmorHp)) * 0.55);
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
          this.disposeGroup(child);
        }
        if (el) {
          pip.add(this.buildPipMesh(el));
        }
      }
      if (el) {
        pip.visible = true;
        const offset = (i - (count - 1) * 0.5) * 0.55;
        const pipAngle = p.aimAngle + Math.PI + offset;
        const pulseR = 44 + Math.sin(timeSec * 5 + i) * 1.6;
        pip.position.set(p.x + Math.cos(pipAngle) * pulseR, p.y + Math.sin(pipAngle) * pulseR, 17);
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

      const zHeight = e.archetype === 'WARDEN' ? 22 : 14;
      group.position.set(e.x, e.y, zHeight);
      const hullRot =
        e.archetype === 'SWARMER' || e.archetype === 'SPLITTER'
          ? timeSec * 3.5 + e.id
          : e.angle;
      const bodyGroup = group.userData.bodyGroup as THREE.Group;
      bodyGroup.rotation.z = hullRot;

      // Hit punch recoil
      const punch = 1 + e.hitFlash * 2.1;
      bodyGroup.scale.set(punch, punch, punch);

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

      const baseColor = (group.userData.baseColor as number) ?? 0xff2e97;
      const targetColor = statusColor ?? baseColor;
      const mainObj = bodyGroup.children[0];
      if (mainObj instanceof THREE.Mesh) {
        setRibbonColor(mainObj, targetColor);
      } else if (mainObj instanceof THREE.LineSegments && mainObj.material instanceof THREE.LineBasicMaterial) {
        mainObj.material.color.setHex(targetColor).multiplyScalar(1.15);
      }

      if (e.archetype === 'BASTION') {
        const shieldChild = bodyGroup.userData.frontShield as THREE.Object3D | undefined;
        if (shieldChild) {
          shieldChild.visible = e.hasFrontShield && e.shieldHp > 0;
        }
      }

      if (e.archetype === 'WARDEN') {
        const plates = bodyGroup.userData.bossPlates as THREE.Object3D[] | undefined;
        if (plates) {
          for (let i = 0; i < e.bossShieldAngles.length; i++) {
            const plate = plates[i];
            if (plate) plate.rotation.z = e.bossShieldAngles[i]! - e.angle;
          }
        }
      }

      const telegraph = bodyGroup.userData.telegraph as THREE.Mesh | undefined;
      if (telegraph) {
        telegraph.visible = e.aiState === 'CHARGE';
        if (telegraph.visible) {
          telegraph.rotation.z = e.beamAngle - hullRot;
        }
      }

      // Per-enemy floating HP & Shield bars (always horizontal in world space)
      const hpBar = group.userData.hpBar as THREE.Group;
      const showHp = e.hp < e.maxHp || e.archetype === 'WARDEN' || e.archetype === 'BASTION';
      hpBar.visible = showHp;
      if (showHp) {
        const ratio = Math.max(0.01, e.hp / Math.max(1, e.maxHp));
        const fill = group.userData.hpFill as THREE.Mesh;
        const barW = e.radius * 2.2;
        fill.scale.set(ratio, 1, 1);
        fill.position.x = -barW * 0.5 * (1 - ratio);
        (fill.material as THREE.MeshBasicMaterial).color.setHex(
          ratio > 0.5 ? 0x39ff14 : ratio > 0.25 ? 0xffbb22 : 0xff2244
        );
      }
      const shieldFill = group.userData.shieldFill as THREE.Mesh | undefined;
      if (shieldFill) {
        shieldFill.visible = e.hasFrontShield && e.shieldHp > 0;
        if (shieldFill.visible) {
          const sRatio = Math.max(0.01, e.shieldHp / Math.max(1, e.maxShieldHp));
          const barW = e.radius * 2.2;
          shieldFill.scale.set(sRatio, 1, 1);
          shieldFill.position.x = -barW * 0.5 * (1 - sRatio);
        }
      }

      // Diegetic status effect visuals
      (group.userData.frozenShell as THREE.Object3D).visible = Boolean(e.statuses.FROZEN);
      const fireAura = group.userData.ignitedAura as THREE.Object3D;
      fireAura.visible = Boolean(e.statuses.IGNITED);
      if (fireAura.visible) {
        const s = 0.92 + Math.sin(timeSec * 18 + e.id) * 0.14;
        fireAura.scale.set(s, s, 1);
      }
      const primedRing = group.userData.primedRing as THREE.Object3D;
      primedRing.visible = Boolean(e.statuses.PRIMED);
      if (primedRing.visible) {
        const pScale = 0.9 + ((timeSec * 2.2 + e.id * 0.3) % 1) * 0.35;
        primedRing.scale.set(pScale, pScale, 1);
      }
      (group.userData.chilledRing as THREE.Object3D).visible = Boolean(e.statuses.CHILLED && !e.statuses.FROZEN);
      const corruptRing = group.userData.corruptRing as THREE.Object3D;
      corruptRing.visible = Boolean(e.statuses.CORRUPTED);
      if (corruptRing.visible) {
        corruptRing.rotation.z = timeSec * 4;
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
    const root = new THREE.Group();
    const zHeight = e.archetype === 'WARDEN' ? 22 : 14;
    const r = e.radius;

    // Ground altitude shadow ring
    root.add(
      new THREE.Mesh(
        buildRibbonGeometry(createPolygonPts(18, r * 0.95), 2.0, true, -zHeight + 0.6),
        createNeonRibbonMaterial(0x004477, 0.7, 0.32)
      )
    );

    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);
    root.userData.bodyGroup = bodyGroup;

    let baseColor = 0xff2e97;

    if (e.archetype === 'SWARMER') {
      baseColor = 0xff2e97;
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rad = i % 2 === 0 ? r : r * 0.42;
        pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
      }
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(pts, 2.6, true, 0), createNeonRibbonMaterial(baseColor, 1.2, 0.95)));
      // 3D Octahedron center gem
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(r * 0.45, 0),
        new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending })
      );
      bodyGroup.add(core);
      bodyGroup.add(createGlowSprite(baseColor, r * 2.4, 0.22));
    } else if (e.archetype === 'BASTION') {
      baseColor = 0xe6f0ff;
      const hexPts = createPolygonPts(6, r);
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(hexPts, 3.0, true, 0), createNeonRibbonMaterial(baseColor, 1.15, 0.95)));
      const cyl = new THREE.CylinderGeometry(r * 0.72, r * 0.85, 16, 6, 1);
      cyl.rotateX(Math.PI / 2);
      bodyGroup.add(
        new THREE.Mesh(
          cyl,
          new THREE.MeshBasicMaterial({ color: 0x1a2a44, transparent: true, opacity: 0.85 })
        )
      );
      const arcPts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= 16; i++) {
        const a = -e.shieldArc + (i / 16) * e.shieldArc * 2;
        arcPts.push({ x: Math.cos(a) * (r + 10), y: Math.sin(a) * (r + 10) });
      }
      const frontShield = new THREE.Mesh(
        buildRibbonGeometry(arcPts, 3.8, false, 2),
        createNeonRibbonMaterial(0x00f5ff, 1.25, 0.95)
      );
      bodyGroup.add(frontShield);
      bodyGroup.userData.frontShield = frontShield;
      bodyGroup.add(createGlowSprite(0x00f5ff, r * 2.4, 0.2));
    } else if (e.archetype === 'STALKER') {
      baseColor = 0x00f5ff;
      const pts = [
        { x: r * 1.25, y: 0 },
        { x: 0, y: r * 0.85 },
        { x: -r * 1.25, y: 0 },
        { x: 0, y: -r * 0.85 },
      ];
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(pts, 2.8, true, 0.5), createNeonRibbonMaterial(baseColor, 1.2, 0.95)));
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(createPolygonPts(18, r * 1.25), 2.0, true, -1), createNeonRibbonMaterial(baseColor, 1.05, 0.65)));
      bodyGroup.add(createGlowSprite(baseColor, r * 2.4, 0.22));
    } else if (e.archetype === 'WEAVER') {
      baseColor = 0xb429ff;
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(createPolygonPts(8, r), 2.8, true, 0), createNeonRibbonMaterial(baseColor, 1.15, 0.95)));
      const tri = [
        { x: r * 0.75, y: 0 },
        { x: -r * 0.45, y: r * 0.65 },
        { x: -r * 0.45, y: -r * 0.65 },
      ];
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(tri, 2.4, true, 2), createNeonRibbonMaterial(0xff5e99, 1.2, 0.95)));
      bodyGroup.add(createGlowSprite(baseColor, r * 2.5, 0.22));
      const tele = new THREE.Mesh(
        buildRibbonGeometry([{ x: 0, y: 0 }, { x: 580, y: 0 }], 2.4, false, 0.5),
        createNeonRibbonMaterial(0xb429ff, 1.15, 0.6)
      );
      tele.visible = false;
      bodyGroup.add(tele);
      bodyGroup.userData.telegraph = tele;
    } else if (e.archetype === 'SPLITTER') {
      baseColor = 0xe8741a;
      const box = new THREE.BoxGeometry(r * 1.45, r * 1.45, r * 1.45, 2, 2, 2);
      bodyGroup.add(
        new THREE.LineSegments(
          new THREE.WireframeGeometry(box),
          new THREE.LineBasicMaterial({ color: new THREE.Color(baseColor).multiplyScalar(1.15) })
        )
      );
      box.dispose();
      const innerR = r * 0.55;
      const inner = [
        { x: 0, y: innerR },
        { x: innerR, y: 0 },
        { x: 0, y: -innerR },
        { x: -innerR, y: 0 },
      ];
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(inner, 2.4, true, 2), createNeonRibbonMaterial(0xb429ff, 1.2, 0.95)));
      bodyGroup.add(createGlowSprite(baseColor, r * 2.4, 0.22));
    } else {
      // WARDEN Boss
      baseColor = 0xff2e97;
      bodyGroup.add(new THREE.Mesh(buildRibbonGeometry(createPolygonPts(12, r), 3.6, true, 0), createNeonRibbonMaterial(baseColor, 1.25, 0.98)));
      const bossPlates: THREE.Object3D[] = [];
      for (let p = 0; p < 3; p++) {
        const platePts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i <= 10; i++) {
          const a = -0.45 + (i / 10) * 0.9;
          platePts.push({ x: Math.cos(a) * (r + 14), y: Math.sin(a) * (r + 14) });
        }
        const plate = new THREE.Mesh(buildRibbonGeometry(platePts, 3.8, false, 3), createNeonRibbonMaterial(0xe6f0ff, 1.25, 0.98));
        bodyGroup.add(plate);
        bossPlates.push(plate);
      }
      bodyGroup.userData.bossPlates = bossPlates;
      bodyGroup.add(createGlowSprite(baseColor, r * 2.8, 0.26));
      const tele = new THREE.Mesh(
        buildRibbonGeometry([{ x: 0, y: 0 }, { x: 620, y: 0 }], 2.8, false, 1),
        createNeonRibbonMaterial(0xff2e97, 1.15, 0.65)
      );
      tele.visible = false;
      bodyGroup.add(tele);
      bodyGroup.userData.telegraph = tele;
    }

    // Floating HP + Shield Bar (horizontal in world coordinates)
    const hpBar = new THREE.Group();
    const barW = r * 2.2;
    const barH = e.archetype === 'WARDEN' ? 6 : 4;
    hpBar.position.set(0, r + 15, 10);
    hpBar.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(barW + 2, barH + 2),
        new THREE.MeshBasicMaterial({ color: 0x050814, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
      )
    );
    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, barH),
      new THREE.MeshBasicMaterial({ color: 0x39ff14, side: THREE.DoubleSide })
    );
    hpFill.position.z = 0.5;
    hpBar.add(hpFill);

    if (e.archetype === 'BASTION') {
      const shieldFill = new THREE.Mesh(
        new THREE.PlaneGeometry(barW, 3),
        new THREE.MeshBasicMaterial({ color: 0x00f5ff, side: THREE.DoubleSide })
      );
      shieldFill.position.set(0, 6, 0.5);
      hpBar.add(shieldFill);
      root.userData.shieldFill = shieldFill;
    }

    hpBar.visible = e.archetype === 'WARDEN' || e.archetype === 'BASTION';
    root.add(hpBar);
    root.userData.hpBar = hpBar;
    root.userData.hpFill = hpFill;

    // Diegetic Status Indicator Meshes
    const iceGeo = new THREE.OctahedronGeometry(r * 1.38, 0);
    const frozenShell = new THREE.Group();
    frozenShell.add(
      new THREE.LineSegments(new THREE.WireframeGeometry(iceGeo), new THREE.LineBasicMaterial({ color: 0x80ffff })),
      new THREE.Mesh(
        iceGeo,
        new THREE.MeshBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending })
      )
    );
    frozenShell.visible = false;
    root.add(frozenShell);
    root.userData.frozenShell = frozenShell;

    const ignitedAura = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(14, r * 1.25), 3.0, true, 3),
      createNeonRibbonMaterial(0xff4518, 1.25, 0.9)
    );
    ignitedAura.visible = false;
    root.add(ignitedAura);
    root.userData.ignitedAura = ignitedAura;

    const primedRing = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(20, r * 1.3), 2.4, true, -zHeight + 1.2),
      createNeonRibbonMaterial(0x1a88ff, 1.2, 0.85)
    );
    primedRing.visible = false;
    root.add(primedRing);
    root.userData.primedRing = primedRing;

    const chilledRing = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(12, r * 1.25), 2.0, true, -zHeight + 1.4),
      createNeonRibbonMaterial(0x66ffff, 1.05, 0.78)
    );
    chilledRing.visible = false;
    root.add(chilledRing);
    root.userData.chilledRing = chilledRing;

    const corruptRing = new THREE.Mesh(
      buildRibbonGeometry(createPolygonPts(6, r * 1.28), 2.4, true, 2),
      createNeonRibbonMaterial(0x39ff14, 1.2, 0.88)
    );
    corruptRing.visible = false;
    root.add(corruptRing);
    root.userData.corruptRing = corruptRing;

    root.userData.baseColor = baseColor;
    return root;
  }

  private disposeGroup(root: THREE.Object3D): void {
    root.traverse((child) => {
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
}

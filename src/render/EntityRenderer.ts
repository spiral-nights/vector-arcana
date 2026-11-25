import * as THREE from 'three';
import { computeBlockedRayLength } from '../sim/ArenaGeometry';
import { getShipDef } from '../sim/Ships';
import { ELEMENT_META, EnemyEntity, QueueElement, ShipId, SimSnapshot } from '../sim/types';
import { createGlowSprite } from './GlowUtil';
import { buildRibbonGeometry, createNeonRibbonMaterial, setShaderUniform } from './NeonShaders';

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
  private readonly playerHullGroup = new THREE.Group();
  private currentShipId: ShipId | null = null;
  private shipChevrons: THREE.Mesh[] = [];
  private noseTipMesh!: THREE.Mesh;
  private readonly shipGlow: THREE.Sprite;
  private readonly muzzleSparkle: THREE.Group;
  private thrusterMesh!: THREE.Mesh;
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

    this.playerGroup.add(this.playerHullGroup);
    this.rebuildPlayerHull('VANGUARD');

    this.shipGlow = createGlowSprite(0x00f5ff, 38, 0.16);
    this.playerGroup.add(this.shipGlow);

    // Crisp 4-point muzzle sparkle ONLY when actively shooting
    this.muzzleSparkle = new THREE.Group();
    this.muzzleSparkle.add(
      new THREE.Mesh(
        buildRibbonGeometry([{ x: -7, y: 0 }, { x: 7, y: 0 }], 1.6, false, 4.4),
        createNeonRibbonMaterial(0xffffff, 1.35, 0.9)
      ),
      new THREE.Mesh(
        buildRibbonGeometry([{ x: 0, y: -7 }, { x: 0, y: 7 }], 1.6, false, 4.4),
        createNeonRibbonMaterial(0xffffff, 1.35, 0.9)
      )
    );
    this.muzzleSparkle.position.set(26, 0, 0);
    this.muzzleSparkle.visible = false;
    this.playerGroup.add(this.muzzleSparkle);

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
      createNeonRibbonMaterial(ELEMENT_META.KINETIC.colorHex, 1.2, 0.95)
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
      createNeonRibbonMaterial(ELEMENT_META.KINETIC.colorHex, 1.1, 0.9)
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

  private rebuildPlayerHull(shipId: ShipId): void {
    this.currentShipId = shipId;
    while (this.playerHullGroup.children.length > 0) {
      const child = this.playerHullGroup.children[0]!;
      this.playerHullGroup.remove(child);
      this.disposeGroup(child);
    }
    this.shipChevrons = [];

    const shipDef = getShipDef(shipId);
    const baseHex = shipDef.colorHex;
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x0f2038,
      emissive: baseHex,
      emissiveIntensity: 0.28,
      roughness: 0.36,
      metalness: 0.48,
    });

    if (shipId === 'SPECTRE') {
      // Twin-prong high-speed swept needle interceptor
      const shape = new THREE.Shape();
      shape.moveTo(27, 3.2);
      shape.lineTo(8, 5.2);
      shape.lineTo(-16, 20);
      shape.lineTo(-10, 4);
      shape.lineTo(-15, 0);
      shape.lineTo(-10, -4);
      shape.lineTo(-16, -20);
      shape.lineTo(8, -5.2);
      shape.lineTo(27, -3.2);
      shape.lineTo(14, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 6.5, bevelEnabled: false });
      geo.translate(0, 0, -6.2);
      this.playerHullGroup.add(new THREE.Mesh(geo, hullMat));

      const outerPts = [
        { x: 27, y: 3.2 },
        { x: -16, y: 20 },
        { x: -11, y: 0 },
        { x: -16, y: -20 },
        { x: 27, y: -3.2 },
        { x: 14, y: 0 },
      ];
      const innerPts = [
        { x: 16, y: 0 },
        { x: -9, y: 11.5 },
        { x: -5, y: 0 },
        { x: -9, y: -11.5 },
      ];
      for (const def of [
        { pts: outerPts, w: 2.6, z: 1.0 },
        { pts: innerPts, w: 2.0, z: 2.8 },
      ]) {
        const ribbon = new THREE.Mesh(buildRibbonGeometry(def.pts, def.w, true, def.z), createNeonRibbonMaterial(baseHex, 1.2, 1.0));
        this.shipChevrons.push(ribbon);
        this.playerHullGroup.add(ribbon);
      }
      const tipGeo = new THREE.BufferGeometry();
      tipGeo.setAttribute('position', new THREE.Float32BufferAttribute([27, 0, 3.6, 13, 4.5, 3.2, 13, -4.5, 3.2], 3));
      this.noseTipMesh = new THREE.Mesh(
        tipGeo,
        new THREE.MeshBasicMaterial({ color: baseHex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      this.playerHullGroup.add(this.noseTipMesh);
      this.thrusterMesh = new THREE.Mesh(
        buildRibbonGeometry([{ x: -13, y: 6.5 }, { x: -30, y: 2.5 }, { x: -16, y: 0 }, { x: -30, y: -2.5 }, { x: -13, y: -6.5 }], 2.4, false, 0.5),
        createNeonRibbonMaterial(baseHex, 1.2, 0.95)
      );
      this.playerHullGroup.add(this.thrusterMesh);
    } else if (shipId === 'TITAN') {
      // Heavy armored hexagonal juggernaut with wide shield sponsons
      const shape = new THREE.Shape();
      shape.moveTo(22, 7.5);
      shape.lineTo(10, 18.5);
      shape.lineTo(-14, 18.5);
      shape.lineTo(-18, 9);
      shape.lineTo(-18, -9);
      shape.lineTo(-14, -18.5);
      shape.lineTo(10, -18.5);
      shape.lineTo(22, -7.5);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 9.5, bevelEnabled: false });
      geo.translate(0, 0, -7.5);
      this.playerHullGroup.add(new THREE.Mesh(geo, hullMat));

      const outerPts = [
        { x: 22, y: 7.5 },
        { x: 10, y: 18.5 },
        { x: -14, y: 18.5 },
        { x: -18, y: 9 },
        { x: -18, y: -9 },
        { x: -14, y: -18.5 },
        { x: 10, y: -18.5 },
        { x: 22, y: -7.5 },
      ];
      const innerPts = [
        { x: 14, y: 5 },
        { x: 4, y: 11.5 },
        { x: -10, y: 11.5 },
        { x: -10, y: -11.5 },
        { x: 4, y: -11.5 },
        { x: 14, y: -5 },
      ];
      for (const def of [
        { pts: outerPts, w: 3.2, z: 2.2 },
        { pts: innerPts, w: 2.4, z: 3.6 },
      ]) {
        const ribbon = new THREE.Mesh(buildRibbonGeometry(def.pts, def.w, true, def.z), createNeonRibbonMaterial(baseHex, 1.2, 1.0));
        this.shipChevrons.push(ribbon);
        this.playerHullGroup.add(ribbon);
      }
      const tipGeo = new THREE.BufferGeometry();
      tipGeo.setAttribute('position', new THREE.Float32BufferAttribute([23, 0, 4.0, 12, 7.2, 3.6, 12, -7.2, 3.6], 3));
      this.noseTipMesh = new THREE.Mesh(
        tipGeo,
        new THREE.MeshBasicMaterial({ color: baseHex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      this.playerHullGroup.add(this.noseTipMesh);
      this.thrusterMesh = new THREE.Mesh(
        buildRibbonGeometry([{ x: -16, y: 8 }, { x: -30, y: 4 }, { x: -24, y: 0 }, { x: -30, y: -4 }, { x: -16, y: -8 }], 3.0, false, 0.8),
        createNeonRibbonMaterial(baseHex, 1.25, 0.95)
      );
      this.playerHullGroup.add(this.thrusterMesh);
    } else if (shipId === 'PRISM') {
      // Crystalline diamond-wing conduit with floating central hex resonator
      const shape = new THREE.Shape();
      shape.moveTo(26, 0);
      shape.lineTo(2, 17);
      shape.lineTo(-16, 10);
      shape.lineTo(-12, 0);
      shape.lineTo(-16, -10);
      shape.lineTo(2, -17);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false });
      geo.translate(0, 0, -6.5);
      this.playerHullGroup.add(new THREE.Mesh(geo, hullMat));

      const outerPts = [
        { x: 26, y: 0 },
        { x: 2, y: 17 },
        { x: -16, y: 10 },
        { x: -12, y: 0 },
        { x: -16, y: -10 },
        { x: 2, y: -17 },
      ];
      const hexPts = createPolygonPts(6, 7.5, 0);
      for (const def of [
        { pts: outerPts, w: 2.8, z: 1.2 },
        { pts: hexPts, w: 2.2, z: 3.8 },
      ]) {
        const ribbon = new THREE.Mesh(buildRibbonGeometry(def.pts, def.w, true, def.z), createNeonRibbonMaterial(baseHex, 1.2, 1.0));
        this.shipChevrons.push(ribbon);
        this.playerHullGroup.add(ribbon);
      }
      const tipGeo = new THREE.BufferGeometry();
      tipGeo.setAttribute('position', new THREE.Float32BufferAttribute([26, 0, 3.8, 10, 6.2, 3.2, 10, -6.2, 3.2], 3));
      this.noseTipMesh = new THREE.Mesh(
        tipGeo,
        new THREE.MeshBasicMaterial({ color: baseHex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      this.playerHullGroup.add(this.noseTipMesh);
      this.thrusterMesh = new THREE.Mesh(
        buildRibbonGeometry([{ x: -12, y: 5 }, { x: -29, y: 0 }, { x: -12, y: -5 }], 2.6, false, 0.5),
        createNeonRibbonMaterial(baseHex, 1.2, 0.95)
      );
      this.playerHullGroup.add(this.thrusterMesh);
    } else {
      // VANGUARD: Triple-chevron delta interceptor
      const shape = new THREE.Shape();
      shape.moveTo(25, 0);
      shape.lineTo(-15, 16.5);
      shape.lineTo(-9, 0);
      shape.lineTo(-15, -16.5);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false });
      geo.translate(0, 0, -6.5);
      this.playerHullGroup.add(new THREE.Mesh(geo, hullMat));

      const chevronDefs: Array<{ pts: Array<{ x: number; y: number }>; width: number; z: number; boost: number }> = [
        { pts: [{ x: 25, y: 0 }, { x: -15, y: 16.5 }, { x: -9, y: 0 }, { x: -15, y: -16.5 }], width: 2.8, z: 1.0, boost: 1.2 },
        { pts: [{ x: 16.5, y: 0 }, { x: -11, y: 11 }, { x: -6, y: 0 }, { x: -11, y: -11 }], width: 2.2, z: 2.4, boost: 1.1 },
        { pts: [{ x: 9.5, y: 0 }, { x: -7, y: 6.5 }, { x: -3, y: 0 }, { x: -7, y: -6.5 }], width: 1.8, z: 3.8, boost: 1.0 },
      ];
      for (const def of chevronDefs) {
        const ribbon = new THREE.Mesh(
          buildRibbonGeometry(def.pts, def.width, true, def.z),
          createNeonRibbonMaterial(baseHex, def.boost, 1.0)
        );
        this.shipChevrons.push(ribbon);
        this.playerHullGroup.add(ribbon);
      }

      const tipGeo = new THREE.BufferGeometry();
      tipGeo.setAttribute('position', new THREE.Float32BufferAttribute([26, 0, 4.0, 11, 5.2, 3.5, 11, -5.2, 3.5], 3));
      this.noseTipMesh = new THREE.Mesh(
        tipGeo,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(baseHex).multiplyScalar(1.05),
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      );
      this.playerHullGroup.add(this.noseTipMesh);

      this.thrusterMesh = new THREE.Mesh(
        buildRibbonGeometry([{ x: -12, y: 4.5 }, { x: -28, y: 0 }, { x: -12, y: -4.5 }], 2.6, false, 0.5),
        createNeonRibbonMaterial(baseHex, 1.2, 0.95)
      );
      this.playerHullGroup.add(this.thrusterMesh);
    }
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

    if (el === 'VOID') {
      const coreDisk = new THREE.Mesh(
        new THREE.CircleGeometry(6.6, 16),
        new THREE.MeshBasicMaterial({ color: 0x060408 })
      );
      coreDisk.position.z = -0.2;
      group.add(coreDisk);
    } else if (el === 'NANO') {
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
    if (snapshot.shipId !== this.currentShipId) {
      this.rebuildPlayerHull(snapshot.shipId);
    }
    const p = snapshot.player;
    this.playerGroup.position.set(p.x, p.y, 14);
    this.playerGroup.rotation.z = p.aimAngle;

    const shipDef = getShipDef(snapshot.shipId);
    const isHurt = p.invulnTimer > 0 && p.dashTimer <= 0;
    const isHurtFlash = isHurt && p.invulnTimer > 0.48;
    const activeColor = isHurtFlash
      ? Math.sin(timeSec * 60) > 0
        ? 0xffffff
        : 0xff1e2d
      : p.channel
      ? p.channel.composition.primaryColorHex
      : p.charge
      ? p.charge.composition.primaryColorHex
      : p.queue[0]
      ? ELEMENT_META[p.queue[0]].colorHex
      : shipDef.colorHex;

    for (const ch of this.shipChevrons) {
      setRibbonColor(ch, activeColor);
    }
    (this.noseTipMesh.material as THREE.MeshBasicMaterial).color.setHex(activeColor).multiplyScalar(1.05);
    this.shipGlow.material.color.setHex(activeColor);
    if (isHurtFlash) {
      this.shipGlow.scale.set(58, 58, 1);
      this.shipGlow.material.opacity = 0.45;
    } else {
      this.shipGlow.scale.set(38, 38, 1);
      this.shipGlow.material.opacity = 0.16;
    }
    this.playerHullGroup.visible = !isHurt || p.invulnTimer > 0.48 || Math.sin(timeSec * 48) > -0.35;
    setRibbonColor(this.rearHaloMesh, activeColor);
    setRibbonColor(this.thrusterMesh, activeColor);

    const isShooting =
      p.channel !== null ||
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

    this.syncEnemies(snapshot, timeSec);
  }

  private makeTelegraphGroup(colorHex: number, width: number): THREE.Group {
    const g = new THREE.Group();
    const line = new THREE.Mesh(
      buildRibbonGeometry([{ x: 0, y: 0 }, { x: 1, y: 0 }], width, false, 0.8),
      createNeonRibbonMaterial(colorHex, 1.2, 0.72)
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(width * 2.2, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
    );
    dot.position.z = 1.6;
    g.add(line, dot);
    g.visible = false;
    return g;
  }

  private syncEnemies(snapshot: SimSnapshot, timeSec: number): void {
    const enemies = snapshot.enemies;
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
      const hullRot = e.angle;
      const bodyGroup = group.userData.bodyGroup as THREE.Group;
      bodyGroup.rotation.z = hullRot;

      const punch = 1 + e.hitFlash * 2.1;
      bodyGroup.scale.set(punch, punch, punch);

      const statusColor = e.hitFlash > 0
        ? 0xffffff
        : e.statuses.FROZEN
        ? 0x00f5ff
        : e.statuses.IGNITED
        ? ELEMENT_META.THERMAL.colorHex
        : e.statuses.PRIMED
        ? 0x1a6bff
        : e.nanoMarkTimer > 0
        ? 0x39ff14
        : null;

      const baseColor = (group.userData.baseColor as number) ?? 0xff2e97;
      const targetColor = statusColor ?? baseColor;

      // Solid opaque hull emissive feedback on hit / status
      const hullMat = group.userData.hullMat as THREE.MeshStandardMaterial | undefined;
      if (hullMat) {
        if (e.hitFlash > 0) {
          hullMat.emissive.setHex(0xffffff);
          hullMat.emissiveIntensity = 1.65;
        } else {
          hullMat.emissive.setHex(targetColor);
          hullMat.emissiveIntensity = statusColor ? 0.55 : 0.32;
        }
      }

      const trimObj = group.userData.trimObj as THREE.Mesh | undefined;
      if (trimObj) {
        setRibbonColor(trimObj, targetColor);
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
          for (let i = 0; i < plates.length; i++) {
            const plate = plates[i];
            if (!plate) continue;
            plate.visible = i < e.bossShieldAngles.length;
            if (plate.visible) {
              plate.rotation.z = e.bossShieldAngles[i]! - e.angle;
            }
          }
        }
      }

      const telegraphs = bodyGroup.userData.telegraphs as THREE.Group[] | undefined;
      if (telegraphs && telegraphs.length > 0) {
        const showTele = e.aiState === 'CHARGE';
        const offsets =
          e.archetype === 'WARDEN'
            ? (e.bossPhase ?? 1) === 3
              ? [-0.38, 0, 0.38]
              : (e.bossPhase ?? 1) === 2
              ? [-0.26, 0.26]
              : [0]
            : [0];
        const maxLen = e.archetype === 'WARDEN' ? 1900 : 1850;
        const pulseOp = 0.55 + Math.sin(timeSec * 28) * 0.25;
        for (let ti = 0; ti < telegraphs.length; ti++) {
          const tg = telegraphs[ti]!;
          if (showTele && ti < offsets.length) {
            const rayAngle = e.beamAngle + offsets[ti]!;
            const len = computeBlockedRayLength(e.x, e.y, rayAngle, maxLen, snapshot);
            tg.visible = true;
            tg.rotation.z = rayAngle - hullRot;
            const lineMesh = tg.children[0] as THREE.Mesh;
            const dotMesh = tg.children[1] as THREE.Mesh;
            lineMesh.scale.set(len, 1, 1);
            dotMesh.position.set(len, 0, 1.6);
            setShaderUniform(lineMesh.material, 'uOpacity', pulseOp);
          } else {
            tg.visible = false;
          }
        }
      }

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
      corruptRing.visible = e.nanoMarkTimer > 0;
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
    let hullMat: THREE.MeshStandardMaterial;
    let trimObj: THREE.Mesh;

    if (e.archetype === 'SWARMER') {
      // Sleek twin-wing interceptor fighter
      baseColor = 0xff2e97;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x5c0e38,
        emissive: baseColor,
        emissiveIntensity: 0.35,
        roughness: 0.35,
        metalness: 0.35,
      });
      const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, r * 2.0, 4), hullMat);
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = r * 0.15;
      bodyGroup.add(nose);

      const wingGeo = new THREE.BoxGeometry(r * 0.72, r * 1.95, 3);
      const wingMesh = new THREE.Mesh(wingGeo, hullMat);
      wingMesh.position.x = -r * 0.25;
      bodyGroup.add(wingMesh);

      const shipPts = [
        { x: r * 1.25, y: 0 },
        { x: -r * 0.15, y: r * 0.48 },
        { x: -r * 0.85, y: r * 1.05 },
        { x: -r * 0.55, y: 0 },
        { x: -r * 0.85, y: -r * 1.05 },
        { x: -r * 0.15, y: -r * 0.48 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(shipPts, 2.3, true, 4.5), createNeonRibbonMaterial(baseColor, 1.2, 0.95));
      bodyGroup.add(trimObj, createGlowSprite(baseColor, r * 2.1, 0.18));
    } else if (e.archetype === 'BASTION') {
      // Armored Cryo dreadnought frigate with twin forward gun barrels & cyan prow shield
      baseColor = 0xe6f0ff;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x264466,
        emissive: 0x00a8dd,
        emissiveIntensity: 0.32,
        roughness: 0.45,
        metalness: 0.55,
      });
      const hull = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r * 1.15, 14), hullMat);
      hull.position.x = -r * 0.1;
      const prow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.7, r * 1.55, 12), hullMat);
      prow.position.x = r * 0.35;
      bodyGroup.add(hull, prow);
      for (const side of [-1, 1]) {
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(r * 0.85, r * 0.22, 6), hullMat);
        barrel.position.set(r * 0.75, side * r * 0.48, 3);
        bodyGroup.add(barrel);
      }

      const shipPts = [
        { x: r * 0.88, y: r * 0.78 },
        { x: -r * 0.3, y: r * 0.88 },
        { x: -r * 0.95, y: r * 0.52 },
        { x: -r * 0.95, y: -r * 0.52 },
        { x: -r * 0.3, y: -r * 0.88 },
        { x: r * 0.88, y: -r * 0.78 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(shipPts, 2.8, true, 9.5), createNeonRibbonMaterial(baseColor, 1.15, 0.95));
      bodyGroup.add(trimObj);

      const arcPts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= 16; i++) {
        const a = -e.shieldArc + (i / 16) * e.shieldArc * 2;
        arcPts.push({ x: Math.cos(a) * (r + 10), y: Math.sin(a) * (r + 10) });
      }
      const frontShield = new THREE.Mesh(
        buildRibbonGeometry(arcPts, 4.2, false, 4),
        createNeonRibbonMaterial(0x00f5ff, 1.25, 0.95)
      );
      bodyGroup.add(frontShield);
      bodyGroup.userData.frontShield = frontShield;
      bodyGroup.add(createGlowSprite(0x00f5ff, r * 2.2, 0.18));
    } else if (e.archetype === 'STALKER') {
      // Swept-wing stealth Cryo interceptor
      baseColor = 0x00f5ff;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x0a3d4d,
        emissive: baseColor,
        emissiveIntensity: 0.35,
        roughness: 0.35,
        metalness: 0.45,
      });
      const fuse = new THREE.Mesh(new THREE.ConeGeometry(r * 0.46, r * 2.4, 4), hullMat);
      fuse.rotation.z = -Math.PI / 2;
      bodyGroup.add(fuse);
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 0.32, 4), hullMat);
        wing.position.set(-r * 0.35, side * r * 0.65, 0);
        wing.rotation.z = side * -0.42;
        bodyGroup.add(wing);
      }

      const shipPts = [
        { x: r * 1.35, y: 0 },
        { x: -r * 0.2, y: r * 0.36 },
        { x: -r * 1.05, y: r * 1.0 },
        { x: -r * 0.5, y: 0 },
        { x: -r * 1.05, y: -r * 1.0 },
        { x: -r * 0.2, y: -r * 0.36 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(shipPts, 2.6, true, 5), createNeonRibbonMaterial(baseColor, 1.2, 0.95));
      bodyGroup.add(trimObj, createGlowSprite(baseColor, r * 2.2, 0.2));
    } else if (e.archetype === 'PYRO_SPRAYER') {
      // Blazing Thermal orange twin-nozzle flamethrower gunship (weak to CRYO)
      baseColor = ELEMENT_META.THERMAL.colorHex;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x5c2208,
        emissive: baseColor,
        emissiveIntensity: 0.42,
        roughness: 0.4,
        metalness: 0.4,
      });
      const core = new THREE.Mesh(new THREE.BoxGeometry(r * 1.45, r * 1.2, 12), hullMat);
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.34, r * 0.34, r * 1.2, 8),
        new THREE.MeshStandardMaterial({ color: 0xffaa22, emissive: 0xff6a00, emissiveIntensity: 0.75 })
      );
      tank.rotation.z = Math.PI / 2;
      tank.position.set(-r * 0.15, 0, 7);
      bodyGroup.add(core, tank);
      for (const side of [-1, 1]) {
        const nozzle = new THREE.Mesh(new THREE.BoxGeometry(r * 0.95, r * 0.28, 7), hullMat);
        nozzle.position.set(r * 0.65, side * r * 0.45, 2);
        bodyGroup.add(nozzle);
      }

      const shipPts = [
        { x: r * 1.15, y: r * 0.55 },
        { x: r * 0.65, y: r * 0.95 },
        { x: -r * 0.85, y: r * 0.78 },
        { x: -r * 0.55, y: 0 },
        { x: -r * 0.85, y: -r * 0.78 },
        { x: r * 0.65, y: -r * 0.95 },
        { x: r * 1.15, y: -r * 0.55 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(shipPts, 2.8, true, 8), createNeonRibbonMaterial(baseColor, 1.25, 0.95));
      bodyGroup.add(trimObj, createGlowSprite(baseColor, r * 2.4, 0.24));
    } else if (e.archetype === 'GEO_BOMBER') {
      // Heavy Kinetic brown industrial rock bomber with forward catapult rails (weak to VOLT)
      baseColor = ELEMENT_META.KINETIC.colorHex;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x3b2414,
        emissive: baseColor,
        emissiveIntensity: 0.38,
        roughness: 0.5,
        metalness: 0.45,
      });
      const barge = new THREE.Mesh(new THREE.BoxGeometry(r * 1.5, r * 1.4, 14), hullMat);
      barge.position.x = -r * 0.15;
      const boulder = new THREE.Mesh(
        new THREE.DodecahedronGeometry(r * 0.42, 0),
        new THREE.MeshStandardMaterial({ color: 0x6b3e1e, emissive: 0xffaa44, emissiveIntensity: 0.55 })
      );
      boulder.position.set(r * 0.35, 0, 8);
      bodyGroup.add(barge, boulder);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 0.22, 8), hullMat);
        rail.position.set(r * 0.65, side * r * 0.55, 3);
        bodyGroup.add(rail);
      }

      const shipPts = [
        { x: r * 1.2, y: r * 0.65 },
        { x: r * 0.3, y: r * 0.95 },
        { x: -r * 0.95, y: r * 0.88 },
        { x: -r * 0.95, y: -r * 0.88 },
        { x: r * 0.3, y: -r * 0.95 },
        { x: r * 1.2, y: -r * 0.65 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(shipPts, 2.8, true, 9), createNeonRibbonMaterial(baseColor, 1.2, 0.95));
      bodyGroup.add(trimObj, createGlowSprite(baseColor, r * 2.4, 0.22));
    } else if (e.archetype === 'WEAVER') {
      // Elongated Void violet twin-rail beam cruiser (weak to NANO)
      baseColor = 0xb429ff;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x2d114d,
        emissive: baseColor,
        emissiveIntensity: 0.38,
        roughness: 0.4,
        metalness: 0.35,
      });
      const fuse = new THREE.Mesh(new THREE.BoxGeometry(r * 1.65, r * 0.85, 13), hullMat);
      bodyGroup.add(fuse);
      for (const side of [-1, 1]) {
        const prong = new THREE.Mesh(new THREE.BoxGeometry(r * 1.25, r * 0.22, 7), hullMat);
        prong.position.set(r * 0.65, side * r * 0.45, 3);
        bodyGroup.add(prong);
      }

      const shipPts = [
        { x: r * 1.35, y: r * 0.45 },
        { x: r * 0.2, y: r * 0.88 },
        { x: -r * 1.05, y: r * 0.68 },
        { x: -r * 0.7, y: 0 },
        { x: -r * 1.05, y: -r * 0.68 },
        { x: r * 0.2, y: -r * 0.88 },
        { x: r * 1.35, y: -r * 0.45 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(shipPts, 2.8, true, 8.5), createNeonRibbonMaterial(baseColor, 1.15, 0.95));
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(r * 0.38, 16, 4),
        new THREE.MeshStandardMaterial({ color: 0xff5e99, emissive: 0xff5e99, emissiveIntensity: 0.55 })
      );
      spire.rotation.x = Math.PI / 2;
      spire.position.z = 11;
      bodyGroup.add(trimObj, spire, createGlowSprite(baseColor, r * 2.4, 0.2));

      const tele = this.makeTelegraphGroup(0xb429ff, 2.8);
      bodyGroup.add(tele);
      bodyGroup.userData.telegraphs = [tele];
    } else if (e.archetype === 'SPLITTER') {
      // Twin-hull Volt yellow catamaran carrier with central splitting reactor (weak to KINETIC)
      baseColor = 0xfff733;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x4d4306,
        emissive: baseColor,
        emissiveIntensity: 0.35,
        roughness: 0.4,
        metalness: 0.35,
      });
      for (const side of [-1, 1]) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(r * 1.65, r * 0.45, 11), hullMat);
        pod.position.set(0, side * r * 0.56, 2);
        bodyGroup.add(pod);
      }
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(r * 0.42, 0),
        new THREE.MeshStandardMaterial({ color: 0xfff733, emissive: 0xffaa22, emissiveIntensity: 0.75 })
      );
      gem.position.z = 6;
      const shipPts = [
        { x: r * 1.1, y: r * 0.78 },
        { x: -r * 0.9, y: r * 0.85 },
        { x: -r * 0.45, y: 0 },
        { x: -r * 0.9, y: -r * 0.85 },
        { x: r * 1.1, y: -r * 0.78 },
        { x: r * 0.55, y: 0 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(shipPts, 2.5, true, 8), createNeonRibbonMaterial(baseColor, 1.2, 0.95));
      bodyGroup.add(gem, trimObj, createGlowSprite(baseColor, r * 2.2, 0.2));
    } else {
      // WARDEN Boss — Massive Multi-Winged Dreadnought Command Carrier with 4 rotating armor plates
      baseColor = 0xff2e97;
      hullMat = new THREE.MeshStandardMaterial({
        color: 0x450d35,
        emissive: baseColor,
        emissiveIntensity: 0.38,
        roughness: 0.38,
        metalness: 0.45,
      });
      const mainHull = new THREE.Mesh(new THREE.BoxGeometry(r * 1.85, r * 1.05, 20), hullMat);
      bodyGroup.add(mainHull);
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(r * 1.35, r * 0.55, 12), hullMat);
        wing.position.set(-r * 0.15, side * r * 0.85, 2);
        wing.rotation.z = side * -0.22;
        const turret = new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, r * 0.24, 9), hullMat);
        turret.position.set(r * 0.85, side * r * 0.45, 7);
        bodyGroup.add(wing, turret);
      }
      const bridge = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.45, 0), hullMat);
      bridge.position.z = 14;
      bodyGroup.add(bridge);

      const carrierPts = [
        { x: r * 1.35, y: r * 0.36 },
        { x: r * 0.45, y: r * 0.78 },
        { x: -r * 0.25, y: r * 1.22 },
        { x: -r * 1.15, y: r * 1.05 },
        { x: -r * 0.85, y: 0 },
        { x: -r * 1.15, y: -r * 1.05 },
        { x: -r * 0.25, y: -r * 1.22 },
        { x: r * 0.45, y: -r * 0.78 },
        { x: r * 1.35, y: -r * 0.36 },
      ];
      trimObj = new THREE.Mesh(buildRibbonGeometry(carrierPts, 3.4, true, 12), createNeonRibbonMaterial(baseColor, 1.25, 0.98));
      bodyGroup.add(trimObj);

      const bossPlates: THREE.Object3D[] = [];
      for (let p = 0; p < 4; p++) {
        const platePts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i <= 10; i++) {
          const a = -0.45 + (i / 10) * 0.9;
          platePts.push({ x: Math.cos(a) * (r + 16), y: Math.sin(a) * (r + 16) });
        }
        const plate = new THREE.Mesh(buildRibbonGeometry(platePts, 4.4, false, 6), createNeonRibbonMaterial(0xe6f0ff, 1.25, 0.98));
        plate.visible = p < e.bossShieldAngles.length;
        bodyGroup.add(plate);
        bossPlates.push(plate);
      }
      bodyGroup.userData.bossPlates = bossPlates;
      bodyGroup.add(createGlowSprite(baseColor, r * 2.6, 0.24));
      const telegraphs: THREE.Group[] = [];
      for (let ti = 0; ti < 3; ti++) {
        const tele = this.makeTelegraphGroup(0xff2e97, 3.2);
        bodyGroup.add(tele);
        telegraphs.push(tele);
      }
      bodyGroup.userData.telegraphs = telegraphs;
    }

    root.userData.hullMat = hullMat;
    root.userData.trimObj = trimObj;

    // Floating HP + Shield Bar
    const hpBar = new THREE.Group();
    const barW = r * 2.2;
    const barH = e.archetype === 'WARDEN' ? 6 : 4;
    hpBar.position.set(0, r + 15, 16);
    hpBar.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(barW + 2, barH + 2),
        new THREE.MeshBasicMaterial({ color: 0x050814, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
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
        new THREE.MeshBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending })
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

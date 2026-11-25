import {
  circleVsConvexPoly,
  clampPointToConvexPoly,
  DEFAULT_RECT_BOUNDARY,
  pointInConvexPoly,
  rayVsArenaBoundary,
  rayVsConvexPoly,
} from './ArenaGeometry';
import { getAugmentStacks } from './Augments';
import { createEnemy, normalizeAngle, stepEnemyAI } from './EnemyAI';
import { getDifficultyConfig, getShipDef } from './Ships';
import { computeComposition, ResolvedSelfCast, ResolvedSpell } from './SpellResolver';
import {
  ArenaBlock,
  ArenaObstacle,
  ArenaPillar,
  AugmentId,
  BeamEntity,
  ChannelState,
  ChargeState,
  DifficultyConfig,
  ELEMENT_META,
  ElementComposition,
  EnemyArchetype,
  EnemyEntity,
  HazardZoneEntity,
  MineEntity,
  PlayerState,
  PoolEntity,
  ProjectileEntity,
  QueueElement,
  ShieldBarrierEntity,
  ShipDef,
  SimEvent,
  SlashArcEntity,
  StatusType,
  StormEntity,
  Vec2,
  WallPylonEntity,
} from './types';

const MAX_STORMS = 1;
const MAX_MINES = 8;
const MAX_WALL_PYLONS = 16;

function clampArena(
  x: number,
  y: number,
  pad = 24,
  boundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY
): { x: number; y: number } {
  return clampPointToConvexPoly(x, y, pad, boundary);
}

function pointToRayDist(
  px: number,
  py: number,
  rx: number,
  ry: number,
  cos: number,
  sin: number,
  maxLen: number
): { perpDist: number; along: number } {
  const dx = px - rx;
  const dy = py - ry;
  const along = dx * cos + dy * sin;
  if (along < 0 || along > maxLen) {
    return { perpDist: Infinity, along };
  }
  const perpDist = Math.abs(-dx * sin + dy * cos);
  return { perpDist, along };
}

function pointToSegmentClosest(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { cx: number; cy: number; dist: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-4) {
    return { cx: ax, cy: ay, dist: Math.hypot(px - ax, py - ay), t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return { cx, cy, dist: Math.hypot(px - cx, py - cy), t };
}

function raySegmentIntersect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number | null {
  const sx = bx - ax;
  const sy = by - ay;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-5) return null;
  const qpx = ax - ox;
  const qpy = ay - oy;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * dy - qpy * dx) / denom;
  if (t > 8 && t <= maxDist && u >= -0.05 && u <= 1.05) {
    return t;
  }
  return null;
}

function circleVsAABB(
  cx: number,
  cy: number,
  r: number,
  b: ArenaBlock
): { hit: boolean; pushX: number; pushY: number } {
  const closestX = Math.max(b.x - b.halfW, Math.min(b.x + b.halfW, cx));
  const closestY = Math.max(b.y - b.halfH, Math.min(b.y + b.halfH, cy));
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= r * r) return { hit: false, pushX: 0, pushY: 0 };
  const dist = Math.sqrt(distSq);
  if (dist > 1e-4) {
    const overlap = r - dist;
    return { hit: true, pushX: (dx / dist) * overlap, pushY: (dy / dist) * overlap };
  }
  const penX = b.halfW - Math.abs(cx - b.x);
  const penY = b.halfH - Math.abs(cy - b.y);
  if (penX < penY) {
    return { hit: true, pushX: cx >= b.x ? penX + r : -(penX + r), pushY: 0 };
  }
  return { hit: true, pushX: 0, pushY: cy >= b.y ? penY + r : -(penY + r) };
}

function rayAABBIntersect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  b: ArenaBlock
): number | null {
  const minX = b.x - b.halfW;
  const maxX = b.x + b.halfW;
  const minY = b.y - b.halfH;
  const maxY = b.y + b.halfH;
  let tmin = 0;
  let tmax = maxDist;

  if (Math.abs(dx) < 1e-6) {
    if (ox < minX || ox > maxX) return null;
  } else {
    let t1 = (minX - ox) / dx;
    let t2 = (maxX - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < 1e-6) {
    if (oy < minY || oy > maxY) return null;
  } else {
    let t1 = (minY - oy) / dy;
    let t2 = (maxY - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  return tmin > 8 && tmin <= maxDist ? tmin : null;
}

export class CombatEngine {
  private nextId = 1;
  public enemies: EnemyEntity[] = [];
  public projectiles: ProjectileEntity[] = [];
  public beams: BeamEntity[] = [];
  public walls: WallPylonEntity[] = [];
  public mines: MineEntity[] = [];
  public storms: StormEntity[] = [];
  public shields: ShieldBarrierEntity[] = [];
  public pools: PoolEntity[] = [];
  public slashes: SlashArcEntity[] = [];
  public hazards: HazardZoneEntity[] = [];

  private clashProgress = new Map<string, number>();
  private hitNumberAccum = new Map<number, { dmg: number; timer: number; color: number; x: number; y: number }>();
  private comboTextCooldown = new Map<number, number>();
  private splashCooldown = new Map<number, number>();
  private augments: Partial<Record<AugmentId, number>> = {};
  private refractedBeamIds = new Map<string, number[]>();
  private shipDef: ShipDef = getShipDef('VANGUARD');
  private difficulty: DifficultyConfig = getDifficultyConfig('VETERAN');
  private currentBoundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY;

  public setAugments(augments: Partial<Record<AugmentId, number>>): void {
    this.augments = augments;
  }

  public setRunConfig(ship: ShipDef, difficulty: DifficultyConfig): void {
    this.shipDef = ship;
    this.difficulty = difficulty;
  }

  public setArenaBoundary(boundary: readonly Vec2[]): void {
    this.currentBoundary = boundary;
  }

  private getSpellAccentColor(elements: readonly QueueElement[], comp: ElementComposition): number {
    if (elements.includes('VOID')) {
      const other = elements.find((el) => el !== 'VOID' && el !== 'BARRIER');
      return other ? ELEMENT_META[other].colorHex : ELEMENT_META.VOID.colorHex;
    }
    return comp.primaryColorHex;
  }

  private getSpellParticleColors(elements: readonly QueueElement[], colors: readonly number[]): number[] {
    if (elements.includes('VOID')) {
      const otherCols = colors.filter((c) => c !== ELEMENT_META.VOID.colorHex && c !== ELEMENT_META.BARRIER.colorHex);
      if (otherCols.length > 0) return otherCols;
    }
    return [...colors];
  }

  public reset(): void {
    this.nextId = 1;
    this.enemies = [];
    this.projectiles = [];
    this.beams = [];
    this.walls = [];
    this.mines = [];
    this.storms = [];
    this.shields = [];
    this.pools = [];
    this.slashes = [];
    this.hazards = [];
    this.clashProgress.clear();
    this.hitNumberAccum.clear();
    this.comboTextCooldown.clear();
    this.splashCooldown.clear();
    this.refractedBeamIds.clear();
  }

  public clearTransientForSector(): void {
    this.projectiles = [];
    this.beams = [];
    this.walls = [];
    this.mines = [];
    this.storms = [];
    this.pools = [];
    this.slashes = [];
    this.hazards = [];
    this.clashProgress.clear();
    this.hitNumberAccum.clear();
    this.comboTextCooldown.clear();
    this.splashCooldown.clear();
    this.refractedBeamIds.clear();
  }

  public spawnEnemy(archetype: EnemyArchetype, x: number, y: number, wave: number): EnemyEntity {
    const enemy = createEnemy(this.nextId++, archetype, x, y, wave, this.difficulty);
    this.enemies.push(enemy);
    return enemy;
  }

  private emitSanctuaryPulse(x: number, y: number, stacks: number, events: SimEvent[]): void {
    if (stacks <= 0) return;
    const radius = 155;
    this.applyAoEDamage(x, y, radius, 28 * stacks, ['BARRIER'], 260, events);
    events.push({ type: 'vfx_ring', x, y, radius, colorHex: 0xe6f0ff, duration: 0.28 });
    events.push({ type: 'grid_impulse', x, y, strength: 185, radius });
    events.push({ type: 'damage_number', x, y: y - 24, text: 'SANCTUARY PULSE!', colorHex: 0xe6f0ff, big: true });
  }

  public castSelf(player: PlayerState, selfCast: ResolvedSelfCast, events: SimEvent[]): void {
    const comp = selfCast.composition;
    const counts = comp.counts;

    switch (selfCast.effect) {
      case 'SHIELD_WARD': {
        player.wardRemaining = 6;
        player.wardMaxDuration = 6;
        player.wardElement = selfCast.wardElement;
        if (!selfCast.wardElement) {
          const sanctStacks = getAugmentStacks(this.augments, 'SANCTUARY_PULSE');
          const domeHp = Math.round(260 * (1 + 0.45 * sanctStacks));
          this.shields.length = 0;
          this.shields.push({
            id: this.nextId++,
            x: player.x,
            y: player.y,
            angle: player.aimAngle,
            arc: Math.PI,
            radius: 118,
            hp: domeHp,
            maxHp: domeHp,
            life: 6.5,
            maxLife: 6.5,
            isNova: true,
            followPlayer: false,
            colorHex: selfCast.colorHex,
            colors: comp.colors,
          });
          this.emitSanctuaryPulse(player.x, player.y, sanctStacks, events);
        }
        events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 24, radius: 60 });
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 118, colorHex: selfCast.colorHex });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 140 });
        events.push({ type: 'sfx', sound: 'ward', elements: selfCast.elements });
        break;
      }

      case 'KINETIC_ARMOR': {
        player.armorHp = Math.min(player.maxArmorHp, player.armorHp + selfCast.armorAmount);
        const radius = 120 + comp.totalPower * 25;
        this.applyAoEDamage(player.x, player.y, radius, 26 * (counts.KINETIC ?? 1), selfCast.elements, 260, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius, colorHex: selfCast.colorHex });
        events.push({ type: 'vfx_shards', x: player.x, y: player.y, colors: comp.colors, count: 14, speedScale: 0.9 });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 200, radius: radius + 20 });
        events.push({ type: 'screen_shake', intensity: 4 });
        events.push({ type: 'sfx', sound: 'rock', elements: selfCast.elements });
        break;
      }

      case 'NANO_PULSE': {
        const nanoStacks = counts.NANO ?? 1;
        const count = 4 + nanoStacks * 2;
        const speed = 540;
        for (let i = 0; i < count; i++) {
          const a = player.aimAngle + (i / count) * Math.PI * 2;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'PLAYER',
            kind: 'NANO_BOLT',
            x: player.x + Math.cos(a) * 18,
            y: player.y + Math.sin(a) * 18,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 9,
            damage: 24 + comp.totalPower * 4,
            pierce: 1,
            life: 1.4,
            maxLife: 1.4,
            colorHex: ELEMENT_META.NANO.colorHex,
            colors: comp.colors,
            elements: selfCast.elements,
            composition: comp,
            hitIds: [],
            spin: 0,
          });
        }
        events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 18, radius: 55 });
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 95, colorHex: selfCast.colorHex });
        events.push({ type: 'sfx', sound: 'beam', elements: selfCast.elements });
        break;
      }

      case 'VOID_BURST': {
        const radius = 130 + comp.totalPower * 35;
        const accent = this.getSpellAccentColor(selfCast.elements, comp);
        const burstColors = this.getSpellParticleColors(selfCast.elements, comp.colors);
        this.applyAoEDamage(player.x, player.y, radius, 42 * comp.totalPower, selfCast.elements, -160, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius, colorHex: accent });
        events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: accent, count: 28, radius: radius * 0.7 });
        events.push({ type: 'vfx_shards', x: player.x, y: player.y, colors: burstColors, count: 18, speedScale: 1.1 });
        events.push({ type: 'grid_well', x: player.x, y: player.y, strength: 240 + comp.totalPower * 40, radius: radius + 40 });
        events.push({ type: 'screen_shake', intensity: 4.5 });
        events.push({ type: 'sfx', sound: 'beam', elements: selfCast.elements });
        break;
      }

      case 'VOLT_NOVA': {
        const voltStacks = counts.VOLT ?? 1;
        const arcs = 4 + voltStacks * 3;
        const range = 210 + voltStacks * 65;
        this.castLightningBurst(player.x, player.y, player.aimAngle, arcs, range, 32 * voltStacks, selfCast.elements, comp, true, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: range * 0.7, colorHex: selfCast.colorHex });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160 + voltStacks * 35, radius: range * 0.8 });
        events.push({ type: 'sfx', sound: 'lightning', elements: selfCast.elements });
        break;
      }

      case 'ELEMENT_AOE': {
        if (selfCast.elements.includes('FLUX') || selfCast.elements.includes('PLASMA') || selfCast.elements.includes('CRYO') || selfCast.elements.includes('CRYSTAL')) {
          player.ignitedTimer = 0;
        }
        const radius = 135 + comp.totalPower * 45;
        const knockback = selfCast.elements.includes('FLUX') ? 220 : 0;
        this.applyAoEDamage(player.x, player.y, radius, 28 * comp.totalPower, selfCast.elements, knockback, events);
        events.push({
          type: 'vfx_spray',
          x: player.x,
          y: player.y,
          angle: player.aimAngle,
          spread: Math.PI * 2,
          range: radius,
          colors: comp.weightedColors,
          isNova: true,
          elements: selfCast.elements,
        });
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius, colorHex: selfCast.colorHex });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 150 + comp.totalPower * 35, radius: radius + 20 });
        events.push({ type: 'sfx', sound: selfCast.elements.includes('FLUX') ? 'cleanse' : 'spray' });
        break;
      }
    }
  }

  public startCharge(player: PlayerState, spell: ResolvedSpell): void {
    const capStacks = getAugmentStacks(this.augments, 'ARCANE_CAPACITOR');
    const baseCharge = spell.delivery === 'CRYSTAL_SHARDS' ? 0.75 : 0.85;
    const maxCharge = baseCharge / (1 + 0.35 * capStacks);
    player.charge = {
      delivery: spell.delivery as ChargeState['delivery'],
      elements: spell.elements,
      composition: spell.composition,
      stackPower: spell.stackPower,
      elapsed: 0,
      maxCharge,
      ratio: 0,
    };
  }

  public cancelCharge(player: PlayerState): void {
    player.charge = null;
  }

  public releaseCharge(player: PlayerState, events: SimEvent[], overrideRatio?: number): void {
    const ch = player.charge;
    if (!ch) return;
    const r = Math.max(0.05, Math.min(1, overrideRatio ?? ch.ratio));
    const angle = player.aimAngle;
    const comp = ch.composition;
    const counts = comp.counts;
    const color = comp.primaryColorHex;
    player.charge = null;

    if (ch.delivery === 'ROCK_THROW') {
      const kineticCount = counts.KINETIC ?? 1;
      const aftershockStacks = getAugmentStacks(this.augments, 'KINETIC_AFTERSHOCK');
      const speed = (220 + kineticCount * 22) + r * (600 + kineticCount * 45);
      const range = 160 + r * (780 + kineticCount * 45);
      const life = range / speed;
      const radius = (16 + kineticCount * 7) + r * 7;
      const damage = Math.round(75 * kineticCount * (0.5 + 0.7 * r) * (1 + 0.25 * aftershockStacks));
      const pierce = 2 + kineticCount;

      this.spawnRock(player.x, player.y, angle, speed, radius, damage, pierce, life, color, comp, ch.elements);
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 110 + r * 150, radius: 115 + r * 45 });
      events.push({ type: 'screen_shake', intensity: 2.5 + (kineticCount + 1) * r * 1.6 });
      events.push({ type: 'sfx', sound: 'rock', elements: ch.elements });
    } else if (ch.delivery === 'CRYSTAL_SHARDS') {
      const crystalCount = counts.CRYSTAL ?? 1;
      const barrageStacks = getAugmentStacks(this.augments, 'CRYO_SHARD_BARRAGE');
      const count = 7 + crystalCount * 3 + 2 * barrageStacks;
      const speed = (680 + r * 1120) * (1 + 0.25 * barrageStacks);
      const range = 240 + r * 920;
      const life = range / speed;
      const spread = 0.65 - r * 0.36;
      const damage = Math.round(32 * (0.55 + 0.65 * r));
      const shardColor = comp.colors.find((c) => c !== ELEMENT_META.CRYSTAL.colorHex) ?? color;

      for (let i = 0; i < count; i++) {
        const a = angle + ((i / (count - 1)) - 0.5) * spread;
        this.projectiles.push({
          id: this.nextId++,
          owner: 'PLAYER',
          kind: 'ICICLE',
          x: player.x + Math.cos(a) * 22,
          y: player.y + Math.sin(a) * 22,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          radius: 12,
          damage,
          pierce: 4,
          life,
          maxLife: life,
          colorHex: shardColor,
          colors: comp.colors,
          elements: ch.elements,
          composition: comp,
          hitIds: [],
          spin: 0,
        });
      }
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 75 + r * 85, radius: 95 + r * 30 });
      events.push({ type: 'sfx', sound: 'icicle', elements: ch.elements });
    }
  }

  public startChannel(player: PlayerState, spell: ResolvedSpell, events: SimEvent[]): void {
    const capStacks = getAugmentStacks(this.augments, 'ARCANE_CAPACITOR');
    const maxDuration = (2.2 + spell.composition.totalPower * 0.4) * this.shipDef.channelDurMult * (1 + 0.35 * capStacks);
    const delivery = spell.delivery as ChannelState['delivery'];
    let beamId: number | null = null;

    if (delivery === 'BEAM') {
      const counts = spell.composition.counts;
      const beamPower = (counts.VOID ?? 0) + (counts.NANO ?? 0);
      const length = 1850 + beamPower * 150;
      const width = 18 + spell.composition.totalPower * 5;
      const isVoidOnly = spell.elements.includes('VOID') && !spell.elements.includes('NANO');
      const baseDps = isVoidOnly ? 108 + spell.composition.totalPower * 26 : 74 + spell.composition.totalPower * 16;
      const b: BeamEntity = {
        id: this.nextId++,
        owner: 'PLAYER',
        x: player.x + Math.cos(player.aimAngle) * 24,
        y: player.y + Math.sin(player.aimAngle) * 24,
        angle: player.aimAngle,
        length,
        width,
        damagePerSec: baseDps,
        life: maxDuration + 0.1,
        maxLife: maxDuration + 0.1,
        colorHex: spell.primaryColorHex,
        colors: spell.composition.colors,
        elements: spell.elements,
        composition: spell.composition,
        clashing: false,
        clashDist: length,
      };
      this.beams.push(b);
      beamId = b.id;
      events.push({ type: 'screen_shake', intensity: 3.5 });
      events.push({ type: 'sfx', sound: 'beam', elements: spell.elements });
    }

    player.channel = {
      delivery,
      elements: spell.elements,
      composition: spell.composition,
      remaining: maxDuration,
      maxDuration,
      tickTimer: 0,
      beamId,
    };

    if (delivery !== 'BEAM') {
      this.emitChannelTick(player, player.channel, events);
      player.channel.tickTimer = delivery === 'SPRAY' ? 0.06 : 0.075;
    }
  }

  public stopChannel(player: PlayerState): void {
    if (!player.channel) return;
    if (player.channel.beamId !== null) {
      const idx = this.beams.findIndex((b) => b.id === player.channel!.beamId);
      if (idx !== -1) {
        this.beams.splice(idx, 1);
      }
    }
    player.channel = null;
  }

  private emitChannelTick(player: PlayerState, ch: ChannelState, events: SimEvent[]): void {
    const angle = player.aimAngle;
    const comp = ch.composition;
    const counts = comp.counts;

    if (ch.delivery === 'SPRAY') {
      const range = 320 + comp.totalPower * 45;
      const spread = 0.88;
      const knockback = ch.elements.includes('FLUX') ? 245 : 0;
      this.applyConeDamage(player.x, player.y, angle, spread, range, 11 + comp.totalPower * 4, ch.elements, events, knockback);
      events.push({
        type: 'vfx_spray',
        x: player.x + Math.cos(angle) * 20,
        y: player.y + Math.sin(angle) * 20,
        angle,
        spread,
        range,
        colors: comp.weightedColors,
        isNova: false,
        elements: ch.elements,
      });
      events.push({
        type: 'grid_impulse',
        x: player.x + Math.cos(angle) * 110,
        y: player.y + Math.sin(angle) * 110,
        strength: 55 + comp.totalPower * 15,
        radius: 110,
      });
      if (Math.random() < 0.35) {
        events.push({ type: 'sfx', sound: 'spray', elements: ch.elements });
      }
    } else if (ch.delivery === 'LIGHTNING_BOLT') {
      const voltCount = counts.VOLT ?? 1;
      const range = 440 + voltCount * 65;
      const dmg = 11 * voltCount + 4 * comp.totalPower;
      this.castLightningBurst(player.x, player.y, angle, 1, range, dmg, ch.elements, comp, false, events);
      if (Math.random() < 0.4) {
        events.push({ type: 'sfx', sound: 'lightning', elements: ch.elements });
      }
    }
  }

  private castLightningBurst(
    ox: number,
    oy: number,
    aimAngle: number,
    arcs: number,
    range: number,
    baseDamage: number,
    elements: QueueElement[],
    comp: ElementComposition,
    isNova: boolean,
    events: SimEvent[]
  ): void {
    for (let i = 0; i < arcs; i++) {
      const a = isNova ? aimAngle + (i / arcs) * Math.PI * 2 : aimAngle;
      const pts: Array<{ x: number; y: number }> = [{ x: ox, y: oy }];
      const hitEnemyIds = new Set<number>();

      // Find initial target in direction (or closest for Nova)
      let firstEnemy: EnemyEntity | null = null;
      let bestScore = Infinity;
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - ox, e.y - oy);
        if (d > range) continue;
        if (!isNova) {
          const angDiff = Math.abs(normalizeAngle(Math.atan2(e.y - oy, e.x - ox) - a));
          if (angDiff > 0.65) continue;
        } else {
          const angDiff = Math.abs(normalizeAngle(Math.atan2(e.y - oy, e.x - ox) - a));
          if (angDiff > (Math.PI * 2) / arcs) continue;
        }
        if (d < bestScore) {
          bestScore = d;
          firstEnemy = e;
        }
      }

      if (firstEnemy) {
        const superStacks = getAugmentStacks(this.augments, 'SUPERCONDUCTOR');
        const relayedMineIds = new Set<number>();
        let cur: EnemyEntity | null = firstEnemy;
        let maxJumps = (cur.statuses.PRIMED ? 9 : 6) + superStacks * 3;
        while (cur && hitEnemyIds.size < maxJumps) {
          hitEnemyIds.add(cur.id);
          pts.push({ x: cur.x, y: cur.y });
          const isPrimed = Boolean(cur.statuses.PRIMED);
          if (isPrimed) maxJumps = 9 + superStacks * 3;
          // Lightning interrupts enemy beam charge / stalker windup
          if (cur.aiState === 'CHARGE' || cur.aiState === 'TELEPORT_WINDUP') {
            cur.aiState = 'SEEK';
            cur.aiTimer = Math.max(cur.aiTimer, 1.2);
          }
          this.applyElementalHit(cur, baseDamage, elements, cur.x - ox, cur.y - oy, events);
          for (const col of comp.colors) {
            events.push({ type: 'vfx_burst', x: cur.x, y: cur.y, colorHex: col, count: 5, radius: 24 });
          }

          const jumpRange = isPrimed ? 400 : 240;
          let nextTarget: EnemyEntity | null = null;
          let nextDist = jumpRange;
          for (const candidate of this.enemies) {
            if (hitEnemyIds.has(candidate.id) || candidate.hp <= 0) continue;
            const d = Math.hypot(candidate.x - cur.x, candidate.y - cur.y);
            if (d < nextDist) {
              nextDist = d;
              nextTarget = candidate;
            }
          }
          // Superconductor: relay arc off deployed Mines to reach further enemies
          if (!nextTarget && superStacks > 0) {
            let bestRelayDist = jumpRange;
            for (const m of this.mines) {
              if (relayedMineIds.has(m.id)) continue;
              const dMine = Math.hypot(m.x - cur.x, m.y - cur.y);
              if (dMine > jumpRange) continue;
              for (const candidate of this.enemies) {
                if (hitEnemyIds.has(candidate.id) || candidate.hp <= 0) continue;
                const dEnemy = Math.hypot(candidate.x - m.x, candidate.y - m.y);
                if (dEnemy <= jumpRange && dMine + dEnemy < bestRelayDist * 2) {
                  bestRelayDist = (dMine + dEnemy) * 0.5;
                  relayedMineIds.add(m.id);
                  pts.push({ x: m.x, y: m.y });
                  events.push({ type: 'vfx_burst', x: m.x, y: m.y, colorHex: 0xfff733, count: 6, radius: 26 });
                  events.push({ type: 'damage_number', x: m.x, y: m.y - 16, text: 'SUPERCONDUCTOR!', colorHex: 0xfff733, big: true });
                  nextTarget = candidate;
                  break;
                }
              }
              if (nextTarget) break;
            }
          }
          cur = nextTarget;
        }
        const last = pts[pts.length - 1]!;
        events.push({ type: 'vfx_lightning', points: pts, colors: comp.colors });
        events.push({ type: 'grid_impulse', x: last.x, y: last.y, strength: 105, radius: 100 });
      } else {
        const jitterA = isNova ? a : a + (Math.random() - 0.5) * 0.16;
        const tx = ox + Math.cos(jitterA) * range;
        const ty = oy + Math.sin(jitterA) * range;
        pts.push({ x: tx, y: ty });
        events.push({ type: 'vfx_lightning', points: pts, colors: comp.colors });
        events.push({ type: 'vfx_burst', x: tx, y: ty, colorHex: comp.primaryColorHex, count: 8, radius: 34 });
        events.push({ type: 'grid_impulse', x: tx, y: ty, strength: 95, radius: 100 });
      }
    }
  }

  public castSpell(
    player: PlayerState,
    spell: ResolvedSpell,
    _aimX: number,
    _aimY: number,
    events: SimEvent[]
  ): void {
    const angle = player.aimAngle;
    const comp = spell.composition;
    const counts = comp.counts;
    const color = spell.primaryColorHex;
    const nonBarrierPower = Math.max(1, comp.totalPower - (counts.BARRIER ?? 0));

    switch (spell.delivery) {
      case 'SHIELD': {
        this.shields.length = 0;
        const isNova = spell.isNova;
        const sanctStacks = getAugmentStacks(this.augments, 'SANCTUARY_PULSE');
        const shieldHp = Math.round((isNova ? 260 : 440) * (1 + 0.45 * sanctStacks));
        const shieldLife = isNova ? 6.5 : 8.0;
        this.shields.push({
          id: this.nextId++,
          x: player.x,
          y: player.y,
          angle,
          arc: 1.25,
          radius: isNova ? 118 : 76,
          hp: shieldHp,
          maxHp: shieldHp,
          life: shieldLife,
          maxLife: shieldLife,
          isNova,
          followPlayer: false,
          colorHex: color,
          colors: comp.colors,
        });
        this.emitSanctuaryPulse(player.x, player.y, sanctStacks, events);
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 170, radius: 140 });
        events.push({ type: 'sfx', sound: 'shield', elements: spell.elements });
        break;
      }

      case 'WALL': {
        const kineticCount = counts.KINETIC ?? 0;
        const hp = kineticCount > 0 ? 380 + kineticCount * 110 : 280;
        const groupId = this.nextId++;
        if (spell.isNova) {
          const count = nonBarrierPower >= 2 ? 10 : 6;
          const ringR = nonBarrierPower >= 2 ? 155 : 110;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * ringR, player.y + Math.sin(a) * ringR, 24, this.currentBoundary);
            this.walls.push({
              id: this.nextId++,
              groupId,
              isNova: true,
              x: pos.x,
              y: pos.y,
              radius: 22,
              hp,
              maxHp: hp,
              life: 11,
              maxLife: 11,
              pulseTimer: 0.15,
              colorHex: color,
              colors: comp.colors,
              elements: spell.elements,
              composition: comp,
            });
          }
        } else {
          // Curved defensive barrier arc in front of player
          const totalPylons = nonBarrierPower >= 2 ? 7 : 5;
          const arcSpan = nonBarrierPower >= 2 ? 1.44 : 1.08;
          const arcR = 148;
          for (let i = 0; i < totalPylons; i++) {
            const a = angle - arcSpan * 0.5 + (i / (totalPylons - 1)) * arcSpan;
            const pos = clampArena(player.x + Math.cos(a) * arcR, player.y + Math.sin(a) * arcR, 24, this.currentBoundary);
            this.walls.push({
              id: this.nextId++,
              groupId,
              isNova: false,
              x: pos.x,
              y: pos.y,
              radius: 22,
              hp,
              maxHp: hp,
              life: 11,
              maxLife: 11,
              pulseTimer: 0.15,
              colorHex: color,
              colors: comp.colors,
              elements: spell.elements,
              composition: comp,
            });
          }
        }
        while (this.walls.length > MAX_WALL_PYLONS) {
          const oldestGroup = this.walls[0]!.groupId;
          this.walls = this.walls.filter((w) => w.groupId !== oldestGroup);
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 145 });
        events.push({ type: 'sfx', sound: 'wall', elements: spell.elements });
        break;
      }

      case 'MINES': {
        if (spell.isNova) {
          const count = nonBarrierPower >= 2 ? 6 : 4;
          const ringR = nonBarrierPower >= 2 ? 205 : 155;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * ringR, player.y + Math.sin(a) * ringR, 24, this.currentBoundary);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        } else if (nonBarrierPower >= 2) {
          for (let i = 0; i < 5; i++) {
            const a = angle + (i - 2) * 0.42;
            const dist = i % 2 === 0 ? 160 : 210;
            const pos = clampArena(player.x + Math.cos(a) * dist, player.y + Math.sin(a) * dist, 24, this.currentBoundary);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        } else {
          for (let i = 0; i < 3; i++) {
            const a = angle + (i - 1) * 0.52;
            const pos = clampArena(player.x + Math.cos(a) * 165, player.y + Math.sin(a) * 165, 24, this.currentBoundary);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        }
        events.push({ type: 'sfx', sound: 'mine_deploy', elements: spell.elements });
        break;
      }

      case 'STORM': {
        if (spell.isNova) {
          while (this.storms.length >= MAX_STORMS) {
            this.storms.shift();
          }
          const tempStacks = getAugmentStacks(this.augments, 'TEMPEST_CAPACITOR');
          const radius = (130 + nonBarrierPower * 18) * (1 + 0.25 * tempStacks);
          const life = (3.4 + nonBarrierPower * 0.45) * (1 + 0.35 * tempStacks);
          const pos = clampArena(player.x, player.y, 90, this.currentBoundary);
          this.storms.push({
            id: this.nextId++,
            x: pos.x,
            y: pos.y,
            radius,
            life,
            maxLife: life,
            tickTimer: 0.04,
            colorHex: color,
            colors: comp.colors,
            elements: spell.elements,
            composition: comp,
          });
          events.push({ type: 'vfx_ring', x: pos.x, y: pos.y, radius, colorHex: color });
          events.push({ type: 'grid_impulse', x: pos.x, y: pos.y, strength: 185, radius });
          events.push({ type: 'sfx', sound: 'storm', elements: spell.elements });
        } else {
          // Launch an unstable morphing storm-bomb projectile that detonates into a Storm on impact
          const speed = 520;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'PLAYER',
            kind: 'STORM_BOMB',
            x: player.x + Math.cos(angle) * 24,
            y: player.y + Math.sin(angle) * 24,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 16,
            damage: 12,
            pierce: 1,
            life: 0.72,
            maxLife: 0.72,
            colorHex: color,
            colors: comp.colors,
            elements: spell.elements,
            composition: comp,
            hitIds: [],
            spin: 0,
          });
          events.push({ type: 'sfx', sound: 'storm', elements: spell.elements });
        }
        break;
      }

      case 'ROCK_THROW': {
        const kineticCount = counts.KINETIC ?? 1;
        const count = 2 + comp.totalPower * 2;
        const radius = 18 + kineticCount * 8;
        const speed = 470 + kineticCount * 35;
        const damage = 68 * kineticCount;
        const pierce = 2 + kineticCount;
        const rockAccent = this.getSpellAccentColor(spell.elements, comp);
        for (let i = 0; i < count; i++) {
          const a = angle + (i / count) * Math.PI * 2;
          this.spawnRock(player.x, player.y, a, speed, radius, damage, pierce, 1.8, color, comp, spell.elements);
        }
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 140 + comp.totalPower * 65, colorHex: rockAccent });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 210 + comp.totalPower * 40, radius: 160 + comp.totalPower * 40 });
        events.push({ type: 'screen_shake', intensity: 4 + comp.totalPower * 1.5 });
        events.push({ type: 'sfx', sound: 'rock', elements: spell.elements });
        break;
      }

      case 'CRYSTAL_SHARDS': {
        const barrageStacks = getAugmentStacks(this.augments, 'CRYO_SHARD_BARRAGE');
        const count = 6 + comp.totalPower * 5 + 2 * barrageStacks;
        const speed = 1250 * (1 + 0.25 * barrageStacks);
        const shardColor = comp.colors.find((c) => c !== ELEMENT_META.CRYSTAL.colorHex) ?? color;
        for (let i = 0; i < count; i++) {
          const a = angle + (i / count) * Math.PI * 2;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'PLAYER',
            kind: 'ICICLE',
            x: player.x + Math.cos(a) * 22,
            y: player.y + Math.sin(a) * 22,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 12,
            damage: 32,
            pierce: 4,
            life: 1.0,
            maxLife: 1.0,
            colorHex: shardColor,
            colors: comp.colors,
            elements: spell.elements,
            composition: comp,
            hitIds: [],
            spin: 0,
          });
        }
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 130 + comp.totalPower * 55, colorHex: color });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 135 + comp.totalPower * 30, radius: 140 });
        events.push({ type: 'sfx', sound: 'icicle', elements: spell.elements });
        break;
      }

      case 'BEAM': {
        const count = 2 + comp.totalPower * 2;
        const length = 1550 + comp.totalPower * 150;
        const width = 18 + comp.totalPower * 5;
        for (let i = 0; i < count; i++) {
          const a = angle + (i / count) * Math.PI * 2;
          this.beams.push({
            id: this.nextId++,
            owner: 'PLAYER',
            x: player.x + Math.cos(a) * 24,
            y: player.y + Math.sin(a) * 24,
            angle: a,
            length,
            width,
            damagePerSec: spell.elements.includes('VOID') ? 140 : 95,
            life: 0.45,
            maxLife: 0.45,
            colorHex: color,
            colors: comp.colors,
            elements: spell.elements,
            composition: comp,
            clashing: false,
            clashDist: length,
          });
        }
        const beamAccent = this.getSpellAccentColor(spell.elements, comp);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 140 + comp.totalPower * 65, colorHex: beamAccent });
        if (spell.elements.includes('VOID')) {
          events.push({ type: 'grid_well', x: player.x, y: player.y, strength: 220 + comp.totalPower * 60, radius: 190 + comp.totalPower * 50 });
        }
        events.push({ type: 'screen_shake', intensity: 4 + comp.totalPower });
        events.push({ type: 'sfx', sound: 'beam', elements: spell.elements });
        break;
      }

      case 'LIGHTNING_BOLT': {
        const voltCount = counts.VOLT ?? 1;
        const arcs = 4 + comp.totalPower * 3;
        const range = 200 + comp.totalPower * 95;
        const dmg = 26 * voltCount + 10 * comp.totalPower;
        this.castLightningBurst(player.x, player.y, angle, arcs, range, dmg, spell.elements, comp, true, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: range * 0.85, colorHex: color });
        events.push({ type: 'sfx', sound: 'lightning', elements: spell.elements });
        break;
      }

      case 'SPRAY': {
        const range = 165 + (comp.totalPower - 1) * 90;
        const knockback = spell.elements.includes('FLUX') ? 260 : 0;
        this.applyAoEDamage(player.x, player.y, range, 32 * comp.totalPower, spell.elements, knockback, events);
        events.push({
          type: 'vfx_spray',
          x: player.x,
          y: player.y,
          angle,
          spread: Math.PI * 2,
          range,
          colors: comp.weightedColors,
          isNova: true,
          elements: spell.elements,
        });
        for (let rIdx = 0; rIdx < comp.totalPower; rIdx++) {
          const ringR = range * (0.55 + rIdx * 0.25);
          const ringColor = comp.colors[rIdx % comp.colors.length]!;
          events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: ringR, colorHex: ringColor, duration: 0.32 + rIdx * 0.08 });
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 140 + comp.totalPower * 55, radius: range * 0.85 });
        events.push({ type: 'sfx', sound: 'spray', elements: spell.elements });
        break;
      }

      case 'PHASE_SLASH': {
        const phaseStacks = getAugmentStacks(this.augments, 'PHASE_RESONANCE');
        const radius = (125 + comp.totalPower * 18) * (1 + 0.35 * phaseStacks);
        this.applyConeDamage(player.x, player.y, angle, 2.7, radius, 55 * comp.totalPower, spell.elements, events, 340);
        this.slashes.push({
          id: this.nextId++,
          x: player.x,
          y: player.y,
          angle,
          arc: 1.35,
          radius,
          life: 0.26,
          maxLife: 0.26,
          colorHex: color,
          colors: comp.colors,
        });
        events.push({
          type: 'vfx_burst',
          x: player.x + Math.cos(angle) * 65,
          y: player.y + Math.sin(angle) * 65,
          colorHex: color,
          count: 22,
          radius: 65,
        });
        events.push({
          type: 'vfx_ring',
          x: player.x + Math.cos(angle) * 55,
          y: player.y + Math.sin(angle) * 55,
          radius: radius * 0.65,
          colorHex: comp.secondaryColorHex,
        });
        if (spell.hasBarrierTrail) {
          for (let i = 1; i <= 4; i++) {
            const pos = clampArena(player.x + Math.cos(angle) * i * 42, player.y + Math.sin(angle) * i * 42, 24, this.currentBoundary);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        }
        events.push({ type: 'sfx', sound: 'slash', elements: spell.elements });
        break;
      }
    }
  }

  private spawnMine(
    x: number,
    y: number,
    colorHex: number,
    composition: ElementComposition,
    elements: QueueElement[]
  ): void {
    const mineStacks = getAugmentStacks(this.augments, 'MINEFIELD_SATURATION');
    const maxMines = MAX_MINES + 4 * mineStacks;
    while (this.mines.length >= maxMines) {
      this.mines.shift();
    }
    this.mines.push({
      id: this.nextId++,
      x,
      y,
      radius: 16,
      triggerRadius: 46,
      blastRadius: (135 + composition.totalPower * 30) * (1 + 0.25 * mineStacks),
      damage: 65,
      armTimer: 0.35 / (1 + 0.4 * mineStacks),
      life: 10,
      colorHex,
      colors: composition.colors,
      elements,
      composition,
    });
  }

  private spawnRock(
    px: number,
    py: number,
    angle: number,
    speed: number,
    radius: number,
    damage: number,
    pierce: number,
    life: number,
    colorHex: number,
    composition: ElementComposition,
    elements: QueueElement[]
  ): void {
    this.projectiles.push({
      id: this.nextId++,
      owner: 'PLAYER',
      kind: 'ROCK',
      x: px + Math.cos(angle) * 26,
      y: py + Math.sin(angle) * 26,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      damage,
      pierce,
      life,
      maxLife: life,
      colorHex,
      colors: composition.colors,
      elements,
      composition,
      hitIds: [],
      spin: 0,
    });
  }

  private detonateRock(p: ProjectileEntity, events: SimEvent[], hitTarget = true): void {
    const counts = p.composition.counts;
    const kineticCount = counts.KINETIC ?? 1;
    const singStacks = p.elements.includes('VOID') ? getAugmentStacks(this.augments, 'SINGULARITY_PULL') : 0;
    const aftershockStacks = getAugmentStacks(this.augments, 'KINETIC_AFTERSHOCK');
    const blastRadius = (95 + kineticCount * 38) * (singStacks > 0 ? 1.3 : 1) * (1 + 0.3 * aftershockStacks);

    const rockAccent = this.getSpellAccentColor(p.elements, p.composition);
    const rockShardCols = this.getSpellParticleColors(p.elements, p.colors);
    const knockback = p.elements.includes('VOID') ? -240 - singStacks * 150 : 320;
    const hits = this.applyAoEDamage(p.x, p.y, blastRadius, p.damage, p.elements, knockback, events);
    if (aftershockStacks > 0) {
      for (const e of this.enemies) {
        if (e.hasFrontShield && e.shieldHp > 0 && Math.hypot(e.x - p.x, e.y - p.y) <= blastRadius + e.radius) {
          e.shieldHp = 0;
          e.hasFrontShield = false;
          events.push({ type: 'damage_number', x: e.x, y: e.y - e.radius - 10, text: 'AFTERSHOCK!', colorHex: ELEMENT_META.KINETIC.colorHex, big: true });
        }
      }
      events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: blastRadius * 1.15, colorHex: ELEMENT_META.KINETIC.colorHex, duration: 0.32 });
    }
    events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 220 + kineticCount * 90, radius: blastRadius + 50 });
    events.push({
      type: 'vfx_element_explosion',
      x: p.x,
      y: p.y,
      radius: blastRadius,
      elements: p.elements,
      colors: rockShardCols,
      power: p.composition.totalPower,
    });
    events.push({ type: 'vfx_shards', x: p.x, y: p.y, colors: rockShardCols, count: 16 + kineticCount * 6, speedScale: 1.25 });
    events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: blastRadius, colorHex: rockAccent });
    events.push({ type: 'screen_shake', intensity: 5 + kineticCount * 2 });

    if (p.elements.includes('CRYO') || p.elements.includes('CRYSTAL')) {
      const shardComp = computeComposition(['CRYSTAL']);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        this.projectiles.push({
          id: this.nextId++,
          owner: 'PLAYER',
          kind: 'SHATTER_SHARD',
          x: p.x + Math.cos(a) * 14,
          y: p.y + Math.sin(a) * 14,
          vx: Math.cos(a) * 780,
          vy: Math.sin(a) * 780,
          radius: 8,
          damage: 24,
          pierce: 2,
          life: 0.55,
          maxLife: 0.55,
          colorHex: 0x80ffff,
          colors: [0x80ffff, 0x00f5ff],
          elements: ['CRYSTAL'],
          composition: shardComp,
          hitIds: [],
          spin: 0,
        });
      }
    }
    if (p.elements.includes('PLASMA')) {
      events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: blastRadius * 1.2, colorHex: ELEMENT_META.PLASMA.colorHex, duration: 0.34 });
    }

    if (p.elements.includes('FLUX') && (hitTarget || hits.length > 0)) {
      this.applyWaterSplash(p.x, p.y, 110, events);
    }

    const voidCount = counts.VOID ?? 0;
    if (voidCount > 0) {
      events.push({ type: 'grid_well', x: p.x, y: p.y, strength: 220 * voidCount, radius: 170 });
    }
  }

  private detonateStormBomb(p: ProjectileEntity, events: SimEvent[]): void {
    while (this.storms.length >= MAX_STORMS) {
      this.storms.shift();
    }
    const counts = p.composition.counts;
    const nonBarrierPower = Math.max(1, p.composition.totalPower - (counts.BARRIER ?? 0));
    const tempStacks = getAugmentStacks(this.augments, 'TEMPEST_CAPACITOR');
    const radius = (118 + nonBarrierPower * 18) * (1 + 0.25 * tempStacks);
    const life = (3.4 + nonBarrierPower * 0.45) * (1 + 0.35 * tempStacks);
    const pos = clampArena(p.x, p.y, 90, this.currentBoundary);
    this.storms.push({
      id: this.nextId++,
      x: pos.x,
      y: pos.y,
      radius,
      life,
      maxLife: life,
      tickTimer: 0.04,
      colorHex: p.colorHex,
      colors: p.colors,
      elements: p.elements,
      composition: p.composition,
    });
    events.push({
      type: 'vfx_element_explosion',
      x: pos.x,
      y: pos.y,
      radius: radius * 0.85,
      elements: p.elements,
      colors: p.colors,
      power: nonBarrierPower,
    });
    events.push({ type: 'vfx_ring', x: pos.x, y: pos.y, radius, colorHex: p.colorHex });
    events.push({ type: 'grid_impulse', x: pos.x, y: pos.y, strength: 185, radius });
    events.push({ type: 'sfx', sound: 'storm', elements: p.elements });
  }

  private applyWaterSplash(x: number, y: number, radius: number, events: SimEvent[], sourceId?: number): void {
    if (sourceId !== undefined && this.splashCooldown.has(sourceId)) return;
    if (sourceId !== undefined) this.splashCooldown.set(sourceId, 0.25);

    const fluxStacks = getAugmentStacks(this.augments, 'FLUX_TIDAL_SURGE');
    const effectiveRadius = radius * (1 + 0.45 * fluxStacks);

    for (const other of this.enemies) {
      if (other.hp <= 0) continue;
      if (Math.hypot(other.x - x, other.y - y) <= effectiveRadius + other.radius) {
        this.setStatus(other, 'PRIMED', 5, 1);
      }
    }
    events.push({
      type: 'vfx_element_explosion',
      x,
      y,
      radius: effectiveRadius * 0.85,
      elements: ['FLUX'],
      colors: [ELEMENT_META.FLUX.colorHex],
      power: 1,
    });
    events.push({ type: 'vfx_ring', x, y, radius: effectiveRadius, colorHex: ELEMENT_META.FLUX.colorHex, duration: 0.22 });
  }

  public applyElementalHit(
    e: EnemyEntity,
    rawDamage: number,
    elements: readonly QueueElement[],
    dirX: number,
    dirY: number,
    events: SimEvent[],
    isAoE = false
  ): void {
    if (e.hp <= 0) return;

    const pureFlux = elements.length > 0 && elements.every((el) => el === 'FLUX' || el === 'BARRIER');
    const mixedFlux = !pureFlux && elements.includes('FLUX');
    const effectiveDamage = pureFlux ? 0 : mixedFlux ? rawDamage * 0.68 : rawDamage;

    const nonBarrier = elements.find((el) => el !== 'BARRIER') ?? elements[0];
    const hitColor = nonBarrier ? ELEMENT_META[nonBarrier].colorHex : 0x00f5ff;

    // Directional shield check (ignored by AoE unless hitting from front)
    if (!isAoE && e.hasFrontShield && e.shieldHp > 0) {
      const incomingAngle = Math.atan2(-dirY, -dirX);
      const diff = Math.abs(normalizeAngle(incomingAngle - e.shieldAngle));
      if (diff <= e.shieldArc) {
        if (elements.includes('KINETIC')) {
          e.shieldHp = 0;
          e.hasFrontShield = false;
          if (!this.comboTextCooldown.has(e.id)) {
            this.comboTextCooldown.set(e.id, 0.35);
            events.push({ type: 'damage_number', x: e.x, y: e.y - e.radius - 10, text: 'SHIELD BREAK!', colorHex: 0xe8741a, big: true });
          }
          events.push({ type: 'vfx_shards', x: e.x, y: e.y, colors: [0xe6f0ff, ELEMENT_META.KINETIC.colorHex], count: 16, speedScale: 1.2 });
          events.push({ type: 'grid_impulse', x: e.x, y: e.y, strength: 190, radius: 120 });
          events.push({ type: 'hit_stop', duration: 0.035 });
          events.push({ type: 'screen_shake', intensity: 7 });
          events.push({ type: 'sfx', sound: 'shatter' });
        } else {
          e.shieldHp = Math.max(0, e.shieldHp - rawDamage * 0.25);
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0xe6f0ff, count: 6, radius: 24 });
          events.push({ type: 'sfx', sound: 'shield_block' });
          return;
        }
      }
    }

    // Boss rotating shield plates
    if (!isAoE && e.archetype === 'WARDEN' && e.bossShieldAngles.length > 0) {
      const incomingAngle = Math.atan2(-dirY, -dirX);
      const hitPlate = e.bossShieldAngles.some((pa) => Math.abs(normalizeAngle(incomingAngle - pa)) < 0.4);
      if (hitPlate && !elements.includes('KINETIC')) {
        events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0xe6f0ff, count: 5, radius: 26 });
        events.push({ type: 'sfx', sound: 'shield_block' });
        return;
      }
    }

    let dmg = effectiveDamage * this.shipDef.damageMult;
    if (elements.includes('VOID') && !elements.includes('NANO')) {
      dmg *= 1.35;
    }

    const plasmaOverStacks = getAugmentStacks(this.augments, 'PLASMA_OVERDRIVE');
    if (plasmaOverStacks > 0 && elements.includes('PLASMA')) {
      dmg *= 1 + 0.3 * plasmaOverStacks;
    }

    const fluxSurgeStacks = getAugmentStacks(this.augments, 'FLUX_TIDAL_SURGE');
    if (fluxSurgeStacks > 0 && e.statuses.PRIMED) {
      dmg *= 1 + 0.15 * fluxSurgeStacks;
    }

    const weakAnalyzerStacks = getAugmentStacks(this.augments, 'WEAKPOINT_ANALYZER');
    if (weakAnalyzerStacks > 0 && e.archetype === 'WARDEN') {
      dmg *= 1 + 0.12 * weakAnalyzerStacks;
    }

    // Elemental affinity weakness / resistance
    const hitsWeakness = Boolean(
      e.weakness &&
        (elements.includes(e.weakness) ||
          (e.weakness === 'CRYO' && elements.includes('CRYSTAL')) ||
          (e.weakness === 'THERMAL' && elements.includes('PLASMA')))
    );
    if (hitsWeakness) {
      dmg *= 1.75 + 0.4 * weakAnalyzerStacks;
      if (rawDamage >= 6 && !this.comboTextCooldown.has(e.id)) {
        this.comboTextCooldown.set(e.id, 0.45);
        events.push({
          type: 'damage_number',
          x: e.x,
          y: e.y - e.radius - 14,
          text: 'WEAK!',
          colorHex: ELEMENT_META[e.weakness!].colorHex,
          big: true,
        });
      }
    } else if (e.affinity && elements.length > 0 && elements.every((el) => el === e.affinity || el === 'BARRIER')) {
      dmg *= 0.6;
    }

    // Directional Flux pushback on non-tiny-tick hits (beam ticks apply smooth dt push in step)
    if (elements.includes('FLUX') && rawDamage >= 6) {
      const dLen = Math.hypot(dirX, dirY);
      if (dLen > 0.01) {
        const pushForce = (isAoE ? 135 : 175) * (1 + 0.4 * fluxSurgeStacks);
        e.vx += (dirX / dLen) * pushForce;
        e.vy += (dirY / dLen) * pushForce;
      }
    }

    // Interrupt charging / windup enemies whenever hit by VOLT in any mixed spell
    if (elements.includes('VOLT') && (e.aiState === 'CHARGE' || e.aiState === 'TELEPORT_WINDUP')) {
      e.aiState = 'SEEK';
      e.aiTimer = Math.max(e.aiTimer, 1.2);
    }

    // Primer combos
    const chainStacks = getAugmentStacks(this.augments, 'CHAIN_REACTOR');
    let overloadFired = false;
    if (e.statuses.PRIMED && elements.includes('VOLT')) {
      overloadFired = true;
      dmg *= 2.0;
      if (!this.comboTextCooldown.has(e.id)) {
        const ovRadius = 105 * (1 + 0.45 * chainStacks);
        const ovDmg = 24 * (1 + 0.5 * chainStacks);
        this.comboTextCooldown.set(e.id, 0.35);
        events.push({ type: 'damage_number', x: e.x, y: e.y - e.radius - 10, text: 'OVERLOAD!', colorHex: 0xfff733, big: true });
        events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: ovRadius, colorHex: 0xfff733, duration: 0.25 });
        for (const other of this.enemies) {
          if (other.id !== e.id && other.hp > 0 && Math.hypot(other.x - e.x, other.y - e.y) <= ovRadius + other.radius) {
            other.hp -= ovDmg / (1 + other.baseArmor);
            other.hitFlash = 0.08;
            this.applyElementalStatuses(other, elements, events, true);
          }
        }
      }
    }

    // Shatter combo: FROZEN + (KINETIC | VOID)
    if (e.statuses.FROZEN && (elements.includes('KINETIC') || elements.includes('VOID'))) {
      delete e.statuses.FROZEN;
      e.freezeImmuneTimer = 3.5;
      dmg += 55;
      if (!this.comboTextCooldown.has(e.id)) {
        this.comboTextCooldown.set(e.id, 0.35);
        events.push({ type: 'damage_number', x: e.x, y: e.y - e.radius - 10, text: 'SHATTER!', colorHex: 0x00f5ff, big: true });
      }
      events.push({ type: 'vfx_shatter', x: e.x, y: e.y, colorHex: 0x00f5ff });
      events.push({ type: 'vfx_shards', x: e.x, y: e.y, colors: [0x00f5ff, 0x80ffff], count: 16, speedScale: 1.3 });
      events.push({ type: 'grid_impulse', x: e.x, y: e.y, strength: 210, radius: 130 });
      events.push({ type: 'hit_stop', duration: 0.035 });
      events.push({ type: 'screen_shake', intensity: 7 });
      events.push({ type: 'sfx', sound: 'shatter' });

      // Fire piercing ice shards radially (Chain Reactor adds +4 per stack)
      const comp = computeComposition(['CRYSTAL']);
      const radialCount = 6 + 4 * chainStacks;
      for (let i = 0; i < radialCount; i++) {
        const a = (i / radialCount) * Math.PI * 2;
        this.projectiles.push({
          id: this.nextId++,
          owner: 'PLAYER',
          kind: 'SHATTER_SHARD',
          x: e.x + Math.cos(a) * 14,
          y: e.y + Math.sin(a) * 14,
          vx: Math.cos(a) * 820,
          vy: Math.sin(a) * 820,
          radius: 8,
          damage: 28,
          pierce: 2,
          life: 0.65,
          maxLife: 0.65,
          colorHex: 0x80ffff,
          colors: [0x80ffff, 0x00f5ff],
          elements: ['CRYSTAL'],
          composition: comp,
          hitIds: [e.id],
          spin: 0,
        });
      }

      // Permafrost Detonation: blast nearby enemies for 75% of shattered enemy's max HP
      const pfStacks = getAugmentStacks(this.augments, 'PERMAFROST_DETONATION');
      if (pfStacks > 0) {
        const pfDmg = e.maxHp * (0.75 + (pfStacks - 1) * 0.35);
        const pfRadius = 165;
        for (const other of this.enemies) {
          if (other.id !== e.id && other.hp > 0 && Math.hypot(other.x - e.x, other.y - e.y) <= pfRadius + other.radius) {
            other.hp -= pfDmg / (1 + other.baseArmor);
            other.hitFlash = 0.12;
            this.setStatus(other, 'CHILLED', 2.5, 1);
          }
        }
        events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: pfRadius, colorHex: 0x00f5ff, duration: 0.32 });
        events.push({
          type: 'vfx_element_explosion',
          x: e.x,
          y: e.y,
          radius: pfRadius * 0.9,
          elements: ['CRYSTAL'],
          colors: [0x80ffff, 0x00f5ff],
          power: pfStacks + 1,
        });
        events.push({ type: 'damage_number', x: e.x, y: e.y - e.radius - 28, text: 'PERMAFROST!', colorHex: 0x80ffff, big: true });
      }
    }

    // Apply armor mitigation (IGNITED shreds 50%; Plasma Overdrive shreds another 50%/75%)
    if (dmg > 0) {
      let effectiveArmor = e.statuses.IGNITED ? e.baseArmor * 0.5 : e.baseArmor;
      if (e.statuses.IGNITED && plasmaOverStacks > 0) {
        effectiveArmor *= plasmaOverStacks >= 2 ? 0.25 : 0.5;
      }
      dmg = dmg / (1 + effectiveArmor);
      e.hp -= dmg;
    }
    e.hitFlash = 0.1;

    if (elements.includes('FLUX')) {
      this.applyWaterSplash(e.x, e.y, 105, events, e.id);
    }

    if (dmg >= 8 && !isAoE) {
      const jitter = (Math.random() - 0.5) * 18;
      events.push({
        type: 'damage_number',
        x: e.x + jitter,
        y: e.y - e.radius,
        text: String(Math.round(dmg)),
        colorHex: hitColor,
      });
      events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: hitColor, count: 3, radius: 18 });
    } else if (dmg > 0.25) {
      const acc = this.hitNumberAccum.get(e.id);
      if (acc) {
        acc.dmg += dmg;
        acc.color = hitColor;
        acc.x = e.x;
        acc.y = e.y - e.radius;
      } else {
        this.hitNumberAccum.set(e.id, {
          dmg,
          timer: 0.18,
          color: hitColor,
          x: e.x,
          y: e.y - e.radius,
        });
      }
    }

    // Apply all mixed status effects (PRIMED -> CRYO Freeze/Chill -> THERMAL Ignite -> NANO Corrupt)
    this.applyElementalStatuses(e, elements, events, overloadFired);
  }

  private applyElementalStatuses(
    e: EnemyEntity,
    elements: readonly QueueElement[],
    events: SimEvent[],
    overloadFired = false
  ): void {
    if (elements.includes('FLUX') || elements.includes('PLASMA')) {
      this.setStatus(e, 'PRIMED', 5, 1);
    }
    if (elements.includes('CRYO') || elements.includes('CRYSTAL')) {
      if (e.statuses.PRIMED) {
        delete e.statuses.PRIMED;
        if (e.freezeImmuneTimer <= 0) {
          const wasFrozen = Boolean(e.statuses.FROZEN);
          this.setStatus(e, 'FROZEN', 2.5, 1);
          if (!wasFrozen) {
            events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0x00f5ff, count: 12, radius: 32 });
            events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: e.radius * 1.9, colorHex: 0x00f5ff, duration: 0.24 });
            events.push({
              type: 'damage_number',
              x: e.x,
              y: e.y - e.radius - (overloadFired ? 28 : 10),
              text: 'FROZEN!',
              colorHex: 0x00f5ff,
              big: true,
            });
          }
        } else if (!e.statuses.FROZEN) {
          this.setStatus(e, 'CHILLED', 3.0, 1);
        }
      } else if (!e.statuses.FROZEN) {
        this.setStatus(e, 'CHILLED', 3.0, 1);
      }
    }
    if (elements.includes('THERMAL') || elements.includes('PLASMA')) {
      if (!elements.includes('CRYO') && !elements.includes('CRYSTAL')) {
        delete e.statuses.FROZEN;
        delete e.statuses.CHILLED;
      }
      this.setStatus(e, 'IGNITED', 3.5, 1);
    }
    if (elements.includes('NANO')) {
      e.nanoMarkTimer = 4.5;
    }
  }

  private setStatus(e: EnemyEntity, type: StatusType, duration: number, potency: number): void {
    const cur = e.statuses[type];
    e.statuses[type] = {
      type,
      remaining: Math.max(cur?.remaining ?? 0, duration),
      stacks: Math.min(3, (cur?.stacks ?? 0) + 1),
      potency,
    };
  }

  private applyAoEDamage(
    x: number,
    y: number,
    radius: number,
    damage: number,
    elements: readonly QueueElement[],
    knockback: number,
    events: SimEvent[]
  ): Array<{ x: number; y: number }> {
    const hits: Array<{ x: number; y: number }> = [];
    for (const e of this.enemies) {
      const dx = e.x - x;
      const dy = e.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius + e.radius) {
        hits.push({ x: e.x, y: e.y });
        this.applyElementalHit(e, damage, elements, dx, dy, events, true);
        if (dist > 0.1 && knockback !== 0) {
          e.vx += (dx / dist) * knockback;
          e.vy += (dy / dist) * knockback;
        }
      }
    }
    return hits;
  }

  private applyConeDamage(
    ox: number,
    oy: number,
    angle: number,
    spread: number,
    range: number,
    damage: number,
    elements: readonly QueueElement[],
    events: SimEvent[],
    knockback = 120
  ): Array<{ x: number; y: number }> {
    const hits: Array<{ x: number; y: number }> = [];
    const halfSpread = spread * 0.5;
    for (const e of this.enemies) {
      const dx = e.x - ox;
      const dy = e.y - oy;
      const dist = Math.hypot(dx, dy);
      if (dist > range + e.radius) continue;
      const diff = Math.abs(normalizeAngle(Math.atan2(dy, dx) - angle));
      if (diff <= halfSpread) {
        hits.push({ x: e.x, y: e.y });
        this.applyElementalHit(e, damage, elements, dx, dy, events);
        if (dist > 0.1 && knockback !== 0) {
          e.vx += (dx / dist) * knockback;
          e.vy += (dy / dist) * knockback;
        }
      }
    }
    return hits;
  }

  public damagePlayer(
    player: PlayerState,
    amount: number,
    sourceEnemy: EnemyEntity | undefined,
    onDamaged: () => void,
    events: SimEvent[]
  ): boolean {
    if (player.invulnTimer > 0 || player.hp <= 0) return false;

    let dmg = amount;
    const hullStacks = getAugmentStacks(this.augments, 'HULL_REINFORCEMENT');
    if (hullStacks > 0 && player.hp / Math.max(1, player.maxHp) <= 0.4) {
      dmg *= Math.max(0.55, 1 - 0.2 * hullStacks);
    }
    if (player.wardRemaining > 0) {
      dmg *= 0.25;
      if (sourceEnemy && player.wardElement) {
        this.applyElementalHit(sourceEnemy, 18, [player.wardElement], sourceEnemy.x - player.x, sourceEnemy.y - player.y, events, true);
      }
    }

    if (player.armorHp > 0) {
      const absorbed = Math.min(player.armorHp, dmg);
      player.armorHp -= absorbed;
      dmg -= absorbed;
      if (player.armorHp <= 0) {
        events.push({ type: 'vfx_shards', x: player.x, y: player.y, colors: [ELEMENT_META.KINETIC.colorHex], count: 12, speedScale: 1 });
      }
    }

    if (dmg > 0) {
      player.hp = Math.max(0, player.hp - dmg);
      onDamaged();
    }
    player.invulnTimer = 0.75;
    // Hit-repel shockwave pushing nearby enemies back so player cannot be pinned
    for (const e of this.enemies) {
      const edx = e.x - player.x;
      const edy = e.y - player.y;
      const edist = Math.hypot(edx, edy);
      if (edist > 0.1 && edist < 110) {
        e.vx += (edx / edist) * 240;
        e.vy += (edy / edist) * 240;
      }
    }
    events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 130 });
    events.push({ type: 'screen_shake', intensity: 6 });
    events.push({ type: 'sfx', sound: 'player_hit' });
    return true;
  }

  public step(
    dt: number,
    player: PlayerState,
    castHeld: boolean,
    _selfHeld: boolean,
    wave: number,
    pillars: readonly ArenaPillar[],
    onKill: (archetype: EnemyArchetype) => void,
    onPlayerDamaged: () => void,
    events: SimEvent[],
    blocks: readonly ArenaBlock[] = [],
    obstacles: readonly ArenaObstacle[] = [],
    arenaBoundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY
  ): void {
    this.currentBoundary = arenaBoundary;
    // Update active charge
    for (const [eid, cd] of this.comboTextCooldown.entries()) {
      const next = cd - dt;
      if (next <= 0) this.comboTextCooldown.delete(eid);
      else this.comboTextCooldown.set(eid, next);
    }
    for (const [eid, cd] of this.splashCooldown.entries()) {
      const next = cd - dt;
      if (next <= 0) this.splashCooldown.delete(eid);
      else this.splashCooldown.set(eid, next);
    }
    for (const [eid, acc] of this.hitNumberAccum.entries()) {
      acc.timer -= dt;
      if (acc.timer <= 0) {
        if (acc.dmg >= 1) {
          events.push({
            type: 'damage_number',
            x: acc.x + (Math.random() - 0.5) * 14,
            y: acc.y,
            text: String(Math.round(acc.dmg)),
            colorHex: acc.color,
          });
        }
        this.hitNumberAccum.delete(eid);
      }
    }

    const wallSegments = this.buildWallSegments();

    if (player.charge) {
      if (castHeld) {
        player.charge.elapsed = Math.min(player.charge.maxCharge, player.charge.elapsed + dt);
        player.charge.ratio = player.charge.elapsed / player.charge.maxCharge;
      } else {
        this.releaseCharge(player, events);
      }
    }

    // Update active channel
    if (player.channel) {
      const ch = player.channel;
      ch.remaining -= dt;
      if (!castHeld || ch.remaining <= 0) {
        this.stopChannel(player);
      } else if (ch.delivery === 'BEAM') {
        const beam = this.beams.find((b) => b.id === ch.beamId);
        if (beam) {
          beam.life = 0.2;
          let targetBeamAngle = player.aimAngle;
          // NANO beams gently lock onto nearby targets in aim cone
          if (ch.elements.includes('NANO') && !ch.elements.includes('VOID')) {
            let bestDiff = 0.34;
            for (const e of this.enemies) {
              if (e.hp <= 0) continue;
              const toEnemy = Math.atan2(e.y - player.y, e.x - player.x);
              const diff = Math.abs(normalizeAngle(toEnemy - player.aimAngle));
              if (diff < bestDiff) {
                bestDiff = diff;
                targetBeamAngle = toEnemy;
              }
            }
          }
          beam.angle = targetBeamAngle;
          beam.x = player.x + Math.cos(beam.angle) * 24;
          beam.y = player.y + Math.sin(beam.angle) * 24;
          ch.tickTimer -= dt;
          if (ch.tickTimer <= 0) {
            ch.tickTimer = 0.08;
            const voidCount = ch.composition.counts.VOID ?? 0;
            if (voidCount > 0) {
              const wx = beam.x + Math.cos(beam.angle) * 240;
              const wy = beam.y + Math.sin(beam.angle) * 240;
              events.push({ type: 'grid_well', x: wx, y: wy, strength: 130 * voidCount, radius: 170 });
            }
          }
        }
      } else {
        ch.tickTimer -= dt;
        if (ch.tickTimer <= 0) {
          const baseCd = ch.delivery === 'SPRAY' ? 0.06 : 0.075;
          const ocStacks = player.overclockTimer > 0 ? getAugmentStacks(this.augments, 'OVERCLOCKED_QUEUE') : 0;
          const rateMult = ocStacks > 0 ? Math.max(0.55, 1 - 0.2 * ocStacks) : 1;
          ch.tickTimer = baseCd * rateMult;
          this.emitChannelTick(player, ch, events);
        }
      }
    }

    // Update projectiles & collisions
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;

      // Homing tracking for NANO-infused player projectiles (replaces VOID homing)
      if (p.owner === 'PLAYER' && p.elements.includes('NANO')) {
        const curSpd = Math.hypot(p.vx, p.vy);
        if (curSpd > 1) {
          let bestTarget: EnemyEntity | null = null;
          let bestDist = 440;
          for (const e of this.enemies) {
            if (e.hp <= 0 || p.hitIds.includes(e.id)) continue;
            const dx = e.x - p.x;
            const dy = e.y - p.y;
            const d = Math.hypot(dx, dy);
            if (d > bestDist || d < 4) continue;
            const dot = (dx * p.vx + dy * p.vy) / (d * curSpd);
            if (dot > -0.35 || p.kind === 'NANO_BOLT') {
              bestDist = d;
              bestTarget = e;
            }
          }
          if (bestTarget) {
            const desiredA = Math.atan2(bestTarget.y - p.y, bestTarget.x - p.x);
            const curA = Math.atan2(p.vy, p.vx);
            const diff = normalizeAngle(desiredA - curA);
            const turn = Math.max(-4.6 * dt, Math.min(4.6 * dt, diff));
            const nextA = curA + turn;
            p.vx = Math.cos(nextA) * curSpd;
            p.vy = Math.sin(nextA) * curSpd;
          }
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 7;

      if (p.owner === 'PLAYER') {
        if (p.kind === 'ROCK' && p.colors.length > 1 && Math.random() < 0.45) {
          events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: p.composition.secondaryColorHex, count: 3, radius: 18 });
        }
        let consumed = false;
        for (const e of this.enemies) {
          if (p.hitIds.includes(e.id) || e.hp <= 0) continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d <= p.radius + e.radius) {
            p.hitIds.push(e.id);
            if (p.kind === 'STORM_BOMB') {
              this.detonateStormBomb(p, events);
              consumed = true;
              break;
            }
            if (p.kind === 'ROCK' && (e.archetype !== 'SWARMER' || p.pierce <= 0)) {
              this.detonateRock(p, events);
              consumed = true;
              break;
            }
            this.applyElementalHit(e, p.damage, p.elements, p.vx, p.vy, events);
            p.pierce--;
            if (p.pierce <= 0) {
              if (p.kind === 'ROCK') this.detonateRock(p, events);
              consumed = true;
              break;
            }
          }
        }
        if (consumed) {
          this.projectiles.splice(i, 1);
          continue;
        }
      } else {
        // Enemy projectile vs player shields, continuous wall forcefields, and player
        let blocked = false;
        let reflected = false;
        for (const s of this.shields) {
          const d = Math.hypot(p.x - s.x, p.y - s.y);
          if (Math.abs(d - s.radius) < 20) {
            const ang = Math.atan2(p.y - s.y, p.x - s.x);
            if (s.isNova || Math.abs(normalizeAngle(ang - s.angle)) <= s.arc) {
              s.hp -= p.damage;
              if (!s.isNova) {
                // Directional Crescent reflects enemy projectiles back!
                p.owner = 'PLAYER';
                p.vx *= -1.4;
                p.vy *= -1.4;
                p.damage = Math.round(p.damage * 2.2);
                p.life = 1.6;
                p.maxLife = 1.6;
                p.colorHex = s.colorHex;
                p.colors = s.colors;
                p.hitIds = [];
                reflected = true;
                events.push({ type: 'damage_number', x: p.x, y: p.y - 12, text: 'REFLECT!', colorHex: 0x00f5ff, big: true });
                events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: s.colorHex, count: 10, radius: 24 });
                events.push({ type: 'sfx', sound: 'shield_block' });
              } else {
                blocked = true;
                events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: s.colorHex, count: 6, radius: 20 });
              }
              break;
            }
          }
        }
        if (reflected) {
          continue;
        }
        if (!blocked) {
          for (const seg of wallSegments) {
            const hit = pointToSegmentClosest(p.x, p.y, seg.a.x, seg.a.y, seg.b.x, seg.b.y);
            if (hit.dist <= 14 + p.radius) {
              const target = hit.t < 0.5 ? seg.a : seg.b;
              target.hp -= p.damage;
              blocked = true;
              events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: target.colorHex, count: 6, radius: 20 });
              events.push({ type: 'sfx', sound: 'shield_block' });
              break;
            }
          }
        }
        if (!blocked) {
          for (const w of this.walls) {
            if (Math.hypot(p.x - w.x, p.y - w.y) <= w.radius + p.radius) {
              w.hp -= p.damage;
              blocked = true;
              events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: w.colorHex, count: 6, radius: 20 });
              events.push({ type: 'sfx', sound: 'shield_block' });
              break;
            }
          }
        }
        if (blocked) {
          this.projectiles.splice(i, 1);
          continue;
        }
        if (Math.hypot(p.x - player.x, p.y - player.y) <= p.radius + 16) {
          if (p.kind === 'ENEMY_ROCK') {
            events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: 68, colorHex: 0xa86b3e, duration: 0.28 });
            events.push({ type: 'vfx_shards', x: p.x, y: p.y, colors: [0xa86b3e, 0xffaa44], count: 10, speedScale: 1.0 });
            events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 165, radius: 95 });
          }
          this.damagePlayer(player, p.damage, undefined, onPlayerDamaged, events);
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      const hitWall = !pointInConvexPoly(p.x, p.y, arenaBoundary, p.radius);
      const hitPillar = pillars.some((pil) => Math.hypot(p.x - pil.x, p.y - pil.y) <= pil.radius + p.radius);
      const hitBlock = blocks.some((blk) => circleVsAABB(p.x, p.y, p.radius, blk).hit);
      const hitObstacle = obstacles.some((obs) => circleVsConvexPoly(p.x, p.y, p.radius, obs).hit);
      if (p.life <= 0 || hitWall || hitPillar || hitBlock || hitObstacle) {
        if (p.kind === 'STORM_BOMB') {
          this.detonateStormBomb(p, events);
        } else if (p.kind === 'ROCK') {
          this.detonateRock(p, events, hitWall || hitPillar || hitBlock || hitObstacle);
        } else if (p.kind === 'ENEMY_ROCK') {
          events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: 68, colorHex: 0xa86b3e, duration: 0.28 });
          events.push({ type: 'vfx_shards', x: p.x, y: p.y, colors: [0xa86b3e, 0xffaa44], count: 10, speedScale: 1.0 });
          if (Math.hypot(p.x - player.x, p.y - player.y) <= 68 + 16) {
            this.damagePlayer(player, p.damage, undefined, onPlayerDamaged, events);
          }
        } else if (hitPillar || hitBlock || hitObstacle) {
          events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: p.colorHex, count: 6, radius: 22 });
          if (p.owner === 'PLAYER' && p.elements.includes('FLUX')) {
            this.applyWaterSplash(p.x, p.y, 95, events);
          }
        }
        this.projectiles.splice(i, 1);
      }
    }

    // Update beams, Beam Clashes, Prism Refraction, Singularity Pull, and Beam hits
    const prismStacks = getAugmentStacks(this.augments, 'PRISM_REFRACTION');
    const singBeamStacks = getAugmentStacks(this.augments, 'SINGULARITY_PULL');
    const activeRefractKeys = new Set<string>();
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      const isChanneled = player.channel && player.channel.beamId === b.id;
      if (!isChanneled) {
        b.life -= dt;
        if (b.life <= 0) {
          this.beams.splice(i, 1);
          continue;
        }
      }
      b.clashing = false;
      b.clashDist = b.length;

      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);

      // Truncate beam at nearest ArenaPillar, ArenaBlock, ArenaObstacle, or ArenaBoundary
      let pillarLimit = rayVsArenaBoundary(b.x, b.y, cos, sin, b.length, arenaBoundary);
      for (const pil of pillars) {
        const { perpDist, along } = pointToRayDist(pil.x, pil.y, b.x, b.y, cos, sin, pillarLimit);
        if (perpDist <= pil.radius + 4 && along > 8) {
          pillarLimit = Math.min(pillarLimit, Math.max(8, along - pil.radius * 0.6));
        }
      }
      for (const blk of blocks) {
        const hitT = rayAABBIntersect(b.x, b.y, cos, sin, pillarLimit, blk);
        if (hitT !== null && hitT < pillarLimit) {
          pillarLimit = hitT;
        }
      }
      for (const obs of obstacles) {
        const hitT = rayVsConvexPoly(b.x, b.y, cos, sin, pillarLimit, obs);
        if (hitT !== null && hitT < pillarLimit) {
          pillarLimit = hitT;
        }
      }
      if (pillarLimit < b.length) {
        b.clashing = true;
        b.clashDist = pillarLimit;
      }

      if (b.owner === 'PLAYER') {
        // Check Beam Clash against enemy beams
        for (const eb of this.beams) {
          if (eb.owner !== 'ENEMY') continue;
          const dot = cos * Math.cos(eb.angle) + sin * Math.sin(eb.angle);
          if (dot > -0.65) continue;
          const { perpDist, along } = pointToRayDist(eb.x, eb.y, b.x, b.y, cos, sin, pillarLimit);
          if (perpDist < 38 && along > 10) {
            const key = `${b.id}:${eb.id}`;
            const prog = Math.min(1, (this.clashProgress.get(key) ?? 0) + dt * 1.55);
            this.clashProgress.set(key, prog);
            const clashAlong = along * (0.45 + prog * 0.45);
            b.clashing = true;
            b.clashDist = clashAlong;
            eb.clashing = true;
            eb.clashDist = Math.max(10, along - clashAlong);

            const cx = b.x + cos * clashAlong;
            const cy = b.y + sin * clashAlong;
            events.push({ type: 'beam_clash', x: cx, y: cy, colorHex: 0x00f5ff });

            if (prog >= 1 && eb.ownerEnemyId !== undefined) {
              const weaver = this.enemies.find((en) => en.id === eb.ownerEnemyId);
              if (weaver) {
                weaver.hp = 0;
                this.applyAoEDamage(weaver.x, weaver.y, 160, 120, b.elements, 260, events);
                events.push({ type: 'vfx_burst', x: weaver.x, y: weaver.y, colorHex: 0xb429ff, count: 30, radius: 80 });
                events.push({ type: 'grid_impulse', x: weaver.x, y: weaver.y, strength: 340, radius: 180 });
                events.push({ type: 'hit_stop', duration: 0.045 });
                events.push({ type: 'screen_shake', intensity: 11 });
                events.push({ type: 'sfx', sound: 'shatter' });
              }
              this.clashProgress.delete(key);
            }
          }
        }

        // Hit enemies along beam
        const effectiveLen = b.clashing ? b.clashDist : b.length;
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          const { perpDist, along } = pointToRayDist(e.x, e.y, b.x, b.y, cos, sin, effectiveLen);
          if (perpDist <= e.radius + b.width * 0.5) {
            this.applyElementalHit(e, b.damagePerSec * dt, b.elements, cos, sin, events);
            if (b.elements.includes('FLUX')) {
              e.vx += cos * 220 * dt;
              e.vy += sin * 220 * dt;
            }
          }
          // Singularity Pull: Void beams pull nearby enemies inward toward beam axis
          if (singBeamStacks > 0 && b.elements.includes('VOID') && along > 10 && perpDist > 8 && perpDist <= 165) {
            const cx = b.x + cos * along;
            const cy = b.y + sin * along;
            const pdx = cx - e.x;
            const pdy = cy - e.y;
            const pd = Math.max(1, Math.hypot(pdx, pdy));
            const pull = 220 * singBeamStacks * dt;
            e.vx += (pdx / pd) * pull;
            e.vy += (pdy / pd) * pull;
          }
        }

        // Prism Refraction: beams passing through player's Barrier Shield split into 3 diverging beams
        if (prismStacks > 0 && !b.refracted) {
          for (const s of this.shields) {
            // Exact forward ray-circle intersection against shield membrane at radius s.radius
            const rx = b.x - s.x;
            const ry = b.y - s.y;
            const bProj = rx * cos + ry * sin;
            const cDist = rx * rx + ry * ry - s.radius * s.radius;
            const disc = bProj * bProj - cDist;
            if (disc < 0) continue;
            const sqrtDisc = Math.sqrt(disc);
            const t1 = -bProj - sqrtDisc;
            const t2 = -bProj + sqrtDisc;
            const along = t1 > 8 ? t1 : t2 > 8 ? t2 : -1;
            if (along <= 8 || along > effectiveLen) continue;
            const ox = b.x + cos * along;
            const oy = b.y + sin * along;
            if (!s.isNova) {
              const hitAng = Math.atan2(oy - s.y, ox - s.x);
              if (Math.abs(normalizeAngle(hitAng - s.angle)) > s.arc) continue;
            }
            {
              const rKey = `${b.id}:${s.id}`;
              activeRefractKeys.add(rKey);
              let childIds = this.refractedBeamIds.get(rKey);
              const offsets = [-0.36, 0, 0.36];
              if (!childIds) {
                childIds = offsets.map(() => this.nextId++);
                this.refractedBeamIds.set(rKey, childIds);
                events.push({ type: 'damage_number', x: ox, y: oy - 16, text: 'REFRACTED!', colorHex: 0xe6f0ff, big: true });
              }
              const dmgFactor = 0.65 + (prismStacks - 1) * 0.15;
              for (let oi = 0; oi < offsets.length; oi++) {
                const cid = childIds[oi]!;
                const ang = b.angle + offsets[oi]!;
                const existing = this.beams.find((rb) => rb.id === cid);
                if (existing) {
                  existing.x = ox;
                  existing.y = oy;
                  existing.angle = ang;
                  existing.length = Math.max(260, b.length * 0.72);
                  existing.width = Math.max(12, b.width * 0.72);
                  existing.damagePerSec = b.damagePerSec * dmgFactor;
                  existing.life = dt * 2.5;
                  existing.maxLife = 0.25;
                  existing.colorHex = b.colorHex;
                  existing.colors = b.colors;
                  existing.elements = b.elements;
                  existing.composition = b.composition;
                } else {
                  this.beams.push({
                    id: cid,
                    owner: 'PLAYER',
                    x: ox,
                    y: oy,
                    angle: ang,
                    length: Math.max(260, b.length * 0.72),
                    width: Math.max(12, b.width * 0.72),
                    damagePerSec: b.damagePerSec * dmgFactor,
                    life: dt * 2.5,
                    maxLife: 0.25,
                    colorHex: b.colorHex,
                    colors: b.colors,
                    elements: b.elements,
                    composition: b.composition,
                    clashing: false,
                    clashDist: Math.max(260, b.length * 0.72),
                    refracted: true,
                  });
                }
              }
            }
          }
        }
      } else {
        // Enemy beam vs player shields & player
        if (b.ownerEnemyId !== undefined) {
          const owner = this.enemies.find((en) => en.id === b.ownerEnemyId);
          if (!owner || owner.hp <= 0 || owner.statuses.FROZEN) {
            this.beams.splice(i, 1);
            continue;
          }
          b.x = owner.x;
          b.y = owner.y;
          b.angle = owner.beamAngle + (b.beamOffset ?? 0);
        }
        const eCos = Math.cos(b.angle);
        const eSin = Math.sin(b.angle);
        let wallLimit = pillarLimit;
        for (const seg of wallSegments) {
          const hitDist = raySegmentIntersect(b.x, b.y, eCos, eSin, wallLimit, seg.a.x, seg.a.y, seg.b.x, seg.b.y);
          if (hitDist !== null && hitDist < wallLimit) {
            wallLimit = Math.max(8, hitDist - 4);
            seg.a.hp -= 16 * dt;
            seg.b.hp -= 16 * dt;
            b.clashing = true;
            b.clashDist = wallLimit;
          }
        }
        for (const w of this.walls) {
          const { perpDist, along } = pointToRayDist(w.x, w.y, b.x, b.y, eCos, eSin, wallLimit);
          if (perpDist <= w.radius + 6 && along > 8) {
            wallLimit = Math.min(wallLimit, Math.max(8, along - w.radius * 0.5));
            w.hp -= 28 * dt;
            b.clashing = true;
            b.clashDist = wallLimit;
          }
        }
        for (const s of this.shields) {
          const { perpDist, along } = pointToRayDist(s.x, s.y, b.x, b.y, eCos, eSin, wallLimit);
          if (perpDist <= s.radius + 12) {
            b.clashing = true;
            b.clashDist = Math.min(b.clashDist, Math.max(10, along - s.radius));
            s.hp -= 35 * dt;
            if (!s.isNova && b.ownerEnemyId !== undefined) {
              const shooter = this.enemies.find((en) => en.id === b.ownerEnemyId);
              if (shooter) {
                this.applyElementalHit(shooter, 35 * dt, ['BARRIER'], -eCos, -eSin, events, true);
              }
            }
          }
        }
        const effLen = b.clashing ? b.clashDist : wallLimit;
        const { perpDist } = pointToRayDist(player.x, player.y, b.x, b.y, eCos, eSin, effLen);
        if (perpDist <= 16 + b.width * 0.4) {
          this.damagePlayer(player, 24 * dt + 10, undefined, onPlayerDamaged, events);
        }
      }
    }
    for (const key of this.refractedBeamIds.keys()) {
      if (!activeRefractKeys.has(key)) {
        this.refractedBeamIds.delete(key);
      }
    }

    // Update shields (only personal self-cast shields follow player)
    const sanctStacks = getAugmentStacks(this.augments, 'SANCTUARY_PULSE');
    for (let i = this.shields.length - 1; i >= 0; i--) {
      const s = this.shields[i]!;
      s.life -= dt;
      if (s.followPlayer) {
        s.x = player.x;
        s.y = player.y;
        s.angle = player.aimAngle;
      }
      if (s.life <= 0 || s.hp <= 0) {
        this.emitSanctuaryPulse(s.x, s.y, sanctStacks, events);
        this.shields.splice(i, 1);
      }
    }

    // Update continuous wall segments: block enemies cleanly along full forcefields & trigger Volt laser fences
    for (const seg of wallSegments) {
      const a = seg.a;
      const b = seg.b;
      const isStone = a.elements.includes('KINETIC');
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const closest = pointToSegmentClosest(e.x, e.y, a.x, a.y, b.x, b.y);
        const minD = 14 + e.radius;
        if (closest.dist < minD) {
          let nx = e.x - closest.cx;
          let ny = e.y - closest.cy;
          const nLen = Math.hypot(nx, ny);
          if (nLen > 0.01) {
            nx /= nLen;
            ny /= nLen;
          } else {
            const sx = b.x - a.x;
            const sy = b.y - a.y;
            const sLen = Math.hypot(sx, sy) || 1;
            nx = -sy / sLen;
            ny = sx / sLen;
          }
          e.x = closest.cx + nx * minD;
          e.y = closest.cy + ny * minD;
          if (isStone && !a.elements.includes('VOID')) {
            e.vx += nx * 130;
            e.vy += ny * 130;
          }
          this.applyElementalHit(e, 26 * dt, a.elements, nx, ny, events, true);
          a.hp -= 8 * dt;
          b.hp -= 8 * dt;
        }
      }

      if (a.elements.includes('VOLT') && a.pulseTimer <= dt) {
        events.push({
          type: 'vfx_lightning',
          points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
          colors: a.colors,
        });
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          const closest = pointToSegmentClosest(e.x, e.y, a.x, a.y, b.x, b.y);
          if (closest.dist <= 46 + e.radius) {
            this.applyElementalHit(e, 16, a.elements, e.x - closest.cx, e.y - closest.cy, events, true);
          }
        }
      }
    }

    // Update wall pylons & distinct per-element wall mechanics
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i]!;
      w.life -= dt;
      w.pulseTimer -= dt;
      const isStone = w.elements.includes('KINETIC');
      const isCrystal = w.elements.includes('CRYSTAL') || w.elements.includes('CRYO');

      for (const e of this.enemies) {
        const dx = e.x - w.x;
        const dy = e.y - w.y;
        const minD = w.radius + e.radius;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.01 && dist < minD) {
          e.x = w.x + (dx / dist) * minD;
          e.y = w.y + (dy / dist) * minD;
          if (isStone && !w.elements.includes('VOID')) {
            e.vx += (dx / dist) * 140;
            e.vy += (dy / dist) * 140;
          }
          this.applyElementalHit(e, 26 * dt, w.elements, dx, dy, events, true);
          w.hp -= 10 * dt;
        }
      }

      if (w.pulseTimer <= 0) {
        w.pulseTimer = 0.45;
        if (w.elements.includes('THERMAL')) {
          this.applyAoEDamage(w.x, w.y, 92, 14, w.elements, 45, events);
        }
        if (w.elements.includes('CRYO') || w.elements.includes('CRYSTAL')) {
          this.applyAoEDamage(w.x, w.y, 92, 8, w.elements, 0, events);
        }
        if (w.elements.includes('FLUX')) {
          this.applyAoEDamage(w.x, w.y, 85, 0, w.elements, 160, events);
        }
        if (w.elements.includes('VOID')) {
          this.applyAoEDamage(w.x, w.y, 135, 10, w.elements, -75, events);
          events.push({ type: 'grid_well', x: w.x, y: w.y, strength: 135, radius: 135 });
        }
        if (w.elements.includes('NANO')) {
          if (Math.hypot(player.x - w.x, player.y - w.y) <= 115) {
            player.hp = Math.min(player.maxHp, player.hp + 5);
            events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: ELEMENT_META.NANO.colorHex, count: 4, radius: 24 });
          }
        }
      }

      if (w.life <= 0 || w.hp <= 0) {
        if (isCrystal) {
          const comp = computeComposition(['CRYSTAL']);
          for (let s = 0; s < 4; s++) {
            const a = (s / 4) * Math.PI * 2;
            this.projectiles.push({
              id: this.nextId++,
              owner: 'PLAYER',
              kind: 'SHATTER_SHARD',
              x: w.x + Math.cos(a) * 12,
              y: w.y + Math.sin(a) * 12,
              vx: Math.cos(a) * 820,
              vy: Math.sin(a) * 820,
              radius: 8,
              damage: 26,
              pierce: 2,
              life: 0.65,
              maxLife: 0.65,
              colorHex: 0x80ffff,
              colors: [0x80ffff, 0x00f5ff],
              elements: ['CRYSTAL'],
              composition: comp,
              hitIds: [],
              spin: 0,
            });
          }
          events.push({ type: 'vfx_shatter', x: w.x, y: w.y, colorHex: 0x80ffff });
        }
        const tectStacks = getAugmentStacks(this.augments, 'TECTONIC_MINES');
        if (tectStacks > 0) {
          this.spawnMine(w.x, w.y, w.colorHex, w.composition, w.elements);
          const spawned = this.mines[this.mines.length - 1];
          if (spawned && tectStacks > 1) {
            spawned.damage = Math.round(spawned.damage * (1 + (tectStacks - 1) * 0.35));
          }
          events.push({ type: 'sfx', sound: 'mine_deploy', elements: w.elements });
        }
        this.walls.splice(i, 1);
      }
    }

    // Update mines & enemy proximity detonation
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]!;
      m.armTimer = Math.max(0, m.armTimer - dt);
      m.life -= dt;
      let triggered = false;
      if (m.armTimer <= 0) {
        for (const e of this.enemies) {
          if (Math.hypot(e.x - m.x, e.y - m.y) <= m.triggerRadius + e.radius) {
            triggered = true;
            break;
          }
        }
      }
      if (triggered) {
        const mineAccent = this.getSpellAccentColor(m.elements, m.composition);
        const mineShardCols = this.getSpellParticleColors(m.elements, m.colors);
        const singMineStacks = m.elements.includes('VOID') ? getAugmentStacks(this.augments, 'SINGULARITY_PULL') : 0;
        const blastR = m.blastRadius * (singMineStacks > 0 ? 1.25 : 1);
        const knockback = singMineStacks > 0 ? -240 * singMineStacks : 280;
        this.applyAoEDamage(m.x, m.y, blastR, m.damage, m.elements, knockback, events);
        if (singMineStacks > 0) {
          events.push({ type: 'grid_well', x: m.x, y: m.y, strength: 220 * singMineStacks, radius: blastR + 30 });
        }
        events.push({ type: 'vfx_burst', x: m.x, y: m.y, colorHex: mineAccent, count: 20, radius: blastR * 0.6 });
        events.push({ type: 'vfx_shards', x: m.x, y: m.y, colors: mineShardCols, count: 14, speedScale: 1.1 });
        events.push({ type: 'vfx_ring', x: m.x, y: m.y, radius: blastR, colorHex: mineAccent });
        events.push({ type: 'grid_impulse', x: m.x, y: m.y, strength: 220, radius: m.blastRadius + 30 });
        events.push({ type: 'sfx', sound: 'mine_explode', elements: m.elements });
        this.mines.splice(i, 1);
        continue;
      }
      if (m.life <= 0) {
        this.mines.splice(i, 1);
      }
    }

    // Update storms (compact rapid pulses with very low direct damage)
    const tempCapStacks = getAugmentStacks(this.augments, 'TEMPEST_CAPACITOR');
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i]!;
      s.life -= dt;
      s.tickTimer -= dt;
      if (s.tickTimer <= 0) {
        const counts = s.composition.counts;
        const nonBarrierPower = Math.max(1, s.composition.totalPower - (counts.BARRIER ?? 0));
        s.tickTimer = 0.14 / (1 + 0.25 * tempCapStacks);

        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * s.radius * 0.78;
        const sx = s.x + Math.cos(a) * d;
        const sy = s.y + Math.sin(a) * d;
        const strikeRadius =
          s.elements.includes('CRYO') || s.elements.includes('CRYSTAL')
            ? (38 + nonBarrierPower * 10) * 1.25
            : 38 + nonBarrierPower * 10;
        const knockback = s.elements.includes('FLUX') ? 195 : 0;

        this.applyAoEDamage(sx, sy, strikeRadius, 3 * nonBarrierPower, s.elements, knockback, events);

        if (s.elements.includes('VOID')) {
          this.applyAoEDamage(s.x, s.y, s.radius, 0, [], -210, events);
        }
        if (s.elements.includes('VOLT')) {
          for (const e of this.enemies) {
            if (Math.hypot(e.x - sx, e.y - sy) <= strikeRadius + e.radius) {
              if (e.aiState === 'CHARGE' || e.aiState === 'TELEPORT_WINDUP') {
                e.aiState = 'SEEK';
                e.aiTimer = Math.max(e.aiTimer, 1.2);
              }
            }
          }
        }

        const rawPayload = s.colors.filter((c) => c !== ELEMENT_META.BARRIER.colorHex);
        const payloadColors = s.elements.includes('VOID')
          ? this.getSpellParticleColors(s.elements, rawPayload)
          : rawPayload;
        const palette = payloadColors.length > 0 ? payloadColors : [s.colorHex];
        const strikeColor = palette[Math.floor(Math.random() * palette.length)]!;
        const altColor = palette.find((c) => c !== strikeColor) ?? strikeColor;

        events.push({
          type: 'vfx_storm_strike',
          x: sx,
          y: sy,
          colorHex: strikeColor,
          secondaryColorHex: altColor,
          radius: 42 + nonBarrierPower * 16,
        });
        events.push({ type: 'vfx_ring', x: sx, y: sy, radius: strikeRadius, colorHex: strikeColor });
        if (s.elements.includes('VOLT')) {
          const voltColor = ELEMENT_META.VOLT.colorHex;
          events.push({
            type: 'vfx_lightning',
            points: [
              { x: s.x + (Math.random() - 0.5) * s.radius * 0.9, y: s.y + s.radius * 0.95 },
              { x: sx, y: sy },
            ],
            colors: [voltColor, ...palette.filter((c) => c !== voltColor)],
          });
        }
        events.push({ type: 'grid_impulse', x: sx, y: sy, strength: 155 + nonBarrierPower * 45, radius: 120 });
      }
      if (s.life <= 0) {
        this.storms.splice(i, 1);
      }
    }

    // Update pools (apply PRIMED / IGNITED to enemies standing in them)
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i]!;
      p.life -= dt;
      p.tickTimer -= dt;
      if (p.tickTimer <= 0) {
        p.tickTimer = 0.25;
        for (const e of this.enemies) {
          if (Math.hypot(e.x - p.x, e.y - p.y) <= p.radius + e.radius) {
            this.setStatus(e, 'PRIMED', 5, 1);
            if (p.kind === 'PLASMA') {
              e.hp -= 5;
            }
          }
        }
      }
      if (p.life <= 0) {
        this.pools.splice(i, 1);
      }
    }

    // Update slashes
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]!;
      s.life -= dt;
      s.x = player.x;
      s.y = player.y;
      if (s.life <= 0) {
        this.slashes.splice(i, 1);
      }
    }

    // Step enemy statuses & AI
    const spawnedMinions: Array<{ archetype: EnemyArchetype; x: number; y: number }> = [];
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;

      // Status DoTs & timers
      const conflagStacks = getAugmentStacks(this.augments, 'THERMAL_CONFLAGRATION');
      for (const stKey of Object.keys(e.statuses) as StatusType[]) {
        const st = e.statuses[stKey];
        if (!st) continue;
        st.remaining -= dt;
        if (stKey === 'IGNITED') {
          e.hp -= 14 * st.stacks * (1 + 0.45 * conflagStacks) * dt;
        }
        if (st.remaining <= 0) {
          if (stKey === 'FROZEN') {
            e.freezeImmuneTimer = 3.5;
          }
          delete e.statuses[stKey];
        }
      }
      if (e.hp <= 0) continue;

      stepEnemyAI(
        e,
        dt,
        player,
        this.enemies,
        {
          spawnProjectile: (x, y, vx, vy, damage) => {
            this.projectiles.push({
              id: this.nextId++,
              owner: 'ENEMY',
              kind: 'FROST_NEEDLE',
              x,
              y,
              vx,
              vy,
              radius: 7,
              damage,
              pierce: 1,
              life: 2.2,
              maxLife: 2.2,
              colorHex: 0x00f5ff,
              colors: [0x00f5ff],
              elements: ['CRYO'],
              composition: computeComposition(['CRYO']),
              hitIds: [],
              spin: 0,
            });
          },
          spawnEnemyRock: (x, y, vx, vy, damage) => {
            this.projectiles.push({
              id: this.nextId++,
              owner: 'ENEMY',
              kind: 'ENEMY_ROCK',
              x,
              y,
              vx,
              vy,
              radius: 17,
              damage,
              pierce: 1,
              life: 2.0,
              maxLife: 2.0,
              colorHex: ELEMENT_META.KINETIC.colorHex,
              colors: [ELEMENT_META.KINETIC.colorHex, 0xffaa44],
              elements: ['KINETIC'],
              composition: computeComposition(['KINETIC']),
              hitIds: [],
              spin: 0,
            });
            events.push({ type: 'sfx', sound: 'rock', elements: ['KINETIC'] });
          },
          spawnEnemySpray: (x, y, angle, range, damage) => {
            events.push({
              type: 'vfx_spray',
              x: x + Math.cos(angle) * 20,
              y: y + Math.sin(angle) * 20,
              angle,
              spread: 0.72,
              range,
              colors: [0xff6a00, 0xffaa22],
              isNova: false,
              elements: ['THERMAL'],
            });
            const dx = player.x - x;
            const dy = player.y - y;
            const dist = Math.hypot(dx, dy);
            if (dist <= range + 16) {
              const angDiff = Math.abs(normalizeAngle(Math.atan2(dy, dx) - angle));
              if (angDiff <= 0.38) {
                let sprayBlocked = false;
                for (const s of this.shields) {
                  const sDist = Math.hypot(player.x - s.x, player.y - s.y);
                  if (sDist <= s.radius + 14) {
                    sprayBlocked = true;
                    s.hp -= damage;
                    break;
                  }
                }
                if (!sprayBlocked) {
                  this.damagePlayer(player, damage, e, onPlayerDamaged, events);
                }
              }
            }
          },
          spawnBeam: (enemy, angle, offsetAngle = 0) => {
            this.beams.push({
              id: this.nextId++,
              owner: 'ENEMY',
              ownerEnemyId: enemy.id,
              x: enemy.x,
              y: enemy.y,
              angle,
              beamOffset: offsetAngle,
              length: 1900,
              width: enemy.archetype === 'WARDEN' ? 16 : 14,
              damagePerSec: Math.round((enemy.archetype === 'WARDEN' ? 34 : 28) * this.difficulty.enemyDamageMult),
              life: enemy.archetype === 'WARDEN' ? 2.8 : 1.8,
              maxLife: enemy.archetype === 'WARDEN' ? 2.8 : 1.8,
              colorHex: 0xb429ff,
              colors: [0xb429ff],
              elements: ['VOID'],
              composition: computeComposition(['VOID']),
              clashing: false,
              clashDist: 1900,
            });
          },
          spawnMinion: (archetype, x, y) => {
            spawnedMinions.push({ archetype, x, y });
          },
          spawnHazard: (x, y, radius, delay, damage, colorHex) => {
            this.hazards.push({
              id: this.nextId++,
              x,
              y,
              radius,
              timer: delay,
              maxTimer: delay,
              damage,
              colorHex,
            });
          },
          damagePlayer: (amount, sourceEnemy) => {
            this.damagePlayer(player, amount, sourceEnemy, onPlayerDamaged, events);
          },
        },
        events,
        this.difficulty,
        arenaBoundary
      );

      // Push enemy outside ArenaPillars, ArenaBlocks & ArenaObstacles, then clamp to ArenaBoundary
      for (const pil of pillars) {
        const pdx = e.x - pil.x;
        const pdy = e.y - pil.y;
        const minD = pil.radius + e.radius;
        const d = Math.hypot(pdx, pdy);
        if (d > 0.01 && d < minD) {
          e.x = pil.x + (pdx / d) * minD;
          e.y = pil.y + (pdy / d) * minD;
        }
      }
      for (const blk of blocks) {
        const hit = circleVsAABB(e.x, e.y, e.radius, blk);
        if (hit.hit) {
          e.x += hit.pushX;
          e.y += hit.pushY;
        }
      }
      for (const obs of obstacles) {
        const hit = circleVsConvexPoly(e.x, e.y, e.radius, obs);
        if (hit.hit) {
          e.x += hit.pushX;
          e.y += hit.pushY;
        }
      }
      const clampedE = clampPointToConvexPoly(e.x, e.y, e.radius + 6, arenaBoundary);
      e.x = clampedE.x;
      e.y = clampedE.y;
    }

    // Update telegraphed hazard zones
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]!;
      h.timer -= dt;
      if (h.timer <= 0) {
        if (Math.hypot(player.x - h.x, player.y - h.y) <= h.radius + 14) {
          this.damagePlayer(player, h.damage, undefined, onPlayerDamaged, events);
        }
        events.push({ type: 'vfx_ring', x: h.x, y: h.y, radius: h.radius, colorHex: h.colorHex });
        events.push({ type: 'vfx_burst', x: h.x, y: h.y, colorHex: h.colorHex, count: 16, radius: h.radius * 0.6 });
        events.push({ type: 'grid_impulse', x: h.x, y: h.y, strength: 160, radius: h.radius + 30 });
        this.hazards.splice(i, 1);
      }
    }

    // Remove dead enemies & handle Splitter death splits
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      if (e.hp <= 0) {
        const wasFrozen = Boolean(e.statuses.FROZEN);
        if (e.archetype === 'SPLITTER' && !wasFrozen) {
          for (let s = 0; s < 2; s++) {
            const a = s * Math.PI + Math.random() * 0.4;
            spawnedMinions.push({
              archetype: 'SWARMER',
              x: e.x + Math.cos(a) * 20,
              y: e.y + Math.sin(a) * 20,
            });
          }
        }
        const killColor =
          e.archetype === 'WARDEN'
            ? 0xff2e97
            : e.archetype === 'BASTION'
            ? 0xe6f0ff
            : e.archetype === 'WEAVER'
            ? 0xb429ff
            : e.archetype === 'STALKER'
            ? 0x00f5ff
            : e.archetype === 'PYRO_SPRAYER'
            ? ELEMENT_META.THERMAL.colorHex
            : e.archetype === 'GEO_BOMBER'
            ? ELEMENT_META.KINETIC.colorHex
            : e.archetype === 'SPLITTER'
            ? 0xfff733
            : 0xff2e97;
        const secColor =
          e.archetype === 'WARDEN'
            ? 0xb429ff
            : e.archetype === 'BASTION'
            ? 0x00f5ff
            : e.archetype === 'WEAVER'
            ? 0xff2e97
            : e.archetype === 'STALKER'
            ? 0xff2e97
            : e.archetype === 'PYRO_SPRAYER'
            ? 0xffaa22
            : e.archetype === 'GEO_BOMBER'
            ? 0xffaa44
            : e.archetype === 'SPLITTER'
            ? 0xffaa22
            : 0xff88cc;
        if (e.nanoMarkTimer > 0) {
          const nanoSiphonStacks = getAugmentStacks(this.augments, 'NANO_SWARM_SIPHON');
          const healAmt = (e.archetype === 'WARDEN' ? 18 + 10 * nanoSiphonStacks : 6 + 5 * nanoSiphonStacks);
          if (player.hp < player.maxHp) {
            player.hp = Math.min(player.maxHp, player.hp + healAmt);
            events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: ELEMENT_META.NANO.colorHex, count: 8, radius: 34 });
            events.push({ type: 'damage_number', x: player.x, y: player.y - 20, text: `+${healAmt} HP`, colorHex: ELEMENT_META.NANO.colorHex });
            events.push({ type: 'sfx', sound: 'heal', elements: ['NANO'] });
          }
          if (nanoSiphonStacks > 0) {
            const boltCount = 2 * nanoSiphonStacks;
            const nanoComp = computeComposition(['NANO']);
            for (let k = 0; k < boltCount; k++) {
              const ba = (k / boltCount) * Math.PI * 2 + Math.random() * 0.4;
              this.projectiles.push({
                id: this.nextId++,
                owner: 'PLAYER',
                kind: 'NANO_BOLT',
                x: e.x + Math.cos(ba) * 14,
                y: e.y + Math.sin(ba) * 14,
                vx: Math.cos(ba) * 540,
                vy: Math.sin(ba) * 540,
                radius: 9,
                damage: 26,
                pierce: 1,
                life: 1.4,
                maxLife: 1.4,
                colorHex: ELEMENT_META.NANO.colorHex,
                colors: [ELEMENT_META.NANO.colorHex],
                elements: ['NANO'],
                composition: nanoComp,
                hitIds: [e.id],
                spin: 0,
              });
            }
          }
        }
        const conflagDeathStacks = getAugmentStacks(this.augments, 'THERMAL_CONFLAGRATION');
        if (conflagDeathStacks > 0 && e.statuses.IGNITED) {
          const cRadius = 125;
          const cDmg = 45 * conflagDeathStacks;
          for (const other of this.enemies) {
            if (other.id !== e.id && other.hp > 0 && Math.hypot(other.x - e.x, other.y - e.y) <= cRadius + other.radius) {
              other.hp -= cDmg / (1 + other.baseArmor);
              other.hitFlash = 0.1;
              this.setStatus(other, 'IGNITED', 3.5, 1);
            }
          }
          events.push({
            type: 'vfx_element_explosion',
            x: e.x,
            y: e.y,
            radius: cRadius,
            elements: ['THERMAL'],
            colors: [ELEMENT_META.THERMAL.colorHex, 0xffaa22],
            power: conflagDeathStacks + 1,
          });
          events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: cRadius, colorHex: ELEMENT_META.THERMAL.colorHex, duration: 0.28 });
          events.push({ type: 'damage_number', x: e.x, y: e.y - e.radius - 20, text: 'CONFLAGRATION!', colorHex: ELEMENT_META.THERMAL.colorHex, big: true });
        }
        const deathStatuses = Object.keys(e.statuses) as StatusType[];
        events.push({
          type: 'vfx_enemy_death',
          x: e.x,
          y: e.y,
          radius: e.radius,
          colorHex: killColor,
          secondaryColorHex: secColor,
          isBoss: e.archetype === 'WARDEN',
          statuses: deathStatuses,
        });
        events.push({ type: 'grid_impulse', x: e.x, y: e.y, strength: e.archetype === 'WARDEN' ? 350 : 95, radius: e.radius * 4 });
        events.push({ type: 'sfx', sound: 'enemy_kill' });
        onKill(e.archetype);
        this.enemies.splice(i, 1);
      }
    }

    for (const m of spawnedMinions) {
      this.spawnEnemy(m.archetype, m.x, m.y, wave);
    }
  }

  private buildWallSegments(): Array<{ a: WallPylonEntity; b: WallPylonEntity }> {
    const groups = new Map<number, WallPylonEntity[]>();
    for (const w of this.walls) {
      let arr = groups.get(w.groupId);
      if (!arr) {
        arr = [];
        groups.set(w.groupId, arr);
      }
      arr.push(w);
    }
    const segs: Array<{ a: WallPylonEntity; b: WallPylonEntity }> = [];
    for (const arr of groups.values()) {
      for (let i = 0; i < arr.length - 1; i++) {
        segs.push({ a: arr[i]!, b: arr[i + 1]! });
      }
      if (arr.length >= 3 && arr[0]!.isNova) {
        segs.push({ a: arr[arr.length - 1]!, b: arr[0]! });
      }
    }
    return segs;
  }
}

export { computeComposition };

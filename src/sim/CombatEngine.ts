import { createEnemy, normalizeAngle, stepEnemyAI } from './EnemyAI';
import { computeComposition, ResolvedSelfCast, ResolvedSpell } from './SpellResolver';
import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  ArenaBlock,
  ArenaPillar,
  BeamEntity,
  ChannelState,
  ChargeState,
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
  SimEvent,
  SlashArcEntity,
  StatusType,
  StormEntity,
  WallPylonEntity,
} from './types';

const MAX_STORMS = 1;
const MAX_MINES = 8;
const MAX_WALL_PYLONS = 16;

function clampArena(x: number, y: number, pad = 24): { x: number; y: number } {
  return {
    x: Math.max(-ARENA_HALF_W + pad, Math.min(ARENA_HALF_W - pad, x)),
    y: Math.max(-ARENA_HALF_H + pad, Math.min(ARENA_HALF_H - pad, y)),
  };
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
  }

  public spawnEnemy(archetype: EnemyArchetype, x: number, y: number, wave: number): EnemyEntity {
    const enemy = createEnemy(this.nextId++, archetype, x, y, wave);
    this.enemies.push(enemy);
    return enemy;
  }

  public startSelfHealChannel(player: PlayerState, selfCast: ResolvedSelfCast, events: SimEvent[]): void {
    const nanoStacks = selfCast.composition.counts.NANO ?? 1;
    const maxDuration = 2.2 + nanoStacks * 0.5;
    player.channel = {
      delivery: 'SELF_HEAL',
      elements: selfCast.elements,
      composition: selfCast.composition,
      remaining: maxDuration,
      maxDuration,
      tickTimer: 0,
      beamId: null,
    };
    player.hp = Math.min(player.maxHp, player.hp + selfCast.healPerSec * 0.25);
    events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 16, radius: 45 });
    events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 64, colorHex: selfCast.colorHex });
    events.push({ type: 'sfx', sound: 'heal' });
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
          this.shields.push({
            id: this.nextId++,
            x: player.x,
            y: player.y,
            angle: player.aimAngle,
            arc: Math.PI,
            radius: 56,
            hp: 180,
            maxHp: 180,
            life: 6,
            maxLife: 6,
            isNova: true,
            colorHex: selfCast.colorHex,
            colors: comp.colors,
          });
        }
        events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 24, radius: 60 });
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 85, colorHex: selfCast.colorHex });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 120 });
        events.push({ type: 'sfx', sound: 'ward' });
        break;
      }

      case 'KINETIC_ARMOR': {
        player.armorHp = Math.min(player.maxArmorHp, player.armorHp + selfCast.armorAmount);
        const radius = 120 + comp.totalPower * 25;
        const hits = this.applyAoEDamage(player.x, player.y, radius, 26 * (counts.KINETIC ?? 1), selfCast.elements, 260, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius, colorHex: selfCast.colorHex });
        events.push({ type: 'vfx_shards', x: player.x, y: player.y, colors: comp.colors, count: 14, speedScale: 0.9 });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 200, radius: radius + 20 });
        events.push({ type: 'screen_shake', intensity: 4 });
        if (selfCast.elements.includes('FLUX') && hits.length > 0 && this.pools.length < 24) {
          this.pools.push({
            id: this.nextId++,
            kind: 'FLUX',
            x: hits[0]!.x,
            y: hits[0]!.y,
            radius: 78,
            life: 5,
            maxLife: 5,
            colorHex: ELEMENT_META.FLUX.colorHex,
            tickTimer: 0.25,
          });
        }
        events.push({ type: 'sfx', sound: 'rock' });
        break;
      }

      case 'SELF_HEAL': {
        this.startSelfHealChannel(player, selfCast, events);
        break;
      }

      case 'VOID_BURST': {
        const radius = 130 + comp.totalPower * 35;
        this.applyAoEDamage(player.x, player.y, radius, 42 * comp.totalPower, selfCast.elements, -160, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius, colorHex: selfCast.colorHex });
        events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 28, radius: radius * 0.7 });
        events.push({ type: 'vfx_shards', x: player.x, y: player.y, colors: comp.colors, count: 18, speedScale: 1.1 });
        events.push({ type: 'grid_well', x: player.x, y: player.y, strength: 240 + comp.totalPower * 40, radius: radius + 40 });
        events.push({ type: 'screen_shake', intensity: 4.5 });
        events.push({ type: 'sfx', sound: 'beam' });
        break;
      }

      case 'VOLT_NOVA': {
        const voltStacks = counts.VOLT ?? 1;
        const arcs = 4 + voltStacks * 3;
        const range = 210 + voltStacks * 65;
        this.castLightningBurst(player.x, player.y, player.aimAngle, arcs, range, 32 * voltStacks, selfCast.elements, comp, true, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: range * 0.7, colorHex: selfCast.colorHex });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160 + voltStacks * 35, radius: range * 0.8 });
        events.push({ type: 'sfx', sound: 'lightning' });
        break;
      }

      case 'ELEMENT_AOE': {
        if (selfCast.elements.includes('FLUX') || selfCast.elements.includes('PLASMA') || selfCast.elements.includes('CRYO') || selfCast.elements.includes('CRYSTAL')) {
          player.ignitedTimer = 0;
        }
        const radius = 135 + comp.totalPower * 45;
        const knockback = selfCast.elements.includes('FLUX') ? 220 : 0;
        const hits = this.applyAoEDamage(player.x, player.y, radius, 28 * comp.totalPower, selfCast.elements, knockback, events);
        events.push({
          type: 'vfx_spray',
          x: player.x,
          y: player.y,
          angle: player.aimAngle,
          spread: Math.PI * 2,
          range: radius,
          colors: comp.weightedColors,
          isNova: true,
        });
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius, colorHex: selfCast.colorHex });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 150 + comp.totalPower * 35, radius: radius + 20 });

        if (selfCast.elements.includes('FLUX') && hits.length > 0 && this.pools.length < 24) {
          const stack = counts.FLUX ?? 1;
          this.pools.push({
            id: this.nextId++,
            kind: 'FLUX',
            x: hits[0]!.x,
            y: hits[0]!.y,
            radius: 75 + stack * 25,
            life: 5,
            maxLife: 5,
            colorHex: ELEMENT_META.FLUX.colorHex,
            tickTimer: 0.25,
          });
        }
        events.push({ type: 'sfx', sound: selfCast.elements.includes('FLUX') ? 'cleanse' : 'spray' });
        break;
      }
    }
  }

  public startCharge(player: PlayerState, spell: ResolvedSpell): void {
    const maxCharge = spell.delivery === 'CRYSTAL_SHARDS' ? 0.75 : 0.85;
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
      const speed = (220 + kineticCount * 22) + r * (600 + kineticCount * 45);
      const range = 160 + r * (780 + kineticCount * 45);
      const life = range / speed;
      const radius = (16 + kineticCount * 7) + r * 7;
      const damage = Math.round(75 * kineticCount * (0.5 + 0.7 * r));
      const pierce = 2 + kineticCount;

      this.spawnRock(player.x, player.y, angle, speed, radius, damage, pierce, life, color, comp, ch.elements);
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 110 + r * 150, radius: 115 + r * 45 });
      events.push({ type: 'screen_shake', intensity: 2.5 + (kineticCount + 1) * r * 1.6 });
      events.push({ type: 'sfx', sound: 'rock' });
    } else if (ch.delivery === 'CRYSTAL_SHARDS') {
      const crystalCount = counts.CRYSTAL ?? 1;
      const count = 7 + crystalCount * 3;
      const speed = 680 + r * 1120;
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
      events.push({ type: 'sfx', sound: 'icicle' });
    }
  }

  public startChannel(player: PlayerState, spell: ResolvedSpell, events: SimEvent[]): void {
    const maxDuration = 2.2 + spell.composition.totalPower * 0.4;
    const delivery = spell.delivery as ChannelState['delivery'];
    let beamId: number | null = null;

    if (delivery === 'BEAM') {
      const counts = spell.composition.counts;
      const beamPower = (counts.VOID ?? 0) + (counts.NANO ?? 0);
      const length = 880 + beamPower * 90;
      const width = 18 + spell.composition.totalPower * 5;
      const b: BeamEntity = {
        id: this.nextId++,
        owner: 'PLAYER',
        x: player.x + Math.cos(player.aimAngle) * 24,
        y: player.y + Math.sin(player.aimAngle) * 24,
        angle: player.aimAngle,
        length,
        width,
        damagePerSec: 88 + spell.composition.totalPower * 22,
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
      events.push({ type: 'sfx', sound: 'beam' });
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
      const knockback = ch.elements.includes('FLUX') ? 230 : 0;
      const hits = this.applyConeDamage(player.x, player.y, angle, spread, range, 11 + comp.totalPower * 4, ch.elements, events, knockback);
      events.push({
        type: 'vfx_spray',
        x: player.x + Math.cos(angle) * 20,
        y: player.y + Math.sin(angle) * 20,
        angle,
        spread,
        range,
        colors: comp.weightedColors,
        isNova: false,
      });
      events.push({
        type: 'grid_impulse',
        x: player.x + Math.cos(angle) * 110,
        y: player.y + Math.sin(angle) * 110,
        strength: 55 + comp.totalPower * 15,
        radius: 110,
      });

      if (ch.elements.includes('FLUX') && hits.length > 0 && Math.random() < 0.35 && this.pools.length < 24) {
        const stack = counts.FLUX ?? 1;
        const target = hits[Math.floor(Math.random() * hits.length)]!;
        const pos = clampArena(target.x, target.y, 45);
        this.pools.push({
          id: this.nextId++,
          kind: 'FLUX',
          x: pos.x,
          y: pos.y,
          radius: 56 + stack * 20,
          life: 5,
          maxLife: 5,
          colorHex: ELEMENT_META.FLUX.colorHex,
          tickTimer: 0.25,
        });
      }
      if (Math.random() < 0.35) {
        events.push({ type: 'sfx', sound: 'spray' });
      }
    } else if (ch.delivery === 'LIGHTNING_BOLT') {
      const voltCount = counts.VOLT ?? 1;
      const range = 440 + voltCount * 65;
      this.castLightningBurst(player.x, player.y, angle, 1, range, 14 * voltCount, ch.elements, comp, false, events);
      if (Math.random() < 0.4) {
        events.push({ type: 'sfx', sound: 'lightning' });
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
        let cur: EnemyEntity | null = firstEnemy;
        let maxJumps = cur.statuses.PRIMED ? 8 : 4;
        while (cur && hitEnemyIds.size < maxJumps) {
          hitEnemyIds.add(cur.id);
          pts.push({ x: cur.x, y: cur.y });
          const isPrimed = Boolean(cur.statuses.PRIMED);
          if (isPrimed) maxJumps = 8;
          this.applyElementalHit(cur, baseDamage, elements, cur.x - ox, cur.y - oy, events);
          events.push({ type: 'vfx_burst', x: cur.x, y: cur.y, colorHex: comp.primaryColorHex, count: 6, radius: 24 });

          const jumpRange = isPrimed ? 360 : 180;
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
    aimX: number,
    aimY: number,
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
        const shieldHp = isNova ? 140 : 420;
        const shieldLife = isNova ? 3.5 : 8.0;
        this.shields.push({
          id: this.nextId++,
          x: player.x,
          y: player.y,
          angle,
          arc: 1.25,
          radius: isNova ? 68 : 74,
          hp: shieldHp,
          maxHp: shieldHp,
          life: shieldLife,
          maxLife: shieldLife,
          isNova,
          colorHex: color,
          colors: comp.colors,
        });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 170, radius: 140 });
        events.push({ type: 'sfx', sound: 'shield' });
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
            const pos = clampArena(player.x + Math.cos(a) * ringR, player.y + Math.sin(a) * ringR);
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
          const halfSpan = nonBarrierPower >= 2 ? 3 : 2;
          const cx = player.x + Math.cos(angle) * 130;
          const cy = player.y + Math.sin(angle) * 130;
          const perpX = -Math.sin(angle);
          const perpY = Math.cos(angle);
          for (let i = -halfSpan; i <= halfSpan; i++) {
            const pos = clampArena(cx + perpX * i * 44, cy + perpY * i * 44);
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
        events.push({ type: 'sfx', sound: 'wall' });
        break;
      }

      case 'MINES': {
        if (spell.isNova) {
          const count = nonBarrierPower >= 2 ? 6 : 4;
          const ringR = nonBarrierPower >= 2 ? 155 : 115;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * ringR, player.y + Math.sin(a) * ringR);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        } else if (nonBarrierPower >= 2) {
          for (let i = 0; i < 5; i++) {
            const a = angle + (i - 2) * 0.28;
            const pos = clampArena(player.x + Math.cos(a) * 150, player.y + Math.sin(a) * 150);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        } else {
          for (let i = 0; i < 3; i++) {
            const a = angle + (i - 1) * 0.34;
            const pos = clampArena(player.x + Math.cos(a) * 135, player.y + Math.sin(a) * 135);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        }
        events.push({ type: 'sfx', sound: 'mine_deploy' });
        break;
      }

      case 'STORM': {
        while (this.storms.length >= MAX_STORMS) {
          this.storms.shift();
        }
        const radius = spell.isNova ? 195 + (nonBarrierPower - 1) * 80 : 185 + nonBarrierPower * 35;
        const life = 4.5 + nonBarrierPower * 0.75;
        const target = spell.isNova ? { x: player.x, y: player.y } : clampArena(aimX, aimY, 90);
        this.storms.push({
          id: this.nextId++,
          x: target.x,
          y: target.y,
          radius,
          life,
          maxLife: life,
          tickTimer: 0.04,
          colorHex: color,
          colors: comp.colors,
          elements: spell.elements,
          composition: comp,
        });
        events.push({ type: 'vfx_ring', x: target.x, y: target.y, radius, colorHex: color });
        events.push({ type: 'grid_impulse', x: target.x, y: target.y, strength: 210, radius: radius * 0.9 });
        events.push({ type: 'sfx', sound: 'storm' });
        break;
      }

      case 'ROCK_THROW': {
        const kineticCount = counts.KINETIC ?? 1;
        const count = 2 + comp.totalPower * 2;
        const radius = 18 + kineticCount * 8;
        const speed = 470 + kineticCount * 35;
        const damage = 68 * kineticCount;
        const pierce = 2 + kineticCount;
        for (let i = 0; i < count; i++) {
          const a = angle + (i / count) * Math.PI * 2;
          this.spawnRock(player.x, player.y, a, speed, radius, damage, pierce, 1.8, color, comp, spell.elements);
        }
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 140 + comp.totalPower * 65, colorHex: color });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 210 + comp.totalPower * 40, radius: 160 + comp.totalPower * 40 });
        events.push({ type: 'screen_shake', intensity: 4 + comp.totalPower * 1.5 });
        events.push({ type: 'sfx', sound: 'rock' });
        break;
      }

      case 'CRYSTAL_SHARDS': {
        const count = 6 + comp.totalPower * 5;
        const speed = 1250;
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
        events.push({ type: 'sfx', sound: 'icicle' });
        break;
      }

      case 'BEAM': {
        const count = 2 + comp.totalPower * 2;
        const length = 260 + comp.totalPower * 130;
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
            damagePerSec: 120,
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
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 140 + comp.totalPower * 65, colorHex: color });
        if (spell.elements.includes('VOID')) {
          events.push({ type: 'grid_well', x: player.x, y: player.y, strength: 220 + comp.totalPower * 60, radius: 190 + comp.totalPower * 50 });
        }
        events.push({ type: 'screen_shake', intensity: 4 + comp.totalPower });
        events.push({ type: 'sfx', sound: 'beam' });
        break;
      }

      case 'LIGHTNING_BOLT': {
        const voltCount = counts.VOLT ?? 1;
        const arcs = 4 + comp.totalPower * 3;
        const range = 200 + comp.totalPower * 95;
        this.castLightningBurst(player.x, player.y, angle, arcs, range, 34 * voltCount, spell.elements, comp, true, events);
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: range * 0.85, colorHex: color });
        events.push({ type: 'sfx', sound: 'lightning' });
        break;
      }

      case 'SPRAY': {
        const range = 165 + (comp.totalPower - 1) * 90;
        const knockback = spell.elements.includes('FLUX') ? 260 : 0;
        const hits = this.applyAoEDamage(player.x, player.y, range, 32 * comp.totalPower, spell.elements, knockback, events);
        events.push({
          type: 'vfx_spray',
          x: player.x,
          y: player.y,
          angle,
          spread: Math.PI * 2,
          range,
          colors: comp.weightedColors,
          isNova: true,
        });
        for (let rIdx = 0; rIdx < comp.totalPower; rIdx++) {
          const ringR = range * (0.55 + rIdx * 0.25);
          const ringColor = comp.colors[rIdx % comp.colors.length]!;
          events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: ringR, colorHex: ringColor, duration: 0.32 + rIdx * 0.08 });
        }

        if (spell.elements.includes('FLUX') && hits.length > 0) {
          const stack = counts.FLUX ?? 1;
          const puddleCount = Math.min(hits.length, 2 + comp.totalPower);
          for (let i = 0; i < puddleCount && this.pools.length < 24; i++) {
            const target = hits[i % hits.length]!;
            const pos = clampArena(target.x, target.y, 45);
            this.pools.push({
              id: this.nextId++,
              kind: 'FLUX',
              x: pos.x,
              y: pos.y,
              radius: 56 + stack * 20,
              life: 5,
              maxLife: 5,
              colorHex: ELEMENT_META.FLUX.colorHex,
              tickTimer: 0.25,
            });
          }
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 140 + comp.totalPower * 55, radius: range * 0.85 });
        events.push({ type: 'sfx', sound: 'spray' });
        break;
      }

      case 'PHASE_SLASH': {
        const radius = 125 + comp.totalPower * 18;
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
            const pos = clampArena(player.x + Math.cos(angle) * i * 42, player.y + Math.sin(angle) * i * 42);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        }
        events.push({ type: 'sfx', sound: 'slash' });
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
    while (this.mines.length >= MAX_MINES) {
      this.mines.shift();
    }
    this.mines.push({
      id: this.nextId++,
      x,
      y,
      radius: 16,
      triggerRadius: 46,
      blastRadius: 135 + composition.totalPower * 30,
      damage: 65,
      armTimer: 0.35,
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
    const blastRadius = 95 + kineticCount * 38;

    const hits = this.applyAoEDamage(p.x, p.y, blastRadius, p.damage, p.elements, 320, events);
    events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 220 + kineticCount * 90, radius: blastRadius + 50 });
    events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: p.colorHex, count: 22 + kineticCount * 6, radius: blastRadius * 0.7 });
    events.push({ type: 'vfx_shards', x: p.x, y: p.y, colors: p.colors, count: 16 + kineticCount * 6, speedScale: 1.25 });
    events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: blastRadius, colorHex: p.colorHex });
    events.push({ type: 'screen_shake', intensity: 5 + kineticCount * 2 });

    if (p.elements.includes('FLUX') && (hitTarget || hits.length > 0) && this.pools.length < 24) {
      const stack = counts.FLUX ?? 1;
      for (let i = 0; i < stack && this.pools.length < 24; i++) {
        const a = (i / stack) * Math.PI * 2 + Math.random() * 0.5;
        const offset = stack > 1 ? 36 : 0;
        const pos = clampArena(p.x + Math.cos(a) * offset, p.y + Math.sin(a) * offset, 45);
        this.pools.push({
          id: this.nextId++,
          kind: 'FLUX',
          x: pos.x,
          y: pos.y,
          radius: 52 + stack * 22,
          life: 5.5,
          maxLife: 5.5,
          colorHex: ELEMENT_META.FLUX.colorHex,
          tickTimer: 0.25,
        });
      }
    }

    const voidCount = counts.VOID ?? 0;
    if (voidCount > 0) {
      events.push({ type: 'grid_well', x: p.x, y: p.y, strength: 220 * voidCount, radius: 170 });
    }
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
          events.push({ type: 'vfx_shards', x: e.x, y: e.y, colors: [0xe6f0ff, 0xe8741a], count: 16, speedScale: 1.2 });
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

    let dmg = rawDamage;

    // Primer combos
    if (e.statuses.PRIMED && elements.includes('VOLT')) {
      dmg *= 2.0;
      if (!this.comboTextCooldown.has(e.id)) {
        this.comboTextCooldown.set(e.id, 0.35);
        events.push({ type: 'damage_number', x: e.x, y: e.y - e.radius - 10, text: 'OVERLOAD!', colorHex: 0xfff733, big: true });
      }
    }

    // Shatter combo: FROZEN + (KINETIC | VOID)
    if (e.statuses.FROZEN && (elements.includes('KINETIC') || elements.includes('VOID'))) {
      delete e.statuses.FROZEN;
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

      // Fire 6 piercing ice shards radially
      const comp = computeComposition(['CRYSTAL']);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
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
    }

    // Apply armor mitigation (IGNITED shreds 50%)
    const effectiveArmor = e.statuses.IGNITED ? e.baseArmor * 0.5 : e.baseArmor;
    dmg = dmg / (1 + effectiveArmor);

    e.hp -= dmg;
    e.hitFlash = 0.1;

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

    // Apply status effects
    for (const el of elements) {
      if (el === 'FLUX' || el === 'PLASMA') {
        this.setStatus(e, 'PRIMED', 5, 1);
      }
      if (el === 'THERMAL' || el === 'PLASMA') {
        delete e.statuses.FROZEN;
        delete e.statuses.CHILLED;
        this.setStatus(e, 'IGNITED', 3.5, 1);
      }
      if (el === 'CRYO' || el === 'CRYSTAL') {
        if (e.statuses.PRIMED) {
          delete e.statuses.PRIMED;
          this.setStatus(e, 'FROZEN', 2.5, 1);
        } else if (!e.statuses.FROZEN) {
          this.setStatus(e, 'CHILLED', 3.0, 1);
        }
      }
      if (el === 'NANO') {
        this.setStatus(e, 'CORRUPTED', 4.0, 1);
      }
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
        events.push({ type: 'vfx_shards', x: player.x, y: player.y, colors: [0xe8741a], count: 12, speedScale: 1 });
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
    selfHeld: boolean,
    wave: number,
    pillars: readonly ArenaPillar[],
    onKill: (archetype: EnemyArchetype) => void,
    onPlayerDamaged: () => void,
    events: SimEvent[],
    blocks: readonly ArenaBlock[] = []
  ): void {
    // Update active charge
    for (const [eid, cd] of this.comboTextCooldown.entries()) {
      const next = cd - dt;
      if (next <= 0) this.comboTextCooldown.delete(eid);
      else this.comboTextCooldown.set(eid, next);
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
      if (ch.delivery === 'SELF_HEAL') {
        if (!selfHeld || ch.remaining <= 0) {
          this.stopChannel(player);
        } else {
          const nanoStacks = ch.composition.counts.NANO ?? 1;
          player.hp = Math.min(player.maxHp, player.hp + nanoStacks * 24 * dt);
          ch.tickTimer -= dt;
          if (ch.tickTimer <= 0) {
            ch.tickTimer = 0.18;
            events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 56, colorHex: ELEMENT_META.NANO.colorHex });
            events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: ELEMENT_META.NANO.colorHex, count: 8, radius: 35 });
          }
        }
      } else if (!castHeld || ch.remaining <= 0) {
        this.stopChannel(player);
      } else if (ch.delivery === 'BEAM') {
        const beam = this.beams.find((b) => b.id === ch.beamId);
        if (beam) {
          beam.life = 0.2;
          beam.angle = player.aimAngle;
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
          ch.tickTimer = ch.delivery === 'SPRAY' ? 0.06 : 0.075;
          this.emitChannelTick(player, ch, events);
        }
      }
    }

    // Update projectiles & collisions
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;
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
          this.damagePlayer(player, p.damage, undefined, onPlayerDamaged, events);
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      const hitWall = Math.abs(p.x) > ARENA_HALF_W - p.radius || Math.abs(p.y) > ARENA_HALF_H - p.radius;
      const hitPillar = pillars.some((pil) => Math.hypot(p.x - pil.x, p.y - pil.y) <= pil.radius + p.radius);
      const hitBlock = blocks.some((blk) => circleVsAABB(p.x, p.y, p.radius, blk).hit);
      if (p.life <= 0 || hitWall || hitPillar || hitBlock) {
        if (p.kind === 'ROCK') {
          this.detonateRock(p, events, hitWall || hitPillar || hitBlock);
        } else if (hitPillar || hitBlock) {
          events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: p.colorHex, count: 6, radius: 22 });
          if (p.owner === 'PLAYER' && p.elements.includes('FLUX') && this.pools.length < 24) {
            this.pools.push({
              id: this.nextId++,
              kind: 'FLUX',
              x: p.x,
              y: p.y,
              radius: 46,
              life: 4.5,
              maxLife: 4.5,
              colorHex: ELEMENT_META.FLUX.colorHex,
              tickTimer: 0.25,
            });
          }
        }
        this.projectiles.splice(i, 1);
      }
    }

    // Update beams, Beam Clashes, and Beam hits (only create puddles on object hit!)
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

      // Truncate beam at nearest ArenaPillar or ArenaBlock
      let pillarLimit = b.length;
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
            // Spawn water puddle ONLY at object hit point!
            if (b.elements.includes('FLUX') && Math.random() < 0.08 && this.pools.length < 24) {
              const hx = b.x + cos * along;
              const hy = b.y + sin * along;
              this.pools.push({
                id: this.nextId++,
                kind: 'FLUX',
                x: hx,
                y: hy,
                radius: 48,
                life: 5,
                maxLife: 5,
                colorHex: ELEMENT_META.FLUX.colorHex,
                tickTimer: 0.25,
              });
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
          b.angle = owner.beamAngle;
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

    // Update shields
    for (let i = this.shields.length - 1; i >= 0; i--) {
      const s = this.shields[i]!;
      s.life -= dt;
      s.x = player.x;
      s.y = player.y;
      s.angle = player.aimAngle;
      if (s.life <= 0 || s.hp <= 0) {
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
            this.applyElementalHit(e, 16, ['VOLT'], e.x - closest.cx, e.y - closest.cy, events, true);
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
          this.applyAoEDamage(w.x, w.y, 92, 14, ['THERMAL'], 45, events);
          events.push({ type: 'vfx_ring', x: w.x, y: w.y, radius: 85, colorHex: ELEMENT_META.THERMAL.colorHex, duration: 0.28 });
        }
        if (w.elements.includes('CRYO') || w.elements.includes('CRYSTAL')) {
          this.applyAoEDamage(w.x, w.y, 92, 8, ['CRYO'], 20, events);
        }
        if (w.elements.includes('FLUX')) {
          const hitWater = this.applyAoEDamage(w.x, w.y, 70, 0, [], 0, events);
          if (hitWater.length > 0 && this.pools.length < 24) {
            this.pools.push({
              id: this.nextId++,
              kind: 'FLUX',
              x: hitWater[0]!.x,
              y: hitWater[0]!.y,
              radius: 52,
              life: 4.5,
              maxLife: 4.5,
              colorHex: ELEMENT_META.FLUX.colorHex,
              tickTimer: 0.25,
            });
          }
        }
        if (w.elements.includes('VOID')) {
          this.applyAoEDamage(w.x, w.y, 135, 10, ['VOID'], -75, events);
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
        this.applyAoEDamage(m.x, m.y, m.blastRadius, m.damage, m.elements, 280, events);
        events.push({ type: 'vfx_burst', x: m.x, y: m.y, colorHex: m.colorHex, count: 20, radius: m.blastRadius * 0.6 });
        events.push({ type: 'vfx_shards', x: m.x, y: m.y, colors: m.colors, count: 14, speedScale: 1.1 });
        events.push({ type: 'vfx_ring', x: m.x, y: m.y, radius: m.blastRadius, colorHex: m.colorHex });
        events.push({ type: 'grid_impulse', x: m.x, y: m.y, strength: 220, radius: m.blastRadius + 30 });
        events.push({ type: 'sfx', sound: 'mine_explode' });
        this.mines.splice(i, 1);
        continue;
      }
      if (m.life <= 0) {
        this.mines.splice(i, 1);
      }
    }

    // Update storms
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i]!;
      s.life -= dt;
      s.tickTimer -= dt;
      if (s.tickTimer <= 0) {
        const counts = s.composition.counts;
        const nonBarrierPower = Math.max(1, s.composition.totalPower - (counts.BARRIER ?? 0));
        s.tickTimer = nonBarrierPower >= 2 ? 0.18 : 0.32;

        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * s.radius * 0.78;
        const sx = s.x + Math.cos(a) * d;
        const sy = s.y + Math.sin(a) * d;
        const strikeRadius = 56 + nonBarrierPower * 22;

        const hits = this.applyAoEDamage(sx, sy, strikeRadius, 28 * nonBarrierPower, s.elements, 90, events);

        const payloadColors = s.colors.filter((c) => c !== ELEMENT_META.BARRIER.colorHex);
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

        if (s.elements.includes('FLUX') && hits.length > 0 && this.pools.length < 24) {
          const stack = counts.FLUX ?? 1;
          this.pools.push({
            id: this.nextId++,
            kind: 'FLUX',
            x: hits[0]!.x,
            y: hits[0]!.y,
            radius: 52 + stack * 20,
            life: 5,
            maxLife: 5,
            colorHex: ELEMENT_META.FLUX.colorHex,
            tickTimer: 0.25,
          });
        }
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
      for (const stKey of Object.keys(e.statuses) as StatusType[]) {
        const st = e.statuses[stKey];
        if (!st) continue;
        st.remaining -= dt;
        if (stKey === 'IGNITED') {
          e.hp -= 14 * st.stacks * dt;
        } else if (stKey === 'CORRUPTED' && e.shieldHp > 0) {
          e.shieldHp = Math.max(0, e.shieldHp - 35 * st.stacks * dt);
        }
        if (st.remaining <= 0) {
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
          spawnBeam: (enemy, angle) => {
            this.beams.push({
              id: this.nextId++,
              owner: 'ENEMY',
              ownerEnemyId: enemy.id,
              x: enemy.x,
              y: enemy.y,
              angle,
              length: 620,
              width: 14,
              damagePerSec: 28,
              life: enemy.archetype === 'WARDEN' ? 2.2 : 1.8,
              maxLife: enemy.archetype === 'WARDEN' ? 2.2 : 1.8,
              colorHex: 0xb429ff,
              colors: [0xb429ff],
              elements: ['VOID'],
              composition: computeComposition(['VOID']),
              clashing: false,
              clashDist: 620,
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
        events
      );

      // Push enemy outside ArenaPillars & ArenaBlocks
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
        const killColor = e.archetype === 'WARDEN' ? 0xff2e97 : e.archetype === 'BASTION' ? 0xe6f0ff : 0xff2e97;
        events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: killColor, count: e.archetype === 'WARDEN' ? 40 : 12, radius: e.radius * 2 });
        events.push({ type: 'vfx_shards', x: e.x, y: e.y, colors: [killColor], count: e.archetype === 'WARDEN' ? 26 : 6, speedScale: 1 });
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

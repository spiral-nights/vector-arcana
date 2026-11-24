import { computeComposition, ResolvedSelfCast, ResolvedSpell } from './SpellResolver';
import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  BeamEntity,
  ChannelState,
  ELEMENT_META,
  ElementComposition,
  MineEntity,
  PlayerState,
  PoolEntity,
  ProjectileEntity,
  QueueElement,
  ShieldBarrierEntity,
  SimEvent,
  SlashArcEntity,
  StormEntity,
  WallPylonEntity,
} from './types';

function clampArena(x: number, y: number, pad = 24): { x: number; y: number } {
  return {
    x: Math.max(-ARENA_HALF_W + pad, Math.min(ARENA_HALF_W - pad, x)),
    y: Math.max(-ARENA_HALF_H + pad, Math.min(ARENA_HALF_H - pad, y)),
  };
}

export class CombatEngine {
  private nextId = 1;
  public projectiles: ProjectileEntity[] = [];
  public beams: BeamEntity[] = [];
  public walls: WallPylonEntity[] = [];
  public mines: MineEntity[] = [];
  public storms: StormEntity[] = [];
  public shields: ShieldBarrierEntity[] = [];
  public pools: PoolEntity[] = [];
  public slashes: SlashArcEntity[] = [];

  public reset(): void {
    this.nextId = 1;
    this.projectiles = [];
    this.beams = [];
    this.walls = [];
    this.mines = [];
    this.storms = [];
    this.shields = [];
    this.pools = [];
    this.slashes = [];
  }

  public castSelf(player: PlayerState, selfCast: ResolvedSelfCast, events: SimEvent[]): void {
    if (selfCast.effect === 'HEAL') {
      player.hp = Math.min(player.maxHp, player.hp + selfCast.healPower);
      events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 24, radius: 55 });
      events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 70, colorHex: selfCast.colorHex });
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 130, radius: 110 });
      events.push({ type: 'sfx', sound: 'heal' });
    } else if (selfCast.effect === 'CLEANSE') {
      player.ignitedTimer = 0;
      player.toxinTimer = 0;
      events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 24, radius: 55 });
      events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 70, colorHex: selfCast.colorHex });
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 130, radius: 110 });
      events.push({ type: 'sfx', sound: 'cleanse' });
    } else if (selfCast.effect === 'WARD') {
      player.wardRemaining = 6;
      player.wardMaxDuration = 6;
      player.wardElement = selfCast.wardElement;
      events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 28, radius: 60 });
      events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: 85, colorHex: selfCast.colorHex });
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 120 });
      events.push({ type: 'sfx', sound: 'ward' });
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
        damagePerSec: 120 + spell.composition.totalPower * 25,
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

    // Trigger immediate first tick for Spray / Lightning
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
      const range = 310 + comp.totalPower * 45;
      const spread = 0.85;
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

      const puddleKind = ch.elements.includes('TOXIN')
        ? 'TOXIN'
        : ch.elements.includes('PLASMA')
        ? 'PLASMA'
        : ch.elements.includes('FLUX')
        ? 'FLUX'
        : null;
      if (puddleKind && Math.random() < 0.32 && this.pools.length < 24) {
        const stack = counts[puddleKind] ?? 1;
        const dist = 120 + Math.random() * (range - 140);
        const a = angle + (Math.random() - 0.5) * spread * 0.8;
        const pos = clampArena(player.x + Math.cos(a) * dist, player.y + Math.sin(a) * dist, 45);
        this.pools.push({
          id: this.nextId++,
          kind: puddleKind,
          x: pos.x,
          y: pos.y,
          radius: 56 + stack * 20,
          life: 5,
          maxLife: 5,
          colorHex: ELEMENT_META[puddleKind].colorHex,
          tickTimer: 0.25,
        });
      }
      if (Math.random() < 0.35) {
        events.push({ type: 'sfx', sound: 'spray' });
      }
    } else if (ch.delivery === 'LIGHTNING_BOLT') {
      const voltCount = counts.VOLT ?? 1;
      const range = 440 + voltCount * 65;
      const pts: Array<{ x: number; y: number }> = [
        { x: player.x + Math.cos(angle) * 20, y: player.y + Math.sin(angle) * 20 },
      ];
      let curX = pts[0]!.x;
      let curY = pts[0]!.y;

      const candidates = [
        ...this.mines.map((m) => ({ x: m.x, y: m.y })),
        ...this.walls.map((w) => ({ x: w.x, y: w.y })),
      ].filter((c) => Math.hypot(c.x - curX, c.y - curY) < range);

      if (candidates.length > 0 && Math.random() < 0.45) {
        for (const c of candidates.slice(0, 4)) {
          pts.push({ x: c.x, y: c.y });
          curX = c.x;
          curY = c.y;
        }
      } else {
        const jitterA = angle + (Math.random() - 0.5) * 0.18;
        const midX = curX + Math.cos(jitterA) * (range * 0.55) + (Math.random() - 0.5) * 40;
        const midY = curY + Math.sin(jitterA) * (range * 0.55) + (Math.random() - 0.5) * 40;
        const tx = curX + Math.cos(jitterA) * range;
        const ty = curY + Math.sin(jitterA) * range;
        pts.push({ x: midX, y: midY }, { x: tx, y: ty });
        curX = tx;
        curY = ty;
      }

      events.push({ type: 'vfx_lightning', points: pts, colors: comp.colors });

      // Secondary element side-forks
      if (comp.colors.length > 1) {
        const forkA = angle + (Math.random() > 0.5 ? 0.32 : -0.32);
        const fx = curX - Math.cos(angle) * 90 + Math.cos(forkA) * 110;
        const fy = curY - Math.sin(angle) * 90 + Math.sin(forkA) * 110;
        events.push({
          type: 'vfx_lightning',
          points: [{ x: (pts[0]!.x + curX) * 0.5, y: (pts[0]!.y + curY) * 0.5 }, { x: fx, y: fy }],
          colors: [comp.secondaryColorHex],
        });
      }

      events.push({ type: 'vfx_burst', x: curX, y: curY, colorHex: comp.primaryColorHex, count: 10, radius: 42 });
      events.push({ type: 'grid_impulse', x: curX, y: curY, strength: 105 + voltCount * 30, radius: 110 });
      if (Math.random() < 0.4) {
        events.push({ type: 'sfx', sound: 'lightning' });
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

    switch (spell.delivery) {
      case 'SHIELD': {
        this.shields.push({
          id: this.nextId++,
          x: player.x,
          y: player.y,
          angle,
          arc: 1.2,
          radius: 72,
          hp: 180,
          maxHp: 180,
          life: 5,
          maxLife: 5,
          isNova: spell.isNova,
          colorHex: color,
          colors: comp.colors,
        });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 170, radius: 140 });
        events.push({ type: 'sfx', sound: 'shield' });
        break;
      }

      case 'WALL': {
        const kineticCount = counts.KINETIC ?? 1;
        const hp = 100 + kineticCount * 50;
        if (spell.isNova) {
          const count = 8;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * 115, player.y + Math.sin(a) * 115);
            this.walls.push({
              id: this.nextId++,
              x: pos.x,
              y: pos.y,
              radius: 22,
              hp,
              maxHp: hp,
              life: 8,
              maxLife: 8,
              colorHex: color,
              colors: comp.colors,
              elements: spell.elements,
              composition: comp,
            });
          }
        } else {
          const cx = player.x + Math.cos(angle) * 130;
          const cy = player.y + Math.sin(angle) * 130;
          const perpX = -Math.sin(angle);
          const perpY = Math.cos(angle);
          for (let i = -2; i <= 2; i++) {
            const pos = clampArena(cx + perpX * i * 46, cy + perpY * i * 46);
            this.walls.push({
              id: this.nextId++,
              x: pos.x,
              y: pos.y,
              radius: 22,
              hp,
              maxHp: hp,
              life: 8,
              maxLife: 8,
              colorHex: color,
              colors: comp.colors,
              elements: spell.elements,
              composition: comp,
            });
          }
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 145 });
        events.push({ type: 'sfx', sound: 'wall' });
        break;
      }

      case 'MINES': {
        if (spell.isNova) {
          const count = 8;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * 120, player.y + Math.sin(a) * 120);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        } else {
          const count = 5;
          for (let i = 0; i < count; i++) {
            const a = angle + (i - 2) * 0.28;
            const pos = clampArena(player.x + Math.cos(a) * 150, player.y + Math.sin(a) * 150);
            this.spawnMine(pos.x, pos.y, color, comp, spell.elements);
          }
        }
        events.push({ type: 'sfx', sound: 'mine_deploy' });
        break;
      }

      case 'STORM': {
        const nonAegisPower = Math.max(1, comp.totalPower - (counts.AEGIS ?? 0));
        const radius = 185 + nonAegisPower * 30;
        const life = 4.5 + nonAegisPower * 0.75;
        const target = spell.isNova
          ? { x: player.x, y: player.y }
          : clampArena(aimX, aimY, 90);
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
        const radius = 18 + kineticCount * 8;
        const speed = 480 + kineticCount * 35;
        const damage = 40 * kineticCount;
        const pierce = 2 + kineticCount;
        if (spell.isNova) {
          for (let i = 0; i < 4; i++) {
            const a = angle + (i / 4) * Math.PI * 2;
            this.spawnRock(player.x, player.y, a, speed, radius, damage, pierce, color, comp, spell.elements);
          }
        } else {
          this.spawnRock(player.x, player.y, angle, speed, radius, damage, pierce, color, comp, spell.elements);
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 180, radius: 130 });
        events.push({ type: 'screen_shake', intensity: 4 + kineticCount * 1.5 });
        events.push({ type: 'sfx', sound: 'rock' });
        break;
      }

      case 'ICICLE_VOLLEY': {
        const crystalCount = counts.CRYSTAL ?? 1;
        const count = spell.isNova ? 14 + crystalCount * 4 : 7 + crystalCount * 3;
        const spread = spell.isNova ? Math.PI * 2 : 0.45;
        const speed = 740;
        for (let i = 0; i < count; i++) {
          const a = spell.isNova
            ? angle + (i / count) * Math.PI * 2
            : angle + ((i / (count - 1)) - 0.5) * spread;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'PLAYER',
            kind: 'ICICLE',
            x: player.x + Math.cos(a) * 22,
            y: player.y + Math.sin(a) * 22,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 12,
            damage: 24,
            pierce: 4,
            life: 1.6,
            maxLife: 1.6,
            colorHex: color,
            colors: comp.colors,
            elements: spell.elements,
            composition: comp,
            hitIds: [],
            spin: 0,
          });
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 115, radius: 110 });
        events.push({ type: 'sfx', sound: 'icicle' });
        break;
      }

      case 'BEAM': {
        // Nova Beam (Forward Beam is channeled via startChannel)
        const beamPower = (counts.VOID ?? 0) + (counts.NANO ?? 0);
        const length = 880 + beamPower * 90;
        const width = 18 + comp.totalPower * 5;
        const count = 6;
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
        if (spell.elements.includes('VOID')) {
          events.push({ type: 'grid_well', x: player.x, y: player.y, strength: 260, radius: 220 });
        }
        events.push({ type: 'screen_shake', intensity: 4.5 });
        events.push({ type: 'sfx', sound: 'beam' });
        break;
      }

      case 'LIGHTNING_BOLT': {
        // Nova Lightning (Forward Lightning is channeled via startChannel)
        const voltCount = counts.VOLT ?? 1;
        const arcs = 8;
        const range = 440 + voltCount * 65;
        for (let i = 0; i < arcs; i++) {
          const a = angle + (i / arcs) * Math.PI * 2;
          const tx = player.x + Math.cos(a) * range;
          const ty = player.y + Math.sin(a) * range;
          events.push({ type: 'vfx_lightning', points: [{ x: player.x, y: player.y }, { x: tx, y: ty }], colors: comp.colors });
          events.push({ type: 'vfx_burst', x: tx, y: ty, colorHex: color, count: 12, radius: 40 });
          events.push({ type: 'grid_impulse', x: tx, y: ty, strength: 140, radius: 110 });
        }
        events.push({ type: 'sfx', sound: 'lightning' });
        break;
      }

      case 'SPRAY': {
        // Nova Spray (Forward Spray is channeled via startChannel)
        const range = 310 + comp.totalPower * 45;
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
        events.push({ type: 'vfx_ring', x: player.x, y: player.y, radius: range * 0.75, colorHex: color });
        const puddleKind = spell.elements.includes('TOXIN')
          ? 'TOXIN'
          : spell.elements.includes('PLASMA')
          ? 'PLASMA'
          : spell.elements.includes('FLUX')
          ? 'FLUX'
          : null;
        if (puddleKind) {
          const stack = counts[puddleKind] ?? 1;
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * 140, player.y + Math.sin(a) * 140, 45);
            this.pools.push({
              id: this.nextId++,
              kind: puddleKind,
              x: pos.x,
              y: pos.y,
              radius: 60 + stack * 22,
              life: 5,
              maxLife: 5,
              colorHex: ELEMENT_META[puddleKind].colorHex,
              tickTimer: 0.25,
            });
          }
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 150 });
        events.push({ type: 'sfx', sound: 'spray' });
        break;
      }

      case 'PHASE_SLASH': {
        const radius = 125 + comp.totalPower * 18;
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
        if (spell.hasAegisTrail) {
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
    this.mines.push({
      id: this.nextId++,
      x,
      y,
      radius: 16,
      triggerRadius: 46,
      blastRadius: 135 + composition.totalPower * 25,
      damage: 50,
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
      life: 2.6,
      maxLife: 2.6,
      colorHex,
      colors: composition.colors,
      elements,
      composition,
      hitIds: [],
      spin: 0,
    });
  }

  private detonateRock(p: ProjectileEntity, events: SimEvent[]): void {
    const counts = p.composition.counts;
    const kineticCount = counts.KINETIC ?? 1;
    const blastRadius = 85 + kineticCount * 35;

    events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 220 + kineticCount * 90, radius: blastRadius + 50 });
    events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: p.colorHex, count: 22 + kineticCount * 6, radius: blastRadius * 0.7 });
    events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: blastRadius, colorHex: p.colorHex });
    events.push({ type: 'screen_shake', intensity: 5 + kineticCount * 2 });

    // Proportional secondary elemental payload effects
    const puddleEl = p.elements.includes('TOXIN')
      ? 'TOXIN'
      : p.elements.includes('PLASMA')
      ? 'PLASMA'
      : p.elements.includes('FLUX')
      ? 'FLUX'
      : null;
    if (puddleEl) {
      const stack = counts[puddleEl] ?? 1;
      for (let i = 0; i < stack; i++) {
        const a = (i / stack) * Math.PI * 2 + Math.random() * 0.5;
        const offset = stack > 1 ? 36 : 0;
        const pos = clampArena(p.x + Math.cos(a) * offset, p.y + Math.sin(a) * offset, 45);
        this.pools.push({
          id: this.nextId++,
          kind: puddleEl,
          x: pos.x,
          y: pos.y,
          radius: 52 + stack * 22,
          life: 5.5,
          maxLife: 5.5,
          colorHex: ELEMENT_META[puddleEl].colorHex,
          tickTimer: 0.25,
        });
      }
    }

    const thermalCount = counts.THERMAL ?? 0;
    if (thermalCount > 0) {
      events.push({
        type: 'vfx_ring',
        x: p.x,
        y: p.y,
        radius: 95 + thermalCount * 30,
        colorHex: ELEMENT_META.THERMAL.colorHex,
      });
    }

    const voidCount = counts.VOID ?? 0;
    if (voidCount > 0) {
      events.push({ type: 'grid_well', x: p.x, y: p.y, strength: 220 * voidCount, radius: 170 });
    }

    const cryoCount = (counts.CRYO ?? 0) + (counts.CRYSTAL ?? 0);
    if (cryoCount > 0) {
      events.push({
        type: 'vfx_burst',
        x: p.x,
        y: p.y,
        colorHex: ELEMENT_META.CRYO.colorHex,
        count: 14 * cryoCount,
        radius: 75,
      });
    }
  }

  public step(dt: number, player: PlayerState, castHeld: boolean, events: SimEvent[]): void {
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
            if (ch.composition.colors.length > 1) {
              const dist = 160 + Math.random() * 280;
              events.push({
                type: 'vfx_burst',
                x: beam.x + Math.cos(beam.angle) * dist,
                y: beam.y + Math.sin(beam.angle) * dist,
                colorHex: ch.composition.secondaryColorHex,
                count: 6,
                radius: 30,
              });
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

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 7;

      // Secondary elemental trail for multi-element rocks
      if (p.kind === 'ROCK' && p.colors.length > 1 && Math.random() < 0.45) {
        const trailColor = p.composition.secondaryColorHex;
        events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: trailColor, count: 3, radius: 18 });
      }

      const hitWall =
        Math.abs(p.x) > ARENA_HALF_W - p.radius || Math.abs(p.y) > ARENA_HALF_H - p.radius;
      if (p.life <= 0 || hitWall) {
        if (p.kind === 'ROCK') {
          this.detonateRock(p, events);
        }
        this.projectiles.splice(i, 1);
      }
    }

    // Update non-channeled beams (e.g. Nova beams)
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      if (player.channel && player.channel.beamId === b.id) continue;
      b.life -= dt;
      if (b.life <= 0) {
        this.beams.splice(i, 1);
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

    // Update walls
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i]!;
      w.life -= dt;
      if (w.life <= 0 || w.hp <= 0) {
        this.walls.splice(i, 1);
      }
    }

    // Update mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]!;
      m.armTimer = Math.max(0, m.armTimer - dt);
      m.life -= dt;
      if (m.life <= 0) {
        this.mines.splice(i, 1);
      }
    }

    // Update storms with ratio-driven cadence and 3D orbital strikes
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i]!;
      s.life -= dt;
      s.tickTimer -= dt;
      if (s.tickTimer <= 0) {
        const counts = s.composition.counts;
        const nonAegisPower = Math.max(1, s.composition.totalPower - (counts.AEGIS ?? 0));
        s.tickTimer = nonAegisPower >= 2 ? 0.18 : 0.32;

        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * s.radius * 0.78;
        const sx = s.x + Math.cos(a) * d;
        const sy = s.y + Math.sin(a) * d;

        events.push({
          type: 'vfx_storm_strike',
          x: sx,
          y: sy,
          colorHex: s.colorHex,
          secondaryColorHex: s.composition.secondaryColorHex,
          radius: 42 + nonAegisPower * 16,
        });
        events.push({
          type: 'vfx_ring',
          x: sx,
          y: sy,
          radius: 46 + nonAegisPower * 18,
          colorHex: s.colorHex,
        });
        events.push({ type: 'grid_impulse', x: sx, y: sy, strength: 155 + nonAegisPower * 45, radius: 120 });

        const puddleKind = s.elements.includes('PLASMA')
          ? 'PLASMA'
          : s.elements.includes('FLUX')
          ? 'FLUX'
          : null;
        if (puddleKind && this.pools.length < 24) {
          const stack = counts[puddleKind] ?? 1;
          this.pools.push({
            id: this.nextId++,
            kind: puddleKind,
            x: sx,
            y: sy,
            radius: 52 + stack * 20,
            life: 5,
            maxLife: 5,
            colorHex: ELEMENT_META[puddleKind].colorHex,
            tickTimer: 0.25,
          });
        }
      }
      if (s.life <= 0) {
        this.storms.splice(i, 1);
      }
    }

    // Update pools
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i]!;
      p.life -= dt;
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
  }
}

export { computeComposition };

import { ResolvedSelfCast, ResolvedSpell } from './SpellResolver';
import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  BeamEntity,
  ELEMENT_META,
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
      events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 20, radius: 40 });
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 110, radius: 90 });
      events.push({ type: 'sfx', sound: 'heal' });
    } else if (selfCast.effect === 'CLEANSE') {
      player.ignitedTimer = 0;
      player.toxinTimer = 0;
      events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 20, radius: 40 });
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 110, radius: 90 });
      events.push({ type: 'sfx', sound: 'cleanse' });
    } else if (selfCast.effect === 'WARD') {
      player.wardRemaining = 6;
      player.wardMaxDuration = 6;
      player.wardElement = selfCast.wardElement;
      events.push({ type: 'vfx_burst', x: player.x, y: player.y, colorHex: selfCast.colorHex, count: 24, radius: 50 });
      events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 140, radius: 110 });
      events.push({ type: 'sfx', sound: 'ward' });
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
    const color = spell.primaryColorHex;

    switch (spell.delivery) {
      case 'SHIELD': {
        this.shields.push({
          id: this.nextId++,
          x: player.x,
          y: player.y,
          angle,
          arc: 0.95,
          radius: 48,
          hp: 150,
          maxHp: 150,
          life: 4.5,
          maxLife: 4.5,
          isNova: spell.isNova,
          colorHex: color,
        });
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 150, radius: 120 });
        events.push({ type: 'sfx', sound: 'shield' });
        break;
      }

      case 'WALL': {
        if (spell.isNova) {
          const count = 8;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * 86, player.y + Math.sin(a) * 86);
            this.walls.push({
              id: this.nextId++,
              x: pos.x,
              y: pos.y,
              radius: 14,
              hp: 90,
              maxHp: 90,
              life: 7,
              maxLife: 7,
              colorHex: color,
              elements: spell.elements,
            });
          }
        } else {
          const cx = player.x + Math.cos(angle) * 95;
          const cy = player.y + Math.sin(angle) * 95;
          const perpX = -Math.sin(angle);
          const perpY = Math.cos(angle);
          for (let i = -2; i <= 2; i++) {
            const pos = clampArena(cx + perpX * i * 30, cy + perpY * i * 30);
            this.walls.push({
              id: this.nextId++,
              x: pos.x,
              y: pos.y,
              radius: 14,
              hp: 90,
              maxHp: 90,
              life: 7,
              maxLife: 7,
              colorHex: color,
              elements: spell.elements,
            });
          }
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 130, radius: 120 });
        events.push({ type: 'sfx', sound: 'wall' });
        break;
      }

      case 'MINES': {
        if (spell.isNova) {
          const count = 8;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const pos = clampArena(player.x + Math.cos(a) * 95, player.y + Math.sin(a) * 95);
            this.spawnMine(pos.x, pos.y, color, spell.elements);
          }
        } else {
          const count = 5;
          for (let i = 0; i < count; i++) {
            const a = angle + (i - 2) * 0.28;
            const pos = clampArena(player.x + Math.cos(a) * 115, player.y + Math.sin(a) * 115);
            this.spawnMine(pos.x, pos.y, color, spell.elements);
          }
        }
        events.push({ type: 'sfx', sound: 'mine_deploy' });
        break;
      }

      case 'STORM': {
        const target = spell.isNova
          ? { x: player.x, y: player.y }
          : clampArena(aimX, aimY, 80);
        this.storms.push({
          id: this.nextId++,
          x: target.x,
          y: target.y,
          radius: 140,
          life: 4,
          maxLife: 4,
          tickTimer: 0.05,
          colorHex: color,
          elements: spell.elements,
        });
        events.push({ type: 'grid_impulse', x: target.x, y: target.y, strength: 180, radius: 150 });
        events.push({ type: 'sfx', sound: 'storm' });
        break;
      }

      case 'ROCK_THROW': {
        const radius = 12 + spell.stackPower * 4;
        const speed = 460;
        const damage = 35 * spell.stackPower;
        const pierce = 2 + spell.stackPower;
        if (spell.isNova) {
          for (let i = 0; i < 4; i++) {
            const a = angle + (i / 4) * Math.PI * 2;
            this.spawnRock(player.x, player.y, a, speed, radius, damage, pierce, color, spell.elements);
          }
        } else {
          this.spawnRock(player.x, player.y, angle, speed, radius, damage, pierce, color, spell.elements);
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 160, radius: 110 });
        events.push({ type: 'screen_shake', intensity: 4.5 });
        events.push({ type: 'sfx', sound: 'rock' });
        break;
      }

      case 'ICICLE_VOLLEY': {
        const count = spell.isNova ? 12 : 6;
        const spread = spell.isNova ? Math.PI * 2 : 0.34;
        const speed = 680;
        for (let i = 0; i < count; i++) {
          const a = spell.isNova
            ? angle + (i / count) * Math.PI * 2
            : angle + ((i / (count - 1)) - 0.5) * spread;
          this.projectiles.push({
            id: this.nextId++,
            owner: 'PLAYER',
            kind: 'ICICLE',
            x: player.x + Math.cos(a) * 20,
            y: player.y + Math.sin(a) * 20,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 7,
            damage: 20,
            pierce: 3,
            life: 1.1,
            maxLife: 1.1,
            colorHex: color,
            elements: spell.elements,
            hitIds: [],
            spin: 0,
          });
        }
        events.push({ type: 'grid_impulse', x: player.x, y: player.y, strength: 90, radius: 90 });
        events.push({ type: 'sfx', sound: 'icicle' });
        break;
      }

      case 'BEAM': {
        const count = spell.isNova ? 6 : 1;
        for (let i = 0; i < count; i++) {
          const a = spell.isNova ? angle + (i / count) * Math.PI * 2 : angle;
          this.beams.push({
            id: this.nextId++,
            owner: 'PLAYER',
            x: player.x + Math.cos(a) * 22,
            y: player.y + Math.sin(a) * 22,
            angle: a,
            length: 560,
            width: 14,
            damagePerSec: 110,
            life: 0.35,
            maxLife: 0.35,
            colorHex: color,
            elements: spell.elements,
            clashing: false,
            clashDist: 560,
          });
        }
        if (spell.elements.includes('VOID')) {
          events.push({ type: 'grid_well', x: player.x + Math.cos(angle) * 140, y: player.y + Math.sin(angle) * 140, strength: 220, radius: 160 });
        }
        events.push({ type: 'screen_shake', intensity: 3.5 });
        events.push({ type: 'sfx', sound: 'beam' });
        break;
      }

      case 'LIGHTNING_BOLT': {
        const arcs = spell.isNova ? 6 : 1;
        const range = 320;
        for (let i = 0; i < arcs; i++) {
          const a = spell.isNova ? angle + (i / arcs) * Math.PI * 2 : angle;
          const pts: Array<{ x: number; y: number }> = [{ x: player.x, y: player.y }];
          let curX = player.x;
          let curY = player.y;

          // Chain through deployed mines/walls if near forward cone, else strike forward
          const candidates = [
            ...this.mines.map((m) => ({ x: m.x, y: m.y })),
            ...this.walls.map((w) => ({ x: w.x, y: w.y })),
          ].filter((c) => Math.hypot(c.x - curX, c.y - curY) < range);

          if (candidates.length > 0 && !spell.isNova) {
            for (const c of candidates.slice(0, 4)) {
              pts.push({ x: c.x, y: c.y });
              curX = c.x;
              curY = c.y;
            }
          } else {
            const tx = curX + Math.cos(a) * range;
            const ty = curY + Math.sin(a) * range;
            pts.push({ x: tx, y: ty });
            curX = tx;
            curY = ty;
          }

          events.push({ type: 'vfx_lightning', points: pts, colorHex: color });
          events.push({ type: 'vfx_burst', x: curX, y: curY, colorHex: color, count: 10, radius: 30 });
          events.push({ type: 'grid_impulse', x: curX, y: curY, strength: 130, radius: 100 });
        }
        events.push({ type: 'sfx', sound: 'lightning' });
        break;
      }

      case 'SPRAY': {
        const range = 190;
        const spread = 0.75;
        events.push({
          type: 'vfx_spray',
          x: player.x,
          y: player.y,
          angle,
          spread,
          range,
          colorHex: color,
          isNova: spell.isNova,
        });
        const puddleKind = spell.elements.includes('TOXIN')
          ? 'TOXIN'
          : spell.elements.includes('PLASMA')
          ? 'PLASMA'
          : spell.elements.includes('FLUX')
          ? 'FLUX'
          : null;
        if (puddleKind) {
          const puddleCount = spell.isNova ? 4 : 2;
          for (let i = 0; i < puddleCount; i++) {
            const a = spell.isNova ? (i / puddleCount) * Math.PI * 2 : angle + (i - 0.5) * 0.25;
            const pos = clampArena(player.x + Math.cos(a) * 110, player.y + Math.sin(a) * 110, 40);
            this.pools.push({
              id: this.nextId++,
              kind: puddleKind,
              x: pos.x,
              y: pos.y,
              radius: 46,
              life: 5,
              maxLife: 5,
              colorHex: ELEMENT_META[puddleKind].colorHex,
              tickTimer: 0.25,
            });
          }
        }
        events.push({ type: 'grid_impulse', x: player.x + Math.cos(angle) * 70, y: player.y + Math.sin(angle) * 70, strength: 90, radius: 95 });
        events.push({ type: 'sfx', sound: 'spray' });
        break;
      }

      case 'PHASE_SLASH': {
        this.slashes.push({
          id: this.nextId++,
          x: player.x,
          y: player.y,
          angle,
          arc: 1.25,
          radius: 76,
          life: 0.22,
          maxLife: 0.22,
          colorHex: color,
        });
        events.push({ type: 'vfx_burst', x: player.x + Math.cos(angle) * 45, y: player.y + Math.sin(angle) * 45, colorHex: color, count: 16, radius: 45 });
        if (spell.hasAegisTrail) {
          for (let i = 1; i <= 4; i++) {
            const pos = clampArena(player.x + Math.cos(angle) * i * 38, player.y + Math.sin(angle) * i * 38);
            this.spawnMine(pos.x, pos.y, color, spell.elements);
          }
        }
        events.push({ type: 'sfx', sound: 'slash' });
        break;
      }
    }
  }

  private spawnMine(x: number, y: number, colorHex: number, elements: QueueElement[]): void {
    this.mines.push({
      id: this.nextId++,
      x,
      y,
      radius: 10,
      triggerRadius: 34,
      blastRadius: 95,
      damage: 45,
      armTimer: 0.4,
      life: 10,
      colorHex,
      elements,
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
    elements: QueueElement[]
  ): void {
    this.projectiles.push({
      id: this.nextId++,
      owner: 'PLAYER',
      kind: 'ROCK',
      x: px + Math.cos(angle) * 22,
      y: py + Math.sin(angle) * 22,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      damage,
      pierce,
      life: 2.2,
      maxLife: 2.2,
      colorHex,
      elements,
      hitIds: [],
      spin: 0,
    });
  }

  public step(dt: number, player: PlayerState, events: SimEvent[]): void {
    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 7;

      const hitWall =
        Math.abs(p.x) > ARENA_HALF_W - p.radius || Math.abs(p.y) > ARENA_HALF_H - p.radius;
      if (p.life <= 0 || hitWall) {
        if (p.kind === 'ROCK') {
          events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 220, radius: 140 });
          events.push({ type: 'vfx_burst', x: p.x, y: p.y, colorHex: p.colorHex, count: 16, radius: 50 });
          events.push({ type: 'screen_shake', intensity: 5 });
        }
        this.projectiles.splice(i, 1);
      }
    }

    // Update beams (follow player for forward beams)
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.life -= dt;
      if (b.owner === 'PLAYER' && this.beams.filter((x) => x.owner === 'PLAYER').length === 1) {
        b.angle = player.aimAngle;
        b.x = player.x + Math.cos(b.angle) * 22;
        b.y = player.y + Math.sin(b.angle) * 22;
      }
      if (b.life <= 0) {
        this.beams.splice(i, 1);
      }
    }

    // Update shields (follow player)
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

    // Update storms
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i]!;
      s.life -= dt;
      s.tickTimer -= dt;
      if (s.tickTimer <= 0) {
        s.tickTimer = 0.38;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * s.radius * 0.75;
        const sx = s.x + Math.cos(a) * d;
        const sy = s.y + Math.sin(a) * d;
        events.push({ type: 'vfx_burst', x: sx, y: sy, colorHex: s.colorHex, count: 10, radius: 36 });
        events.push({ type: 'grid_impulse', x: sx, y: sy, strength: 130, radius: 95 });
        const puddleKind = s.elements.includes('PLASMA')
          ? 'PLASMA'
          : s.elements.includes('FLUX')
          ? 'FLUX'
          : null;
        if (puddleKind && this.pools.length < 18) {
          this.pools.push({
            id: this.nextId++,
            kind: puddleKind,
            x: sx,
            y: sy,
            radius: 40,
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

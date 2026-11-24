import { CombatEngine } from './CombatEngine';
import { enqueueElement, resolveSelfCast, resolveSpell } from './SpellResolver';
import { WaveDirector } from './WaveDirector';
import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  FIXED_DT,
  PlayerState,
  SimEvent,
  SimInput,
  SimSnapshot,
} from './types';

function createInitialPlayer(): PlayerState {
  return {
    x: -ARENA_HALF_W + 140,
    y: 0,
    vx: 0,
    vy: 0,
    aimAngle: 0,
    hp: 100,
    maxHp: 100,
    armorHp: 0,
    maxArmorHp: 105,
    wardRemaining: 0,
    wardMaxDuration: 6,
    wardElement: null,
    queue: [],
    dashCooldown: 0,
    dashTimer: 0,
    dashDirX: 1,
    dashDirY: 0,
    invulnTimer: 0,
    castCooldown: 0,
    overclockTimer: 0,
    overclockMax: 3,
    ignitedTimer: 0,
    moving: false,
    moveTarget: null,
    channel: null,
    charge: null,
  };
}

export class GameSim {
  private phase: SimSnapshot['phase'] = 'PLAYING';
  private tick = 0;
  private player: PlayerState = createInitialPlayer();
  public readonly combat = new CombatEngine();
  public readonly waveDirector = new WaveDirector();
  private events: SimEvent[] = [];

  constructor() {
    this.waveDirector.startWave(1, this.events);
  }

  public startNewRun(): void {
    this.phase = 'PLAYING';
    this.tick = 0;
    this.player = createInitialPlayer();
    this.combat.reset();
    this.waveDirector.reset();
    this.events.length = 0;
    this.waveDirector.startWave(1, this.events);
  }

  public setPhase(phase: SimSnapshot['phase']): void {
    this.phase = phase;
  }

  public step(input: SimInput): void {
    if (this.phase !== 'PLAYING') return;
    this.tick++;

    const p = this.player;
    const dxAim = input.aimX - p.x;
    const dyAim = input.aimY - p.y;
    if (dxAim * dxAim + dyAim * dyAim > 1) {
      p.aimAngle = Math.atan2(dyAim, dxAim);
    }

    p.dashCooldown = Math.max(0, p.dashCooldown - FIXED_DT);
    p.invulnTimer = Math.max(0, p.invulnTimer - FIXED_DT);
    p.castCooldown = Math.max(0, p.castCooldown - FIXED_DT);
    p.wardRemaining = Math.max(0, p.wardRemaining - FIXED_DT);
    if (p.wardRemaining <= 0) {
      p.wardElement = null;
    }

    for (const el of input.queuedElements) {
      const res = enqueueElement(p.queue, el, 'IGNORE');
      p.queue = res.queue;
      if (res.action === 'cancelled') {
        this.events.push({ type: 'sfx', sound: 'cancel' });
      } else if (res.action === 'fused') {
        this.events.push({ type: 'sfx', sound: 'fusion' });
      } else if (res.action === 'added' || res.action === 'overflow_fifo') {
        this.events.push({ type: 'sfx', sound: 'queue' });
      }
    }

    if (input.dashPressed && p.dashCooldown <= 0 && p.dashTimer <= 0) {
      this.combat.stopChannel(p);
      this.combat.cancelCharge(p);
      p.moveTarget = null;
      p.dashTimer = 0.19;
      p.dashCooldown = 0.75;
      p.invulnTimer = 0.24;
      p.dashDirX = Math.cos(p.aimAngle);
      p.dashDirY = Math.sin(p.aimAngle);
      this.events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 180, radius: 130 });
      this.events.push({ type: 'sfx', sound: 'dash' });

      if (p.queue.length > 0) {
        const slashSpell = resolveSpell(p.queue, 'DASH');
        if (slashSpell) {
          this.combat.castSpell(p, slashSpell, input.aimX, input.aimY, this.events);
          p.queue = [];
        }
      }
    }

    if (input.castAction && p.castCooldown <= 0) {
      if (input.castAction === 'SELF') {
        const selfCast = resolveSelfCast(p.queue);
        if (selfCast.effect !== 'NONE') {
          this.combat.stopChannel(p);
          this.combat.cancelCharge(p);
          if (selfCast.effect === 'SELF_HEAL' && input.selfHeld) {
            this.combat.startSelfHealChannel(p, selfCast, this.events);
          } else {
            this.combat.castSelf(p, selfCast, this.events);
            if (selfCast.effect === 'SELF_HEAL' && !input.selfHeld) {
              this.combat.stopChannel(p);
            }
          }
          p.queue = [];
          p.castCooldown = 0.16;
        }
      } else if (input.castAction === 'FORWARD' || input.castAction === 'NOVA') {
        const spell = resolveSpell(p.queue, input.castAction);
        if (spell) {
          this.combat.stopChannel(p);
          this.combat.cancelCharge(p);
          if (spell.isChannelable && input.castHeld) {
            this.combat.startChannel(p, spell, this.events);
          } else if (spell.isChargeable) {
            this.combat.startCharge(p, spell);
            if (!input.castHeld) {
              this.combat.releaseCharge(p, this.events, 0.08);
            }
          } else {
            this.combat.castSpell(p, spell, input.aimX, input.aimY, this.events);
          }
          p.queue = [];
          p.castCooldown = 0.16;
        }
      }
    }

    if (input.moveClickTarget) {
      const margin = 18;
      p.moveTarget = {
        x: Math.max(-ARENA_HALF_W + margin, Math.min(ARENA_HALF_W - margin, input.moveClickTarget.x)),
        y: Math.max(-ARENA_HALF_H + margin, Math.min(ARENA_HALF_H - margin, input.moveClickTarget.y)),
      };
    }

    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - FIXED_DT);
      const dashSpeed = 180 / 0.19;
      p.vx = p.dashDirX * dashSpeed;
      p.vy = p.dashDirY * dashSpeed;
      p.moving = true;
      if (this.tick % 2 === 0) {
        this.events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 85, radius: 80 });
      }
    } else {
      let mx = input.moveX;
      let my = input.moveY;
      if (mx !== 0 || my !== 0) {
        p.moveTarget = null;
        const len = Math.hypot(mx, my);
        if (len > 1) {
          mx /= len;
          my /= len;
        }
      } else if (input.moveToCursor) {
        const dist = Math.hypot(dxAim, dyAim);
        if (dist > 14) {
          mx = dxAim / dist;
          my = dyAim / dist;
        }
      } else if (p.moveTarget) {
        const tx = p.moveTarget.x - p.x;
        const ty = p.moveTarget.y - p.y;
        const dist = Math.hypot(tx, ty);
        if (dist <= 14) {
          p.moveTarget = null;
        } else {
          mx = tx / dist;
          my = ty / dist;
        }
      }

      const maxSpeed = p.channel ? 165 * 0.68 : p.charge ? 165 * 0.65 : 165;
      const accel = 13;
      p.vx += (mx * maxSpeed - p.vx) * Math.min(1, accel * FIXED_DT);
      p.vy += (my * maxSpeed - p.vy) * Math.min(1, accel * FIXED_DT);
      p.moving = Math.hypot(mx, my) > 0.05;
    }

    p.x += p.vx * FIXED_DT;
    p.y += p.vy * FIXED_DT;

    const margin = 18;
    p.x = Math.max(-ARENA_HALF_W + margin, Math.min(ARENA_HALF_W - margin, p.x));
    p.y = Math.max(-ARENA_HALF_H + margin, Math.min(ARENA_HALF_H - margin, p.y));

    for (const pil of this.waveDirector.pillars) {
      const pdx = p.x - pil.x;
      const pdy = p.y - pil.y;
      const minD = pil.radius + 16;
      const d = Math.hypot(pdx, pdy);
      if (d > 0.01 && d < minD) {
        p.x = pil.x + (pdx / d) * minD;
        p.y = pil.y + (pdy / d) * minD;
      }
    }

    this.waveDirector.step(
      FIXED_DT,
      this.combat.enemies.length,
      p,
      (arch, x, y) => this.combat.spawnEnemy(arch, x, y, this.waveDirector.wave),
      this.events
    );

    this.combat.step(
      FIXED_DT,
      p,
      input.castHeld,
      input.selfHeld,
      this.waveDirector.wave,
      this.waveDirector.pillars,
      (arch) => this.waveDirector.onEnemyKilled(arch),
      () => this.waveDirector.onPlayerDamaged(),
      this.events
    );

    // Connected Sector Gate Transition
    const gate = this.waveDirector.gate;
    if (gate.open && Math.hypot(p.x - gate.x, p.y - gate.y) <= gate.radius) {
      const nextSector = this.waveDirector.wave + 1;
      p.x = -ARENA_HALF_W + 140;
      p.y = 0;
      p.vx = 0;
      p.vy = 0;
      p.moveTarget = null;
      p.hp = Math.min(p.maxHp, p.hp + 25);
      this.combat.clearTransientForSector();
      this.waveDirector.startWave(nextSector, this.events);
    }

    if (p.hp <= 0) {
      this.phase = 'GAME_OVER';
      this.events.push({ type: 'game_over', score: this.waveDirector.score, wave: this.waveDirector.wave });
      this.events.push({ type: 'sfx', sound: 'game_over' });
    }
  }

  public drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  public getSnapshot(): SimSnapshot {
    const warden = this.combat.enemies.find((e) => e.archetype === 'WARDEN');
    return {
      phase: this.phase,
      tick: this.tick,
      wave: this.waveDirector.wave,
      score: this.waveDirector.score,
      multiplier: this.waveDirector.multiplier,
      multiplierTimer: this.waveDirector.multiplierTimer,
      player: this.player,
      enemies: this.combat.enemies,
      projectiles: this.combat.projectiles,
      beams: this.combat.beams,
      walls: this.combat.walls,
      mines: this.combat.mines,
      storms: this.combat.storms,
      shields: this.combat.shields,
      pools: this.combat.pools,
      slashes: this.combat.slashes,
      pillars: this.waveDirector.pillars,
      rifts: this.waveDirector.rifts,
      hazards: this.combat.hazards,
      gate: this.waveDirector.gate,
      augments: {},
      pendingAugments: [],
      boss: warden ? { name: 'SECTOR WARDEN', hp: warden.hp, maxHp: warden.maxHp } : null,
    };
  }
}

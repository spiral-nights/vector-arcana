import { CombatEngine } from './CombatEngine';
import { enqueueElement, resolveSelfCast, resolveSpell } from './SpellResolver';
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
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimAngle: 0,
    hp: 100,
    maxHp: 100,
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
    toxinTimer: 0,
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
  private combat = new CombatEngine();
  private events: SimEvent[] = [];

  public startNewRun(): void {
    this.phase = 'PLAYING';
    this.tick = 0;
    this.player = createInitialPlayer();
    this.combat.reset();
    this.events.length = 0;
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

    // Process element queue inputs
    for (const el of input.queuedElements) {
      const res = enqueueElement(p.queue, el, 'FIFO');
      p.queue = res.queue;
      if (res.action === 'cancelled') {
        this.events.push({ type: 'sfx', sound: 'cancel' });
      } else if (res.action === 'fused') {
        this.events.push({ type: 'sfx', sound: 'fusion' });
      } else if (res.action === 'added' || res.action === 'overflow_fifo') {
        this.events.push({ type: 'sfx', sound: 'queue' });
      }
    }

    // Phase Dash & Phase Slash
    if (input.dashPressed && p.dashCooldown <= 0 && p.dashTimer <= 0) {
      this.combat.stopChannel(p);
      this.combat.cancelCharge(p);
      p.moveTarget = null;
      p.dashTimer = 0.16;
      p.dashCooldown = 0.75;
      p.invulnTimer = 0.22;
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

    // Cast actions
    if (input.castAction && p.castCooldown <= 0) {
      if (input.castAction === 'SELF') {
        const selfCast = resolveSelfCast(p.queue);
        if (selfCast.effect !== 'NONE') {
          this.combat.stopChannel(p);
          this.combat.cancelCharge(p);
          this.combat.castSelf(p, selfCast, this.events);
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
      const dashSpeed = 180 / 0.16;
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

      const maxSpeed = p.channel ? 245 * 0.68 : p.charge ? 245 * 0.65 : 245;
      const accel = 18;
      p.vx += (mx * maxSpeed - p.vx) * Math.min(1, accel * FIXED_DT);
      p.vy += (my * maxSpeed - p.vy) * Math.min(1, accel * FIXED_DT);
      p.moving = Math.hypot(mx, my) > 0.05;
    }

    p.x += p.vx * FIXED_DT;
    p.y += p.vy * FIXED_DT;

    const margin = 18;
    p.x = Math.max(-ARENA_HALF_W + margin, Math.min(ARENA_HALF_W - margin, p.x));
    p.y = Math.max(-ARENA_HALF_H + margin, Math.min(ARENA_HALF_H - margin, p.y));

    this.combat.step(FIXED_DT, p, input.castHeld, this.events);
  }

  public drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  public getSnapshot(): SimSnapshot {
    return {
      phase: this.phase,
      tick: this.tick,
      wave: 1,
      score: 0,
      multiplier: 1,
      multiplierTimer: 0,
      player: this.player,
      enemies: [],
      projectiles: this.combat.projectiles,
      beams: this.combat.beams,
      walls: this.combat.walls,
      mines: this.combat.mines,
      storms: this.combat.storms,
      shields: this.combat.shields,
      pools: this.combat.pools,
      slashes: this.combat.slashes,
      augments: {},
      pendingAugments: [],
      boss: null,
    };
  }
}

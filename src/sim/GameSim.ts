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
  };
}

export class GameSim {
  private phase: SimSnapshot['phase'] = 'PLAYING';
  private tick = 0;
  private player: PlayerState = createInitialPlayer();
  private events: SimEvent[] = [];

  public startNewRun(): void {
    this.phase = 'PLAYING';
    this.tick = 0;
    this.player = createInitialPlayer();
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

    // Phase Dash
    if (input.dashPressed && p.dashCooldown <= 0 && p.dashTimer <= 0) {
      p.dashTimer = 0.16;
      p.dashCooldown = 0.75;
      p.invulnTimer = 0.22;
      p.dashDirX = Math.cos(p.aimAngle);
      p.dashDirY = Math.sin(p.aimAngle);
      this.events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 180, radius: 130 });
      this.events.push({ type: 'sfx', sound: 'dash' });
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
      if (input.moveToCursor && mx === 0 && my === 0) {
        const dist = Math.hypot(dxAim, dyAim);
        if (dist > 14) {
          mx = dxAim / dist;
          my = dyAim / dist;
        }
      } else {
        const len = Math.hypot(mx, my);
        if (len > 1) {
          mx /= len;
          my /= len;
        }
      }

      const maxSpeed = 245;
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
      projectiles: [],
      beams: [],
      walls: [],
      mines: [],
      storms: [],
      shields: [],
      pools: [],
      slashes: [],
      augments: {},
      pendingAugments: [],
      boss: null,
    };
  }
}

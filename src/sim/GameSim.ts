import { getAugmentStacks, rollAugmentChoices } from './Augments';
import { CombatEngine } from './CombatEngine';
import { enqueueElement, resolveSelfCast, resolveSpell } from './SpellResolver';
import { WaveDirector } from './WaveDirector';
import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  AugmentDef,
  AugmentId,
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
  public augments: Partial<Record<AugmentId, number>> = {};
  public pendingAugments: AugmentDef[] = [];
  private events: SimEvent[] = [];

  constructor(initialPhase: SimSnapshot['phase'] = 'PLAYING') {
    this.phase = initialPhase;
    this.waveDirector.startWave(1, this.events);
  }

  public startNewRun(): void {
    this.phase = 'PLAYING';
    this.tick = 0;
    this.player = createInitialPlayer();
    this.augments = {};
    this.pendingAugments = [];
    this.combat.reset();
    this.combat.setAugments(this.augments);
    this.waveDirector.reset();
    this.events.length = 0;
    this.waveDirector.startWave(1, this.events);
  }

  public pickAugment(index: number): boolean {
    if (this.phase !== 'AUGMENT_CHOICE') return false;
    const chosen = this.pendingAugments[index];
    if (!chosen) return false;
    this.augments[chosen.id] = (this.augments[chosen.id] ?? 0) + 1;
    this.combat.setAugments(this.augments);
    this.pendingAugments = [];
    this.phase = 'PLAYING';
    this.events.push({ type: 'sfx', sound: 'augment_pick' });
    this.events.push({
      type: 'vfx_ring',
      x: this.player.x,
      y: this.player.y,
      radius: 110,
      colorHex: parseInt(chosen.color.slice(1), 16),
      duration: 0.35,
    });
    return true;
  }

  public setPhase(phase: SimSnapshot['phase']): void {
    this.phase = phase;
  }

  public step(input: SimInput): void {
    if (this.phase !== 'PLAYING') return;
    this.tick++;
    this.combat.setAugments(this.augments);

    const p = this.player;
    const dxAim = input.aimX - p.x;
    const dyAim = input.aimY - p.y;
    if (dxAim * dxAim + dyAim * dyAim > 1) {
      p.aimAngle = Math.atan2(dyAim, dxAim);
    }

    p.dashCooldown = Math.max(0, p.dashCooldown - FIXED_DT);
    p.invulnTimer = Math.max(0, p.invulnTimer - FIXED_DT);
    p.castCooldown = Math.max(0, p.castCooldown - FIXED_DT);
    p.overclockTimer = Math.max(0, p.overclockTimer - FIXED_DT);
    p.wardRemaining = Math.max(0, p.wardRemaining - FIXED_DT);
    if (p.wardRemaining <= 0) {
      p.wardElement = null;
    }

    const ocStacks = getAugmentStacks(this.augments, 'OVERCLOCKED_QUEUE');
    const tryTriggerOverclock = (uniqueCount: number): void => {
      if (ocStacks > 0 && uniqueCount >= 3) {
        p.overclockTimer = p.overclockMax;
        this.events.push({ type: 'vfx_ring', x: p.x, y: p.y, radius: 75, colorHex: 0x39ff14, duration: 0.25 });
        this.events.push({ type: 'damage_number', x: p.x, y: p.y - 24, text: 'OVERCLOCKED!', colorHex: 0x39ff14, big: true });
      }
    };
    const getOcCooldownMult = (): number =>
      p.overclockTimer > 0 && ocStacks > 0 ? Math.max(0.5, 1 - (0.2 + (ocStacks - 1) * 0.08)) : 1;
    const getOcMoveMult = (): number =>
      p.overclockTimer > 0 && ocStacks > 0 ? 1 + 0.25 + (ocStacks - 1) * 0.1 : 1;

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
      p.dashCooldown = 0.55;
      p.invulnTimer = 0.28;
      p.dashDirX = Math.cos(p.aimAngle);
      p.dashDirY = Math.sin(p.aimAngle);
      this.events.push({ type: 'grid_impulse', x: p.x, y: p.y, strength: 180, radius: 130 });
      this.events.push({ type: 'sfx', sound: 'dash' });

      if (p.queue.length > 0) {
        const slashSpell = resolveSpell(p.queue, 'DASH');
        if (slashSpell) {
          this.combat.castSpell(p, slashSpell, input.aimX, input.aimY, this.events);
          tryTriggerOverclock(slashSpell.uniqueCount);
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
          this.combat.castSelf(p, selfCast, this.events);
          tryTriggerOverclock(new Set(selfCast.elements).size);
          p.queue = [];
          p.castCooldown = 0.16 * getOcCooldownMult();
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
          tryTriggerOverclock(spell.uniqueCount);
          p.queue = [];
          p.castCooldown = 0.16 * getOcCooldownMult();
        }
      }
    }

    if (input.moveClickTarget && p.dashTimer <= 0) {
      const margin = 18;
      p.moveTarget = {
        x: Math.max(-ARENA_HALF_W + margin, Math.min(ARENA_HALF_W - margin, input.moveClickTarget.x)),
        y: Math.max(-ARENA_HALF_H + margin, Math.min(ARENA_HALF_H - margin, input.moveClickTarget.y)),
      };
    }

    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - FIXED_DT);
      const dashSpeed = 235 / 0.19;
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

      const baseSpeed = 165 * getOcMoveMult();
      const maxSpeed = p.channel ? baseSpeed * 0.68 : p.charge ? baseSpeed * 0.65 : baseSpeed;
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

    for (const blk of this.waveDirector.blocks) {
      const cx = Math.max(blk.x - blk.halfW, Math.min(blk.x + blk.halfW, p.x));
      const cy = Math.max(blk.y - blk.halfH, Math.min(blk.y + blk.halfH, p.y));
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < 16) {
        if (d > 0.01) {
          p.x = cx + (dx / d) * 16;
          p.y = cy + (dy / d) * 16;
        } else {
          const penX = blk.halfW - Math.abs(p.x - blk.x);
          const penY = blk.halfH - Math.abs(p.y - blk.y);
          if (penX < penY) {
            p.x = p.x >= blk.x ? blk.x + blk.halfW + 16 : blk.x - blk.halfW - 16;
          } else {
            p.y = p.y >= blk.y ? blk.y + blk.halfH + 16 : blk.y - blk.halfH - 16;
          }
        }
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
      this.events,
      this.waveDirector.blocks
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
      this.pendingAugments = rollAugmentChoices();
      this.phase = 'AUGMENT_CHOICE';
      this.events.push({ type: 'augment_offer', choices: this.pendingAugments });
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
      blocks: this.waveDirector.blocks,
      rifts: this.waveDirector.rifts,
      hazards: this.combat.hazards,
      gate: this.waveDirector.gate,
      augments: { ...this.augments },
      pendingAugments: [...this.pendingAugments],
      boss: warden ? { name: 'SECTOR WARDEN', hp: warden.hp, maxHp: warden.maxHp } : null,
    };
  }
}

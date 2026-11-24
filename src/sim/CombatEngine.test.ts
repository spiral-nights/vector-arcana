import { describe, expect, it } from 'vitest';
import { GameSim } from './GameSim';
import { BaseElement, ELEMENT_META, FIXED_DT, SimInput } from './types';

function makeInput(overrides: Partial<SimInput> = {}): SimInput {
  return {
    moveX: 0,
    moveY: 0,
    moveToCursor: false,
    moveClickTarget: null,
    aimX: 200,
    aimY: 0,
    queuedElements: [],
    castAction: null,
    castHeld: false,
    selfHeld: false,
    dashPressed: false,
    ...overrides,
  };
}

function queueAndStep(sim: GameSim, elements: BaseElement[]): void {
  sim.step(makeInput({ queuedElements: elements }));
  sim.drainEvents();
}

describe('CombatEngine — Mines Scaling & Multi-Color', () => {
  it('spawns more mines with 3 elements than 2 elements for both Forward and Nova casts', () => {
    const sim2 = new GameSim();
    queueAndStep(sim2, ['BARRIER', 'VOID']);
    sim2.step(makeInput({ castAction: 'FORWARD' }));
    expect(sim2.getSnapshot().mines.length).toBe(5);

    const sim3 = new GameSim();
    queueAndStep(sim3, ['BARRIER', 'VOID', 'THERMAL']);
    sim3.step(makeInput({ castAction: 'FORWARD' }));
    expect(sim3.getSnapshot().mines.length).toBe(9);

    const nova2 = new GameSim();
    queueAndStep(nova2, ['BARRIER', 'VOID']);
    nova2.step(makeInput({ castAction: 'NOVA' }));
    expect(nova2.getSnapshot().mines.length).toBe(6);

    const nova3 = new GameSim();
    queueAndStep(nova3, ['BARRIER', 'VOID', 'THERMAL']);
    nova3.step(makeInput({ castAction: 'NOVA' }));
    expect(nova3.getSnapshot().mines.length).toBe(11);
  });

  it('stores all mixed element colors on deployed mines', () => {
    const sim = new GameSim();
    queueAndStep(sim, ['BARRIER', 'VOID', 'THERMAL']);
    sim.step(makeInput({ castAction: 'FORWARD' }));
    const mine = sim.getSnapshot().mines[0]!;
    expect(mine.colors).toContain(ELEMENT_META.BARRIER.colorHex);
    expect(mine.colors).toContain(ELEMENT_META.VOID.colorHex);
    expect(mine.colors).toContain(ELEMENT_META.THERMAL.colorHex);
  });
});

describe('CombatEngine — Area Casting Scaling', () => {
  it('scales Fire Nova area range with number of queued elements', () => {
    const sim1 = new GameSim();
    queueAndStep(sim1, ['THERMAL']);
    sim1.step(makeInput({ castAction: 'NOVA' }));
    const ev1 = sim1.drainEvents().find((e) => e.type === 'vfx_spray');

    const sim3 = new GameSim();
    queueAndStep(sim3, ['THERMAL', 'THERMAL', 'THERMAL']);
    sim3.step(makeInput({ castAction: 'NOVA' }));
    const ev3 = sim3.drainEvents().find((e) => e.type === 'vfx_spray');

    expect(ev1?.type).toBe('vfx_spray');
    expect(ev3?.type).toBe('vfx_spray');
    if (ev1?.type === 'vfx_spray' && ev3?.type === 'vfx_spray') {
      expect(ev3.range).toBeGreaterThan(ev1.range);
    }
  });
});

describe('CombatEngine — Rock & Icicle Charge-Up Proportionality', () => {
  it('launches Rock Throw faster and farther when charged longer', () => {
    const simShort = new GameSim();
    queueAndStep(simShort, ['KINETIC']);
    simShort.step(makeInput({ castAction: 'FORWARD', castHeld: true }));
    for (let i = 0; i < 6; i++) simShort.step(makeInput({ castHeld: true }));
    simShort.step(makeInput({ castHeld: false }));
    const shortRock = simShort.getSnapshot().projectiles[0]!;
    const shortSpeed = Math.hypot(shortRock.vx, shortRock.vy);
    const shortRange = shortSpeed * shortRock.maxLife;

    const simFull = new GameSim();
    queueAndStep(simFull, ['KINETIC']);
    simFull.step(makeInput({ castAction: 'FORWARD', castHeld: true }));
    const fullTicks = Math.ceil(1.25 / FIXED_DT);
    for (let i = 0; i < fullTicks; i++) simFull.step(makeInput({ castHeld: true }));
    simFull.step(makeInput({ castHeld: false }));
    const fullRock = simFull.getSnapshot().projectiles[0]!;
    const fullSpeed = Math.hypot(fullRock.vx, fullRock.vy);
    const fullRange = fullSpeed * fullRock.maxLife;

    expect(fullSpeed).toBeGreaterThan(shortSpeed);
    expect(fullRange).toBeGreaterThan(shortRange);
  });

  it('launches Crystal Shards faster and farther when charged longer', () => {
    const simShort = new GameSim();
    queueAndStep(simShort, ['FLUX', 'CRYO']);
    simShort.step(makeInput({ castAction: 'FORWARD', castHeld: true }));
    for (let i = 0; i < 6; i++) simShort.step(makeInput({ castHeld: true }));
    simShort.step(makeInput({ castHeld: false }));
    const shortIce = simShort.getSnapshot().projectiles[0]!;
    const shortSpeed = Math.hypot(shortIce.vx, shortIce.vy);
    const shortRange = shortSpeed * shortIce.maxLife;

    const simFull = new GameSim();
    queueAndStep(simFull, ['FLUX', 'CRYO']);
    simFull.step(makeInput({ castAction: 'FORWARD', castHeld: true }));
    const fullTicks = Math.ceil(1.25 / FIXED_DT);
    for (let i = 0; i < fullTicks; i++) simFull.step(makeInput({ castHeld: true }));
    simFull.step(makeInput({ castHeld: false }));
    const fullIce = simFull.getSnapshot().projectiles[0]!;
    const fullSpeed = Math.hypot(fullIce.vx, fullIce.vy);
    const fullRange = fullSpeed * fullIce.maxLife;

    expect(fullSpeed).toBeGreaterThan(shortSpeed);
    expect(fullRange).toBeGreaterThan(shortRange);
  });
});

describe('CombatEngine — Mixed Volt + Fire + Barrier Storm', () => {
  it('emits both storm strikes and lightning bolts for VOLT + THERMAL + BARRIER', () => {
    const sim = new GameSim();
    queueAndStep(sim, ['VOLT', 'THERMAL', 'BARRIER']);
    sim.step(makeInput({ castAction: 'FORWARD' }));
    let sawStrike = false;
    let sawLightning = false;
    for (let i = 0; i < 30; i++) {
      sim.step(makeInput());
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'vfx_storm_strike') sawStrike = true;
        if (ev.type === 'vfx_lightning') sawLightning = true;
      }
    }
    expect(sawStrike).toBe(true);
    expect(sawLightning).toBe(true);
  });
});

describe('GameSim — Click-to-Move & Post-Nova Movement', () => {
  it('continues moving toward a clicked waypoint after button release and stops on arrival', () => {
    const sim = new GameSim();
    sim.step(makeInput({ moveClickTarget: { x: 200, y: 0 } }));
    expect(sim.getSnapshot().player.moveTarget).toEqual({ x: 200, y: 0 });

    for (let i = 0; i < 30; i++) {
      sim.step(makeInput({ moveClickTarget: null }));
    }
    const midX = sim.getSnapshot().player.x;
    expect(midX).toBeGreaterThan(80);
    expect(sim.getSnapshot().player.moveTarget).toEqual({ x: 200, y: 0 });

    for (let i = 0; i < 60; i++) {
      sim.step(makeInput({ moveClickTarget: null }));
    }
    expect(sim.getSnapshot().player.x).toBeGreaterThan(180);
    expect(sim.getSnapshot().player.moveTarget).toBeNull();
  });

  it('allows movement to continue uninterrupted after an Area Nova cast', () => {
    const sim = new GameSim();
    sim.step(makeInput({ moveClickTarget: { x: 250, y: 0 } }));
    queueAndStep(sim, ['THERMAL', 'THERMAL']);
    sim.step(makeInput({ castAction: 'NOVA' }));
    const xAfterNova = sim.getSnapshot().player.x;

    for (let i = 0; i < 20; i++) {
      sim.step(makeInput());
    }
    expect(sim.getSnapshot().player.x).toBeGreaterThan(xAfterNova + 40);
  });
});

describe('CombatEngine — Per-Element Self-Casting', () => {
  it('channels NANO self-healing while selfHeld is true and stops when released', () => {
    const sim = new GameSim();
    sim.getSnapshot().player.hp = 40;
    queueAndStep(sim, ['NANO', 'NANO']);
    sim.step(makeInput({ castAction: 'SELF', selfHeld: true }));
    for (let i = 0; i < 30; i++) {
      sim.step(makeInput({ selfHeld: true }));
    }
    const hpAfterHold = sim.getSnapshot().player.hp;
    expect(hpAfterHold).toBeGreaterThan(55);

    sim.step(makeInput({ selfHeld: false }));
    expect(sim.getSnapshot().player.channel).toBeNull();
  });

  it('triggers local VOID burst with gravity well and zero beams', () => {
    const sim = new GameSim();
    queueAndStep(sim, ['VOID', 'VOID']);
    sim.step(makeInput({ castAction: 'SELF' }));
    expect(sim.getSnapshot().beams.length).toBe(0);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'grid_well')).toBe(true);
    expect(events.some((e) => e.type === 'vfx_ring')).toBe(true);
  });

  it('triggers multi-directional VOLT lightning bolts around player on self-cast', () => {
    const sim = new GameSim();
    queueAndStep(sim, ['VOLT', 'VOLT']);
    sim.step(makeInput({ castAction: 'SELF' }));
    const bolts = sim.drainEvents().filter((e) => e.type === 'vfx_lightning');
    expect(bolts.length).toBeGreaterThanOrEqual(7);
  });

  it('grants KINETIC armor plating and shockwave on self-cast', () => {
    const sim = new GameSim();
    queueAndStep(sim, ['KINETIC', 'KINETIC']);
    sim.step(makeInput({ castAction: 'SELF' }));
    expect(sim.getSnapshot().player.armorHp).toBe(70);
    expect(sim.drainEvents().some((e) => e.type === 'vfx_ring')).toBe(true);
  });

  it('spawns 360° shield dome on [BARRIER] self-cast and sets wardElement on [BARRIER, THERMAL]', () => {
    const sim1 = new GameSim();
    queueAndStep(sim1, ['BARRIER']);
    sim1.step(makeInput({ castAction: 'SELF' }));
    expect(sim1.getSnapshot().shields.length).toBe(1);
    expect(sim1.getSnapshot().shields[0]?.isNova).toBe(true);

    const sim2 = new GameSim();
    queueAndStep(sim2, ['BARRIER', 'THERMAL']);
    sim2.step(makeInput({ castAction: 'SELF' }));
    expect(sim2.getSnapshot().player.wardElement).toBe('THERMAL');
    expect(sim2.getSnapshot().player.wardRemaining).toBeGreaterThan(0);
  });
});

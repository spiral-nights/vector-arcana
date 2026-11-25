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
    expect(sim2.getSnapshot().mines.length).toBe(3);

    const sim3 = new GameSim();
    queueAndStep(sim3, ['BARRIER', 'VOID', 'THERMAL']);
    sim3.step(makeInput({ castAction: 'FORWARD' }));
    expect(sim3.getSnapshot().mines.length).toBe(5);

    const nova2 = new GameSim();
    queueAndStep(nova2, ['BARRIER', 'VOID']);
    nova2.step(makeInput({ castAction: 'NOVA' }));
    expect(nova2.getSnapshot().mines.length).toBe(4);

    const nova3 = new GameSim();
    queueAndStep(nova3, ['BARRIER', 'VOID', 'THERMAL']);
    nova3.step(makeInput({ castAction: 'NOVA' }));
    expect(nova3.getSnapshot().mines.length).toBe(6);
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
    sim.getSnapshot().player.x = 0;
    sim.waveDirector.pillars = [];
    sim.step(makeInput({ moveClickTarget: { x: 200, y: 0 } }));
    expect(sim.getSnapshot().player.moveTarget).toEqual({ x: 200, y: 0 });

    for (let i = 0; i < 30; i++) {
      sim.step(makeInput({ moveClickTarget: null }));
    }
    const midX = sim.getSnapshot().player.x;
    expect(midX).toBeGreaterThan(50);
    expect(sim.getSnapshot().player.moveTarget).toEqual({ x: 200, y: 0 });

    for (let i = 0; i < 90; i++) {
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
    expect(sim.getSnapshot().player.x).toBeGreaterThan(xAfterNova + 30);
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

describe('Milestone 3 — Primer Combos, Enemy Archetypes, Beam Clash & Wave Director', () => {
  it('deals 2x VOLT damage to PRIMED targets and freezes PRIMED targets hit by CRYO', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    const e1 = sim.combat.spawnEnemy('BASTION', 120, 0, 1);
    e1.hasFrontShield = false;
    e1.baseArmor = 0;
    const e2 = sim.combat.spawnEnemy('BASTION', 220, 0, 1);
    e2.hasFrontShield = false;
    e2.baseArmor = 0;

    const ev: ReturnType<GameSim['drainEvents']> = [];
    sim.combat.applyElementalHit(e1, 10, ['VOLT'], 1, 0, ev);
    const normalDmg = e1.maxHp - e1.hp;

    sim.combat.applyElementalHit(e2, 0, ['FLUX'], 1, 0, ev);
    expect(e2.statuses.PRIMED).toBeDefined();
    sim.combat.applyElementalHit(e2, 10, ['VOLT'], 1, 0, ev);
    const primedDmg = e2.maxHp - e2.hp;
    expect(primedDmg).toBeCloseTo(normalDmg * 2);

    sim.combat.applyElementalHit(e2, 0, ['CRYO'], 1, 0, ev);
    expect(e2.statuses.FROZEN).toBeDefined();
  });

  it('triggers SHATTER and spawns 6 SHATTER_SHARD projectiles when FROZEN enemy is hit by KINETIC', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    const e = sim.combat.spawnEnemy('BASTION', 150, 0, 1);
    e.hasFrontShield = false;
    const ev: ReturnType<GameSim['drainEvents']> = [];
    sim.combat.applyElementalHit(e, 0, ['FLUX'], 1, 0, ev);
    sim.combat.applyElementalHit(e, 0, ['CRYO'], 1, 0, ev);
    expect(e.statuses.FROZEN).toBeDefined();

    sim.combat.applyElementalHit(e, 20, ['KINETIC'], 1, 0, ev);
    expect(e.statuses.FROZEN).toBeUndefined();
    const shards = sim.combat.projectiles.filter((p) => p.kind === 'SHATTER_SHARD');
    expect(shards.length).toBe(6);
  });

  it('IGNITED shreds 50% armor and clears FROZEN', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    const e = sim.combat.spawnEnemy('BASTION', 150, 0, 1);
    e.hasFrontShield = false;
    e.baseArmor = 1.0;
    const ev: ReturnType<GameSim['drainEvents']> = [];
    sim.combat.applyElementalHit(e, 0, ['FLUX'], 1, 0, ev);
    sim.combat.applyElementalHit(e, 0, ['CRYO'], 1, 0, ev);
    expect(e.statuses.FROZEN).toBeDefined();

    sim.combat.applyElementalHit(e, 20, ['THERMAL'], 1, 0, ev);
    expect(e.statuses.FROZEN).toBeUndefined();
    expect(e.statuses.IGNITED).toBeDefined();

    const hpBefore = e.hp;
    sim.combat.applyElementalHit(e, 30, ['VOID'], 1, 0, ev);
    // effectiveArmor = 0.5 -> 30 / 1.5 = 20 damage
    expect(hpBefore - e.hp).toBeCloseTo(20);
  });

  it('BASTION front shield blocks frontal BEAM/SPRAY, shatters to KINETIC, and takes damage from behind', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    const e = sim.combat.spawnEnemy('BASTION', 150, 0, 1);
    e.shieldAngle = Math.PI; // facing left toward player at (0,0)
    const ev: ReturnType<GameSim['drainEvents']> = [];

    // Frontal hit (dirX > 0 from player at 0 to enemy at 150 -> incoming from left = Math.PI)
    sim.combat.applyElementalHit(e, 40, ['THERMAL'], 1, 0, ev);
    expect(e.hp).toBe(e.maxHp);

    // Flanking hit from behind (dirX < 0)
    sim.combat.applyElementalHit(e, 40, ['THERMAL'], -1, 0, ev);
    expect(e.hp).toBeLessThan(e.maxHp);

    // KINETIC shatters front shield
    sim.combat.applyElementalHit(e, 30, ['KINETIC'], 1, 0, ev);
    expect(e.hasFrontShield).toBe(false);
    expect(e.shieldHp).toBe(0);
  });

  it('SPLITTER spawns 2 Swarmers on normal death, and 0 when killed while FROZEN', () => {
    const simNormal = new GameSim();
    simNormal.combat.enemies = [];
    simNormal.waveDirector.rifts = [];
    const s1 = simNormal.combat.spawnEnemy('SPLITTER', 300, 0, 1);
    s1.hp = 0;
    simNormal.step(makeInput());
    expect(simNormal.getSnapshot().enemies.filter((e) => e.archetype === 'SWARMER').length).toBe(2);

    const simFrozen = new GameSim();
    simFrozen.combat.enemies = [];
    simFrozen.waveDirector.rifts = [];
    const s2 = simFrozen.combat.spawnEnemy('SPLITTER', 300, 0, 1);
    s2.statuses.FROZEN = { type: 'FROZEN', remaining: 2, stacks: 1, potency: 1 };
    s2.hp = 0;
    simFrozen.step(makeInput());
    expect(simFrozen.getSnapshot().enemies.filter((e) => e.archetype === 'SWARMER').length).toBe(0);
  });

  it('WEAVER enters Beam Clash against opposing player VOID beam and detonates when overpowered', () => {
    const sim = new GameSim();
    sim.getSnapshot().player.x = 0;
    sim.waveDirector.pillars = [];
    sim.combat.enemies = [];
    const weaver = sim.combat.spawnEnemy('WEAVER', 240, 0, 1);
    weaver.aiState = 'FIRE';
    weaver.aiTimer = 2.0;
    weaver.beamAngle = Math.PI;
    sim.combat.beams.push({
      id: 9001,
      owner: 'ENEMY',
      ownerEnemyId: weaver.id,
      x: 240,
      y: 0,
      angle: Math.PI,
      length: 500,
      width: 14,
      damagePerSec: 20,
      life: 2.0,
      maxLife: 2.0,
      colorHex: 0xb429ff,
      colors: [0xb429ff],
      elements: ['VOID'],
      composition: { counts: { VOID: 1 }, ratios: { VOID: 1 }, totalPower: 1, colors: [0xb429ff], weightedColors: [0xb429ff], primaryColorHex: 0xb429ff, secondaryColorHex: 0xb429ff },
      clashing: false,
      clashDist: 500,
    });

    queueAndStep(sim, ['VOID', 'VOID']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 240, aimY: 0 }));
    let sawClash = false;
    for (let i = 0; i < 48; i++) {
      sim.step(makeInput({ castHeld: true, aimX: 240, aimY: 0 }));
      if (sim.drainEvents().some((e) => e.type === 'beam_clash')) {
        sawClash = true;
      }
    }
    expect(sawClash).toBe(true);
    expect(sim.getSnapshot().enemies.some((e) => e.id === weaver.id)).toBe(false);
  });

  it('WaveDirector spawns Sector Warden boss on Sector 5 after 2.0s rift telegraph', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    const ev: ReturnType<GameSim['drainEvents']> = [];
    sim.waveDirector.startWave(5, ev);
    expect(sim.getSnapshot().rifts.length).toBeGreaterThan(0);
    expect(sim.getSnapshot().enemies.length).toBe(0);

    const ticks = Math.ceil(2.1 / FIXED_DT);
    for (let i = 0; i < ticks; i++) {
      sim.step(makeInput());
    }
    expect(sim.getSnapshot().enemies.some((e) => e.archetype === 'WARDEN')).toBe(true);
    expect(sim.getSnapshot().boss).not.toBeNull();
  });

  it('truncates beams at ArenaPillars for real tactical cover', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.pillars = [{ id: 1, x: -700, y: 0, radius: 44, sides: 6 }];
    const p = sim.getSnapshot().player;
    p.x = -960;
    p.y = 0;

    queueAndStep(sim, ['VOID']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: -400, aimY: 0 }));
    sim.step(makeInput({ castHeld: true, aimX: -400, aimY: 0 }));
    const beam = sim.getSnapshot().beams[0]!;
    expect(beam.clashing).toBe(true);
    expect(beam.clashDist).toBeLessThan(260);
  });

  it('opens East gate when sector is cleared and advances to Sector 2 on entry', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.step(makeInput());
    expect(sim.getSnapshot().gate.open).toBe(true);

    const p = sim.getSnapshot().player;
    p.hp = 60;
    p.x = sim.getSnapshot().gate.x;
    p.y = sim.getSnapshot().gate.y;
    sim.step(makeInput());

    expect(sim.getSnapshot().wave).toBe(2);
    expect(sim.getSnapshot().gate.open).toBe(false);
    expect(sim.getSnapshot().player.x).toBeLessThan(-800);
    expect(sim.getSnapshot().player.hp).toBe(85);
  });

  it('grants 0.75s i-frames and knocks back nearby enemies on player damage', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const p = sim.getSnapshot().player;
    const e = sim.combat.spawnEnemy('SWARMER', p.x + 25, p.y, 1);
    const ev: ReturnType<GameSim['drainEvents']> = [];
    sim.combat.damagePlayer(p, 10, e, () => {}, ev);

    expect(p.invulnTimer).toBeCloseTo(0.75);
    expect(e.vx).toBeGreaterThan(150);
  });

  it('walls block enemy projectiles, burning walls ignite, crystal walls shatter, and void walls pull', () => {
    // 1. Wall blocks enemy FROST_NEEDLE
    const simBlock = new GameSim();
    simBlock.combat.enemies = [];
    simBlock.waveDirector.rifts = [];
    queueAndStep(simBlock, ['BARRIER', 'KINETIC']);
    simBlock.step(makeInput({ castAction: 'FORWARD' }));
    const wall = simBlock.getSnapshot().walls[2]!;
    simBlock.combat.projectiles.push({
      id: 999,
      owner: 'ENEMY',
      kind: 'FROST_NEEDLE',
      x: wall.x,
      y: wall.y,
      vx: -100,
      vy: 0,
      radius: 7,
      damage: 12,
      pierce: 1,
      life: 2,
      maxLife: 2,
      colorHex: 0x00f5ff,
      colors: [0x00f5ff],
      elements: ['CRYO'],
      composition: { counts: { CRYO: 1 }, ratios: { CRYO: 1 }, totalPower: 1, colors: [0x00f5ff], weightedColors: [0x00f5ff], primaryColorHex: 0x00f5ff, secondaryColorHex: 0x00f5ff },
      hitIds: [],
      spin: 0,
    });
    simBlock.step(makeInput());
    expect(simBlock.getSnapshot().projectiles.length).toBe(0);

    // 2. Burning wall ignites nearby enemies
    const simBurn = new GameSim();
    simBurn.combat.enemies = [];
    simBurn.waveDirector.rifts = [];
    queueAndStep(simBurn, ['BARRIER', 'KINETIC', 'THERMAL']);
    simBurn.step(makeInput({ castAction: 'FORWARD' }));
    const bw = simBurn.getSnapshot().walls[2]!;
    const e = simBurn.combat.spawnEnemy('BASTION', bw.x + 50, bw.y, 1);
    e.hasFrontShield = false;
    for (let i = 0; i < 30; i++) simBurn.step(makeInput());
    expect(e.statuses.IGNITED).toBeDefined();

    // 3. Crystal wall shatters into 4 SHATTER_SHARDs on expiry
    const simCrys = new GameSim();
    simCrys.combat.enemies = [];
    simCrys.waveDirector.rifts = [];
    queueAndStep(simCrys, ['BARRIER', 'FLUX', 'CRYO']);
    simCrys.step(makeInput({ castAction: 'FORWARD' }));
    const cw = simCrys.getSnapshot().walls[0]!;
    cw.life = 0.01;
    simCrys.step(makeInput());
    expect(simCrys.getSnapshot().projectiles.filter((p) => p.kind === 'SHATTER_SHARD').length).toBeGreaterThanOrEqual(4);

    // 4. Void wall pulls nearby enemies inward
    const simVoid = new GameSim();
    simVoid.combat.enemies = [];
    simVoid.waveDirector.rifts = [];
    queueAndStep(simVoid, ['BARRIER', 'KINETIC', 'VOID']);
    simVoid.step(makeInput({ castAction: 'FORWARD' }));
    const vw = simVoid.getSnapshot().walls[2]!;
    const ve = simVoid.combat.spawnEnemy('BASTION', vw.x + 90, vw.y, 1);
    for (let i = 0; i < 15; i++) simVoid.step(makeInput());
    expect(ve.vx).toBeLessThan(0);
  });

  it('channeled FLUX + THERMAL (Plasma) beam spawns 0 puddles in empty space', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    queueAndStep(sim, ['FLUX', 'THERMAL', 'VOID']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 300, aimY: 0 }));
    for (let i = 0; i < 40; i++) {
      sim.step(makeInput({ castHeld: true, aimX: 300, aimY: 0 }));
    }
    expect(sim.getSnapshot().pools.length).toBe(0);
  });

  it('caps active storms at 1 and active mines at 8', () => {
    const sim = new GameSim();
    const waitCooldown = () => {
      for (let i = 0; i < 12; i++) sim.step(makeInput());
    };
    queueAndStep(sim, ['BARRIER', 'THERMAL', 'VOLT']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: 150, aimY: 0 }));
    waitCooldown();
    queueAndStep(sim, ['BARRIER', 'CRYO', 'VOLT']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: -150, aimY: 0 }));
    expect(sim.getSnapshot().storms.length).toBe(1);

    waitCooldown();
    queueAndStep(sim, ['BARRIER', 'VOID', 'THERMAL']);
    sim.step(makeInput({ castAction: 'FORWARD' }));
    waitCooldown();
    queueAndStep(sim, ['BARRIER', 'VOID', 'THERMAL']);
    sim.step(makeInput({ castAction: 'FORWARD' }));
    expect(sim.getSnapshot().mines.length).toBe(8);
  });

  it('directional shield has higher durability than omni-dome and reflects enemy projectiles', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'NOVA' }));
    const novaHp = sim.getSnapshot().shields[0]!.maxHp;

    for (let i = 0; i < 12; i++) sim.step(makeInput());
    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    const fwdShield = sim.getSnapshot().shields[0]!;
    expect(fwdShield.maxHp).toBeGreaterThan(novaHp);

    sim.combat.projectiles.push({
      id: 8888,
      owner: 'ENEMY',
      kind: 'FROST_NEEDLE',
      x: fwdShield.x + fwdShield.radius,
      y: fwdShield.y,
      vx: -250,
      vy: 0,
      radius: 7,
      damage: 12,
      pierce: 1,
      life: 2,
      maxLife: 2,
      colorHex: 0x00f5ff,
      colors: [0x00f5ff],
      elements: ['CRYO'],
      composition: { counts: { CRYO: 1 }, ratios: { CRYO: 1 }, totalPower: 1, colors: [0x00f5ff], weightedColors: [0x00f5ff], primaryColorHex: 0x00f5ff, secondaryColorHex: 0x00f5ff },
      hitIds: [],
      spin: 0,
    });
    sim.step(makeInput({ aimX: 300, aimY: 0 }));
    const reflected = sim.getSnapshot().projectiles.find((p) => p.id === 8888);
    expect(reflected).toBeDefined();
    expect(reflected!.owner).toBe('PLAYER');
    expect(reflected!.vx).toBeGreaterThan(0);
    expect(sim.drainEvents().some((e) => e.type === 'damage_number' && e.text === 'REFLECT!')).toBe(true);
  });

  it('continuous wall forcefield blocks enemy projectiles across the gap between adjacent pylons', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    queueAndStep(sim, ['BARRIER', 'KINETIC']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    const w0 = sim.getSnapshot().walls[0]!;
    const w1 = sim.getSnapshot().walls[1]!;
    const midX = (w0.x + w1.x) * 0.5;
    const midY = (w0.y + w1.y) * 0.5;

    sim.combat.projectiles.push({
      id: 7777,
      owner: 'ENEMY',
      kind: 'FROST_NEEDLE',
      x: midX,
      y: midY,
      vx: -200,
      vy: 0,
      radius: 7,
      damage: 12,
      pierce: 1,
      life: 2,
      maxLife: 2,
      colorHex: 0x00f5ff,
      colors: [0x00f5ff],
      elements: ['CRYO'],
      composition: { counts: { CRYO: 1 }, ratios: { CRYO: 1 }, totalPower: 1, colors: [0x00f5ff], weightedColors: [0x00f5ff], primaryColorHex: 0x00f5ff, secondaryColorHex: 0x00f5ff },
      hitIds: [],
      spin: 0,
    });
    sim.step(makeInput());
    expect(sim.getSnapshot().projectiles.some((p) => p.id === 7777)).toBe(false);
  });

  it('FLUX spray pushes enemies while THERMAL, PLASMA, and CRYO sprays apply zero knockback', () => {
    const testKnockback = (els: BaseElement[]): number => {
      const sim = new GameSim();
      sim.combat.enemies = [];
      sim.waveDirector.rifts = [];
      const e = sim.combat.spawnEnemy('BASTION', sim.getSnapshot().player.x + 120, 0, 1);
      e.hasFrontShield = false;
      queueAndStep(sim, els);
      sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: e.x, aimY: 0 }));
      return e.vx;
    };

    expect(testKnockback(['FLUX'])).toBeGreaterThan(100);
    expect(testKnockback(['THERMAL'])).toBeLessThanOrEqual(0);
    expect(testKnockback(['FLUX', 'THERMAL'])).toBeLessThanOrEqual(0);
    expect(testKnockback(['CRYO'])).toBeLessThanOrEqual(0);
  });

  it('water never spawns puddles on empty air, and PLASMA never spawns puddles even on hit', () => {
    const simAir = new GameSim();
    simAir.combat.enemies = [];
    simAir.waveDirector.rifts = [];
    queueAndStep(simAir, ['FLUX']);
    simAir.step(makeInput({ castAction: 'NOVA' }));
    expect(simAir.getSnapshot().pools.length).toBe(0);

    const simPlasma = new GameSim();
    simPlasma.combat.enemies = [];
    simPlasma.waveDirector.rifts = [];
    const e = simPlasma.combat.spawnEnemy('BASTION', simPlasma.getSnapshot().player.x + 80, 0, 1);
    e.hasFrontShield = false;
    queueAndStep(simPlasma, ['FLUX', 'THERMAL']);
    simPlasma.step(makeInput({ castAction: 'NOVA' }));
    expect(simPlasma.getSnapshot().pools.length).toBe(0);
  });

  it('ArenaBlocks stop enemies, block projectiles, and truncate beams', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.pillars = [];
    sim.waveDirector.blocks = [{ id: 1, x: -700, y: 0, halfW: 50, halfH: 80, height: 68 }];
    const p = sim.getSnapshot().player;
    p.x = -960;
    p.y = 0;

    // 1. Beam truncates cleanly at ArenaBlock face (-750)
    queueAndStep(sim, ['VOID']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: -400, aimY: 0 }));
    sim.step(makeInput({ castHeld: true, aimX: -400, aimY: 0 }));
    const beam = sim.getSnapshot().beams[0]!;
    expect(beam.clashing).toBe(true);
    expect(beam.clashDist).toBeLessThan(220);

    // 2. Enemy pushed outside ArenaBlock AABB
    const e = sim.combat.spawnEnemy('SWARMER', -700, 0, 1);
    sim.step(makeInput());
    expect(Math.abs(e.x - -700)).toBeGreaterThanOrEqual(50);
  });

  it('pure FLUX spray deals 0 damage, pushes strongly, leaves 0 puddles, and splashes PRIMED nearby', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const px = sim.getSnapshot().player.x;
    const target = sim.combat.spawnEnemy('BASTION', px + 110, 0, 1);
    target.hasFrontShield = false;
    const bystander = sim.combat.spawnEnemy('BASTION', px + 165, 50, 1);
    bystander.hasFrontShield = false;

    queueAndStep(sim, ['FLUX']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: target.x, aimY: 0 }));

    const snap = sim.getSnapshot();
    expect(target.hp).toBe(target.maxHp);
    expect(bystander.hp).toBe(bystander.maxHp);
    expect(target.vx).toBeGreaterThan(100);
    expect(target.statuses.PRIMED).toBeDefined();
    expect(bystander.statuses.PRIMED).toBeDefined();
    expect(snap.pools.length).toBe(0);
  });

  it('keeps Forward Shield static in place while Self-Cast BARRIER follows player movement', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];

    // Forward Barrier stays anchored
    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: sim.getSnapshot().player.x + 200, aimY: 0 }));
    const forwardShieldId = sim.getSnapshot().shields[0]!.id;
    const initShieldX = sim.getSnapshot().shields[0]!.x;

    // Move player away for > castCooldown (12 ticks = 0.2s)
    for (let i = 0; i < 12; i++) {
      sim.step(makeInput({ moveX: -1, moveY: 0 }));
    }
    const movedForwardShield = sim.getSnapshot().shields.find((s) => s.id === forwardShieldId)!;
    expect(movedForwardShield.x).toBe(initShieldX);

    // Self-Cast Barrier follows player (step 15 ticks right so player velocity reverses cleanly)
    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'SELF' }));
    const selfShield = sim.getSnapshot().shields.find((s) => s.id !== forwardShieldId)!;
    const selfId = selfShield.id;
    const beforeX = selfShield.x;
    for (let i = 0; i < 15; i++) {
      sim.step(makeInput({ moveX: 1, moveY: 0 }));
    }
    const afterX = sim.getSnapshot().shields.find((s) => s.id === selfId)!.x;
    expect(afterX).toBeGreaterThan(beforeX);
  });

  it('VOID-infused crystal shards steer toward a nearby off-axis enemy', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const px = sim.getSnapshot().player.x;
    const offAxisEnemy = sim.combat.spawnEnemy('BASTION', px + 260, 75, 1);
    offAxisEnemy.hasFrontShield = false;

    queueAndStep(sim, ['VOID', 'FLUX', 'CRYO']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: px + 300, aimY: 0 }));
    const projId = sim.getSnapshot().projectiles[0]!.id;
    const initialVy = sim.getSnapshot().projectiles[0]!.vy;

    for (let i = 0; i < 6; i++) {
      sim.step(makeInput({ aimX: px + 300, aimY: 0 }));
    }
    const steeredProj = sim.getSnapshot().projectiles.find((p) => p.id === projId)!;
    expect(steeredProj).toBeDefined();
    expect(steeredProj.vy).toBeGreaterThan(initialVy);
  });

  it('mixed VOLT + CRYO on wet (PRIMED) enemies triggers both OVERLOAD and FROZEN on target and AoE bystander', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const e1 = sim.combat.spawnEnemy('BASTION', 200, 0, 1);
    e1.hasFrontShield = false;
    e1.statuses.PRIMED = { type: 'PRIMED', remaining: 5, stacks: 1, potency: 1 };
    const e2 = sim.combat.spawnEnemy('BASTION', 260, 0, 1);
    e2.hasFrontShield = false;
    e2.statuses.PRIMED = { type: 'PRIMED', remaining: 5, stacks: 1, potency: 1 };

    const events: ReturnType<typeof sim.drainEvents> = [];
    sim.combat.applyElementalHit(e1, 20, ['VOLT', 'CRYO'], 1, 0, events);

    expect(e1.hp).toBeLessThan(e1.maxHp - 25); // 2x Overload damage
    expect(e1.statuses.FROZEN).toBeDefined();
    expect(e1.statuses.PRIMED).toBeUndefined();
    expect(e2.statuses.FROZEN).toBeDefined();
    expect(e2.statuses.PRIMED).toBeUndefined();
    const texts = events.filter((ev) => ev.type === 'damage_number').map((ev) => ev.text);
    expect(texts).toContain('OVERLOAD!');
    expect(texts).toContain('FROZEN!');
  });

  it('continues moving toward held cursor after dash ends, and stops cleanly when released', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.pillars = [];
    sim.waveDirector.blocks = [];
    const p = sim.getSnapshot().player;
    p.x = 0;
    p.y = 0;

    // Trigger dash while holding LMB (moveToCursor: true)
    sim.step(makeInput({ dashPressed: true, moveToCursor: true, aimX: 600, aimY: 0 }));
    expect(p.dashTimer).toBeGreaterThan(0);

    for (let i = 0; i < 14; i++) {
      sim.step(makeInput({ moveToCursor: true, aimX: 600, aimY: 0 }));
    }
    expect(p.dashTimer).toBe(0);
    expect(p.moving).toBe(true);

    const xAfterDash = p.x;
    for (let i = 0; i < 10; i++) {
      sim.step(makeInput({ moveToCursor: true, aimX: 600, aimY: 0 }));
    }
    expect(p.x).toBeGreaterThan(xAfterDash + 15);
    expect(p.moving).toBe(true);

    // Releasing LMB slows down and marks moving = false
    for (let i = 0; i < 15; i++) {
      sim.step(makeInput({ moveToCursor: false, aimX: 600, aimY: 0 }));
    }
    expect(p.moving).toBe(false);
    expect(Math.abs(p.vx)).toBeLessThan(15);
  });

  it('uses distinct crimson VOID, fire orange THERMAL, and earthy brown KINETIC element colors', () => {
    expect(ELEMENT_META.VOID.colorHex).toBe(0xff2438);
    expect(ELEMENT_META.THERMAL.colorHex).toBe(0xff6a00);
    expect(ELEMENT_META.KINETIC.colorHex).toBe(0xa86b3e);
  });

  it('imbued Kinetic rocks detonate with imbued element explosions, cryo shatter shards, and void pull', () => {
    // 1. KINETIC + THERMAL rock emits vfx_element_explosion and ignites
    const simFire = new GameSim();
    simFire.combat.enemies = [];
    simFire.waveDirector.rifts = [];
    const targetFire = simFire.combat.spawnEnemy('BASTION', simFire.getSnapshot().player.x + 90, 0, 1);
    targetFire.hasFrontShield = false;
    queueAndStep(simFire, ['KINETIC', 'THERMAL']);
    simFire.step(makeInput({ castAction: 'FORWARD', castHeld: false, aimX: targetFire.x, aimY: 0 }));
    for (let i = 0; i < 6; i++) simFire.step(makeInput({ aimX: targetFire.x, aimY: 0 }));
    const fireExp = simFire.drainEvents().find((ev) => ev.type === 'vfx_element_explosion');
    expect(fireExp?.type).toBe('vfx_element_explosion');
    if (fireExp?.type === 'vfx_element_explosion') {
      expect(fireExp.elements).toContain('KINETIC');
      expect(fireExp.elements).toContain('THERMAL');
    }
    expect(targetFire.statuses.IGNITED).toBeDefined();

    // 2. KINETIC + CRYO rock spawns 4 radial SHATTER_SHARD spikes on detonation
    const simCryo = new GameSim();
    simCryo.combat.enemies = [];
    simCryo.waveDirector.rifts = [];
    const targetCryo = simCryo.combat.spawnEnemy('BASTION', simCryo.getSnapshot().player.x + 80, 0, 1);
    targetCryo.hasFrontShield = false;
    queueAndStep(simCryo, ['KINETIC', 'CRYO']);
    simCryo.step(makeInput({ castAction: 'FORWARD', castHeld: false, aimX: targetCryo.x, aimY: 0 }));
    for (let i = 0; i < 6; i++) simCryo.step(makeInput({ aimX: targetCryo.x, aimY: 0 }));
    const shards = simCryo.getSnapshot().projectiles.filter((p) => p.kind === 'SHATTER_SHARD');
    expect(shards.length).toBe(4);

    // 3. KINETIC + VOID rock pulls nearby enemies inward on detonation
    const simVoid = new GameSim();
    simVoid.combat.enemies = [];
    simVoid.waveDirector.rifts = [];
    const px = simVoid.getSnapshot().player.x;
    const hitEnemy = simVoid.combat.spawnEnemy('BASTION', px + 85, 0, 1);
    hitEnemy.hasFrontShield = false;
    const pulled = simVoid.combat.spawnEnemy('BASTION', px + 145, 0, 1);
    pulled.hasFrontShield = false;
    queueAndStep(simVoid, ['KINETIC', 'VOID']);
    simVoid.step(makeInput({ castAction: 'FORWARD', castHeld: false, aimX: hitEnemy.x, aimY: 0 }));
    for (let i = 0; i < 6; i++) simVoid.step(makeInput({ aimX: hitEnemy.x, aimY: 0 }));
    expect(pulled.vx).toBeLessThan(0);
  });

  it('emits vfx_enemy_death with position and active statuses when an enemy dies', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const e = sim.combat.spawnEnemy('BASTION', 220, 45, 1);
    e.statuses.IGNITED = { type: 'IGNITED', remaining: 3, stacks: 1, potency: 1 };
    e.hp = 0;
    sim.step(makeInput());
    const deathEv = sim.drainEvents().find((ev) => ev.type === 'vfx_enemy_death');
    expect(deathEv?.type).toBe('vfx_enemy_death');
    if (deathEv?.type === 'vfx_enemy_death') {
      expect(deathEv.x).toBe(220);
      expect(deathEv.y).toBe(45);
      expect(deathEv.statuses).toContain('IGNITED');
    }
  });

  it('includes elements array with PLASMA on Fire+Water spray events', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    queueAndStep(sim, ['THERMAL', 'FLUX']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 200, aimY: 0 }));
    const sprayEv = sim.drainEvents().find((ev) => ev.type === 'vfx_spray');
    expect(sprayEv?.type).toBe('vfx_spray');
    if (sprayEv?.type === 'vfx_spray') {
      expect(sprayEv.elements).toContain('PLASMA');
    }
  });
});

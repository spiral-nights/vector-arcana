import { describe, expect, it } from 'vitest';
import { createConvexObstacle, makeRotatedRectVerts } from './ArenaGeometry';
import { getWaveScaling } from './EnemyAI';
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
  it('emits both storm strikes and lightning bolts after storm-bomb detonates for VOLT + THERMAL + BARRIER', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    queueAndStep(sim, ['VOLT', 'THERMAL', 'BARRIER']);
    sim.step(makeInput({ castAction: 'FORWARD' }));
    expect(sim.getSnapshot().projectiles.some((p) => p.kind === 'STORM_BOMB')).toBe(true);
    let sawStrike = false;
    let sawLightning = false;
    for (let i = 0; i < 65; i++) {
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

describe('Milestone 3 — Primer Combos, Enemy Archetypes, Beam Clash & Wave Director', () => {
  it('deals 1.4x VOLT damage to PRIMED targets and freezes PRIMED targets hit by CRYO', () => {
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
    expect(primedDmg).toBeCloseTo(normalDmg * 1.4);

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
    sim.combat.applyElementalHit(e, 30, ['NANO'], 1, 0, ev);
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

  it('CINDER_WISP never spawns hazards on the player without a wind-up, and plants them at its own position', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const px = sim.getSnapshot().player.x;
    const py = sim.getSnapshot().player.y;
    const wisp = sim.combat.spawnEnemy('CINDER_WISP', px + 220, py, 1);
    wisp.aiTimer = 0;

    sim.step(makeInput());
    expect(sim.getSnapshot().hazards.length).toBe(0);
    expect(wisp.aiState).toBe('CHARGE');

    for (let i = 0; i < 90; i++) sim.step(makeInput());
    const hazard = sim.getSnapshot().hazards[0];
    expect(hazard).toBeDefined();
    if (hazard) {
      // The hazard is planted where the wisp landed, never under the player for free.
      expect(Math.hypot(hazard.x - wisp.x, hazard.y - wisp.y)).toBeLessThan(30);
    }
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
    for (let i = 0; i < 50; i++) sim.step(makeInput());
    queueAndStep(sim, ['BARRIER', 'CRYO', 'VOLT']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: -150, aimY: 0 }));
    for (let i = 0; i < 50; i++) sim.step(makeInput());
    expect(sim.getSnapshot().storms.length).toBe(1);

    const px = sim.getSnapshot().player.x;
    waitCooldown();
    queueAndStep(sim, ['BARRIER', 'VOID', 'THERMAL']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: px + 200, aimY: 0 }));
    waitCooldown();
    queueAndStep(sim, ['BARRIER', 'VOID', 'THERMAL']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: px, aimY: 200 }));
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

    const fluxVx = testKnockback(['FLUX']);
    expect(fluxVx).toBeGreaterThan(50);
    expect(fluxVx).toBeLessThan(150);
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
    expect(target.vx).toBeGreaterThan(50);
    expect(target.vx).toBeLessThan(150);
    expect(target.statuses.PRIMED).toBeDefined();
    expect(bystander.statuses.PRIMED).toBeDefined();
    expect(snap.pools.length).toBe(0);
  });

  it('keeps Forward Shield and Nova Sanctuary Dome anchored in place when cast', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];

    // Forward Barrier stays anchored
    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: sim.getSnapshot().player.x + 200, aimY: 0 }));
    const forwardShieldId = sim.getSnapshot().shields[0]!.id;
    const initShieldX = sim.getSnapshot().shields[0]!.x;

    for (let i = 0; i < 12; i++) {
      sim.step(makeInput({ moveX: -1, moveY: 0 }));
    }
    expect(sim.getSnapshot().shields.find((s) => s.id === forwardShieldId)!.x).toBe(initShieldX);

    // Nova Barrier Dome is large (118px) and anchored stationary
    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'NOVA' }));
    const dome = sim.getSnapshot().shields[0]!;
    expect(dome.radius).toBe(118);
    expect(dome.isNova).toBe(true);
    const domeX = dome.x;
    for (let i = 0; i < 15; i++) {
      sim.step(makeInput({ moveX: 1, moveY: 0 }));
    }
    expect(sim.getSnapshot().shields[0]!.x).toBe(domeX);
  });

  it('NANO-infused crystal shards steer toward off-axis enemies while VOID shards fly straight with higher damage', () => {
    const simNano = new GameSim();
    simNano.combat.enemies = [];
    simNano.waveDirector.rifts = [];
    const npx = simNano.getSnapshot().player.x;
    const offAxisEnemy = simNano.combat.spawnEnemy('BASTION', npx + 260, 75, 1);
    offAxisEnemy.hasFrontShield = false;

    queueAndStep(simNano, ['NANO', 'FLUX', 'CRYO']);
    simNano.step(makeInput({ castAction: 'FORWARD', aimX: npx + 300, aimY: 0 }));
    const projId = simNano.getSnapshot().projectiles[0]!.id;
    const initialVy = simNano.getSnapshot().projectiles[0]!.vy;

    for (let i = 0; i < 6; i++) {
      simNano.step(makeInput({ aimX: npx + 300, aimY: 0 }));
    }
    const steeredProj = simNano.getSnapshot().projectiles.find((p) => p.id === projId)!;
    expect(steeredProj).toBeDefined();
    expect(steeredProj.vy).toBeGreaterThan(initialVy);

    // VOID does not home
    const simVoid = new GameSim();
    simVoid.combat.enemies = [];
    simVoid.waveDirector.rifts = [];
    const vpx = simVoid.getSnapshot().player.x;
    const vEnemy = simVoid.combat.spawnEnemy('BASTION', vpx + 260, 75, 1);
    vEnemy.hasFrontShield = false;
    queueAndStep(simVoid, ['VOID', 'FLUX', 'CRYO']);
    simVoid.step(makeInput({ castAction: 'FORWARD', aimX: vpx + 300, aimY: 0 }));
    const vProjId = simVoid.getSnapshot().projectiles[0]!.id;
    const vInitVy = simVoid.getSnapshot().projectiles[0]!.vy;
    for (let i = 0; i < 6; i++) {
      simVoid.step(makeInput({ aimX: vpx + 300, aimY: 0 }));
    }
    expect(simVoid.getSnapshot().projectiles.find((p) => p.id === vProjId)!.vy).toBeCloseTo(vInitVy, 4);
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

    expect(e1.hp).toBeLessThan(e1.maxHp - 18); // 1.4x Overload damage
    expect(e1.hp).toBeGreaterThan(e1.maxHp - 24);
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

  it('player and enemy beams span full screen (>= 1800px)', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    queueAndStep(sim, ['VOID']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 300, aimY: 0 }));
    expect(sim.getSnapshot().beams[0]!.length).toBeGreaterThanOrEqual(1850);

    const weaver = sim.combat.spawnEnemy('WEAVER', 400, 0, 1);
    weaver.aiState = 'CHARGE';
    weaver.aiTimer = 0.01;
    weaver.beamAngle = Math.PI;
    sim.step(makeInput({ castHeld: false }));
    const enemyBeam = sim.getSnapshot().beams.find((b) => b.owner === 'ENEMY')!;
    expect(enemyBeam.length).toBeGreaterThanOrEqual(1900);
  });

  it('combined FLUX + VOID deals reduced damage compared to pure VOID and pushes enemies', () => {
    const simPure = new GameSim();
    simPure.combat.enemies = [];
    const ePure = simPure.combat.spawnEnemy('SWARMER', 200, 0, 1);
    ePure.maxHp = 500;
    ePure.hp = 500;
    simPure.combat.applyElementalHit(ePure, 40, ['VOID'], 1, 0, []);
    const pureDmg = 500 - ePure.hp;

    const simMix = new GameSim();
    simMix.combat.enemies = [];
    const eMix = simMix.combat.spawnEnemy('SWARMER', 200, 0, 1);
    eMix.maxHp = 500;
    eMix.hp = 500;
    simMix.combat.applyElementalHit(eMix, 40, ['FLUX', 'VOID'], 1, 0, []);
    const mixDmg = 500 - eMix.hp;

    expect(mixDmg).toBeLessThan(pureDmg);
    expect(eMix.vx).toBeGreaterThan(100);
  });

  it('PYRO_SPRAYER and GEO_BOMBER have elemental weaknesses (1.75x + WEAK!) and fire sprays / rocks', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const pyro = sim.combat.spawnEnemy('PYRO_SPRAYER', sim.getSnapshot().player.x + 120, 0, 1);
    expect(pyro.weakness).toBe('CRYO');
    const geo = sim.combat.spawnEnemy('GEO_BOMBER', sim.getSnapshot().player.x + 280, 0, 1);
    expect(geo.weakness).toBe('VOLT');

    const ev: ReturnType<GameSim['drainEvents']> = [];
    sim.combat.applyElementalHit(pyro, 20, ['CRYO'], 1, 0, ev);
    expect(pyro.hp).toBeCloseTo(pyro.maxHp - 35);
    expect(ev.some((e) => e.type === 'damage_number' && e.text === 'WEAK!')).toBe(true);

    // Trigger PYRO_SPRAYER fire spray and GEO_BOMBER rock throw
    pyro.aiState = 'CHARGE';
    pyro.aiTimer = 0.01;
    geo.aiState = 'CHARGE';
    geo.aiTimer = 0.01;
    for (let i = 0; i < 4; i++) sim.step(makeInput());
    expect(sim.getSnapshot().projectiles.some((p) => p.kind === 'ENEMY_ROCK')).toBe(true);
    expect(sim.drainEvents().some((e) => e.type === 'vfx_spray')).toBe(true);
  });

  it('enforces freeze diminishing returns (freezeImmuneTimer) after Shatter or thaw', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    const e = sim.combat.spawnEnemy('BASTION', 200, 0, 1);
    e.hasFrontShield = false;
    e.statuses.FROZEN = { type: 'FROZEN', remaining: 1, stacks: 1, potency: 1 };

    sim.combat.applyElementalHit(e, 20, ['KINETIC'], 1, 0, []);
    expect(e.freezeImmuneTimer).toBeGreaterThan(2.5);

    e.statuses.PRIMED = { type: 'PRIMED', remaining: 5, stacks: 1, potency: 1 };
    sim.combat.applyElementalHit(e, 10, ['CRYO'], 1, 0, []);
    expect(e.statuses.FROZEN).toBeUndefined();
    expect(e.statuses.CHILLED).toBeDefined();
  });

  it('3-Phase WARDEN boss adds 4th shield plate under 50% HP and fires triple beams in Phase 3', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const warden = sim.combat.spawnEnemy('WARDEN', 400, 0, 5);
    expect(warden.bossShieldAngles.length).toBe(3);

    warden.hp = Math.round(warden.maxHp * 0.25);
    warden.aiState = 'CHARGE';
    warden.aiTimer = 0.01;
    sim.step(makeInput());

    expect(warden.bossPhase).toBe(3);
    expect(warden.bossShieldAngles.length).toBe(4);
    expect(sim.getSnapshot().beams.filter((b) => b.ownerEnemyId === warden.id).length).toBe(3);
  });
});

describe('CombatEngine — Elemental Wall Consistency', () => {
  it('assigns infused element colorHex regardless of KINETIC vs payload queue order', () => {
    const simKineticFirst = new GameSim();
    queueAndStep(simKineticFirst, ['BARRIER', 'KINETIC', 'FLUX']);
    simKineticFirst.step(makeInput({ castAction: 'FORWARD' }));
    const wallsA = simKineticFirst.getSnapshot().walls;
    expect(wallsA.length).toBeGreaterThan(0);
    expect(wallsA[0]!.colorHex).toBe(ELEMENT_META.FLUX.colorHex);
    expect(wallsA[0]!.elements).toContain('FLUX');

    const simFluxFirst = new GameSim();
    queueAndStep(simFluxFirst, ['BARRIER', 'FLUX', 'KINETIC']);
    simFluxFirst.step(makeInput({ castAction: 'FORWARD' }));
    const wallsB = simFluxFirst.getSnapshot().walls;
    expect(wallsB.length).toBeGreaterThan(0);
    expect(wallsB[0]!.colorHex).toBe(ELEMENT_META.FLUX.colorHex);
    expect(wallsB[0]!.elements).toContain('FLUX');

    const simVoid = new GameSim();
    queueAndStep(simVoid, ['BARRIER', 'KINETIC', 'VOID']);
    simVoid.step(makeInput({ castAction: 'FORWARD' }));
    const wallsVoid = simVoid.getSnapshot().walls;
    expect(wallsVoid.length).toBeGreaterThan(0);
    expect(wallsVoid[0]!.colorHex).toBe(ELEMENT_META.VOID.colorHex);
    expect(wallsVoid[0]!.elements).toContain('VOID');

    const simStone = new GameSim();
    queueAndStep(simStone, ['BARRIER', 'KINETIC']);
    simStone.step(makeInput({ castAction: 'FORWARD' }));
    const wallsStone = simStone.getSnapshot().walls;
    expect(wallsStone.length).toBeGreaterThan(0);
    expect(wallsStone[0]!.colorHex).toBe(ELEMENT_META.KINETIC.colorHex);
  });
});

describe('CombatEngine — Balance, Blocking, Overlap & Combo Rules', () => {
  it('water beam pushes enemies away steadily', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.pillars = [];
    sim.waveDirector.blocks = [];
    const p = sim.getSnapshot().player;
    p.x = 0;
    p.y = 0;
    const target = sim.combat.spawnEnemy('BASTION', 220, 0, 1);
    target.hasFrontShield = false;
    const startX = target.x;

    queueAndStep(sim, ['VOID', 'FLUX']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 400, aimY: 0 }));
    for (let i = 0; i < 18; i++) {
      sim.step(makeInput({ castHeld: true, aimX: 400, aimY: 0 }));
    }

    expect(target.vx).toBeGreaterThan(40);
    expect(target.x).toBeGreaterThan(startX + 4);
  });

  it('weakens mines overall and makes NANO mines home onto nearby enemies with lower damage', () => {
    const simVoid = new GameSim();
    simVoid.combat.enemies = [];
    simVoid.waveDirector.rifts = [];
    queueAndStep(simVoid, ['BARRIER', 'VOID']);
    simVoid.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    const voidMine = simVoid.getSnapshot().mines[0]!;
    expect(voidMine.damage).toBe(42);
    expect(voidMine.blastRadius).toBeLessThan(145);

    const simNano = new GameSim();
    simNano.combat.enemies = [];
    simNano.waveDirector.rifts = [];
    simNano.waveDirector.pillars = [];
    simNano.waveDirector.blocks = [];
    simNano.getSnapshot().player.x = 0;
    simNano.getSnapshot().player.y = 0;
    queueAndStep(simNano, ['BARRIER', 'NANO']);
    simNano.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    const nanoMine = simNano.getSnapshot().mines[1]!;
    expect(nanoMine.damage).toBeLessThan(voidMine.damage);
    expect(nanoMine.damage).toBe(20);

    const enemy = simNano.combat.spawnEnemy('BASTION', nanoMine.x + 150, nanoMine.y, 1);
    const startMineX = nanoMine.x;
    for (let i = 0; i < 40; i++) {
      simNano.step(makeInput({ aimX: 300, aimY: 0 }));
      enemy.vx = 0;
      enemy.vy = 0;
    }
    expect(nanoMine.x).toBeGreaterThan(startMineX + 12);
  });

  it('Barrier shields block energy projectiles only, while Walls block both physical & energy and break quickly', () => {
    // 1. Barrier lets ENEMY_ROCK through while blocking FROST_NEEDLE
    const simShield = new GameSim();
    simShield.combat.enemies = [];
    simShield.waveDirector.rifts = [];
    queueAndStep(simShield, ['BARRIER']);
    simShield.step(makeInput({ castAction: 'FORWARD', aimX: simShield.getSnapshot().player.x + 200, aimY: 0 }));
    const shield = simShield.getSnapshot().shields[0]!;

    simShield.combat.projectiles.push({
      id: 9101,
      owner: 'ENEMY',
      kind: 'ENEMY_ROCK',
      x: shield.x + shield.radius,
      y: shield.y,
      vx: -250,
      vy: 0,
      radius: 17,
      damage: 20,
      pierce: 1,
      life: 2,
      maxLife: 2,
      colorHex: ELEMENT_META.KINETIC.colorHex,
      colors: [ELEMENT_META.KINETIC.colorHex],
      elements: ['KINETIC'],
      composition: { counts: { KINETIC: 1 }, ratios: { KINETIC: 1 }, totalPower: 1, colors: [ELEMENT_META.KINETIC.colorHex], weightedColors: [ELEMENT_META.KINETIC.colorHex], primaryColorHex: ELEMENT_META.KINETIC.colorHex, secondaryColorHex: ELEMENT_META.KINETIC.colorHex },
      hitIds: [],
      spin: 0,
    });
    simShield.step(makeInput({ aimX: shield.x + 200, aimY: shield.y }));
    const rockAfterShield = simShield.getSnapshot().projectiles.find((pr) => pr.id === 9101);
    expect(rockAfterShield).toBeDefined();
    expect(rockAfterShield!.owner).toBe('ENEMY');

    // 2. Wall blocks ENEMY_ROCK and breaks quickly (2-3 hits)
    const simWall = new GameSim();
    simWall.combat.enemies = [];
    simWall.waveDirector.rifts = [];
    queueAndStep(simWall, ['BARRIER', 'KINETIC']);
    simWall.step(makeInput({ castAction: 'FORWARD', aimX: simWall.getSnapshot().player.x + 200, aimY: 0 }));
    const initialWallCount = simWall.getSnapshot().walls.length;
    const pylon = simWall.getSnapshot().walls[2]!;
    expect(pylon.maxHp).toBeLessThanOrEqual(110);

    for (let hit = 0; hit < 3; hit++) {
      simWall.combat.projectiles.push({
        id: 9200 + hit,
        owner: 'ENEMY',
        kind: 'ENEMY_ROCK',
        x: pylon.x,
        y: pylon.y,
        vx: -250,
        vy: 0,
        radius: 17,
        damage: 20,
        pierce: 1,
        life: 2,
        maxLife: 2,
        colorHex: ELEMENT_META.KINETIC.colorHex,
        colors: [ELEMENT_META.KINETIC.colorHex],
        elements: ['KINETIC'],
        composition: { counts: { KINETIC: 1 }, ratios: { KINETIC: 1 }, totalPower: 1, colors: [ELEMENT_META.KINETIC.colorHex], weightedColors: [ELEMENT_META.KINETIC.colorHex], primaryColorHex: ELEMENT_META.KINETIC.colorHex, secondaryColorHex: ELEMENT_META.KINETIC.colorHex },
        hitIds: [],
        spin: 0,
      });
      simWall.step(makeInput());
      expect(simWall.getSnapshot().projectiles.some((pr) => pr.id === 9200 + hit)).toBe(false);
    }
    expect(simWall.getSnapshot().walls.length).toBeLessThan(initialWallCount);
  });

  it('prevents overlapping mines and walls in all 4 combinations by removing old deployables', () => {
    const setup = () => {
      const sim = new GameSim();
      sim.combat.enemies = [];
      sim.waveDirector.rifts = [];
      sim.waveDirector.pillars = [];
      sim.waveDirector.blocks = [];
      sim.getSnapshot().player.x = 0;
      sim.getSnapshot().player.y = 0;
      return sim;
    };
    const cd = (sim: GameSim) => {
      for (let i = 0; i < 12; i++) sim.step(makeInput());
    };

    // Mines on Mines
    const simMM = setup();
    queueAndStep(simMM, ['BARRIER', 'VOID']);
    simMM.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    const oldMineIds = new Set(simMM.getSnapshot().mines.map((m) => m.id));
    cd(simMM);
    queueAndStep(simMM, ['BARRIER', 'VOID']);
    simMM.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    expect(simMM.getSnapshot().mines.some((m) => oldMineIds.has(m.id))).toBe(false);

    // Walls on Walls
    const simWW = setup();
    queueAndStep(simWW, ['BARRIER', 'KINETIC']);
    simWW.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    const oldWallGroup = simWW.getSnapshot().walls[0]!.groupId;
    cd(simWW);
    queueAndStep(simWW, ['BARRIER', 'KINETIC']);
    simWW.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    expect(simWW.getSnapshot().walls.some((w) => w.groupId === oldWallGroup)).toBe(false);

    // Mines on Walls
    const simMW = setup();
    queueAndStep(simMW, ['BARRIER', 'KINETIC']);
    simMW.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    expect(simMW.getSnapshot().walls.length).toBeGreaterThan(0);
    cd(simMW);
    queueAndStep(simMW, ['BARRIER', 'VOID']);
    simMW.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    expect(simMW.getSnapshot().walls.length).toBe(0);

    // Walls on Mines
    const simWM = setup();
    queueAndStep(simWM, ['BARRIER', 'VOID']);
    simWM.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    expect(simWM.getSnapshot().mines.length).toBeGreaterThan(0);
    cd(simWM);
    queueAndStep(simWM, ['BARRIER', 'KINETIC']);
    simWM.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    expect(simWM.getSnapshot().mines.length).toBe(0);
  });

  it('freezes CHILLED enemies completely when hit by FLUX', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    const e = sim.combat.spawnEnemy('BASTION', 200, 0, 1);
    e.hasFrontShield = false;
    const ev: ReturnType<GameSim['drainEvents']> = [];

    sim.combat.applyElementalHit(e, 10, ['CRYO'], 1, 0, ev);
    expect(e.statuses.CHILLED).toBeDefined();
    expect(e.statuses.FROZEN).toBeUndefined();

    sim.combat.applyElementalHit(e, 0, ['FLUX'], 1, 0, ev);
    expect(e.statuses.FROZEN).toBeDefined();
    expect(e.statuses.CHILLED).toBeUndefined();
    expect(ev.some((x) => x.type === 'damage_number' && x.text === 'FROZEN!')).toBe(true);
  });
});

describe('CombatEngine — Max Health Cap, Spray Wall Blocking, Endless Scaling & New Enemies', () => {
  it('never exceeds maxHp from Nano kill heals, Nano wall pulses, or sector gate heals', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const p = sim.getSnapshot().player;
    p.x = 0;
    p.y = 0;
    p.hp = p.maxHp - 2;

    // 1. Nano kill heal clamps strictly to maxHp and reports actual healed HP (+2 HP)
    const marked = sim.combat.spawnEnemy('SWARMER', 180, 0, 1);
    marked.nanoMarkTimer = 3.0;
    marked.hp = 0;
    sim.drainEvents();
    sim.step(makeInput());
    expect(sim.getSnapshot().player.hp).toBe(p.maxHp);
    const evs = sim.drainEvents();
    expect(evs.some((ev) => ev.type === 'damage_number' && ev.text === '+2 HP')).toBe(true);

    // 2. Nano wall pulse at full HP does not exceed maxHp or emit heal burst
    queueAndStep(sim, ['BARRIER', 'KINETIC', 'NANO']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: 200, aimY: 0 }));
    for (const w of sim.getSnapshot().walls) {
      w.x = p.x + 20;
      w.y = p.y;
      w.pulseTimer = 0.01;
    }
    sim.drainEvents();
    sim.step(makeInput());
    expect(sim.getSnapshot().player.hp).toBe(p.maxHp);
  });

  it('blocks player Forward & Nova sprays and enemy Pyro sprays through walls & obstacles', () => {
    // 1. Player forward THERMAL / FLUX spray blocked by ArenaObstacle, ArenaPillar, and WallPylon
    const simObs = new GameSim();
    simObs.combat.enemies = [];
    simObs.waveDirector.rifts = [];
    simObs.waveDirector.pillars = [];
    simObs.waveDirector.blocks = [];
    simObs.waveDirector.obstacles = [createConvexObstacle(1, makeRotatedRectVerts(120, 0, 30, 140, 0), 80, 'BUNKER')];
    const p = simObs.getSnapshot().player;
    p.x = 0;
    p.y = 0;
    const behindObs = simObs.combat.spawnEnemy('BASTION', 240, 0, 1);
    behindObs.hasFrontShield = false;

    queueAndStep(simObs, ['THERMAL']);
    simObs.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 300, aimY: 0 }));
    for (let i = 0; i < 6; i++) simObs.step(makeInput({ castHeld: true, aimX: 300, aimY: 0 }));
    expect(behindObs.hp).toBe(behindObs.maxHp);

    // Nova spray also blocked by obstacle
    queueAndStep(simObs, ['FLUX']);
    simObs.step(makeInput({ castAction: 'NOVA', aimX: 300, aimY: 0 }));
    expect(behindObs.statuses.PRIMED).toBeUndefined();

    // Pillar blocks forward spray
    simObs.waveDirector.obstacles = [];
    simObs.waveDirector.pillars = [{ id: 1, x: 110, y: 0, radius: 42, sides: 6 }];
    queueAndStep(simObs, ['THERMAL']);
    simObs.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 300, aimY: 0 }));
    for (let i = 0; i < 6; i++) simObs.step(makeInput({ castHeld: true, aimX: 300, aimY: 0 }));
    expect(behindObs.hp).toBe(behindObs.maxHp);

    // Player-deployed wall blocks spray
    simObs.waveDirector.pillars = [];
    queueAndStep(simObs, ['BARRIER', 'KINETIC']);
    simObs.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));
    for (let i = 0; i < 12; i++) simObs.step(makeInput());
    queueAndStep(simObs, ['THERMAL']);
    simObs.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 300, aimY: 0 }));
    for (let i = 0; i < 6; i++) simObs.step(makeInput({ castHeld: true, aimX: 300, aimY: 0 }));
    expect(behindObs.hp).toBe(behindObs.maxHp);

    // 2. Enemy PYRO_SPRAYER spray blocked by ArenaObstacle
    const simPyro = new GameSim();
    simPyro.combat.enemies = [];
    simPyro.waveDirector.rifts = [];
    simPyro.waveDirector.pillars = [];
    simPyro.waveDirector.blocks = [];
    simPyro.waveDirector.obstacles = [createConvexObstacle(1, makeRotatedRectVerts(100, 0, 28, 130, 0), 80, 'BUNKER')];
    const pp = simPyro.getSnapshot().player;
    pp.x = 0;
    pp.y = 0;
    const pyro = simPyro.combat.spawnEnemy('PYRO_SPRAYER', 200, 0, 1);
    pyro.aiState = 'FIRE';
    pyro.aiTimer = 1.0;
    pyro.beamAngle = 0;
    pyro.angle = Math.PI;
    const hpBefore = pp.hp;
    for (let i = 0; i < 4; i++) simPyro.step(makeInput());
    expect(pp.hp).toBe(hpBefore);
  });

  it('scales enemy stats, wave size, elites, and wave difficulty continuously across higher waves', () => {
    const s1 = getWaveScaling(1);
    const s5 = getWaveScaling(5);
    const s10 = getWaveScaling(10);
    const s15 = getWaveScaling(15);
    expect(s1.hpScale).toBe(1);
    expect(s5.hpScale).toBeGreaterThan(s1.hpScale * 2);
    expect(s10.hpScale).toBeGreaterThan(s5.hpScale * 2);
    expect(s15.hpScale).toBeGreaterThan(s10.hpScale * 1.8);
    expect(s15.dmgScale).toBeGreaterThan(s10.dmgScale);
    expect(s15.speedScale).toBeGreaterThan(s10.speedScale);

    const sim = new GameSim();
    const b1 = sim.combat.spawnEnemy('BASTION', 0, 0, 1);
    const b10 = sim.combat.spawnEnemy('BASTION', 0, 0, 10);
    const b10Elite = sim.combat.spawnEnemy('BASTION', 0, 0, 10, true);
    expect(b10.maxHp).toBeGreaterThan(b1.maxHp * 4);
    expect(b10Elite.maxHp).toBeGreaterThan(b10.maxHp * 1.5);
    expect(b10Elite.radius).toBeGreaterThan(b10.radius);
    expect(b10Elite.baseArmor).toBeGreaterThan(b10.baseArmor);

    // Sector squads continue growing past Wave 14
    sim.waveDirector.startWave(8, []);
    const w8Count = sim.waveDirector.rifts.reduce((sum, r) => sum + r.archetypes.length, 0);
    sim.waveDirector.startWave(16, []);
    const w16Count = sim.waveDirector.rifts.reduce((sum, r) => sum + r.archetypes.length, 0);
    expect(w16Count).toBeGreaterThan(w8Count);
    expect(sim.waveDirector.rifts.some((r) => (r.eliteIndices?.length ?? 0) > 0)).toBe(true);
  });

  it('executes distinct behaviors for all 7 new enemy archetypes', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.pillars = [];
    sim.waveDirector.blocks = [];
    sim.waveDirector.obstacles = [];
    const p = sim.getSnapshot().player;
    p.x = 0;
    p.y = 0;

    // 1. LANCER lunges on CHARGE -> FIRE
    const lancer = sim.combat.spawnEnemy('LANCER', 260, 0, 1);
    lancer.aiState = 'CHARGE';
    lancer.aiTimer = 0.01;
    lancer.beamAngle = Math.PI;
    sim.step(makeInput());
    expect(lancer.aiState).toBe('FIRE');
    expect(Math.hypot(lancer.vx, lancer.vy)).toBeGreaterThan(400);

    // 2. VOLT_SPRINTER fires VOLT_ORB
    sim.combat.enemies = [];
    sim.combat.projectiles = [];
    const sprinter = sim.combat.spawnEnemy('VOLT_SPRINTER', 220, 0, 1);
    sprinter.aiState = 'CHARGE';
    sprinter.aiTimer = 0.01;
    sim.step(makeInput());
    expect(sim.getSnapshot().projectiles.some((pr) => pr.kind === 'VOLT_ORB')).toBe(true);

    // 3. CRYO_SNIPER fires fast CRYO_LANCE
    sim.combat.enemies = [];
    sim.combat.projectiles = [];
    const sniper = sim.combat.spawnEnemy('CRYO_SNIPER', 400, 0, 1);
    sniper.aiState = 'CHARGE';
    sniper.aiTimer = 0.01;
    sniper.beamAngle = Math.PI;
    sim.step(makeInput());
    expect(sim.getSnapshot().projectiles.some((pr) => pr.kind === 'CRYO_LANCE')).toBe(true);

    // 4. MENDER heals injured ally up to maxHp (never above)
    sim.combat.enemies = [];
    const mender = sim.combat.spawnEnemy('MENDER', 240, 0, 1);
    const ally = sim.combat.spawnEnemy('BASTION', 290, 0, 1);
    ally.hp = ally.maxHp - 5;
    mender.aiTimer = 0.01;
    sim.step(makeInput());
    expect(ally.hp).toBe(ally.maxHp);

    // 5. VORTEX_DRONE fires radial PLASMA_ORB ring
    sim.combat.enemies = [];
    sim.combat.projectiles = [];
    const vortex = sim.combat.spawnEnemy('VORTEX_DRONE', 230, 0, 1);
    vortex.aiTimer = 0.01;
    sim.step(makeInput());
    expect(sim.getSnapshot().projectiles.filter((pr) => pr.kind === 'PLASMA_ORB').length).toBe(6);

    // 6. MINELAYER spawns plasma hazards
    sim.combat.enemies = [];
    sim.combat.hazards = [];
    const minelayer = sim.combat.spawnEnemy('MINELAYER', 320, 0, 1);
    minelayer.aiTimer = 0.01;
    sim.step(makeInput());
    expect(sim.getSnapshot().hazards.length).toBeGreaterThanOrEqual(2);

    // 7. OBELISK rotating shield plate blocks non-Kinetic hits and fires 4-way PLASMA_ORB burst
    sim.combat.enemies = [];
    sim.combat.projectiles = [];
    const obelisk = sim.combat.spawnEnemy('OBELISK', 280, 0, 1);
    obelisk.bossShieldAngles = [Math.PI]; // facing West (-X) toward player at (0,0)
    sim.combat.applyElementalHit(obelisk, 40, ['CRYO'], 1, 0, []);
    expect(obelisk.hp).toBe(obelisk.maxHp);
    obelisk.aiTimer = 0.01;
    sim.step(makeInput());
    expect(sim.getSnapshot().projectiles.filter((pr) => pr.kind === 'PLASMA_ORB').length).toBe(4);
  });
});

describe('CombatEngine — No Hazards Under The Player', () => {
  it('MINELAYER lays its mines in its own wake, never on the player', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    const px = sim.getSnapshot().player.x;
    const py = sim.getSnapshot().player.y;
    const miner = sim.combat.spawnEnemy('MINELAYER', px + 240, py, 1);
    miner.aiTimer = 0;

    sim.step(makeInput());
    const hazards = sim.getSnapshot().hazards;
    expect(hazards.length).toBeGreaterThan(0);
    for (const h of hazards) {
      expect(Math.hypot(h.x - px, h.y - py)).toBeGreaterThan(90);
    }
  });

  it('WARDEN never drops hazards on the player across all phases', () => {
    for (const phase of [1, 2, 3]) {
      const sim = new GameSim();
      sim.combat.enemies = [];
      sim.waveDirector.rifts = [];
      const px = sim.getSnapshot().player.x;
      const py = sim.getSnapshot().player.y;
      const boss = sim.combat.spawnEnemy('WARDEN', px + 360, py, 5);
      boss.hp = boss.maxHp * (phase === 3 ? 0.2 : phase === 2 ? 0.5 : 0.9);
      boss.bossPhase = phase;
      boss.aiTimer = 0;

      for (let i = 0; i < 240; i++) {
        sim.step(makeInput());
        for (const h of sim.getSnapshot().hazards) {
          expect(Math.hypot(h.x - px, h.y - py)).toBeGreaterThan(60);
        }
      }
    }
  });
});

describe('CombatEngine — Rock Weight', () => {
  it('throws fewer, smaller rocks on a ring (Nova) KINETIC cast', () => {
    const sim = new GameSim();
    queueAndStep(sim, ['KINETIC']);
    sim.step(makeInput({ castAction: 'NOVA' }));
    const rocks = sim.getSnapshot().projectiles.filter((p) => p.kind === 'ROCK');
    expect(rocks.length).toBe(2);
    expect(rocks[0]!.radius).toBe(18);
  });

  it('keeps the charged single rock compact', () => {
    const sim = new GameSim();
    queueAndStep(sim, ['KINETIC']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true }));
    for (let i = 0; i < 6; i++) sim.step(makeInput({ castHeld: true }));
    sim.step(makeInput({ castHeld: false }));
    const rock = sim.getSnapshot().projectiles.find((p) => p.kind === 'ROCK');
    expect(rock).toBeDefined();
    expect(rock!.radius).toBeLessThanOrEqual(20);
  });
});

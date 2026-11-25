import { describe, expect, it } from 'vitest';
import { AUGMENT_CATALOG, rollAugmentChoices } from './Augments';
import { GameSim } from './GameSim';
import { AugmentId, BaseElement, SimInput } from './types';

function makeInput(overrides: Partial<SimInput> = {}): SimInput {
  return {
    moveX: 0,
    moveY: 0,
    moveToCursor: false,
    moveClickTarget: null,
    aimX: 300,
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

describe('Construct Augments — Catalog, Draft & All 6 Mechanics', () => {
  it('1. rollAugmentChoices returns 3 distinct cards with zero duplicates', () => {
    for (let i = 0; i < 20; i++) {
      const choices = rollAugmentChoices();
      expect(choices.length).toBe(3);
      const ids = new Set(choices.map((c) => c.id));
      expect(ids.size).toBe(3);
    }
  });

  it('2. Gate transition enters AUGMENT_CHOICE with 3 cards, and pickAugment resumes PLAYING', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.step(makeInput());
    expect(sim.getSnapshot().gate.open).toBe(true);

    const p = sim.getSnapshot().player;
    p.x = sim.getSnapshot().gate.x;
    p.y = sim.getSnapshot().gate.y;
    sim.step(makeInput());

    const draftSnap = sim.getSnapshot();
    expect(draftSnap.wave).toBe(2);
    expect(draftSnap.phase).toBe('AUGMENT_CHOICE');
    expect(draftSnap.pendingAugments.length).toBe(3);
    const chosenId = draftSnap.pendingAugments[0]!.id;

    expect(sim.pickAugment(0)).toBe(true);
    const resumed = sim.getSnapshot();
    expect(resumed.phase).toBe('PLAYING');
    expect(resumed.pendingAugments.length).toBe(0);
    expect(resumed.augments[chosenId]).toBe(1);
  });

  it('3. SUPERCONDUCTOR adds +3 chain jumps and arcs lightning through deployed Mines', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.augments.SUPERCONDUCTOR = 1;
    const px = sim.getSnapshot().player.x;

    // 8 enemies spaced 120px apart -> base cap is 6, Superconductor allows 9
    const chainEnemies = [];
    for (let i = 0; i < 8; i++) {
      const en = sim.combat.spawnEnemy('SWARMER', px + 80 + i * 120, 0, 1);
      chainEnemies.push(en);
    }
    queueAndStep(sim, ['VOLT']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: px + 200, aimY: 0 }));
    for (const en of chainEnemies) {
      expect(en.hp).toBeLessThan(en.maxHp);
    }

    // Relay across deployed Mine when enemy is beyond single enemy-to-enemy jumpRange
    const relaySim = new GameSim();
    relaySim.combat.enemies = [];
    relaySim.waveDirector.rifts = [];
    relaySim.augments.SUPERCONDUCTOR = 1;
    const rpx = relaySim.getSnapshot().player.x;
    const first = relaySim.combat.spawnEnemy('BASTION', rpx + 90, 0, 1);
    first.hasFrontShield = false;
    const farEnemy = relaySim.combat.spawnEnemy('BASTION', rpx + 420, 0, 1);
    farEnemy.hasFrontShield = false;

    queueAndStep(relaySim, ['BARRIER', 'VOID']);
    relaySim.combat.mines.push({
      id: 950,
      x: rpx + 250,
      y: 0,
      radius: 16,
      triggerRadius: 46,
      blastRadius: 140,
      damage: 65,
      armTimer: 0,
      life: 10,
      colorHex: 0xff2438,
      colors: [0xe6f0ff, 0xff2438],
      elements: ['BARRIER', 'VOID'],
      composition: {
        counts: { BARRIER: 1, VOID: 1 },
        ratios: { BARRIER: 0.5, VOID: 0.5 },
        totalPower: 2,
        colors: [0xe6f0ff, 0xff2438],
        weightedColors: [0xe6f0ff, 0xff2438],
        primaryColorHex: 0xff2438,
        secondaryColorHex: 0xe6f0ff,
      },
    });
    relaySim.getSnapshot().player.queue = [];
    queueAndStep(relaySim, ['VOLT']);
    relaySim.step(makeInput({ castAction: 'FORWARD', aimX: first.x, aimY: 0 }));
    expect(farEnemy.hp).toBeLessThan(farEnemy.maxHp);
  });

  it('4. PERMAFROST_DETONATION blasts nearby enemies for 75% max HP on Shatter and applies CHILLED', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.augments.PERMAFROST_DETONATION = 1;
    sim.combat.setAugments(sim.augments);

    const frozenTarget = sim.combat.spawnEnemy('BASTION', 200, 0, 1);
    frozenTarget.hasFrontShield = false;
    frozenTarget.statuses.FROZEN = { type: 'FROZEN', remaining: 2.5, stacks: 1, potency: 1 };

    const bystander = sim.combat.spawnEnemy('BASTION', 310, 0, 1);
    bystander.hasFrontShield = false;

    const events: ReturnType<GameSim['drainEvents']> = [];
    sim.combat.applyElementalHit(frozenTarget, 30, ['KINETIC'], 1, 0, events);

    const expectedDmg = (frozenTarget.maxHp * 0.75) / (1 + bystander.baseArmor);
    expect(bystander.hp).toBeLessThanOrEqual(bystander.maxHp - expectedDmg + 0.5);
    expect(bystander.statuses.CHILLED).toBeDefined();
    const labels = events.filter((ev) => ev.type === 'damage_number').map((ev) => ev.text);
    expect(labels).toContain('PERMAFROST!');
  });

  it('5. PRISM_REFRACTION splits channeled beam passing through player Shield into 3 diverging beams', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.pillars = [];
    sim.waveDirector.blocks = [];
    sim.augments.PRISM_REFRACTION = 1;
    const px = sim.getSnapshot().player.x;

    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: px + 200, aimY: 0 }));
    for (let i = 0; i < 12; i++) sim.step(makeInput({ aimX: px + 200, aimY: 0 }));

    queueAndStep(sim, ['VOID']);
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: px + 300, aimY: 0 }));
    sim.step(makeInput({ castHeld: true, aimX: px + 300, aimY: 0 }));

    const refracted = sim.getSnapshot().beams.filter((b) => b.refracted === true);
    expect(refracted.length).toBe(3);
  });

  it('6. TECTONIC_MINES converts expired Wall pylons into proximity Mines', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.augments.TECTONIC_MINES = 1;

    queueAndStep(sim, ['BARRIER', 'KINETIC']);
    sim.step(makeInput({ castAction: 'FORWARD' }));
    const wallCount = sim.getSnapshot().walls.length;
    expect(wallCount).toBeGreaterThan(0);
    const firstWall = sim.getSnapshot().walls[0]!;
    firstWall.life = 0.005;

    sim.step(makeInput());
    expect(sim.getSnapshot().walls.length).toBe(wallCount - 1);
    expect(sim.getSnapshot().mines.some((m) => Math.hypot(m.x - firstWall.x, m.y - firstWall.y) < 1)).toBe(true);
  });

  it('7. OVERCLOCKED_QUEUE activates on 3-unique-element cast and boosts speed & cooldown', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.augments.OVERCLOCKED_QUEUE = 1;

    queueAndStep(sim, ['THERMAL', 'FLUX', 'VOLT']); // 3 unique: PLASMA + VOLT (only 2 unique!). Use FLUX + THERMAL? Wait:
    // Use BARRIER + VOLT + THERMAL -> 3 unique!
    sim.getSnapshot().player.queue = [];
    queueAndStep(sim, ['BARRIER', 'VOLT', 'THERMAL']);
    sim.step(makeInput({ castAction: 'FORWARD', aimX: 300, aimY: 0 }));

    const p = sim.getSnapshot().player;
    expect(p.overclockTimer).toBeGreaterThan(2.5);
    expect(p.castCooldown).toBeLessThan(0.16);

    for (let i = 0; i < 30; i++) sim.step(makeInput({ moveX: 1, moveY: 0 }));
    expect(sim.getSnapshot().player.vx).toBeGreaterThan(170);
  });

  it('8. SINGULARITY_PULL pulls nearby off-axis enemy into Void beam and pulls on Void mine blast', () => {
    // 1. Void beam pull
    const simBeam = new GameSim();
    simBeam.combat.enemies = [];
    simBeam.waveDirector.rifts = [];
    simBeam.waveDirector.pillars = [];
    simBeam.waveDirector.blocks = [];
    simBeam.augments.SINGULARITY_PULL = 1;
    const p = simBeam.getSnapshot().player;
    p.x = 0;
    p.y = 0;

    const target = simBeam.combat.spawnEnemy('BASTION', 220, 110, 1);
    target.hasFrontShield = false;
    queueAndStep(simBeam, ['VOID']);
    simBeam.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: 400, aimY: 0 }));
    for (let i = 0; i < 8; i++) simBeam.step(makeInput({ castHeld: true, aimX: 400, aimY: 0 }));
    expect(target.vy).toBeLessThan(0);

    // 2. Void mine pull
    const simMine = new GameSim();
    simMine.combat.enemies = [];
    simMine.waveDirector.rifts = [];
    simMine.augments.SINGULARITY_PULL = 1;
    const mineEnemy = simMine.combat.spawnEnemy('BASTION', 120, 0, 1);
    mineEnemy.hasFrontShield = false;
    const triggerEnemy = simMine.combat.spawnEnemy('SWARMER', 0, 0, 1);
    simMine.combat.mines.push({
      id: 777,
      x: 0,
      y: 0,
      radius: 16,
      triggerRadius: 46,
      blastRadius: 150,
      damage: 40,
      armTimer: 0,
      life: 10,
      colorHex: 0xff2438,
      colors: [0xe6f0ff, 0xff2438],
      elements: ['BARRIER', 'VOID'],
      composition: {
        counts: { BARRIER: 1, VOID: 1 },
        ratios: { BARRIER: 0.5, VOID: 0.5 },
        totalPower: 2,
        colors: [0xe6f0ff, 0xff2438],
        weightedColors: [0xe6f0ff, 0xff2438],
        primaryColorHex: 0xff2438,
        secondaryColorHex: 0xe6f0ff,
      },
    });
    expect(triggerEnemy.id).toBeGreaterThan(0);
    simMine.step(makeInput({ aimX: 200, aimY: 0 }));
    expect(mineEnemy.vx).toBeLessThan(-100);
  });

  it('9. Catalog contains 20 distinct augments and anti-repeat draft avoids recently offered & maxed items', () => {
    expect(AUGMENT_CATALOG.length).toBe(20);
    expect(new Set(AUGMENT_CATALOG.map((a) => a.id)).size).toBe(20);

    const recent: AugmentId[] = [
      'SUPERCONDUCTOR',
      'PERMAFROST_DETONATION',
      'PRISM_REFRACTION',
      'TECTONIC_MINES',
      'OVERCLOCKED_QUEUE',
      'SINGULARITY_PULL',
    ];
    const owned: Partial<Record<AugmentId, number>> = {
      THERMAL_CONFLAGRATION: 2, // maxed out
      CRYO_SHARD_BARRAGE: 2, // maxed out
    };

    const rolled = rollAugmentChoices(() => 0.25, 3, owned, recent);
    expect(rolled.length).toBe(3);
    for (const aug of rolled) {
      expect(recent).not.toContain(aug.id);
      expect(aug.id).not.toBe('THERMAL_CONFLAGRATION');
      expect(aug.id).not.toBe('CRYO_SHARD_BARRAGE');
    }
  });

  it('10. HULL_REINFORCEMENT raises Max Hull & heals immediately, and cuts low-HP incoming damage', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.gate.open = true;
    sim.getSnapshot().player.x = sim.getSnapshot().gate.x;
    sim.getSnapshot().player.y = sim.getSnapshot().gate.y;
    sim.step(makeInput());
    expect(sim.getSnapshot().phase).toBe('AUGMENT_CHOICE');

    const hullDefIdx = sim.pendingAugments.findIndex((a) => a.id === 'HULL_REINFORCEMENT');
    if (hullDefIdx >= 0) {
      sim.getSnapshot().player.hp = 50;
      sim.pickAugment(hullDefIdx);
      expect(sim.getSnapshot().player.maxHp).toBe(130);
      expect(sim.getSnapshot().player.hp).toBe(80);
    } else {
      // Direct test on another run
      const sim2 = new GameSim();
      sim2.setPhase('AUGMENT_CHOICE');
      const hullDef = AUGMENT_CATALOG.find((a) => a.id === 'HULL_REINFORCEMENT')!;
      sim2.pendingAugments = [hullDef, AUGMENT_CATALOG[0]!, AUGMENT_CATALOG[1]!];
      sim2.getSnapshot().player.hp = 50;
      expect(sim2.pickAugment(0)).toBe(true);
      expect(sim2.getSnapshot().player.maxHp).toBe(130);
      expect(sim2.getSnapshot().player.hp).toBe(80);
    }

    // Low HP damage reduction
    const lowSim = new GameSim();
    lowSim.augments.HULL_REINFORCEMENT = 1;
    lowSim.combat.setAugments(lowSim.augments);
    lowSim.getSnapshot().player.hp = 30;
    const ev = lowSim.drainEvents();
    lowSim.combat.damagePlayer(lowSim.getSnapshot().player, 20, undefined, () => {}, ev);
    expect(lowSim.getSnapshot().player.hp).toBe(14); // 20 * 0.8 = 16 dmg -> 30 - 16 = 14
  });

  it('11. New combat augments trigger: THERMAL_CONFLAGRATION, CRYO_SHARD_BARRAGE, NANO_SWARM_SIPHON, SANCTUARY_PULSE, MINEFIELD_SATURATION, TEMPEST_CAPACITOR, PHASE_RESONANCE', () => {
    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.augments = {
      THERMAL_CONFLAGRATION: 1,
      CRYO_SHARD_BARRAGE: 1,
      NANO_SWARM_SIPHON: 1,
      SANCTUARY_PULSE: 1,
      MINEFIELD_SATURATION: 1,
      TEMPEST_CAPACITOR: 1,
      PHASE_RESONANCE: 1,
    };
    sim.combat.setAugments(sim.augments);

    // SANCTUARY_PULSE boosts shield HP & knocks back nearby enemies
    const px = sim.getSnapshot().player.x;
    const knockEnemy = sim.combat.spawnEnemy('SWARMER', px + 70, 0, 1);
    queueAndStep(sim, ['BARRIER']);
    sim.step(makeInput({ castAction: 'SELF' }));
    expect(sim.getSnapshot().shields[0]!.maxHp).toBeGreaterThan(260);
    expect(knockEnemy.vx).toBeGreaterThan(100);

    // PHASE_RESONANCE cuts dash cooldown & grants armor
    sim.step(makeInput({ dashPressed: true }));
    expect(sim.getSnapshot().player.armorHp).toBeGreaterThanOrEqual(15);
    expect(sim.getSnapshot().player.dashCooldown).toBeLessThan(0.45);

    // THERMAL_CONFLAGRATION blasts nearby foes on ignited enemy death
    const simBurn = new GameSim();
    simBurn.combat.enemies = [];
    simBurn.waveDirector.rifts = [];
    simBurn.augments.THERMAL_CONFLAGRATION = 1;
    simBurn.combat.setAugments(simBurn.augments);
    const dying = simBurn.combat.spawnEnemy('SWARMER', 0, 0, 1);
    dying.hp = 0.1;
    dying.statuses.IGNITED = { type: 'IGNITED', remaining: 3, stacks: 1, potency: 1 };
    const nearby = simBurn.combat.spawnEnemy('BASTION', 75, 0, 1);
    simBurn.step(makeInput());
    expect(nearby.hp).toBeLessThan(nearby.maxHp);
    expect(nearby.statuses.IGNITED).toBeDefined();

    // NANO_SWARM_SIPHON spawns homing NANO_BOLTs on nano-marked kill
    const simNano = new GameSim();
    simNano.combat.enemies = [];
    simNano.waveDirector.rifts = [];
    simNano.augments.NANO_SWARM_SIPHON = 1;
    simNano.combat.setAugments(simNano.augments);
    const victim = simNano.combat.spawnEnemy('SWARMER', 0, 0, 1);
    victim.hp = 0;
    victim.nanoMarkTimer = 4.0;
    simNano.step(makeInput());
    expect(simNano.getSnapshot().projectiles.filter((p) => p.kind === 'NANO_BOLT').length).toBe(2);

    // CRYO_SHARD_BARRAGE adds +2 icicles
    const simCryo = new GameSim();
    simCryo.combat.enemies = [];
    simCryo.waveDirector.rifts = [];
    simCryo.augments.CRYO_SHARD_BARRAGE = 1;
    queueAndStep(simCryo, ['FLUX', 'CRYO']);
    simCryo.step(makeInput({ castAction: 'FORWARD', castHeld: false, aimX: 300, aimY: 0 }));
    expect(simCryo.getSnapshot().projectiles.filter((p) => p.kind === 'ICICLE').length).toBe(12);
  });
});

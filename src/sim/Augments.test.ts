import { describe, expect, it } from 'vitest';
import { rollAugmentChoices } from './Augments';
import { GameSim } from './GameSim';
import { BaseElement, SimInput } from './types';

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
});

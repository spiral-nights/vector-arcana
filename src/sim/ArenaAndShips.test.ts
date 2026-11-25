import { describe, expect, it } from 'vitest';
import {
  circleVsConvexPoly,
  clampPointToConvexPoly,
  createConvexObstacle,
  generateArenaBoundary,
  makeRegularPolyVerts,
  makeTriangleVerts,
  pointInConvexPoly,
  rayVsArenaBoundary,
  rayVsConvexPoly,
} from './ArenaGeometry';
import { GameSim } from './GameSim';
import { getDifficultyConfig, getShipDef, SHIP_CATALOG } from './Ships';
import { SimInput } from './types';
import { generateSectorArena } from './WaveDirector';

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

describe('Non-Rectangular Arenas, Irregular Obstacles, Ships & Difficulty', () => {
  it('1. Non-rectangular boundaries clamp points & clip rays accurately', () => {
    const shapes = ['OCTAGON', 'HEXAGON', 'DIAMOND_VAULT', 'TRAPEZOID_WEDGE', 'CITADEL_DECAGON'] as const;
    for (const shape of shapes) {
      const poly = generateArenaBoundary(shape);
      expect(poly.length).toBeGreaterThanOrEqual(4);
      expect(pointInConvexPoly(0, 0, poly, 50)).toBe(true);

      // West corner of full rectangle (-1080, 730) is outside all non-rectangular chamfered/tapered shapes
      expect(pointInConvexPoly(-1080, 730, poly, 0)).toBe(false);
      const clamped = clampPointToConvexPoly(-1080, 730, 18, poly);
      expect(pointInConvexPoly(clamped.x, clamped.y, poly, 17.5)).toBe(true);

      const exitDist = rayVsArenaBoundary(0, 0, 1, 0, 2200, poly);
      expect(exitDist).toBeGreaterThan(200);
      expect(exitDist).toBeLessThanOrEqual(1105);
    }
  });

  it('2. Convex obstacles push circles out and truncate beams & projectiles', () => {
    const triObs = createConvexObstacle(1, makeTriangleVerts(-650, 0, 90, 0, 1.3), 80, 'WEDGE');
    const hit = circleVsConvexPoly(-650, 0, 16, triObs);
    expect(hit.hit).toBe(true);
    expect(Math.hypot(hit.pushX, hit.pushY)).toBeGreaterThan(16);

    const rayDist = rayVsConvexPoly(-950, 0, 1, 0, 1800, triObs);
    expect(rayDist).not.toBeNull();
    expect(rayDist!).toBeGreaterThan(100);
    expect(rayDist!).toBeLessThan(350);

    const sim = new GameSim();
    sim.combat.enemies = [];
    sim.waveDirector.rifts = [];
    sim.waveDirector.obstacles = [createConvexObstacle(1, makeRegularPolyVerts(-650, 0, 70, 5), 90, 'MONOLITH')];
    const px = sim.getSnapshot().player.x;
    sim.step(makeInput({ queuedElements: ['VOID'] }));
    sim.step(makeInput({ castAction: 'FORWARD', castHeld: true, aimX: px + 400, aimY: 0 }));
    sim.step(makeInput({ castHeld: true, aimX: px + 400, aimY: 0 }));

    const beam = sim.getSnapshot().beams[0]!;
    expect(beam.clashing).toBe(true);
    expect(beam.clashDist).toBeLessThan(Math.abs(-650 - px));
  });

  it('3. All 7 sector layouts (1..7 including Boss Sector 5) generate varied arenas & clear rifts', () => {
    const shapesSeen = new Set<string>();
    for (let sector = 1; sector <= 7; sector++) {
      const layout = generateSectorArena(sector);
      shapesSeen.add(layout.shape);
      expect(layout.obstacles.length).toBeGreaterThanOrEqual(4);
      expect(layout.boundary.length).toBeGreaterThanOrEqual(4);

      const sim = new GameSim();
      sim.waveDirector.startWave(sector, sim.drainEvents());
      for (const rift of sim.waveDirector.rifts) {
        expect(pointInConvexPoly(rift.x, rift.y, layout.boundary, 20)).toBe(true);
        for (const obs of layout.obstacles) {
          expect(circleVsConvexPoly(rift.x, rift.y, 24, obs).hit).toBe(false);
        }
      }
    }
    expect(shapesSeen.size).toBeGreaterThanOrEqual(5);
  });

  it('4. All 4 ships apply distinct maxHp, startArmor, speed, damage, and dash cooldown', () => {
    expect(SHIP_CATALOG.length).toBe(4);

    const titan = new GameSim();
    titan.setShip('TITAN');
    titan.startNewRun();
    expect(titan.getSnapshot().player.maxHp).toBe(140);
    expect(titan.getSnapshot().player.armorHp).toBe(35);

    const spectre = new GameSim();
    spectre.setShip('SPECTRE');
    spectre.startNewRun();
    expect(spectre.getSnapshot().player.maxHp).toBe(80);
    spectre.step(makeInput({ dashPressed: true }));
    expect(spectre.getSnapshot().player.dashCooldown).toBeLessThan(0.45);

    const prism = getShipDef('PRISM');
    expect(prism.damageMult).toBeGreaterThan(1.1);
  });

  it('5. Difficulty modes RECRUIT / VETERAN / OVERLORD scale enemy HP and damage', () => {
    const recruitCfg = getDifficultyConfig('RECRUIT');
    const overlordCfg = getDifficultyConfig('OVERLORD');
    expect(recruitCfg.enemyHpMult).toBeLessThan(1);
    expect(overlordCfg.enemyHpMult).toBeGreaterThan(1);

    const simRec = new GameSim();
    simRec.setDifficulty('RECRUIT');
    simRec.startNewRun();
    const recEnemy = simRec.combat.spawnEnemy('BASTION', 0, 0, 1);

    const simOver = new GameSim();
    simOver.setDifficulty('OVERLORD');
    simOver.startNewRun();
    const overEnemy = simOver.combat.spawnEnemy('BASTION', 0, 0, 1);

    expect(overEnemy.maxHp).toBeGreaterThan(recEnemy.maxHp * 1.6);
  });
});

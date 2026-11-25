import {
  createConvexObstacle,
  generateArenaBoundary,
  getArenaHorizontalSpanAtY0,
  makeRegularPolyVerts,
  makeRotatedRectVerts,
  makeTrapezoidVerts,
  makeTriangleVerts,
  pushPointClearOfObstacles,
} from './ArenaGeometry';
import {
  ArenaBlock,
  ArenaObstacle,
  ArenaPillar,
  ArenaShapeKind,
  EnemyArchetype,
  PlayerState,
  SectorGate,
  SimEvent,
  SpawnRiftEntity,
  Vec2,
} from './types';

export interface SectorArenaLayout {
  shape: ArenaShapeKind;
  boundary: Vec2[];
  pillars: ArenaPillar[];
  blocks: ArenaBlock[];
  obstacles: ArenaObstacle[];
}

export function generateSectorArena(sector: number): SectorArenaLayout {
  const isBoss = sector % 5 === 0;
  let shape: ArenaShapeKind = 'OCTAGON';
  const pillarDefs: Array<[number, number, number, number]> = [];
  const blockDefs: Array<[number, number, number, number, number]> = [];
  const obstacles: ArenaObstacle[] = [];
  let obsId = 1;

  if (isBoss) {
    // Boss Sector: 12-sided Void Colosseum with 4 massive outer angled bastions + 4 pillars
    shape = 'CITADEL_DECAGON';
    pillarDefs.push([-275, 0, 42, 8], [275, 0, 42, 8], [0, 345, 40, 8], [0, -345, 40, 8]);
    obstacles.push(
      createConvexObstacle(obsId++, makeTrapezoidVerts(-470, 310, 145, 90, 44, -0.45), 88, 'WEDGE'),
      createConvexObstacle(obsId++, makeTrapezoidVerts(470, 310, 145, 90, 44, 0.45), 88, 'WEDGE'),
      createConvexObstacle(obsId++, makeTrapezoidVerts(-470, -310, 145, 90, 44, 0.45 + Math.PI), 88, 'WEDGE'),
      createConvexObstacle(obsId++, makeTrapezoidVerts(470, -310, 145, 90, 44, -0.45 + Math.PI), 88, 'WEDGE')
    );
  } else {
    const nonBossIdx = (sector - 1 - Math.floor((sector - 1) / 5)) % 6;
    if (nonBossIdx === 0) {
      // Cyber Octagon: completely clear center corridor (|y| <= 130) + L-shaped wing bunkers & triangular wedges
      shape = 'OCTAGON';
      pillarDefs.push([-140, 235, 36, 6], [140, -235, 36, 6]);
      obstacles.push(
        // NW compound L-bunker
        createConvexObstacle(obsId++, makeRotatedRectVerts(-300, 325, 175, 38, 0), 72, 'BUNKER'),
        createConvexObstacle(obsId++, makeRotatedRectVerts(-440, 240, 38, 92, 0), 68, 'BUNKER'),
        // SE compound L-bunker
        createConvexObstacle(obsId++, makeRotatedRectVerts(300, -325, 175, 38, 0), 72, 'BUNKER'),
        createConvexObstacle(obsId++, makeRotatedRectVerts(440, -240, 38, 92, 0), 68, 'BUNKER'),
        // Diagonal tactical triangular deflectors
        createConvexObstacle(obsId++, makeTriangleVerts(350, 275, 92, 0.65, 1.35), 76, 'WEDGE'),
        createConvexObstacle(obsId++, makeTriangleVerts(-350, -275, 92, -2.49, 1.35), 76, 'WEDGE')
      );
    } else if (nonBossIdx === 1) {
      // Reactor Core: tapered Hexagon arena with MASSIVE central octagonal reactor + 4 slanted trapezoid baffles
      shape = 'HEXAGON';
      pillarDefs.push([-620, 180, 36, 6], [620, -180, 36, 6]);
      obstacles.push(
        createConvexObstacle(obsId++, makeRegularPolyVerts(0, 0, 168, 8, Math.PI / 8, 1.08, 0.95), 108, 'REACTOR'),
        createConvexObstacle(obsId++, makeTrapezoidVerts(-360, 290, 150, 95, 42, -0.35), 74, 'WEDGE'),
        createConvexObstacle(obsId++, makeTrapezoidVerts(360, 290, 150, 95, 42, 0.35), 74, 'WEDGE'),
        createConvexObstacle(obsId++, makeTrapezoidVerts(-360, -290, 150, 95, 42, 0.35 + Math.PI), 74, 'WEDGE'),
        createConvexObstacle(obsId++, makeTrapezoidVerts(360, -290, 150, 95, 42, -0.35 + Math.PI), 74, 'WEDGE')
      );
    } else if (nonBossIdx === 2) {
      // Shard Canyon: faceted Diamond Vault with asymmetric slanted chevrons & giant jagged crystal monoliths
      shape = 'DIAMOND_VAULT';
      pillarDefs.push([-540, 0, 36, 6], [540, 0, 36, 6]);
      obstacles.push(
        createConvexObstacle(obsId++, makeRotatedRectVerts(-260, 220, 44, 175, 0.48), 80, 'MONOLITH'),
        createConvexObstacle(obsId++, makeRotatedRectVerts(240, -220, 44, 175, 0.48), 80, 'MONOLITH'),
        createConvexObstacle(obsId++, makeRegularPolyVerts(0, 18, 96, 5, 0.3, 1.3, 0.85), 94, 'MONOLITH'),
        createConvexObstacle(obsId++, makeTriangleVerts(-320, -250, 102, 0.5, 1.4), 72, 'WEDGE'),
        createConvexObstacle(obsId++, makeTriangleVerts(320, 250, 102, -2.64, 1.4), 72, 'WEDGE')
      );
    } else if (nonBossIdx === 3) {
      // Wedge Foundry: Trapezoid Deck (narrow West -> wide East) with huge central T-fortress & wing fins
      shape = 'TRAPEZOID_WEDGE';
      pillarDefs.push([-520, 0, 38, 8], [580, 340, 38, 6], [580, -340, 38, 6]);
      obstacles.push(
        // T-shaped central citadel
        createConvexObstacle(obsId++, makeRotatedRectVerts(40, 0, 48, 225, 0), 88, 'BUNKER'),
        createConvexObstacle(obsId++, makeRotatedRectVerts(-85, 0, 95, 52, 0), 82, 'BUNKER'),
        // Slanted East wing deflectors
        createConvexObstacle(obsId++, makeTrapezoidVerts(420, 330, 165, 95, 42, -0.3), 76, 'WEDGE'),
        createConvexObstacle(obsId++, makeTrapezoidVerts(420, -330, 165, 95, 42, 0.3 + Math.PI), 76, 'WEDGE')
      );
    } else if (nonBossIdx === 4) {
      // Twin Bastions: Full Rect with two massive irregular chamfered monolith hubs & figure-8 wedges
      shape = 'RECTANGLE';
      pillarDefs.push([0, 360, 40, 6], [0, -360, 40, 6]);
      obstacles.push(
        createConvexObstacle(obsId++, makeRegularPolyVerts(-340, 195, 145, 6, 0.25, 1.35, 0.9), 92, 'MONOLITH'),
        createConvexObstacle(obsId++, makeRegularPolyVerts(340, -195, 145, 6, 0.25, 1.35, 0.9), 92, 'MONOLITH'),
        createConvexObstacle(obsId++, makeTriangleVerts(360, 265, 108, -2.3, 1.35), 76, 'WEDGE'),
        createConvexObstacle(obsId++, makeTriangleVerts(-360, -265, 108, 0.84, 1.35), 76, 'WEDGE')
      );
    } else {
      // Shattered Spire: Octagon split by massive diagonal spine monolith + giant side triangles
      shape = 'OCTAGON';
      pillarDefs.push([-560, -210, 38, 8], [560, 210, 38, 8]);
      obstacles.push(
        createConvexObstacle(obsId++, makeRotatedRectVerts(0, 0, 210, 54, 0.48), 98, 'REACTOR'),
        createConvexObstacle(obsId++, makeTriangleVerts(-360, 270, 118, -0.45, 1.45), 80, 'WEDGE'),
        createConvexObstacle(obsId++, makeTriangleVerts(360, -270, 118, 2.69, 1.45), 80, 'WEDGE'),
        createConvexObstacle(obsId++, makeRegularPolyVerts(290, 320, 74, 5, 0.6), 72, 'MONOLITH'),
        createConvexObstacle(obsId++, makeRegularPolyVerts(-290, -320, 74, 5, 0.6), 72, 'MONOLITH')
      );
    }
  }

  const boundary = generateArenaBoundary(shape);
  const pillars: ArenaPillar[] = pillarDefs.map(([x, y, radius, sides], i) => ({
    id: i + 1,
    x,
    y,
    radius,
    sides,
  }));
  const blocks: ArenaBlock[] = blockDefs.map(([x, y, halfW, halfH, height], i) => ({
    id: i + 1,
    x,
    y,
    halfW,
    halfH,
    height,
  }));

  return { shape, boundary, pillars, blocks, obstacles };
}

export function generateSectorPillars(sector: number): ArenaPillar[] {
  return generateSectorArena(sector).pillars;
}

export function generateSectorBlocks(sector: number): ArenaBlock[] {
  return generateSectorArena(sector).blocks;
}

interface RiftWaveSpec {
  x: number;
  y: number;
  delay: number;
  archetypes: EnemyArchetype[];
  eliteIndices?: number[];
}

const ARCHETYPE_POOL: readonly EnemyArchetype[] = [
  'SWARMER',
  'LANCER',
  'VOLT_SPRINTER',
  'PYRO_SPRAYER',
  'BASTION',
  'STALKER',
  'GEO_BOMBER',
  'CRYO_SNIPER',
  'VORTEX_DRONE',
  'WEAVER',
  'SPLITTER',
  'MENDER',
  'MINELAYER',
  'OBELISK',
];

const RIFT_COORDS: readonly Vec2[] = [
  { x: 440, y: 270 },
  { x: 440, y: -270 },
  { x: 220, y: 390 },
  { x: -180, y: -390 },
  { x: 560, y: 0 },
  { x: -240, y: 380 },
  { x: 640, y: 320 },
  { x: 640, y: -320 },
  { x: 60, y: 0 },
];

export class WaveDirector {
  public wave = 0;
  public score = 0;
  public multiplier = 1;
  public multiplierTimer = 0;
  public arenaShape: ArenaShapeKind = 'OCTAGON';
  public arenaBoundary: Vec2[] = generateArenaBoundary('OCTAGON');
  public pillars: ArenaPillar[] = [];
  public blocks: ArenaBlock[] = [];
  public obstacles: ArenaObstacle[] = [];
  public rifts: SpawnRiftEntity[] = [];
  public gate: SectorGate = {
    open: false,
    x: 1100 - 36,
    y: 0,
    radius: 68,
  };
  private nextRiftId = 1;

  public reset(): void {
    this.wave = 0;
    this.score = 0;
    this.multiplier = 1;
    this.multiplierTimer = 0;
    this.arenaShape = 'OCTAGON';
    this.arenaBoundary = generateArenaBoundary('OCTAGON');
    this.pillars = [];
    this.blocks = [];
    this.obstacles = [];
    this.rifts = [];
    this.gate.open = false;
    this.nextRiftId = 1;
  }

  public startWave(sectorNum: number, events: SimEvent[]): void {
    this.wave = sectorNum;
    const layout = generateSectorArena(sectorNum);
    this.arenaShape = layout.shape;
    this.arenaBoundary = layout.boundary;
    this.pillars = layout.pillars;
    this.blocks = layout.blocks;
    this.obstacles = layout.obstacles;
    this.rifts = [];
    this.gate.open = false;

    const span = getArenaHorizontalSpanAtY0(this.arenaBoundary);
    this.gate.x = span.maxX - 36;
    this.gate.y = 0;

    const isBoss = sectorNum % 5 === 0;
    const specs = this.buildSectorSquads(sectorNum, isBoss);

    for (const spec of specs) {
      const safePos = pushPointClearOfObstacles(
        spec.x,
        spec.y,
        54,
        this.arenaBoundary,
        this.pillars,
        this.blocks,
        this.obstacles
      );
      this.rifts.push({
        id: this.nextRiftId++,
        x: safePos.x,
        y: safePos.y,
        radius: 56,
        timer: spec.delay,
        maxTimer: spec.delay,
        archetypes: spec.archetypes,
        eliteIndices: spec.eliteIndices,
      });
    }

    events.push({ type: 'wave_start', wave: sectorNum, isBoss });
    events.push({ type: 'sfx', sound: isBoss ? 'boss_spawn' : 'wave_start' });
  }

  private buildSectorSquads(sector: number, isBoss: boolean): RiftWaveSpec[] {
    if (isBoss) {
      if (sector <= 5) {
        return [
          { x: 430, y: 0, delay: 2.0, archetypes: ['WARDEN', 'BASTION', 'MENDER'] },
          { x: 300, y: 390, delay: 2.0, archetypes: ['LANCER', 'PYRO_SPRAYER', 'STALKER', 'VOLT_SPRINTER'] },
          {
            x: 300,
            y: -390,
            delay: 8.5,
            archetypes: ['GEO_BOMBER', 'CRYO_SNIPER', 'VORTEX_DRONE', 'OBELISK'],
            eliteIndices: [3],
          },
        ];
      }
      const specs: RiftWaveSpec[] = [
        {
          x: 430,
          y: 0,
          delay: 2.0,
          archetypes: sector >= 15 ? ['WARDEN', 'WARDEN', 'MENDER', 'OBELISK'] : ['WARDEN', 'BASTION', 'MENDER'],
          eliteIndices: sector >= 15 ? [3] : undefined,
        },
      ];
      const escortRifts = Math.min(8, 3 + Math.floor(sector / 5));
      for (let r = 0; r < escortRifts; r++) {
        const pt = RIFT_COORDS[(r + 1) % RIFT_COORDS.length]!;
        const count = Math.min(7, 3 + Math.floor(sector / 5));
        const archs: EnemyArchetype[] = [];
        const eliteIndices: number[] = [];
        for (let k = 0; k < count; k++) {
          const idx = (sector * 5 + r * 3 + k * 2) % ARCHETYPE_POOL.length;
          archs.push(ARCHETYPE_POOL[idx]!);
          if (k === 0 && (r + k) % 2 === 0) eliteIndices.push(k);
        }
        specs.push({
          x: pt.x,
          y: pt.y,
          delay: r < 2 ? 2.0 : 6.0 + (r - 2) * 3.5,
          archetypes: archs,
          eliteIndices,
        });
      }
      return specs;
    }

    if (sector === 1) {
      return [
        { x: 410, y: 170, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'LANCER', 'BASTION'] },
        { x: 410, y: -170, delay: 2.0, archetypes: ['SWARMER', 'VOLT_SPRINTER', 'PYRO_SPRAYER'] },
        { x: 260, y: 410, delay: 7.5, archetypes: ['SWARMER', 'LANCER', 'PYRO_SPRAYER'] },
        { x: 260, y: -410, delay: 7.5, archetypes: ['VOLT_SPRINTER', 'BASTION', 'SWARMER'] },
      ];
    }
    if (sector === 2) {
      return [
        { x: 420, y: 260, delay: 2.0, archetypes: ['SWARMER', 'PYRO_SPRAYER', 'STALKER', 'CRYO_SNIPER'] },
        { x: 420, y: -260, delay: 2.0, archetypes: ['VOLT_SPRINTER', 'GEO_BOMBER', 'LANCER', 'VORTEX_DRONE'] },
        { x: -240, y: 380, delay: 7.5, archetypes: ['SWARMER', 'BASTION', 'CRYO_SNIPER', 'STALKER'] },
        { x: -240, y: -380, delay: 7.5, archetypes: ['GEO_BOMBER', 'VORTEX_DRONE', 'LANCER', 'BASTION'] },
      ];
    }
    if (sector === 3) {
      return [
        { x: 440, y: 260, delay: 2.0, archetypes: ['SWARMER', 'LANCER', 'WEAVER', 'MENDER', 'BASTION'], eliteIndices: [4] },
        { x: 440, y: -260, delay: 2.0, archetypes: ['GEO_BOMBER', 'CRYO_SNIPER', 'SPLITTER', 'VOLT_SPRINTER'] },
        { x: 240, y: 390, delay: 7.0, archetypes: ['PYRO_SPRAYER', 'WEAVER', 'MINELAYER', 'STALKER', 'LANCER'] },
        { x: -200, y: -390, delay: 7.0, archetypes: ['SWARMER', 'VORTEX_DRONE', 'BASTION', 'SPLITTER'] },
        { x: 540, y: 0, delay: 12.5, archetypes: ['MENDER', 'MINELAYER', 'WEAVER', 'CRYO_SNIPER'] },
      ];
    }
    if (sector === 4) {
      return [
        { x: 440, y: 280, delay: 2.0, archetypes: ['LANCER', 'PYRO_SPRAYER', 'OBELISK', 'MENDER', 'STALKER'], eliteIndices: [2] },
        { x: 440, y: -280, delay: 2.0, archetypes: ['GEO_BOMBER', 'VOLT_SPRINTER', 'SPLITTER', 'VORTEX_DRONE', 'BASTION'] },
        { x: 220, y: 400, delay: 7.0, archetypes: ['CRYO_SNIPER', 'BASTION', 'WEAVER', 'MINELAYER', 'LANCER'] },
        { x: -200, y: -400, delay: 7.0, archetypes: ['SWARMER', 'VORTEX_DRONE', 'MENDER', 'STALKER', 'GEO_BOMBER'], eliteIndices: [3] },
        { x: 560, y: 0, delay: 12.0, archetypes: ['OBELISK', 'WEAVER', 'MINELAYER', 'SPLITTER', 'CRYO_SNIPER'] },
      ];
    }

    // Endless escalating sectors (6+): growing rifts, growing squad sizes, tighter delays, and scaling elites
    const riftCount = Math.min(9, 4 + Math.floor(sector / 2));
    const perRift = Math.min(9, 4 + Math.floor((sector - 2) / 2));
    const totalEnemies = riftCount * perRift;
    let elitesRemaining = Math.min(Math.floor(totalEnemies * 0.45), 1 + Math.floor(sector / 2));
    const waveGap = Math.max(3.5, 6.2 - sector * 0.14);

    const specs: RiftWaveSpec[] = [];
    for (let r = 0; r < riftCount; r++) {
      const pt = RIFT_COORDS[r % RIFT_COORDS.length]!;
      const archs: EnemyArchetype[] = [];
      const eliteIndices: number[] = [];
      for (let k = 0; k < perRift; k++) {
        const idx = (sector * 7 + r * 5 + k * 3) % ARCHETYPE_POOL.length;
        archs.push(ARCHETYPE_POOL[idx]!);
      }
      if (elitesRemaining > 0) {
        const maxInRift = Math.min(elitesRemaining, Math.ceil(perRift * 0.45));
        for (let eIdx = 0; eIdx < maxInRift; eIdx++) {
          eliteIndices.push((eIdx * 2 + r) % perRift);
          elitesRemaining--;
        }
      }
      const delay = r < 2 ? 2.0 : Number((2.0 + Math.floor(r / 2) * waveGap).toFixed(2));
      specs.push({
        x: pt.x,
        y: pt.y,
        delay,
        archetypes: archs,
        eliteIndices: eliteIndices.length > 0 ? eliteIndices : undefined,
      });
    }
    return specs;
  }

  public step(
    dt: number,
    activeEnemyCount: number,
    _player: PlayerState,
    spawnEnemy: (archetype: EnemyArchetype, x: number, y: number, isElite?: boolean) => void,
    events: SimEvent[]
  ): void {
    if (this.multiplier > 1) {
      this.multiplierTimer -= dt;
      if (this.multiplierTimer <= 0) {
        this.multiplier = Math.max(1, Math.floor(this.multiplier / 2));
        this.multiplierTimer = this.multiplier > 1 ? 3.5 : 0;
      }
    }

    if (activeEnemyCount === 0 && this.rifts.length > 0) {
      for (const r of this.rifts) {
        if (r.timer > 1.2) {
          r.timer = 1.2;
          r.maxTimer = Math.min(r.maxTimer, 2.0);
        }
      }
    }

    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const r = this.rifts[i]!;
      r.timer -= dt;
      if (r.timer <= 0) {
        const count = r.archetypes.length;
        for (let k = 0; k < count; k++) {
          const a = (k / Math.max(1, count)) * Math.PI * 2;
          const dist = count === 1 ? 0 : 44;
          const safe = pushPointClearOfObstacles(
            r.x + Math.cos(a) * dist,
            r.y + Math.sin(a) * dist,
            28,
            this.arenaBoundary,
            this.pillars,
            this.blocks,
            this.obstacles
          );
          spawnEnemy(r.archetypes[k]!, safe.x, safe.y, Boolean(r.eliteIndices?.includes(k)));
        }
        events.push({ type: 'vfx_burst', x: r.x, y: r.y, colorHex: 0xb429ff, count: 24, radius: 70 });
        events.push({ type: 'vfx_ring', x: r.x, y: r.y, radius: 95, colorHex: 0x00f5ff });
        events.push({ type: 'grid_impulse', x: r.x, y: r.y, strength: 190, radius: 150 });
        this.rifts.splice(i, 1);
      }
    }

    if (!this.gate.open && this.rifts.length === 0 && activeEnemyCount === 0) {
      this.gate.open = true;
      events.push({ type: 'gate_open', wave: this.wave });
      events.push({ type: 'vfx_ring', x: this.gate.x, y: this.gate.y, radius: 110, colorHex: 0x39ff14 });
      events.push({ type: 'sfx', sound: 'wave_start' });
    }
  }

  public onEnemyKilled(archetype: EnemyArchetype, scoreMult = 1, isElite = false): void {
    const basePoints =
      archetype === 'WARDEN' ? 2500 :
      archetype === 'OBELISK' ? 240 :
      archetype === 'MINELAYER' ? 200 :
      archetype === 'VORTEX_DRONE' ? 190 :
      archetype === 'BASTION' ? 180 :
      archetype === 'MENDER' ? 180 :
      archetype === 'GEO_BOMBER' ? 175 :
      archetype === 'WEAVER' ? 160 :
      archetype === 'CRYO_SNIPER' ? 160 :
      archetype === 'SPLITTER' ? 150 :
      archetype === 'PYRO_SPRAYER' ? 145 :
      archetype === 'LANCER' ? 140 :
      archetype === 'VOLT_SPRINTER' ? 135 :
      archetype === 'STALKER' ? 130 : 60;

    const eliteMult = isElite ? 2 : 1;
    this.score += Math.round(basePoints * eliteMult * this.multiplier * scoreMult);
    this.multiplier = Math.min(16, this.multiplier + 1);
    this.multiplierTimer = 4.0;
  }

  public onPlayerDamaged(): void {
    this.multiplier = 1;
    this.multiplierTimer = 0;
  }
}

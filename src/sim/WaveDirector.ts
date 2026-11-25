import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  ArenaBlock,
  ArenaPillar,
  EnemyArchetype,
  PlayerState,
  SectorGate,
  SimEvent,
  SpawnRiftEntity,
} from './types';

export function generateSectorPillars(sector: number): ArenaPillar[] {
  const layout = (sector - 1) % 5;
  const coords: Array<[number, number, number, number]> = [];

  if (layout === 0) {
    // Cyber Vault
    coords.push([-120, 210, 36, 6], [120, -210, 36, 6], [420, 0, 38, 6]);
  } else if (layout === 1) {
    // Reactor Foundry
    coords.push([-220, 290, 40, 4], [220, -290, 40, 4], [0, 0, 44, 8]);
  } else if (layout === 2) {
    // Cryo Gauntlet
    coords.push([-520, 140, 38, 6], [520, -140, 38, 6], [0, 0, 36, 6]);
  } else if (layout === 3) {
    // Bio-Core Compound
    coords.push([-180, 0, 38, 8], [180, 0, 38, 8], [0, 330, 36, 6], [0, -330, 36, 6]);
  } else {
    // Void Sanctum Boss Arena
    coords.push([-260, 0, 42, 8], [260, 0, 42, 8], [0, 320, 38, 8], [0, -320, 38, 8]);
  }

  return coords.map(([x, y, radius, sides], i) => ({
    id: i + 1,
    x,
    y,
    radius,
    sides,
  }));
}

export function generateSectorBlocks(sector: number): ArenaBlock[] {
  const layout = (sector - 1) % 5;
  const defs: Array<[number, number, number, number, number]> = [];

  if (layout === 0) {
    // Cyber Vault: open center corridor (y=-110..110), upper & lower bunker rooms
    defs.push(
      [-280, 320, 170, 36, 68],
      [260, 320, 170, 36, 68],
      [-280, -320, 170, 36, 68],
      [260, -320, 170, 36, 68],
      [-520, 195, 36, 110, 62],
      [-520, -195, 36, 110, 62],
      [520, 210, 36, 110, 62],
      [520, -210, 36, 110, 62]
    );
  } else if (layout === 1) {
    // Reactor Foundry: split core + side bulkheads with bypass tunnels
    defs.push(
      [0, 190, 160, 42, 74],
      [0, -190, 160, 42, 74],
      [-430, 0, 44, 165, 70],
      [430, 0, 44, 165, 70]
    );
  } else if (layout === 2) {
    // Cryo Gauntlet: staggered S-curve chicane trench walls
    defs.push(
      [-360, 220, 40, 180, 70],
      [-90, -220, 40, 180, 70],
      [190, 220, 40, 180, 70],
      [470, -220, 40, 180, 70]
    );
  } else if (layout === 3) {
    // Bio-Core Compound: 4 corner bunker compounds + central hub monolith
    defs.push(
      [-360, 280, 150, 36, 68],
      [-360, -280, 150, 36, 68],
      [340, 280, 150, 36, 68],
      [340, -280, 150, 36, 68],
      [0, 0, 88, 88, 78]
    );
  } else {
    // Void Sanctum Boss Colosseum
    defs.push(
      [-440, 280, 120, 38, 74],
      [440, 280, 120, 38, 74],
      [-440, -280, 120, 38, 74],
      [440, -280, 120, 38, 74]
    );
  }

  return defs.map(([x, y, halfW, halfH, height], i) => ({
    id: i + 1,
    x,
    y,
    halfW,
    halfH,
    height,
  }));
}

interface RiftWaveSpec {
  x: number;
  y: number;
  delay: number;
  archetypes: EnemyArchetype[];
}

export class WaveDirector {
  public wave = 0;
  public score = 0;
  public multiplier = 1;
  public multiplierTimer = 0;
  public pillars: ArenaPillar[] = [];
  public blocks: ArenaBlock[] = [];
  public rifts: SpawnRiftEntity[] = [];
  public gate: SectorGate = {
    open: false,
    x: ARENA_HALF_W - 34,
    y: 0,
    radius: 68,
  };
  private nextRiftId = 1;

  public reset(): void {
    this.wave = 0;
    this.score = 0;
    this.multiplier = 1;
    this.multiplierTimer = 0;
    this.pillars = [];
    this.blocks = [];
    this.rifts = [];
    this.gate.open = false;
    this.nextRiftId = 1;
  }

  public startWave(sectorNum: number, events: SimEvent[]): void {
    this.wave = sectorNum;
    this.pillars = generateSectorPillars(sectorNum);
    this.blocks = generateSectorBlocks(sectorNum);
    this.rifts = [];
    this.gate.open = false;

    const isBoss = sectorNum % 5 === 0;
    const specs = this.buildSectorSquads(sectorNum, isBoss);

    for (const spec of specs) {
      this.rifts.push({
        id: this.nextRiftId++,
        x: spec.x,
        y: spec.y,
        radius: 56,
        timer: spec.delay,
        maxTimer: spec.delay,
        archetypes: spec.archetypes,
      });
    }

    events.push({ type: 'wave_start', wave: sectorNum, isBoss });
    events.push({ type: 'sfx', sound: isBoss ? 'boss_spawn' : 'wave_start' });
  }

  private buildSectorSquads(sector: number, isBoss: boolean): RiftWaveSpec[] {
    if (isBoss) {
      return [
        { x: 420, y: 0, delay: 2.0, archetypes: ['WARDEN', 'BASTION', 'BASTION'] },
        { x: 320, y: 390, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'STALKER', 'WEAVER'] },
        { x: 320, y: -390, delay: 8.5, archetypes: ['SWARMER', 'SWARMER', 'WEAVER', 'SPLITTER', 'STALKER'] },
      ];
    }
    if (sector === 1) {
      return [
        { x: 410, y: 170, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'SWARMER', 'BASTION'] },
        { x: 410, y: -170, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'STALKER', 'STALKER'] },
        { x: 260, y: 410, delay: 7.5, archetypes: ['SWARMER', 'SWARMER', 'WEAVER'] },
        { x: 260, y: -410, delay: 7.5, archetypes: ['SWARMER', 'BASTION', 'STALKER'] },
      ];
    }
    if (sector === 2) {
      return [
        { x: 420, y: 260, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'BASTION', 'STALKER', 'WEAVER'] },
        { x: 420, y: -260, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'SPLITTER', 'STALKER'] },
        { x: -240, y: 380, delay: 7.5, archetypes: ['SWARMER', 'SWARMER', 'BASTION', 'STALKER', 'WEAVER'] },
        { x: -240, y: -380, delay: 7.5, archetypes: ['SWARMER', 'SPLITTER', 'STALKER', 'BASTION'] },
      ];
    }
    if (sector === 3) {
      return [
        { x: 440, y: 260, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'WEAVER', 'SPLITTER', 'BASTION'] },
        { x: 440, y: -260, delay: 2.0, archetypes: ['SWARMER', 'BASTION', 'STALKER', 'WEAVER'] },
        { x: 240, y: 390, delay: 7.0, archetypes: ['SWARMER', 'WEAVER', 'SPLITTER', 'STALKER', 'STALKER'] },
        { x: -200, y: -390, delay: 7.0, archetypes: ['SWARMER', 'SWARMER', 'BASTION', 'SPLITTER'] },
        { x: 540, y: 0, delay: 13.0, archetypes: ['BASTION', 'WEAVER', 'WEAVER', 'STALKER'] },
      ];
    }
    if (sector === 4) {
      return [
        { x: 440, y: 280, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'BASTION', 'WEAVER', 'STALKER'] },
        { x: 440, y: -280, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'SPLITTER', 'STALKER', 'BASTION'] },
        { x: 220, y: 400, delay: 7.0, archetypes: ['SWARMER', 'BASTION', 'WEAVER', 'SPLITTER', 'STALKER'] },
        { x: -200, y: -400, delay: 7.0, archetypes: ['SWARMER', 'SWARMER', 'WEAVER', 'STALKER', 'BASTION'] },
        { x: 560, y: 0, delay: 13.0, archetypes: ['WEAVER', 'WEAVER', 'SPLITTER', 'BASTION', 'STALKER', 'STALKER'] },
      ];
    }

    // Sector 6+ scaling
    const extra = Math.min(6, Math.floor((sector - 4) / 2) + 1);
    const s1: EnemyArchetype[] = ['SWARMER', 'SWARMER', 'BASTION', 'WEAVER', 'STALKER'];
    const s2: EnemyArchetype[] = ['SWARMER', 'SWARMER', 'SPLITTER', 'WEAVER', 'STALKER'];
    const s3: EnemyArchetype[] = ['SWARMER', 'BASTION', 'SPLITTER', 'STALKER', 'WEAVER'];
    const s4: EnemyArchetype[] = ['SWARMER', 'WEAVER', 'BASTION', 'STALKER', 'SPLITTER'];
    for (let i = 0; i < extra; i++) {
      s1.push(i % 2 === 0 ? 'SWARMER' : 'STALKER');
      s2.push(i % 2 === 0 ? 'SPLITTER' : 'BASTION');
      s3.push(i % 2 === 0 ? 'WEAVER' : 'STALKER');
      s4.push(i % 2 === 0 ? 'BASTION' : 'WEAVER');
    }
    return [
      { x: 440, y: 270, delay: 2.0, archetypes: s1 },
      { x: 440, y: -270, delay: 2.0, archetypes: s2 },
      { x: 220, y: 390, delay: 7.0, archetypes: s3 },
      { x: -180, y: -390, delay: 11.5, archetypes: s4 },
    ];
  }

  public step(
    dt: number,
    activeEnemyCount: number,
    _player: PlayerState,
    spawnEnemy: (archetype: EnemyArchetype, x: number, y: number) => void,
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
          const sx = Math.max(-ARENA_HALF_W + 40, Math.min(ARENA_HALF_W - 40, r.x + Math.cos(a) * dist));
          const sy = Math.max(-ARENA_HALF_H + 40, Math.min(ARENA_HALF_H - 40, r.y + Math.sin(a) * dist));
          spawnEnemy(r.archetypes[k]!, sx, sy);
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

  public onEnemyKilled(archetype: EnemyArchetype): void {
    const basePoints =
      archetype === 'WARDEN' ? 1500 :
      archetype === 'BASTION' ? 180 :
      archetype === 'WEAVER' ? 160 :
      archetype === 'SPLITTER' ? 150 :
      archetype === 'STALKER' ? 130 : 60;

    this.score += basePoints * this.multiplier;
    this.multiplier = Math.min(16, this.multiplier + 1);
    this.multiplierTimer = 4.0;
  }

  public onPlayerDamaged(): void {
    this.multiplier = 1;
    this.multiplierTimer = 0;
  }
}

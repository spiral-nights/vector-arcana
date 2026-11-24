import {
  ARENA_HALF_H,
  ARENA_HALF_W,
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
    // Quad Sanctum
    coords.push([-320, 260, 44, 6], [320, 260, 44, 6], [-320, -260, 44, 6], [320, -260, 44, 6]);
  } else if (layout === 1) {
    // Twin Corridors
    coords.push([-220, 180, 48, 4], [-220, -180, 48, 4], [260, 320, 44, 4], [260, -320, 44, 4], [0, 0, 42, 8]);
  } else if (layout === 2) {
    // Diamond Ring
    coords.push([0, 340, 46, 6], [0, -340, 46, 6], [-420, 0, 46, 6], [420, 0, 46, 6]);
  } else if (layout === 3) {
    // Asymmetric Bastion
    coords.push([-380, 240, 48, 8], [-120, -220, 52, 6], [220, 220, 48, 6], [460, -240, 44, 8]);
  } else {
    // Boss Arena (wide outer pillars)
    coords.push([-480, 360, 50, 8], [480, 360, 50, 8], [-480, -360, 50, 8], [480, -360, 50, 8]);
  }

  return coords.map(([x, y, radius, sides], i) => ({
    id: i + 1,
    x,
    y,
    radius,
    sides,
  }));
}

export class WaveDirector {
  public wave = 0;
  public score = 0;
  public multiplier = 1;
  public multiplierTimer = 0;
  public pillars: ArenaPillar[] = [];
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
    this.rifts = [];
    this.gate.open = false;
    this.nextRiftId = 1;
  }

  public startWave(sectorNum: number, events: SimEvent[]): void {
    this.wave = sectorNum;
    this.pillars = generateSectorPillars(sectorNum);
    this.rifts = [];
    this.gate.open = false;

    const isBoss = sectorNum % 5 === 0;
    const squads = this.buildSectorSquads(sectorNum, isBoss);

    const riftPositions: Array<[number, number]> =
      squads.length === 1
        ? [[420, 0]]
        : [
            [420, 280],
            [420, -280],
          ];

    for (let i = 0; i < squads.length; i++) {
      const [rx, ry] = riftPositions[i % riftPositions.length]!;
      this.rifts.push({
        id: this.nextRiftId++,
        x: rx,
        y: ry,
        radius: 56,
        timer: 2.0,
        maxTimer: 2.0,
        archetypes: squads[i]!,
      });
    }

    events.push({ type: 'wave_start', wave: sectorNum, isBoss });
    events.push({ type: 'sfx', sound: isBoss ? 'boss_spawn' : 'wave_start' });
  }

  private buildSectorSquads(sector: number, isBoss: boolean): EnemyArchetype[][] {
    if (isBoss) {
      return [
        ['WARDEN'],
        ['SWARMER', 'SWARMER', 'STALKER'],
      ];
    }
    if (sector === 1) {
      return [['SWARMER', 'SWARMER', 'SWARMER', 'SWARMER', 'BASTION']];
    }
    if (sector === 2) {
      return [
        ['SWARMER', 'SWARMER', 'BASTION'],
        ['SWARMER', 'SWARMER', 'STALKER', 'STALKER'],
      ];
    }
    if (sector === 3) {
      return [
        ['SWARMER', 'SWARMER', 'WEAVER', 'SPLITTER'],
        ['SWARMER', 'WEAVER', 'SPLITTER'],
      ];
    }
    if (sector === 4) {
      return [
        ['SWARMER', 'SWARMER', 'BASTION', 'WEAVER', 'STALKER'],
        ['SWARMER', 'SWARMER', 'BASTION', 'SPLITTER', 'STALKER'],
      ];
    }
    // Sector 6+ scaling
    const extra = Math.min(4, Math.floor((sector - 4) / 2));
    const s1: EnemyArchetype[] = ['SWARMER', 'SWARMER', 'BASTION', 'WEAVER', 'STALKER'];
    const s2: EnemyArchetype[] = ['SWARMER', 'SWARMER', 'SPLITTER', 'WEAVER', 'STALKER'];
    for (let i = 0; i < extra; i++) {
      s1.push(i % 2 === 0 ? 'SWARMER' : 'STALKER');
      s2.push(i % 2 === 0 ? 'SPLITTER' : 'BASTION');
    }
    return [s1, s2];
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

    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const r = this.rifts[i]!;
      r.timer -= dt;
      if (r.timer <= 0) {
        const count = r.archetypes.length;
        for (let k = 0; k < count; k++) {
          const a = (k / Math.max(1, count)) * Math.PI * 2;
          const dist = count === 1 ? 0 : 42;
          const sx = Math.max(-ARENA_HALF_W + 40, Math.min(ARENA_HALF_W - 40, r.x + Math.cos(a) * dist));
          const sy = Math.max(-ARENA_HALF_H + 40, Math.min(ARENA_HALF_H - 40, r.y + Math.sin(a) * dist));
          spawnEnemy(r.archetypes[k]!, sx, sy);
        }
        events.push({ type: 'vfx_burst', x: r.x, y: r.y, colorHex: 0xb429ff, count: 22, radius: 65 });
        events.push({ type: 'vfx_ring', x: r.x, y: r.y, radius: 85, colorHex: 0x00f5ff });
        events.push({ type: 'grid_impulse', x: r.x, y: r.y, strength: 180, radius: 140 });
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

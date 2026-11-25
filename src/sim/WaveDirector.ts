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
    // Sector Theme 0: Cyber Vault — asymmetric cover bunkers + flanking pylons
    coords.push(
      [-320, 250, 44, 6],
      [320, 250, 44, 6],
      [-320, -250, 44, 6],
      [320, -250, 44, 6],
      [0, 390, 36, 6],
      [0, -390, 36, 6]
    );
  } else if (layout === 1) {
    // Sector Theme 1: Reactor Choke — tight center core + dual forward bastions
    coords.push(
      [-230, 175, 48, 4],
      [-230, -175, 48, 4],
      [250, 310, 44, 4],
      [250, -310, 44, 4],
      [0, 0, 50, 8],
      [510, 0, 38, 4]
    );
  } else if (layout === 2) {
    // Sector Theme 2: Cryo Gauntlet — staggered prism pillars & side lanes
    coords.push(
      [-450, 0, 46, 6],
      [-150, 290, 44, 6],
      [-150, -290, 44, 6],
      [180, 160, 42, 6],
      [180, -160, 42, 6],
      [480, 320, 44, 6],
      [480, -320, 44, 6]
    );
  } else if (layout === 3) {
    // Sector Theme 3: Bio-Core Ring — outer ring of monoliths around central killbox
    coords.push(
      [-380, 240, 48, 8],
      [-120, -240, 50, 6],
      [220, 240, 48, 6],
      [440, -240, 44, 8],
      [-520, -180, 36, 6],
      [0, 410, 38, 8]
    );
  } else {
    // Sector Theme 4: Void Sanctum Boss Arena
    coords.push(
      [-480, 360, 52, 8],
      [480, 360, 52, 8],
      [-480, -360, 52, 8],
      [480, -360, 52, 8],
      [0, 440, 38, 6],
      [0, -440, 38, 6]
    );
  }

  return coords.map(([x, y, radius, sides], i) => ({
    id: i + 1,
    x,
    y,
    radius,
    sides,
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
        { x: 420, y: 0, delay: 2.0, archetypes: ['WARDEN', 'BASTION'] },
        { x: 360, y: 310, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'STALKER'] },
        { x: 360, y: -310, delay: 9.0, archetypes: ['SWARMER', 'SWARMER', 'WEAVER', 'STALKER'] },
      ];
    }
    if (sector === 1) {
      return [
        { x: 410, y: 210, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'SWARMER', 'BASTION'] },
        { x: 410, y: -210, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'STALKER'] },
        { x: 260, y: 340, delay: 8.0, archetypes: ['SWARMER', 'SWARMER', 'STALKER'] },
        { x: 260, y: -340, delay: 8.0, archetypes: ['SWARMER', 'BASTION'] },
      ];
    }
    if (sector === 2) {
      return [
        { x: 430, y: 240, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'BASTION', 'STALKER'] },
        { x: 430, y: -240, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'WEAVER'] },
        { x: 220, y: 350, delay: 8.5, archetypes: ['SWARMER', 'SWARMER', 'STALKER', 'BASTION'] },
        { x: 220, y: -350, delay: 8.5, archetypes: ['SWARMER', 'SPLITTER', 'STALKER'] },
      ];
    }
    if (sector === 3) {
      return [
        { x: 430, y: 260, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'WEAVER', 'SPLITTER'] },
        { x: 430, y: -260, delay: 2.0, archetypes: ['SWARMER', 'BASTION', 'STALKER'] },
        { x: 240, y: 360, delay: 8.5, archetypes: ['SWARMER', 'WEAVER', 'SPLITTER', 'STALKER'] },
        { x: -160, y: -360, delay: 8.5, archetypes: ['SWARMER', 'SWARMER', 'BASTION', 'STALKER'] },
      ];
    }
    if (sector === 4) {
      return [
        { x: 440, y: 270, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'BASTION', 'WEAVER', 'STALKER'] },
        { x: 440, y: -270, delay: 2.0, archetypes: ['SWARMER', 'SWARMER', 'SPLITTER', 'STALKER'] },
        { x: 210, y: 360, delay: 8.5, archetypes: ['SWARMER', 'BASTION', 'WEAVER', 'SPLITTER'] },
        { x: -180, y: -360, delay: 8.5, archetypes: ['SWARMER', 'SWARMER', 'WEAVER', 'STALKER', 'BASTION'] },
      ];
    }

    // Sector 6+ scaling
    const extra = Math.min(5, Math.floor((sector - 4) / 2));
    const s1: EnemyArchetype[] = ['SWARMER', 'SWARMER', 'BASTION', 'WEAVER', 'STALKER'];
    const s2: EnemyArchetype[] = ['SWARMER', 'SWARMER', 'SPLITTER', 'WEAVER', 'STALKER'];
    const s3: EnemyArchetype[] = ['SWARMER', 'BASTION', 'SPLITTER', 'STALKER'];
    const s4: EnemyArchetype[] = ['SWARMER', 'WEAVER', 'BASTION', 'STALKER'];
    for (let i = 0; i < extra; i++) {
      s1.push(i % 2 === 0 ? 'SWARMER' : 'STALKER');
      s2.push(i % 2 === 0 ? 'SPLITTER' : 'BASTION');
      s3.push(i % 2 === 0 ? 'WEAVER' : 'SWARMER');
    }
    return [
      { x: 440, y: 270, delay: 2.0, archetypes: s1 },
      { x: 440, y: -270, delay: 2.0, archetypes: s2 },
      { x: 220, y: 360, delay: 8.5, archetypes: s3 },
      { x: -180, y: -360, delay: 8.5, archetypes: s4 },
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

    // Fast-forward delayed wave-2 rifts when the first wave is wiped out early
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
          const dist = count === 1 ? 0 : 48;
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

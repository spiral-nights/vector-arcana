import { ARENA_HALF_H, ARENA_HALF_W, EnemyArchetype, PlayerState, SimEvent } from './types';

interface SpawnEntry {
  archetype: EnemyArchetype;
  delay: number;
}

export class WaveDirector {
  public wave = 0;
  public score = 0;
  public multiplier = 1;
  public multiplierTimer = 0;
  private spawnQueue: SpawnEntry[] = [];
  private spawnTimer = 0;
  private waveClearDelay = 0;

  public reset(): void {
    this.wave = 0;
    this.score = 0;
    this.multiplier = 1;
    this.multiplierTimer = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveClearDelay = 0;
  }

  public startWave(waveNum: number, events: SimEvent[]): void {
    this.wave = waveNum;
    this.spawnQueue = [];
    this.spawnTimer = 0.2;
    this.waveClearDelay = 0;

    const isBoss = waveNum % 5 === 0;
    if (isBoss) {
      this.spawnQueue.push({ archetype: 'WARDEN', delay: 0.2 });
    }

    const swarmerCount = 14 + waveNum * 4;
    for (let i = 0; i < swarmerCount; i++) {
      this.spawnQueue.push({ archetype: 'SWARMER', delay: i % 6 === 0 ? 0.9 : 0.08 });
    }

    const bastionCount = Math.min(5, Math.floor((waveNum + 1) / 2));
    for (let i = 0; i < bastionCount; i++) {
      this.spawnQueue.push({ archetype: 'BASTION', delay: 0.7 });
    }

    if (waveNum >= 2) {
      const stalkerCount = Math.min(6, 1 + Math.floor(waveNum * 0.7));
      for (let i = 0; i < stalkerCount; i++) {
        this.spawnQueue.push({ archetype: 'STALKER', delay: 0.55 });
      }
    }

    if (waveNum >= 3) {
      const weaverCount = Math.min(5, Math.floor(waveNum * 0.6));
      for (let i = 0; i < weaverCount; i++) {
        this.spawnQueue.push({ archetype: 'WEAVER', delay: 0.65 });
      }
      const splitterCount = Math.min(5, Math.floor(waveNum * 0.6));
      for (let i = 0; i < splitterCount; i++) {
        this.spawnQueue.push({ archetype: 'SPLITTER', delay: 0.65 });
      }
    }

    events.push({ type: 'wave_start', wave: waveNum, isBoss });
    events.push({ type: 'sfx', sound: isBoss ? 'boss_spawn' : 'wave_start' });
  }

  public step(
    dt: number,
    activeEnemyCount: number,
    player: PlayerState,
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

    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      while (this.spawnQueue.length > 0 && this.spawnTimer <= 0) {
        const next = this.spawnQueue.shift()!;
        const pos = this.pickPerimeterSpawn(player);
        spawnEnemy(next.archetype, pos.x, pos.y);
        this.spawnTimer += next.delay;
      }
    } else if (activeEnemyCount === 0) {
      this.waveClearDelay += dt;
      if (this.waveClearDelay >= 1.8) {
        this.startWave(this.wave + 1, events);
      }
    }
  }

  private pickPerimeterSpawn(player: PlayerState): { x: number; y: number } {
    for (let attempt = 0; attempt < 8; attempt++) {
      const edge = Math.floor(Math.random() * 4);
      let x = 0;
      let y = 0;
      if (edge === 0) {
        x = (Math.random() * 2 - 1) * (ARENA_HALF_W - 40);
        y = ARENA_HALF_H - 28;
      } else if (edge === 1) {
        x = (Math.random() * 2 - 1) * (ARENA_HALF_W - 40);
        y = -ARENA_HALF_H + 28;
      } else if (edge === 2) {
        x = ARENA_HALF_W - 28;
        y = (Math.random() * 2 - 1) * (ARENA_HALF_H - 40);
      } else {
        x = -ARENA_HALF_W + 28;
        y = (Math.random() * 2 - 1) * (ARENA_HALF_H - 40);
      }
      if (Math.hypot(x - player.x, y - player.y) > 220) {
        return { x, y };
      }
    }
    return { x: player.x > 0 ? -ARENA_HALF_W + 35 : ARENA_HALF_W - 35, y: 0 };
  }

  public onEnemyKilled(archetype: EnemyArchetype): void {
    const basePoints =
      archetype === 'WARDEN' ? 1500 :
      archetype === 'BASTION' ? 160 :
      archetype === 'WEAVER' ? 140 :
      archetype === 'SPLITTER' ? 130 :
      archetype === 'STALKER' ? 110 : 40;

    this.score += basePoints * this.multiplier;
    this.multiplier = Math.min(16, this.multiplier + 1);
    this.multiplierTimer = 4.0;
  }

  public onPlayerDamaged(): void {
    this.multiplier = 1;
    this.multiplierTimer = 0;
  }
}

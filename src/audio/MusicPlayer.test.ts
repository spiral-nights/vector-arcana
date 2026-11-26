import { beforeEach, describe, expect, it } from 'vitest';
import { MusicPlayer } from './MusicPlayer';

class FakeDeck {
  preload = '';
  loop = false;
  volume = 0;
  currentTime = 0;
  duration = 157.3;
  paused = true;
  ended = false;
  playCalls = 0;
  blockPlay = false;

  play(): Promise<void> {
    if (this.blockPlay) return Promise.reject(new Error('blocked'));
    this.playCalls++;
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

const decks: FakeDeck[] = [];

function installFakeAudio(): void {
  const FakeAudio = function FakeAudio() {
    const deck = new FakeDeck();
    decks.push(deck);
    return deck;
  };
  (globalThis as { Audio?: unknown }).Audio = FakeAudio;
  (globalThis as { HTMLAudioElement?: unknown }).HTMLAudioElement = FakeDeck;
}

async function tick(player: MusicPlayer, dt = 1 / 60): Promise<void> {
  for (const d of decks) {
    if (d.paused) continue;
    d.currentTime += dt;
    if (d.currentTime >= d.duration) {
      if (d.loop) d.currentTime -= d.duration;
      else {
        d.currentTime = d.duration;
        d.ended = true;
        d.paused = true;
      }
    }
  }
  player.update(dt);
  await Promise.resolve();
}

async function run(player: MusicPlayer, seconds: number): Promise<void> {
  const steps = Math.round(seconds / (1 / 60));
  for (let i = 0; i < steps; i++) await tick(player);
}

function audible(): FakeDeck[] {
  return decks.filter((d) => !d.paused && d.volume > 0.001);
}

describe('MusicPlayer looping', () => {
  beforeEach(() => {
    decks.length = 0;
  });

  it('keeps music playing past the end of the track', async () => {
    installFakeAudio();
    const player = new MusicPlayer();
    player.setVolumes(1, 1);
    player.unlock();
    player.restart();

    await run(player, 10);
    expect(audible().length).toBe(1);
    expect(audible()[0]!.currentTime).toBeGreaterThan(5);

    // 200s is well past the ~157s track: crossfade and/or loop must have kept it going
    await run(player, 190);
    expect(decks.some((d) => d.playCalls > 0)).toBe(true);
    const stillAudible = audible();
    expect(stillAudible.length).toBe(1);

    // And it keeps going for another full track length
    await run(player, 200);
    expect(audible().length).toBe(1);
  });

  it('falls back to the looped active deck when the incoming deck cannot play', async () => {
    installFakeAudio();
    const player = new MusicPlayer();
    player.setVolumes(1, 1);
    player.unlock();
    player.restart();

    decks[1]!.blockPlay = true;

    await run(player, 170);
    const stillAudible = audible();
    expect(stillAudible.length).toBe(1);
    expect(stillAudible[0]).toBe(decks[0]);
  });

  it('silences everything while muted', async () => {
    installFakeAudio();
    const player = new MusicPlayer();
    player.setVolumes(1, 1);
    player.unlock();
    player.restart();

    player.setMuted(true);
    await run(player, 2);
    expect(audible().length).toBe(0);
  });
});

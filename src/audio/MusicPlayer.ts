import battleMusicUrl from '../../music/Last_Quarter_Surge.mp3';
import { SimSnapshot } from '../sim/types';

const OVERLAP_SEC = 4.0;
const TARGET_FADE_START_SEC = 176.0; // 2:56 out of ~3:00 track -> 4s overlap

export class MusicPlayer {
  private readonly decks: [HTMLAudioElement, HTMLAudioElement];
  private activeIdx: 0 | 1 = 0;
  private crossfading = false;
  private crossfadeElapsed = 0;
  private wantPlaying = false;
  private unlocked = false;
  private muted = false;
  private masterVolume = 0.85;
  private musicVolume = 0.65;
  private targetDuck = 0;
  private currentDuck = 0;

  constructor() {
    const a = new Audio(battleMusicUrl);
    const b = new Audio(battleMusicUrl);
    a.preload = 'auto';
    b.preload = 'auto';
    a.loop = true;
    b.loop = true;
    this.decks = [a, b];
  }

  public unlock(): void {
    this.unlocked = true;
    const active = this.decks[this.activeIdx];
    if (this.wantPlaying && active.paused) {
      active.play().catch(() => {});
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public setVolumes(master: number, music: number): void {
    this.masterVolume = Math.max(0, Math.min(1, master));
    this.musicVolume = Math.max(0, Math.min(1, music));
  }

  public restart(): void {
    this.crossfading = false;
    this.crossfadeElapsed = 0;
    this.activeIdx = 0;
    this.wantPlaying = true;
    this.targetDuck = 1.0;
    for (const d of this.decks) {
      d.pause();
      try {
        d.currentTime = 0;
      } catch {
        // Ignore unbuffered seek
      }
      d.volume = 0;
    }
    if (this.unlocked) {
      this.decks[0].play().catch(() => {});
    }
  }

  public setPhase(phase: SimSnapshot['phase']): void {
    if (phase === 'PLAYING') {
      this.targetDuck = 1.0;
      if (!this.wantPlaying) {
        this.restart();
      }
    } else if (phase === 'AUGMENT_CHOICE' || phase === 'PAUSED') {
      this.targetDuck = 0.55;
    } else if (phase === 'TITLE') {
      this.targetDuck = 0;
      this.wantPlaying = false;
      this.crossfading = false;
      for (const d of this.decks) {
        d.pause();
        d.volume = 0;
      }
    } else {
      // GAME_OVER: fade down cleanly
      this.targetDuck = 0;
      this.wantPlaying = false;
      this.crossfading = false;
    }
  }

  public update(dt: number): void {
    const safeDt = Math.max(0, Math.min(0.1, dt));
    const duckSpeed = this.targetDuck > this.currentDuck ? 2.8 : 2.2;
    if (this.currentDuck < this.targetDuck) {
      this.currentDuck = Math.min(this.targetDuck, this.currentDuck + duckSpeed * safeDt);
    } else if (this.currentDuck > this.targetDuck) {
      this.currentDuck = Math.max(this.targetDuck, this.currentDuck - duckSpeed * safeDt);
    }

    const baseVol = this.muted
      ? 0
      : Math.max(0, Math.min(1, this.masterVolume * this.musicVolume * this.currentDuck));

    const active = this.decks[this.activeIdx];
    const nextIdx: 0 | 1 = this.activeIdx === 0 ? 1 : 0;
    const next = this.decks[nextIdx];

    if (!this.wantPlaying) {
      active.volume = baseVol;
      next.volume = 0;
      if (this.currentDuck <= 0.005) {
        if (!active.paused) active.pause();
        if (!next.paused) next.pause();
      }
      return;
    }

    if (!this.unlocked) return;

    if (active.paused && !this.crossfading) {
      active.play().catch(() => {});
    }

    const dur = active.duration;
    const fadeStart =
      Number.isFinite(dur) && dur > OVERLAP_SEC + 2
        ? Math.min(TARGET_FADE_START_SEC, dur - OVERLAP_SEC)
        : TARGET_FADE_START_SEC;

    if (!this.crossfading && (active.currentTime >= fadeStart || active.ended)) {
      this.crossfading = true;
      this.crossfadeElapsed = 0;
      try {
        next.currentTime = 0;
      } catch {
        // Ignore unbuffered seek
      }
      next.volume = 0;
      next.play().catch(() => {
        // Playback of the incoming deck was blocked: keep the looping active deck audible
        // and abandon this crossfade instead of switching to a silent deck.
        this.crossfading = false;
        this.crossfadeElapsed = 0;
        next.volume = 0;
        try {
          next.pause();
        } catch {
          // Ignore pause on an unstarted element
        }
      });
    }

    if (this.crossfading) {
      this.crossfadeElapsed += safeDt;
      const t = Math.min(1, this.crossfadeElapsed / OVERLAP_SEC);
      active.volume = baseVol * (1 - t);
      next.volume = baseVol * Math.min(1, t / 0.35);

      if (t >= 1 || active.ended) {
        active.pause();
        try {
          active.currentTime = 0;
        } catch {
          // Ignore unbuffered seek
        }
        active.volume = 0;
        this.activeIdx = nextIdx;
        this.crossfading = false;
        this.crossfadeElapsed = 0;
        const promoted = this.decks[this.activeIdx];
        if (promoted.paused) {
          promoted.currentTime = 0;
          promoted.play().catch(() => {});
        }
      }
    } else {
      active.volume = baseVol;
      next.volume = 0;
    }
  }
}

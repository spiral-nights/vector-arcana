import { QueueElement, SfxId } from '../sim/types';

const COOLDOWN_MS: Partial<Record<SfxId, number>> = {
  spray: 90,
  lightning: 70,
  beam_clash: 110,
  enemy_hit: 55,
  beam: 160,
  heal: 150,
  shield_block: 80,
};

export class SynthAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private masterVolume = 0.85;
  private sfxVolume = 0.85;
  private readonly lastPlayed = new Map<SfxId, number>();

  private getEffectiveGain(): number {
    return this.muted ? 0 : 0.36 * this.masterVolume * this.sfxVolume;
  }

  private applyMasterGain(): void {
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.getEffectiveGain(), this.ctx.currentTime, 0.015);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-16, ctx.currentTime);
    compressor.ratio.setValueAtTime(6, ctx.currentTime);

    const master = ctx.createGain();
    master.gain.setValueAtTime(this.getEffectiveGain(), ctx.currentTime);
    master.connect(compressor);
    compressor.connect(ctx.destination);

    // 1.0s pre-generated white noise buffer
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.ctx = ctx;
    this.masterGain = master;
    this.noiseBuffer = buf;
    return ctx;
  }

  public unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  public setVolumes(master: number, sfx: number): void {
    this.masterVolume = Math.max(0, Math.min(1, master));
    this.sfxVolume = Math.max(0, Math.min(1, sfx));
    this.applyMasterGain();
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), now);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    }
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + Math.min(0.015, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playNoise(
    duration: number,
    filterType: BiquadFilterType,
    filterFreq: number,
    volume: number,
    q = 1.2,
    delay = 0
  ): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.Q.setValueAtTime(q, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + Math.min(0.012, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  public play(sound: SfxId, _colorHex?: number, elements?: readonly QueueElement[]): void {
    if (this.muted) return;
    const nowMs = performance.now();
    const minCd = COOLDOWN_MS[sound] ?? 30;
    const prev = this.lastPlayed.get(sound) ?? 0;
    if (nowMs - prev < minCd) return;
    this.lastPlayed.set(sound, nowMs);

    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') return;

    const pitchVar = 0.94 + Math.random() * 0.12;
    if (elements && elements.length > 0) {
      this.playElementLayer(elements, pitchVar);
    }

    switch (sound) {
      case 'queue':
        this.playTone(540 * pitchVar, 740 * pitchVar, 0.075, 'triangle', 0.22);
        break;
      case 'cancel':
        this.playTone(340 * pitchVar, 170, 0.11, 'sawtooth', 0.2);
        break;
      case 'fusion':
        this.playTone(520 * pitchVar, 780 * pitchVar, 0.12, 'triangle', 0.24);
        this.playTone(780 * pitchVar, 1180 * pitchVar, 0.14, 'sine', 0.2, 0.05);
        break;
      case 'dash':
        this.playNoise(0.16, 'bandpass', 1100 * pitchVar, 0.28, 1.5);
        this.playTone(460 * pitchVar, 180, 0.14, 'sine', 0.2);
        break;
      case 'shield':
        this.playTone(280 * pitchVar, 560, 0.18, 'sine', 0.22);
        this.playTone(420 * pitchVar, 840, 0.16, 'triangle', 0.12, 0.03);
        break;
      case 'wall':
        this.playTone(150 * pitchVar, 75, 0.2, 'triangle', 0.28);
        this.playNoise(0.14, 'lowpass', 520, 0.2);
        break;
      case 'mine_deploy':
        this.playTone(460 * pitchVar, 620, 0.08, 'square', 0.12);
        this.playTone(620 * pitchVar, 480, 0.08, 'sine', 0.14, 0.05);
        break;
      case 'mine_explode':
        this.playTone(130 * pitchVar, 36, 0.34, 'sine', 0.44);
        this.playNoise(0.28, 'lowpass', 780, 0.38);
        break;
      case 'storm':
        this.playNoise(0.38, 'bandpass', 420 * pitchVar, 0.22, 0.9);
        this.playTone(110 * pitchVar, 62, 0.32, 'sawtooth', 0.14);
        break;
      case 'rock':
        this.playTone(155 * pitchVar, 58, 0.22, 'triangle', 0.32);
        this.playNoise(0.16, 'lowpass', 640, 0.22);
        break;
      case 'icicle':
        this.playTone(1150 * pitchVar, 1750 * pitchVar, 0.09, 'sine', 0.16);
        this.playNoise(0.08, 'highpass', 2600, 0.12);
        break;
      case 'beam':
        this.playTone(185 * pitchVar, 225 * pitchVar, 0.2, 'sawtooth', 0.16);
        break;
      case 'beam_clash':
        this.playNoise(0.12, 'bandpass', 1800 * pitchVar, 0.24, 2.2);
        this.playTone(620 * pitchVar, 880, 0.11, 'sawtooth', 0.18);
        break;
      case 'lightning':
        this.playNoise(0.09, 'highpass', 2200 * pitchVar, 0.2, 1.8);
        this.playTone(960 * pitchVar, 310, 0.09, 'sawtooth', 0.15);
        break;
      case 'spray':
        this.playNoise(0.11, 'bandpass', 950 * pitchVar, 0.12, 0.9);
        break;
      case 'slash':
        this.playNoise(0.16, 'bandpass', 1650 * pitchVar, 0.26, 1.4);
        this.playTone(540 * pitchVar, 210, 0.14, 'sawtooth', 0.18);
        break;
      case 'heal':
        this.playTone(440 * pitchVar, 660 * pitchVar, 0.14, 'sine', 0.18);
        this.playTone(660 * pitchVar, 880 * pitchVar, 0.14, 'sine', 0.14, 0.06);
        break;
      case 'cleanse':
        this.playNoise(0.14, 'bandpass', 1400 * pitchVar, 0.22);
        this.playTone(620 * pitchVar, 920, 0.14, 'triangle', 0.18);
        break;
      case 'ward':
        this.playTone(390 * pitchVar, 585, 0.18, 'triangle', 0.2);
        this.playTone(585 * pitchVar, 780, 0.18, 'sine', 0.14, 0.04);
        break;
      case 'shatter':
        this.playNoise(0.2, 'highpass', 2400, 0.34, 1.5);
        this.playTone(1450 * pitchVar, 520, 0.16, 'triangle', 0.26);
        this.playTone(980 * pitchVar, 320, 0.18, 'sine', 0.22, 0.03);
        break;
      case 'shield_block':
        this.playTone(720 * pitchVar, 420, 0.08, 'triangle', 0.2);
        break;
      case 'enemy_hit':
        this.playTone(260 * pitchVar, 140, 0.06, 'triangle', 0.14);
        break;
      case 'enemy_kill':
        this.playTone(180 * pitchVar, 55, 0.22, 'sawtooth', 0.26);
        this.playNoise(0.18, 'bandpass', 900, 0.26);
        break;
      case 'player_hit':
        this.playNoise(0.1, 'highpass', 1750, 0.44, 1.4);
        this.playTone(155, 34, 0.28, 'sine', 0.54);
        this.playTone(230, 58, 0.24, 'sawtooth', 0.4);
        this.playNoise(0.2, 'lowpass', 680, 0.36);
        this.playTone(860, 420, 0.08, 'square', 0.16);
        this.playTone(640, 310, 0.09, 'square', 0.14, 0.06);
        break;
      case 'wave_start':
        this.playTone(330, 440, 0.15, 'triangle', 0.22);
        this.playTone(440, 660, 0.22, 'triangle', 0.22, 0.1);
        break;
      case 'boss_spawn':
        this.playTone(110, 55, 0.45, 'sawtooth', 0.34);
        this.playTone(165, 82, 0.45, 'triangle', 0.28, 0.08);
        this.playNoise(0.38, 'lowpass', 480, 0.28);
        break;
      case 'augment_pick':
        this.playTone(523, 659, 0.12, 'triangle', 0.22);
        this.playTone(659, 784, 0.12, 'triangle', 0.22, 0.08);
        this.playTone(784, 1046, 0.2, 'sine', 0.24, 0.16);
        break;
      case 'game_over':
        this.playTone(330, 220, 0.22, 'sawtooth', 0.24);
        this.playTone(220, 110, 0.4, 'sawtooth', 0.26, 0.18);
        break;
    }
  }

  private playElementLayer(elements: readonly QueueElement[], pitchVar: number): void {
    const unique = [...new Set(elements)].slice(0, 3);
    for (let i = 0; i < unique.length; i++) {
      const el = unique[i]!;
      const delay = i * 0.02;
      switch (el) {
        case 'THERMAL':
          this.playNoise(0.16, 'lowpass', 720 * pitchVar, 0.22, 0.9, delay);
          this.playTone(240 * pitchVar, 130, 0.14, 'sawtooth', 0.12, delay);
          break;
        case 'FLUX':
          this.playTone(360 * pitchVar, 920 * pitchVar, 0.09, 'sine', 0.16, delay);
          this.playNoise(0.12, 'bandpass', 620 * pitchVar, 0.18, 2.4, delay + 0.02);
          break;
        case 'CRYO':
        case 'CRYSTAL':
          this.playTone(1480 * pitchVar, 2240 * pitchVar, 0.13, 'sine', 0.14, delay);
          this.playTone(2120 * pitchVar, 1860, 0.14, 'triangle', 0.09, delay + 0.03);
          break;
        case 'VOLT':
          this.playNoise(0.08, 'highpass', 2800 * pitchVar, 0.18, 2.0, delay);
          this.playTone(1180 * pitchVar, 420, 0.08, 'square', 0.1, delay);
          break;
        case 'VOID':
          this.playTone(86 * pitchVar, 46, 0.24, 'sawtooth', 0.22, delay);
          this.playTone(128 * pitchVar, 64, 0.22, 'triangle', 0.16, delay);
          break;
        case 'KINETIC':
          this.playTone(125 * pitchVar, 48, 0.18, 'triangle', 0.24, delay);
          this.playNoise(0.12, 'lowpass', 460, 0.2, 1.0, delay);
          break;
        case 'NANO':
          this.playTone(620 * pitchVar, 930 * pitchVar, 0.11, 'triangle', 0.14, delay);
          this.playTone(930 * pitchVar, 1240 * pitchVar, 0.11, 'sine', 0.12, delay + 0.04);
          break;
        case 'PLASMA':
          this.playNoise(0.15, 'highpass', 1850 * pitchVar, 0.2, 1.4, delay);
          this.playTone(340 * pitchVar, 740 * pitchVar, 0.14, 'sawtooth', 0.12, delay);
          break;
        case 'BARRIER':
          this.playTone(330 * pitchVar, 495 * pitchVar, 0.15, 'sine', 0.14, delay);
          break;
      }
    }
  }
}

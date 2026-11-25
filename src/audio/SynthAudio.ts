import { SfxId } from '../sim/types';

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
  private readonly lastPlayed = new Map<SfxId, number>();

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-16, ctx.currentTime);
    compressor.ratio.setValueAtTime(6, ctx.currentTime);

    const master = ctx.createGain();
    master.gain.setValueAtTime(this.muted ? 0 : 0.32, ctx.currentTime);
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
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.32, this.ctx.currentTime, 0.015);
    }
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

  public play(sound: SfxId, _colorHex?: number): void {
    if (this.muted) return;
    const nowMs = performance.now();
    const minCd = COOLDOWN_MS[sound] ?? 30;
    const prev = this.lastPlayed.get(sound) ?? 0;
    if (nowMs - prev < minCd) return;
    this.lastPlayed.set(sound, nowMs);

    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') return;

    switch (sound) {
      case 'queue':
        this.playTone(540, 740, 0.075, 'triangle', 0.22);
        break;
      case 'cancel':
        this.playTone(340, 170, 0.11, 'sawtooth', 0.2);
        break;
      case 'fusion':
        this.playTone(520, 780, 0.12, 'triangle', 0.24);
        this.playTone(780, 1180, 0.14, 'sine', 0.2, 0.05);
        break;
      case 'dash':
        this.playNoise(0.16, 'bandpass', 1100, 0.28, 1.5);
        this.playTone(460, 180, 0.14, 'sine', 0.2);
        break;
      case 'shield':
        this.playTone(280, 560, 0.18, 'sine', 0.26);
        this.playTone(420, 840, 0.16, 'triangle', 0.14, 0.03);
        break;
      case 'wall':
        this.playTone(150, 75, 0.2, 'triangle', 0.34);
        this.playNoise(0.14, 'lowpass', 520, 0.24);
        break;
      case 'mine_deploy':
        this.playTone(460, 620, 0.08, 'square', 0.14);
        this.playTone(620, 480, 0.08, 'sine', 0.16, 0.05);
        break;
      case 'mine_explode':
        this.playTone(130, 36, 0.34, 'sine', 0.48);
        this.playNoise(0.28, 'lowpass', 780, 0.42);
        break;
      case 'storm':
        this.playNoise(0.42, 'bandpass', 420, 0.28, 0.9);
        this.playTone(110, 62, 0.38, 'sawtooth', 0.18);
        break;
      case 'rock':
        this.playTone(155, 58, 0.24, 'triangle', 0.38);
        this.playNoise(0.18, 'lowpass', 640, 0.26);
        break;
      case 'icicle':
        this.playTone(1150, 1750, 0.09, 'sine', 0.2);
        this.playNoise(0.08, 'highpass', 2600, 0.16);
        break;
      case 'beam':
        this.playTone(185, 225, 0.22, 'sawtooth', 0.2);
        this.playTone(370, 390, 0.22, 'sine', 0.14);
        break;
      case 'beam_clash':
        this.playNoise(0.12, 'bandpass', 1800, 0.24, 2.2);
        this.playTone(620, 880, 0.11, 'sawtooth', 0.18);
        break;
      case 'lightning':
        this.playNoise(0.09, 'highpass', 2200, 0.26, 1.8);
        this.playTone(960, 310, 0.09, 'sawtooth', 0.2);
        break;
      case 'spray':
        this.playNoise(0.11, 'bandpass', 950, 0.18, 0.9);
        break;
      case 'slash':
        this.playNoise(0.16, 'bandpass', 1650, 0.3, 1.4);
        this.playTone(540, 210, 0.14, 'sawtooth', 0.22);
        break;
      case 'heal':
        this.playTone(440, 660, 0.14, 'sine', 0.18);
        this.playTone(660, 880, 0.14, 'sine', 0.14, 0.06);
        break;
      case 'cleanse':
        this.playNoise(0.14, 'bandpass', 1400, 0.22);
        this.playTone(620, 920, 0.14, 'triangle', 0.18);
        break;
      case 'ward':
        this.playTone(390, 585, 0.18, 'triangle', 0.22);
        this.playTone(585, 780, 0.18, 'sine', 0.16, 0.04);
        break;
      case 'shatter':
        this.playNoise(0.2, 'highpass', 2400, 0.34, 1.5);
        this.playTone(1450, 520, 0.16, 'triangle', 0.26);
        this.playTone(980, 320, 0.18, 'sine', 0.22, 0.03);
        break;
      case 'shield_block':
        this.playTone(720, 420, 0.08, 'triangle', 0.2);
        break;
      case 'enemy_hit':
        this.playTone(260, 140, 0.06, 'triangle', 0.14);
        break;
      case 'enemy_kill':
        this.playTone(180, 55, 0.22, 'sawtooth', 0.26);
        this.playNoise(0.18, 'bandpass', 900, 0.26);
        break;
      case 'player_hit':
        this.playTone(160, 48, 0.26, 'sawtooth', 0.36);
        this.playNoise(0.22, 'lowpass', 600, 0.34);
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
}

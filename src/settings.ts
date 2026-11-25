import { ControlPreset, DifficultyId, ShipId } from './sim/types';

export type ParticleQuality = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
export type ArtStyle = 'VECTOR_NEON' | 'WATERCOLOR_INK';

export interface GameSettings {
  muted: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  difficulty: DifficultyId;
  controlPreset: ControlPreset;
  cameraTilt: boolean;
  screenShake: number;
  damageNumbers: boolean;
  bloomIntensity: number;
  particleQuality: ParticleQuality;
  gridWarp: boolean;
  pixelRatioCap: 1 | 2;
  selectedShip: ShipId;
  artStyle: ArtStyle;
}

export const DEFAULT_SETTINGS: GameSettings = {
  muted: false,
  masterVolume: 0.85,
  musicVolume: 0.65,
  sfxVolume: 0.85,
  difficulty: 'VETERAN',
  controlPreset: 'CLASSIC',
  cameraTilt: true,
  screenShake: 1.0,
  damageNumbers: true,
  bloomIntensity: 1.0,
  particleQuality: 'HIGH',
  gridWarp: true,
  pixelRatioCap: 2,
  selectedShip: 'VANGUARD',
  artStyle: 'VECTOR_NEON',
};

const SETTINGS_KEY = 'vector-arcana-settings-v1';

function clamp01(v: unknown, fallback: number, max = 1): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : fallback;
}

export function loadSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<GameSettings>;
    return {
      muted: typeof p.muted === 'boolean' ? p.muted : DEFAULT_SETTINGS.muted,
      masterVolume: clamp01(p.masterVolume, DEFAULT_SETTINGS.masterVolume, 1),
      musicVolume: clamp01(p.musicVolume, DEFAULT_SETTINGS.musicVolume, 1),
      sfxVolume: clamp01(p.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 1),
      difficulty:
        p.difficulty === 'RECRUIT' || p.difficulty === 'VETERAN' || p.difficulty === 'OVERLORD'
          ? p.difficulty
          : DEFAULT_SETTINGS.difficulty,
      controlPreset:
        p.controlPreset === 'CLASSIC' || p.controlPreset === 'ARROWS_LMB'
          ? p.controlPreset
          : DEFAULT_SETTINGS.controlPreset,
      cameraTilt: typeof p.cameraTilt === 'boolean' ? p.cameraTilt : DEFAULT_SETTINGS.cameraTilt,
      screenShake: clamp01(p.screenShake, DEFAULT_SETTINGS.screenShake, 1),
      damageNumbers: typeof p.damageNumbers === 'boolean' ? p.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
      bloomIntensity: clamp01(p.bloomIntensity, DEFAULT_SETTINGS.bloomIntensity, 1.5),
      particleQuality:
        p.particleQuality === 'LOW' ||
        p.particleQuality === 'MEDIUM' ||
        p.particleQuality === 'HIGH' ||
        p.particleQuality === 'ULTRA'
          ? p.particleQuality
          : DEFAULT_SETTINGS.particleQuality,
      gridWarp: typeof p.gridWarp === 'boolean' ? p.gridWarp : DEFAULT_SETTINGS.gridWarp,
      pixelRatioCap: p.pixelRatioCap === 1 || p.pixelRatioCap === 2 ? p.pixelRatioCap : DEFAULT_SETTINGS.pixelRatioCap,
      selectedShip:
        p.selectedShip === 'VANGUARD' ||
        p.selectedShip === 'SPECTRE' ||
        p.selectedShip === 'TITAN' ||
        p.selectedShip === 'PRISM'
          ? p.selectedShip
          : DEFAULT_SETTINGS.selectedShip,
      artStyle:
        p.artStyle === 'VECTOR_NEON' || p.artStyle === 'WATERCOLOR_INK'
          ? p.artStyle
          : DEFAULT_SETTINGS.artStyle,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

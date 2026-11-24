export const FIXED_DT = 1 / 60;

export const ARENA_HALF_W = 560;
export const ARENA_HALF_H = 380;

export type BaseElement =
  | 'FLUX'
  | 'NANO'
  | 'AEGIS'
  | 'CRYO'
  | 'VOLT'
  | 'VOID'
  | 'KINETIC'
  | 'THERMAL';

export type SubElement = 'CRYSTAL' | 'PLASMA' | 'TOXIN';

export type QueueElement = BaseElement | SubElement;

export const BASE_ELEMENTS: readonly BaseElement[] = [
  'FLUX',
  'NANO',
  'AEGIS',
  'CRYO',
  'VOLT',
  'VOID',
  'KINETIC',
  'THERMAL',
] as const;

export interface ElementMeta {
  id: QueueElement;
  name: string;
  color: string;
  colorHex: number;
  hotkey: string;
  isSub: boolean;
}

export const ELEMENT_META: Record<QueueElement, ElementMeta> = {
  FLUX: { id: 'FLUX', name: 'Flux', color: '#00A8FF', colorHex: 0x00a8ff, hotkey: 'Q', isSub: false },
  NANO: { id: 'NANO', name: 'Nano', color: '#39FF14', colorHex: 0x39ff14, hotkey: 'W', isSub: false },
  AEGIS: { id: 'AEGIS', name: 'Aegis', color: '#00E676', colorHex: 0x00e676, hotkey: 'E', isSub: false },
  CRYO: { id: 'CRYO', name: 'Cryo', color: '#00FFFF', colorHex: 0x00ffff, hotkey: 'R', isSub: false },
  VOLT: { id: 'VOLT', name: 'Volt', color: '#FFEE00', colorHex: 0xffee00, hotkey: 'A', isSub: false },
  VOID: { id: 'VOID', name: 'Void', color: '#BD00FF', colorHex: 0xbd00ff, hotkey: 'S', isSub: false },
  KINETIC: { id: 'KINETIC', name: 'Kinetic', color: '#FF9E00', colorHex: 0xff9e00, hotkey: 'D', isSub: false },
  THERMAL: { id: 'THERMAL', name: 'Thermal', color: '#FF2A2A', colorHex: 0xff2a2a, hotkey: 'F', isSub: false },
  CRYSTAL: { id: 'CRYSTAL', name: 'Crystal', color: '#66FFFF', colorHex: 0x66ffff, hotkey: '', isSub: true },
  PLASMA: { id: 'PLASMA', name: 'Plasma', color: '#FF8866', colorHex: 0xff8866, hotkey: '', isSub: true },
  TOXIN: { id: 'TOXIN', name: 'Toxin', color: '#A8FF00', colorHex: 0xa8ff00, hotkey: '', isSub: true },
};

export type DeliveryType =
  | 'SHIELD'
  | 'WALL'
  | 'MINES'
  | 'STORM'
  | 'ROCK_THROW'
  | 'ICICLE_VOLLEY'
  | 'BEAM'
  | 'LIGHTNING_BOLT'
  | 'SPRAY'
  | 'PHASE_SLASH';

export type CastMode = 'FORWARD' | 'NOVA' | 'SELF' | 'DASH';
export type ControlPreset = 'CLASSIC' | 'ARROWS_LMB';
export type OverflowMode = 'FIFO' | 'IGNORE';

export type StatusType = 'PRIMED' | 'CHILLED' | 'FROZEN' | 'IGNITED' | 'CORRUPTED';

export interface StatusInstance {
  type: StatusType;
  remaining: number;
  stacks: number;
  potency: number;
}

export type EnemyArchetype =
  | 'SWARMER'
  | 'BASTION'
  | 'STALKER'
  | 'WEAVER'
  | 'SPLITTER'
  | 'WARDEN';

export type AugmentId =
  | 'SUPERCONDUCTOR'
  | 'PERMAFROST_DETONATION'
  | 'PRISM_REFRACTION'
  | 'TECTONIC_MINES'
  | 'OVERCLOCKED_QUEUE'
  | 'SINGULARITY_PULL';

export interface AugmentDef {
  id: AugmentId;
  name: string;
  tag: string;
  color: string;
  description: string;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimAngle: number;
  hp: number;
  maxHp: number;
  wardRemaining: number;
  wardMaxDuration: number;
  wardElement: QueueElement | null;
  queue: QueueElement[];
  dashCooldown: number;
  dashTimer: number;
  dashDirX: number;
  dashDirY: number;
  invulnTimer: number;
  castCooldown: number;
  overclockTimer: number;
  overclockMax: number;
  ignitedTimer: number;
  toxinTimer: number;
  moving: boolean;
}

export interface EnemyEntity {
  id: number;
  archetype: EnemyArchetype;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  shieldHp: number;
  maxShieldHp: number;
  armor: number;
  baseArmor: number;
  shieldAngle: number;
  shieldArc: number;
  hasFrontShield: boolean;
  bossShieldAngles: number[];
  aiState: 'SEEK' | 'CHARGE' | 'FIRE' | 'TELEPORT_WINDUP' | 'COOLDOWN';
  aiTimer: number;
  beamAngle: number;
  statuses: Partial<Record<StatusType, StatusInstance>>;
  hitFlash: number;
}

export interface ProjectileEntity {
  id: number;
  owner: 'PLAYER' | 'ENEMY';
  kind: 'ROCK' | 'ICICLE' | 'FROST_NEEDLE' | 'SHATTER_SHARD';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierce: number;
  life: number;
  maxLife: number;
  colorHex: number;
  elements: QueueElement[];
  hitIds: number[];
  spin: number;
}

export interface BeamEntity {
  id: number;
  owner: 'PLAYER' | 'ENEMY';
  ownerEnemyId?: number;
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  damagePerSec: number;
  life: number;
  maxLife: number;
  colorHex: number;
  elements: QueueElement[];
  clashing: boolean;
  clashDist: number;
  refracted?: boolean;
}

export interface WallPylonEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  life: number;
  maxLife: number;
  colorHex: number;
  elements: QueueElement[];
}

export interface MineEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  triggerRadius: number;
  blastRadius: number;
  damage: number;
  armTimer: number;
  life: number;
  colorHex: number;
  elements: QueueElement[];
}

export interface StormEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  tickTimer: number;
  colorHex: number;
  elements: QueueElement[];
}

export interface ShieldBarrierEntity {
  id: number;
  x: number;
  y: number;
  angle: number;
  arc: number;
  radius: number;
  hp: number;
  maxHp: number;
  life: number;
  maxLife: number;
  isNova: boolean;
  colorHex: number;
}

export interface PoolEntity {
  id: number;
  kind: 'FLUX' | 'PLASMA' | 'TOXIN';
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  colorHex: number;
  tickTimer: number;
}

export interface SlashArcEntity {
  id: number;
  x: number;
  y: number;
  angle: number;
  arc: number;
  radius: number;
  life: number;
  maxLife: number;
  colorHex: number;
}

export interface SimInput {
  moveX: number;
  moveY: number;
  moveToCursor: boolean;
  aimX: number;
  aimY: number;
  queuedElements: BaseElement[];
  castAction: CastMode | null;
  dashPressed: boolean;
}

export type SfxId =
  | 'queue'
  | 'cancel'
  | 'fusion'
  | 'dash'
  | 'shield'
  | 'wall'
  | 'mine_deploy'
  | 'mine_explode'
  | 'storm'
  | 'rock'
  | 'icicle'
  | 'beam'
  | 'beam_clash'
  | 'lightning'
  | 'spray'
  | 'slash'
  | 'heal'
  | 'cleanse'
  | 'ward'
  | 'shatter'
  | 'shield_block'
  | 'enemy_hit'
  | 'enemy_kill'
  | 'player_hit'
  | 'wave_start'
  | 'boss_spawn'
  | 'augment_pick'
  | 'game_over';

export type SimEvent =
  | { type: 'grid_impulse'; x: number; y: number; strength: number; radius: number }
  | { type: 'grid_well'; x: number; y: number; strength: number; radius: number }
  | { type: 'hit_stop'; duration: number }
  | { type: 'screen_shake'; intensity: number }
  | { type: 'sfx'; sound: SfxId; colorHex?: number }
  | { type: 'vfx_burst'; x: number; y: number; colorHex: number; count: number; radius: number }
  | { type: 'vfx_lightning'; points: Array<{ x: number; y: number }>; colorHex: number }
  | { type: 'vfx_shatter'; x: number; y: number; colorHex: number }
  | { type: 'vfx_spray'; x: number; y: number; angle: number; spread: number; range: number; colorHex: number; isNova: boolean }
  | { type: 'beam_clash'; x: number; y: number; colorHex: number }
  | { type: 'wave_start'; wave: number; isBoss: boolean }
  | { type: 'augment_offer'; choices: AugmentDef[] }
  | { type: 'game_over'; score: number; wave: number };

export interface SimSnapshot {
  phase: 'TITLE' | 'PLAYING' | 'PAUSED' | 'AUGMENT_CHOICE' | 'GAME_OVER';
  tick: number;
  wave: number;
  score: number;
  multiplier: number;
  multiplierTimer: number;
  player: PlayerState;
  enemies: readonly EnemyEntity[];
  projectiles: readonly ProjectileEntity[];
  beams: readonly BeamEntity[];
  walls: readonly WallPylonEntity[];
  mines: readonly MineEntity[];
  storms: readonly StormEntity[];
  shields: readonly ShieldBarrierEntity[];
  pools: readonly PoolEntity[];
  slashes: readonly SlashArcEntity[];
  augments: Partial<Record<AugmentId, number>>;
  pendingAugments: AugmentDef[];
  boss: { name: string; hp: number; maxHp: number } | null;
}

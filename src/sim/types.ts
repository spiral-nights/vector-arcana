export const FIXED_DT = 1 / 60;

export const ARENA_HALF_W = 1100;
export const ARENA_HALF_H = 750;

export type BaseElement =
  | 'FLUX'
  | 'NANO'
  | 'BARRIER'
  | 'CRYO'
  | 'VOLT'
  | 'VOID'
  | 'KINETIC'
  | 'THERMAL';

export type SubElement = 'CRYSTAL' | 'PLASMA';

export type QueueElement = BaseElement | SubElement;

export const BASE_ELEMENTS: readonly BaseElement[] = [
  'FLUX',
  'NANO',
  'BARRIER',
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
  FLUX: { id: 'FLUX', name: 'Flux', color: '#1A6BFF', colorHex: 0x1a6bff, hotkey: 'Q', isSub: false },
  NANO: { id: 'NANO', name: 'Nano', color: '#39FF14', colorHex: 0x39ff14, hotkey: 'W', isSub: false },
  BARRIER: { id: 'BARRIER', name: 'Barrier', color: '#E6F0FF', colorHex: 0xe6f0ff, hotkey: 'E', isSub: false },
  CRYO: { id: 'CRYO', name: 'Cryo', color: '#00F5FF', colorHex: 0x00f5ff, hotkey: 'R', isSub: false },
  VOLT: { id: 'VOLT', name: 'Volt', color: '#FFF733', colorHex: 0xfff733, hotkey: 'A', isSub: false },
  VOID: { id: 'VOID', name: 'Void', color: '#B429FF', colorHex: 0xb429ff, hotkey: 'S', isSub: false },
  KINETIC: { id: 'KINETIC', name: 'Kinetic', color: '#E8741A', colorHex: 0xe8741a, hotkey: 'D', isSub: false },
  THERMAL: { id: 'THERMAL', name: 'Thermal', color: '#FF1E2D', colorHex: 0xff1e2d, hotkey: 'F', isSub: false },
  CRYSTAL: { id: 'CRYSTAL', name: 'Crystal', color: '#80FFFF', colorHex: 0x80ffff, hotkey: '', isSub: true },
  PLASMA: { id: 'PLASMA', name: 'Plasma', color: '#FF5E99', colorHex: 0xff5e99, hotkey: '', isSub: true },
};

export interface ElementComposition {
  counts: Partial<Record<QueueElement, number>>;
  ratios: Partial<Record<QueueElement, number>>;
  totalPower: number;
  colors: number[];
  weightedColors: number[];
  primaryColorHex: number;
  secondaryColorHex: number;
}

export interface ChannelState {
  delivery: 'SPRAY' | 'BEAM' | 'LIGHTNING_BOLT' | 'SELF_HEAL';
  elements: QueueElement[];
  composition: ElementComposition;
  remaining: number;
  maxDuration: number;
  tickTimer: number;
  beamId: number | null;
}

export interface ChargeState {
  delivery: 'ROCK_THROW' | 'CRYSTAL_SHARDS';
  elements: QueueElement[];
  composition: ElementComposition;
  stackPower: number;
  elapsed: number;
  maxCharge: number;
  ratio: number;
}

export type DeliveryType =
  | 'SHIELD'
  | 'WALL'
  | 'MINES'
  | 'STORM'
  | 'ROCK_THROW'
  | 'CRYSTAL_SHARDS'
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
  armorHp: number;
  maxArmorHp: number;
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
  moving: boolean;
  moveTarget: { x: number; y: number } | null;
  channel: ChannelState | null;
  charge: ChargeState | null;
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
  colors: number[];
  elements: QueueElement[];
  composition: ElementComposition;
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
  colors: number[];
  elements: QueueElement[];
  composition: ElementComposition;
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
  pulseTimer: number;
  colorHex: number;
  colors: number[];
  elements: QueueElement[];
  composition: ElementComposition;
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
  colors: number[];
  elements: QueueElement[];
  composition: ElementComposition;
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
  colors: number[];
  elements: QueueElement[];
  composition: ElementComposition;
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
  colors: number[];
}

export interface PoolEntity {
  id: number;
  kind: 'FLUX' | 'PLASMA';
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
  colors: number[];
}

export interface ArenaPillar {
  id: number;
  x: number;
  y: number;
  radius: number;
  sides: number;
}

export interface SpawnRiftEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  timer: number;
  maxTimer: number;
  archetypes: EnemyArchetype[];
}

export interface HazardZoneEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  timer: number;
  maxTimer: number;
  damage: number;
  colorHex: number;
}

export interface SectorGate {
  open: boolean;
  x: number;
  y: number;
  radius: number;
}

export interface SimInput {
  moveX: number;
  moveY: number;
  moveToCursor: boolean;
  moveClickTarget: { x: number; y: number } | null;
  aimX: number;
  aimY: number;
  queuedElements: BaseElement[];
  castAction: CastMode | null;
  castHeld: boolean;
  selfHeld: boolean;
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
  | { type: 'vfx_shards'; x: number; y: number; colors: number[]; count: number; speedScale?: number }
  | { type: 'vfx_ring'; x: number; y: number; radius: number; colorHex: number; duration?: number }
  | { type: 'vfx_storm_strike'; x: number; y: number; colorHex: number; secondaryColorHex: number; radius: number }
  | { type: 'vfx_lightning'; points: Array<{ x: number; y: number }>; colors: number[] }
  | { type: 'vfx_shatter'; x: number; y: number; colorHex: number }
  | { type: 'vfx_spray'; x: number; y: number; angle: number; spread: number; range: number; colors: number[]; isNova: boolean }
  | { type: 'beam_clash'; x: number; y: number; colorHex: number }
  | { type: 'wave_start'; wave: number; isBoss: boolean }
  | { type: 'gate_open'; wave: number }
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
  pillars: readonly ArenaPillar[];
  rifts: readonly SpawnRiftEntity[];
  hazards: readonly HazardZoneEntity[];
  gate: SectorGate;
  augments: Partial<Record<AugmentId, number>>;
  pendingAugments: AugmentDef[];
  boss: { name: string; hp: number; maxHp: number } | null;
}

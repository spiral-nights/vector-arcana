import { DifficultyConfig, DifficultyId, ShipDef, ShipId } from './types';

export const SHIP_CATALOG: readonly ShipDef[] = [
  {
    id: 'VANGUARD',
    name: 'Vanguard MK-IV',
    role: 'BALANCED INTERCEPTOR',
    color: '#00F5FF',
    colorHex: 0x00f5ff,
    maxHp: 100,
    startArmor: 0,
    speedMult: 1.0,
    damageMult: 1.0,
    dashCooldownMult: 1.0,
    channelDurMult: 1.0,
    description: 'Standard delta chassis with balanced thrusters, hull integrity, and arcane output.',
  },
  {
    id: 'SPECTRE',
    name: 'Spectre Wraith',
    role: 'HIGH-SPEED ASSASSIN',
    color: '#C044FF',
    colorHex: 0xc044ff,
    maxHp: 80,
    startArmor: 0,
    speedMult: 1.22,
    damageMult: 1.08,
    dashCooldownMult: 0.72,
    channelDurMult: 0.95,
    description: '+22% move speed, -28% Phase Dash cooldown, +8% spell damage, lighter 80 HP hull.',
  },
  {
    id: 'TITAN',
    name: 'Titan Bastion',
    role: 'ARMORED JUGGERNAUT',
    color: '#FF9E2C',
    colorHex: 0xff9e2c,
    maxHp: 140,
    startArmor: 35,
    speedMult: 0.88,
    damageMult: 1.0,
    dashCooldownMult: 1.15,
    channelDurMult: 1.15,
    description: '140 Max Hull & +35 starting Kinetic Armor restored each sector; heavier thruster frame.',
  },
  {
    id: 'PRISM',
    name: 'Prism Conduit',
    role: 'ARTILLERY RESONATOR',
    color: '#39FF9E',
    colorHex: 0x39ff9e,
    maxHp: 90,
    startArmor: 0,
    speedMult: 1.04,
    damageMult: 1.18,
    dashCooldownMult: 0.95,
    channelDurMult: 1.25,
    description: '+18% spell damage & +25% beam/spray channel duration; crystalline 90 HP core.',
  },
] as const;

export function getShipDef(id: ShipId): ShipDef {
  return SHIP_CATALOG.find((s) => s.id === id) ?? SHIP_CATALOG[0]!;
}

export const DIFFICULTY_CATALOG: Record<DifficultyId, DifficultyConfig> = {
  RECRUIT: {
    id: 'RECRUIT',
    label: 'RECRUIT',
    enemyHpMult: 0.75,
    enemyDamageMult: 0.72,
    enemySpeedMult: 0.88,
    scoreMult: 0.85,
  },
  VETERAN: {
    id: 'VETERAN',
    label: 'VETERAN',
    enemyHpMult: 1.0,
    enemyDamageMult: 1.0,
    enemySpeedMult: 1.0,
    scoreMult: 1.0,
  },
  OVERLORD: {
    id: 'OVERLORD',
    label: 'OVERLORD',
    enemyHpMult: 1.35,
    enemyDamageMult: 1.35,
    enemySpeedMult: 1.14,
    scoreMult: 1.5,
  },
};

export function getDifficultyConfig(id: DifficultyId): DifficultyConfig {
  return DIFFICULTY_CATALOG[id] ?? DIFFICULTY_CATALOG.VETERAN;
}

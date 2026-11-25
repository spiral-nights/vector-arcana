import { AugmentDef, AugmentId } from './types';

export const AUGMENT_CATALOG: readonly AugmentDef[] = [
  {
    id: 'SUPERCONDUCTOR',
    tag: 'VOLT',
    name: 'Superconductor',
    color: '#FFF733',
    description: 'Volt chains gain +20% range, jump to +3 additional targets, and arc through your deployed Mines.',
    maxStacks: 2,
  },
  {
    id: 'PERMAFROST_DETONATION',
    tag: 'CRYO + KINETIC',
    name: 'Permafrost Detonation',
    color: '#00F5FF',
    description: 'Shattering a Frozen enemy blasts nearby foes for 75% of its max HP as frost AoE.',
    maxStacks: 2,
  },
  {
    id: 'PRISM_REFRACTION',
    tag: 'BARRIER',
    name: 'Prism Refraction',
    color: '#E6F0FF',
    description: 'Channeling any Beam through your Barrier Shield splits it into 3 diverging beams.',
    maxStacks: 1,
  },
  {
    id: 'TECTONIC_MINES',
    tag: 'WALL',
    name: 'Tectonic Mines',
    color: '#A86B3E',
    description: 'Destroyed or expired Wall pylons convert into armed proximity Mines.',
    maxStacks: 1,
  },
  {
    id: 'OVERCLOCKED_QUEUE',
    tag: 'CORE',
    name: 'Overclocked Queue',
    color: '#39FF14',
    description: 'Casting a 3-unique-element spell grants +25% move speed & +20% cast rate for 3s.',
    maxStacks: 2,
  },
  {
    id: 'SINGULARITY_PULL',
    tag: 'VOID',
    name: 'Singularity Pull',
    color: '#FF2438',
    description: 'Void beams are +25% wider and Void beams & detonations strongly pull nearby enemies inward.',
    maxStacks: 2,
  },
  {
    id: 'THERMAL_CONFLAGRATION',
    tag: 'THERMAL',
    name: 'Thermal Conflagration',
    color: '#FF6A00',
    description: 'Thermal sprays reach +20% farther/wider; Ignited foes burn +45% harder and erupt on death in a 145px blast.',
    maxStacks: 2,
  },
  {
    id: 'CRYO_SHARD_BARRAGE',
    tag: 'CRYSTAL',
    name: 'Cryo Shard Barrage',
    color: '#80FFFF',
    description: 'Crystal Shards gain +2 extra piercing shards, +15% size & +25% speed; Cryo sprays reach +20% farther/wider.',
    maxStacks: 2,
  },
  {
    id: 'KINETIC_AFTERSHOCK',
    tag: 'KINETIC',
    name: 'Kinetic Aftershock',
    color: '#A86B3E',
    description: 'Kinetic Rocks are +25% larger, gain +35% blast radius & +25% damage, and shatter Bastion shields on splash.',
    maxStacks: 2,
  },
  {
    id: 'NANO_SWARM_SIPHON',
    tag: 'NANO',
    name: 'Nano Swarm Siphon',
    color: '#39FF14',
    description: 'Nano kill-heals restore +5 extra HP (+10 on Boss) and spawn 2 homing Nano Bolts on kill.',
    maxStacks: 2,
  },
  {
    id: 'FLUX_TIDAL_SURGE',
    tag: 'FLUX',
    name: 'Flux Tidal Surge',
    color: '#1A6BFF',
    description: 'Flux sprays, novas & splashes gain +35% range/radius, +30% cone width & +40% pushback; Primed foes take +20% damage.',
    maxStacks: 2,
  },
  {
    id: 'SANCTUARY_PULSE',
    tag: 'BARRIER',
    name: 'Sanctuary Pulse',
    color: '#E6F0FF',
    description: 'Shields & Sanctuary Domes gain +45% HP, +20% size, and emit a 155px knockback shockwave on deploy & break.',
    maxStacks: 2,
  },
  {
    id: 'MINEFIELD_SATURATION',
    tag: 'MINES',
    name: 'Minefield Saturation',
    color: '#FFB833',
    description: 'Max active Mines +4, Mine size & blast radius +35%, and Mines arm 40% faster.',
    maxStacks: 2,
  },
  {
    id: 'TEMPEST_CAPACITOR',
    tag: 'STORM',
    name: 'Tempest Capacitor',
    color: '#66D9FF',
    description: 'Storms last +35% longer, cover +35% wider radius & strikes, and pulse 25% faster.',
    maxStacks: 2,
  },
  {
    id: 'PHASE_RESONANCE',
    tag: 'MOBILITY',
    name: 'Phase Resonance',
    color: '#C044FF',
    description: 'Phase Dash cooldown -28%, Phase Slash radius +35%, and dashing grants +15 Kinetic Armor.',
    maxStacks: 2,
  },
  {
    id: 'PLASMA_OVERDRIVE',
    tag: 'PLASMA',
    name: 'Plasma Overdrive',
    color: '#FF5E99',
    description: 'Plasma spells deal +30% damage, grow +25% larger/wider, and sear Ignited enemies to cut armor by 50%.',
    maxStacks: 2,
  },
  {
    id: 'WEAKPOINT_ANALYZER',
    tag: 'TACTICAL',
    name: 'Weakpoint Analyzer',
    color: '#FFEE44',
    description: 'Elemental weakness multiplier rises from 1.75x to 2.15x (+0.4x/rank), plus +12% dmg vs Bosses.',
    maxStacks: 2,
  },
  {
    id: 'ARCANE_CAPACITOR',
    tag: 'CORE',
    name: 'Arcane Capacitor',
    color: '#00F5FF',
    description: 'Channel durations (Beams, Sprays, Lightning) +35% and Rock/Shard charge speed +35%.',
    maxStacks: 2,
  },
  {
    id: 'HULL_REINFORCEMENT',
    tag: 'DEFENSE',
    name: 'Hull Reinforcement',
    color: '#39FF9E',
    description: 'Gain +30 Max Hull & repair 30 HP immediately; take 20% less damage below 40% Hull.',
    maxStacks: 2,
  },
  {
    id: 'CHAIN_REACTOR',
    tag: 'COMBO',
    name: 'Chain Reactor',
    color: '#FFF733',
    description: 'Overload AoE radius +45% & damage +50%; Shatter fires +4 extra piercing Crystal Shards.',
    maxStacks: 2,
  },
] as const;

export function getAugmentDef(id: AugmentId): AugmentDef {
  const found = AUGMENT_CATALOG.find((a) => a.id === id);
  return found ?? AUGMENT_CATALOG[0]!;
}

export function getAugmentStacks(
  augments: Partial<Record<AugmentId, number>>,
  id: AugmentId
): number {
  return augments[id] ?? 0;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export function rollAugmentChoices(
  rng: () => number = Math.random,
  count = 3,
  owned: Partial<Record<AugmentId, number>> = {},
  recentlyOffered: readonly AugmentId[] = []
): AugmentDef[] {
  const recentSet = new Set(recentlyOffered);
  const eligible = AUGMENT_CATALOG.filter((a) => (owned[a.id] ?? 0) < a.maxStacks);
  const pool = eligible.length >= count ? eligible : [...AUGMENT_CATALOG];

  const tier1: AugmentDef[] = [];
  const tier2: AugmentDef[] = [];
  const tier3: AugmentDef[] = [];

  for (const aug of pool) {
    const stacks = owned[aug.id] ?? 0;
    const wasRecent = recentSet.has(aug.id);
    if (stacks === 0 && !wasRecent) {
      tier1.push(aug);
    } else if (!wasRecent || stacks === 0) {
      tier2.push(aug);
    } else {
      tier3.push(aug);
    }
  }

  shuffleInPlace(tier1, rng);
  shuffleInPlace(tier2, rng);
  shuffleInPlace(tier3, rng);

  const ordered = [...tier1, ...tier2, ...tier3];
  return ordered.slice(0, Math.max(0, Math.min(count, ordered.length)));
}

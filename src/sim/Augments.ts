import { AugmentDef, AugmentId } from './types';

export const AUGMENT_CATALOG: readonly AugmentDef[] = [
  {
    id: 'SUPERCONDUCTOR',
    tag: 'VOLT',
    name: 'Superconductor',
    color: '#FFF733',
    description: 'Volt chains jump to +3 additional targets and arc through your deployed Mines.',
  },
  {
    id: 'PERMAFROST_DETONATION',
    tag: 'CRYO + KINETIC',
    name: 'Permafrost Detonation',
    color: '#00F5FF',
    description: 'Shattering a Frozen enemy blasts nearby foes for 75% of its max HP as frost AoE.',
  },
  {
    id: 'PRISM_REFRACTION',
    tag: 'BARRIER',
    name: 'Prism Refraction',
    color: '#E6F0FF',
    description: 'Channeling any Beam through your Barrier Shield splits it into 3 diverging beams.',
  },
  {
    id: 'TECTONIC_MINES',
    tag: 'WALL',
    name: 'Tectonic Mines',
    color: '#A86B3E',
    description: 'Destroyed or expired Wall pylons convert into armed proximity Mines.',
  },
  {
    id: 'OVERCLOCKED_QUEUE',
    tag: 'CORE',
    name: 'Overclocked Queue',
    color: '#39FF14',
    description: 'Casting a 3-unique-element spell grants +25% move speed & +20% cast rate for 3s.',
  },
  {
    id: 'SINGULARITY_PULL',
    tag: 'VOID',
    name: 'Singularity Pull',
    color: '#FF2438',
    description: 'Void beams and detonations strongly pull nearby enemies inward.',
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

export function rollAugmentChoices(rng: () => number = Math.random, count = 3): AugmentDef[] {
  const pool = [...AUGMENT_CATALOG];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

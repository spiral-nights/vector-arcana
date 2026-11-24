import {
  BaseElement,
  CastMode,
  DeliveryType,
  ELEMENT_META,
  ElementComposition,
  OverflowMode,
  QueueElement,
  SubElement,
} from './types';

export const MAX_QUEUE_SIZE = 3;

const CANCELLATION_MAP: Record<BaseElement, readonly BaseElement[]> = {
  THERMAL: ['CRYO'],
  CRYO: ['THERMAL'],
  FLUX: ['VOLT'],
  VOLT: ['FLUX', 'KINETIC', 'AEGIS'],
  KINETIC: ['VOLT'],
  AEGIS: ['VOLT'],
  VOID: ['NANO'],
  NANO: ['VOID'],
};

interface FusionRecipe {
  a: BaseElement;
  b: BaseElement;
  result: SubElement;
}

const FUSION_RECIPES: readonly FusionRecipe[] = [
  { a: 'FLUX', b: 'CRYO', result: 'CRYSTAL' },
  { a: 'FLUX', b: 'THERMAL', result: 'PLASMA' },
  { a: 'FLUX', b: 'VOID', result: 'TOXIN' },
];

export type EnqueueAction =
  | 'added'
  | 'cancelled'
  | 'fused'
  | 'ignored_aegis_cap'
  | 'overflow_fifo'
  | 'overflow_ignored';

export interface EnqueueResult {
  queue: QueueElement[];
  action: EnqueueAction;
  cancelledElement?: BaseElement;
  fusedElement?: SubElement;
}

export function enqueueElement(
  current: readonly QueueElement[],
  next: BaseElement,
  overflow: OverflowMode = 'FIFO'
): EnqueueResult {
  const queue = [...current];

  // 1. Opposite element cancellation (1-for-1 against base elements only)
  const opposites = CANCELLATION_MAP[next];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if ((opposites as readonly QueueElement[]).includes(item)) {
      queue.splice(i, 1);
      return {
        queue,
        action: 'cancelled',
        cancelledElement: item as BaseElement,
      };
    }
  }

  // 2. Self-limit: max 1 AEGIS in queue
  if (next === 'AEGIS' && queue.includes('AEGIS')) {
    return {
      queue,
      action: 'ignored_aegis_cap',
    };
  }

  // 3. Sub-element fusion (in-place replacement against compatible base element)
  for (const recipe of FUSION_RECIPES) {
    const partner = next === recipe.a ? recipe.b : next === recipe.b ? recipe.a : null;
    if (partner) {
      const idx = queue.indexOf(partner);
      if (idx !== -1) {
        queue[idx] = recipe.result;
        return {
          queue,
          action: 'fused',
          fusedElement: recipe.result,
        };
      }
    }
  }

  // 4. Queue capacity check
  if (queue.length >= MAX_QUEUE_SIZE) {
    if (overflow === 'IGNORE') {
      return { queue, action: 'overflow_ignored' };
    }
    queue.shift();
    queue.push(next);
    return { queue, action: 'overflow_fifo' };
  }

  queue.push(next);
  return { queue, action: 'added' };
}

export function computeComposition(elements: readonly QueueElement[]): ElementComposition {
  const counts: Partial<Record<QueueElement, number>> = {};
  const ratios: Partial<Record<QueueElement, number>> = {};
  const totalPower = elements.length;
  const weightedColors: number[] = [];
  const colors: number[] = [];

  for (const el of elements) {
    counts[el] = (counts[el] ?? 0) + 1;
    const hex = ELEMENT_META[el].colorHex;
    weightedColors.push(hex);
    if (!colors.includes(hex)) {
      colors.push(hex);
    }
  }

  if (totalPower > 0) {
    for (const key of Object.keys(counts) as QueueElement[]) {
      ratios[key] = (counts[key] ?? 0) / totalPower;
    }
  }

  const nonAegis = elements.find((e) => e !== 'AEGIS');
  const primaryColorHex = nonAegis
    ? ELEMENT_META[nonAegis].colorHex
    : elements[0]
    ? ELEMENT_META[elements[0]].colorHex
    : 0x00f5ff;

  const secondaryColorHex =
    colors.find((c) => c !== primaryColorHex) ?? primaryColorHex;

  return {
    counts,
    ratios,
    totalPower,
    colors: colors.length > 0 ? colors : [0x00f5ff],
    weightedColors: weightedColors.length > 0 ? weightedColors : [0x00f5ff],
    primaryColorHex,
    secondaryColorHex,
  };
}

export type SelfEffectType = 'HEAL' | 'CLEANSE' | 'WARD' | 'NONE';

export interface ResolvedSelfCast {
  effect: SelfEffectType;
  healPower: number;
  wardElement: QueueElement | null;
  colorHex: number;
}

export interface ResolvedSpell {
  delivery: DeliveryType;
  isNova: boolean;
  isChannelable: boolean;
  isChargeable: boolean;
  elements: QueueElement[];
  composition: ElementComposition;
  primaryColorHex: number;
  stackPower: number;
  uniqueCount: number;
  hasAegisTrail: boolean;
}

export function resolveSelfCast(queue: readonly QueueElement[]): ResolvedSelfCast {
  if (queue.length === 0) {
    return { effect: 'NONE', healPower: 0, wardElement: null, colorHex: 0x00f5ff };
  }
  const comp = computeComposition(queue);
  if (queue.includes('AEGIS')) {
    const payload = queue.find((e) => e !== 'AEGIS') ?? null;
    const colorHex = payload ? ELEMENT_META[payload].colorHex : ELEMENT_META.AEGIS.colorHex;
    return { effect: 'WARD', healPower: 0, wardElement: payload, colorHex };
  }
  if (queue.includes('NANO')) {
    const nanoStacks = comp.counts.NANO ?? 1;
    return {
      effect: 'HEAL',
      healPower: nanoStacks * 22,
      wardElement: null,
      colorHex: ELEMENT_META.NANO.colorHex,
    };
  }
  if (queue.includes('FLUX')) {
    return {
      effect: 'CLEANSE',
      healPower: 0,
      wardElement: null,
      colorHex: ELEMENT_META.FLUX.colorHex,
    };
  }
  return { effect: 'NONE', healPower: 0, wardElement: null, colorHex: comp.primaryColorHex };
}

export function resolveSpell(
  queue: readonly QueueElement[],
  castMode: CastMode
): ResolvedSpell | null {
  if (castMode === 'DASH') {
    if (queue.length === 0) return null;
    const composition = computeComposition(queue);
    return {
      delivery: 'PHASE_SLASH',
      isNova: false,
      isChannelable: false,
      isChargeable: false,
      elements: [...queue],
      composition,
      primaryColorHex: composition.primaryColorHex,
      stackPower: queue.length,
      uniqueCount: new Set(queue).size,
      hasAegisTrail: queue.includes('AEGIS'),
    };
  }

  if (queue.length === 0 || castMode === 'SELF') {
    return null;
  }

  const isNova = castMode === 'NOVA';
  const has = (el: QueueElement): boolean => queue.includes(el);
  const hasAny = (...els: QueueElement[]): boolean => els.some((e) => queue.includes(e));
  const uniqueCount = new Set(queue).size;
  const composition = computeComposition(queue);

  let delivery: DeliveryType | null = null;
  let stackPower = queue.length;

  // Strict Top-to-Bottom 10-Spell Priority Table
  if (queue.length === 1 && has('AEGIS')) {
    delivery = 'SHIELD';
  } else if (has('AEGIS') && hasAny('KINETIC', 'CRYSTAL')) {
    delivery = 'WALL';
  } else if (has('AEGIS') && hasAny('VOID', 'NANO', 'TOXIN')) {
    delivery = 'MINES';
  } else if (has('AEGIS') && hasAny('THERMAL', 'CRYO', 'FLUX', 'PLASMA')) {
    delivery = 'STORM';
  } else if (has('KINETIC')) {
    delivery = 'ROCK_THROW';
    stackPower = composition.counts.KINETIC ?? 1;
  } else if (has('CRYSTAL')) {
    delivery = 'ICICLE_VOLLEY';
  } else if (hasAny('VOID', 'NANO')) {
    delivery = 'BEAM';
  } else if (has('VOLT')) {
    delivery = 'LIGHTNING_BOLT';
    stackPower = composition.counts.VOLT ?? 1;
  } else if (hasAny('THERMAL', 'CRYO', 'FLUX', 'PLASMA', 'TOXIN')) {
    delivery = 'SPRAY';
  }

  if (!delivery) return null;

  const isChannelable =
    !isNova && (delivery === 'SPRAY' || delivery === 'BEAM' || delivery === 'LIGHTNING_BOLT');
  const isChargeable =
    !isNova && (delivery === 'ROCK_THROW' || delivery === 'ICICLE_VOLLEY');

  return {
    delivery,
    isNova,
    isChannelable,
    isChargeable,
    elements: [...queue],
    composition,
    primaryColorHex: composition.primaryColorHex,
    stackPower,
    uniqueCount,
    hasAegisTrail: has('AEGIS'),
  };
}

export function formatSpellPreview(
  queue: readonly QueueElement[],
  castMode: CastMode = 'FORWARD'
): string {
  if (queue.length === 0) return 'EMPTY';
  const comp = computeComposition(queue);
  const parts: string[] = [];
  for (const el of Object.keys(comp.counts) as QueueElement[]) {
    const count = comp.counts[el] ?? 0;
    const name = ELEMENT_META[el].name.toUpperCase();
    parts.push(count > 1 ? `${count}× ${name}` : name);
  }
  const resolved = resolveSpell(queue, castMode);
  if (!resolved) return parts.join(' + ');
  const label = resolved.delivery.replace('_', ' ');
  return `${parts.join(' + ')} → ${label}`;
}

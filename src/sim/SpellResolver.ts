import {
  BaseElement,
  CastMode,
  DeliveryType,
  ELEMENT_META,
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
  elements: QueueElement[];
  primaryColorHex: number;
  stackPower: number;
  uniqueCount: number;
  hasAegisTrail: boolean;
}

function getPrimaryColorHex(elements: readonly QueueElement[]): number {
  if (elements.length === 0) return 0x00ffff;
  const nonAegis = elements.find((e) => e !== 'AEGIS') ?? elements[0]!;
  return ELEMENT_META[nonAegis].colorHex;
}

export function resolveSelfCast(queue: readonly QueueElement[]): ResolvedSelfCast {
  if (queue.length === 0) {
    return { effect: 'NONE', healPower: 0, wardElement: null, colorHex: 0x00ffff };
  }
  if (queue.includes('AEGIS')) {
    const payload = queue.find((e) => e !== 'AEGIS') ?? null;
    const colorHex = payload ? ELEMENT_META[payload].colorHex : ELEMENT_META.AEGIS.colorHex;
    return { effect: 'WARD', healPower: 0, wardElement: payload, colorHex };
  }
  if (queue.includes('NANO')) {
    const nanoStacks = queue.filter((e) => e === 'NANO').length;
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
  return { effect: 'NONE', healPower: 0, wardElement: null, colorHex: getPrimaryColorHex(queue) };
}

export function resolveSpell(
  queue: readonly QueueElement[],
  castMode: CastMode
): ResolvedSpell | null {
  if (castMode === 'DASH') {
    if (queue.length === 0) return null;
    return {
      delivery: 'PHASE_SLASH',
      isNova: false,
      elements: [...queue],
      primaryColorHex: getPrimaryColorHex(queue),
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

  let delivery: DeliveryType | null = null;
  let stackPower = queue.length;

  // Strict Top-to-Bottom 10-Spell Priority Table
  if (queue.length === 1 && has('AEGIS')) {
    // 1. Shield (Barrier)
    delivery = 'SHIELD';
  } else if (has('AEGIS') && hasAny('KINETIC', 'CRYSTAL')) {
    // 2. Wall
    delivery = 'WALL';
  } else if (has('AEGIS') && hasAny('VOID', 'NANO', 'TOXIN')) {
    // 3. Mines
    delivery = 'MINES';
  } else if (has('AEGIS') && hasAny('THERMAL', 'CRYO', 'FLUX', 'PLASMA')) {
    // 4. Storm (never contains KINETIC or VOLT)
    delivery = 'STORM';
  } else if (has('KINETIC')) {
    // 5. Rock Throw
    delivery = 'ROCK_THROW';
    stackPower = queue.filter((e) => e === 'KINETIC').length;
  } else if (has('CRYSTAL')) {
    // 6. Icicle Volley
    delivery = 'ICICLE_VOLLEY';
  } else if (hasAny('VOID', 'NANO')) {
    // 7. Beam
    delivery = 'BEAM';
  } else if (has('VOLT')) {
    // 8. Lightning Bolt
    delivery = 'LIGHTNING_BOLT';
    stackPower = queue.filter((e) => e === 'VOLT').length;
  } else if (hasAny('THERMAL', 'CRYO', 'FLUX', 'PLASMA', 'TOXIN')) {
    // 9. Spray
    delivery = 'SPRAY';
  }

  if (!delivery) return null;

  return {
    delivery,
    isNova,
    elements: [...queue],
    primaryColorHex: getPrimaryColorHex(queue),
    stackPower,
    uniqueCount,
    hasAegisTrail: has('AEGIS'),
  };
}

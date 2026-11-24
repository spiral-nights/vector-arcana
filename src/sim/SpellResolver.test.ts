import { describe, expect, it } from 'vitest';
import { computeComposition, enqueueElement, formatSpellPreview, resolveSelfCast, resolveSpell } from './SpellResolver';
import { ELEMENT_META, QueueElement } from './types';

function buildQueue(els: Parameters<typeof enqueueElement>[1][]): QueueElement[] {
  let q: QueueElement[] = [];
  for (const e of els) {
    q = enqueueElement(q, e).queue;
  }
  return q;
}

describe('SpellResolver — Cancellations', () => {
  it('cancels all 4 opposite pairs 1-for-1 in both directions (and does not cancel BARRIER + VOLT)', () => {
    const pairs: Array<[Parameters<typeof enqueueElement>[1], Parameters<typeof enqueueElement>[1]]> = [
      ['THERMAL', 'CRYO'],
      ['FLUX', 'VOLT'],
      ['KINETIC', 'VOLT'],
      ['VOID', 'NANO'],
    ];

    for (const [a, b] of pairs) {
      const r1 = enqueueElement([a], b);
      expect(r1.action).toBe('cancelled');
      expect(r1.queue).toEqual([]);

      const r2 = enqueueElement([b], a);
      expect(r2.action).toBe('cancelled');
      expect(r2.queue).toEqual([]);
    }

    expect(buildQueue(['BARRIER', 'VOLT'])).toEqual(['BARRIER', 'VOLT']);
  });

  it('enforces max 1 BARRIER in queue', () => {
    const r = enqueueElement(['BARRIER', 'THERMAL'], 'BARRIER');
    expect(r.action).toBe('ignored_barrier_cap');
    expect(r.queue).toEqual(['BARRIER', 'THERMAL']);
  });

  it('supports FIFO overflow by default and IGNORE overflow optionally', () => {
    const fifo = enqueueElement(['THERMAL', 'THERMAL', 'KINETIC'], 'VOID', 'FIFO');
    expect(fifo.action).toBe('overflow_fifo');
    expect(fifo.queue).toEqual(['THERMAL', 'KINETIC', 'VOID']);

    const ignored = enqueueElement(['THERMAL', 'THERMAL', 'KINETIC'], 'VOID', 'IGNORE');
    expect(ignored.action).toBe('overflow_ignored');
    expect(ignored.queue).toEqual(['THERMAL', 'THERMAL', 'KINETIC']);
  });
});

describe('SpellResolver — Sub-Element Fusion', () => {
  it('fuses FLUX + CRYO -> CRYSTAL in both orders', () => {
    expect(buildQueue(['FLUX', 'CRYO'])).toEqual(['CRYSTAL']);
    expect(buildQueue(['CRYO', 'FLUX'])).toEqual(['CRYSTAL']);
  });

  it('fuses FLUX + THERMAL -> PLASMA and allows PLASMA + VOLT without cancellation', () => {
    const q = buildQueue(['FLUX', 'THERMAL', 'VOLT']);
    expect(q).toEqual(['PLASMA', 'VOLT']);
    const spell = resolveSpell(q, 'FORWARD');
    expect(spell?.delivery).toBe('LIGHTNING_BOLT');
  });

  it('fuses FLUX + VOID -> TOXIN and frees slot for 2 more elements', () => {
    const q = buildQueue(['FLUX', 'VOID', 'KINETIC', 'THERMAL']);
    expect(q).toEqual(['TOXIN', 'KINETIC', 'THERMAL']);
  });
});

describe('SpellResolver — 10-Spell Priority Table', () => {
  it('1. Shield when [BARRIER] alone', () => {
    expect(resolveSpell(['BARRIER'], 'FORWARD')?.delivery).toBe('SHIELD');
  });

  it('2. Wall when BARRIER + (KINETIC or CRYSTAL), even if THERMAL is present', () => {
    expect(resolveSpell(['BARRIER', 'KINETIC', 'THERMAL'], 'FORWARD')?.delivery).toBe('WALL');
    expect(resolveSpell(['BARRIER', 'CRYSTAL'], 'FORWARD')?.delivery).toBe('WALL');
  });

  it('3. Mines when BARRIER + (VOID | NANO | TOXIN)', () => {
    expect(resolveSpell(['BARRIER', 'VOID'], 'FORWARD')?.delivery).toBe('MINES');
    expect(resolveSpell(['BARRIER', 'NANO'], 'FORWARD')?.delivery).toBe('MINES');
    expect(resolveSpell(['BARRIER', 'TOXIN'], 'FORWARD')?.delivery).toBe('MINES');
  });

  it('4. Storm when BARRIER + (THERMAL | CRYO | VOLT | FLUX | PLASMA), never containing KINETIC', () => {
    expect(resolveSpell(['BARRIER', 'THERMAL'], 'FORWARD')?.delivery).toBe('STORM');
    expect(resolveSpell(['BARRIER', 'CRYO'], 'FORWARD')?.delivery).toBe('STORM');
    expect(resolveSpell(['BARRIER', 'VOLT'], 'FORWARD')?.delivery).toBe('STORM');
    expect(resolveSpell(['BARRIER', 'FLUX'], 'FORWARD')?.delivery).toBe('STORM');
    expect(resolveSpell(['BARRIER', 'PLASMA'], 'FORWARD')?.delivery).toBe('STORM');

    const mixedStorm = resolveSpell(['VOLT', 'THERMAL', 'BARRIER'], 'FORWARD');
    expect(mixedStorm?.delivery).toBe('STORM');
    expect(mixedStorm?.composition.colors).toContain(ELEMENT_META.BARRIER.colorHex);
    expect(mixedStorm?.composition.colors).toContain(ELEMENT_META.VOLT.colorHex);
    expect(mixedStorm?.composition.colors).toContain(ELEMENT_META.THERMAL.colorHex);
  });

  it('5. Rock Throw when KINETIC without BARRIER', () => {
    const spell = resolveSpell(['KINETIC', 'KINETIC', 'THERMAL'], 'FORWARD');
    expect(spell?.delivery).toBe('ROCK_THROW');
    expect(spell?.stackPower).toBe(2);
  });

  it('6. Icicle Volley when CRYSTAL without BARRIER/KINETIC', () => {
    expect(resolveSpell(['CRYSTAL', 'VOID'], 'FORWARD')?.delivery).toBe('ICICLE_VOLLEY');
  });

  it('7. Beam when (VOID | NANO) without higher priority', () => {
    expect(resolveSpell(['VOID', 'THERMAL'], 'FORWARD')?.delivery).toBe('BEAM');
    expect(resolveSpell(['NANO', 'PLASMA'], 'FORWARD')?.delivery).toBe('BEAM');
  });

  it('8. Lightning Bolt when VOLT without higher priority', () => {
    expect(resolveSpell(['VOLT', 'THERMAL'], 'FORWARD')?.delivery).toBe('LIGHTNING_BOLT');
  });

  it('9. Spray for THERMAL/CRYO/FLUX/PLASMA/TOXIN alone', () => {
    for (const el of ['THERMAL', 'CRYO', 'FLUX', 'PLASMA', 'TOXIN'] as const) {
      expect(resolveSpell([el], 'FORWARD')?.delivery).toBe('SPRAY');
    }
  });

  it('10. Phase Slash on DASH with any queued elements', () => {
    const spell = resolveSpell(['BARRIER', 'THERMAL'], 'DASH');
    expect(spell?.delivery).toBe('PHASE_SLASH');
    expect(spell?.hasBarrierTrail).toBe(true);
  });

  it('marks Nova casts properly', () => {
    const spell = resolveSpell(['THERMAL'], 'NOVA');
    expect(spell?.delivery).toBe('SPRAY');
    expect(spell?.isNova).toBe(true);
  });
});

describe('SpellResolver — Self Cast', () => {
  it('resolves NANO heal, FLUX cleanse, and BARRIER + Element ward', () => {
    expect(resolveSelfCast(['NANO', 'NANO']).effect).toBe('HEAL');
    expect(resolveSelfCast(['NANO', 'NANO']).healPower).toBe(44);
    expect(resolveSelfCast(['FLUX']).effect).toBe('CLEANSE');
    const ward = resolveSelfCast(['BARRIER', 'THERMAL']);
    expect(ward.effect).toBe('WARD');
    expect(ward.wardElement).toBe('THERMAL');
  });
});

describe('SpellResolver — Composition Ratios, Colors & Channeling', () => {
  it('computes accurate element counts and ratios for mixed queues', () => {
    const fluxHeavy = computeComposition(['FLUX', 'FLUX', 'KINETIC']);
    expect(fluxHeavy.counts.FLUX).toBe(2);
    expect(fluxHeavy.counts.KINETIC).toBe(1);
    expect(fluxHeavy.ratios.FLUX).toBeCloseTo(2 / 3);
    expect(fluxHeavy.ratios.KINETIC).toBeCloseTo(1 / 3);

    const kineticHeavy = computeComposition(['KINETIC', 'KINETIC', 'FLUX']);
    expect(kineticHeavy.ratios.KINETIC).toBeCloseTo(2 / 3);
    expect(kineticHeavy.ratios.FLUX).toBeCloseTo(1 / 3);
  });

  it('preserves both element colors for multi-element spells like BARRIER + CRYO', () => {
    const comp = computeComposition(['BARRIER', 'CRYO']);
    expect(comp.colors).toContain(ELEMENT_META.BARRIER.colorHex);
    expect(comp.colors).toContain(ELEMENT_META.CRYO.colorHex);
    expect(comp.primaryColorHex).toBe(ELEMENT_META.CRYO.colorHex);
    expect(comp.secondaryColorHex).toBe(ELEMENT_META.BARRIER.colorHex);
  });

  it('marks FORWARD SPRAY, BEAM, and LIGHTNING_BOLT as channelable, but not NOVA or discrete spells', () => {
    expect(resolveSpell(['THERMAL'], 'FORWARD')?.isChannelable).toBe(true);
    expect(resolveSpell(['VOID'], 'FORWARD')?.isChannelable).toBe(true);
    expect(resolveSpell(['VOLT'], 'FORWARD')?.isChannelable).toBe(true);

    expect(resolveSpell(['THERMAL'], 'NOVA')?.isChannelable).toBe(false);
    expect(resolveSpell(['KINETIC'], 'FORWARD')?.isChannelable).toBe(false);
    expect(resolveSpell(['BARRIER', 'FLUX'], 'FORWARD')?.isChannelable).toBe(false);
    expect(resolveSpell(['BARRIER'], 'FORWARD')?.isChannelable).toBe(false);
  });

  it('marks FORWARD ROCK_THROW and ICICLE_VOLLEY as chargeable, but not NOVA', () => {
    expect(resolveSpell(['KINETIC'], 'FORWARD')?.isChargeable).toBe(true);
    expect(resolveSpell(['CRYSTAL'], 'FORWARD')?.isChargeable).toBe(true);
    expect(resolveSpell(['KINETIC'], 'NOVA')?.isChargeable).toBe(false);
    expect(resolveSpell(['CRYSTAL'], 'NOVA')?.isChargeable).toBe(false);
    expect(resolveSpell(['THERMAL'], 'FORWARD')?.isChargeable).toBe(false);
  });

  it('formats spell preview with counts and resolved delivery', () => {
    expect(formatSpellPreview(['FLUX', 'FLUX', 'KINETIC'])).toBe('2× FLUX + KINETIC → ROCK THROW');
    expect(formatSpellPreview(['BARRIER', 'CRYO'])).toBe('BARRIER + CRYO → STORM');
  });
});

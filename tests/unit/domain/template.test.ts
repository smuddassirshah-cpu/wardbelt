// Decision notes: the belt shape is a contract other stages read, so the list itself is
// asserted here rather than only through the patients built from it.
import { describe, expect, it } from 'vitest';
import {
  CHECK_KEYS,
  PHASE_LABELS,
  TEMPLATE,
  TEMPLATE_BY_KEY,
  customCode,
} from '../../../src/domain/template';
import { PHASES, RETIRED_STEP_KEYS } from '../../../src/domain/types';

describe('TEMPLATE', () => {
  it('is eighteen steps with unique keys and codes and no retired step', () => {
    expect(TEMPLATE).toHaveLength(18);
    expect(new Set(TEMPLATE.map((s) => s.key)).size).toBe(18);
    expect(new Set(TEMPLATE.map((s) => s.code)).size).toBe(18);
    for (const retired of RETIRED_STEP_KEYS) {
      expect(TEMPLATE.some((s) => (s.key as string) === retired)).toBe(false);
      expect(Object.hasOwn(TEMPLATE_BY_KEY, retired)).toBe(false);
    }
    for (const step of TEMPLATE) {
      expect(TEMPLATE_BY_KEY[step.key]).toBe(step);
      expect(PHASES).toContain(step.phase);
      expect(step.code).toHaveLength(2);
      expect(PHASE_LABELS[step.phase]).not.toBe('');
    }
  });

  it('keeps the phases in run order and the checks inside recovery', () => {
    const order = TEMPLATE.map((s) => PHASES.indexOf(s.phase));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const key of CHECK_KEYS) {
      expect(TEMPLATE_BY_KEY[key].phase).toBe('RECOVERY');
    }
  });
});

describe('customCode', () => {
  it('takes the first two alphanumerics upper-cased and pads a short label', () => {
    expect(customCode('bandage check')).toBe('BA');
    expect(customCode('  x-ray')).toBe('XR');
    expect(customCode('4th dose')).toBe('4T');
    expect(customCode('a')).toBe('A+');
    expect(customCode('')).toBe('++');
    expect(customCode('!!!')).toBe('++');
  });
});

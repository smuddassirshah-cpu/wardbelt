import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { TEMPLATE, TEMPLATE_BY_KEY, customCode } from '../../src/domain/template';
import { templateTaskId } from '../../src/domain/types';
import { allFixturePatients } from '../fixtures/synthetic';

describe('scaffold', () => {
  it('renders the app name', () => {
    render(<h1>Wardbelt</h1>);
    expect(screen.getByRole('heading', { name: 'Wardbelt' })).toBeTruthy();
  });

  it('template has nineteen steps with unique two-letter codes', () => {
    expect(TEMPLATE).toHaveLength(19);
    const codes = new Set(TEMPLATE.map((s) => s.code));
    expect(codes.size).toBe(19);
    for (const s of TEMPLATE) {
      expect(s.code).toMatch(/^[A-Z0-9]{2}$/);
      expect(TEMPLATE_BY_KEY[s.key]).toBe(s);
    }
    expect(templateTaskId('p', 'check_1')).toBe('p:check_1');
  });

  it('custom codes are always two characters', () => {
    expect(customCode('Bandage check')).toBe('BA');
    expect(customCode('x')).toBe('X+');
    expect(customCode('')).toBe('++');
  });

  it('fixtures are well formed', () => {
    for (const p of allFixturePatients()) {
      expect(p.tasks.length).toBeGreaterThanOrEqual(19);
      p.tasks.forEach((t, i) => {
        expect(t.order).toBe(i);
      });
    }
  });
});

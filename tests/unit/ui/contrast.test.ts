// Decision notes: parses tokens.css with node:fs and computes WCAG 2.x contrast with the
// relative luminance formula written here, so the palette is checked against the binding
// PLAN.md literals rather than against whatever the stylesheet happens to say. The light
// warning literal is 3.5:1 on the background, so it is held to the 3:1 non-text floor and the
// warning text token to 4.5:1; every other colour is held to 4.5:1 against both surfaces.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/ui/tokens.css'), 'utf8');

type Palette = Record<string, string>;

function block(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  throw new Error(`unterminated block for ${selector}`);
}

function palette(body: string): Palette {
  const out: Palette = {};
  for (const m of body.matchAll(/--(colour-[a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) {
      out[name] = value.trim().toLowerCase();
    }
  }
  return out;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (ch) => ch + ch) : h;
  const n = parseInt(full, 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const light = palette(block(css, ':root {'));
const darkMedia = palette(block(css, ":root:not([data-theme='light'])"));
const darkForced = palette(block(css, ":root[data-theme='dark']"));

function get(p: Palette, name: string): string {
  const v = p[name];
  expect(v, name).toBeDefined();
  return v ?? '';
}

describe('tokens.css palette', () => {
  it('light values equal the PLAN.md literals', () => {
    expect(get(light, 'colour-bg')).toBe('#fafaf9');
    expect(get(light, 'colour-surface')).toBe('#ffffff');
    expect(get(light, 'colour-ink')).toBe('#111111');
    expect(get(light, 'colour-ink-muted')).toBe('#6b6b6b');
    expect(get(light, 'colour-hairline').replace(/\s/g, '')).toBe('rgba(17,17,17,0.15)');
    expect(get(light, 'colour-accent')).toBe('#0f6e56');
    expect(get(light, 'colour-warning')).toBe('#b7791f');
    expect(get(light, 'colour-danger')).toBe('#b42318');
    expect(get(light, 'colour-on-accent')).toBe('#ffffff');
  });

  it('dark values equal the PLAN.md literals and both dark blocks agree', () => {
    expect(get(darkForced, 'colour-bg')).toBe('#121212');
    expect(get(darkForced, 'colour-surface')).toBe('#1a1a1a');
    expect(get(darkForced, 'colour-ink')).toBe('#f2f2f2');
    expect(get(darkForced, 'colour-ink-muted')).toBe('#9a9a9a');
    expect(get(darkForced, 'colour-on-accent')).toBe('#121212');
    expect(darkMedia).toEqual(darkForced);
  });

  for (const [label, p] of [
    ['light', light],
    ['dark', darkForced],
  ] as const) {
    describe(`${label} theme`, () => {
      const bg = get(p, 'colour-bg');
      const surface = get(p, 'colour-surface');

      it.each([
        'colour-ink',
        'colour-ink-muted',
        'colour-accent',
        'colour-danger',
        'colour-warning-text',
      ])('%s is at least 4.5:1 against background and surface', (name) => {
        const c = get(p, name);
        expect(contrast(c, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c, surface)).toBeGreaterThanOrEqual(4.5);
      });

      it('warning is at least 3:1 (non-text) against background and surface', () => {
        const c = get(p, 'colour-warning');
        expect(contrast(c, bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(c, surface)).toBeGreaterThanOrEqual(3);
      });

      it('on-accent glyph is at least 4.5:1 against accent', () => {
        expect(
          contrast(get(p, 'colour-on-accent'), get(p, 'colour-accent')),
        ).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it('dark warning text can be the warning colour itself because it passes 4.5:1', () => {
    expect(get(darkForced, 'colour-warning-text')).toBe(get(darkForced, 'colour-warning'));
    expect(contrast(get(darkForced, 'colour-warning'), '#1a1a1a')).toBeGreaterThanOrEqual(4.5);
  });

  it('documents that the light warning literal cannot carry text at 4.5:1', () => {
    expect(contrast('#b7791f', '#fafaf9')).toBeLessThan(4.5);
    expect(contrast('#ffffff', get(darkForced, 'colour-accent'))).toBeLessThan(4.5);
  });

  it('every motion token is 400 ms or under and zeroed under reduced motion', () => {
    const root = block(css, ':root {');
    const durations = [...root.matchAll(/--motion-[a-z-]+:\s*(\d+)ms/g)].map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThanOrEqual(4);
    for (const d of durations.filter((x) => x !== 2000)) {
      expect(d).toBeLessThanOrEqual(400);
    }
    const reduced = block(css, '@media (prefers-reduced-motion: reduce)');
    for (const m of reduced.matchAll(/--motion-[a-z-]+:\s*(\d+)ms/g)) {
      expect(Number(m[1])).toBe(0);
    }
  });
});

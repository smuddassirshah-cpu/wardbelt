// Decision notes: tokens.css is the only place a colour literal may appear (PLAN.md section 3).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '../../../src/ui');
const files = readdirSync(dir).filter(
  (f) => (f.endsWith('.css') || f.endsWith('.tsx') || f.endsWith('.ts')) && f !== 'tokens.css',
);

describe('no literal colours outside tokens.css', () => {
  it('scans every other file under src/ui', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s has no hex or rgb() literal', (file) => {
    const text = readFileSync(resolve(dir, file), 'utf8');
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/rgba?\(/i);
    expect(text).not.toMatch(/hsla?\(/i);
  });
});

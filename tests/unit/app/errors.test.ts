import { describe, expect, it } from 'vitest';
import { describeError } from '../../../src/ui/app/errors';

describe('describeError', () => {
  it('describes strings, errors, DOMExceptions and name-only or message-only objects', () => {
    expect(describeError('plain')).toBe('plain');
    expect(describeError(new Error('boom'))).toBe('Error: boom');
    expect(describeError(new DOMException('full', 'QuotaExceededError'))).toBe(
      'QuotaExceededError: full',
    );
    expect(describeError({ name: 'OnlyName' })).toBe('OnlyName');
    expect(describeError({ message: 'only message' })).toBe('only message');
    expect(describeError({ name: 'X', message: 42 })).toBe('X');
  });

  it('falls back for empty strings, null, numbers and empty objects', () => {
    expect(describeError('')).toBe('Unknown error');
    expect(describeError(null)).toBe('Unknown error');
    expect(describeError(7)).toBe('Unknown error');
    expect(describeError({})).toBe('Unknown error');
    expect(describeError({ name: '', message: '' })).toBe('Unknown error');
  });
});

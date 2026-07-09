import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('multiple string classnames birleştirir', () => {
    expect(cn('p-4', 'text-sm')).toBe('p-4 text-sm');
  });

  it('falsy değerleri eler', () => {
    expect(cn('p-4', false, null, undefined, 'text-sm')).toBe('p-4 text-sm');
  });

  it('tailwind çakışmasında son tanım kazanır (twMerge)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('koşullu obje formu destekler', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });

  it('array form düz birleşir', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c');
  });
});

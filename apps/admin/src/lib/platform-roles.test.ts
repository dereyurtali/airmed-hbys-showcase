import { describe, expect, it } from 'vitest';
import { canImpersonate, canMutate } from './platform-roles';

describe('canMutate', () => {
  it('owner + engineer may mutate', () => {
    expect(canMutate('platform_owner')).toBe(true);
    expect(canMutate('platform_engineer')).toBe(true);
  });
  it('support may NOT mutate (read + impersonate only)', () => {
    expect(canMutate('platform_support')).toBe(false);
  });
});

describe('canImpersonate', () => {
  it('all three platform roles may impersonate (audited)', () => {
    expect(canImpersonate('platform_owner')).toBe(true);
    expect(canImpersonate('platform_engineer')).toBe(true);
    expect(canImpersonate('platform_support')).toBe(true);
  });
});

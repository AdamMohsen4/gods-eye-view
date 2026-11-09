import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GEV_MIT_NOTICE } from './notices.ts';

describe('God’s Eye View MIT notice', () => {
  it('matches the MIT part of /LICENSE', () => {
    const lic = readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8').split('\n---')[0]!.trim();
    expect(GEV_MIT_NOTICE).toBe(lic);
  });
});

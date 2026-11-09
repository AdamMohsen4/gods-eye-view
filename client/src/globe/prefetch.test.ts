import { describe, expect, it } from 'vitest';
import { tileUrls, tileXY } from './prefetch.ts';

describe('tile prefetch', () => {
  it('computes Web Mercator tiles', () => {
    expect(tileXY({ lat: 0, lon: 0 }, 1)).toEqual({ x: 1, y: 1 });
    expect(tileXY({ lat: 85, lon: -180 }, 3)).toEqual({ x: 0, y: 0 });
  });
  it('builds a 3×3 block per zoom, wrapping the antimeridian', () => {
    const urls = tileUrls({ lat: 10, lon: 179.9 }, [4]);
    expect(urls).toHaveLength(9);
    expect(urls.some((u) => u.endsWith('/0'))).toBe(true);
  });
});

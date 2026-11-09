import { describe, expect, it } from 'vitest';
import { haversineKm } from '@earthnow/shared';
import { clampFov, clampPitch, leash, renderScale, revealHeightM, revealView, MAX_PITCH, MIN_PITCH, ROUND_LIMITS } from './view.ts';

describe('globe view helpers', () => {
  it('clamps fov and pitch', () => {
    expect(clampFov(5)).toBe(18);
    expect(clampFov(200)).toBe(75);
    expect(clampFov(NaN)).toBe(60);
    expect(clampPitch(-10)).toBe(MIN_PITCH);
    expect(clampPitch(10)).toBe(MAX_PITCH);
  });
  it('caps render scale at 1.5', () => {
    expect(renderScale(3)).toBe(1.5);
    expect(renderScale(1)).toBe(1);
    expect(renderScale(0)).toBe(1);
  });
  it('frames the reveal', () => {
    expect(revealHeightM(null, { lat: 0, lon: 0 })).toBe(3_000_000);
    expect(revealHeightM({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 })).toBe(600_000);
    expect(revealHeightM({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBe(14_000_000);
  });
  it('centres the reveal between pin and truth, shifted south on phones', () => {
    const wide = revealView({ lat: 0, lon: 0 }, { lat: 0, lon: 20 }, false);
    expect(wide.lat).toBeCloseTo(0, 5);
    expect(wide.lon).toBeGreaterThan(10);
    const compact = revealView({ lat: 0, lon: 0 }, { lat: 0, lon: 20 }, true);
    expect(compact.lat).toBeLessThan(-1);
    expect(revealView(null, { lat: 5, lon: 6 }, true).height).toBe(3_000_000);
  });
});

describe('round leash', () => {
  it('leaves the camera alone inside the leash', () => {
    expect(leash({ lat: 10, lon: 10 }, { lat: 10.5, lon: 10 }, 100)).toBeNull();
  });
  it('pulls a stray camera back onto the circle', () => {
    const anchor = { lat: 60, lon: 20 };
    const back = leash(anchor, { lat: 70, lon: 20 }, 150)!;
    expect(haversineKm(anchor, back)).toBeCloseTo(150, 3);
  });
  it('never allows a whole-globe view', () => {
    for (const l of Object.values(ROUND_LIMITS)) expect(l.maxHeightM).toBeLessThanOrEqual(200_000);
  });
});

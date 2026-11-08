import { describe, expect, it } from 'vitest';
import {
  MIN_DISPLACEMENT_KM,
  ROUND_TYPES,
  buildPose,
  buildShareText,
  cameraGeo,
  dailyNumber,
  destination,
  ecefToGeodetic,
  geodeticToEcef,
  haversineKm,
  isoWeek,
  scoreRound,
  subjectGeo,
} from './index.ts';

describe('geo', () => {
  it('haversine matches known distance (Stockholm–Oslo ≈ 417 km)', () => {
    expect(haversineKm({ lat: 59.3293, lon: 18.0686 }, { lat: 59.9139, lon: 10.7522 })).toBeCloseTo(417, -1);
  });
  it('destination is consistent with haversine', () => {
    const p = destination({ lat: 10, lon: 170 }, 77, 1234);
    expect(haversineKm({ lat: 10, lon: 170 }, p)).toBeCloseTo(1234, 3);
    expect(p.lon).toBeLessThanOrEqual(180);
  });
  it('ECEF round-trips', () => {
    const g = ecefToGeodetic(geodeticToEcef({ lat: -33.9, lon: 151.2 }, 11000));
    expect(g.lat).toBeCloseTo(-33.9, 6);
    expect(g.lon).toBeCloseTo(151.2, 6);
    expect(g.heightM).toBeCloseTo(11000, 1);
  });
});

describe('scoring', () => {
  it('perfect guess without clues is 5000', () => {
    expect(scoreRound('flight', 0, 0)).toBe(5000);
  });
  it('applies distance decay and clue penalty', () => {
    expect(scoreRound('quake', 1000, 0)).toBe(Math.round(5000 * Math.exp(-1)));
    expect(scoreRound('quake', 0, 3)).toBe(3500);
    expect(scoreRound('quake', 0, 9)).toBe(3500);
  });
  it('no guess scores 0', () => {
    expect(scoreRound('fire', null, 0)).toBe(0);
  });
});

describe('camera poses never pinpoint the truth', () => {
  const truth = { lat: 52.1, lon: 4.9 };
  for (const type of ROUND_TYPES) {
    it(type, () => {
      for (let i = 0; i < 50; i++) {
        const alt = type === 'flight' ? 11000 : type === 'satellite' ? 420_000 : 0;
        const pose = buildPose({ type, truth, altitudeM: alt, headingDeg: 45, seed: `s${i}` });
        const cam = cameraGeo(pose.camera);
        const sub = subjectGeo(pose.camera, pose.subject);
        expect(haversineKm(truth, cam)).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_KM);
        expect(haversineKm(truth, sub)).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_KM);
        // The subject reconstructs to the anchor (within a few metres).
        expect(haversineKm(pose.anchor, sub)).toBeLessThan(0.05);
      }
    });
  }
  it('is deterministic for a seed', () => {
    const a = buildPose({ type: 'quake', truth, altitudeM: 0, seed: 'x' });
    const b = buildPose({ type: 'quake', truth, altitudeM: 0, seed: 'x' });
    expect(a).toEqual(b);
  });
});

describe('share text', () => {
  it('is spoiler-free and formatted', () => {
    const text = buildShareText(
      142,
      [
        { type: 'flight', score: 4800 },
        { type: 'satellite', score: 2000 },
        { type: 'fire', score: 100 },
        { type: 'quake', score: 5000 },
        { type: 'flight', score: 3600 },
      ],
      'https://earthnow.example/d/142',
    );
    expect(text.split('\n')[0]).toBe('Earthnow #142 · 15,500 🌍');
    expect(text).toContain('✈️ 🟩');
    expect(text).toContain('🔥 🟥');
    expect(text).not.toMatch(/\d+\.\d+/);
  });
});

describe('dates', () => {
  it('numbers dailies from the epoch', () => {
    expect(dailyNumber('2026-11-01')).toBe(1);
    expect(dailyNumber('2026-11-09')).toBe(9);
  });
  it('iso week', () => {
    expect(isoWeek('2026-11-09')).toBe('2026-W46');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
});

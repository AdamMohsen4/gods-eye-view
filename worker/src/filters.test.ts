import { describe, expect, it } from 'vitest';
import { readFixture } from './env.ts';
import {
  CRUISE,
  clusterFires,
  filterAircraft,
  filterFire,
  filterQuake,
  filterSatellite,
  setPrivacyBlocklist,
} from './filters.ts';
import type { AdsbxAircraft } from './providers/flyitalyadsb.ts';
import { parseUsgs, type Quake } from './providers/usgs.ts';
import { parseFirms, type FireDetection } from './providers/firms.ts';
import { fetchSatellites } from './providers/celestrak.ts';

type FixtureAircraft = AdsbxAircraft & { _fixture_expect?: string; note?: string };
const fixture = JSON.parse(readFixture('flyitalyadsb/world.json')).ac as FixtureAircraft[];

const airliner: AdsbxAircraft = {
  hex: '4ca7b4', flight: 'EIN123  ', t: 'A20N', category: 'A3', dbFlags: 0, alt_baro: 36000, gs: 450,
  track: 90, baro_rate: 0, squawk: '2341', emergency: 'none', lat: 53, lon: -10, seen_pos: 1,
};

describe('aircraft filter (fixtures)', () => {
  const rejects = fixture.filter((a) => a._fixture_expect === 'reject');
  const accepts = fixture.filter((a) => a._fixture_expect !== 'reject');
  it.each(rejects.map((a) => [a.note, a] as const))('rejects %s', (_note, a) => {
    expect(filterAircraft(a).ok).toBe(false);
  });
  it('accepts every plain airliner in cruise', () => {
    expect(accepts.length).toBeGreaterThan(20);
    for (const a of accepts) expect(filterAircraft(a), a.flight).toEqual({ ok: true });
  });
});

describe('aircraft filter (rules)', () => {
  const v = (patch: Partial<AdsbxAircraft>) => filterAircraft({ ...airliner, ...patch });
  it('baseline airliner passes', () => expect(v({}).ok).toBe(true));
  it('rejects each privacy dbFlag', () => {
    for (const flag of [1, 4, 8, 1 | 8]) expect(v({ dbFlags: flag }).ok).toBe(false);
  });
  it('rejects the local privacy blocklist', () => {
    setPrivacyBlocklist(['4CA7B4']);
    expect(v({}).ok).toBe(false);
    setPrivacyBlocklist([]);
  });
  it('rejects non-ICAO (~) addresses', () => expect(v({ hex: '~a1b2c3' }).ok).toBe(false));
  it('rejects emergencies', () => {
    for (const squawk of ['7500', '7600', '7700']) expect(v({ squawk }).ok).toBe(false);
    expect(v({ emergency: 'general' }).ok).toBe(false);
  });
  it('rejects state, police and medical operators', () => {
    for (const flight of ['RCH123', 'SVF21', 'GAF603', 'POL12', 'LIFE5', 'HEMS1', 'USCG2', 'MED12']) expect(v({ flight }).ok).toBe(false);
  });
  it('rejects registrations used as callsigns (private flights)', () => {
    for (const flight of ['N123AB', 'GABCD', 'SEABC', 'DEFGH']) expect(v({ flight }).ok).toBe(false);
  });
  it('rejects small aircraft by category and unknown sizes by type', () => {
    for (const category of ['A1', 'A2', 'A7', 'B1']) expect(v({ category }).ok).toBe(false);
    expect(v({ category: undefined, t: 'C68A' }).ok).toBe(false);
    expect(v({ category: undefined, t: 'B738' }).ok).toBe(true);
  });
  it('rejects takeoff/landing phase', () => {
    expect(v({ alt_baro: 'ground' }).ok).toBe(false);
    expect(v({ alt_baro: CRUISE.minAltFt - 1 }).ok).toBe(false);
    expect(v({ baro_rate: 1500 }).ok).toBe(false);
    expect(v({ baro_rate: -1500 }).ok).toBe(false);
    expect(v({ gs: 250 }).ok).toBe(false);
  });
  it('rejects stale positions', () => expect(v({ seen_pos: 120 }).ok).toBe(false));
});

describe('quake filter', () => {
  const { items, observedAt } = parseUsgs(readFixture('usgs/4.5_week.geojson'));
  const base: Quake = { ...items[0]!, mag: 5.5, alert: 'green', tsunami: false, type: 'earthquake', time: new Date(observedAt.getTime() - 12 * 3600_000) };
  it('passes a green M5.5 after 12 h', () => expect(filterQuake(base, observedAt).ok).toBe(true));
  it('enforces the 6 h disaster delay', () =>
    expect(filterQuake({ ...base, time: new Date(observedAt.getTime() - 5 * 3600_000) }, observedAt).ok).toBe(false));
  it('rejects possible-casualty PAGER levels and tsunamis', () => {
    for (const alert of ['yellow', 'orange', 'red']) expect(filterQuake({ ...base, alert }, observedAt).ok).toBe(false);
    expect(filterQuake({ ...base, tsunami: true }, observedAt).ok).toBe(false);
  });
  it('rejects small and non-earthquake events', () => {
    expect(filterQuake({ ...base, mag: 4.4 }, observedAt).ok).toBe(false);
    expect(filterQuake({ ...base, type: 'quarry blast' }, observedAt).ok).toBe(false);
  });
  it('every fixture event that passes is ≥ 6 h old and green/unrated', () => {
    for (const q of items.filter((q) => filterQuake(q, observedAt).ok)) {
      expect(observedAt.getTime() - q.time.getTime()).toBeGreaterThanOrEqual(6 * 3600_000);
      expect([null, 'green']).toContain(q.alert);
    }
  });
});

describe('fire filter', () => {
  const { items, observedAt } = parseFirms(readFixture('firms/J1_VIIRS_C2_Global_24h.csv'));
  const det = (lat: number, lon: number, frp: number, hoursAgo: number): FireDetection => ({
    lat, lon, frp, brightness: 340, confidence: 'nominal', satellite: 'N20', daynight: 'D',
    acquiredAt: new Date(observedAt.getTime() - hoursAgo * 3600_000),
  });
  it('clusters nearby detections and keeps distant ones apart', () => {
    const c = clusterFires([det(10, 10, 50, 8), det(10.01, 10.01, 50, 8), det(20, 20, 50, 8)]);
    expect(c).toHaveLength(2);
  });
  it('requires size, detections and the 6 h delay', () => {
    const big = Array.from({ length: 8 }, (_, i) => det(-15 + i * 0.01, 130, 40, 8));
    expect(filterFire(clusterFires(big)[0]!, observedAt).ok).toBe(true);
    const fresh = Array.from({ length: 8 }, (_, i) => det(-15 + i * 0.01, 130, 40, 2));
    expect(filterFire(clusterFires(fresh)[0]!, observedAt).ok).toBe(false);
    const small = Array.from({ length: 3 }, (_, i) => det(-15 + i * 0.01, 130, 200, 8));
    expect(filterFire(clusterFires(small)[0]!, observedAt).ok).toBe(false);
  });
  it('fixture clusters that pass meet every threshold', () => {
    const passing = clusterFires(items).filter((c) => filterFire(c, observedAt).ok);
    expect(passing.length).toBeGreaterThan(0);
    for (const c of passing) expect(c.detections).toBeGreaterThanOrEqual(5);
  });
});

describe('satellite filter', () => {
  it('keeps LEO payloads and drops debris and high orbits', async () => {
    const { items } = await fetchSatellites(new Date('2026-11-09T00:00:00Z'));
    const iss = items.find((s) => s.name.startsWith('ISS'));
    expect(iss && filterSatellite(iss).ok).toBe(true);
    for (const s of items.filter((s) => filterSatellite(s).ok)) {
      expect(s.name).not.toMatch(/R\/B|DEB/);
      expect(s.altitudeKm).toBeLessThanOrEqual(2000);
    }
    expect(filterSatellite({ ...iss!, name: 'SL-16 R/B' }).ok).toBe(false);
    expect(filterSatellite({ ...iss!, altitudeKm: 20_200 }).ok).toBe(false);
  });
});

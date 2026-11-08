/**
 * Round selection filters (CLAUDE.md rule 2). Every snapshot must pass these.
 * Never loosen a threshold to get more rounds — flag it instead.
 *
 * Each filter returns `{ ok: true }` or `{ ok: false, reason }` so the
 * snapshotter can log why candidates were dropped.
 */
import type { AdsbxAircraft } from './providers/flyitalyadsb.ts';
import type { Quake } from './providers/usgs.ts';
import type { FireDetection } from './providers/firms.ts';
import type { SatPosition } from './providers/celestrak.ts';
import { haversineKm } from '@earthnow/shared';

export type Verdict = { ok: true } | { ok: false; reason: string };
const ok: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/* ------------------------------- Aircraft ------------------------------- */

/** readsb / ADS-B Exchange database flag bits. */
export const DBFLAG = { military: 1, interesting: 2, pia: 4, ladd: 8 } as const;

/** Commercial airline callsign: 3-letter ICAO designator + flight number. */
const AIRLINE_CALLSIGN = /^[A-Z]{3}[0-9]{1,4}[A-Z]{0,2}$/;

/**
 * ICAO designators / prefixes used by military, state, government, police,
 * coast guard and medical operators. Matching is on the first 3 letters of the
 * callsign (or the whole callsign prefix for longer words).
 */
export const BLOCKED_OPERATOR_PREFIXES = [
  // Military / state transport
  'RCH', 'CNV', 'PAT', 'SAM', 'EXE', 'VEN', 'RRR', 'ASY', 'CFC', 'CTM', 'FAF', 'RFR', 'GAF', 'GAM',
  'IAM', 'BAF', 'NAF', 'SVF', 'NOW', 'HAF', 'PLF', 'SUI', 'SHF', 'AME', 'KAF', 'RSD', 'TUAF', 'HUF',
  'CZAF', 'LAF', 'DAF', 'IFC', 'MMF', 'NAV', 'ARM', 'AIR', 'UAF', 'RFF', 'TAF', 'QID', 'AYB', 'SNY',
  'NATO', 'MAGMA', 'ASCOT', 'REACH', 'DUKE', 'KING', 'BOLT', 'IRON', 'TOPCAT',
  // Police, border, customs, coast guard
  'POL', 'POLICE', 'NPAS', 'PLC', 'BPO', 'CBP', 'OMAHA', 'USCG', 'COAST', 'CG', 'GUARD', 'BORDER',
  // Medical / rescue
  'LIFE', 'MED', 'AMB', 'HEMS', 'RESCUE', 'HELI', 'AIRMED', 'MEDEVAC', 'EVAC', 'CHX', 'SAR', 'RSC',
];

/**
 * Airliner type designators accepted when the feed omits the emitter category.
 * Only large transport aircraft; no business jets or turboprop GA.
 */
export const AIRLINER_TYPES = new Set([
  'A19N', 'A20N', 'A21N', 'A318', 'A319', 'A320', 'A321', 'A332', 'A333', 'A338', 'A339', 'A342', 'A343',
  'A345', 'A346', 'A359', 'A35K', 'A388', 'B37M', 'B38M', 'B39M', 'B3XM', 'B732', 'B733', 'B734', 'B735',
  'B736', 'B737', 'B738', 'B739', 'B744', 'B748', 'B752', 'B753', 'B762', 'B763', 'B764', 'B772', 'B773',
  'B77L', 'B77W', 'B778', 'B779', 'B788', 'B789', 'B78X', 'BCS1', 'BCS3', 'E190', 'E195', 'E290', 'E295',
  'C919', 'MD11',
]);

/** Emitter categories for large aircraft (A3 large, A4 B757-class, A5 heavy). */
const LARGE_CATEGORIES = new Set(['A3', 'A4', 'A5']);

/**
 * Proxy for "not within 10 minutes of departure or landing": the feed has no
 * route phase, so require stable cruise. Airliners typically need 10–15 min to
 * climb through FL200; descents from FL200 take a similar time. See ADR-004.
 */
export const CRUISE = { minAltFt: 20_000, maxAbsVerticalRateFpm: 1_000, minGroundSpeedKt: 300 } as const;
const MAX_POSITION_AGE_S = 30;

export function aircraftCallsign(a: AdsbxAircraft): string {
  return (a.flight ?? '').trim().toUpperCase();
}

export function filterAircraft(a: AdsbxAircraft): Verdict {
  const flags = a.dbFlags ?? 0;
  if (flags & DBFLAG.military) return no('military (dbFlags)');
  if (flags & DBFLAG.pia) return no('PIA privacy address (dbFlags)');
  if (flags & DBFLAG.ladd) return no('LADD privacy list (dbFlags)');
  if (privacyBlocklist.has((a.hex ?? '').toLowerCase())) return no('local privacy blocklist');
  // Temporary/non-ICAO addresses ("~" prefix in readsb) cannot be checked against lists.
  if (!a.hex || a.hex.startsWith('~')) return no('non-ICAO address');

  if (a.squawk && ['7500', '7600', '7700'].includes(a.squawk)) return no('emergency squawk');
  if (a.emergency && a.emergency !== 'none') return no('emergency status');

  const cs = aircraftCallsign(a);
  if (!cs) return no('no callsign');
  const blocked = BLOCKED_OPERATOR_PREFIXES.find((p) => cs.startsWith(p));
  if (blocked) return no(`state/military/police/medical operator (${blocked})`);
  if (!AIRLINE_CALLSIGN.test(cs)) return no('not an airline callsign');

  const category = (a.category ?? '').toUpperCase();
  if (category) {
    if (!LARGE_CATEGORIES.has(category)) return no(`size category ${category}`);
  } else if (!AIRLINER_TYPES.has((a.t ?? '').toUpperCase())) {
    return no('unknown size, type not an airliner');
  }

  if (a.alt_baro === 'ground' || a.alt_baro === undefined) return no('on ground / no altitude');
  if (a.alt_baro < CRUISE.minAltFt) return no('below cruise floor (takeoff/landing phase)');
  const vr = a.baro_rate ?? a.geom_rate ?? 0;
  if (Math.abs(vr) > CRUISE.maxAbsVerticalRateFpm) return no('climbing or descending');
  if ((a.gs ?? 0) < CRUISE.minGroundSpeedKt) return no('too slow for cruise');

  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return no('no position');
  if ((a.seen_pos ?? 0) > MAX_POSITION_AGE_S) return no('stale position');
  if (!Number.isFinite(a.track)) return no('no track');
  return ok;
}

/** ICAO hex addresses that must never appear (e.g. imported LADD list). */
const privacyBlocklist = new Set<string>();
export function setPrivacyBlocklist(hexes: Iterable<string>): void {
  privacyBlocklist.clear();
  for (const h of hexes) privacyBlocklist.add(h.trim().toLowerCase());
}

/* ------------------------------ Earthquakes ----------------------------- */

export const QUAKE = {
  minMagnitude: 4.5,
  /** Disaster delay: an event enters the game no sooner than 6 h after it happened. */
  minAgeHours: 6,
  maxAgeHours: 72,
} as const;

export function filterQuake(q: Quake, now: Date): Verdict {
  if (q.type !== 'earthquake') return no(`event type ${q.type}`);
  if (!(q.mag >= QUAKE.minMagnitude)) return no('below minimum magnitude');
  const ageH = (now.getTime() - q.time.getTime()) / 3600_000;
  if (ageH < QUAKE.minAgeHours) return no('inside the 6 h disaster delay');
  if (ageH > QUAKE.maxAgeHours) return no('too old');
  // PAGER yellow/orange/red = estimated fatalities or significant losses.
  if (q.alert && q.alert !== 'green') return no(`PAGER alert ${q.alert} (possible casualties)`);
  if (q.tsunami) return no('tsunami flag');
  if (!Number.isFinite(q.lat) || !Number.isFinite(q.lon)) return no('no position');
  return ok;
}

/* -------------------------------- Fires --------------------------------- */

export const FIRE = {
  minAgeHours: 6,
  maxAgeHours: 48,
  /** A cluster must contain this many detections (filters gas flares, single hot pixels). */
  minDetections: 5,
  /** Summed fire radiative power of the cluster, MW. */
  minTotalFrpMw: 150,
  /** Detections closer than this belong to the same cluster. */
  clusterKm: 4,
} as const;

export interface FireCluster {
  lat: number;
  lon: number;
  detections: number;
  totalFrp: number;
  maxBrightness: number;
  satellite: string;
  acquiredAt: Date;
  highConfidence: number;
}

/** Group detections into clusters (single-link within `FIRE.clusterKm`). */
export function clusterFires(items: FireDetection[]): FireCluster[] {
  const cell = (v: number) => Math.floor(v / 0.05);
  const grid = new Map<string, number[]>();
  items.forEach((d, i) => {
    const k = `${cell(d.lat)}:${cell(d.lon)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const seen = new Uint8Array(items.length);
  const clusters: FireCluster[] = [];
  for (let i = 0; i < items.length; i++) {
    if (seen[i]) continue;
    seen[i] = 1;
    const stack = [i];
    const members: FireDetection[] = [];
    while (stack.length) {
      const j = stack.pop()!;
      const d = items[j]!;
      members.push(d);
      const cy = cell(d.lat), cx = cell(d.lon);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          for (const k of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
            if (seen[k]) continue;
            if (haversineKm(d, items[k]!) <= FIRE.clusterKm) {
              seen[k] = 1;
              stack.push(k);
            }
          }
        }
    }
    const totalFrp = members.reduce((s, m) => s + m.frp, 0);
    const w = totalFrp || 1;
    clusters.push({
      lat: members.reduce((s, m) => s + m.lat * m.frp, 0) / w,
      lon: members.reduce((s, m) => s + m.lon * m.frp, 0) / w,
      detections: members.length,
      totalFrp,
      maxBrightness: Math.max(...members.map((m) => m.brightness)),
      satellite: members[0]!.satellite,
      acquiredAt: new Date(Math.max(...members.map((m) => m.acquiredAt.getTime()))),
      highConfidence: members.filter((m) => m.confidence === 'high' || m.confidence === 'h').length,
    });
  }
  return clusters;
}

export function filterFire(c: FireCluster, now: Date): Verdict {
  const ageH = (now.getTime() - c.acquiredAt.getTime()) / 3600_000;
  if (ageH < FIRE.minAgeHours) return no('inside the 6 h disaster delay');
  if (ageH > FIRE.maxAgeHours) return no('too old');
  if (c.detections < FIRE.minDetections) return no('too few detections');
  if (c.totalFrp < FIRE.minTotalFrpMw) return no('below minimum fire power');
  return ok;
}

/* ------------------------------ Satellites ------------------------------ */

export const SATELLITE = { minAltKm: 300, maxAltKm: 2000 } as const;
const DEBRIS = /\b(DEB|R\/B|OBJECT|COOLANT|PLATFORM)\b/;

export function filterSatellite(s: SatPosition): Verdict {
  if (DEBRIS.test(s.name)) return no('debris or rocket body');
  if (s.altitudeKm < SATELLITE.minAltKm || s.altitudeKm > SATELLITE.maxAltKm) return no('not in low Earth orbit');
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return no('no position');
  return ok;
}

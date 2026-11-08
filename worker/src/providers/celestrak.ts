import * as satellite from 'satellite.js';
import { fetchText, liveData, readFixture, type ProviderResult } from '../env.ts';

export const CELESTRAK_GROUPS = ['stations', 'visual'] as const;
export const celestrakUrl = (group: string) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;

export interface OmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  NORAD_CAT_ID: number;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  CLASSIFICATION_TYPE?: string;
  EPHEMERIS_TYPE?: number;
  ELEMENT_SET_NO?: number;
  REV_AT_EPOCH?: number;
}

export interface SatPosition {
  name: string;
  noradId: number;
  lat: number;
  lon: number;
  altitudeKm: number;
  speedKms: number;
  trackDeg: number;
  inclinationDeg: number;
  epoch: string;
}

/** Propagate one OMM record with SGP4 (satellite.js) to `at`. Computed, not telemetry. */
export function propagate(omm: OmmRecord, at: Date): SatPosition | null {
  const rec = satellite.json2satrec(omm as unknown as satellite.OMMJsonObject);
  const pos = (t: Date) => {
    const pv = satellite.propagate(rec, t);
    if (!pv || typeof pv.position === 'boolean' || !pv.position) return null;
    const gmst = satellite.gstime(t);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const v = pv.velocity as satellite.EciVec3<number>;
    return {
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
      altitudeKm: geo.height,
      speedKms: Math.hypot(v.x, v.y, v.z),
    };
  };
  const a = pos(at);
  const b = pos(new Date(at.getTime() + 10_000));
  if (!a || !b || !Number.isFinite(a.lat)) return null;
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const trackDeg =
    (Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)) *
      180) / Math.PI;
  return {
    name: omm.OBJECT_NAME.trim(),
    noradId: omm.NORAD_CAT_ID,
    ...a,
    trackDeg: (trackDeg + 360) % 360,
    inclinationDeg: omm.INCLINATION,
    epoch: omm.EPOCH,
  };
}

export async function fetchSatellites(at = new Date()): Promise<ProviderResult<SatPosition>> {
  const seen = new Set<number>();
  const records: OmmRecord[] = [];
  for (const group of CELESTRAK_GROUPS) {
    const text = liveData() ? await fetchText(celestrakUrl(group)) : readFixture(`celestrak/${group}.json`);
    for (const r of JSON.parse(text) as OmmRecord[]) {
      if (seen.has(r.NORAD_CAT_ID)) continue;
      seen.add(r.NORAD_CAT_ID);
      records.push(r);
    }
  }
  const items = records.map((r) => propagate(r, at)).filter((p): p is SatPosition => p !== null);
  return { items, observedAt: at };
}

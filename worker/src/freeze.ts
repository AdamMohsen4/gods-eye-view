/**
 * Turn filtered provider records into frozen snapshot rows: true position,
 * displaced camera pose, precomputed clue values and a neutral fact card.
 */
import {
  buildPose,
  localSolarTime,
  type Clue,
  type ClueKey,
  type FactCard,
  CLUE_ORDER,
  type RoundType,
} from '@earthnow/shared';
import type { NewSnapshot } from '@earthnow/db';
import type { AdsbxAircraft } from './providers/flyitalyadsb.ts';
import type { Quake } from './providers/usgs.ts';
import type { SatPosition } from './providers/celestrak.ts';
import type { FireCluster } from './filters.ts';
import { aircraftCallsign } from './filters.ts';
import { countryAt } from './country.ts';
import { aircraftTypeName } from './aircraftTypes.ts';

const FT = 0.3048;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const utcLabel = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const CLUE_LABEL: Record<ClueKey, string> = {
  altitude: 'Altitude',
  speed: 'Ground speed',
  heading: 'Heading',
  localTime: 'Local solar time',
  magnitude: 'Magnitude',
  depth: 'Depth',
  frp: 'Fire power',
  inclination: 'Orbit inclination',
  hemisphere: 'Hemisphere',
};

function clues(type: RoundType, values: Partial<Record<ClueKey, string>>): Clue[] {
  return CLUE_ORDER[type].map((key) => {
    const value = values[key];
    if (!value) throw new Error(`missing clue ${key} for ${type}`);
    return { key, label: CLUE_LABEL[key], value };
  });
}

function where(lat: number, lon: number): { country: string | null; over: string } {
  const country = countryAt(lat, lon);
  return { country, over: country ? `over ${country}` : 'over open water' };
}

export function freezeFlight(a: AdsbxAircraft, capturedAt: Date): NewSnapshot {
  const lat = a.lat!, lon = a.lon!;
  const altFt = a.alt_baro as number;
  const callsign = aircraftCallsign(a);
  const pose = buildPose({
    type: 'flight', truth: { lat, lon }, altitudeM: altFt * FT, headingDeg: a.track, seed: `${a.hex}:${capturedAt.toISOString()}`,
  });
  const { country, over } = where(lat, lon);
  const typeName = aircraftTypeName(a.t);
  const fact: FactCard = {
    title: callsign,
    subtitle: [typeName, 'cruising', over].filter(Boolean).join(' · '),
    lines: [`${fmt(altFt)} ft · ${fmt(a.gs ?? 0)} kt`, `Frozen at ${utcLabel(capturedAt)}`],
    country,
  };
  return {
    type: 'flight',
    source: 'flyitalyadsb',
    dedupeKey: `flight:${a.hex}:${Math.floor(capturedAt.getTime() / 1_800_000)}`,
    capturedAt,
    eventAt: capturedAt,
    trueLat: lat,
    trueLon: lon,
    payload: { callsign, typeCode: a.t ?? null, altitudeFt: altFt, groundSpeedKt: a.gs, trackDeg: a.track, category: a.category ?? null, fact },
    cameraPose: pose.camera,
    subject: pose.subject,
    clues: clues('flight', {
      altitude: `${fmt(altFt)} ft`,
      speed: `${fmt(a.gs ?? 0)} kt`,
      localTime: localSolarTime(capturedAt.toISOString(), lon),
    }),
  };
}

export function freezeQuake(q: Quake, capturedAt: Date): NewSnapshot {
  const pose = buildPose({ type: 'quake', truth: q, altitudeM: 0, intensity: q.mag, seed: q.id });
  const { country } = where(q.lat, q.lon);
  const fact: FactCard = {
    title: `M${q.mag.toFixed(1)} earthquake`,
    subtitle: q.place,
    lines: [`Depth ${fmt(q.depthKm)} km`, `Occurred ${utcLabel(q.time)}`],
    country,
  };
  return {
    type: 'quake',
    source: 'usgs',
    dedupeKey: `quake:${q.id}`,
    capturedAt,
    eventAt: q.time,
    trueLat: q.lat,
    trueLon: q.lon,
    payload: { usgsId: q.id, mag: q.mag, depthKm: q.depthKm, place: q.place, status: q.status, url: q.url, fact },
    cameraPose: pose.camera,
    subject: pose.subject,
    clues: clues('quake', {
      magnitude: `M${q.mag.toFixed(1)}`,
      depth: `${fmt(q.depthKm)} km`,
      localTime: localSolarTime(q.time.toISOString(), q.lon),
    }),
  };
}

const SAT_NAMES: Record<string, string> = { N: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21', T: 'Terra', A: 'Aqua' };

export function freezeFire(c: FireCluster, capturedAt: Date): NewSnapshot {
  const key = `${c.lat.toFixed(1)}:${c.lon.toFixed(1)}:${c.acquiredAt.toISOString().slice(0, 10)}`;
  const pose = buildPose({ type: 'fire', truth: c, altitudeM: 0, intensity: c.totalFrp, seed: key });
  const { country, over } = where(c.lat, c.lon);
  const sat = SAT_NAMES[c.satellite] ?? c.satellite;
  const fact: FactCard = {
    title: 'Active fire',
    subtitle: `${c.detections} heat detections by ${sat} VIIRS${country ? ` · ${country}` : ''}`,
    lines: [`Combined fire power ${fmt(c.totalFrp)} MW`, `Detected ${utcLabel(c.acquiredAt)}`],
    country,
  };
  void over;
  return {
    type: 'fire',
    source: 'nasa-firms',
    dedupeKey: `fire:${key}`,
    capturedAt,
    eventAt: c.acquiredAt,
    trueLat: c.lat,
    trueLon: c.lon,
    payload: { detections: c.detections, totalFrpMw: c.totalFrp, satellite: c.satellite, fact },
    cameraPose: pose.camera,
    subject: pose.subject,
    clues: clues('fire', {
      frp: `${fmt(c.totalFrp)} MW`,
      localTime: localSolarTime(c.acquiredAt.toISOString(), c.lon),
      hemisphere: c.lat >= 0 ? 'Northern' : 'Southern',
    }),
  };
}

export function freezeSatellite(s: SatPosition, capturedAt: Date): NewSnapshot {
  const seed = `${s.noradId}:${capturedAt.toISOString()}`;
  const pose = buildPose({ type: 'satellite', truth: s, altitudeM: s.altitudeKm * 1000, headingDeg: s.trackDeg, seed });
  const { country, over } = where(s.lat, s.lon);
  const fact: FactCard = {
    title: s.name,
    subtitle: `Low Earth orbit · ${fmt(s.altitudeKm)} km · ${over}`,
    lines: [`${s.speedKms.toFixed(2)} km/s · inclination ${s.inclinationDeg.toFixed(1)}°`, `Position computed for ${utcLabel(capturedAt)}`],
    country,
  };
  return {
    type: 'satellite',
    source: 'celestrak',
    dedupeKey: `satellite:${s.noradId}:${Math.floor(capturedAt.getTime() / 600_000)}`,
    capturedAt,
    eventAt: capturedAt,
    trueLat: s.lat,
    trueLon: s.lon,
    payload: { name: s.name, noradId: s.noradId, altitudeKm: s.altitudeKm, speedKms: s.speedKms, inclinationDeg: s.inclinationDeg, epoch: s.epoch, fact },
    cameraPose: pose.camera,
    subject: pose.subject,
    clues: clues('satellite', {
      altitude: `${fmt(s.altitudeKm)} km`,
      inclination: `${s.inclinationDeg.toFixed(1)}°`,
      localTime: localSolarTime(capturedAt.toISOString(), s.lon),
    }),
  };
}

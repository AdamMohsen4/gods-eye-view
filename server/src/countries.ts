/**
 * Country lookup from Natural Earth 1:10m outlines (world-atlas, public
 * domain). Server-side only, so streak answers and guesses are judged the
 * same way for everyone.
 */
import { createRequire } from 'node:module';
import { geoArea, geoBounds, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';
import type { Topology } from 'topojson-specification';
import countries from 'i18n-iso-countries';
import { destination, type CountryRef, type LatLon } from '@earthnow/shared';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-10m.json') as Topology;

const BY_NAME: Record<string, string> = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };

interface Shape {
  code: string;
  feature: Feature<Geometry>;
  bounds: [[number, number], [number, number]];
}

let shapes: Shape[] | null = null;

function load(): Shape[] {
  if (shapes) return shapes;
  const fc = feature(topo, topo.objects.countries!) as unknown as { features: Feature<Geometry, { name: string }>[] };
  shapes = [];
  for (const f of fc.features) {
    const code = (f.id != null ? countries.numericToAlpha2(String(f.id)) : undefined) ?? BY_NAME[f.properties.name];
    if (!code) continue;
    dropInvertedRings(f);
    shapes.push({ code, feature: f, bounds: geoBounds(f) as Shape['bounds'] });
  }
  return shapes;
}

/**
 * A few tiny 1:10m polygons (Maldives atolls) are wound the wrong way, which
 * on a sphere means "everything except this atoll". Drop them.
 */
function dropInvertedRings(f: Feature<Geometry>): void {
  const g = f.geometry;
  const ok = (coords: Polygon['coordinates']) => geoArea({ type: 'Polygon', coordinates: coords }) <= 2 * Math.PI;
  if (g.type === 'Polygon' && !ok(g.coordinates)) (g as Polygon).coordinates = [];
  if (g.type === 'MultiPolygon') (g as MultiPolygon).coordinates = g.coordinates.filter(ok);
}

function inBounds(b: Shape['bounds'], p: LatLon): boolean {
  const [[w, s], [e, n]] = b;
  if (p.lat < s || p.lat > n) return false;
  return w <= e ? p.lon >= w && p.lon <= e : p.lon >= w || p.lon <= e;
}

function exactCountry(p: LatLon): string | null {
  for (const s of load()) {
    if (inBounds(s.bounds, p) && geoContains(s.feature, [p.lon, p.lat])) return s.code;
  }
  return null;
}

/**
 * ISO alpha-2 of the country containing the point. Coastlines are
 * generalised, so a harbour or a pin just off the coast falls back to the
 * nearest country within ~12 km. Null out at sea.
 */
export function countryAt(p: LatLon): string | null {
  const exact = exactCountry(p);
  if (exact) return exact;
  for (const km of [2, 5, 12]) {
    const votes = new Map<string, number>();
    for (let b = 0; b < 360; b += 45) {
      const c = exactCountry(destination(p, b, km));
      if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return null;
}

const NAME_OVERRIDES: Record<string, string> = {
  XK: 'Kosovo', US: 'United States', GB: 'United Kingdom', RU: 'Russia', KR: 'South Korea', KP: 'North Korea',
  TW: 'Taiwan', LA: 'Laos', VN: 'Vietnam', BO: 'Bolivia', VE: 'Venezuela', IR: 'Iran', SY: 'Syria', TZ: 'Tanzania',
  MD: 'Moldova', PS: 'Palestine', CZ: 'Czechia', MK: 'North Macedonia', CD: 'DR Congo', CG: 'Congo', FM: 'Micronesia',
};

export function countryName(code: string): string {
  return NAME_OVERRIDES[code] ?? countries.getName(code, 'en') ?? code;
}

export function countryRef(code: string | null | undefined): CountryRef | null {
  return code ? { code, name: countryName(code) } : null;
}

import { createRequire } from 'node:module';
import { geoBounds, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';

/** Natural Earth 1:50m countries (public domain) via world-atlas. */
type Country = { name: string; f: Feature<Geometry, { name: string }>; bbox: [[number, number], [number, number]] };
let countries: Country[] | null = null;

function load(): Country[] {
  if (countries) return countries;
  const require = createRequire(import.meta.url);
  const topo = require('world-atlas/countries-50m.json') as Topology;
  const fc = feature(topo, topo.objects.countries!) as unknown as FeatureCollection<Geometry, { name: string }>;
  countries = fc.features.map((f) => ({ name: f.properties.name, f, bbox: geoBounds(f) }));
  return countries;
}

/** Country name containing a point, or null over the ocean. */
export function countryAt(lat: number, lon: number): string | null {
  for (const c of load()) {
    const [[w, s], [e, n]] = c.bbox;
    if (lat < s || lat > n) continue;
    if (w <= e ? lon < w || lon > e : lon < w && lon > e) continue;
    if (geoContains(c.f, [lon, lat])) return c.name;
  }
  return null;
}

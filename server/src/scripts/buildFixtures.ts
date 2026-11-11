/** Regenerate fixtures/locations.json (fixture provider locations per official map). */
import { writeFileSync } from 'node:fs';
import { seededRandom } from '@earthnow/shared';
import { OFFICIAL_MAPS } from '../catalog.ts';
import { fixtureProvider } from '../imagery/fixture.ts';
import { generateLocations } from '../locations.ts';

const out: Record<string, { panoId: string; lat: number; lon: number; heading: number; country: string }[]> = {};
for (const def of OFFICIAL_MAPS) {
  const locs = await generateLocations(def, fixtureProvider, def.slug === 'world' ? 400 : 120, { rnd: seededRandom(`fixture:${def.slug}`), concurrency: 1 });
  out[def.slug] = locs.map((l) => ({ panoId: l.panoId, lat: +l.lat.toFixed(5), lon: +l.lon.toFixed(5), heading: l.heading, country: l.country }));
  console.log(def.slug, locs.length);
}
writeFileSync(new URL('../../fixtures/locations.json', import.meta.url), JSON.stringify(out));

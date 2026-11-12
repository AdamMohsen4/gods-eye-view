/**
 * Location generation: pick a plausible point (near a populated place in
 * one of the map's countries), then ask the imagery provider for the nearest
 * panorama. Only points whose panorama lies in the intended country are kept.
 */
import { createRequire } from 'node:module';
import { destination, type LatLon } from '@earthnow/shared';
import { countryAt } from './countries.ts';
import type { FoundPano, ImageryProvider } from './imagery/index.ts';
import { ImageryError } from './imagery/types.ts';
import type { MapDef } from './catalog.ts';

const require = createRequire(import.meta.url);

interface City {
  country: string;
  population: number;
  loc: { coordinates: [number, number] };
}

let cityIndex: Map<string, City[]> | null = null;
function cities(): Map<string, City[]> {
  if (cityIndex) return cityIndex;
  cityIndex = new Map();
  for (const c of require('all-the-cities') as City[]) {
    const list = cityIndex.get(c.country) ?? [];
    list.push(c);
    cityIndex.set(c.country, list);
  }
  return cityIndex;
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rnd: () => number): T | undefined {
  let total = 0;
  for (const it of items) total += weight(it);
  let r = rnd() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** A random candidate point for a map, before checking coverage. */
export function candidatePoint(def: Pick<MapDef, 'countries' | 'minPopulation' | 'radiusKm'>, rnd: () => number = Math.random): { point: LatLon; country: string } | null {
  const idx = cities();
  const min = def.minPopulation ?? 0;
  const pools = def.countries
    .map((code) => ({ code, list: (idx.get(code) ?? []).filter((c) => c.population >= min) }))
    .filter((p) => p.list.length > 0);
  // Countries weighted by √(number of places): big countries come up more, small ones still appear.
  const pool = weightedPick(pools, (p) => Math.sqrt(p.list.length), rnd);
  if (!pool) return null;
  const city = weightedPick(pool.list, (c) => Math.pow(c.population, 0.35), rnd)!;
  const [lon, lat] = city.loc.coordinates;
  // Mostly near towns, sometimes well out into the countryside.
  const maxKm = def.radiusKm ?? (rnd() < 0.35 ? 30 : 6);
  const point = destination({ lat, lon }, rnd() * 360, Math.sqrt(rnd()) * maxKm);
  return { point, country: pool.code };
}

export interface GeneratedLocation extends FoundPano {
  country: string;
  heading: number;
}

let consecutiveFailures = 0;

/**
 * findPano with backoff for rate limits and server errors. Auth and request
 * errors stop the run; a long streak of failures does too, rather than
 * silently reporting "no coverage" for a whole map.
 */
async function findWithRetry(provider: ImageryProvider, p: LatLon, radiusM: number): Promise<FoundPano | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const found = await provider.findPano(p, radiusM);
      consecutiveFailures = 0;
      return found;
    } catch (e) {
      if (!(e instanceof ImageryError) || e.kind !== 'retryable') throw e;
      if (attempt >= 3) {
        if (++consecutiveFailures >= 20) throw new Error(`${provider.id}: giving up after repeated failures (last: ${e.message})`);
        console.warn(`[locations] skipping a point: ${e.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/** Find up to `count` panoramas for a map. Calls `onFound` as it goes. */
export async function generateLocations(
  def: Pick<MapDef, 'countries' | 'minPopulation' | 'radiusKm'>,
  provider: ImageryProvider,
  count: number,
  opts: { rnd?: () => number; maxAttempts?: number; concurrency?: number; onFound?: (l: GeneratedLocation) => Promise<void> | void; exclude?: Set<string> } = {},
): Promise<GeneratedLocation[]> {
  const rnd = opts.rnd ?? Math.random;
  consecutiveFailures = 0;
  const maxAttempts = opts.maxAttempts ?? count * 25;
  const seen = new Set(opts.exclude ?? []);
  const out: GeneratedLocation[] = [];
  let attempts = 0;
  // Mapillary 360° coverage is sparse, so snap from further away (its tile search makes that cheap).
  const radiusM = provider.id === 'mapillary' ? (def.radiusKm ? 1500 : 5000) : def.radiusKm ? 300 : 1000;
  const worker = async () => {
    while (out.length < count && attempts < maxAttempts) {
      attempts++;
      const cand = candidatePoint(def, rnd);
      if (!cand) return;
      const found = await findWithRetry(provider, cand.point, radiusM);
      if (!found || seen.has(found.panoId)) continue;
      const country = countryAt(found);
      if (country !== cand.country) continue;
      seen.add(found.panoId);
      const loc: GeneratedLocation = { ...found, country, heading: found.heading ?? Math.round(rnd() * 360) };
      if (out.length >= count) return;
      out.push(loc);
      await opts.onFound?.(loc);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 6 }, worker));
  return out;
}

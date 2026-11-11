import { createHash } from 'node:crypto';
import type { LatLon } from '@earthnow/shared';
import { countryAt } from '../countries.ts';
import type { FoundPano, ImageryProvider } from './types.ts';

/**
 * Stand-in for dev and tests with no keys: every point on land "has
 * coverage". The client draws a generated panorama for these ids.
 */
export const fixtureProvider: ImageryProvider = {
  id: 'fixture',
  async findPano(p: LatLon): Promise<FoundPano | null> {
    if (!countryAt(p)) return null;
    // Opaque id: the client must not be able to read the location from it.
    const panoId = `fx-${createHash('sha256').update(`${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).digest('hex').slice(0, 20)}`;
    return { ...p, panoId, credit: 'Generated test panorama' };
  },
};

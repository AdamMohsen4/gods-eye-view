import type { LatLon, Provider } from '@earthnow/shared';

export interface FoundPano extends LatLon {
  panoId: string;
  /** Suggested initial heading in degrees, if the provider knows a good one. */
  heading?: number;
  /** Attribution shown on the reveal (photographer, licence). */
  credit: string | null;
}

export interface ImageryProvider {
  id: Provider;
  /** Nearest panorama to `p` within `radiusM`, or null when there is no coverage. */
  findPano(p: LatLon, radiusM: number): Promise<FoundPano | null>;
}

export class ProviderUnavailable extends Error {}

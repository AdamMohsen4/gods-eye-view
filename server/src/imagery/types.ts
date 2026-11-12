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

/**
 * A provider call that failed (as opposed to "no coverage here", which is null).
 * - auth: key/token rejected, stop everything.
 * - retryable: rate limit, timeout or server error; try again later.
 * - request: we sent something the API refuses; a bug, stop.
 */
export class ImageryError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'retryable' | 'request',
  ) {
    super(message);
  }
}

/** Fetch with a timeout; network failures and timeouts become retryable ImageryErrors. */
export async function fetchProvider(name: string, fetchImpl: typeof fetch, url: URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new ImageryError(`${name}: ${(e as Error).message}`, 'retryable');
  }
}

import type { Provider } from '@earthnow/shared';

export interface Config {
  /** Which imagery the game serves. Locations are stored per provider, so switching is instant. */
  provider: Provider;
  /** Server-side Mapillary token (Graph API, location generation). */
  mapillaryToken: string | null;
  /** Public Mapillary client token for the browser viewer (often the same token). */
  mapillaryClientToken: string | null;
  /** Server-side Google key: Street View metadata (free) for location generation. */
  googleServerKey: string | null;
  /** Browser key, HTTP-referrer restricted in Google Cloud: Maps JavaScript API. */
  googleBrowserKey: string | null;
  mapStyle: 'openfreemap' | 'offline';
  timerGraceSeconds: number;
  adminToken: string | null;
  publicOrigin: string;
  rateLimitMax: number;
  /** Duel: seconds the other player gets once someone has guessed. */
  duelCountdownSeconds: number;
  /**
   * Fastify trustProxy: false (default), a hop count, or a comma list of proxy IPs/CIDRs.
   * Only trust X-Forwarded-For from your own proxy, or clients can dodge rate limits.
   */
  trustProxy: boolean | number | string;
}

function trustProxy(v: string | undefined): boolean | number | string {
  if (!v || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  return /^\d+$/.test(v) ? Number(v) : v;
}

function provider(v: string | undefined): Provider {
  return v === 'mapillary' || v === 'google' ? v : 'fixture';
}

export function loadConfig(env = process.env): Config {
  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    provider: provider(env.IMAGERY_PROVIDER),
    mapillaryToken: blank(env.MAPILLARY_TOKEN),
    mapillaryClientToken: blank(env.MAPILLARY_CLIENT_TOKEN) ?? blank(env.MAPILLARY_TOKEN),
    googleServerKey: blank(env.GOOGLE_MAPS_SERVER_KEY),
    googleBrowserKey: blank(env.GOOGLE_MAPS_BROWSER_KEY),
    mapStyle: env.MAP_STYLE === 'offline' ? 'offline' : 'openfreemap',
    timerGraceSeconds: 3,
    adminToken: env.ADMIN_TOKEN && env.ADMIN_TOKEN !== 'change-me' ? env.ADMIN_TOKEN : null,
    publicOrigin: (env.PUBLIC_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
    rateLimitMax: Number(env.RATE_LIMIT_MAX ?? 240),
    duelCountdownSeconds: Number(env.DUEL_COUNTDOWN_SECONDS ?? 15),
    trustProxy: trustProxy(env.TRUST_PROXY),
  };
}

import type { RoundType } from '@earthnow/shared';

export const TYPE_LABEL: Record<RoundType, string> = {
  flight: 'Aircraft in flight',
  quake: 'Earthquake',
  fire: 'Wildfire',
  satellite: 'Satellite overhead',
};

export const TYPE_PROMPT: Record<RoundType, string> = {
  flight: 'Where is this aircraft right now?',
  quake: 'Where did the ground shake?',
  fire: 'Where is this fire burning?',
  satellite: 'What is this satellite passing over?',
};

export function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return 'No pin';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

export function formatScore(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** "4 min ago", "3 h ago", "2 d ago" relative to `now`. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Whole seconds left until `deadline` (never negative). */
export function secondsLeft(deadline: string | null, now: number = Date.now()): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Remaining free arcade rounds, or null when unlimited. */
export function arcadeRemaining(arcade: { usedToday: number; limit: number | null }): number | null {
  if (arcade.limit === null) return null;
  return Math.max(0, arcade.limit - arcade.usedToday);
}

/** Parse the share entry `?ref=share&d=N`. Returns the daily number or null. */
export function parseShareEntry(search: string): number | null {
  const p = new URLSearchParams(search);
  if (p.get('ref') !== 'share') return null;
  const d = Number(p.get('d'));
  return Number.isInteger(d) && d > 0 ? d : null;
}

/** RFC 4122 v4 id from 16 random bytes. */
export function uuidFromBytes(b: Uint8Array): string {
  const x = Array.from(b.slice(0, 16));
  x[6] = (x[6]! & 0x0f) | 0x40;
  x[8] = (x[8]! & 0x3f) | 0x80;
  const h = x.map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** ISO 3166-1 alpha-2 codes offered in the profile dialog. */
export const COUNTRY_CODES = (
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL ' +
  'NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM ' +
  'TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'
).split(' ');

/** Regional-indicator flag emoji for an alpha-2 code. */
export function flagEmoji(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

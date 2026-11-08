import { fetchText, liveData, readFixture, type ProviderResult } from '../env.ts';

/**
 * FlyItalyADSB through its ADS-B Exchange v2-compatible API
 * (https://flyitalyadsb.com/en/data/api/docs/adsbx-v2/). Commercial use is allowed
 * on every plan with a CC BY-SA 4.0 attribution line. The key stays server-side.
 */
export const FLYITALYADSB_BASE = 'https://api.flyitalyadsb.com/api/aircraft/v2';

export interface AdsbxAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  dbFlags?: number;
  category?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number;
}

interface AdsbxResponse {
  ac?: AdsbxAircraft[];
  now?: number;
}

/** Radius (NM) per plan. Pro/Fleet have no maximum, so one worldwide query suffices. */
const PLAN_RADIUS_NM: Record<string, number> = { free: 270, starter: 540, pro: 10_800 };

/**
 * Sample points over busy oceanic and continental airspace used when the plan
 * cannot query the whole world at once. Varied on purpose so dailies are global.
 */
export const SAMPLE_POINTS: Array<[number, number]> = [
  [55, -30], [50, 10], [60, 15], [40, -100], [35, 135], [25, 55], [-25, 135],
  [1, 104], [-23, -46], [45, -150], [15, 80], [5, 20], [-35, 20], [62, 100],
];

export async function fetchAircraft(opts: { samples?: number } = {}): Promise<ProviderResult<AdsbxAircraft>> {
  if (!liveData()) {
    const data = JSON.parse(readFixture('flyitalyadsb/world.json')) as AdsbxResponse;
    return { items: data.ac ?? [], observedAt: new Date(data.now ?? Date.now()) };
  }
  const key = process.env.FLYITALYADSB_API_KEY;
  if (!key) throw new Error('FLYITALYADSB_API_KEY is not set (LIVE_DATA=1)');
  const plan = (process.env.FLYITALYADSB_PLAN ?? 'free').toLowerCase();
  const radius = PLAN_RADIUS_NM[plan] ?? PLAN_RADIUS_NM.free!;
  const points: Array<[number, number]> =
    plan === 'pro' || plan === 'fleet'
      ? [[0, 0]]
      : [...SAMPLE_POINTS].sort(() => Math.random() - 0.5).slice(0, opts.samples ?? 3);
  const items: AdsbxAircraft[] = [];
  for (const [lat, lon] of points) {
    const text = await fetchText(`${FLYITALYADSB_BASE}/lat/${lat}/lon/${lon}/dist/${radius}/`, {
      headers: { 'X-Api-Key': key },
    });
    items.push(...((JSON.parse(text) as AdsbxResponse).ac ?? []));
  }
  return { items, observedAt: new Date() };
}

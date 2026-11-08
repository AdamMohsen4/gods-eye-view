/**
 * Re-record keyless provider fixtures (USGS, FIRMS, CelesTrak).
 * Usage: LIVE_DATA=1 pnpm fixtures:record
 * The flight fixture stays synthetic until a FlyItalyADSB key exists; with
 * FLYITALYADSB_API_KEY set, a real response is saved as flyitalyadsb/recorded.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR, fetchText, liveData } from './env.ts';
import { USGS_FEED } from './providers/usgs.ts';
import { CELESTRAK_GROUPS, celestrakUrl } from './providers/celestrak.ts';
import { FIRMS_CSV } from './providers/firms.ts';
import { FLYITALYADSB_BASE } from './providers/flyitalyadsb.ts';

if (!liveData()) {
  console.error('Refusing to call providers: set LIVE_DATA=1 (and not FIXTURE_MODE=1).');
  process.exit(1);
}
const save = (rel: string, text: string) => {
  writeFileSync(join(FIXTURES_DIR, rel), text);
  console.log(`saved ${rel} (${(text.length / 1024).toFixed(0)} KB)`);
};

save('usgs/4.5_week.geojson', await fetchText(USGS_FEED));
for (const g of CELESTRAK_GROUPS) save(`celestrak/${g}.json`, await fetchText(celestrakUrl(g)));
const csv = (await fetchText(FIRMS_CSV, {}, 120_000)).trim().split('\n');
const iFrp = csv[0]!.split(',').indexOf('frp');
save('firms/J1_VIIRS_C2_Global_24h.csv', [csv[0], ...csv.slice(1).filter((l) => Number(l.split(',')[iFrp]) >= 20)].join('\n') + '\n');
if (process.env.FLYITALYADSB_API_KEY) {
  const text = await fetchText(`${FLYITALYADSB_BASE}/lat/55/lon/-30/dist/250/`, { headers: { 'X-Api-Key': process.env.FLYITALYADSB_API_KEY } });
  save('flyitalyadsb/recorded.json', text);
}

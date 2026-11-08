import { fetchText, liveData, readFixture, type ProviderResult } from '../env.ts';

/** Keyless 24 h global CSV (NOAA-20 VIIRS). Open data, citation requested. */
export const FIRMS_CSV =
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv';

export interface FireDetection {
  lat: number;
  lon: number;
  frp: number;
  brightness: number;
  confidence: string;
  satellite: string;
  acquiredAt: Date;
  daynight: string;
}

export function parseFirms(text: string): ProviderResult<FireDetection> {
  const lines = text.trim().split('\n');
  const header = (lines.shift() ?? '').split(',');
  const col = (name: string) => header.indexOf(name);
  const iLat = col('latitude'), iLon = col('longitude'), iFrp = col('frp'), iB = col('bright_ti4');
  const iConf = col('confidence'), iSat = col('satellite'), iDate = col('acq_date'), iTime = col('acq_time');
  const iDn = col('daynight');
  let latest = 0;
  const items: FireDetection[] = [];
  for (const line of lines) {
    const c = line.split(',');
    const hhmm = (c[iTime] ?? '0000').padStart(4, '0');
    const acquiredAt = new Date(`${c[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (Number.isNaN(acquiredAt.getTime())) continue;
    latest = Math.max(latest, acquiredAt.getTime());
    items.push({
      lat: Number(c[iLat]),
      lon: Number(c[iLon]),
      frp: Number(c[iFrp]),
      brightness: Number(c[iB]),
      confidence: c[iConf] ?? '',
      satellite: c[iSat] ?? '',
      acquiredAt,
      daynight: c[iDn] ?? '',
    });
  }
  // A 24 h file is published continuously; its newest row is ~1 h old.
  return { items, observedAt: new Date(latest + 3600_000) };
}

export async function fetchFires(): Promise<ProviderResult<FireDetection>> {
  const text = liveData() ? await fetchText(FIRMS_CSV, {}, 60_000) : readFixture('firms/J1_VIIRS_C2_Global_24h.csv');
  const result = parseFirms(text);
  if (liveData()) result.observedAt = new Date();
  return result;
}

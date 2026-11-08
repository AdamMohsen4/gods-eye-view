import { fetchText, liveData, readFixture, type ProviderResult } from '../env.ts';

export const USGS_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';

export interface Quake {
  id: string;
  mag: number;
  place: string;
  time: Date;
  updated: Date;
  /** PAGER alert level: null | green | yellow | orange | red. */
  alert: string | null;
  tsunami: boolean;
  status: string;
  type: string;
  lat: number;
  lon: number;
  depthKm: number;
  url: string;
}

interface Feature {
  id: string;
  properties: {
    mag: number; place: string; time: number; updated: number; alert: string | null;
    tsunami: number; status: string; type: string; url: string;
  };
  geometry: { coordinates: [number, number, number] };
}

export function parseUsgs(text: string): ProviderResult<Quake> {
  const data = JSON.parse(text) as { metadata?: { generated?: number }; features: Feature[] };
  const items = data.features.map((f) => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place,
    time: new Date(f.properties.time),
    updated: new Date(f.properties.updated),
    alert: f.properties.alert,
    tsunami: f.properties.tsunami === 1,
    status: f.properties.status,
    type: f.properties.type,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    depthKm: f.geometry.coordinates[2],
    url: f.properties.url,
  }));
  return { items, observedAt: new Date(data.metadata?.generated ?? Date.now()) };
}

export async function fetchQuakes(): Promise<ProviderResult<Quake>> {
  const text = liveData() ? await fetchText(USGS_FEED) : readFixture('usgs/4.5_week.geojson');
  const result = parseUsgs(text);
  if (liveData()) result.observedAt = new Date();
  return result;
}

import type { StyleSpecification } from 'maplibre-gl';
import { api } from '../api.ts';

let offline: Promise<StyleSpecification> | null = null;

/** Country outlines bundled with the app: used in tests and as a fallback when tiles fail. */
async function offlineStyle(): Promise<StyleSpecification> {
  const [{ feature }, topo] = await Promise.all([import('topojson-client'), import('world-atlas/countries-110m.json')]);
  const t = (topo as { default?: unknown }).default ?? topo;
  const countries = feature(t as never, (t as { objects: { countries: never } }).objects.countries);
  return {
    version: 8,
    sources: { countries: { type: 'geojson', data: countries as never } },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': '#b9d3d6' } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#efe9dc' } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#9b9686', 'line-width': 0.8 } },
    ],
  };
}

export async function mapStyle(): Promise<StyleSpecification | string> {
  const cfg = await api.config();
  if (cfg.mapStyle === 'offline') return (offline ??= offlineStyle());
  // OpenFreeMap: OpenMapTiles vector tiles, no key, attribution shown by MapLibre.
  return 'https://tiles.openfreemap.org/styles/liberty';
}

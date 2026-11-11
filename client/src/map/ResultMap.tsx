import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLon } from '@earthnow/shared';
import { mapStyle } from './style.ts';
import { nearLon, pinEl } from './pins.ts';

export interface ResultPair {
  truth: LatLon;
  guesses: { at: LatLon | null; label?: string; color?: string }[];
  truthLabel?: string;
}

/** Reveal map: truth flags, guess pins, and dashed lines between them. */
export function ResultMap({ pairs, padding = 80 }: { pairs: ResultPair[]; padding?: number | maplibregl.PaddingOptions }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(pairs);

  useEffect(() => {
    let cancelled = false;
    let m: maplibregl.Map | null = null;
    void mapStyle().then((style) => {
      if (cancelled) return;
      m = new maplibregl.Map({ container: el.current!, style, center: [0, 20], zoom: 1, attributionControl: { compact: true }, dragRotate: false });
      m.touchZoomRotate.disableRotation();
      const lines: GeoJSON.Feature[] = [];
      const bounds = new maplibregl.LngLatBounds();
      for (const pair of pairs) {
        new maplibregl.Marker({ element: pinEl('truth', pair.truthLabel), anchor: 'bottom' }).setLngLat([pair.truth.lon, pair.truth.lat]).addTo(m);
        bounds.extend([pair.truth.lon, pair.truth.lat]);
        for (const g of pair.guesses) {
          if (!g.at) continue;
          const at = nearLon(pair.truth, g.at);
          new maplibregl.Marker({ element: pinEl(g.label ? 'player' : 'guess', g.label, g.color), anchor: g.label ? 'center' : 'bottom' })
            .setLngLat([at.lon, at.lat])
            .addTo(m);
          bounds.extend([at.lon, at.lat]);
          lines.push({
            type: 'Feature',
            properties: { color: g.color ?? '#1d2a24' },
            geometry: { type: 'LineString', coordinates: [[pair.truth.lon, pair.truth.lat], [at.lon, at.lat]] },
          });
        }
      }
      m.on('load', () => {
        m!.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: lines } });
        m!.addLayer({
          id: 'lines',
          type: 'line',
          source: 'lines',
          paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
          layout: { 'line-cap': 'round' },
        });
      });
      if (!bounds.isEmpty()) m.fitBounds(bounds, { padding, maxZoom: 13, duration: 0 });
    });
    return () => {
      cancelled = true;
      m?.remove();
    };
  }, [key]);

  return <div ref={el} className="result-map" data-testid="result-map" />;
}

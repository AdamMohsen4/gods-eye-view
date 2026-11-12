/**
 * The shape of a map: every country drawn faintly, the map's own countries
 * in ink, framed on the bounds of its places. Natural Earth 1:110m outlines
 * (world-atlas) in the Equal Earth projection. Loaded on demand and cached,
 * so a grid of cards costs one fetch.
 */
import { memo, useEffect, useState } from 'react';
import type { GeoPermissibleObjects, GeoProjection } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';

interface Atlas {
  path: (p: GeoProjection) => (o: GeoPermissibleObjects) => string | null;
  equalEarth: () => GeoProjection;
  bounds: (o: GeoPermissibleObjects) => [[number, number], [number, number]];
  graticule: GeoPermissibleObjects;
  countries: { code: string | undefined; f: Feature<Geometry> }[];
}

let atlas: Promise<Atlas> | null = null;
function loadAtlas(): Promise<Atlas> {
  atlas ??= Promise.all([import('d3-geo'), import('topojson-client'), import('world-atlas/countries-110m.json'), import('i18n-iso-countries')]).then(
    ([d3, topo, data, iso]) => {
      const t = (data as unknown as { default?: unknown }).default ?? data;
      const fc = topo.feature(t as never, (t as { objects: { countries: never } }).objects.countries) as unknown as { features: Feature<Geometry, { name: string }>[] };
      const numericToAlpha2 = (iso as unknown as { default?: typeof iso }).default?.numericToAlpha2 ?? iso.numericToAlpha2;
      const extra: Record<string, string> = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };
      return {
        path: (p) => {
          const g = d3.geoPath(p);
          return (o) => g(o);
        },
        equalEarth: d3.geoEqualEarth,
        bounds: (o) => d3.geoBounds(o) as [[number, number], [number, number]],
        graticule: d3.geoGraticule10(),
        countries: fc.features.map((f) => ({ code: (f.id != null ? numericToAlpha2(String(f.id)) : undefined) ?? extra[f.properties.name], f })),
      };
    },
  );
  return atlas;
}

interface Drawn {
  base: string;
  lit: string;
  grid: string;
}

const cache = new Map<string, Drawn>();

function draw(a: Atlas, countries: string[], bounds: [number, number, number, number] | null, w: number, h: number): Drawn {
  const key = `${countries.join(',')}|${bounds?.map((n) => n.toFixed(1)).join(',')}|${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = a.equalEarth();
  const pad = Math.round(Math.min(w, h) * 0.1);
  const lonSpan = bounds ? bounds[2] - bounds[0] : 360;
  if (!bounds || lonSpan > 200) {
    p.fitExtent([[pad * 0.4, pad * 0.4], [w - pad * 0.4, h - pad * 0.4]], { type: 'Sphere' } as GeoPermissibleObjects);
  } else {
    // Frame the map's countries (only their parts near the places, so France
    // doesn't drag in French Guiana) together with the places themselves.
    const [x0, y0, x1, y1] = bounds;
    const cx = (x0 + x1) / 2;
    const near = (b: [[number, number], [number, number]]) => b[1][0] >= x0 - 12 && b[0][0] <= x1 + 12 && b[1][1] >= y0 - 12 && b[0][1] <= y1 + 12;
    const want = new Set(countries);
    const polys: number[][][][] = [];
    if (countries.length <= 12) {
      for (const c of a.countries) {
        if (!c.code || !want.has(c.code)) continue;
        const g = c.f.geometry;
        const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        for (const poly of list) if (near(a.bounds({ type: 'Polygon', coordinates: poly } as GeoPermissibleObjects))) polys.push(poly);
      }
    }
    const hw = Math.max(3, (x1 - x0) / 2);
    const hh = Math.max(3, (y1 - y0) / 2);
    const cy = (y0 + y1) / 2;
    p.rotate([-cx, 0]);
    p.fitExtent([[pad, pad], [w - pad, h - pad]], {
      type: 'GeometryCollection',
      geometries: [
        { type: 'MultiPoint', coordinates: [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]] },
        ...(polys.length ? [{ type: 'MultiPolygon', coordinates: polys }] : []),
      ],
    } as GeoPermissibleObjects);
  }
  const path = a.path(p);
  const want = new Set(countries);
  let base = '';
  let lit = '';
  for (const c of a.countries) {
    const d = path(c.f) ?? '';
    if (c.code && want.has(c.code)) lit += d;
    else base += d;
  }
  const out = { base, lit, grid: path(a.graticule) ?? '' };
  cache.set(key, out);
  return out;
}

export const MapShape = memo(function MapShape({
  countries,
  bounds,
  width = 320,
  height = 160,
  className = '',
  label,
}: {
  countries: string[];
  bounds: [number, number, number, number] | null;
  width?: number;
  height?: number;
  className?: string;
  label?: string;
}) {
  const [shape, setShape] = useState<Drawn | null>(null);
  useEffect(() => {
    let live = true;
    void loadAtlas().then((a) => live && setShape(draw(a, countries, bounds, width, height)));
    return () => {
      live = false;
    };
  }, [countries.join(','), bounds?.join(','), width, height]);
  return (
    <svg className={`map-shape ${className}`} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {shape && (
        <>
          <path className="map-shape-grid" d={shape.grid} />
          <path className="map-shape-base" d={shape.base} />
          <path className="map-shape-lit" d={shape.lit} />
        </>
      )}
    </svg>
  );
});

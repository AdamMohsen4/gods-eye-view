/**
 * Flat world map for dropping a pin. Natural Earth borders via world-atlas
 * (public domain), drawn with d3-geo; no third-party tiles, no labels.
 */
import { geoEquirectangular, geoGraticule10, geoPath, type GeoProjection } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { LatLon } from '@earthnow/shared';

const SVG_NS = 'http://www.w3.org/2000/svg';

type World = Topology<{ countries: GeometryCollection; land: GeometryCollection }>;

async function loadWorld(detail: '110m' | '50m'): Promise<World> {
  const mod =
    detail === '110m'
      ? await import('world-atlas/countries-110m.json')
      : await import('world-atlas/countries-50m.json');
  return (mod.default ?? mod) as unknown as World;
}

export interface GuessMap {
  readonly pin: LatLon | null;
  clear(): void;
  resize(): void;
  destroy(): void;
}

export function createGuessMap(host: HTMLElement, onPin: (p: LatLon) => void): GuessMap {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('guess-map');
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', 'World map. Tap or click to place your pin; drag to pan, pinch or scroll to zoom.');
  const g = document.createElementNS(SVG_NS, 'g');
  const ocean = document.createElementNS(SVG_NS, 'rect');
  ocean.setAttribute('class', 'gm-ocean');
  const grat = document.createElementNS(SVG_NS, 'path');
  grat.setAttribute('class', 'gm-graticule');
  const land = document.createElementNS(SVG_NS, 'path');
  land.setAttribute('class', 'gm-land');
  const borders = document.createElementNS(SVG_NS, 'path');
  borders.setAttribute('class', 'gm-borders');
  g.append(ocean, grat, land, borders);
  const pinG = document.createElementNS(SVG_NS, 'g');
  pinG.setAttribute('class', 'gm-pin');
  pinG.innerHTML =
    '<circle r="11" class="gm-pin-halo"/><circle r="5.5" class="gm-pin-dot"/>';
  pinG.style.display = 'none';
  svg.append(g, pinG);
  host.append(svg);

  let projection: GeoProjection = geoEquirectangular();
  let transform: ZoomTransform = zoomIdentity;
  let world: World | null = null;
  let pin: LatLon | null = null;
  let width = 0;
  let height = 0;
  let detail: '110m' | '50m' = '110m';

  function draw() {
    const path = geoPath(projection);
    ocean.setAttribute('width', String(width));
    ocean.setAttribute('height', String(height));
    const [[x0, y0], [x1, y1]] = path.bounds({ type: 'Sphere' });
    ocean.setAttribute('x', String(x0));
    ocean.setAttribute('y', String(y0));
    ocean.setAttribute('width', String(x1 - x0));
    ocean.setAttribute('height', String(y1 - y0));
    grat.setAttribute('d', path(geoGraticule10()) ?? '');
    if (world) {
      land.setAttribute('d', path(feature(world, world.objects.countries)) ?? '');
      borders.setAttribute('d', path(mesh(world, world.objects.countries, (a, b) => a !== b)) ?? '');
    }
    placePin();
  }

  function placePin() {
    if (!pin) {
      pinG.style.display = 'none';
      return;
    }
    const xy = projection([pin.lon, pin.lat]);
    if (!xy) return;
    const [x, y] = transform.apply(xy);
    pinG.setAttribute('transform', `translate(${x},${y})`);
    pinG.style.display = '';
  }

  const zoomer: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 40])
    .on('zoom', (e: { transform: ZoomTransform }) => {
      transform = e.transform;
      g.setAttribute('transform', transform.toString());
      g.style.setProperty('--k', String(transform.k));
      placePin();
      if (transform.k > 3 && detail === '110m') {
        detail = '50m';
        loadWorld('50m').then((w) => {
          world = w;
          draw();
        });
      }
    });
  const sel = select(svg as SVGSVGElement);
  sel.call(zoomer).on('dblclick.zoom', null);

  // Pin on a tap/click that did not turn into a pan or pinch. Pointer events
  // fire for mouse, pen and touch alike, alongside d3-zoom's own handlers.
  let down: { id: number; x: number; y: number; t: number } | null = null;
  let pointersDown = 0;
  svg.addEventListener('pointerdown', (e) => {
    pointersDown++;
    down = pointersDown === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
  });
  const lift = (e: PointerEvent) => {
    pointersDown = Math.max(0, pointersDown - 1);
    const d = down;
    down = null;
    if (e.type !== 'pointerup' || !d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 900) return;
    placeAt(e.clientX, e.clientY);
  };
  svg.addEventListener('pointerup', lift);
  svg.addEventListener('pointercancel', lift);

  function placeAt(clientX: number, clientY: number) {
    const r = svg.getBoundingClientRect();
    const [px, py] = transform.invert([clientX - r.left, clientY - r.top]);
    const ll = projection.invert?.([px, py]);
    if (!ll) return;
    const [lon, lat] = ll;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    pin = { lat, lon };
    placePin();
    onPin(pin);
  }

  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    if (!width || !height) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    // "Cover" fit: the map fills the panel; the rest is reachable by panning.
    const scale = Math.max(width / (2 * Math.PI), height / Math.PI);
    projection = geoEquirectangular()
      .scale(scale)
      .translate([width / 2, height / 2]);
    const mapW = 2 * Math.PI * scale;
    const mapH = Math.PI * scale;
    zoomer
      .translateExtent([
        [width / 2 - mapW / 2, height / 2 - mapH / 2],
        [width / 2 + mapW / 2, height / 2 + mapH / 2],
      ])
      .extent([
        [0, 0],
        [width, height],
      ]);
    // Re-apply the current transform so it is clamped to the new extent.
    sel.call(zoomer.transform, transform);
    draw();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  loadWorld('110m').then((w) => {
    if (detail === '110m') world = w;
    draw();
  });
  resize();

  return {
    get pin() {
      return pin;
    },
    clear() {
      pin = null;
      sel.call(zoomer.transform, zoomIdentity);
      placePin();
    },
    resize,
    destroy() {
      ro.disconnect();
      svg.remove();
    },
  };
}

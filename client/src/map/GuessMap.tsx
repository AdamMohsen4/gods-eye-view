import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { LatLon } from '@earthnow/shared';
import { mapStyle } from './style.ts';
import { pinEl } from './pins.ts';

/** Click-to-pin map. Controlled: `pin` comes from the parent. */
export function GuessMap({ pin, onPin, disabled, resizeKey }: { pin: LatLon | null; onPin: (p: LatLon) => void; disabled?: boolean; resizeKey?: unknown }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  // The map is created asynchronously; a pin set before that must still show.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let m: maplibregl.Map | null = null;
    let cancelled = false;
    void mapStyle().then((style) => {
      if (cancelled) return;
      m = new maplibregl.Map({
        container: el.current!,
        style,
        center: [10, 25],
        zoom: 0.6,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: true,
      });
      m.touchZoomRotate.disableRotation();
      const drop = (lng: number, lat: number) => {
        if (disabledRef.current) return;
        onPinRef.current({ lat, lon: ((((lng + 180) % 360) + 360) % 360) - 180 });
      };
      m.on('click', (e) => drop(e.lngLat.lng, e.lngLat.lat));
      // Keyboard play: arrows pan and +/- zoom (MapLibre), Enter drops the pin at the centre.
      m.getCanvas().setAttribute('aria-label', 'Guess map. Arrow keys move, plus and minus zoom, Enter drops your pin at the centre.');
      m.getCanvas().addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        const c = m!.getCenter();
        drop(c.lng, c.lat);
      });
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      m?.remove();
      map.current = null;
      marker.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) marker.current = new maplibregl.Marker({ element: pinEl('guess'), anchor: 'bottom' }).setLngLat([pin.lon, pin.lat]).addTo(m);
    else marker.current.setLngLat([pin.lon, pin.lat]);
  }, [pin, ready]);

  useEffect(() => {
    const id = setTimeout(() => map.current?.resize(), 220);
    return () => clearTimeout(id);
  }, [resizeKey]);

  return <div ref={el} className="guess-map" data-testid="guess-map" />;
}

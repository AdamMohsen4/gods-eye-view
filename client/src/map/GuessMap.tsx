import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
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
      m.on('click', (e) => {
        if (disabledRef.current) return;
        onPinRef.current({ lat: e.lngLat.lat, lon: ((((e.lngLat.lng + 180) % 360) + 360) % 360) - 180 });
      });
      map.current = m;
    });
    return () => {
      cancelled = true;
      m?.remove();
      map.current = null;
      marker.current = null;
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
  }, [pin]);

  useEffect(() => {
    const id = setTimeout(() => map.current?.resize(), 220);
    return () => clearTimeout(id);
  }, [resizeKey]);

  return <div ref={el} className="guess-map" data-testid="guess-map" />;
}

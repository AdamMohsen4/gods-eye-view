/**
 * Google Street View via the Maps JavaScript API. The browser key must be
 * HTTP-referrer restricted in Google Cloud. Address, road labels and the
 * "open in Maps" links are switched off during a round.
 */
import { Loader } from '@googlemaps/js-api-loader';
import type { PanoMount } from './types.ts';

let loader: Loader | null = null;

export const mountGoogle: PanoMount = async (el, { pano, move, config, onReady, onError }) => {
  if (!config.googleKey) throw new Error('Google Maps key missing');
  loader ??= new Loader({ apiKey: config.googleKey, version: 'weekly' });
  const { StreetViewPanorama, StreetViewStatus } = await loader.importLibrary('streetView');
  const canMove = move === 'move';
  const locked = move === 'nmpz';
  const container = document.createElement('div');
  container.className = 'pano-fill';
  el.appendChild(container);
  const view = new StreetViewPanorama(container, {
    pano: pano.panoId,
    pov: { heading: pano.heading, pitch: 0 },
    zoom: 0,
    addressControl: false,
    showRoadLabels: false,
    linksControl: canMove,
    clickToGo: canMove,
    disableDefaultUI: true,
    panControl: false,
    zoomControl: false,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    enableCloseButton: false,
    imageDateControl: false,
    scrollwheel: !locked,
    disableDoubleClickZoom: true,
  });
  // No-move: snap back if anything still walks (a safety net; keys are blocked below).
  if (!canMove) view.addListener('pano_changed', () => view.getPano() !== pano.panoId && view.setPano(pano.panoId));
  // Street View has no option to turn its keyboard off, so intercept keys in the
  // capture phase: no-move blocks walking keys, NMPZ blocks every key.
  const WALK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'w', 'W', 's', 'S', 'PageUp', 'PageDown']);
  if (!canMove) {
    container.addEventListener(
      'keydown',
      (e) => {
        if (locked || WALK_KEYS.has(e.key)) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
  }
  // NMPZ: a transparent shield swallows drags and pinches.
  let shield: HTMLDivElement | null = null;
  if (locked) {
    shield = document.createElement('div');
    shield.className = 'pano-shield';
    el.appendChild(shield);
  }
  view.addListener('status_changed', () => {
    const s = view.getStatus();
    if (s === StreetViewStatus.OK) onReady?.();
    else onError?.(`Street View: ${s}`);
  });
  return {
    reset() {
      view.setPano(pano.panoId);
      view.setPov({ heading: pano.heading, pitch: 0 });
      view.setZoom(0);
    },
    destroy() {
      // Release the panorama so long sessions don't pile up WebGL contexts.
      google.maps.event.clearInstanceListeners(view);
      view.setVisible(false);
      shield?.remove();
      container.remove();
    },
  };
};

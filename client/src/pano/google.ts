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
  const { StreetViewPanorama, StreetViewStatus, StreetViewService } = await loader.importLibrary('streetView');
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
  // No-move: the arrow keys and links would still walk, so snap back to the start pano.
  if (!canMove) view.addListener('pano_changed', () => view.getPano() !== pano.panoId && view.setPano(pano.panoId));
  // NMPZ: a transparent shield swallows drags and pinches.
  let shield: HTMLDivElement | null = null;
  if (locked) {
    shield = document.createElement('div');
    shield.className = 'pano-shield';
    el.appendChild(shield);
    // Arrow keys would still pan and walk.
    container.addEventListener('keydown', (e) => e.stopPropagation(), true);
    container.addEventListener('keydown', (e) => e.preventDefault(), true);
  }
  view.addListener('status_changed', () => {
    const s = view.getStatus();
    if (s === StreetViewStatus.OK) onReady?.();
    else onError?.(`Street View: ${s}`);
  });
  void StreetViewService;
  return {
    reset() {
      view.setPano(pano.panoId);
      view.setPov({ heading: pano.heading, pitch: 0 });
      view.setZoom(0);
    },
    destroy() {
      shield?.remove();
      container.remove();
    },
  };
};

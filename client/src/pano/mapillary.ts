/**
 * Mapillary viewer (MIT, imagery CC BY-SA 4.0). The built-in attribution is
 * off during a round because it links to the image page, which shows the
 * location; the reveal credits the photographer instead.
 */
import type { PanoMount } from './types.ts';

export const mountMapillary: PanoMount = async (el, { pano, move, config, onReady, onError }) => {
  if (!config.mapillaryToken) throw new Error('Mapillary token missing');
  const [{ Viewer }] = await Promise.all([import('mapillary-js'), import('mapillary-js/dist/mapillary.css')]);
  const canMove = move === 'move';
  const locked = move === 'nmpz';
  const container = document.createElement('div');
  container.className = 'pano-fill';
  el.appendChild(container);
  const viewer = new Viewer({
    accessToken: config.mapillaryToken,
    container,
    imageId: pano.panoId,
    trackResize: true,
    component: {
      attribution: false,
      bearing: false,
      cover: false,
      cache: true,
      direction: canMove ? { minWidth: 200, maxWidth: 360 } : false,
      sequence: false,
      spatial: false,
      tag: false,
      popup: false,
      marker: false,
      slider: false,
      zoom: false,
      image: true,
      keyboard: locked ? false : { keyPlay: false, keySequenceNavigation: false, keySpatialNavigation: canMove, keyZoom: true },
      pointer: locked ? false : { dragPan: true, scrollZoom: true, touchZoom: true, earthControl: false },
    },
  });
  const center = () => viewer.setCenter([(((pano.heading % 360) + 360) % 360) / 360, 0.5]);
  viewer.on('load', () => {
    center();
    onReady?.();
  });
  viewer.on('dataloading', () => {});
  viewer.moveTo(pano.panoId).catch((e: Error) => onError?.(e.message));
  return {
    reset() {
      void viewer
        .moveTo(pano.panoId)
        .then(() => {
          viewer.setZoom(0);
          center();
        })
        .catch(() => {});
    },
    destroy() {
      viewer.remove();
      container.remove();
    },
  };
};

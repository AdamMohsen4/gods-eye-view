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
  // No imageId here: with one, the viewer is "not navigable" until its own load
  // finishes and our moveTo below would be rejected. moveTo also reports errors.
  const viewer = new Viewer({
    accessToken: config.mapillaryToken,
    container,
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
  // setCenter takes image coordinates: x = 0.5 is the camera's own direction,
  // so turn the compass heading (clockwise from north) into an offset from it.
  let compass = 0;
  const center = () => {
    const x = ((((pano.heading - compass) / 360 + 0.5) % 1) + 1) % 1;
    viewer.setCenter([x, 0.5]);
  };
  let destroyed = false;
  viewer
    .moveTo(pano.panoId)
    .then((img) => {
      if (destroyed) return;
      compass = img.computedCompassAngle ?? img.compassAngle ?? 0;
      center();
      onReady?.();
    })
    .catch((e: Error) => !destroyed && onError?.(e.message));
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
      destroyed = true;
      viewer.remove();
      container.remove();
    },
  };
};

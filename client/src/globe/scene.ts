/**
 * The labelless 3D view. Loaded lazily (dynamic import) so the Home shell
 * paints before Cesium arrives.
 */
import * as Cesium from 'cesium';
import { destination, type CameraPose, type LatLon, type PublicRound, type SceneSubject } from '@earthnow/shared';
import { applyModelAtmosphereWorkaround } from '../vendor/gev/atmosphereCompat.js';
import { createKeylessTerrain } from '../vendor/gev/terrain.js';
import { installTrackpadPinchZoom } from '../vendor/gev/trackpadPinch.js';
import { MIN_HEIGHT_M, ROUND_LIMITS, clampFov, leash, renderScale, revealHeightM, revealView } from './view.ts';

type ImageryMode = 'esri' | 'offline' | 'ion';

const ESRI_WORLD_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

const ACCENT = Cesium.Color.fromCssColorString('#ff8a4c');
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function imageryMode(): ImageryMode {
  const m = String(import.meta.env.VITE_IMAGERY ?? 'esri');
  return m === 'offline' || m === 'ion' ? m : 'esri';
}

async function createBaseLayer(mode: ImageryMode): Promise<Cesium.ImageryLayer> {
  if (mode === 'offline') {
    return Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')),
      {},
    );
  }
  if (mode === 'ion' && import.meta.env.VITE_CESIUM_ION_TOKEN) {
    Cesium.Ion.defaultAccessToken = String(import.meta.env.VITE_CESIUM_ION_TOKEN);
    return Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(2), {});
  }
  // World Imagery carries no labels: exactly what a labelless round needs. The
  // ArcGIS provider detects Esri's "Map data not yet available" placeholder
  // tiles and discards them, so Cesium keeps showing the sharpest real parent.
  return Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY, { enablePickFeatures: false }),
    {},
  );
}

function radialSprite(inner: string, outer: string, size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export interface GameGlobe {
  showRound(round: PublicRound): Promise<void>;
  reveal(guess: LatLon | null, truth: LatLon): Promise<void>;
  resize(): void;
  destroy(): void;
}

export async function createGlobe(container: HTMLElement, creditContainer: HTMLElement): Promise<GameGlobe> {
  const mode = imageryMode();
  const widget = new Cesium.CesiumWidget(container, {
    baseLayer: await createBaseLayer(mode),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    creditContainer,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    shouldAnimate: false,
    msaaSamples: window.devicePixelRatio > 2 ? 1 : 4,
    // Buffer = CSS px × resolutionScale; renderScale caps it at 1.5× on dense screens.
    useBrowserRecommendedResolution: true,
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
  });
  const scene = widget.scene;
  // Mid-range phones: never render above 1.5× even on 3× screens.
  widget.resolutionScale = renderScale(window.devicePixelRatio);
  applyModelAtmosphereWorkaround(scene);
  scene.globe.enableLighting = true;
  // Floor for the unlit side: night rounds stay readable, the terminator still shows.
  scene.globe.vertexShadowDarkness = 0.5;
  scene.globe.showGroundAtmosphere = true;
  scene.skyAtmosphere!.show = true;
  scene.fog.enabled = true;
  scene.globe.depthTestAgainstTerrain = false;
  // Fewer, coarser tiles: the biggest win for load time on phones and 4G. Oblique
  // views otherwise request tiles all the way to the horizon.
  scene.globe.maximumScreenSpaceError = window.devicePixelRatio > 2 ? 5 : 4;
  scene.globe.tileCacheSize = 400;
  scene.globe.preloadSiblings = false;
  scene.fog.density = 3.5e-4;
  scene.fog.screenSpaceErrorFactor = 4;
  // Both tile hosts speak HTTP/2; let more requests run in parallel than Cesium's default.
  for (const host of ['services.arcgisonline.com:443', 'terrain.reearth.land:443'])
    Cesium.RequestScheduler.requestsByServer[host] = 36;

  if (mode !== 'offline') {
    createKeylessTerrain()
      .then((t: { provider: Cesium.TerrainProvider }) => {
        if (!widget.isDestroyed()) {
          widget.terrainProvider = t.provider;
          scene.requestRender();
        }
      })
      .catch(() => undefined);
  }

  const controller = scene.screenSpaceCameraController;
  const disposePinch = installTrackpadPinchZoom(widget);
  const camera = scene.camera;
  const frustum = camera.frustum as Cesium.PerspectiveFrustum;

  /* ------------- free, leashed navigation during a round ------------- */
  // Players pan, zoom and tilt with Cesium's standard controls (drag, scroll,
  // pinch, right-drag / two-finger tilt). After every camera move we clamp
  // height and pull the camera back if it strays beyond the leash.
  let limits: { anchor: LatLon; maxHeightM: number; leashKm: number } | null = null;
  const canvas = widget.canvas;
  canvas.style.touchAction = 'none';
  scene.preRender.addEventListener(() => {
    if (!limits) return;
    const c = camera.positionCartographic;
    const at = { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude) };
    const back = leash(limits.anchor, at, limits.leashKm);
    const height = Math.min(limits.maxHeightM, Math.max(MIN_HEIGHT_M, c.height));
    if (!back && height === c.height) return;
    const to = back ?? at;
    camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(to.lon, to.lat, height),
      orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
    });
  });

  // Camera height (rounded to 100 m) for e2e checks; no lat/lon is exposed.
  camera.percentageChanged = 0.01;
  camera.changed.addEventListener(() => {
    document.body.dataset.cameraHeight = String(Math.round(camera.positionCartographic.height / 100) * 100);
  });

  function enableRoundControls(maxHeightM: number) {
    controller.enableInputs = true;
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableLook = true;
    controller.minimumZoomDistance = MIN_HEIGHT_M;
    controller.maximumZoomDistance = maxHeightM;
  }

  /* ---------------------------- animation loop --------------------------- */
  const frameHooks: Array<() => void> = [];
  scene.preUpdate.addEventListener(() => frameHooks.forEach((f) => f()));
  let animating = false;
  let raf = 0;
  const loop = () => {
    if (!animating || widget.isDestroyed()) return;
    scene.requestRender();
    raf = requestAnimationFrame(loop);
  };
  function setAnimating(on: boolean) {
    animating = on && !reducedMotion();
    cancelAnimationFrame(raf);
    if (animating) raf = requestAnimationFrame(loop);
  }

  const glow = radialSprite('rgba(255,236,200,1)', 'rgba(255,120,40,0)');
  const smoke = radialSprite('rgba(206,200,192,0.62)', 'rgba(170,166,160,0)');

  function subjectPosition(pose: CameraPose, subject: SceneSubject): Cesium.Cartesian3 {
    const origin = new Cesium.Cartesian3(...pose.position);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    return Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(...subject.offsetEnu), new Cesium.Cartesian3());
  }

  function drawSubject(round: PublicRound) {
    const pos = subjectPosition(round.camera, round.subject);
    const s = round.subject;
    const t0 = performance.now();
    const ents = widget.entities;
    switch (s.kind) {
      case 'flight': {
        // The glb is baked nose −X (glTF frame). Cesium turns glTF +Z forward into
        // model +X, which leaves the nose pointing south at heading 0: add 180°.
        const heading = Cesium.Math.toRadians((s.headingDeg ?? 0) + 180);
        ents.add({
          position: pos,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(heading, 0, 0)),
          model: { uri: '/models/b789.glb', minimumPixelSize: 96, maximumScale: 1 },
        });
        break;
      }
      case 'satellite': {
        // The scene is the ground under the spacecraft: its nadir point, the
        // ground track it is following, and a faint beam up towards it.
        const sub = Cesium.Cartographic.fromCartesian(pos);
        const here = { lat: Cesium.Math.toDegrees(sub.latitude), lon: Cesium.Math.toDegrees(sub.longitude) };
        const hdg = s.headingDeg ?? 0;
        const ahead = destination(here, hdg, 900);
        const behind = destination(here, (hdg + 180) % 360, 900);
        const SKY = Cesium.Color.fromCssColorString('#cfe2ff');
        ents.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([behind.lon, behind.lat, here.lon, here.lat, ahead.lon, ahead.lat]),
            width: 3,
            clampToGround: true,
            material: new Cesium.PolylineGlowMaterialProperty({ color: SKY.withAlpha(0.75), glowPower: 0.25 }),
          },
        });
        ents.add({
          polyline: {
            positions: [Cesium.Cartesian3.fromDegrees(here.lon, here.lat, 0), Cesium.Cartesian3.fromDegrees(here.lon, here.lat, 70_000)],
            width: 8,
            material: new Cesium.PolylineGlowMaterialProperty({ color: SKY.withAlpha(0.35), glowPower: 0.2 }),
          },
        });
        // A slow marker travelling along the track shows direction of motion.
        const travel = new Cesium.CallbackProperty(() => {
          const ph = (((performance.now() - t0) / 6000) % 1 + 1) % 1;
          const p = destination(behind, hdg, ph * 1800);
          return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0);
        }, false) as unknown as Cesium.PositionProperty;
        ents.add({ position: travel, point: { pixelSize: 7, color: SKY, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
        ents.add({
          position: pos,
          point: {
            pixelSize: 12,
            color: Cesium.Color.WHITE,
            outlineColor: SKY.withAlpha(0.5),
            outlineWidth: 6,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        setAnimating(true);
        break;
      }
      case 'quake': {
        const mag = s.intensity ?? 5;
        const maxR = Math.min(60_000, 9_000 * Math.pow(1.6, mag - 4.5));
        const period = 3600;
        // Ring radii are computed once per frame so both axes always agree.
        const rings = [0, 1, 2].map(() => ({ r: 400, a: 0 }));
        const update = () => {
          const now = performance.now();
          rings.forEach((ring, i) => {
            const ph = ((((now - t0) / period + i / 3) % 1) + 1) % 1;
            ring.r = 400 + maxR * easeOut(ph);
            ring.a = 0.32 * (1 - ph);
          });
        };
        update();
        frameHooks.push(update);
        for (const ring of rings) {
          ents.add({
            position: pos,
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(() => ring.r, false),
              semiMinorAxis: new Cesium.CallbackProperty(() => ring.r, false),
              height: 0,
              fill: true,
              material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => ACCENT.withAlpha(ring.a), false)),
            },
          });
        }
        ents.add({
          position: pos,
          point: { pixelSize: 9, color: ACCENT, outlineColor: Cesium.Color.WHITE.withAlpha(0.9), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
        setAnimating(true);
        break;
      }
      case 'fire': {
        const frp = s.intensity ?? 50;
        const k = Math.min(1.8, 0.8 + Math.log10(Math.max(10, frp)) / 3);
        ents.add({
          position: pos,
          billboard: {
            image: glow,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            scale: new Cesium.CallbackProperty(() => k * (0.42 + 0.04 * Math.sin((performance.now() - t0) / 900)), false),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        for (let i = 1; i <= 5; i++) {
          ents.add({
            position: pos,
            billboard: {
              image: smoke,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              pixelOffset: new Cesium.CallbackProperty(
                () => new Cesium.Cartesian2(i * 9 + 4 * Math.sin((performance.now() - t0) / 2400 + i), -i * 26 * k),
                false,
              ),
              scale: 0.6 * k + i * 0.35 * k,
              color: Cesium.Color.WHITE.withAlpha(0.9 - i * 0.12),
            },
          });
        }
        setAnimating(true);
        break;
      }
    }
  }

  /**
   * Real sunlight by day. At night a dim, cool "moonlight" from above keeps
   * the ground readable; the night itself is still obvious (stars, colour).
   */
  const sunLight = new Cesium.SunLight();
  function applyLighting(time: Cesium.JulianDate, at: Cesium.Cartesian3) {
    const sunInertial = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time);
    const toFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(time);
    const sun = Cesium.Matrix3.multiplyByVector(toFixed, sunInertial, new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.normalize(at, new Cesium.Cartesian3());
    const toSun = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(sun, at, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const sunElevation = Math.asin(Cesium.Math.clamp(Cesium.Cartesian3.dot(up, toSun), -1, 1));
    if (sunElevation > Cesium.Math.toRadians(-4)) {
      scene.light = sunLight;
      scene.globe.dynamicAtmosphereLightingFromSun = true;
      return;
    }
    // Light straight down onto the scene, slightly cool, at reduced intensity.
    scene.light = new Cesium.DirectionalLight({
      direction: Cesium.Cartesian3.negate(up, new Cesium.Cartesian3()),
      color: Cesium.Color.fromCssColorString('#c9d6ff'),
      intensity: 1.15,
    });
    scene.globe.dynamicAtmosphereLightingFromSun = false;
  }

  async function showRound(round: PublicRound) {
    setAnimating(false);
    frameHooks.length = 0;
    widget.entities.removeAll();
    const time = Cesium.JulianDate.fromIso8601(round.sceneTime);
    widget.clock.currentTime = time;
    scene.globe.enableLighting = true;
    applyLighting(time, subjectPosition(round.camera, round.subject));
    const p = round.camera;
    camera.setView({
      destination: new Cesium.Cartesian3(...p.position),
      orientation: { heading: p.heading, pitch: p.pitch, roll: 0 },
    });
    frustum.fov = Cesium.Math.toRadians(clampFov(p.fov));
    const anchorCarto = Cesium.Cartographic.fromCartesian(subjectPosition(round.camera, round.subject));
    const lim = ROUND_LIMITS[round.type];
    limits = {
      anchor: { lat: Cesium.Math.toDegrees(anchorCarto.latitude), lon: Cesium.Math.toDegrees(anchorCarto.longitude) },
      ...lim,
    };
    enableRoundControls(lim.maxHeightM);
    drawSubject(round);
    scene.requestRender();
    // Performance marks for measuring (scripts/measure-tti.mjs and e2e): round shown → all tiles in.
    performance.mark('round-shown');
    const removeMark = scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
      if (queued === 0) {
        performance.mark('tiles-settled');
        removeMark();
      }
    });
    // Lift the veil once the first tiles are in; the rest stream in while the player looks.
    await tilesSettled(3500);
  }

  function tilesSettled(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const remove = scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
        if (queued === 0 || performance.now() - start > timeoutMs) {
          remove();
          resolve();
        }
      });
      setTimeout(() => {
        remove();
        resolve();
      }, timeoutMs);
    });
  }

  function marker(at: LatLon, color: Cesium.Color, size: number) {
    widget.entities.add({
      position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, 0),
      point: {
        pixelSize: size,
        color,
        outlineColor: Cesium.Color.fromCssColorString('#070b16'),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  async function reveal(guess: LatLon | null, truth: LatLon) {
    setAnimating(false);
    frameHooks.length = 0;
    limits = null;
    widget.entities.removeAll();
    frustum.fov = Cesium.Math.toRadians(60);
    scene.globe.enableLighting = false;
    scene.light = sunLight;
    const truthColor = ACCENT;
    if (guess) {
      widget.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([guess.lon, guess.lat, truth.lon, truth.lat]),
          width: 2.5,
          arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.WHITE.withAlpha(0.85), dashLength: 14 }),
        },
      });
      marker(guess, Cesium.Color.WHITE, 12);
    }
    marker(truth, truthColor, 16);
    const height = revealHeightM(guess, truth);
    const start = guess ?? truth;
    camera.setView({ destination: Cesium.Cartesian3.fromDegrees(start.lon, start.lat, height * 0.8) });
    scene.requestRender();
    // Free exploration after the reveal: orbit and zoom with the standard controls.
    controller.enableInputs = true;
    controller.minimumZoomDistance = 2_000;
    controller.maximumZoomDistance = 40_000_000;
    const end = revealView(guess, truth, !matchMedia('(min-width: 900px)').matches);
    await new Promise<void>((resolve) => {
      camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(end.lon, end.lat, end.height),
        duration: reducedMotion() ? 0 : 2.4,
        easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
        complete: () => resolve(),
        cancel: () => resolve(),
      });
    });
    scene.requestRender();
  }

  return {
    showRound,
    reveal,
    resize: () => {
      widget.resize();
      scene.requestRender();
    },
    destroy: () => {
      setAnimating(false);
      disposePinch();
      widget.destroy();
    },
  };
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

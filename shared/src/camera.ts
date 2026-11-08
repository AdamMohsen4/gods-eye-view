import type { CameraPose, LatLon, RoundType, SceneSubject } from './types.ts';
import { destination, ecefToGeodetic, geodeticToEcef } from './geo.ts';
import { seededRandom } from './random.ts';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * Every rendered coordinate is displaced from the truth by at least this much.
 * The client renders real imagery, so a determined player can always work out
 * roughly where the camera is from tile requests (see docs/ADR-002). The
 * displacement guarantees no pre-guess payload ever contains the true point.
 */
export const MIN_DISPLACEMENT_KM = 6;

const DISPLACEMENT_KM: Record<RoundType, [number, number]> = {
  flight: [8, 20],
  quake: [8, 20],
  fire: [6, 15],
  satellite: [15, 40],
};

type Vec3 = [number, number, number];

/** ECEF delta `target − origin` rotated into the local ENU frame at `originGeo`. */
export function ecefToEnu(origin: Vec3, originGeo: LatLon, target: Vec3): Vec3 {
  const φ = originGeo.lat * D2R;
  const λ = originGeo.lon * D2R;
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const e = -Math.sin(λ) * dx + Math.cos(λ) * dy;
  const n = -Math.sin(φ) * Math.cos(λ) * dx - Math.sin(φ) * Math.sin(λ) * dy + Math.cos(φ) * dz;
  const u = Math.cos(φ) * Math.cos(λ) * dx + Math.cos(φ) * Math.sin(λ) * dy + Math.sin(φ) * dz;
  return [e, n, u];
}

/** Inverse of ecefToEnu: ENU offset at `originGeo` → absolute ECEF. */
export function enuToEcef(origin: Vec3, originGeo: LatLon, enu: Vec3): Vec3 {
  const φ = originGeo.lat * D2R;
  const λ = originGeo.lon * D2R;
  const [e, n, u] = enu;
  return [
    origin[0] - Math.sin(λ) * e - Math.sin(φ) * Math.cos(λ) * n + Math.cos(φ) * Math.cos(λ) * u,
    origin[1] + Math.cos(λ) * e - Math.sin(φ) * Math.sin(λ) * n + Math.cos(φ) * Math.sin(λ) * u,
    origin[2] + Math.cos(φ) * n + Math.sin(φ) * u,
  ];
}

export interface PoseInput {
  type: RoundType;
  truth: LatLon;
  /** Object altitude in metres (aircraft or satellite); 0 for ground events. */
  altitudeM: number;
  /** Track over ground in degrees, if known. */
  headingDeg?: number;
  intensity?: number;
  /** Seed so a snapshot always gets the same displacement. */
  seed: string;
}

export interface PoseOutput {
  camera: CameraPose;
  subject: SceneSubject;
  /** The displaced point the scene is built around (kept server-side only). */
  anchor: LatLon;
}

function lookAt(cameraGeo: LatLon, cameraH: number, targetGeo: LatLon, targetH: number) {
  const cam = geodeticToEcef(cameraGeo, cameraH);
  const tgt = geodeticToEcef(targetGeo, targetH);
  const enu = ecefToEnu(cam, cameraGeo, tgt);
  const heading = Math.atan2(enu[0], enu[1]);
  const pitch = Math.atan2(enu[2], Math.hypot(enu[0], enu[1]));
  return { cam, enu, heading, pitch };
}

/** Build the displaced camera pose and subject offset for a snapshot. */
export function buildPose(input: PoseInput): PoseOutput {
  const rnd = seededRandom(input.seed);
  const [dMin, dMax] = DISPLACEMENT_KM[input.type];
  const anchor = destination(input.truth, rnd() * 360, dMin + rnd() * (dMax - dMin));
  const track = Number.isFinite(input.headingDeg) ? (input.headingDeg as number) : rnd() * 360;

  switch (input.type) {
    case 'flight': {
      // Chase view: camera just behind and above the aircraft, looking along track.
      const camGeo = destination(anchor, (track + 180) % 360, 0.16);
      const camH = input.altitudeM + 35;
      const { cam, enu } = lookAt(camGeo, camH, anchor, input.altitudeM);
      return {
        anchor,
        camera: { position: cam, heading: track * D2R, pitch: -7 * D2R, roll: 0, fov: 62 },
        subject: { kind: 'flight', offsetEnu: round3(enu), headingDeg: track },
      };
    }
    case 'satellite': {
      // Just behind the spacecraft, looking forward and steeply down.
      const camGeo = destination(anchor, (track + 180) % 360, 0.5);
      const camH = input.altitudeM + 120;
      const { cam, enu } = lookAt(camGeo, camH, anchor, input.altitudeM);
      return {
        anchor,
        camera: { position: cam, heading: track * D2R, pitch: -62 * D2R, roll: 0, fov: 60 },
        subject: { kind: 'satellite', offsetEnu: round3(enu), headingDeg: track },
      };
    }
    case 'quake':
    case 'fire': {
      const backKm = input.type === 'quake' ? 70 : 22;
      const camH = input.type === 'quake' ? 42_000 : 7_500;
      const camGeo = destination(anchor, rnd() * 360, backKm);
      const { cam, enu, heading, pitch } = lookAt(camGeo, camH, anchor, 0);
      return {
        anchor,
        camera: { position: cam, heading, pitch, roll: 0, fov: 60 },
        subject: { kind: input.type, offsetEnu: round3(enu), intensity: input.intensity },
      };
    }
  }
}

function round3(v: Vec3): Vec3 {
  return [Math.round(v[0] * 10) / 10, Math.round(v[1] * 10) / 10, Math.round(v[2] * 10) / 10];
}

/** Absolute geodetic point of the subject, reconstructed the way the client does. */
export function subjectGeo(camera: CameraPose, subject: SceneSubject): LatLon & { heightM: number } {
  const camGeo = ecefToGeodetic(camera.position);
  return ecefToGeodetic(enuToEcef(camera.position, camGeo, subject.offsetEnu));
}

export function cameraGeo(camera: CameraPose): LatLon & { heightM: number } {
  return ecefToGeodetic(camera.position);
}

export { R2D };

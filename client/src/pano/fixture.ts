/**
 * Generated panorama for dev and tests (no imagery keys). A seeded landscape
 * painted on a 360° strip; drag to look around, wheel to zoom.
 */
import { seededRandom } from '@earthnow/shared';
import type { PanoMount } from './types.ts';

const W = 2400;
const H = 800;

function paint(seed: string): HTMLCanvasElement {
  const rnd = seededRandom(seed);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const hue = Math.floor(rnd() * 360);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, `hsl(${(hue + 200) % 360} 45% 62%)`);
  sky.addColorStop(1, `hsl(${(hue + 190) % 360} 35% 86%)`);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // Ridges, wrapped so the strip tiles seamlessly.
  for (let layer = 0; layer < 3; layer++) {
    const base = H * (0.42 + layer * 0.05);
    const amp = 70 - layer * 18;
    const f1 = 1 + Math.floor(rnd() * 3);
    const f2 = 3 + Math.floor(rnd() * 5);
    const p1 = rnd() * Math.PI * 2;
    const p2 = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const t = (x / W) * Math.PI * 2;
      g.lineTo(x, base - amp * (0.6 * Math.sin(f1 * t + p1) + 0.4 * Math.sin(f2 * t + p2)));
    }
    g.lineTo(W, H);
    g.fillStyle = `hsl(${(hue + 90 + layer * 10) % 360} ${25 + layer * 10}% ${48 - layer * 9}%)`;
    g.fill();
  }
  // Ground and a road that runs away from the camera.
  g.fillStyle = `hsl(${(hue + 70) % 360} 22% 34%)`;
  g.fillRect(0, H * 0.58, W, H * 0.42);
  const roadX = rnd() * W;
  for (const off of [0, W, -W]) {
    g.beginPath();
    g.moveTo(roadX + off - 30, H * 0.58);
    g.lineTo(roadX + off + 30, H * 0.58);
    g.lineTo(roadX + off + 260, H);
    g.lineTo(roadX + off - 260, H);
    g.fillStyle = '#3d3d3f';
    g.fill();
    g.setLineDash([24, 26]);
    g.strokeStyle = '#e9e1c9';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(roadX + off, H * 0.6);
    g.lineTo(roadX + off, H);
    g.stroke();
    g.setLineDash([]);
  }
  // Poles and boxes so there's something to look at.
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W;
    const h = 60 + rnd() * 140;
    g.fillStyle = `hsl(${Math.floor(rnd() * 360)} 20% ${30 + rnd() * 40}%)`;
    if (rnd() < 0.5) g.fillRect(x, H * 0.58 - h, 6, h);
    else g.fillRect(x, H * 0.58 - h * 0.6, 40 + rnd() * 90, h * 0.6);
  }
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.font = '600 22px "IBM Plex Mono", monospace';
  g.fillText('TEST PANORAMA', 40, H - 40);
  return c;
}

export const mountFixture: PanoMount = async (el, { pano, move, onReady }) => {
  const strip = paint(pano.panoId);
  const canvas = document.createElement('canvas');
  canvas.className = 'pano-canvas';
  canvas.setAttribute('aria-label', 'Panorama');
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const start = { yaw: (pano.heading / 360) * W, zoom: 1 };
  let yaw = start.yaw;
  let zoom = 1;
  let pitch = 0;
  const locked = move === 'nmpz';

  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    // Show ~100° horizontally at zoom 1.
    // Fill the screen: ~100° across on landscape, full strip height on portrait.
    const scale = Math.max((cw * dpr) / ((W * 100) / 360 / zoom), (ch * dpr) / H);
    const sh = (ch * dpr) / scale;
    const sy = Math.max(0, Math.min(H - sh, H / 2 - sh / 2 + pitch));
    const sx = ((yaw % W) + W) % W;
    const sw = (cw * dpr) / scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(strip, sx, sy, Math.min(sw, W - sx), sh, 0, 0, Math.min(sw, W - sx) * scale, ch * dpr);
    if (sw > W - sx) ctx.drawImage(strip, 0, sy, sw - (W - sx), sh, (W - sx) * scale, 0, (sw - (W - sx)) * scale, ch * dpr);
  };

  let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (locked) return;
    drag = { x: e.clientX, y: e.clientY, yaw, pitch };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    yaw = drag.yaw - ((e.clientX - drag.x) * 1.4) / zoom;
    // The strip is only so tall; clamp so dragging back responds immediately.
    pitch = Math.max(-H / 2, Math.min(H / 2, drag.pitch - (e.clientY - drag.y) / zoom));
    draw();
  };
  const onUp = () => (drag = null);
  const onWheel = (e: WheelEvent) => {
    if (locked) return;
    e.preventDefault();
    zoom = Math.max(1, Math.min(3, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    draw();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const ro = new ResizeObserver(draw);
  ro.observe(el);
  draw();
  onReady?.();
  return {
    reset() {
      yaw = start.yaw;
      zoom = 1;
      pitch = 0;
      draw();
    },
    destroy() {
      ro.disconnect();
      canvas.remove();
    },
  };
};

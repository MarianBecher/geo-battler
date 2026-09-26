// The atlas behind the passport and the lobby.
//
// On the table under the passport lies a world map in blue-grey: country
// outlines from public/geo/world.json (the same ones as on the printed map
// of the profile, see maps/worldmap.ts), so pale that the passport rests
// calmly on top. It turns once around the earth in six minutes - too slowly
// to see, but after the second beer a different continent stands behind the
// passport. Every few seconds a travel route draws itself as a great circle
// between two cities, like an entry in the passport, and fades again.
//
// One canvas per screen; all share the clock and the routes. Only what is
// visible gets drawn: a hidden screen has zero width. Whoever asks for less
// motion gets the map standing still and without routes.

import { fetchWorld, naturalEarth, NE_HALF_HEIGHT, NE_HALF_WIDTH } from '../maps/projection.ts';

/** [lng, lat] in degrees. */
export type LngLat = [lng: number, lat: number];

const TURN_MS = 360_000; // one turn in six minutes
const INK = '#aab6cc'; // --cover-muted
const ROUTE_INK = '#e8efe7'; // --cover-text
const MAP_ALPHA = 0.25;
const GRID_ALPHA = MAP_ALPHA * 0.45;
const ROUTE_ALPHA = 0.75;
const ROUTE = { draw: 3800, hold: 2800, fade: 1800, steps: 80 };
const ROUTE_TOTAL = ROUTE.draw + ROUTE.hold + ROUTE.fade;
const STILL_LNG = 20;
const R = Math.PI / 180;

/** Cities the routes are drawn between - across every continent. */
const CITIES: readonly LngLat[] = [
  [13.4, 52.5], [139.7, 35.7], [-74, 40.7], [18.4, -33.9], [151.2, -33.9],
  [-77, -12], [-21.9, 64.1], [72.9, 19.1], [36.8, -1.3], [-149.9, 61.2],
  [-58.4, -34.6], [106.9, 47.9], [-9.1, 38.7], [-157.9, 21.3], [31.2, 30],
  [103.8, 1.4], [-99.1, 19.4], [10.7, 59.9], [115.9, -31.9], [-60, -3.1],
];

const wrapLng = (lng: number): number => ((lng + 540) % 360) - 180;

/** Great circle between two points, in `n` steps (n + 1 points, both ends included). */
export function greatCircle(a: LngLat, b: LngLat, n: number): LngLat[] {
  const v = ([lng, lat]: LngLat): [number, number, number] =>
    [Math.cos(lat * R) * Math.cos(lng * R), Math.cos(lat * R) * Math.sin(lng * R), Math.sin(lat * R)];
  const A = v(a);
  const B = v(b);
  const om = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  // The same point twice: nothing to interpolate (and sin(0) would divide by zero).
  if (om < 1e-9) return Array.from({ length: n + 1 }, (): LngLat => [a[0], a[1]]);
  const pts: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin((1 - t) * om) / Math.sin(om);
    const s2 = Math.sin(t * om) / Math.sin(om);
    const x = A[0] * s1 + B[0] * s2;
    const y = A[1] * s1 + B[1] * s2;
    const z = A[2] * s1 + B[2] * s2;
    pts.push([Math.atan2(y, x) / R, Math.asin(Math.max(-1, Math.min(1, z))) / R]);
  }
  return pts;
}

interface Route {
  pts: LngLat[];
  t0: number;
}

class Backdrop {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private cx = 0;
  private cy = 0;

  constructor(screen: HTMLElement, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = ctx;
    screen.prepend(canvas);
    new ResizeObserver(() => { this.resize(); }).observe(canvas);
  }

  static create(screen: HTMLElement): Backdrop | null {
    const canvas = document.createElement('canvas');
    canvas.className = 'backdrop';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    return ctx ? new Backdrop(screen, ctx, canvas) : null;
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    // The map fills the screen like background-size: cover, with a little room to spare.
    this.scale = Math.max(this.w / (2 * NE_HALF_WIDTH), this.h / (2 * NE_HALF_HEIGHT)) * 1.08;
    this.cx = this.w / 2;
    this.cy = this.h / 2;
  }

  private project(lng: number, lat: number, lng0: number): [number, number] {
    const [x, y] = naturalEarth(wrapLng(lng - lng0), lat);
    return [this.cx + x * this.scale, this.cy - y * this.scale];
  }

  /** One polyline; when it jumps across the edge of the map, a new stroke begins. */
  private trace(pts: readonly LngLat[], lng0: number, close: boolean): void {
    const { ctx } = this;
    const limit = this.scale * 2;
    let prev: [number, number] | null = null;
    const n = close ? pts.length + 1 : pts.length;
    for (let i = 0; i < n; i++) {
      const [lng, lat] = pts[i % pts.length]!;
      const q = this.project(lng, lat, lng0);
      if (!prev || Math.abs(q[0] - prev[0]) > limit) ctx.moveTo(q[0], q[1]);
      else ctx.lineTo(q[0], q[1]);
      prev = q;
    }
  }

  draw(world: readonly LngLat[][], lng0: number, routes: readonly Route[], now: number): void {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Graticule every 30 degrees, and the edge of the map
    ctx.strokeStyle = INK;
    ctx.globalAlpha = GRID_ALPHA;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let lat = -60; lat <= 60; lat += 30) this.trace(Array.from({ length: 121 }, (_, i): LngLat => [i * 3 - 180, lat]), lng0, false);
    for (let lng = -180; lng < 180; lng += 30) this.trace(Array.from({ length: 55 }, (_, i): LngLat => [lng, i * 3 - 81]), lng0, false);
    const edge: LngLat[] = [];
    for (let lat = -90; lat <= 90; lat += 3) edge.push([lng0 + 179.99, lat]);
    for (let lat = 90; lat >= -90; lat -= 3) edge.push([lng0 - 179.99, lat]);
    this.trace(edge, lng0, true);
    ctx.stroke();

    // Country outlines
    ctx.globalAlpha = MAP_ALPHA;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (const ring of world) this.trace(ring, lng0, true);
    ctx.stroke();

    // Travel routes: first draw, then stay a while, then fade.
    ctx.strokeStyle = ROUTE_INK;
    ctx.fillStyle = ROUTE_INK;
    for (const r of routes) {
      const age = now - r.t0;
      const k = Math.min(1, age / ROUTE.draw);
      const eased = 1 - (1 - k) ** 3;
      const alpha = age < ROUTE.draw + ROUTE.hold ? Math.min(1, age / 400) : 1 - (age - ROUTE.draw - ROUTE.hold) / ROUTE.fade;
      const tip = Math.max(1, Math.round(eased * ROUTE.steps));
      const start = r.pts[0];
      const end = r.pts[tip];
      if (!start || !end) continue;
      ctx.globalAlpha = alpha * ROUTE_ALPHA;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      this.trace(r.pts.slice(0, tip + 1), lng0, false);
      ctx.stroke();
      ctx.setLineDash([]);
      const from = this.project(start[0], start[1], lng0);
      ctx.beginPath();
      ctx.arc(from[0], from[1], 3, 0, 7);
      ctx.fill();
      // The tip travels along; at the destination a ring pulses like a stamp.
      const head = this.project(end[0], end[1], lng0);
      ctx.beginPath();
      ctx.arc(head[0], head[1], k < 1 ? 2.4 : 3, 0, 7);
      ctx.fill();
      if (k >= 1) {
        const pulse = Math.min(1, (age - ROUTE.draw) / 1500);
        ctx.globalAlpha = alpha * ROUTE_ALPHA * (1 - pulse);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(head[0], head[1], 4 + pulse * 18, 0, 7);
        ctx.stroke();
      }
    }

    // The middle stays clear, so the passport does not lie on lines.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(w / 2, h * 0.48, 0, w / 2, h * 0.48, Math.max(w, h) * 0.42);
    g.addColorStop(0, 'rgba(0,0,0,.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/**
 * Lay the atlas under the given screens (by element id). Missing screens are
 * skipped; if the outlines cannot be loaded there simply is no backdrop.
 */
export async function startBackdrop(screenIds: string[]): Promise<void> {
  const screens = screenIds.map((id) => document.getElementById(id)).filter((el) => el !== null);
  if (!screens.length) return;
  let countries;
  try {
    ({ countries } = await fetchWorld());
  } catch {
    return; // decoration only - the game works without it
  }
  // Tenth-of-a-degree pairs to degrees; everything small stays out - in the background the coast is enough.
  const world = countries.flatMap((c) => c.r)
    .filter((flat) => flat.length >= 12)
    .map((flat) => {
      const pts: LngLat[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i]! / 10, flat[i + 1]! / 10]);
      return pts;
    });

  const layers = screens.map((s) => Backdrop.create(s)).filter((l) => l !== null);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (still) {
    // Without motion one picture is enough - but only once the screen has a size.
    for (const l of layers) new ResizeObserver(() => { l.draw(world, STILL_LNG, [], 0); }).observe(l.canvas);
    return;
  }

  const routes: Route[] = [];
  const t0 = performance.now();
  let nextRoute = t0 + 1500;

  const frame = (now: number): void => {
    const lng0 = (STILL_LNG + ((now - t0) / TURN_MS) * 360) % 360;
    if (now > nextRoute) {
      const a = pick(CITIES);
      let b = pick(CITIES);
      while (b === a) b = pick(CITIES);
      routes.push({ pts: greatCircle(a, b, ROUTE.steps), t0: now });
      nextRoute = now + 6000 + Math.random() * 4000;
    }
    while (routes[0] && now - routes[0].t0 > ROUTE_TOTAL) routes.shift();
    for (const l of layers) l.draw(world, lng0, routes, now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

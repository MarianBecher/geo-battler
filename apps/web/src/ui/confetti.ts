// A short shower of confetti - for the round winner and the overall winner.
//
// Deliberately without a library: the game runs on the local network, and
// nothing should have to be fetched from a CDN.

const GRAVITY = 0.28;
const DRAG = 0.992;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  spin: number;
  rot: number;
}

export interface BurstOptions {
  /** Colours of the shower - we use the winner's player colour. */
  colors?: readonly string[];
  durationMs?: number;
  count?: number;
}

/** Respects the system setting "reduce motion". */
const motionAllowed = (): boolean => !matchMedia('(prefers-reduced-motion: reduce)').matches;

function makePieces(count: number, colors: readonly string[], width: number, height: number): Piece[] {
  const pieces: Piece[] = [];
  // Two fountains from the bottom left and right - they meet in the middle.
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    const power = 13 + Math.random() * 11;
    const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 34;
    const rad = (angle * Math.PI) / 180;
    pieces.push({
      x: fromLeft ? width * 0.12 : width * 0.88,
      y: height + 10,
      vx: -Math.cos(rad) * power * (fromLeft ? 1 : -1),
      vy: Math.sin(rad) * power,
      w: 6 + Math.random() * 6,
      h: 9 + Math.random() * 7,
      color: colors[i % colors.length] ?? '#e24b4b',
      spin: (Math.random() - 0.5) * 0.32,
      rot: Math.random() * Math.PI,
    });
  }
  return pieces;
}

/** Fire confetti once. It runs out by itself and cleans up after itself. */
export function burst({ colors = ['#e24b4b'], durationMs = 1800, count = 90 }: BurstOptions = {}): void {
  if (!motionAllowed()) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.appendChild(canvas);

  const usable = colors.filter(Boolean);
  const pieces = makePieces(count, usable.length ? usable : ['#e24b4b'], canvas.width, canvas.height);
  const startedAt = performance.now();

  const frame = (now: number): void => {
    const elapsed = now - startedAt;
    if (elapsed > durationMs) {
      canvas.remove();
      return;
    }

    // Fade out over the last 400 ms, so nothing disappears abruptly.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = Math.min(1, (durationMs - elapsed) / 400);

    for (const p of pieces) {
      p.vy += GRAVITY;
      p.vx *= DRAG;
      p.vy *= DRAG;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

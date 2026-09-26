// Small DOM helpers shared by the screens.

/** `document.getElementById`, but throws on a missing id - every id here is static markup. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Does the system ask for less motion? Animations and confetti respect it. */
export const motionAllowed = (): boolean => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Forces a layout pass, so a class removed and re-added restarts its animation. */
export const reflow = (el: HTMLElement): number => el.offsetWidth;

/** Restart a CSS animation by removing and re-adding its class. */
export function replay(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  reflow(el);
  el.classList.add(className);
}

/** Ink or white on `hex` - whichever has the larger contrast. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#1f2d4d';
  const lin = (i: number): number => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  // At this luminance ink (#1f2d4d) and white have equal contrast.
  return lum > 0.23 ? '#1f2d4d' : '#ffffff';
}

let toastHandle: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, tone: 'good' | 'bad' = 'bad'): void {
  const el = $('toast');
  el.textContent = message;
  el.style.background = tone === 'good' ? '#2f7d4f' : 'var(--bad)';
  el.hidden = false;
  if (toastHandle) clearTimeout(toastHandle);
  toastHandle = setTimeout(() => { el.hidden = true; }, 4200);
}

/** localStorage that never throws (private mode, blocked storage). */
export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* fine without */ }
  },
};

// Keyboard shortcuts: only during the running round, and not while an input
// field or a button has focus - there the space bar already does the right
// thing. Executed via a click on the respective button, so the logic exists
// only once and disabled buttons stay disabled.

import { $ } from './dom.ts';
import { isChatOpen, setChatOpen } from './chat.ts';

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

const SHORTCUTS: Record<string, string> = {
  ' ': 'btn-guess',      // submit
  m: 'btn-pin-map',      // keep the map open
  r: 'btn-pano-home',    // back to the start
};

export function initKeyboard(opts: { inCountdown: () => boolean; closeStats: () => void; closeHall: () => void }): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('stats-overlay').hidden) opts.closeStats();
      else if (!$('hall-overlay').hidden) opts.closeHall();
      else if (isChatOpen()) setChatOpen(false);
      return;
    }

    if (!$('screen-game').classList.contains('active') || opts.inCountdown()) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target as HTMLElement | null;
    if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return;
    if (!$('stats-overlay').hidden || !$('hall-overlay').hidden) return;

    const id = SHORTCUTS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!id) return;
    const btn = $<HTMLButtonElement>(id);
    if (btn.hidden || btn.disabled) {
      // The space bar would otherwise scroll the page, even if nothing happens.
      if (e.key === ' ') e.preventDefault();
      return;
    }
    e.preventDefault();
    btn.click();
  });
}

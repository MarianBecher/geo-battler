// The speaker buttons (home, lobby, HUD) all show the same state and cycle
// through the three sound modes.

import * as sfx from '../audio/sound.ts';
import { t } from '../i18n/index.ts';

// The speaker is an inline SVG rather than an emoji: an emoji looks different
// on every system and brings its own colour.
const BODY = '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>';
const svg = (extra: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${BODY}${extra}</svg>`;
const ICONS: Record<sfx.SoundMode, string> = {
  effects: svg('<path d="M16.5 8.8a4.5 4.5 0 0 1 0 6.4"/>'),
  off: svg('<path d="M17 9.5l5 5"/><path d="M22 9.5l-5 5"/>'),
  // With music: a note instead of the sound waves.
  full: svg('<path d="M17 15.2V7.6l4.5-1.1v7.1"/><circle cx="15.6" cy="15.4" r="1.6" fill="currentColor" stroke="none"/><circle cx="20.1" cy="14.3" r="1.6" fill="currentColor" stroke="none"/>'),
};

export function renderSoundButtons(): void {
  const mode = sfx.currentMode();
  for (const btn of document.querySelectorAll<HTMLElement>('.sound-btn')) {
    btn.dataset.mode = mode;
    btn.setAttribute('aria-pressed', String(mode !== 'off'));
    btn.title = t('sound.clickToCycle', { mode: sfx.modeLabel(mode) });
    const icon = btn.querySelector('.sound-icon');
    if (icon) icon.innerHTML = ICONS[mode];
    const label = btn.querySelector('.sound-label');
    if (label) label.textContent = sfx.modeLabel(mode);
  }
}

export function initSoundButtons(): void {
  for (const btn of document.querySelectorAll('.sound-btn')) {
    btn.addEventListener('click', () => {
      sfx.cycleMode();
      renderSoundButtons();
    });
  }
  renderSoundButtons();
  sfx.unlockOnFirstGesture();
}

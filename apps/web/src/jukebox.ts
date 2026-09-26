// The jukebox page: every theme, effect and anthem at the press of a button.

import './style.css';
import type { AnthemIndex } from 'anthem-scores';
import * as sfx from './audio/sound.ts';
import { $ } from './dom.ts';
import { countryName, lang, t, translateDom } from './i18n/index.ts';

translateDom();

const now = $('now');
const say = (text: string): void => { now.textContent = text; };

// The effects with the argument variants worth hearing.
const EFFECTS: { name: sfx.EffectName; label: string; arg?: boolean }[] = [
  { name: 'pin', label: 'Pin' },
  { name: 'chat', label: 'Chat' },
  { name: 'submit', label: 'Submit' },
  { name: 'countdown', label: 'Countdown' },
  { name: 'countdown', label: 'Go!', arg: true },
  { name: 'tick', label: 'Tick' },
  { name: 'tick', label: 'Tick (last 3 s)', arg: true },
  { name: 'stamp', label: 'Stamp' },
  { name: 'perfect', label: 'Perfect hit' },
  { name: 'knockout', label: 'Knock-out' },
  { name: 'fanfare', label: 'Fanfare (won)' },
  { name: 'finish', label: 'Final (not won)' },
];

$('fx').innerHTML = EFFECTS.map((e, i) => `<button data-fx="${i}">${e.label}</button>`).join('');

sfx.unlockOnFirstGesture();
if (sfx.currentMode() !== 'full') {
  say(t('jukebox.soundModeHint', { mode: sfx.modeLabel(sfx.currentMode()), full: sfx.modeLabel('full') }));
}

// There is no music until the samples are there - so say so.
let announcedLoading = false;
const waitForSamples = setInterval(() => {
  if (!sfx.samplesReady()) return;
  clearInterval(waitForSamples);
  if (announcedLoading || now.textContent === t('jukebox.nothingYet')) say(t('jukebox.samplesLoaded'));
}, 300);
window.addEventListener('pointerdown', () => {
  if (!sfx.samplesReady()) {
    announcedLoading = true;
    say(t('jukebox.loadingSamples'));
  }
}, { once: true });

function markMood(mood: string | null): void {
  for (const b of document.querySelectorAll<HTMLElement>('[data-mood]')) b.classList.toggle('on', b.dataset.mood === mood);
}

$('moods').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mood]');
  if (!b) return;
  const mood = b.dataset.mood;
  sfx.setMood(mood === 'lobby' || mood === 'game' ? mood : null);
  markMood(mood ?? null);
  say(mood ? t('jukebox.theme', { name: b.textContent }) : t('jukebox.silence'));
});

$('fx').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fx]');
  const effect = b ? EFFECTS[Number(b.dataset.fx)] : undefined;
  if (!effect) return;
  switch (effect.name) {
    case 'countdown': sfx.play('countdown', !!effect.arg); break;
    case 'tick': sfx.play('tick', !!effect.arg); break;
    case 'stamp': sfx.play('stamp'); break;
    default: sfx.play(effect.name);
  }
  say(t('jukebox.effect', { name: effect.label }));
});

function arrive(code: string, label: string): void {
  // As in the game: first out of the current mood, then into the reveal.
  sfx.setMood(null);
  sfx.setMood('reveal');
  sfx.arrive(code || null);
  markMood(null);
  say(t('jukebox.arrival', { name: label }));
}

document.body.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-country]');
  if (b) arrive(b.dataset.country ?? '', b.dataset.label ?? b.textContent);
});

const grid = $('anthems');
fetch('/audio/anthems/index.json')
  .then((r) => r.json() as Promise<AnthemIndex>)
  .then((index) => {
    const rows = Object.entries(index)
      .map(([code, entry]) => ({ code, title: entry.title, name: countryName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, lang()));
    grid.innerHTML = '';
    for (const r of rows) {
      const b = document.createElement('button');
      b.dataset.country = r.code;
      b.dataset.label = `${r.name} - ${r.title}`;
      b.title = r.title;
      b.innerHTML = `<span class="code">${r.code}</span><span class="name"></span>`;
      b.querySelector('.name')!.textContent = r.name;
      grid.append(b);
    }
  })
  .catch(() => { grid.innerHTML = `<p>${t('jukebox.noAnthems')}</p>`; });

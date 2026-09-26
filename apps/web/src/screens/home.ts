// The home screen: the passport on the table. Name, code, create or join,
// the photo drawn from the name, the language row.

import type { ClientConfig } from '@geo-battler/shared';
import { $, storage, toast } from '../dom.ts';
import { LANGUAGES, lang, setLang, t, locale } from '../i18n/index.ts';
import { faceFromName, myFace, photo, randomFace, rememberFace } from '../photo.ts';
import { isOpen, openPassport } from '../ui/passport.ts';
import { mrzPad, mrzText } from '../format.ts';
import { state } from '../state.ts';
import { connect, send } from '../socket.ts';
import { NAME_KEY } from '../session.ts';

const nameInput = (): HTMLInputElement => $<HTMLInputElement>('input-name');
const codeInput = (): HTMLInputElement => $<HTMLInputElement>('input-code');

/** The name from the field, stored for next time; null (and a nudge) if empty. */
function currentName(): string | null {
  const name = nameInput().value.trim();
  if (!name) {
    nameInput().focus();
    toast(t('toast.nameFirst'));
    return null;
  }
  storage.set(NAME_KEY, name);
  return name;
}

/** The name the player plays under - from the home screen too. */
export function ownName(): string {
  if (state.name) return state.name;
  return storage.get(NAME_KEY) ?? nameInput().value.trim();
}

/** Invite mode is just a reordering of the home screen, so it hangs on the CSS class alone. */
export const invited = (): boolean => $('home-card').classList.contains('invited');

function setInvited(on: boolean): void {
  $('home-card').classList.toggle('invited', on);
  $('invite-note').hidden = !on;
}

/** Where the focus belongs after opening. */
function homeFocus(): HTMLElement {
  if (!nameInput().value.trim() || !invited()) return nameInput();
  return $('btn-join');
}

/**
 * The data page writes along while typing: the photo draws itself from the
 * name (as long as nobody rolled), passport number and MRZ likewise. The
 * colour is assigned by the server - until then one from the name.
 */
export function renderHomeCard(): void {
  const raw = nameInput().value.trim();
  const colors = state.config?.colors ?? [];
  const color = colors.length ? colors[faceFromName(raw) % colors.length]! : '#ffd166';
  $('home-photo').innerHTML = photo(raw, color, myFace(raw));
  $('home-passno').textContent = raw
    ? `GB·${faceFromName(raw).toString(36).toUpperCase().slice(-4).padStart(4, '0')}`
    : 'GB·––––';

  const width = 30;
  $('home-mrz').textContent = `${mrzPad(`P<GEO<${mrzText(raw)}`, width)}\n${mrzPad(`GEOBATTLE<${mrzText(codeInput().value.trim())}`, width)}`;
}

/** The language row on the inner cover: the active one plain, the others as links. */
function renderLanguages(): void {
  $('lang-pick').innerHTML = LANGUAGES.map((l) => (l.code === lang()
    ? `<span class="on" lang="${l.code}">${l.label}</span>`
    : `<button type="button" data-lang="${l.code}" lang="${l.code}">${l.label}</button>`)).join('<span class="sep">·</span>');
}

/** Issue date as in a passport: 25 SEP 2026, month in the active language. */
function issuedToday(): string {
  const d = new Date();
  const month = d.toLocaleDateString(locale(), { month: 'short' }).replace('.', '').toUpperCase();
  return `${String(d.getDate()).padStart(2, '0')} ${month} ${d.getFullYear()}`;
}

/** The invitation code from the URL, if any. */
export function inviteCode(): string {
  return (new URLSearchParams(location.search).get('code') ?? '').trim().toUpperCase().slice(0, 4);
}

export function showConfigWarning(config: ClientConfig | null): void {
  const warning = $('home-warning');
  if (!config) {
    warning.hidden = false;
    warning.textContent = t('home.serverUnreachable');
    return;
  }
  if (config.configured) return;
  warning.hidden = false;
  warning.textContent = t('home.serverMissingKeys', { keys: config.missing.join(', ') });
  $<HTMLButtonElement>('btn-create').disabled = true;
  $<HTMLButtonElement>('btn-join').disabled = true;
}

export function initHome(collectSettings: () => Partial<import('@geo-battler/shared').Settings>): void {
  renderLanguages();
  $('lang-pick').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-lang]');
    const code = btn?.dataset.lang;
    if (code === 'en' || code === 'de') setLang(code);
  });

  nameInput().value = storage.get(NAME_KEY) ?? '';
  $('home-issued').textContent = issuedToday();

  const invite = inviteCode();
  if (invite) {
    codeInput().value = invite;
    setInvited(true);
    setTimeout(() => openPassport({ focus: homeFocus() }), 300);
  }
  renderHomeCard();

  nameInput().addEventListener('input', renderHomeCard);
  codeInput().addEventListener('input', () => {
    renderHomeCard();
    // Whoever clears the prefilled code apparently wants to open a lobby after all.
    if (invited() && !codeInput().value.trim()) setInvited(false);
  });

  // The same roll as in the lobby - only without the server, there is none yet.
  $('btn-home-face').addEventListener('click', () => {
    rememberFace(randomFace());
    renderHomeCard();
  });

  $('btn-create').addEventListener('click', () => {
    const name = currentName();
    if (!name) return;
    state.name = name;
    state.entering = true;
    connect(() => send({ t: 'create', name, face: myFace(name), settings: collectSettings() }));
  });

  $('btn-join').addEventListener('click', () => {
    const name = currentName();
    if (!name) return;
    const code = codeInput().value.trim().toUpperCase();
    if (code.length !== 4) {
      codeInput().focus();
      toast(t('toast.codeLength'));
      return;
    }
    state.name = name;
    state.code = code;
    state.entering = true;
    connect(() => send({ t: 'join', code, name, face: myFace(name) }));
  });

  $('btn-open-pass').addEventListener('click', () => openPassport({ focus: homeFocus() }));
  $('open-hint').addEventListener('click', () => openPassport({ focus: homeFocus() }));

  // Whoever simply starts typing with the passport closed opens it and writes
  // straight into the name field - the focus jumps there before the character.
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.screen.active')?.id !== 'screen-home' || isOpen() || !$('hall-overlay').hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
    openPassport({ focus: nameInput() });
  });

  codeInput().addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
  nameInput().addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (invited() ? $('btn-join') : $('btn-create')).click();
  });
}

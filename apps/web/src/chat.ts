// A single chat element that moves depending on the screen: in the lobby it
// sits fixed in the panel under the players, in the reveal and on the final
// screen it floats bottom left, open unless it was closed on purpose. On the
// home screen, while loading and during the round it is gone (spectators may
// chat during the round).
//
// Focus: opening the chat by hand puts the caret in the input, closing it
// hands the focus back to the toggle; sending keeps the caret in the input.
// Screen switches never steal the focus, and re-placing the chat where it
// already is must not touch the DOM - moving a node blurs whatever is inside.

import type { ChatMessage } from '@geo-battler/shared';
import * as sfx from './audio/sound.ts';
import { $, escapeHtml, storage } from './dom.ts';
import { glyphsOnly, glyphSvg, PENCIL_DEFS, renderGlyphs, shortcodeAt, suggest, type Emoji } from './emoji.ts';
import { isMe, state } from './state.ts';
import { send } from './socket.ts';

const CHAT_OPEN_KEY = 'geo-battle-chat-open';
const FLOATING = new Set(['screen-reveal', 'screen-final']);
const HISTORY = 60;
let unread = 0;

/** Open unless closed on purpose - the reveal is where people react. */
const chatOpenPref = (): boolean => storage.get(CHAT_OPEN_KEY) !== '0';

/**
 * `byHand` is the toggle button or Escape: then the focus follows - into the
 * input when opening, back to the toggle when closing, so the caret does not
 * end up in a hidden field. A screen switch leaves the focus where it is.
 */
export function setChatOpen(open: boolean, byHand = false): void {
  const chat = $('chat');
  const wasOpen = chat.classList.contains('open');
  chat.classList.toggle('open', open);
  $('chat-toggle').setAttribute('aria-expanded', String(open));
  storage.set(CHAT_OPEN_KEY, open ? '1' : '0');
  if (open) {
    clearUnread();
    scrollToEnd();
  }
  if (!byHand) return;
  if (open) $('chat-input').focus();
  else if (wasOpen && chat.contains(document.activeElement)) $('chat-toggle').focus();
}

export const isChatOpen = (): boolean => $('chat').classList.contains('floating') && $('chat').classList.contains('open');

/** Is the chat visible right now? Then there is nothing unread. */
function visible(): boolean {
  const chat = $('chat');
  return !chat.hidden && (!chat.classList.contains('floating') || chat.classList.contains('open'));
}

export function placeChat(screenId: string): void {
  const chat = $('chat');
  if (screenId === 'screen-lobby') {
    const slot = $('lobby-chat-slot');
    // Every room update shows the lobby again - re-appending the chat would
    // blur the input mid-sentence.
    if (chat.parentElement !== slot) slot.appendChild(chat);
    chat.classList.remove('floating');
    chat.hidden = false;
  } else if (FLOATING.has(screenId) || (screenId === 'screen-game' && state.spectating)) {
    if (chat.parentElement !== document.body) document.body.appendChild(chat);
    chat.classList.add('floating');
    chat.hidden = false;
    setChatOpen(chatOpenPref());
  } else {
    chat.hidden = true;
  }
  if (visible()) clearUnread();
  scrollToEnd();
}

function clearUnread(): void {
  unread = 0;
  $('chat-badge').hidden = true;
}

function scrollToEnd(): void {
  const log = $('chat-log');
  log.scrollTop = log.scrollHeight;
}

/** The colour the player wears now - the message's only if they are gone. */
const currentColor = (m: ChatMessage): string => state.room?.players.find((p) => p.id === m.playerId)?.color ?? m.color;

function row(m: ChatMessage): string {
  const classes = [isMe(m.playerId) ? 'me' : '', glyphsOnly(m.text) ? 'big' : ''].filter(Boolean).join(' ');
  return `<li class="${classes}" data-player-id="${escapeHtml(m.playerId)}">
    <span class="dot" style="background:${currentColor(m)}"></span>
    <span class="chat-text"><strong>${escapeHtml(m.name)}</strong> ${renderGlyphs(escapeHtml(m.text))}</span>
  </li>`;
}

export function setChatLog(messages: ChatMessage[]): void {
  $('chat-log').innerHTML = messages.map(row).join('');
  $('chat-empty').hidden = messages.length > 0;
  clearUnread();
  scrollToEnd();
}

export function addChatMessage(m: ChatMessage): void {
  const log = $('chat-log');
  // Only scroll along if we were at the bottom anyway - whoever scrolled up is reading.
  const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.insertAdjacentHTML('beforeend', row(m));
  while (log.children.length > HISTORY) log.firstElementChild?.remove();
  $('chat-empty').hidden = true;
  if (atEnd || isMe(m.playerId)) scrollToEnd();

  if (isMe(m.playerId)) return;
  sfx.play('chat');
  if (!visible()) {
    unread++;
    $('chat-badge').textContent = unread > 9 ? '9+' : String(unread);
    $('chat-badge').hidden = false;
  }
}

/** Whoever changes colour should look the same in the chat - the dots follow the room. */
export function recolorChat(): void {
  const colors = new Map((state.room?.players ?? []).map((p) => [p.id, p.color]));
  for (const li of $('chat-log').children) {
    const color = colors.get((li as HTMLElement).dataset.playerId ?? '');
    const dot = li.querySelector<HTMLElement>('.dot');
    if (color && dot) dot.style.background = color;
  }
}

export function initChat(): void {
  document.body.insertAdjacentHTML('beforeend', PENCIL_DEFS);
  $('chat-toggle').addEventListener('click', () => setChatOpen(!$('chat').classList.contains('open'), true));
  const input = $<HTMLInputElement>('chat-input');
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    closeSuggestions();
    // Whoever clicked Send wants to keep writing - the focus would otherwise
    // stay on the button and the next words go nowhere.
    input.focus();
    if (!text) return;
    send({ t: 'chat', text });
    input.value = '';
  });
  initSuggestions(input);
}

// --- Emoji slip -------------------------------------------------------------
//
// Typing `:shr` opens a short list over the input; arrows move, Tab or
// Enter take the pick, Escape closes it. Enter with the list open never sends.
// A lone `:` shows the list too, but there Enter still sends - "see you at :"
// must not turn into an emoji. The pick goes in as `:shrug:` - the drawing
// only appears in the log.

let picks: Emoji[] = [];
let pickIndex = 0;
let pickStart = 0;
let pickTyped = false; // at least one letter after the colon

function closeSuggestions(): void {
  picks = [];
  $('chat-emoji').hidden = true;
}

function renderSuggestions(): void {
  const list = $('chat-emoji');
  list.innerHTML = picks.map((e, i) => `<li class="${i === pickIndex ? 'active' : ''}" data-index="${i}">
    <span class="chat-emoji-char">${glyphSvg(e.code) ?? ''}</span><span class="chat-emoji-code">:${e.code}:</span>
  </li>`).join('');
  list.hidden = picks.length === 0;
}

function refreshSuggestions(input: HTMLInputElement): void {
  const hit = shortcodeAt(input.value, input.selectionStart ?? input.value.length);
  picks = hit ? suggest(hit.query) : [];
  pickStart = hit?.start ?? 0;
  pickTyped = (hit?.query.length ?? 0) > 0;
  pickIndex = 0;
  renderSuggestions();
}

/** Puts the picked code where the shortcode was typed. */
function applyPick(input: HTMLInputElement, pick: Emoji): void {
  const caret = input.selectionStart ?? input.value.length;
  const code = `:${pick.code}: `;
  input.value = `${input.value.slice(0, pickStart)}${code}${input.value.slice(caret)}`;
  const at = pickStart + code.length;
  input.setSelectionRange(at, at);
  closeSuggestions();
  input.focus();
}

function initSuggestions(input: HTMLInputElement): void {
  input.addEventListener('input', () => { refreshSuggestions(input); });
  input.addEventListener('blur', () => { setTimeout(closeSuggestions, 150); });
  input.addEventListener('keydown', (e) => {
    if (!picks.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      pickIndex = (pickIndex + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length;
      renderSuggestions();
    } else if (e.key === 'Tab' || (e.key === 'Enter' && pickTyped)) {
      applyPick(input, picks[pickIndex]!);
    } else if (e.key === 'Enter') {
      return; // a bare colon: the form sends as usual
    } else if (e.key === 'Escape') {
      closeSuggestions();
      e.stopPropagation(); // the chat stays open, only the slip goes
    } else {
      return;
    }
    e.preventDefault();
  });
  $('chat-emoji').addEventListener('mousedown', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-index]');
    if (!li) return;
    e.preventDefault(); // keeps the focus in the input
    applyPick(input, picks[Number(li.dataset.index)]!);
  });
}

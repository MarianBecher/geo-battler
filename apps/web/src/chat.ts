// A single chat element that moves depending on the screen: in the lobby it
// sits fixed in the panel under the players, in the reveal and on the final
// screen it floats collapsed bottom left. On the home screen, while loading
// and during the round it is gone (spectators may chat during the round).

import type { ChatMessage } from '@geo-battler/shared';
import * as sfx from './audio/sound.ts';
import { $, escapeHtml, storage } from './dom.ts';
import { isMe, state } from './state.ts';
import { send } from './socket.ts';

const CHAT_OPEN_KEY = 'geo-battle-chat-open';
const FLOATING = new Set(['screen-reveal', 'screen-final']);
const HISTORY = 60;
let unread = 0;

const chatOpenPref = (): boolean => storage.get(CHAT_OPEN_KEY) === '1';

export function setChatOpen(open: boolean): void {
  const chat = $('chat');
  chat.classList.toggle('open', open);
  $('chat-toggle').setAttribute('aria-expanded', String(open));
  storage.set(CHAT_OPEN_KEY, open ? '1' : '0');
  if (open) {
    clearUnread();
    scrollToEnd();
  }
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
    $('lobby-chat-slot').appendChild(chat);
    chat.classList.remove('floating');
    chat.hidden = false;
  } else if (FLOATING.has(screenId) || (screenId === 'screen-game' && state.spectating)) {
    document.body.appendChild(chat);
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
  return `<li class="${isMe(m.playerId) ? 'me' : ''}" data-player-id="${escapeHtml(m.playerId)}">
    <span class="dot" style="background:${currentColor(m)}"></span>
    <span class="chat-text"><strong>${escapeHtml(m.name)}</strong> ${escapeHtml(m.text)}</span>
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
  $('chat-toggle').addEventListener('click', () => setChatOpen(!$('chat').classList.contains('open')));
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('chat-input');
    const text = input.value.trim();
    if (!text) return;
    send({ t: 'chat', text });
    input.value = '';
  });
}

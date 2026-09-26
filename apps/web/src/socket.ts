// The WebSocket connection: typed send, typed dispatch, automatic rejoin.

import type { ClientMessage, ServerMessage, ServerMessageType } from '@geo-battler/shared';
import { toast } from './dom.ts';
import { t } from './i18n/index.ts';
import { myFace } from './photo.ts';
import { state } from './state.ts';

type Handler<T extends ServerMessageType> = (msg: Extract<ServerMessage, { t: T }>) => void;
const handlers = new Map<ServerMessageType, Handler<ServerMessageType>>();

/** Screens register what they do with a message type. */
export function on<T extends ServerMessageType>(type: T, handler: Handler<T>): void {
  handlers.set(type, handler as unknown as Handler<ServerMessageType>);
}

const listeners = { kicked: [] as (() => void)[] };
export const onKicked = (fn: () => void): void => { listeners.kicked.push(fn); };

let socket: WebSocket | null = null;
let retryDelay = 500;

export function connect(onOpen?: () => void): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;

  ws.addEventListener('open', () => {
    retryDelay = 500;
    onOpen?.();
  });

  ws.addEventListener('message', (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      return;
    }
    handlers.get(msg.t)?.(msg);
  });

  ws.addEventListener('close', (event) => {
    socket = null;
    if (!state.code) return;
    if (event.code === 4002) {
      // Kicked - do not rejoin.
      for (const fn of listeners.kicked) fn();
      toast(t('toast.kicked'));
      return;
    }
    // Connection lost, but we were in a room -> get back in.
    state.rejoining = true;
    setTimeout(() => rejoin(), retryDelay);
    retryDelay = Math.min(8000, retryDelay * 2);
  });
}

/** Back into the room we were in, keeping the player id and the pin. */
export function rejoin(): void {
  if (!state.code) return;
  const code = state.code;
  connect(() => send({ t: 'join', code, name: state.name, face: myFace(state.name), ...(state.playerId ? { playerId: state.playerId } : {}) }));
}

export function send(payload: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  else toast(t('toast.noConnection'));
}

export function close(): void {
  socket?.close();
  socket = null;
}

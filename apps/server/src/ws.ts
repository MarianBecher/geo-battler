// The WebSocket side: one connection per player, JSON messages both ways,
// typed by the shared protocol. This layer only parses, routes and sends;
// the rules live in the room.

import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { ClientMessage, FinalMessage, PinSnapshot, ServerMessage, SpectatorReason } from '@geo-battler/shared';
import { env } from './env.ts';
import { GameError, errorPayload, fail } from './errors.ts';
import type { Hall } from './hall.ts';
import { isLocalAddress, normalizeAddress } from './net.ts';
import { Room, RoomManager, sanitizeFace, sanitizeName, sanitizeSettings, type Player } from './room.ts';

const HEARTBEAT_MS = 20_000;

interface LiveSocket extends WebSocket {
  isAlive?: boolean;
}

function send(socket: WebSocket | null | undefined, payload: ServerMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function broadcast(room: Room, payload: ServerMessage): void {
  const data = JSON.stringify(payload);
  for (const player of room.players.values()) {
    const socket = player.socket as WebSocket | null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(data);
  }
}

function finalMessage(room: Room): FinalMessage {
  const { titles, metrics } = room.finalStats();
  return {
    t: 'final',
    mode: room.settings.mode,
    // In a duel the number of rounds is only known at the end.
    totalRounds: room.isDuel() ? room.history.length : room.settings.rounds,
    maxHp: room.isDuel() ? room.settings.hp : null,
    teams: room.teamStandings(),
    leaderboard: room.leaderboard(),
    rounds: room.playedRounds(),
    titles,
    metrics,
  };
}

/** For spectators: that they are watching, why, and where the pins lie right now. */
function spectatorView(room: Room, player: Player): { spectating: true; spectatorReason: SpectatorReason; pins: PinSnapshot[] } | Record<string, never> {
  const reason = room.spectatorReason(player);
  return reason ? { spectating: true, spectatorReason: reason, pins: room.currentPins() } : {};
}

function wire(room: Room, hall: Hall): void {
  room.events = {
    onChange: () => broadcast(room, { t: 'room', room: room.snapshot() }),
    onRoundStart: () => {
      const payload = room.roundPayload();
      if (!payload) return;
      for (const player of room.players.values()) {
        send(player.socket as WebSocket | null, { ...payload, ...spectatorView(room, player) });
      }
    },
    // Spectators see the others' pins as soon as they are placed.
    onPins: () => {
      const payload: ServerMessage = { t: 'pins', round: room.roundIndex + 1, pins: room.currentPins() };
      for (const player of room.players.values()) {
        if (room.isSpectator(player)) send(player.socket as WebSocket | null, payload);
      }
    },
    onReveal: () => {
      if (room.lastRoundResults) broadcast(room, room.lastRoundResults);
    },
    onFinal: () => {
      broadcast(room, finalMessage(room));
      // Send first, record second - the hall must never delay the final screen for anyone.
      hall.record(room.gameSummary()).catch((err: unknown) => {
        console.warn(`[hall] game not recorded: ${(err as Error).message}`);
      });
    },
  };
}

/** Everything a (re)connected client needs to be up to date immediately. */
function catchUp(room: Room, player: Player): void {
  const socket = player.socket as WebSocket | null;
  send(socket, { t: 'hello', playerId: player.id, code: room.code, color: player.color, name: player.name });
  send(socket, { t: 'room', room: room.snapshot() });
  send(socket, { t: 'chatLog', messages: room.chatLog });

  if (room.phase === 'playing') {
    const payload = room.roundPayload();
    if (payload) {
      send(socket, {
        ...payload,
        myPin: player.pin ? { lat: player.pin.lat, lng: player.pin.lng } : null,
        myConfirmed: player.confirmed,
        ...spectatorView(room, player),
      });
    }
  } else if (room.phase === 'reveal' && room.lastRoundResults) {
    send(socket, room.lastRoundResults);
  } else if (room.phase === 'finished') {
    send(socket, finalMessage(room));
  }
}

/** Someone is gone (disconnected or kicked): are they still holding anything up? */
function settleAfterLeaving(room: Room): void {
  // If only one guess was missing, resolve now.
  if (room.phase === 'playing' && !room.isPaused()) {
    const active = room.contenders();
    if (active.length > 0 && active.every((p) => p.confirmed)) room.endRound();
  }
  // Likewise for "ready": whoever left no longer holds anyone up.
  if (room.phase === 'lobby' || room.phase === 'reveal') {
    room.advanceIfAllReady().catch((err: unknown) => {
      console.warn(`[room ${room.code}] automatic start failed: ${(err as Error).message}`);
    });
  }
}

/** One connection: which room and player it belongs to. */
class Connection {
  room: Room | null = null;
  playerId: string | null = null;

  constructor(readonly socket: WebSocket) {}

  bind(room: Room, player: Player): void {
    this.room = room;
    this.playerId = player.id;
  }

  requireRoom(): Room {
    return this.room ?? fail('notInRoom');
  }

  requireId(): string {
    return this.playerId ?? fail('notInRoom');
  }

  detach(): void {
    if (this.room && this.playerId) {
      const room = this.room;
      const player = room.players.get(this.playerId);
      // After a takeover (reload, second tab) the player long hangs on a new
      // connection - then this close belongs to the old one.
      if (player?.socket && player.socket !== this.socket) {
        this.room = null;
        this.playerId = null;
        return;
      }
      room.markDisconnected(this.playerId);
      room.events.onChange();
      settleAfterLeaving(room);
    }
    this.room = null;
    this.playerId = null;
  }
}

type Handler<T extends ClientMessage['t']> = (conn: Connection, msg: Extract<ClientMessage, { t: T }>) => void | Promise<void>;
type Handlers = { [T in ClientMessage['t']]: Handler<T> };

function createHandlers(manager: RoomManager, hall: Hall): Handlers {
  return {
    create(conn, msg) {
      if (conn.room) fail('alreadyInRoom');
      if (!env.serverKey) fail('noServerKey');
      const room = manager.create();
      wire(room, hall);
      room.settings = sanitizeSettings(msg.settings);
      const player = room.addPlayer(sanitizeName(msg.name), conn.socket, sanitizeFace(msg.face));
      conn.bind(room, player);
      catchUp(room, player);
      console.log(`[room ${room.code}] created by "${player.name}"`);
    },

    join(conn, msg) {
      if (conn.room) fail('alreadyInRoom');
      const room = manager.get(msg.code) ?? fail('unknownRoom');
      wire(room, hall);
      const player = (msg.playerId ? room.reattach(msg.playerId, conn.socket, msg.name) : null)
        ?? room.addPlayer(sanitizeName(msg.name), conn.socket, sanitizeFace(msg.face));
      conn.bind(room, player);
      catchUp(room, player);
      room.events.onChange();
      console.log(`[room ${room.code}] "${player.name}" joined (${room.activePlayers().length})`);
    },

    settings(conn, msg) {
      const room = conn.requireRoom();
      room.updateSettings(conn.requireId(), msg.settings);
      room.events.onChange();
    },

    async start(conn) {
      const room = conn.requireRoom();
      console.log(`[room ${room.code}] game starts: ${JSON.stringify(room.settings)}`);
      await room.start(conn.requireId());
    },

    pin(conn, msg) { conn.requireRoom().setPin(conn.requireId(), Number(msg.lat), Number(msg.lng)); },
    guess(conn, msg) { conn.requireRoom().submitGuess(conn.requireId(), Number(msg.lat), Number(msg.lng)); },
    unguess(conn) { conn.requireRoom().withdrawGuess(conn.requireId()); },
    telemetry(conn, msg) { conn.requireRoom().recordTelemetry(conn.requireId(), msg.stats); },
    async ready(conn, msg) { await conn.requireRoom().setReady(conn.requireId(), !!msg.value); },

    vote(conn, msg) {
      // Restrictions: yes/no; pack: the pack id - anything else withdraws the vote.
      const value = msg.flag === 'pack'
        ? (typeof msg.value === 'string' ? msg.value : null)
        : (msg.value === true || msg.value === false ? msg.value : null);
      conn.requireRoom().vote(conn.requireId(), msg.flag, value);
    },

    team(conn, msg) { conn.requireRoom().setTeam(conn.requireId(), msg.team); },
    color(conn, msg) { conn.requireRoom().setColor(conn.requireId(), String(msg.color)); },
    face(conn, msg) { conn.requireRoom().setFace(conn.requireId(), msg.face); },

    chat(conn, msg) {
      const room = conn.requireRoom();
      const message = room.chat(conn.requireId(), msg.text);
      if (message) broadcast(room, { t: 'chat', message });
    },

    async next(conn) { await conn.requireRoom().next(conn.requireId()); },
    lobby(conn) { conn.requireRoom().backToLobby(conn.requireId()); },

    kick(conn, msg) {
      const room = conn.requireRoom();
      const player = room.kick(conn.requireId(), String(msg.playerId));
      console.log(`[room ${room.code}] "${player.name}" kicked`);
      try { player.socket?.close(4002, 'Removed by the host'); } catch { /* already gone */ }
      room.events.onChange();
      settleAfterLeaving(room);
    },

    host(conn, msg) {
      const room = conn.requireRoom();
      room.transferHost(conn.requireId(), String(msg.playerId));
      room.events.onChange();
    },

    pause(conn) {
      const room = conn.requireRoom();
      room.pause(conn.requireId());
      room.events.onChange();
    },

    resume(conn) {
      const room = conn.requireRoom();
      room.resume(conn.requireId());
      room.events.onChange();
    },

    leave(conn) { conn.detach(); },
    ping(conn) { send(conn.socket, { t: 'pong' }); },
  };
}

function parse(raw: RawData): ClientMessage {
  let msg: unknown;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.concat(Array.isArray(raw) ? raw : [Buffer.from(raw)]).toString('utf8'));
  } catch {
    throw new GameError('invalidMessage');
  }
  if (typeof msg !== 'object' || msg === null || typeof (msg as { t?: unknown }).t !== 'string') throw new GameError('invalidMessage');
  return msg as ClientMessage;
}

export function attachWebSockets(server: Server, manager: RoomManager, hall: Hall): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }: { req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => {
      if (env.allowPublicClients || isLocalAddress(req.socket.remoteAddress)) return done(true);
      console.warn(`[ws] connection refused for ${normalizeAddress(req.socket.remoteAddress)}`);
      done(false, 403, 'Only reachable from the local network');
    },
  });
  const handlers = createHandlers(manager, hall);

  wss.on('connection', (socket: LiveSocket) => {
    const conn = new Connection(socket);
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', (raw: RawData) => {
      void (async () => {
        let msg: ClientMessage;
        try {
          msg = parse(raw);
        } catch (err) {
          send(socket, { t: 'error', ...errorPayload(err) });
          return;
        }
        const handler = handlers[msg.t] as Handler<typeof msg.t> | undefined;
        if (!handler) {
          send(socket, { t: 'error', ...new GameError('unknownAction', { action: String(msg.t) }).toPayload() });
          return;
        }
        try {
          await handler(conn, msg);
        } catch (err) {
          console.warn(`[ws] ${msg.t} failed: ${(err as Error).message}`);
          send(socket, { t: 'error', ...errorPayload(err) });
        }
      })();
    });

    socket.on('close', () => conn.detach());
    socket.on('error', () => conn.detach());
  });

  // Detect dead connections (closed laptop lid and the like).
  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<LiveSocket>) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return wss;
}

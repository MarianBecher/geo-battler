// The HTTP side: the client config, the Hall of Fame endpoints and, in
// production, the built client. Everything that carries a key is only
// handed to clients on the local network.

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, PACK_IDS, PLAYER_COLORS, TEAM_PALETTES, TEAMS, type ClientConfig, type HttpError } from '@geo-battler/shared';
import { env, missingKeys } from './env.ts';
import { GameError } from './errors.ts';
import type { Hall } from './hall.ts';
import { isLocalAddress, normalizeAddress } from './net.ts';
import { lanUrls } from './lan.ts';

export function createApp(hall: Hall): Hono {
  const app = new Hono();

  const httpError = (status: 403 | 404 | 500, code: GameError['code']): Response => {
    const err = new GameError(code);
    const body: HttpError = { error: err.code, message: err.message };
    return Response.json(body, { status });
  };

  // No serving from cache without asking: after an update a plain reload must
  // be enough, so nobody keeps playing on an old version.
  app.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-cache');
  });

  app.use('/api/*', async (c, next) => {
    const address = getConnInfo(c as Parameters<typeof getConnInfo>[0]).remote.address;
    if (!env.allowPublicClients && !isLocalAddress(address)) {
      console.warn(`[http] ${c.req.path} refused for ${normalizeAddress(address)}`);
      return httpError(403, 'lanOnly');
    }
    await next();
  });

  app.get('/api/config', (c) => {
    // Only the browser key goes out - the server key stays here.
    const config: ClientConfig = {
      mapsApiKey: env.browserKey,
      colors: PLAYER_COLORS,
      teams: TEAMS,
      teamPalettes: TEAM_PALETTES,
      packs: [...PACK_IDS],
      configured: missingKeys().length === 0,
      missing: missingKeys(),
      defaults: DEFAULT_SETTINGS,
      // So the host can share a link that works for the others - their own address bar may well say "localhost".
      lanUrls: lanUrls(env.port),
    };
    return c.json(config);
  });

  app.get('/api/hall', async (c) => {
    try {
      return c.json(await hall.view());
    } catch (err) {
      console.warn(`[hall] unreadable: ${(err as Error).message}`);
      return httpError(500, 'hallUnreadable');
    }
  });

  app.get('/api/hall/player/:name', async (c) => {
    try {
      const profile = await hall.playerView(c.req.param('name'));
      if (!profile) return httpError(404, 'profileUnknown');
      return c.json(profile);
    } catch (err) {
      console.warn(`[hall] profile unreadable: ${(err as Error).message}`);
      return httpError(500, 'profileUnreadable');
    }
  });

  // In production the server also serves the built client. In development
  // Vite does that and proxies /api and /ws here.
  if (fs.existsSync(path.join(env.webDir, 'index.html'))) {
    const root = path.relative(process.cwd(), env.webDir);
    app.use('/*', serveStatic({ root }));
    app.get('/jukebox', serveStatic({ root, path: 'jukebox.html' }));
  }

  return app;
}

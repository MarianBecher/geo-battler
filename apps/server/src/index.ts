// Entry point: HTTP via Hono on Node's http server, WebSockets on the same
// port, the Hall of Fame loaded from disk.

import os from 'node:os';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { env, missingKeys } from './env.ts';
import { createApp } from './http.ts';
import { attachWebSockets } from './ws.ts';
import { Hall } from './hall.ts';
import { RoomManager, googleFinder } from './room.ts';
import { lanAddresses } from './lan.ts';

const hall = await new Hall(env.hallFile).load();
const manager = new RoomManager(googleFinder(env.serverKey));
const app = createApp(hall);

const server = serve({ fetch: app.fetch, port: env.port, hostname: '0.0.0.0' }, () => {
  console.log('');
  console.log('  Geo Battle is running');
  console.log(`  -> http://localhost:${env.port}`);
  for (const ip of lanAddresses()) console.log(`  -> http://${ip}:${env.port}   (for the others on the network)`);
  // A name is more stable than an IP the router hands out anew.
  console.log(`  -> http://${os.hostname().toLowerCase()}.local:${env.port}   (mDNS, if the network supports it)`);
  if (env.allowPublicClients) {
    console.log('  !! ALLOW_PUBLIC_CLIENTS=1 - the browser key goes to anyone who reaches the port.');
  }
  const missing = missingKeys();
  if (missing.length) {
    console.log('');
    console.log(`  !! Missing: ${missing.join(', ')}`);
    console.log('     Copy .env.example to .env and fill in the keys,');
    console.log('     otherwise no panorama will load. Details in the README.');
  }
  console.log('');
}) as Server;

attachWebSockets(server, manager, hall);

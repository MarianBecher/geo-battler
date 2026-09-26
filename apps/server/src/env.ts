// Loads `.env` from the repository root, if there is one, and exposes the
// settings the server reads from the environment.
//
// Loaded here rather than with `--env-file-if-exists`: in watch mode Node
// also watches the env file and crashes when it does not exist yet, which is
// exactly the state of a fresh checkout. Variables already set in the
// environment win over the file.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The monorepo root: two levels up from apps/server/src (or apps/server/dist). */
export const ROOT_DIR = path.resolve(here, '..', '..', '..');

try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

const trimmed = (name: string): string => (process.env[name] ?? '').trim();

// Two keys, because a Google key can carry only *one* application
// restriction: the browser key runs on "Websites" (HTTP referrer), the server
// key on "IP addresses" or none at all. A single GOOGLE_MAPS_API_KEY works
// too - unrestricted, then.
const fallbackKey = trimmed('GOOGLE_MAPS_API_KEY');

export const env = {
  port: Number(process.env.PORT) || 3000,
  browserKey: trimmed('GOOGLE_MAPS_BROWSER_KEY') || fallbackKey,
  serverKey: trimmed('GOOGLE_MAPS_SERVER_KEY') || fallbackKey,
  /** The browser key is public anyway, but it only goes to the local network unless this is set. */
  allowPublicClients: process.env.ALLOW_PUBLIC_CLIENTS === '1',
  /** Language Google returns place names in - shared by everyone in a room. */
  geocodeLanguage: trimmed('GEOCODE_LANGUAGE') || 'en',
  /** Where the Hall of Fame lives. */
  hallFile: process.env.HALL_FILE ? path.resolve(process.env.HALL_FILE) : path.join(ROOT_DIR, 'data', 'hall.json'),
  /** The built client, served in production. */
  webDir: path.resolve(here, '..', '..', 'web', 'dist'),
} as const;

/** Which of the two keys are still missing - printed at start-up and sent to the client. */
export function missingKeys(): string[] {
  const missing: string[] = [];
  if (!env.browserKey) missing.push('GOOGLE_MAPS_BROWSER_KEY');
  if (!env.serverKey) missing.push('GOOGLE_MAPS_SERVER_KEY');
  return missing;
}

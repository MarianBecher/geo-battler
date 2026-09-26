// Copies the audio data the client needs at runtime from the two npm
// packages into public/audio, where Vite serves it as static files:
//
//   tiny-orchestra  -> public/audio/samples  (manifest + mp3)
//   anthem-scores   -> public/audio/anthems  (index + one JSON per country)
//
// Runs after install (postinstall) and before dev/build, so a fresh clone
// works without a manual step. The copies are gitignored.

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { samplesDir } from 'tiny-orchestra/node';
import { anthemsDir } from 'anthem-scores/node';

const root = dirname(fileURLToPath(import.meta.url));
const target = join(root, '..', 'public', 'audio');

for (const [name, source] of [['samples', samplesDir()], ['anthems', anthemsDir()]]) {
  const dest = join(target, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  console.log(`[assets] ${name} -> ${dest}`);
}

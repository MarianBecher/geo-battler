// Copies the audio data the client needs at runtime from the two npm
// packages into public/audio, where Vite serves it as static files:
//
//   tiny-orchestra  -> public/audio/samples  (manifest + mp3)
//   anthem-scores   -> public/audio/anthems  (index + one JSON per country)
//
// Runs after install (postinstall) and before dev/build, so a fresh clone
// works without a manual step. The copies are gitignored.
//
// Optional, local only: anthems.local/ (next to this app's package.json) may
// hold extra anthem files in the same format, e.g. arrangements that are not
// freely licensed. Its index.json is merged into the package index and its
// JSON files are copied alongside. The folder is gitignored and dockerignored,
// so it never ends up in the repository or in an image.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { samplesDir } from 'tiny-orchestra/node';
import { anthemsDir } from 'anthem-scores/node';

const root = dirname(fileURLToPath(import.meta.url));
const target = join(root, '..', 'public', 'audio');
const localAnthems = join(root, '..', 'anthems.local');

for (const [name, source] of [['samples', samplesDir()], ['anthems', anthemsDir()]]) {
  const dest = join(target, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  console.log(`[assets] ${name} -> ${dest}`);
}

if (existsSync(join(localAnthems, 'index.json'))) {
  const dest = join(target, 'anthems');
  const indexFile = join(dest, 'index.json');
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const local = JSON.parse(readFileSync(join(localAnthems, 'index.json'), 'utf8'));
  let added = 0;
  for (const [code, entry] of Object.entries(local)) {
    if (index[code]) continue; // the freely licensed package version wins
    if (!existsSync(join(localAnthems, entry.file))) {
      console.warn(`[assets] anthems.local: ${code} -> ${entry.file} missing, skipped`);
      continue;
    }
    cpSync(join(localAnthems, entry.file), join(dest, entry.file));
    index[code] = entry;
    added++;
  }
  const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(indexFile, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`[assets] anthems.local: ${added} local anthems merged (${readdirSync(localAnthems).length} files present)`);
}

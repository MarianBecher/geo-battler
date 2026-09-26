// Clear the Hall of Fame: `pnpm run hall:clear`
//
// The server may keep running: it re-reads the file before every change, so
// the deleted state does not come back from memory.

import fs from 'node:fs/promises';
import { env } from './env.ts';

try {
  await fs.unlink(env.hallFile);
  console.log(`Hall of Fame cleared: ${env.hallFile}`);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') console.log(`Nothing to delete - ${env.hallFile} does not exist.`);
  else {
    console.error(`Delete failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

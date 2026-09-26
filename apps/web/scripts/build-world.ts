// Generates public/geo/world.json - the country outlines for the printed
// world map of the personal profile and the atlas behind the passport.
//
//   node scripts/build-world.ts [path/to/ne_110m_admin_0_countries.geojson]
//
// Source: Natural Earth 1:110m Admin 0 (public domain). Without a path the
// file is fetched from GitHub. The output holds, per country, its ISO code
// and its rings as a flat list of tenths of a degree - on a map the width
// of a page nobody sees more than that, and the file stays at about 100 KB.

import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const OUT = new URL('../public/geo/world.json', import.meta.url);

type Position = [number, number];
type Ring = Position[];

interface Feature {
  properties: { ISO_A2_EH: string; NAME: string };
  geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
}

// Two territories without an ISO code of their own - Google assigns them to these countries.
const NO_CODE: Partial<Record<string, string>> = { Somaliland: 'SO', 'N. Cyprus': 'CY' };

const path = process.argv[2];
const src = path ? await readFile(path, 'utf8') : await (await fetch(SOURCE_URL)).text();
const geo = JSON.parse(src) as { features: Feature[] };

const countries: { c: string; r: number[][] }[] = [];
for (const f of geo.features) {
  const p = f.properties;
  const code = /^[A-Z]{2}$/.test(p.ISO_A2_EH) ? p.ISO_A2_EH : NO_CODE[p.NAME] ?? null;
  if (!code || code === 'AQ') continue; // the game never rolls Antarctica
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  // Outer rings only: holes are too small to see at this scale.
  const rings = polys.map((poly) => (poly[0] ?? []).flatMap(([lng, lat]) => [Math.round(lng * 10), Math.round(lat * 10)]));
  countries.push({ c: code, r: rings });
}

await writeFile(OUT, JSON.stringify({ source: 'Natural Earth 1:110m (public domain)', countries }));
console.log(`${countries.length} countries -> ${OUT.pathname}`);

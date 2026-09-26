// Natural Earth I (Šavrič et al.): a calm compromise projection, the kind
// printed world maps use - neither Mercator's huge Greenland nor the
// squashed edges of a plate carrée. Shared by the printed world map and the
// atlas behind the passport.

const DEG = Math.PI / 180;

/** Half the width of the projected world, in projection units. */
export const NE_HALF_WIDTH = 2.73;
/** Half the height of the projected world, in projection units. */
export const NE_HALF_HEIGHT = 1.42;

/**
 * Project a point to Natural Earth I units: x within about ±2.73, y within
 * about ±1.42, north up (y grows northwards).
 */
export function naturalEarth(lng: number, lat: number): [x: number, y: number] {
  const l = lng * DEG;
  const p = lat * DEG;
  const p2 = p * p;
  const p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}

/** Shape of public/geo/world.json, see scripts/build-world.ts. */
export interface WorldFile {
  source: string;
  /** Per country: ISO code and rings as flat [lng, lat, lng, lat, ...] lists in tenths of a degree. */
  countries: { c: string; r: number[][] }[];
}

/** Fetch the country outlines; rejects on a non-OK response. */
export async function fetchWorld(): Promise<WorldFile> {
  const res = await fetch('/geo/world.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as WorldFile;
}

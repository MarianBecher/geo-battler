// Which country lies on which continent - for the map packs - and a rough
// continent lookup by coordinates for the statistics.
//
// The location search rolls points inside rectangles, and those reach across
// borders: the Turkey box into Syria, the Russia box into Ukraine. Geocoding
// names the country of a find, and the country table says whether it belongs
// to the pack. Edge cases are decisions, not geography: Russia and Turkey
// count as Asia, and packs that want them add them individually.

import type { ContinentCode, LatLng } from '@geo-battler/shared';

const BY_CONTINENT: Record<Exclude<ContinentCode, 'AN' | 'SEA'>, string> = {
  EU: 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SJ SK SM UA VA XK',
  AS: 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA RU SA SG SY TH TJ TL TM TR TW UZ VN YE',
  AF: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  NA: 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  SA: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  OC: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
};

const CONTINENT_OF_COUNTRY = new Map<string, ContinentCode>();
for (const [continent, codes] of Object.entries(BY_CONTINENT) as [ContinentCode, string][]) {
  for (const code of codes.split(' ')) CONTINENT_OF_COUNTRY.set(code, continent);
}

/** Continent of an ISO country code ('DE' -> 'EU') - or null if unknown. */
export function continentOfCountry(code: string | null | undefined): ContinentCode | null {
  return CONTINENT_OF_COUNTRY.get((code ?? '').toUpperCase()) ?? null;
}

// Rough boxes [north, west, south, east] - all we need is "right continent?".
// The first matching box wins, so the order matters. SEA is open water.
const CONTINENT_BOXES: [ContinentCode, number, number, number, number][] = [
  ['AN', -60, -180, -90, 180],
  ['OC', -5, 110, -50, 180],
  ['OC', 0, 160, -50, 180],
  ['SA', 13, -82, -56, -34],
  ['NA', 84, -170, 7, -52],
  ['AS', 43, 35, 12, 63], // check the Middle East before Africa
  ['AF', 37, -18, -35, 52],
  ['EU', 72, -25, 34, 40],
  ['AS', 82, 25, -11, 180],
];

/** Very rough continent lookup - enough for "same continent, yes or no". */
export function continentOf({ lat, lng }: LatLng): ContinentCode {
  for (const [code, north, west, south, east] of CONTINENT_BOXES) {
    if (lat <= north && lat >= south && lng >= west && lng <= east) return code;
  }
  return 'SEA';
}

// Continent codes as the server records them; the client translates them.

export const CONTINENT_CODES = ['EU', 'AS', 'AF', 'NA', 'SA', 'OC', 'AN', 'SEA'] as const;
export type ContinentCode = (typeof CONTINENT_CODES)[number];

// Finds random places with real Street View coverage.
//
// Approach: draw a point from a weighted list of well-covered regions and ask
// the Street View Metadata API whether a panorama lies nearby. Metadata
// requests are free and have no quota, so we may roll as often as we like.

import { DEFAULT_REGION, DEFAULT_SCENERY, type LatLng, type RegionId, type SceneryId } from '@geo-battler/shared';
import { describePlace, type Located } from './geocode.ts';
import { continentOfCountry } from './continents.ts';
import { GameError } from './errors.ts';

const METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';

/** Search radius around the rolled point: large enough for hits, small enough to stay in the region. */
const SEARCH_RADIUS_M = 20000;

/** Search radius in the big-city scenery: coverage there is dense, and a wide net would pull the find out of town. */
const CITY_SEARCH_RADIUS_M = 2500;

/**
 * Search radius in the town and rural sceneries. Deliberately small: a rolled point only
 * counts when coverage is close by, which biases the draw toward built-up
 * areas - a town fills its surroundings with streets, a country road is a
 * thin line that a 2 km net rarely lands on.
 */
const TOWN_SEARCH_RADIUS_M = 2000;

/** Pause after a failed attempt - gives a short outage time to pass. */
const RETRY_PAUSE_MS = 400;

/**
 * This many *consecutive* errors mean a real outage, not a blip - surface the
 * error instead of holding the loading screen for the whole try budget (each
 * failed probe can take its full 8 s timeout).
 */
const MAX_CONSECUTIVE_ERRORS = 5;

/** An area tag assigns a box to regions; 'de', 'at', 'ch' are separate so there can be a DACH region. */
type Area = 'eu' | 'de' | 'at' | 'ch' | 'na' | 'sa' | 'as' | 'af' | 'oc';

interface Region {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  weight: number;
  area: Area;
  name: string;
}

const region = (minLat: number, minLng: number, maxLat: number, maxLng: number, weight: number, area: Area, name: string): Region =>
  ({ minLat, minLng, maxLat, maxLng, weight, area, name });

// Imprecise boxes (sea, desert) are harmless - misses only cost another free request.
export const REGIONS: readonly Region[] = [
  // --- Europe ---
  region(47.3, 5.9, 54.9, 15.0, 8, 'de', 'Germany'),
  region(42.5, -4.5, 51.0, 7.8, 8, 'eu', 'France'),
  region(50.0, -6.0, 58.6, 1.7, 7, 'eu', 'UK'),
  region(51.5, -10.4, 55.3, -6.0, 3, 'eu', 'Ireland'),
  region(36.1, -9.2, 43.7, 3.3, 7, 'eu', 'Spain'),
  region(37.0, -9.4, 42.0, -6.2, 3, 'eu', 'Portugal'),
  region(37.0, 7.0, 46.5, 18.4, 7, 'eu', 'Italy'),
  region(51.0, 3.4, 53.4, 7.1, 4, 'eu', 'Netherlands'),
  region(49.5, 2.6, 51.5, 6.3, 3, 'eu', 'Belgium'),
  region(45.9, 6.0, 47.7, 10.4, 3, 'ch', 'Switzerland'),
  region(46.4, 9.6, 49.0, 17.1, 3, 'at', 'Austria'),
  region(49.1, 14.2, 54.8, 23.8, 6, 'eu', 'Poland'),
  region(48.6, 12.1, 51.0, 18.8, 3, 'eu', 'Czechia'),
  region(55.4, 11.2, 68.0, 23.5, 5, 'eu', 'Sweden'),
  region(58.0, 5.0, 70.5, 29.0, 5, 'eu', 'Norway'),
  region(60.0, 21.5, 68.5, 30.0, 4, 'eu', 'Finland'),
  region(54.6, 8.1, 57.7, 12.6, 3, 'eu', 'Denmark'),
  region(43.7, 20.3, 48.2, 29.6, 4, 'eu', 'Romania'),
  region(45.8, 16.2, 48.5, 22.8, 2, 'eu', 'Hungary'),
  region(35.0, 20.2, 41.7, 26.5, 4, 'eu', 'Greece'),
  region(53.9, 21.0, 59.6, 28.2, 3, 'eu', 'Baltics'),
  region(44.4, 22.2, 52.3, 40.0, 3, 'eu', 'Ukraine'),
  region(36.0, 26.0, 42.0, 44.5, 5, 'eu', 'Turkey'),
  region(41.0, 13.4, 49.0, 23.0, 4, 'eu', 'Balkans / Slovakia'),
  region(63.3, -24.6, 66.5, -13.5, 2, 'eu', 'Iceland'),

  // --- North & Central America ---
  region(25.0, -124.6, 49.0, -67.0, 18, 'na', 'USA'),
  region(55.0, -160.0, 65.0, -135.0, 1, 'na', 'Alaska'),
  region(19.0, -159.8, 22.2, -155.0, 1, 'na', 'Hawaii'),
  region(43.0, -127.0, 55.0, -55.0, 8, 'na', 'Canada (south)'),
  region(15.0, -117.0, 32.5, -88.0, 6, 'na', 'Mexico'),
  region(7.2, -92.3, 17.8, -77.2, 2, 'na', 'Central America'),

  // --- South America ---
  region(-33.5, -57.5, -2.0, -39.0, 9, 'sa', 'Brazil (east)'),
  region(-10.0, -70.0, 0.5, -48.0, 2, 'sa', 'Brazil (north)'),
  region(-52.0, -71.5, -23.0, -58.0, 6, 'sa', 'Argentina'),
  region(-42.0, -74.0, -18.0, -69.5, 4, 'sa', 'Chile'),
  region(-17.0, -79.0, -4.0, -69.0, 3, 'sa', 'Peru'),
  region(1.5, -77.5, 11.0, -72.5, 3, 'sa', 'Colombia'),
  region(-21.0, -80.0, 1.0, -58.0, 2, 'sa', 'Ecuador / Bolivia'),
  region(-34.9, -58.4, -30.1, -53.2, 2, 'sa', 'Uruguay'),

  // --- Asia ---
  region(31.0, 130.0, 45.4, 145.8, 9, 'as', 'Japan'),
  region(34.0, 126.1, 38.5, 129.5, 5, 'as', 'South Korea'),
  region(21.9, 120.0, 25.3, 122.0, 3, 'as', 'Taiwan'),
  region(5.7, 97.4, 20.4, 105.6, 5, 'as', 'Thailand'),
  region(1.2, 99.6, 6.7, 119.3, 3, 'as', 'Malaysia / Singapore'),
  region(-10.0, 95.2, 5.9, 141.0, 5, 'as', 'Indonesia'),
  region(5.0, 117.2, 18.6, 126.6, 4, 'as', 'Philippines'),
  region(8.1, 68.7, 35.0, 97.4, 8, 'as', 'India'),
  region(5.9, 79.7, 9.8, 81.9, 2, 'as', 'Sri Lanka'),
  region(8.6, 102.1, 23.3, 109.5, 3, 'as', 'Vietnam / Cambodia / Laos'),
  region(21.5, 88.2, 26.5, 92.5, 2, 'as', 'Bangladesh'),
  region(26.4, 80.1, 29.3, 91.6, 1, 'as', 'Nepal / Bhutan'),
  region(29.5, 34.2, 33.3, 39.3, 2, 'as', 'Israel / Jordan'),
  region(22.6, 51.0, 26.4, 56.4, 2, 'as', 'UAE / Qatar'),
  region(40.0, 51.0, 55.0, 80.0, 2, 'as', 'Kazakhstan / Kyrgyzstan'),
  region(43.0, 88.0, 50.0, 116.0, 1, 'as', 'Mongolia'),
  region(44.0, 30.0, 60.0, 60.0, 4, 'as', 'Russia (west)'),
  region(50.0, 60.0, 62.0, 135.0, 2, 'as', 'Russia (east)'),

  // --- Africa ---
  region(-34.8, 16.5, -22.1, 32.9, 6, 'af', 'South Africa'),
  region(-11.5, 29.4, 4.6, 41.8, 3, 'af', 'Kenya / Tanzania / Uganda'),
  region(4.3, -17.5, 13.9, 14.5, 3, 'af', 'West Africa'),
  region(-29.0, 11.7, -17.8, 29.4, 3, 'af', 'Namibia / Botswana'),
  region(28.0, -13.0, 35.9, -1.0, 2, 'af', 'Morocco'),
  region(30.3, 7.5, 37.3, 11.5, 1, 'af', 'Tunisia'),
  region(22.0, 25.0, 31.6, 34.0, 2, 'af', 'Egypt'),

  // --- Oceania ---
  region(-43.6, 113.3, -11.0, 153.6, 10, 'oc', 'Australia'),
  region(-46.9, 166.4, -34.4, 178.6, 5, 'oc', 'New Zealand'),
];

// --- Big cities --------------------------------------------------------------
//
// The 'city' scenery ignores the boxes: it rolls inside one of these metros
// instead. Every city is drawn with the same chance - the size (2 = a
// million-ish, 10 = megacity) only sets how wide the disc around the centre
// is. The area tag is the same one the boxes carry, so a region filters
// cities exactly as it filters boxes: Moscow sits in the Russia box's area
// ('as'), so "Europe" means the same thing in every scenery.
// Only cities with official Street View coverage are listed - a wrong
// entry is harmless, misses only cost another free request (the pick below
// rejects anything that is not official coverage).
interface City {
  lat: number;
  lng: number;
  size: number;
  area: Area;
  name: string;
}

const city = (lat: number, lng: number, size: number, area: Area, name: string): City => ({ lat, lng, size, area, name });

export const CITIES: readonly City[] = [
  // --- Europe ---
  city(52.52, 13.41, 5, 'de', 'Berlin'),
  city(53.55, 9.99, 4, 'de', 'Hamburg'),
  city(48.14, 11.58, 4, 'de', 'Munich'),
  city(50.94, 6.96, 4, 'de', 'Cologne'),
  city(50.11, 8.68, 4, 'de', 'Frankfurt'),
  city(48.78, 9.18, 3, 'de', 'Stuttgart'),
  city(51.23, 6.78, 3, 'de', 'Düsseldorf'),
  city(51.34, 12.37, 2, 'de', 'Leipzig'),
  city(51.05, 13.74, 2, 'de', 'Dresden'),
  city(48.21, 16.37, 4, 'at', 'Vienna'),
  city(47.37, 8.54, 3, 'ch', 'Zurich'),
  city(46.2, 6.14, 2, 'ch', 'Geneva'),
  city(48.86, 2.35, 7, 'eu', 'Paris'),
  city(45.76, 4.84, 3, 'eu', 'Lyon'),
  city(43.3, 5.37, 3, 'eu', 'Marseille'),
  city(43.6, 1.44, 2, 'eu', 'Toulouse'),
  city(44.84, -0.58, 2, 'eu', 'Bordeaux'),
  city(51.51, -0.13, 7, 'eu', 'London'),
  city(52.48, -1.9, 3, 'eu', 'Birmingham'),
  city(53.48, -2.24, 3, 'eu', 'Manchester'),
  city(55.86, -4.25, 2, 'eu', 'Glasgow'),
  city(55.95, -3.19, 2, 'eu', 'Edinburgh'),
  city(53.35, -6.26, 3, 'eu', 'Dublin'),
  city(40.42, -3.7, 6, 'eu', 'Madrid'),
  city(41.39, 2.17, 5, 'eu', 'Barcelona'),
  city(39.47, -0.38, 2, 'eu', 'Valencia'),
  city(37.39, -5.99, 2, 'eu', 'Seville'),
  city(38.72, -9.14, 3, 'eu', 'Lisbon'),
  city(41.15, -8.61, 2, 'eu', 'Porto'),
  city(41.9, 12.5, 5, 'eu', 'Rome'),
  city(45.46, 9.19, 4, 'eu', 'Milan'),
  city(40.85, 14.27, 3, 'eu', 'Naples'),
  city(45.07, 7.69, 3, 'eu', 'Turin'),
  city(38.12, 13.36, 2, 'eu', 'Palermo'),
  city(52.37, 4.9, 3, 'eu', 'Amsterdam'),
  city(51.92, 4.48, 2, 'eu', 'Rotterdam'),
  city(50.85, 4.35, 3, 'eu', 'Brussels'),
  city(51.22, 4.4, 2, 'eu', 'Antwerp'),
  city(52.23, 21.01, 4, 'eu', 'Warsaw'),
  city(50.06, 19.94, 2, 'eu', 'Kraków'),
  city(51.11, 17.03, 2, 'eu', 'Wrocław'),
  city(54.35, 18.65, 2, 'eu', 'Gdańsk'),
  city(50.08, 14.44, 3, 'eu', 'Prague'),
  city(47.5, 19.04, 3, 'eu', 'Budapest'),
  city(44.43, 26.1, 3, 'eu', 'Bucharest'),
  city(42.7, 23.32, 2, 'eu', 'Sofia'),
  city(44.79, 20.45, 2, 'eu', 'Belgrade'),
  city(45.81, 15.98, 2, 'eu', 'Zagreb'),
  city(37.98, 23.73, 4, 'eu', 'Athens'),
  city(40.64, 22.94, 2, 'eu', 'Thessaloniki'),
  city(59.33, 18.07, 3, 'eu', 'Stockholm'),
  city(57.71, 11.97, 2, 'eu', 'Gothenburg'),
  city(59.91, 10.75, 2, 'eu', 'Oslo'),
  city(55.68, 12.57, 3, 'eu', 'Copenhagen'),
  city(60.17, 24.94, 2, 'eu', 'Helsinki'),
  city(54.69, 25.28, 2, 'eu', 'Vilnius'),
  city(56.95, 24.11, 2, 'eu', 'Riga'),
  city(59.44, 24.75, 2, 'eu', 'Tallinn'),
  city(50.45, 30.52, 3, 'eu', 'Kyiv'),
  city(41.01, 28.98, 8, 'eu', 'Istanbul'),
  city(39.93, 32.86, 4, 'eu', 'Ankara'),
  city(38.42, 27.14, 3, 'eu', 'Izmir'),
  // Russia sits in the 'as' boxes, so it does in the city list too - that way
  // "Europe" covers the same ground whichever scenery is played.
  city(55.76, 37.62, 6, 'as', 'Moscow'),
  city(59.93, 30.34, 4, 'as', 'Saint Petersburg'),

  // --- North & Central America ---
  city(40.71, -74.01, 10, 'na', 'New York'),
  city(34.05, -118.24, 8, 'na', 'Los Angeles'),
  city(41.88, -87.63, 6, 'na', 'Chicago'),
  city(29.76, -95.37, 5, 'na', 'Houston'),
  city(33.45, -112.07, 4, 'na', 'Phoenix'),
  city(39.95, -75.17, 4, 'na', 'Philadelphia'),
  city(32.72, -117.16, 3, 'na', 'San Diego'),
  city(32.78, -96.8, 4, 'na', 'Dallas'),
  city(37.77, -122.42, 4, 'na', 'San Francisco'),
  city(47.61, -122.33, 3, 'na', 'Seattle'),
  city(42.36, -71.06, 3, 'na', 'Boston'),
  city(25.76, -80.19, 4, 'na', 'Miami'),
  city(33.75, -84.39, 3, 'na', 'Atlanta'),
  city(39.74, -104.99, 3, 'na', 'Denver'),
  city(38.91, -77.04, 4, 'na', 'Washington'),
  city(36.17, -115.14, 3, 'na', 'Las Vegas'),
  city(42.33, -83.05, 3, 'na', 'Detroit'),
  city(44.98, -93.27, 2, 'na', 'Minneapolis'),
  city(29.95, -90.07, 2, 'na', 'New Orleans'),
  city(45.52, -122.68, 2, 'na', 'Portland'),
  city(43.65, -79.38, 5, 'na', 'Toronto'),
  city(45.5, -73.57, 4, 'na', 'Montreal'),
  city(49.28, -123.12, 3, 'na', 'Vancouver'),
  city(51.05, -114.07, 2, 'na', 'Calgary'),
  city(45.42, -75.7, 2, 'na', 'Ottawa'),
  city(19.43, -99.13, 9, 'na', 'Mexico City'),
  city(20.67, -103.35, 4, 'na', 'Guadalajara'),
  city(25.67, -100.31, 4, 'na', 'Monterrey'),
  city(19.04, -98.2, 2, 'na', 'Puebla'),
  city(32.52, -117.04, 2, 'na', 'Tijuana'),
  city(14.62, -90.52, 2, 'na', 'Guatemala City'),
  city(8.98, -79.52, 2, 'na', 'Panama City'),
  city(9.93, -84.08, 2, 'na', 'San José'),

  // --- South America ---
  city(4.61, -74.08, 6, 'sa', 'Bogotá'),
  city(6.25, -75.57, 3, 'sa', 'Medellín'),
  city(3.45, -76.53, 2, 'sa', 'Cali'),
  city(-12.05, -77.04, 6, 'sa', 'Lima'),
  city(-0.19, -78.49, 2, 'sa', 'Quito'),
  city(-2.19, -79.89, 2, 'sa', 'Guayaquil'),
  city(-33.45, -70.67, 5, 'sa', 'Santiago'),
  city(-34.6, -58.38, 8, 'sa', 'Buenos Aires'),
  city(-31.42, -64.18, 3, 'sa', 'Córdoba'),
  city(-32.95, -60.65, 2, 'sa', 'Rosario'),
  city(-34.9, -56.19, 3, 'sa', 'Montevideo'),
  city(-23.55, -46.63, 10, 'sa', 'São Paulo'),
  city(-22.91, -43.18, 7, 'sa', 'Rio de Janeiro'),
  city(-19.92, -43.94, 4, 'sa', 'Belo Horizonte'),
  city(-15.79, -47.88, 3, 'sa', 'Brasília'),
  city(-12.97, -38.5, 3, 'sa', 'Salvador'),
  city(-3.72, -38.54, 3, 'sa', 'Fortaleza'),
  city(-8.05, -34.9, 3, 'sa', 'Recife'),
  city(-30.03, -51.22, 3, 'sa', 'Porto Alegre'),
  city(-25.43, -49.27, 3, 'sa', 'Curitiba'),

  // --- Asia ---
  city(35.68, 139.69, 10, 'as', 'Tokyo'),
  city(35.44, 139.64, 3, 'as', 'Yokohama'),
  city(34.69, 135.5, 8, 'as', 'Osaka'),
  city(35.18, 136.91, 5, 'as', 'Nagoya'),
  city(43.06, 141.35, 3, 'as', 'Sapporo'),
  city(33.59, 130.4, 3, 'as', 'Fukuoka'),
  city(35.01, 135.77, 3, 'as', 'Kyoto'),
  city(34.39, 132.46, 2, 'as', 'Hiroshima'),
  city(38.27, 140.87, 2, 'as', 'Sendai'),
  city(37.57, 126.98, 9, 'as', 'Seoul'),
  city(35.18, 129.08, 4, 'as', 'Busan'),
  city(37.46, 126.71, 3, 'as', 'Incheon'),
  city(35.87, 128.6, 3, 'as', 'Daegu'),
  city(25.03, 121.57, 5, 'as', 'Taipei'),
  city(22.63, 120.3, 3, 'as', 'Kaohsiung'),
  city(24.15, 120.67, 2, 'as', 'Taichung'),
  city(13.75, 100.5, 7, 'as', 'Bangkok'),
  city(18.79, 98.99, 2, 'as', 'Chiang Mai'),
  city(3.14, 101.69, 4, 'as', 'Kuala Lumpur'),
  city(1.35, 103.86, 4, 'as', 'Singapore'),
  city(-6.21, 106.85, 8, 'as', 'Jakarta'),
  city(-7.25, 112.75, 3, 'as', 'Surabaya'),
  city(-6.92, 107.61, 3, 'as', 'Bandung'),
  city(14.6, 120.98, 7, 'as', 'Manila'),
  city(10.32, 123.9, 2, 'as', 'Cebu'),
  city(10.78, 106.7, 3, 'as', 'Ho Chi Minh City'),
  city(21.03, 105.85, 3, 'as', 'Hanoi'),
  city(28.61, 77.21, 9, 'as', 'Delhi'),
  city(19.08, 72.88, 9, 'as', 'Mumbai'),
  city(12.97, 77.59, 6, 'as', 'Bengaluru'),
  city(17.39, 78.49, 5, 'as', 'Hyderabad'),
  city(13.08, 80.27, 5, 'as', 'Chennai'),
  city(22.57, 88.36, 6, 'as', 'Kolkata'),
  city(18.52, 73.86, 4, 'as', 'Pune'),
  city(23.03, 72.58, 4, 'as', 'Ahmedabad'),
  city(26.91, 75.79, 3, 'as', 'Jaipur'),
  city(23.81, 90.41, 4, 'as', 'Dhaka'),
  city(6.93, 79.85, 2, 'as', 'Colombo'),
  city(25.2, 55.27, 4, 'as', 'Dubai'),
  city(24.45, 54.38, 2, 'as', 'Abu Dhabi'),
  city(25.29, 51.53, 2, 'as', 'Doha'),
  city(32.08, 34.78, 3, 'as', 'Tel Aviv'),
  city(31.78, 35.22, 2, 'as', 'Jerusalem'),
  city(31.95, 35.93, 2, 'as', 'Amman'),
  city(43.24, 76.89, 2, 'as', 'Almaty'),
  city(51.17, 71.43, 2, 'as', 'Astana'),
  city(47.89, 106.91, 2, 'as', 'Ulaanbaatar'),

  // --- Africa ---
  city(-26.2, 28.04, 5, 'af', 'Johannesburg'),
  city(-33.93, 18.42, 4, 'af', 'Cape Town'),
  city(-29.86, 31.02, 3, 'af', 'Durban'),
  city(-25.75, 28.19, 2, 'af', 'Pretoria'),
  city(-1.29, 36.82, 4, 'af', 'Nairobi'),
  city(-4.04, 39.66, 2, 'af', 'Mombasa'),
  city(0.35, 32.58, 2, 'af', 'Kampala'),
  city(-6.79, 39.21, 2, 'af', 'Dar es Salaam'),
  city(6.52, 3.38, 4, 'af', 'Lagos'),
  city(5.56, -0.2, 3, 'af', 'Accra'),
  city(14.72, -17.47, 2, 'af', 'Dakar'),
  city(36.81, 10.18, 2, 'af', 'Tunis'),

  // --- Oceania ---
  city(-33.87, 151.21, 5, 'oc', 'Sydney'),
  city(-37.81, 144.96, 5, 'oc', 'Melbourne'),
  city(-27.47, 153.03, 3, 'oc', 'Brisbane'),
  city(-31.95, 115.86, 3, 'oc', 'Perth'),
  city(-34.93, 138.6, 2, 'oc', 'Adelaide'),
  city(-35.28, 149.13, 2, 'oc', 'Canberra'),
  city(-36.85, 174.76, 3, 'oc', 'Auckland'),
  city(-41.29, 174.78, 2, 'oc', 'Wellington'),
  city(-43.53, 172.64, 2, 'oc', 'Christchurch'),
];

/** The cities of a region - the same area tags the boxes use. */
export function citiesOf(regionId: RegionId): readonly City[] {
  const def = REGION_DEFS[regionId];
  return def.areas ? CITIES.filter((c) => def.areas!.includes(c.area)) : CITIES;
}

/** Bigger metros get a bigger disc around the centre: a million-ish city ~3 km, a megacity ~8 km. */
export const cityRadiusKm = (c: City): number => 2 + c.size * 0.6;

// --- Map packs -------------------------------------------------------------
//
// A region is a selection of the boxes above - and, for the big-city scenery,
// of the city list. The lobby votes on it separately from the scenery, so
// "big city in DACH" is a combination like any other. Hall of Fame records
// only count on world + any scenery - on anything smaller every guess is closer.
//
// The boxes are rectangles and reach across borders: the Austria box into
// Bohemia, the Turkey box into Syria. So every find outside the world region is
// cross-checked by geocoding: its country must lie on one of the region's
// continents or in its country list. That costs one request per candidate,
// which the reveal would make for the place name anyway.
interface RegionDef {
  areas: readonly Area[] | null;
  continents?: readonly string[];
  countries?: readonly string[];
}

const REGION_DEFS: Record<RegionId, RegionDef> = {
  world: { areas: null },
  europe: { areas: ['eu', 'de', 'at', 'ch'], continents: ['EU'], countries: ['TR'] },
  dach: { areas: ['de', 'at', 'ch'], countries: ['DE', 'AT', 'CH'] },
  americas: { areas: ['na', 'sa'], continents: ['NA', 'SA'] },
  asia: { areas: ['as'], continents: ['AS'] },
  africa: { areas: ['af'], continents: ['AF'] },
  oceania: { areas: ['oc'], continents: ['OC'] },
};

export function regionsOf(regionId: RegionId): readonly Region[] {
  const def = REGION_DEFS[regionId];
  return def.areas ? REGIONS.filter((r) => def.areas!.includes(r.area)) : REGIONS;
}

/**
 * Is the find inside the region? On the world, always. Otherwise the country
 * decides. If the country cannot be determined right now (geocoding off,
 * open sea) the find counts - better a place just across the border than no
 * game at all. The place name stays attached so the reveal does not ask again.
 */
async function withinRegion(hit: Located, def: RegionDef, apiKey: string): Promise<boolean> {
  if (!def.continents && !def.countries) return true;
  const place = await describePlace(hit, apiKey);
  if (!place?.countryCode) return true;
  hit.place = place;
  return !!def.countries?.includes(place.countryCode)
    || !!def.continents?.includes(continentOfCountry(place.countryCode) ?? '');
}

function pickWeighted<T extends { weight: number }>(items: readonly T[], random: () => number): T {
  if (items.length === 0) throw new Error('pickWeighted: nothing to pick from');
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * totalWeight;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}

/**
 * A random point to probe: inside one of the region's boxes, or - for the big
 * city scenery - inside one of its metros' discs. `random` is injectable for
 * tests.
 */
export function randomPoint(region: RegionId, scenery: SceneryId = DEFAULT_SCENERY, random: () => number = Math.random): LatLng {
  if (scenery === 'city') {
    const cities = citiesOf(region);
    const picked = cities[Math.min(Math.floor(random() * cities.length), cities.length - 1)]!;
    // Uniform in the disc: without the square root everything would crowd the centre.
    const meters = cityRadiusKm(picked) * 1000 * Math.sqrt(random());
    return offsetPoint(picked, random() * 360, meters);
  }
  const picked = pickWeighted(regionsOf(region), random);
  return {
    lat: picked.minLat + random() * (picked.maxLat - picked.minLat),
    lng: picked.minLng + random() * (picked.maxLng - picked.minLng),
  };
}

// --- Movement check --------------------------------------------------------
//
// The Metadata API only says whether *some* panorama lies at a spot - not
// whether you can move away from it. Isolated photo spheres (uploaded by
// users, with no link to neighbouring panoramas) look exactly like real road
// coverage to the API. So when movement is allowed we additionally check:
//   1. copyright "(c) Google" -> official coverage rather than a user photo sphere
//   2. at least one *other* panorama within walking distance -> the chain you
//      can move along really exists.
const NEIGHBOR_BEARINGS = [0, 90, 180, 270];
const NEIGHBOR_OFFSET_M = 30; // how far from the find we measure
const NEIGHBOR_RADIUS_M = 25; // search radius there (smaller than the offset, so the same panorama does not come back)

export function offsetPoint({ lat, lng }: LatLng, bearingDeg: number, meters: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111320;
  const dLng = (meters * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180) || 1e-9);
  return { lat: lat + dLat, lng: lng + dLng };
}

const isOfficialCoverage = (copyright: string): boolean => /google/i.test(copyright);

interface Hit extends Located {
  copyright: string;
}

interface MetadataResponse {
  status: string;
  error_message?: string;
  pano_id?: string;
  location?: LatLng;
  copyright?: string;
}

async function probe(point: LatLng, apiKey: string, radius = SEARCH_RADIUS_M): Promise<Hit | null> {
  const url = new URL(METADATA_URL);
  url.searchParams.set('location', `${point.lat},${point.lng}`);
  url.searchParams.set('radius', String(radius));
  url.searchParams.set('source', 'outdoor');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Metadata API HTTP ${res.status}`);
  const data = (await res.json()) as MetadataResponse;

  if (data.status === 'OK' && data.pano_id && data.location) {
    return { panoId: data.pano_id, lat: data.location.lat, lng: data.location.lng, copyright: data.copyright ?? '' };
  }
  if (data.status === 'ZERO_RESULTS') return null;

  // REQUEST_DENIED / OVER_QUERY_LIMIT / INVALID_REQUEST -> a real error
  throw new Error(`Metadata API: ${data.status}${data.error_message ? ` - ${data.error_message}` : ''}`);
}

/** Is there another panorama within walking distance? (4 free metadata requests) */
async function hasNeighborPano(hit: Hit, apiKey: string): Promise<boolean> {
  const neighbors = await Promise.all(
    NEIGHBOR_BEARINGS.map((b) => probe(offsetPoint(hit, b, NEIGHBOR_OFFSET_M), apiKey, NEIGHBOR_RADIUS_M)),
  );
  return neighbors.some((n) => n && n.panoId !== hit.panoId);
}

// --- Built-up check ----------------------------------------------------------
//
// For the 'town' and 'rural' sceneries: is the find inside a settlement rather
// than on a country road? Probe a ring around it - four circles at 130 m with a
// 55 m radius, so together they cover the band 75-185 m from the find. A
// straight road passes through at most two of them (ahead and behind; a
// diagonal one misses all four), but a street grid - even Feucht's - puts a
// panorama in nearly every direction. Four more free metadata requests per
// candidate, and 'rural' simply wants the opposite answer.
const TOWN_RING_OFFSET_M = 130;
const TOWN_RING_RADIUS_M = 55;
const TOWN_MIN_DIRECTIONS = 3;

/**
 * The pure decision: in how many directions did the ring find a *different*,
 * official panorama? User photospheres do not count - a cluster of them at a
 * scenic viewpoint would otherwise fake a settlement.
 */
export const isBuiltUp = (hitPanoId: string, ring: readonly ({ panoId: string; copyright: string } | null)[]): boolean =>
  ring.filter((p) => p && p.panoId !== hitPanoId && isOfficialCoverage(p.copyright)).length >= TOWN_MIN_DIRECTIONS;

async function looksBuiltUp(hit: Hit, apiKey: string): Promise<boolean> {
  const ring = await Promise.all(
    NEIGHBOR_BEARINGS.map((b) => probe(offsetPoint(hit, b, TOWN_RING_OFFSET_M), apiKey, TOWN_RING_RADIUS_M)),
  );
  return isBuiltUp(hit.panoId, ring);
}

export interface SearchOptions {
  maxTries?: number;
  requireMove?: boolean;
  region?: RegionId;
  scenery?: SceneryId;
}

/** How far the metadata probe looks around the rolled point, per scenery. */
function searchRadius(scenery: SceneryId): number {
  if (scenery === 'city') return CITY_SEARCH_RADIUS_M;
  // 'town' and 'rural' both want the roll to land near coverage rather than
  // snap to the nearest road 20 km away, or the ring check says nothing.
  return scenery === 'any' ? SEARCH_RADIUS_M : TOWN_SEARCH_RADIUS_M;
}

/**
 * Finds a single place with Street View coverage in the region and scenery.
 * With `requireMove`, only places you can also move away from.
 */
export async function pickLocation(
  apiKey: string,
  { maxTries, requireMove = false, region = DEFAULT_REGION, scenery = DEFAULT_SCENERY }: SearchOptions = {},
): Promise<Located> {
  let lastError: Error | null = null;
  const radius = searchRadius(scenery);
  // Town and rural reject most candidates, so they get more tries. Misses are
  // cheap: one request each, and all of them free.
  const tries = maxTries ?? (scenery === 'town' || scenery === 'rural' ? 200 : 60);
  let consecutiveErrors = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const hit = await probe(randomPoint(region, scenery), apiKey, radius);
      consecutiveErrors = 0;
      if (!hit) continue;
      // Every scenery but 'any' judges the surroundings, and a lone user
      // photosphere shows none - a rooftop sphere is neither town nor country.
      if (scenery !== 'any' && !isOfficialCoverage(hit.copyright)) continue;
      if (scenery === 'town' && !(await looksBuiltUp(hit, apiKey))) continue;
      if (scenery === 'rural' && (await looksBuiltUp(hit, apiKey))) continue;
      if (requireMove) {
        if (!isOfficialCoverage(hit.copyright)) continue;
        if (!(await hasNeighborPano(hit, apiKey))) continue;
      }
      if (!(await withinRegion(hit, REGION_DEFS[region], apiKey))) continue;
      return { panoId: hit.panoId, lat: hit.lat, lng: hit.lng, ...(hit.place !== undefined ? { place: hit.place } : {}) };
    } catch (err) {
      lastError = err as Error;
      // Configuration errors repeat anyway - give up immediately.
      if (/REQUEST_DENIED|API_KEY/i.test(lastError.message)) throw lastError;
      // Everything else (UNKNOWN_ERROR, timeout) is usually transient. Take a
      // breath, otherwise one outage burns through all attempts in seconds -
      // but a whole row of failures is an outage, not a blip.
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw lastError;
      await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    }
  }
  throw lastError ?? new GameError('noStreetView');
}

/** Finds `count` distinct places in parallel. */
export async function pickLocations(count: number, apiKey: string, options: SearchOptions = {}): Promise<Located[]> {
  const found = new Map<string, Located>();
  let guard = 0;

  while (found.size < count && guard < 6) {
    guard++;
    const missing = count - found.size;
    const batch = await Promise.all(Array.from({ length: missing }, () => pickLocation(apiKey, options)));
    for (const loc of batch) {
      if (!found.has(loc.panoId)) found.set(loc.panoId, loc);
    }
  }

  return Array.from(found.values()).slice(0, count);
}

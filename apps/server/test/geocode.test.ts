import { describe, expect, it } from 'vitest';
import { labelFrom } from '../src/geocode.ts';

const component = (type: string, long: string, short = long) => ({ types: [type], long_name: long, short_name: short });

describe('labelFrom', () => {
  it('joins place, region and country without duplicates', () => {
    const results = [
      { address_components: [component('street_number', '12')] },
      { address_components: [component('locality', 'Montevideo'), component('administrative_area_level_1', 'Montevideo'), component('country', 'Uruguay', 'UY')] },
    ];
    expect(labelFrom(results)).toEqual({ label: 'Montevideo, Uruguay', countryCode: 'UY' });
  });
  it('returns null without a place or a country', () => {
    expect(labelFrom([{ address_components: [component('route', 'Main St')] }])).toBeNull();
    expect(labelFrom([])).toBeNull();
  });
});

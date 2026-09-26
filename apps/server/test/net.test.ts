import { describe, expect, it } from 'vitest';
import { isLocalAddress, normalizeAddress } from '../src/net.ts';

describe('isLocalAddress', () => {
  it('accepts private ranges, loopback and IPv6 local addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.1', '169.254.1.1', '::1', '::ffff:192.168.1.5', 'fe80::1', 'fd12::1']) {
      expect(isLocalAddress(ip), ip).toBe(true);
    }
  });
  it('rejects public addresses and garbage', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:db8::1', '', undefined]) expect(isLocalAddress(ip), String(ip)).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('strips the IPv4-in-IPv6 wrapper and brackets', () => {
    expect(normalizeAddress('::FFFF:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeAddress('[::1]:3000')).toBe('::1');
  });
});

// Tells whether a peer is on the local network.
//
// Deliberately ignores X-Forwarded-For: nothing sits in front of this server,
// so the header could say anything. Only the real socket address counts.

const PRIVATE_V4 = [
  /^10\./,                          // 10.0.0.0/8
  /^127\./,                         // loopback
  /^192\.168\./,                    // 192.168.0.0/16
  /^169\.254\./,                    // link-local
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12 - WSL2 lives here too
];

/** Strips the IPv4-in-IPv6 wrapper (`::ffff:192.168.1.5`) and brackets. */
export function normalizeAddress(raw: string | undefined | null): string {
  if (!raw) return '';
  let ip = raw.trim();
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return (mapped?.[1] ?? ip).toLowerCase();
}

export function isLocalAddress(raw: string | undefined | null): boolean {
  const ip = normalizeAddress(raw);
  if (!ip) return false;

  if (ip === '::1' || ip === '::') return true;          // IPv6 loopback
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;        // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;        // fc00::/7 unique local

  return PRIVATE_V4.some((pattern) => pattern.test(ip));
}

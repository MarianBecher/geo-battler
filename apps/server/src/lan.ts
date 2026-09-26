// The addresses the other players can reach this machine on.

import os from 'node:os';

export function lanAddresses(): string[] {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  // 172.16-31.x is usually a virtual interface (WSL NAT, Docker, Hyper-V)
  // and useless for the other players - real LAN addresses first.
  const virtualish = (ip: string): boolean => /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return [...new Set(addresses)].sort((a, b) => Number(virtualish(a)) - Number(virtualish(b)));
}

export const lanUrls = (port: number): string[] => lanAddresses().map((ip) => `http://${ip}:${port}`);

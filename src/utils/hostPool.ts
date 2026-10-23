/**
 * Interchangeable origins for one thing — an API, or one site of a platform —
 * primary first. Sites and their APIs fail independently: behind some VPNs
 * senkuro.me opens while api.senkuro.me doesn't, so each gets its own pool.
 */
export interface HostPool {
  id: string;
  hosts: readonly string[];
}

export interface HostChoice {
  host: string;
  expires: number;
}

/** The remembered working host goes first — a dead primary would cost a timeout on every request. */
export function orderHosts(pool: HostPool, choice: HostChoice | undefined, now: number): string[] {
  const first =
    choice && choice.expires > now && pool.hosts.includes(choice.host) ? choice.host : pool.hosts[0];
  return [first, ...pool.hosts.filter((host) => host !== first)];
}

/**
 * Worth trying another host: no answer, a block (403 from DDoS-Guard or a geo
 * filter, 451), rate limiting or a server error. A 404 or 401 is the host
 * answering — another one would say the same.
 */
export function isUnavailable(status: number | undefined): boolean {
  return status === undefined || status === 403 || status === 408 || status === 429 || status === 451 || status >= 500;
}

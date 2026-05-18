/**
 * Network-address classification for SSRF defenses on operator-defined
 * HTTP tools. Hostname-based regex alone is insufficient: a public
 * hostname can resolve to a private IP via DNS rebinding, so the proxy
 * route must resolve and re-check at request time.
 */

/** True if the IP literal is in a loopback, private, link-local, or
 *  similar non-internet range. Handles IPv4 dotted-quad, IPv6 in any
 *  valid form (compressed `::`, IPv4-mapped, hex IPv4-mapped, etc.),
 *  and fails closed on anything unparseable. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v) return true;

  if (v.includes(":")) {
    const groups = expandIpv6(v);
    if (!groups) return true; // unparseable IPv6 → fail closed
    return classifyIpv6Groups(groups);
  }

  return classifyIpv4(v);
}

/** Expand any IPv6 form into an array of 8 16-bit numeric groups, or
 *  null if the input isn't a valid IPv6 literal. Handles `::`
 *  compression and IPv4-mapped suffixes like `::ffff:127.0.0.1`. */
function expandIpv6(input: string): number[] | null {
  let s = input;
  // IPv4-tail form: split off the trailing dotted-quad if present.
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0 && s.slice(lastColon + 1).includes(".")) {
    const tailV4 = s.slice(lastColon + 1);
    const parts = tailV4.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    tail = [(parts[0]! << 8) | parts[1]!, (parts[2]! << 8) | parts[3]!];
    s = s.slice(0, lastColon);
  }

  // Split around `::` (at most one) for compression.
  let left: string[] = [];
  let right: string[] = [];
  if (s.includes("::")) {
    const [lhs, rhs, ...rest] = s.split("::");
    if (rest.length > 0) return null; // more than one `::` is invalid
    left = lhs ? lhs.split(":") : [];
    right = rhs ? rhs.split(":") : [];
  } else {
    left = s.split(":");
  }
  if (left.some((g) => g === "") || right.some((g) => g === "")) return null;

  // Validate each group is 1-4 hex chars.
  const groupRe = /^[0-9a-f]{1,4}$/;
  if (![...left, ...right].every((g) => groupRe.test(g))) return null;

  const leftNums = left.map((g) => parseInt(g, 16));
  const rightNums = right.map((g) => parseInt(g, 16));
  const known = leftNums.length + rightNums.length + tail.length;
  const fill = 8 - known;
  if (fill < 0) return null;
  if (fill > 0 && !input.includes("::")) return null; // must use `::` to skip

  const zeros = new Array<number>(fill).fill(0);
  return [...leftNums, ...zeros, ...rightNums, ...tail];
}

function classifyIpv6Groups(g: number[]): boolean {
  if (g.length !== 8) return true; // shouldn't happen, fail closed
  // ::1 (loopback) or :: (unspecified).
  if (g.every((x, i) => (i < 7 ? x === 0 : x === 0 || x === 1))) return true;
  // fe80::/10 link-local.
  if ((g[0]! & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique-local.
  if ((g[0]! & 0xfe00) === 0xfc00) return true;
  // ::ffff:0:0/96 IPv4-mapped — re-classify the embedded v4.
  if (
    g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 &&
    g[4] === 0 && g[5] === 0xffff
  ) {
    const a = (g[6]! >> 8) & 0xff;
    const b = g[6]! & 0xff;
    const c = (g[7]! >> 8) & 0xff;
    const d = g[7]! & 0xff;
    return classifyIpv4(`${a}.${b}.${c}.${d}`);
  }
  // Multicast (ff00::/8) and other reserved high prefixes — treat as non-routable for our purposes.
  if ((g[0]! & 0xff00) === 0xff00) return true;
  return false;
}

function classifyIpv4(v: string): boolean {
  const parts = v.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;
  if (a === 10) return true;                              // 10.0.0.0/8
  if (a === 127) return true;                             // loopback
  if (a === 0) return true;                               // 0.0.0.0/8
  if (a === 169 && b === 254) return true;                // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT
  if (a >= 224) return true;                              // multicast + reserved
  return false;
}

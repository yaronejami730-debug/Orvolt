/** Détection d'adresses/hôtes non publics (SSRF). Sans dépendance Node : utilisable partout. */

function parseIPv4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

function forbiddenIPv4(p: number[]): boolean {
  const [a, b, c] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, réservé, broadcast
  );
}

/** Parse une IPv6 en 8 groupes de 16 bits (gère '::' et IPv4 final). */
function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase().replace(/%.*$/, "");
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = parseIPv4(v4[1]!);
    if (!p) return null;
    s = s.slice(0, -v4[1]!.length) + ((p[0]! << 8) | p[1]!).toString(16) + ":" + ((p[2]! << 8) | p[3]!).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill("0"), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function forbiddenIPv6(g: number[]): boolean {
  const v4 = (hi: number, lo: number) => forbiddenIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(g[6]!, g[7]!); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible (obsolète)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/32 (incl. /96 et local-use)
  if (g[0] === 0x2002) return v4(g[1]!, g[2]!); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** true si l'hôte (nom ou littéral IP) ne doit pas être joint. Inconnu/illisible = interdit. */
export function isForbiddenHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || /\.(localhost|local|internal|localdomain|home|lan)$/.test(h) || h === "metadata") return true;
  if (h.includes(":")) {
    const g = parseIPv6(h);
    return g === null || forbiddenIPv6(g);
  }
  if (/^[0-9.]+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) {
    const p = parseIPv4(h);
    return p === null || forbiddenIPv4(p); // formes non canoniques = interdites
  }
  return false;
}

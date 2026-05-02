export interface TleEntry {
  name: string;
  line1: string;
  line2: string;
}

export interface SatelliteMeta {
  name: string;
  noradId: string;
  category: string;
  altitudeKm: number;
  periodMin: number;
  line1: string;
  line2: string;
}

/**
 * Parse the Celestrak 3LE format. The body is repeating triplets:
 *   line0: friendly name (24 chars, sometimes trailing whitespace)
 *   line1: TLE line 1 starting with "1 "
 *   line2: TLE line 2 starting with "2 "
 * Lines may be CRLF or LF terminated. Blank lines are skipped.
 */
export function parseTLE(text: string): TleEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const out: TleEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) {
      // realign: scan forward until we hit a "1 " then back up the name
      // For now just skip malformed triplet
      continue;
    }
    out.push({ name, line1, line2 });
  }
  return out;
}

export function parseNoradId(line1: string): string {
  // cols 3-7 (1-indexed) → substring(2, 7)
  return line1.substring(2, 7).trim();
}

export function parseMeanMotion(line2: string): number {
  // cols 53-63 (1-indexed) → substring(52, 63), revs per day
  const raw = line2.substring(52, 63).trim();
  const v = parseFloat(raw);
  return isFinite(v) ? v : 0;
}

export interface CategoryStyle {
  category: string;
  cssColor: string;
  pixelSize: number;
}

export function categorizeSatellite(name: string): CategoryStyle {
  const upper = name.toUpperCase();
  // Debris / rocket bodies first — they often share other naming conventions
  if (/\bDEB\b/.test(upper) || /\bR\/B\b/.test(upper)) {
    return { category: "Debris / Rocket Body", cssColor: "#7f1d1d", pixelSize: 1.5 };
  }
  if (upper === "ISS (ZARYA)" || upper.startsWith("ISS (ZARYA)")) {
    return { category: "ISS", cssColor: "#fbbf24", pixelSize: 6 };
  }
  if (upper.includes("STARLINK")) {
    return { category: "Starlink", cssColor: "#888888", pixelSize: 2 };
  }
  if (
    upper.includes("NAVSTAR") ||
    upper.includes("GPS BIIF") ||
    upper.includes("GPS BIII")
  ) {
    return { category: "GPS", cssColor: "#3b82f6", pixelSize: 3 };
  }
  if (
    upper.includes("GALILEO") ||
    upper.includes("BEIDOU") ||
    upper.includes("GLONASS")
  ) {
    return { category: "GNSS", cssColor: "#60a5fa", pixelSize: 3 };
  }
  return { category: "Active", cssColor: "#10b981", pixelSize: 2 };
}

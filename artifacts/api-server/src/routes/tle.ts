import { Router, type IRouter } from "express";
import tleSnapshot from "../data/tle-snapshot.txt";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const REFRESH_PAGE_SIZE = 100;
const REFRESH_PAGES = 50; // 5000 most-popular satellites
const REFRESH_CONCURRENCY = 2;
const MIRROR_BASE = "https://tle.ivanstanojevic.me/api/tle";
const CELESTRAK_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";

interface CacheEntry {
  body: string;
  fetchedAt: number;
  source: "celestrak" | "mirror" | "snapshot";
}

// Seed cache with the bundled snapshot so the very first request is instant.
let cache: CacheEntry = {
  body: tleSnapshot,
  fetchedAt: 0, // 0 forces a background refresh on the first request
  source: "snapshot",
};
let inFlight: Promise<CacheEntry> | null = null;

interface MirrorTle {
  name?: string;
  line1?: string;
  line2?: string;
}
interface MirrorPage {
  member?: MirrorTle[];
}

async function fetchCelestrak(): Promise<string> {
  const res = await fetch(CELESTRAK_URL, {
    headers: { "User-Agent": "architects-eye/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`celestrak returned HTTP ${res.status}`);
  }
  return res.text();
}

async function fetchMirrorPage(page: number): Promise<MirrorPage> {
  const url = `${MIRROR_BASE}?page-size=${REFRESH_PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`mirror page ${page} returned HTTP ${res.status}`);
  }
  return res.json() as Promise<MirrorPage>;
}

async function fetchMirror(): Promise<string> {
  const pages: Array<MirrorPage | null> = new Array(REFRESH_PAGES).fill(null);
  let next = 1;
  let failures = 0;
  async function worker(): Promise<void> {
    while (true) {
      const p = next++;
      if (p > REFRESH_PAGES) return;
      try {
        pages[p - 1] = await fetchMirrorPage(p);
      } catch {
        failures++;
      }
    }
  }
  await Promise.all(
    Array.from({ length: REFRESH_CONCURRENCY }, () => worker()),
  );
  // Tolerate a small number of failed pages — but bail if too many failed
  if (failures > REFRESH_PAGES / 4) {
    throw new Error(`mirror fetch had ${failures} failed pages of ${REFRESH_PAGES}`);
  }
  const lines: string[] = [];
  for (const page of pages) {
    if (!page?.member) continue;
    for (const t of page.member) {
      if (!t.name || !t.line1 || !t.line2) continue;
      lines.push(t.name, t.line1, t.line2);
    }
  }
  return lines.join("\n") + "\n";
}

async function refreshFromUpstream(): Promise<CacheEntry> {
  // Try celestrak first (it's been blocking us, but worth one quick attempt)
  try {
    const body = await fetchCelestrak();
    return { body, fetchedAt: Date.now(), source: "celestrak" };
  } catch {
    // fall through to mirror
  }
  try {
    const body = await fetchMirror();
    return { body, fetchedAt: Date.now(), source: "mirror" };
  } catch {
    // fall through to bundled snapshot
  }
  return { body: tleSnapshot, fetchedAt: Date.now(), source: "snapshot" };
}

async function getOrRefresh(): Promise<CacheEntry> {
  if (inFlight) return inFlight;
  inFlight = refreshFromUpstream().finally(() => {
    inFlight = null;
  });
  const entry = await inFlight;
  cache = entry;
  return entry;
}

const router: IRouter = Router();

router.get("/tle", (req, res) => {
  const now = Date.now();
  const stale = now - cache.fetchedAt >= CACHE_TTL_MS;

  // Always serve the current cache immediately (instant response).
  res
    .type("text/plain")
    .set("X-TLE-Source", cache.source)
    .set("X-TLE-Age-Sec", String(Math.floor((now - cache.fetchedAt) / 1000)))
    .send(cache.body);

  // Kick off a background refresh if the cache is stale and nothing is in flight.
  if (stale && !inFlight) {
    getOrRefresh()
      .then((entry) => {
        req.log.info(
          { source: entry.source, bytes: entry.body.length },
          "TLE refreshed",
        );
      })
      .catch((err) => {
        req.log.warn({ err }, "TLE background refresh failed");
      });
  }
});

export default router;

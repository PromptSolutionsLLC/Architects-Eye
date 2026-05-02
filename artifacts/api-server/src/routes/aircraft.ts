import { Router, type IRouter } from "express";

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
}

const CACHE_FRESH_MS = 8_000;
const CACHE_STALE_MS = 60_000;

// Fresh/stale response cache
const cache = new Map<string, CacheEntry>();
// In-flight deduplication: concurrent requests for the same key share one fetch
const inFlight = new Map<string, Promise<unknown>>();

async function fetchUpstream(
  key: string,
  url: string,
): Promise<unknown> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": "architects-eye/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`adsb.lol returned HTTP ${res.status}`);
    }
    const data = await res.json();
    cache.set(key, { data, fetchedAt: Date.now() });
    return data;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

const router: IRouter = Router();

router.get("/aircraft", async (req, res) => {
  const { lat, lon, dist } = req.query;

  if (!lat || !lon || !dist) {
    res.status(400).json({ error: "lat, lon, and dist are required" });
    return;
  }

  const latNum = parseFloat(lat as string);
  const lonNum = parseFloat(lon as string);
  const distNum = parseInt(dist as string, 10);

  if (isNaN(latNum) || isNaN(lonNum) || isNaN(distNum)) {
    res.status(400).json({ error: "lat, lon, and dist must be numbers" });
    return;
  }

  const key = `${latNum.toFixed(4)}/${lonNum.toFixed(4)}/${distNum}`;
  const now = Date.now();
  const cached = cache.get(key);

  // Serve fresh cache immediately without touching upstream
  if (cached && now - cached.fetchedAt < CACHE_FRESH_MS) {
    res.json(cached.data);
    return;
  }

  const upstreamUrl = `https://api.adsb.lol/v2/lat/${latNum.toFixed(4)}/lon/${lonNum.toFixed(4)}/dist/${distNum}`;

  try {
    const data = await fetchUpstream(key, upstreamUrl);
    res.json(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    req.log.error({ err, key }, "upstream fetch failed");

    // Serve stale cache rather than a hard 502
    if (cached && now - cached.fetchedAt < CACHE_STALE_MS) {
      req.log.warn(
        { key, ageMs: now - cached.fetchedAt },
        "serving stale cache after upstream error",
      );
      res.json(cached.data);
      return;
    }

    res.status(502).json({
      error: "upstream unreachable",
      detail,
      ac: [],
    });
  }
});

export default router;

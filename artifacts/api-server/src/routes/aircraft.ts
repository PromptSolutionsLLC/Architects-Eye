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

async function fetchOne(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "architects-eye/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  console.log("[AIRCRAFT UPSTREAM]", url, "status:", res.status);
  if (!res.ok) {
    throw new Error(`upstream HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchUpstream(
  key: string,
  primaryUrl: string,
  fallbackUrl: string,
): Promise<unknown> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const data = await fetchOne(primaryUrl);
      cache.set(key, { data, fetchedAt: Date.now() });
      return data;
    } catch (primaryErr) {
      console.log(
        "[AIRCRAFT FALLBACK]",
        "attempting adsb.fi",
        "(primary err:",
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        ")",
      );
      const data = await fetchOne(fallbackUrl);
      cache.set(key, { data, fetchedAt: Date.now() });
      return data;
    }
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

  const adsbLolUrl = `https://api.adsb.lol/v2/lat/${latNum.toFixed(4)}/lon/${lonNum.toFixed(4)}/dist/${distNum}`;
  // adsb.fi v2 uses the same path schema and returns the same { ac: [...] } shape.
  const adsbFiUrl = `https://api.adsb.fi/v2/lat/${latNum.toFixed(4)}/lon/${lonNum.toFixed(4)}/dist/${distNum}`;

  try {
    const data = await fetchUpstream(key, adsbLolUrl, adsbFiUrl);
    res.json(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    req.log.error({ err, key }, "all aircraft upstreams failed");

    // Serve stale cache rather than a hard 502 — even if older than
    // CACHE_STALE_MS, since both upstreams are down anything is better
    // than empty.
    if (cached) {
      const staleAge = now - cached.fetchedAt;
      console.log("[AIRCRAFT STALE]", "returning stale cache, age_ms:", staleAge);
      res.json(cached.data);
      return;
    }

    console.log(
      "[AIRCRAFT UPSTREAM TOTAL FAILURE]",
      "key:",
      key,
      "detail:",
      detail,
    );
    // 200 with empty list + source marker so client doesn't crash and
    // the layer just shows zero aircraft until upstreams recover.
    res.status(200).json({
      ac: [],
      source: "upstream-down",
    });
  }
});

export default router;

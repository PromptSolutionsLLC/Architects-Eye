import { Router, type IRouter } from "express";

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
}

const CACHE_FRESH_MS = 8_000;
const CACHE_STALE_MS = 60_000;

// adsb.fi caps the dist param at 250 nm (verified empirically:
// dist=250 → 200, dist=300 → 400). Clamp the fallback URL.
const ADSB_FI_MAX_DIST_NM = 250;

// Fresh/stale response cache. Stored after upstream-shape normalization
// so all consumers (and stale serves) see the same `{ac: [...]}` shape.
const cache = new Map<string, CacheEntry>();
// In-flight deduplication: concurrent requests for the same key share one fetch
const inFlight = new Map<string, Promise<unknown>>();

interface NormalizedAircraftResponse {
  ac: unknown[];
  source: "adsb.lol" | "adsb.fi" | "stale-cache" | "upstream-down";
}

/**
 * Normalize the two upstream response shapes to a single
 * `{ac: [...]}` envelope so the client never has to branch.
 *  - adsb.lol returns `{ac: [...], now, ...}`
 *  - adsb.fi  returns `{aircraft: [...], now, ...}`
 */
function normalizeUpstream(
  raw: unknown,
  source: "adsb.lol" | "adsb.fi",
): NormalizedAircraftResponse {
  const obj = (raw ?? {}) as { ac?: unknown[]; aircraft?: unknown[] };
  const list = Array.isArray(obj.ac)
    ? obj.ac
    : Array.isArray(obj.aircraft)
      ? obj.aircraft
      : [];
  return { ac: list, source };
}

async function fetchOne(url: string, attempt: number): Promise<unknown> {
  console.log("[AIRCRAFT UPSTREAM]", url, "attempt:", attempt);
  const res = await fetch(url, {
    headers: { "User-Agent": "architects-eye/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  console.log("[AIRCRAFT UPSTREAM RESP]", url, res.status);
  if (!res.ok) {
    throw new Error(`upstream HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchUpstream(
  key: string,
  primaryUrl: string,
  fallbackUrl: string,
): Promise<NormalizedAircraftResponse> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<NormalizedAircraftResponse>;

  const promise = (async (): Promise<NormalizedAircraftResponse> => {
    try {
      const raw = await fetchOne(primaryUrl, 1);
      const normalized = normalizeUpstream(raw, "adsb.lol");
      cache.set(key, { data: normalized, fetchedAt: Date.now() });
      return normalized;
    } catch (primaryErr) {
      console.log(
        "[AIRCRAFT FALLBACK adsb.fi]",
        "primary err:",
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      );
      try {
        const raw = await fetchOne(fallbackUrl, 2);
        const normalized = normalizeUpstream(raw, "adsb.fi");
        cache.set(key, { data: normalized, fetchedAt: Date.now() });
        return normalized;
      } catch (fallbackErr) {
        console.log(
          "[AIRCRAFT BOTH UPSTREAMS DOWN]",
          "key:",
          key,
          "primary:",
          primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
          "fallback:",
          fallbackErr instanceof Error
            ? fallbackErr.message
            : String(fallbackErr),
        );
        throw fallbackErr;
      }
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
  // adsb.fi opendata host (verified working: returns {aircraft: [...]}).
  // The dist param is clamped to ADSB_FI_MAX_DIST_NM since adsb.fi
  // returns 400 for larger radii. The reduced coverage is acceptable
  // for a fallback path; clients still get partial data instead of zero.
  const adsbFiDist = Math.min(distNum, ADSB_FI_MAX_DIST_NM);
  const adsbFiUrl = `https://opendata.adsb.fi/api/v2/lat/${latNum.toFixed(4)}/lon/${lonNum.toFixed(4)}/dist/${adsbFiDist}`;

  try {
    const data = await fetchUpstream(key, adsbLolUrl, adsbFiUrl);
    res.json(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    req.log.error({ err, key }, "all aircraft upstreams failed");

    // Serve stale cache if anything exists, regardless of CACHE_STALE_MS,
    // since both upstreams are down. Keep the original source label so
    // the client can distinguish "live data shown previously" from
    // "never had data".
    if (cached) {
      const staleAge = now - cached.fetchedAt;
      console.log("[AIRCRAFT STALE]", "returning stale cache, age_ms:", staleAge);
      const stale = cached.data as NormalizedAircraftResponse;
      res.json({ ac: stale.ac, source: "stale-cache" });
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

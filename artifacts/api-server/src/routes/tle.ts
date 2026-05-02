import { Router, type IRouter } from "express";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
const CELESTRAK_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";

interface CacheEntry {
  body: string;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<string> | null = null;

async function fetchUpstream(): Promise<string> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch(CELESTRAK_URL, {
      headers: { "User-Agent": "architects-eye/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`celestrak returned HTTP ${res.status}`);
    }
    const text = await res.text();
    cache = { body: text, fetchedAt: Date.now() };
    return text;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

const router: IRouter = Router();

router.get("/tle", async (req, res) => {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    res.type("text/plain").send(cache.body);
    return;
  }

  try {
    const body = await fetchUpstream();
    res.type("text/plain").send(body);
  } catch (err) {
    req.log.error({ err }, "celestrak fetch failed");
    if (cache) {
      req.log.warn(
        { ageMs: now - cache.fetchedAt },
        "serving stale TLE cache after upstream error",
      );
      res.type("text/plain").send(cache.body);
      return;
    }
    res.status(502).json({
      error: "Upstream TLE fetch failed and no cache available",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;

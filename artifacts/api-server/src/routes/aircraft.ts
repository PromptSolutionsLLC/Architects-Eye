import { Router, type IRouter } from "express";

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 8_000;

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

  const cacheKey = `${latNum.toFixed(4)}/${lonNum.toFixed(4)}/${distNum}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && now < cached.expiresAt) {
    res.json(cached.data);
    return;
  }

  const upstream = `https://api.adsb.lol/v2/lat/${latNum.toFixed(4)}/lon/${lonNum.toFixed(4)}/dist/${distNum}`;

  try {
    const upstream_res = await fetch(upstream, {
      headers: { "User-Agent": "architects-eye/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream_res.ok) {
      req.log.warn({ status: upstream_res.status }, "adsb.lol error");
      res.status(502).json({ error: "upstream error", ac: [] });
      return;
    }

    const data = await upstream_res.json();
    cache.set(cacheKey, { data, expiresAt: now + CACHE_TTL_MS });

    // Evict old entries to keep memory bounded
    if (cache.size > 500) {
      const cutoff = Date.now();
      for (const [key, entry] of cache) {
        if (entry.expiresAt < cutoff) cache.delete(key);
      }
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch from adsb.lol");
    res.status(502).json({ error: "upstream unreachable", ac: [] });
  }
});

export default router;

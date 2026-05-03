import { Router, type IRouter } from "express";

const USGS_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export interface Quake {
  id: string;
  lat: number;
  lon: number;
  depth_km: number;
  magnitude: number;
  place: string;
  time_ms: number;
  url: string;
}

export interface QuakesResponse {
  quakes: Quake[];
  source: "live" | "stale-cache" | "fallback-empty";
  fetchedAt: number;
}

interface CacheEntry {
  quakes: Quake[];
  fetchedAt: number;
}

interface UsgsFeature {
  id?: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: {
    mag?: number;
    place?: string;
    time?: number;
    url?: string;
  };
}

let cache: CacheEntry | null = null;
let inFlight: Promise<Quake[]> | null = null;

function parseUsgs(json: unknown): Quake[] {
  if (!json || typeof json !== "object") return [];
  const features = (json as { features?: UsgsFeature[] }).features;
  if (!Array.isArray(features)) return [];
  const out: Quake[] = [];
  for (const f of features) {
    const id = f?.id;
    const coords = f?.geometry?.coordinates;
    const props = f?.properties;
    if (!id || !coords || !props) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const depth_km = Number(coords[2]);
    const magnitude = Number(props.mag);
    const time_ms = Number(props.time);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(depth_km) ||
      !Number.isFinite(magnitude) ||
      !Number.isFinite(time_ms)
    ) {
      continue;
    }
    out.push({
      id,
      lat,
      lon,
      depth_km,
      magnitude,
      place: typeof props.place === "string" ? props.place : "",
      time_ms,
      url: typeof props.url === "string" ? props.url : "",
    });
  }
  return out;
}

async function fetchLive(): Promise<Quake[]> {
  const res = await fetch(USGS_URL, {
    headers: { "User-Agent": "architects-eye/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`USGS upstream HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  return parseUsgs(json);
}

const router: IRouter = Router();

// Always returns HTTP 200 with a valid QuakesResponse shape, even when
// the upstream is down. Failure mode: stale cache wins if available,
// otherwise an empty list with source="fallback-empty".
router.get("/quakes", async (req, res) => {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    const body: QuakesResponse = {
      quakes: cache.quakes,
      source: "live",
      fetchedAt: cache.fetchedAt,
    };
    res.json(body);
    return;
  }

  try {
    if (!inFlight) {
      inFlight = fetchLive().finally(() => {
        inFlight = null;
      });
    }
    const quakes = await inFlight;
    cache = { quakes, fetchedAt: now };
    const body: QuakesResponse = { quakes, source: "live", fetchedAt: now };
    res.json(body);
    return;
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "USGS live fetch failed; serving fallback",
    );
  }

  if (cache) {
    const body: QuakesResponse = {
      quakes: cache.quakes,
      source: "stale-cache",
      fetchedAt: cache.fetchedAt,
    };
    res.json(body);
    return;
  }

  const body: QuakesResponse = {
    quakes: [],
    source: "fallback-empty",
    fetchedAt: now,
  };
  res.json(body);
});

export default router;

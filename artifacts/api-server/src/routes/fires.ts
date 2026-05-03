import { Router, type IRouter } from "express";
import modisFallbackCsv from "../data/MODIS_C6_1_Global_24h.csv";

const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

export interface Fire {
  lat: number;
  lon: number;
  confidence: string;
  frp: number;
  brightness: number;
  acq_date: string;
  acq_time: string;
  source: "VIIRS_SNPP_NRT" | "MODIS_C6_1";
}

export interface FiresResponse {
  fires: Fire[];
  source: "live" | "fallback" | "stale-cache";
  fetchedAt: number;
}

interface CacheEntry {
  fires: Fire[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<Fire[]> | null = null;

function parseFiresCsv(
  text: string,
  source: Fire["source"],
): Fire[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iLat = idx("latitude");
  const iLon = idx("longitude");
  const iConf = idx("confidence");
  const iFrp = idx("frp");
  const iBright =
    source === "VIIRS_SNPP_NRT" ? idx("bright_ti4") : idx("brightness");
  const iDate = idx("acq_date");
  const iTime = idx("acq_time");

  if (iLat < 0 || iLon < 0) return [];

  const out: Fire[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const lat = Number.parseFloat(cols[iLat]);
    const lon = Number.parseFloat(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const confRaw = iConf >= 0 ? (cols[iConf] ?? "").trim() : "";
    // VIIRS uses words like "low"/"nominal"/"high" in some feeds — normalise
    // to a single-letter code matching the spec.
    let confidence = confRaw;
    const cl = confRaw.toLowerCase();
    if (cl === "low") confidence = "l";
    else if (cl === "nominal") confidence = "n";
    else if (cl === "high") confidence = "h";

    out.push({
      lat,
      lon,
      confidence,
      frp: iFrp >= 0 ? Number.parseFloat(cols[iFrp]) || 0 : 0,
      brightness: iBright >= 0 ? Number.parseFloat(cols[iBright]) || 0 : 0,
      acq_date: iDate >= 0 ? (cols[iDate] ?? "").trim() : "",
      acq_time: iTime >= 0 ? (cols[iTime] ?? "").trim() : "",
      source,
    });
  }
  return out;
}

async function fetchLive(apiKey: string): Promise<Fire[]> {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/VIIRS_SNPP_NRT/world/1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "architects-eye/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`FIRMS upstream HTTP ${res.status}`);
  }
  const text = await res.text();
  // FIRMS API returns plaintext error bodies (HTTP 200) for invalid keys etc.
  // A real CSV always starts with the latitude header.
  if (!text.startsWith("latitude")) {
    throw new Error(`FIRMS upstream returned non-CSV body: ${text.slice(0, 120)}`);
  }
  return parseFiresCsv(text, "VIIRS_SNPP_NRT");
}

const router: IRouter = Router();

router.get("/fires", async (req, res) => {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    const body: FiresResponse = {
      fires: cache.fires,
      source: "live",
      fetchedAt: cache.fetchedAt,
    };
    res.json(body);
    return;
  }

  const apiKey = process.env["FIRMS_API_KEY"];
  if (apiKey) {
    try {
      if (!inFlight) {
        inFlight = fetchLive(apiKey).finally(() => {
          inFlight = null;
        });
      }
      const fires = await inFlight;
      cache = { fires, fetchedAt: now };
      const body: FiresResponse = { fires, source: "live", fetchedAt: now };
      res.json(body);
      return;
    } catch (err) {
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "FIRMS live fetch failed; serving fallback",
      );
    }
  } else {
    req.log.warn("FIRMS_API_KEY not set; serving bundled fallback");
  }

  // Stale cache wins over bundled fallback if we have one
  if (cache) {
    const body: FiresResponse = {
      fires: cache.fires,
      source: "stale-cache",
      fetchedAt: cache.fetchedAt,
    };
    res.json(body);
    return;
  }

  const fallbackFires = parseFiresCsv(modisFallbackCsv, "MODIS_C6_1");
  const body: FiresResponse = {
    fires: fallbackFires,
    source: "fallback",
    fetchedAt: now,
  };
  res.json(body);
});

export default router;

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

export async function fetchFires(): Promise<FiresResponse> {
  try {
    const res = await fetch("/api/fires");
    if (!res.ok) {
      console.warn(`[Fires] Proxy error ${res.status}`);
      return { fires: [], source: "fallback", fetchedAt: Date.now() };
    }
    return (await res.json()) as FiresResponse;
  } catch (err) {
    console.warn("[Fires] Fetch failed:", err);
    return { fires: [], source: "fallback", fetchedAt: Date.now() };
  }
}

export interface Aircraft {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  t?: string;
  r?: string;
}

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

export async function fetchQuakes(): Promise<QuakesResponse> {
  try {
    const res = await fetch("/api/quakes");
    if (!res.ok) {
      console.warn(`[Quakes] Proxy error ${res.status}`);
      return { quakes: [], source: "fallback-empty", fetchedAt: Date.now() };
    }
    return (await res.json()) as QuakesResponse;
  } catch (err) {
    console.warn("[Quakes] Fetch failed:", err);
    return { quakes: [], source: "fallback-empty", fetchedAt: Date.now() };
  }
}

export async function fetchAircraft(
  lat: number,
  lon: number,
  distNm: number,
): Promise<Aircraft[]> {
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    dist: String(Math.round(distNm)),
  });
  const url = `/api/aircraft?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (res.status === 429) {
      console.warn("[Aircraft] Rate limited (429) — backing off");
      return [];
    }
    if (!res.ok) {
      console.warn(`[Aircraft] Proxy error ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { ac?: Aircraft[] };
    return (data.ac ?? []).filter((a) => a.lat != null && a.lon != null);
  } catch (err) {
    console.warn("[Aircraft] Fetch failed:", err);
    return [];
  }
}

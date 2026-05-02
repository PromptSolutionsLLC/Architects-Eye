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

export async function fetchAircraft(
  lat: number,
  lon: number,
  distNm: number,
): Promise<Aircraft[]> {
  const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(distNm)}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      console.warn("[Aircraft] Rate limited (429) — backing off");
      return [];
    }
    if (!res.ok) {
      console.warn(`[Aircraft] API error ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { ac?: Aircraft[] };
    return (data.ac ?? []).filter((a) => a.lat != null && a.lon != null);
  } catch (err) {
    console.warn("[Aircraft] Fetch failed:", err);
    return [];
  }
}

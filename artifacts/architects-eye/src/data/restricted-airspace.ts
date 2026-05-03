// Approximate, simplified bounding polygons for known restricted /
// closed / advisory airspace zones. Coordinates are [lon, lat] pairs
// stored flat (Cesium.Cartesian3.fromDegreesArray order). They are not
// politically precise — they exist purely for OSINT visual context.

export interface RestrictedAirspaceZone {
  id: string;
  name: string;
  description: string;
  color: string;
  // Flat [lon, lat, lon, lat, …] degrees — closed loop is implicit (the
  // first vertex does NOT need to be repeated; the layer closes it).
  coords: number[];
}

export const RESTRICTED_AIRSPACE: RestrictedAirspaceZone[] = [
  {
    id: "russia-eu-closure",
    name: "Russian Airspace (EU/UK/US closed)",
    description:
      "Closed to EU, UK, US, and Canadian carriers since Feb 2022.",
    color: "#ef4444",
    coords: [
      // Western border — Baltic / Belarus / Ukraine
      28.0, 60.0, 28.5, 56.0, 30.5, 52.0, 33.0, 50.0, 36.5, 50.0, 39.5, 47.5,
      45.0, 44.0, 47.5, 42.0,
      // Caucasus / Caspian
      48.0, 41.0, 50.0, 41.5, 53.0, 42.5,
      // Central Asia southern border
      55.0, 50.5, 60.0, 51.0, 65.0, 50.5, 70.0, 50.0, 75.0, 50.5, 80.0, 50.5,
      85.0, 49.5, 90.0, 50.0,
      // Mongolia / China northern border
      95.0, 50.0, 100.0, 50.0, 110.0, 49.5, 117.0, 49.5, 120.0, 50.0, 127.0,
      50.5, 130.0, 48.5, 134.0, 47.5,
      // Pacific coast
      140.0, 46.0, 142.0, 53.0, 146.0, 59.0, 155.0, 60.0, 162.0, 60.0, 170.0,
      62.0, 178.0, 65.0,
      // Arctic — wrap across north
      180.0, 70.0, 175.0, 75.0, 150.0, 78.0, 110.0, 80.0, 80.0, 80.0, 60.0,
      78.0, 40.0, 76.0, 30.0, 70.0,
    ],
  },
  {
    id: "iran-closure",
    name: "Iranian Airspace (commercial advisory)",
    description:
      "Active GPS jamming, drone activity, periodic advisory closures.",
    color: "#f59e0b",
    coords: [
      44.0, 39.5, 47.0, 39.5, 48.5, 38.5, 50.5, 38.0, 53.5, 37.5, 56.0, 37.5,
      58.5, 37.5, 60.5, 36.5,
      // Eastern border (Afghanistan / Pakistan)
      61.5, 35.0, 61.0, 31.0, 61.5, 28.0, 62.5, 25.5,
      // Southern coast — Gulf of Oman & Persian Gulf
      59.0, 25.0, 56.0, 26.5, 53.5, 26.5, 51.0, 27.5, 49.0, 28.5, 48.0, 30.0,
      // Western border (Iraq / Turkey)
      45.5, 32.0, 45.0, 35.0, 44.0, 37.0,
    ],
  },
  {
    id: "nkorea-adiz",
    name: "North Korean ADIZ",
    description:
      "Air Defense Identification Zone — civilian aviation prohibited.",
    color: "#ef4444",
    coords: [
      124.0, 40.5, 125.0, 41.5, 126.5, 42.5, 128.5, 42.5, 130.5, 42.5,
      // East coast offshore (~50nm buffer)
      131.5, 41.0, 131.5, 39.5, 131.0, 38.5, 130.0, 37.5,
      // Southern boundary (DMZ)
      128.0, 37.8, 126.5, 37.8, 124.5, 37.8,
      // West coast offshore
      123.5, 38.5, 123.5, 39.5,
    ],
  },
  {
    id: "gaza-noflight",
    name: "Gaza No-Fly Zone",
    description: "Active conflict zone, ongoing military operations.",
    color: "#ef4444",
    coords: [
      34.18, 31.6, 34.55, 31.6, 34.6, 31.5, 34.55, 31.35, 34.4, 31.25, 34.25,
      31.22, 34.18, 31.32, 34.15, 31.45,
    ],
  },
  {
    id: "ukraine-east",
    name: "Eastern Ukraine Active Combat",
    description:
      "Active military operations — no civilian aviation since Feb 2022.",
    color: "#ef4444",
    coords: [
      // Northern boundary (Sumy / Kharkiv oblasts)
      33.5, 52.2, 36.0, 52.3, 38.0, 50.5, 40.0, 49.8,
      // Eastern border (Russian frontier)
      40.2, 48.5, 39.8, 47.8, 38.5, 47.0,
      // Southern coast (Sea of Azov / occupied Crimea)
      37.5, 46.5, 36.0, 45.8, 34.5, 45.0, 33.5, 44.5, 32.5, 44.5,
      // Crimea south coast
      33.5, 44.4, 35.5, 44.6, 36.5, 45.0,
      // Back up west into Kherson / Zaporizhzhia / Dnipro
      33.0, 46.8, 34.5, 47.5, 35.0, 48.5, 34.0, 49.5, 33.5, 50.8,
    ],
  },
];

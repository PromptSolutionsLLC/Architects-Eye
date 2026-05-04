import { useState } from "react";

const SOURCES = [
  {
    name: "Google Maps Platform",
    note: "Photorealistic 3D Tiles — Map data ©2024 Google",
    url: "https://developers.google.com/maps/documentation/tile/3d-tiles",
  },
  {
    name: "Cesium ion / CesiumJS",
    note: "Globe renderer, World Imagery basemap",
    url: "https://cesium.com",
  },
  {
    name: "adsb.lol",
    note: "Primary ADS-B aircraft feed",
    url: "https://adsb.lol",
  },
  {
    name: "adsb.fi (OpenData)",
    note: "Fallback ADS-B aircraft feed",
    url: "https://opendata.adsb.fi",
  },
  {
    name: "AISStream.io",
    note: "Real-time AIS vessel positions",
    url: "https://aisstream.io",
  },
  {
    name: "Celestrak / ivanstanojevic.me",
    note: "TLE satellite catalog (15,304+ objects)",
    url: "https://tle.ivanstanojevic.me",
  },
  {
    name: "GPSJam.org",
    note: "GPS interference H3 hex grid — John Wiseman",
    url: "https://gpsjam.org",
  },
  {
    name: "NASA FIRMS",
    note: "VIIRS SNPP NRT + MODIS wildfire hotspots",
    url: "https://firms.modaps.eosdis.nasa.gov",
  },
  {
    name: "USGS Earthquake Hazards",
    note: "GeoJSON seismic feed — earthquake.usgs.gov",
    url: "https://earthquake.usgs.gov",
  },
  {
    name: "TeleGeography",
    note: "Submarine Cable Map topology",
    url: "https://www.submarinecablemap.com",
  },
];

export function AttributionPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 1200,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      {open && (
        <div
          className="rounded-sm border border-cyan-500/20 bg-slate-900/97 backdrop-blur-md"
          style={{
            width: 280,
            padding: "10px 12px",
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        >
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-cyan-400">
              Data Sources
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-0">
            {SOURCES.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="group block border-b border-slate-800/60 py-[7px] last:border-0"
              >
                <div className="font-mono text-[10px] font-medium tracking-wide text-cyan-300/80 group-hover:text-cyan-200 transition-colors">
                  {s.name}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-500 group-hover:text-slate-400 transition-colors">
                  {s.note}
                </div>
              </a>
            ))}
          </div>
          <div className="mt-2.5 border-t border-slate-800/60 pt-2">
            <p className="text-[9px] leading-snug text-slate-600">
              All data sources are public and/or free-tier. This terminal
              displays real-time OSINT data for situational awareness only.
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Data sources & attribution"
        className={[
          "flex h-7 w-7 items-center justify-center rounded-sm border font-mono text-[12px] transition-colors",
          open
            ? "border-cyan-400/60 bg-slate-800/90 text-cyan-300"
            : "border-slate-700/60 bg-slate-900/80 text-slate-500 hover:border-cyan-500/40 hover:text-slate-300",
        ].join(" ")}
      >
        ⓘ
      </button>
    </div>
  );
}

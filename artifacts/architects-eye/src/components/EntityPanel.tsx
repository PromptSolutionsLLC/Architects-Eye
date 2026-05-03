import type { SelectedEntity } from "../store";
import type { Aircraft, Fire, Quake } from "../utils/api";
import type { SatelliteMeta } from "../utils/tle";
import type { VesselSelectionData } from "../layers/VesselLayer";
import type { RestrictedAirspaceZone } from "../data/restricted-airspace";
import type { CableMeta } from "../layers/SubmarineCablesLayer";
import { decodeShipType } from "../ws/aisstream-client";

// Per-type body renderers used inside the floating EntityCard. The
// outer card supplies its own header (label + pin/collapse/dismiss
// controls); these renderers contribute only the hero title and the
// detail rows.

function formatAlt(alt: Aircraft["alt_baro"]): string {
  if (alt === "ground" || alt == null) return "GND";
  const ft = Number(alt);
  if (isNaN(ft)) return "N/A";
  if (ft >= 18000)
    return `FL${Math.floor(ft / 100).toString().padStart(3, "0")}`;
  return `${Math.round(ft).toLocaleString()} ft`;
}

function formatSpeed(gs: number | undefined): string {
  if (gs == null) return "—";
  return `${Math.round(gs)} kts`;
}

function formatHeading(track: number | undefined): string {
  if (track == null) return "—";
  return `${Math.round(track).toString().padStart(3, "0")}°`;
}

function formatKm(km: number): string {
  if (!isFinite(km) || km <= 0) return "—";
  return `${km.toFixed(1).toLocaleString()} km`;
}

function formatPeriod(min: number): string {
  if (!isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${min.toFixed(1)} min`;
  const h = Math.floor(min / 60);
  const m = (min % 60).toFixed(1);
  return `${h}h ${m}m`;
}

interface RowProps {
  label: string;
  value: string;
  accent?: boolean;
}

function Row({ label, value, accent }: RowProps) {
  return (
    <div className="border-b border-slate-800/80 pb-3">
      <div className="text-slate-500 text-xs tracking-widest uppercase mb-1">
        {label}
      </div>
      <div
        className={`font-mono text-sm tracking-wide ${accent ? "text-cyan-300" : "text-slate-200"}`}
      >
        {value}
      </div>
    </div>
  );
}

function HeroTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div
        style={{
          color: "#fff",
          fontSize: "1.5rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          lineHeight: 1.1,
          wordBreak: "break-word",
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: "#475569",
          fontSize: "0.6rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          marginTop: "0.25rem",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

function AircraftDetails({ ac }: { ac: Aircraft }) {
  return (
    <>
      <HeroTitle title={ac.flight?.trim() || "UNKNOWN"} subtitle="Callsign" />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Row label="ICAO24" value={ac.hex.toUpperCase()} />
        <Row label="Registration" value={ac.r ?? "—"} />
        <Row label="Aircraft type" value={ac.t ?? "—"} />
        <Row label="Altitude" value={formatAlt(ac.alt_baro)} accent />
        <Row label="Groundspeed" value={formatSpeed(ac.gs)} />
        <Row label="Heading" value={formatHeading(ac.track)} />
      </div>
    </>
  );
}

function SatelliteDetails({ sat }: { sat: SatelliteMeta }) {
  return (
    <>
      <HeroTitle title={sat.name || "UNKNOWN"} subtitle="Object name" />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Row label="NORAD ID" value={sat.noradId || "—"} />
        <Row label="Category" value={sat.category} />
        <Row label="Altitude" value={formatKm(sat.altitudeKm)} accent />
        <Row label="Orbital period" value={formatPeriod(sat.periodMin)} />
      </div>
    </>
  );
}

function VesselDetails({ v }: { v: VesselSelectionData }) {
  const heroName = v.name && v.name.trim() ? v.name : `MMSI ${v.mmsi}`;
  return (
    <>
      <HeroTitle title={heroName} subtitle="Vessel name" />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Row label="MMSI" value={String(v.mmsi)} />
        <Row label="Type" value={decodeShipType(v.type)} />
        <Row label="Flag" value={v.flag || "—"} />
        <Row label="Callsign" value={v.callsign || "—"} />
        <Row
          label="Speed over ground"
          value={v.sog > 0 ? `${v.sog.toFixed(1)} kts` : "—"}
          accent
        />
        <Row
          label="Course over ground"
          value={
            v.cog >= 0 && v.cog <= 360
              ? `${Math.round(v.cog).toString().padStart(3, "0")}°`
              : "—"
          }
        />
        <Row label="Destination" value={v.destination || "—"} />
      </div>
    </>
  );
}

function AirspaceDetails({ zone }: { zone: RestrictedAirspaceZone }) {
  return (
    <>
      <HeroTitle title={zone.name} subtitle="Advisory" />
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "flex-start",
          padding: "0.875rem 1rem",
          background: "rgba(239, 68, 68, 0.08)",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          borderRadius: 2,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "rgba(239, 68, 68, 0.2)",
            color: "#fca5a5",
            fontSize: "0.7rem",
            fontStyle: "italic",
            fontFamily: "serif",
            fontWeight: 700,
          }}
        >
          i
        </span>
        <div
          style={{
            color: "#e2e8f0",
            fontSize: "0.78rem",
            lineHeight: 1.5,
          }}
        >
          {zone.description}
        </div>
      </div>
    </>
  );
}

function decodeFireConfidence(c: string, source: Fire["source"]): string {
  if (source === "VIIRS_SNPP_NRT") {
    const cl = c.toLowerCase();
    if (cl === "h") return "High";
    if (cl === "n") return "Nominal";
    if (cl === "l") return "Low";
    return c || "—";
  }
  const n = Number.parseFloat(c);
  if (!Number.isFinite(n)) return c || "—";
  if (n >= 70) return `High (${Math.round(n)}%)`;
  if (n >= 30) return `Nominal (${Math.round(n)}%)`;
  return `Low (${Math.round(n)}%)`;
}

function formatAcqTime(t: string): string {
  const padded = t.padStart(4, "0");
  if (padded.length !== 4) return t;
  return `${padded.slice(0, 2)}:${padded.slice(2)} UTC`;
}

function FireDetails({ fire }: { fire: Fire }) {
  const lat = fire.lat.toFixed(4);
  const lon = fire.lon.toFixed(4);
  const sensor =
    fire.source === "VIIRS_SNPP_NRT" ? "VIIRS Suomi-NPP" : "MODIS C6.1";
  return (
    <>
      <HeroTitle title="Active Fire Pixel" subtitle={sensor} />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Row label="Coordinates" value={`${lat}, ${lon}`} />
        <Row
          label="Fire radiative power"
          value={`${fire.frp.toFixed(1)} MW`}
          accent
        />
        <Row
          label="Confidence"
          value={decodeFireConfidence(fire.confidence, fire.source)}
        />
        <Row
          label="Brightness"
          value={fire.brightness > 0 ? `${fire.brightness.toFixed(1)} K` : "—"}
        />
        <Row label="Acquired" value={fire.acq_date || "—"} />
        <Row label="Acq. time" value={fire.acq_time ? formatAcqTime(fire.acq_time) : "—"} />
      </div>
    </>
  );
}

function formatUtc(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function QuakeDetails({ quake }: { quake: Quake }) {
  return (
    <>
      <HeroTitle title={`M${quake.magnitude.toFixed(1)}`} subtitle="Magnitude" />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Row label="Location" value={quake.place || "—"} />
        <Row label="Depth" value={`${quake.depth_km.toFixed(1)} km`} accent />
        <Row label="Time" value={formatUtc(quake.time_ms)} />
        <div className="border-b border-slate-800/80 pb-3">
          <div className="text-slate-500 text-xs tracking-widest uppercase mb-1">
            USGS Link
          </div>
          {quake.url ? (
            <a
              href={quake.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm tracking-wide text-cyan-300 underline decoration-cyan-300/40 hover:decoration-cyan-300"
            >
              View on USGS
            </a>
          ) : (
            <div className="font-mono text-sm tracking-wide text-slate-200">
              —
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CableDetails({ cable }: { cable: CableMeta }) {
  const hex = cable.color.toUpperCase();
  return (
    <>
      <HeroTitle title={cable.name} subtitle="Submarine fiber-optic cable" />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Row label="Name" value={cable.name} />
        <Row label="Slug" value={cable.id || "—"} />
        <div className="border-b border-slate-800/80 pb-3">
          <div className="text-slate-500 text-xs tracking-widest uppercase mb-1">
            Color
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                borderRadius: 2,
                background: cable.color,
                boxShadow: `0 0 6px ${cable.color}`,
                border: "1px solid rgba(148, 163, 184, 0.35)",
                flexShrink: 0,
              }}
            />
            <span className="font-mono text-sm tracking-wide text-slate-200">
              {hex}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export function EntityBody({ entity }: { entity: SelectedEntity }) {
  if (entity.type === "aircraft") return <AircraftDetails ac={entity.data} />;
  if (entity.type === "satellite") return <SatelliteDetails sat={entity.data} />;
  if (entity.type === "vessel") return <VesselDetails v={entity.data} />;
  if (entity.type === "airspace") return <AirspaceDetails zone={entity.data} />;
  if (entity.type === "fire") return <FireDetails fire={entity.data} />;
  if (entity.type === "cable") return <CableDetails cable={entity.data} />;
  return <QuakeDetails quake={entity.data} />;
}

export function entityHeaderLabel(entity: SelectedEntity): string {
  switch (entity.type) {
    case "aircraft":
      return "AIRCRAFT";
    case "satellite":
      return "SATELLITE";
    case "vessel":
      return "VESSEL";
    case "airspace":
      return "AIRSPACE";
    case "fire":
      return "FIRE";
    case "quake":
      return "QUAKE";
    case "cable":
      return "SUBMARINE CABLE";
  }
}

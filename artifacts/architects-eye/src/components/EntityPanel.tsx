import { useStore, type SelectedEntity } from "../store";
import type { Aircraft } from "../utils/api";
import type { SatelliteMeta } from "../utils/tle";
import type { VesselSelectionData } from "../layers/VesselLayer";
import { decodeShipType } from "../ws/aisstream-client";

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

function PanelHeader({
  label,
  onClose,
}: {
  label: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "1.5rem",
      }}
    >
      <span
        style={{
          color: "#22d3ee",
          fontSize: "0.65rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}
      >
        ▶ {label}
      </span>
      <button
        onClick={onClose}
        style={{
          background: "transparent",
          border: "none",
          color: "#64748b",
          cursor: "pointer",
          fontSize: "1rem",
          lineHeight: 1,
          padding: "0.25rem 0.5rem",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) =>
          ((e.target as HTMLButtonElement).style.color = "#fff")
        }
        onMouseLeave={(e) =>
          ((e.target as HTMLButtonElement).style.color = "#64748b")
        }
      >
        ✕
      </button>
    </div>
  );
}

function HeroTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div
        style={{
          color: "#fff",
          fontSize: "1.6rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
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

function AircraftDetails({
  ac,
  onClose,
}: {
  ac: Aircraft;
  onClose: () => void;
}) {
  return (
    <>
      <PanelHeader label="Aircraft" onClose={onClose} />
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

function SatelliteDetails({
  sat,
  onClose,
}: {
  sat: SatelliteMeta;
  onClose: () => void;
}) {
  return (
    <>
      <PanelHeader label="Satellite" onClose={onClose} />
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

function VesselDetails({
  v,
  onClose,
}: {
  v: VesselSelectionData;
  onClose: () => void;
}) {
  const heroName = v.name && v.name.trim() ? v.name : `MMSI ${v.mmsi}`;
  return (
    <>
      <PanelHeader label="Vessel" onClose={onClose} />
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

function PanelBody({
  selected,
  onClose,
}: {
  selected: SelectedEntity;
  onClose: () => void;
}) {
  if (selected.type === "aircraft") {
    return <AircraftDetails ac={selected.data} onClose={onClose} />;
  }
  if (selected.type === "satellite") {
    return <SatelliteDetails sat={selected.data} onClose={onClose} />;
  }
  return <VesselDetails v={selected.data} onClose={onClose} />;
}

export function EntityPanel() {
  const selectedEntity = useStore((s) => s.selectedEntity);
  const setSelectedEntity = useStore((s) => s.setSelectedEntity);

  const visible = selectedEntity !== null;

  return (
    <div
      style={{
        position: "fixed",
        top: 40,
        right: 0,
        height: "calc(100% - 40px)",
        width: "320px",
        zIndex: 1050,
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        pointerEvents: visible ? "auto" : "none",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(12px)",
        borderLeft: "1px solid rgba(34, 211, 238, 0.2)",
        fontFamily: "monospace",
      }}
    >
      {selectedEntity && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "1.25rem",
            overflowY: "auto",
          }}
        >
          <PanelBody
            selected={selectedEntity}
            onClose={() => setSelectedEntity(null)}
          />
        </div>
      )}
    </div>
  );
}

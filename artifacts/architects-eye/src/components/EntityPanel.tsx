import { useStore } from "../store";
import type { Aircraft } from "../utils/api";

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

export function EntityPanel() {
  const selectedEntity = useStore((s) => s.selectedEntity);
  const setSelectedEntity = useStore((s) => s.setSelectedEntity);

  const visible = selectedEntity !== null;
  const ac = selectedEntity?.data;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        height: "100%",
        width: "300px",
        zIndex: 1000,
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        pointerEvents: visible ? "auto" : "none",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(12px)",
        borderLeft: "1px solid rgba(34, 211, 238, 0.2)",
        fontFamily: "monospace",
      }}
    >
      {ac && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "1.25rem",
          }}
        >
          {/* Header bar */}
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
              ▶ Aircraft
            </span>
            <button
              onClick={() => setSelectedEntity(null)}
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

          {/* Callsign */}
          <div style={{ marginBottom: "1.75rem" }}>
            <div
              style={{
                color: "#fff",
                fontSize: "1.6rem",
                fontWeight: 700,
                letterSpacing: "0.1em",
                lineHeight: 1.1,
              }}
            >
              {ac.flight?.trim() || "UNKNOWN"}
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
              Callsign
            </div>
          </div>

          {/* Data grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <Row label="ICAO24" value={ac.hex.toUpperCase()} />
            <Row label="Registration" value={ac.r ?? "—"} />
            <Row label="Aircraft type" value={ac.t ?? "—"} />
            <Row label="Altitude" value={formatAlt(ac.alt_baro)} accent />
            <Row label="Groundspeed" value={formatSpeed(ac.gs)} />
            <Row label="Heading" value={formatHeading(ac.track)} />
          </div>
        </div>
      )}
    </div>
  );
}

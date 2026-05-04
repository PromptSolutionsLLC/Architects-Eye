import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/**
 * Boot overlay.
 *
 * Visual:
 *  - Black full-screen
 *  - Center: ARCHITECT'S EYE wordmark + single status line that cycles
 *    through four messages, each cross-fading in via ae-status-in
 *  - Bottom: powered-by logos (Cesium + Google Maps Platform)
 *
 * Dismiss gates:
 *  - tilesetReady  (Google PR3DT tileset added to scene)
 *  - firstAircraftBatch (first ADS-B poll returned > 0 aircraft)
 *  - Both must be true, AND the "READY" line must have been shown
 *
 * Skip: click anywhere or press ESC — immediately jumps to "READY"
 *  then fades once gates are met (or after 2 s grace, whichever comes first).
 */

const STATUS_LINES = [
  "BOOTING TILESET...",
  "AUTHENTICATING...",
  "SYNCING TLE CATALOG...",
  "READY",
] as const;

const LINE_HOLD_MS = 1_400;
const FADE_MS = 700;
const AMBER = "#fbbf24";
const CYAN = "#22d3ee";

let bootHasRun = false;

function CesiumLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" stroke="#6CADDF" strokeWidth="2" fill="none" />
      <path d="M8 20 Q16 6 24 20" stroke="#6CADDF" strokeWidth="2" fill="none" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function BootScreen() {
  const [skipMount, setSkipMount] = useState(bootHasRun);
  const [lineIdx, setLineIdx] = useState(0);
  const [statusKey, setStatusKey] = useState(0);
  const [phase, setPhase] = useState<"cycling" | "waiting" | "fading" | "done">(
    bootHasRun ? "done" : "cycling",
  );
  const skipped = useRef(false);
  const readyShown = useRef(false);

  const tilesetReady = useStore((s) => s.tilesetReady);
  const firstAircraftBatch = useStore((s) => s.firstAircraftBatch);
  const dataReady = tilesetReady && firstAircraftBatch;

  // Mount-once guard (suppress HMR replays)
  useEffect(() => {
    if (bootHasRun) {
      setSkipMount(true);
      return;
    }
    bootHasRun = true;
  }, []);

  // Advance through status lines
  useEffect(() => {
    if (skipMount || phase !== "cycling") return;

    if (skipped.current) {
      // Jump straight to READY line
      const readyIdx = STATUS_LINES.length - 1;
      setLineIdx(readyIdx);
      setStatusKey((k) => k + 1);
      readyShown.current = true;
      setPhase("waiting");
      return;
    }

    const t = setTimeout(() => {
      const next = lineIdx + 1;
      if (next >= STATUS_LINES.length) {
        readyShown.current = true;
        setPhase("waiting");
        return;
      }
      setLineIdx(next);
      setStatusKey((k) => k + 1);
    }, LINE_HOLD_MS);

    return () => clearTimeout(t);
  }, [skipMount, phase, lineIdx]);

  // "waiting" phase — watch for data gates (or 2 s grace after skip)
  useEffect(() => {
    if (skipMount || phase !== "waiting") return;

    if (dataReady) {
      const t = setTimeout(() => setPhase("fading"), 300);
      return () => clearTimeout(t);
    }

    if (skipped.current) {
      // Give data 2 s grace period, then fade anyway
      const t = setTimeout(() => setPhase("fading"), 2_000);
      return () => clearTimeout(t);
    }
  }, [skipMount, phase, dataReady]);

  // Fade → done
  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("done"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // ESC key skip
  useEffect(() => {
    if (skipMount || phase === "done") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skipped.current = true;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skipMount, phase]);

  if (skipMount || phase === "done") return null;

  const currentLine = STATUS_LINES[lineIdx];

  return (
    <div
      onClick={() => { skipped.current = true; }}
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: phase === "fading" ? "default" : "pointer",
        pointerEvents: phase === "fading" ? "none" : "auto",
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-in-out`,
        userSelect: "none",
      }}
    >
      {/* Center block */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        {/* Crosshair mark */}
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <circle cx="20" cy="20" r="16" stroke={CYAN} strokeWidth="1" opacity="0.4" />
          <circle cx="20" cy="20" r="6"  stroke={CYAN} strokeWidth="1" opacity="0.7" />
          <line x1="20" y1="2"  x2="20" y2="12" stroke={CYAN} strokeWidth="1" />
          <line x1="20" y1="28" x2="20" y2="38" stroke={CYAN} strokeWidth="1" />
          <line x1="2"  y1="20" x2="12" y2="20" stroke={CYAN} strokeWidth="1" />
          <line x1="28" y1="20" x2="38" y2="20" stroke={CYAN} strokeWidth="1" />
        </svg>

        {/* Wordmark */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
              fontSize: 13,
              letterSpacing: "0.38em",
              color: "#94a3b8",
              marginBottom: 4,
              textTransform: "uppercase",
            }}
          >
            ARCHITECT'S EYE
          </div>
          <div
            style={{
              fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
              fontSize: 9,
              letterSpacing: "0.28em",
              color: "#475569",
              textTransform: "uppercase",
            }}
          >
            GLOBAL OSINT TERMINAL
          </div>
        </div>

        {/* Animated status line */}
        <div
          style={{
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            key={statusKey}
            className="ae-status-in"
            style={{
              fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
              fontSize: 11,
              letterSpacing: "0.22em",
              color: currentLine === "READY" ? CYAN : AMBER,
              textTransform: "uppercase",
            }}
          >
            {currentLine}
            {currentLine !== "READY" && (
              <span className="ae-boot-cursor" style={{ marginLeft: 2 }}>_</span>
            )}
          </span>
        </div>
      </div>

      {/* Bottom logos */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: 0.45 }}>
          <CesiumLogo />
          <span
            style={{
              fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
              fontSize: 9,
              letterSpacing: "0.18em",
              color: "#6CADDF",
              textTransform: "uppercase",
            }}
          >
            Cesium
          </span>
        </div>
        <div style={{ width: 1, height: 12, background: "#1e293b" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: 0.45 }}>
          <GoogleGlyph />
          <span
            style={{
              fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
              fontSize: 9,
              letterSpacing: "0.18em",
              color: "#9ca3af",
              textTransform: "uppercase",
            }}
          >
            Google Maps
          </span>
        </div>
      </div>
    </div>
  );
}

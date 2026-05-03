import { useEffect, useState } from "react";

/**
 * P16 — Mobile gate.
 *
 * Architect's Eye is a desktop-first WebGL experience: Cesium +
 * 15,304 satellites + Google Photoreal 3D Tiles will tank a phone.
 * Show a friendly "desktop only" message on narrow viewports and
 * touch devices instead of letting Cesium crash the device.
 *
 * Hard gate — no "continue anyway" button. Re-evaluates on resize
 * so a desktop user dragging their window narrower (or back wider)
 * sees the gate appear/disappear automatically.
 */

const MIN_WIDTH = 1024;
const AMBER = "#fbbf24";

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  const narrow = window.innerWidth < MIN_WIDTH;
  const touch =
    typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
  return narrow || touch;
}

export function MobileGate() {
  const [gated, setGated] = useState<boolean>(() => isMobile());

  useEffect(() => {
    const onResize = () => setGated(isMobile());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!gated) return null;

  const href =
    typeof window !== "undefined" ? window.location.href : "this URL";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: AMBER,
        fontFamily:
          '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.7,
        padding: 24,
        textAlign: "left",
        userSelect: "text",
      }}
    >
      <div style={{ maxWidth: 540 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
          ARCHITECT'S EYE
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 16,
            opacity: 0.9,
          }}
        >
          DESKTOP TERMINAL REQUIRED
        </div>
        <div style={{ color: "#e5e7eb", opacity: 0.85 }}>
          This OSINT terminal renders 15,304 satellites,
          <br />
          21,000+ vessels, and Google Photoreal 3D Tiles
          <br />
          in real time. Mobile devices are not supported.
        </div>
        <div style={{ marginTop: 16, color: "#e5e7eb", opacity: 0.85 }}>
          Open this URL on a desktop or laptop:
        </div>
        <div
          style={{
            marginTop: 4,
            color: "#fff",
            wordBreak: "break-all",
            fontSize: 12,
            userSelect: "all",
          }}
        >
          {href}
        </div>
        <div
          style={{
            marginTop: 16,
            opacity: 0.7,
            fontSize: 12,
          }}
        >
          [ MIN VIEWPORT: {MIN_WIDTH}px ]
        </div>
      </div>
    </div>
  );
}

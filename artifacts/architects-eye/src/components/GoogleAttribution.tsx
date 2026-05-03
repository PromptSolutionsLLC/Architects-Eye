/**
 * P16 — Google Photoreal 3D Tiles requires visible attribution.
 * Bottom-left, monospace, 60% white, above globe but below all
 * UI panels. pointer-events:none so it never intercepts clicks.
 */
export function GoogleAttribution() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 8,
        bottom: 6,
        zIndex: 60,
        color: "rgba(255,255,255,0.6)",
        fontFamily:
          '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
        fontSize: 11,
        letterSpacing: 0.3,
        pointerEvents: "none",
        userSelect: "none",
        textShadow: "0 1px 2px rgba(0,0,0,0.85)",
      }}
    >
      Imagery © Google
    </div>
  );
}

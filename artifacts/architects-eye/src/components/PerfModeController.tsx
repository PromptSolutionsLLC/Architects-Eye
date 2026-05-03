import { useEffect, useRef } from "react";
import { useStore, type LayerKey } from "../store";

/**
 * P15 — Perf kill-switch.
 *
 * 'P' toggles perf mode; ESC also exits. When ON, the heavy
 * decorative layers (jamming hex grid + submarine cable polylines)
 * are forced hidden. Their previous visibility is captured on
 * activation and restored on deactivation, so toggling perf doesn't
 * stomp the user's manual layer choices.
 *
 * Note: "satellite trails" are part of SatelliteLayer's render path
 * and have no separate toggle — touching that would require modifying
 * layer rendering math, which P15 explicitly forbids. Jamming +
 * cables alone account for the bulk of the primitive count
 * (~1900 of ~2000), so this captures the perf win.
 *
 * A bottom-right amber pill indicates active state.
 */

const PERF_HIDDEN_LAYERS: LayerKey[] = ["jamming", "submarineCables"];

export function PerfModeController() {
  const perfMode = useStore((s) => s.perfMode);
  const setPerfMode = useStore((s) => s.setPerfMode);
  const setLayerVisible = useStore((s) => s.setLayerVisible);

  // Snapshot of pre-perf-mode visibility, restored on deactivation.
  const savedVisibilityRef = useRef<Partial<Record<LayerKey, boolean>>>({});

  // Apply / restore layer visibility on perfMode transitions.
  useEffect(() => {
    const state = useStore.getState();
    if (perfMode) {
      const snap: Partial<Record<LayerKey, boolean>> = {};
      for (const key of PERF_HIDDEN_LAYERS) {
        snap[key] = state.layerVisibility[key];
        if (state.layerVisibility[key]) setLayerVisible(key, false);
      }
      savedVisibilityRef.current = snap;
    } else {
      const snap = savedVisibilityRef.current;
      for (const key of PERF_HIDDEN_LAYERS) {
        if (snap[key] === true) setLayerVisible(key, true);
      }
      savedVisibilityRef.current = {};
    }
  }, [perfMode, setLayerVisible]);

  // Keyboard: 'P' toggles, ESC exits if active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore typing in inputs / editable surfaces
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "p" || e.key === "P") {
        setPerfMode(!useStore.getState().perfMode);
      } else if (e.key === "Escape" && useStore.getState().perfMode) {
        setPerfMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPerfMode]);

  if (!perfMode) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 1400,
        padding: "6px 12px",
        borderRadius: 999,
        background: "rgba(0, 0, 0, 0.78)",
        border: "1px solid rgba(251, 191, 36, 0.85)",
        color: "#fbbf24",
        fontFamily:
          '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 1.5,
        boxShadow: "0 0 12px rgba(251, 191, 36, 0.25)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      ● PERF MODE
    </div>
  );
}

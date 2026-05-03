import * as Cesium from "cesium";
import { cellToBoundary } from "h3-js";
import { useStore } from "../store";
import {
  registerHoverResolver,
  unregisterHoverResolver,
  type HoverResult,
} from "../utils/pick-resolvers";

interface JammingPickId {
  layer: "jamming";
  hex: string;
  ratio: number;
}

const CSV_URL = "/data/gpsjam-2026-05-01.csv";
// Render only cells with a meaningful bad/total ratio so we keep the
// primitive count manageable and the heatmap visually meaningful.
const MIN_RATIO = 0.05;
const MIN_TOTAL = 2;

interface Cell {
  hex: string;
  good: number;
  bad: number;
  ratio: number;
}

function parseCsv(text: string): Cell[] {
  const out: Cell[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const hex = parts[0].trim();
    const good = Number.parseInt(parts[1], 10) || 0;
    const bad = Number.parseInt(parts[2], 10) || 0;
    const total = good + bad;
    if (total < MIN_TOTAL || bad === 0) continue;
    const ratio = bad / total;
    if (ratio < MIN_RATIO) continue;
    out.push({ hex, good, bad, ratio });
  }
  return out;
}

// Map a 0–1 jamming ratio to a red→orange→yellow gradient with alpha.
function ratioToColor(ratio: number): Cesium.Color {
  const r = 1.0;
  const g = Math.max(0, 0.65 - ratio * 0.65); // 0.65 → 0 as ratio increases
  const b = 0.0;
  const a = 0.35 + Math.min(0.45, ratio * 0.55); // 0.35 → 0.80
  return new Cesium.Color(r, g, b, a);
}

export class JammingLayer {
  private viewer: Cesium.Viewer;
  private primitive: Cesium.Primitive | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private currentVisibility = false;
  private mounted = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  async mount(): Promise<void> {
    this.currentVisibility = useStore.getState().layerVisibility.jamming;
    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.jamming;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        if (this.primitive) this.primitive.show = next;
      }
    });

    let text: string;
    try {
      const res = await fetch(CSV_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      console.error("[JammingLayer] CSV fetch failed:", err);
      useStore.getState().setLayerAvailable("jamming", false);
      this.destroy();
      return;
    }

    if (this.viewer.isDestroyed()) {
      this.destroy();
      return;
    }

    const cells = parseCsv(text);

    if (cells.length === 0) {
      useStore.getState().setLayerAvailable("jamming", false);
      return;
    }

    const instances: Cesium.GeometryInstance[] = [];
    for (const cell of cells) {
      let boundary: number[][];
      try {
        // h3-js v4: cellToBoundary returns [[lat, lng], ...] by default.
        // Pass `true` to get GeoJSON-style [lng, lat] order. We keep [lat,lng]
        // and reorder ourselves so we can normalize antimeridian crossings.
        boundary = cellToBoundary(cell.hex);
      } catch {
        continue;
      }
      if (boundary.length < 3) continue;

      // Detect antimeridian crossings: H3 cells near the dateline can return
      // boundaries spanning -180/+180. Cesium's PolygonGeometry doesn't handle
      // this well, so we skip those few cells rather than render distortions.
      let minLon = Infinity;
      let maxLon = -Infinity;
      for (const [, lng] of boundary) {
        if (lng < minLon) minLon = lng;
        if (lng > maxLon) maxLon = lng;
      }
      if (maxLon - minLon > 180) continue;

      const positions: number[] = [];
      for (const [lat, lng] of boundary) {
        positions.push(lng, lat);
      }

      const polygonHierarchy = new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray(positions),
      );

      const color = ratioToColor(cell.ratio);

      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          },
          id: { layer: "jamming", hex: cell.hex, ratio: cell.ratio },
        }),
      );
    }

    if (this.viewer.isDestroyed() || instances.length === 0) {
      this.destroy();
      return;
    }

    this.primitive = new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: true,
        flat: true,
      }),
      asynchronous: true,
      releaseGeometryInstances: true,
      compressVertices: true,
    });
    this.primitive.show = this.currentVisibility;
    this.viewer.scene.primitives.add(this.primitive);

    // Register hover resolver only AFTER the primitive is live so that
    // any failure path above (fetch error, viewer destroyed, empty CSV,
    // empty instances) leaves no stale resolver in the registry.
    registerHoverResolver("jamming", (picked) => this.resolveHover(picked));

    this.mounted = true;
    useStore.getState().setLayerCount("jamming", instances.length);
    useStore.getState().setLayerAvailable("jamming", true);
  }

  private resolveHover(picked: unknown): HoverResult | null {
    // Tooltip ONLY appears when JammingLayer is toggled visible.
    if (!this.currentVisibility) return null;
    if (!picked || typeof picked !== "object") return null;
    const id = (picked as { id?: unknown }).id as
      | Partial<JammingPickId>
      | undefined;
    if (!id || id.layer !== "jamming" || typeof id.hex !== "string") {
      return null;
    }
    const ratio = typeof id.ratio === "number" ? id.ratio : 0;
    return { hex: id.hex, intensity: ratio };
  }

  destroy(): void {
    unregisterHoverResolver("jamming");
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (!this.viewer.isDestroyed() && this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive);
    }
    this.primitive = null;
    this.mounted = false;
    useStore.getState().setLayerCount("jamming", 0);
  }
}

import * as Cesium from "cesium";
import { useStore } from "../store";
import { fetchQuakes, type Quake } from "../utils/api";
import { flyToInspect } from "../utils/click-to-fly";
import {
  registerClickResolver,
  unregisterClickResolver,
  type ClickResult,
} from "../utils/pick-resolvers";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

interface PickIdPayload {
  layer: "quakes";
  quakeId: string;
}

const COLOR_LOW = Cesium.Color.fromCssColorString("#facc15"); // yellow
const COLOR_MED = Cesium.Color.fromCssColorString("#fb923c"); // orange
const COLOR_HIGH = Cesium.Color.fromCssColorString("#ef4444"); // red
const COLOR_GREAT = Cesium.Color.fromCssColorString("#d946ef"); // magenta

// Range checks are lower-inclusive, upper-exclusive per spec.
function colorForMag(m: number): Cesium.Color {
  if (m >= 7.5) return COLOR_GREAT;
  if (m >= 6.5) return COLOR_HIGH;
  if (m >= 5.5) return COLOR_MED;
  return COLOR_LOW;
}

function pixelSizeForMag(m: number): number {
  if (m >= 7.5) return 14;
  if (m >= 6.5) return 10;
  if (m >= 5.5) return 7;
  return 4;
}

export class QuakesLayer {
  private viewer: Cesium.Viewer;
  private collection: Cesium.PointPrimitiveCollection | null = null;
  private quakes: Quake[] = [];
  private quakesById = new Map<string, Quake>();
  private unsubscribeStore: (() => void) | null = null;
  private currentVisibility = false;
  private refreshTimer: number | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  async mount(): Promise<void> {
    this.currentVisibility = useStore.getState().layerVisibility.quakes;
    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.quakes;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        if (this.collection) this.collection.show = next;
      }
    });

    const collection = new Cesium.PointPrimitiveCollection();
    collection.show = this.currentVisibility;
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.add(collection);
    this.collection = collection;

    registerClickResolver("quake", (picked) => this.resolveClick(picked));

    await this.refresh();

    this.refreshTimer = window.setInterval(() => {
      void this.refresh();
    }, REFRESH_INTERVAL_MS);
  }

  private resolveClick(picked: unknown): ClickResult | null {
    if (!picked || typeof picked !== "object") return null;
    // Gate on PointPrimitive ownership: the picked.primitive must be one
    // of OUR PointPrimitives. PointPrimitive doesn't publicly expose its
    // collection, so we identify ownership via a tagged id payload (same
    // pattern as FiresLayer) — a bare string id from another layer can
    // never satisfy { layer: "quakes", quakeId }.
    const id = (picked as { id?: unknown }).id as
      | Partial<PickIdPayload>
      | undefined;
    if (!id || id.layer !== "quakes" || typeof id.quakeId !== "string") {
      return null;
    }
    const quake = this.quakesById.get(id.quakeId);
    if (!quake) return null;
    return {
      selected: { type: "quake", id: quake.id, data: quake },
      fly: () => {
        const pos = Cesium.Cartesian3.fromDegrees(
          quake.lon,
          quake.lat,
          -quake.depth_km * 1000,
        );
        flyToInspect(this.viewer, pos, "quake");
      },
    };
  }

  private async refresh(): Promise<void> {
    const resp = await fetchQuakes();
    if (this.viewer.isDestroyed() || !this.collection) return;

    if (resp.source !== "live") {
      console.log("[Quakes] source=" + resp.source);
    }

    this.collection.removeAll();
    this.quakes = resp.quakes;
    this.quakesById.clear();

    for (const q of this.quakes) {
      this.quakesById.set(q.id, q);
      const id: PickIdPayload = { layer: "quakes", quakeId: q.id };
      this.collection.add({
        position: Cesium.Cartesian3.fromDegrees(
          q.lon,
          q.lat,
          -q.depth_km * 1000,
        ),
        color: colorForMag(q.magnitude),
        pixelSize: pixelSizeForMag(q.magnitude),
        outlineWidth: 0,
        id,
      });
    }

    useStore.getState().setLayerCount("quakes", this.quakes.length);
    // Only flip availability true on a genuine backend success. A
    // "fallback-empty" comes from either a transport failure in the
    // client or a USGS outage with no cached data on the server — in
    // both cases we want the LayerToggles row to keep showing "---"
    // until we actually have data.
    if (resp.source === "live" || resp.source === "stale-cache") {
      useStore.getState().setLayerAvailable("quakes", true);
    }
  }

  destroy(): void {
    if (this.refreshTimer != null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    unregisterClickResolver("quake");
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.collection && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection);
    }
    this.collection = null;
    this.quakes = [];
    this.quakesById.clear();
    useStore.getState().setLayerCount("quakes", 0);
  }
}

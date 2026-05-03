import * as Cesium from "cesium";
import { useStore } from "../store";
import { fetchQuakes, type Quake } from "../utils/api";
import { flyToInspect } from "../utils/click-to-fly";
import {
  registerClickResolver,
  unregisterClickResolver,
  type ClickResult,
} from "../utils/pick-resolvers";
import {
  registerSearchProvider,
  unregisterSearchProvider,
  scoreMatch,
  type SearchResult,
} from "../utils/search-registry";

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
    registerSearchProvider("quake", {
      search: (q) => this.search(q),
      getClickResultById: (id) => this.buildClickResult(id),
    });

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
    return this.buildClickResult(id.quakeId);
  }

  private buildClickResult(quakeId: string): ClickResult | null {
    const quake = this.quakesById.get(quakeId);
    if (!quake) return null;
    return {
      selected: { type: "quake", id: quake.id, data: quake },
      fly: () => {
        // Render/target at the surface epicenter. Depth is metadata
        // (shown in EntityPanel), not a position offset — placing the
        // point below the surface (especially for >100km deep quakes)
        // pushes it inside the globe where it renders behind the
        // ellipsoid from most camera angles.
        const pos = Cesium.Cartesian3.fromDegrees(quake.lon, quake.lat, 0);
        flyToInspect(this.viewer, pos, "quake");
      },
    };
  }

  private search(q: string): SearchResult[] {
    const out: SearchResult[] = [];
    // Treat "M<n>" / "M<n.n>" as a magnitude-floor filter: typing
    // "M5" should surface every quake with magnitude >= 5.0, not just
    // those whose formatted "M5.x" string happens to contain "M5".
    let magCutoff: number | null = null;
    if (q.length >= 2 && (q[0] === "M" || q[0] === "m")) {
      const n = Number.parseFloat(q.slice(1));
      if (Number.isFinite(n)) magCutoff = n;
    }
    for (const quake of this.quakesById.values()) {
      const magLabel = "M" + quake.magnitude.toFixed(1);
      let score = -1;
      if (magCutoff != null) {
        if (quake.magnitude >= magCutoff) {
          // Closer to the cutoff = stronger match (descending mag is fine).
          score = 1;
        }
      } else {
        const ps = scoreMatch(quake.place, q);
        const ms = scoreMatch(magLabel, q);
        score = ps >= 0 && ms >= 0 ? Math.min(ps, ms) : Math.max(ps, ms);
      }
      if (score < 0) continue;
      out.push({
        type: "quake",
        id: quake.id,
        label: magLabel,
        sublabel: "QUAKE · " + quake.place,
        score,
      });
    }
    return out;
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
        // Surface epicenter — see fly() comment above for rationale.
        position: Cesium.Cartesian3.fromDegrees(q.lon, q.lat, 0),
        color: colorForMag(q.magnitude),
        pixelSize: pixelSizeForMag(q.magnitude),
        outlineWidth: 0,
        // Depth-test against the globe so far-side quakes are
        // occluded by the planet instead of bleeding through.
        disableDepthTestDistance: 0,
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
    unregisterSearchProvider("quake");
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

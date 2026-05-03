import * as Cesium from "cesium";
import { useStore } from "../store";
import { fetchFires, type Fire } from "../utils/api";
import { flyToInspect } from "../utils/click-to-fly";
import {
  registerClickResolver,
  unregisterClickResolver,
  type ClickResult,
} from "../utils/pick-resolvers";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

interface PickIdPayload {
  layer: "fires";
  fireIndex: number;
}

const COLOR_LOW = Cesium.Color.fromCssColorString("#facc15"); // yellow
const COLOR_MED = Cesium.Color.fromCssColorString("#f97316"); // orange
const COLOR_HIGH = Cesium.Color.fromCssColorString("#ef4444"); // red

function colorForFire(f: Fire): Cesium.Color {
  if (f.source === "VIIRS_SNPP_NRT") {
    const c = f.confidence?.toLowerCase();
    if (c === "h") return COLOR_HIGH;
    if (c === "n") return COLOR_MED;
    return COLOR_LOW;
  }
  // MODIS — numeric 0–100
  const n = Number.parseFloat(f.confidence);
  if (Number.isFinite(n)) {
    if (n >= 70) return COLOR_HIGH;
    if (n >= 30) return COLOR_MED;
  }
  return COLOR_LOW;
}

function pixelSizeForFrp(frp: number): number {
  if (frp > 50) return 8;
  if (frp >= 5) return 5;
  return 3;
}

export class FiresLayer {
  private viewer: Cesium.Viewer;
  private collection: Cesium.PointPrimitiveCollection | null = null;
  private fires: Fire[] = [];
  private unsubscribeStore: (() => void) | null = null;
  private currentVisibility = false;
  private refreshTimer: number | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  async mount(): Promise<void> {
    this.currentVisibility = useStore.getState().layerVisibility.fires;
    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.fires;
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

    registerClickResolver("fire", (picked) => this.resolveClick(picked));

    await this.refresh();

    this.refreshTimer = window.setInterval(() => {
      void this.refresh();
    }, REFRESH_INTERVAL_MS);
  }

  private resolveClick(picked: unknown): ClickResult | null {
    if (!picked || typeof picked !== "object") return null;
    const id = (picked as { id?: unknown }).id as
      | Partial<PickIdPayload>
      | undefined;
    if (!id || id.layer !== "fires" || typeof id.fireIndex !== "number") {
      return null;
    }
    const fireIndex = id.fireIndex;
    const fire = this.fires[fireIndex];
    if (!fire) return null;
    return {
      selected: { type: "fire", id: `fire-${fireIndex}`, data: fire },
      fly: () => {
        const pos = Cesium.Cartesian3.fromDegrees(fire.lon, fire.lat);
        flyToInspect(this.viewer, pos, "fire");
      },
    };
  }

  private async refresh(): Promise<void> {
    const resp = await fetchFires();
    if (this.viewer.isDestroyed() || !this.collection) return;

    this.collection.removeAll();
    this.fires = resp.fires;

    for (let i = 0; i < this.fires.length; i++) {
      const f = this.fires[i];
      const id: PickIdPayload = { layer: "fires", fireIndex: i };
      this.collection.add({
        position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat),
        color: colorForFire(f),
        pixelSize: pixelSizeForFrp(f.frp),
        // Depth-test against the globe so far-side fires are
        // occluded by the planet instead of bleeding through.
        disableDepthTestDistance: 0,
        id,
      });
    }

    useStore.getState().setLayerCount("fires", this.fires.length);
    useStore.getState().setLayerAvailable("fires", true);
  }

  destroy(): void {
    if (this.refreshTimer != null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    unregisterClickResolver("fire");
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.collection && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection);
    }
    this.collection = null;
    this.fires = [];
    useStore.getState().setLayerCount("fires", 0);
  }
}

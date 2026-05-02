import * as Cesium from "cesium";
import { useStore } from "../store";
import {
  parseTLE,
  parseNoradId,
  parseMeanMotion,
  categorizeSatellite,
  type TleEntry,
  type SatelliteMeta,
} from "../utils/tle";
import SatelliteWorker from "../workers/sgp4.worker?worker";

const TICK_INTERVAL_MS = 1000;

interface PickIdPayload {
  layer: "satellites";
  satIndex: number;
}

export class SatelliteLayer {
  private viewer: Cesium.Viewer;
  private collection: Cesium.PointPrimitiveCollection | null = null;
  private worker: Worker | null = null;
  private tles: TleEntry[] = [];
  private metas: SatelliteMeta[] = [];
  private primitives: Cesium.PointPrimitive[] = [];
  private handler: Cesium.ScreenSpaceEventHandler | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private currentVisibility = true;
  private lastTickAt = 0;
  private pendingTick = false;
  private clockRemove: Cesium.Event.RemoveCallback | null = null;
  private scratch = new Cesium.Cartesian3();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  async mount(): Promise<void> {
    this.currentVisibility = useStore.getState().layerVisibility.satellites;
    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.satellites;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        if (this.collection) this.collection.show = next;
      }
    });

    const collection = new Cesium.PointPrimitiveCollection();
    collection.show = this.currentVisibility;
    this.viewer.scene.primitives.add(collection);
    this.collection = collection;

    let text: string;
    try {
      const res = await fetch("/api/tle");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      console.error("[SatelliteLayer] TLE fetch failed:", err);
      // Clean up the resources we already allocated so they don't leak
      this.destroy();
      return;
    }
    if (this.viewer.isDestroyed() || !this.collection) {
      this.destroy();
      return;
    }

    this.tles = parseTLE(text);

    for (let i = 0; i < this.tles.length; i++) {
      const t = this.tles[i];
      const style = categorizeSatellite(t.name);
      const meanMotion = parseMeanMotion(t.line2);
      const periodMin = meanMotion > 0 ? 1440 / meanMotion : 0;
      const meta: SatelliteMeta = {
        name: t.name,
        noradId: parseNoradId(t.line1),
        category: style.category,
        altitudeKm: 0,
        periodMin,
        line1: t.line1,
        line2: t.line2,
      };
      this.metas.push(meta);

      const id: PickIdPayload = { layer: "satellites", satIndex: i };
      const pp = collection.add({
        position: Cesium.Cartesian3.ZERO,
        color: Cesium.Color.fromCssColorString(style.cssColor),
        pixelSize: style.pixelSize,
        id,
      });
      this.primitives.push(pp);
    }

    useStore.getState().setLayerCount("satellites", this.tles.length);

    this.worker = new SatelliteWorker();
    this.worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e);
    this.worker.postMessage({ type: "init", tles: this.tles });

    // Drive ticks at 1Hz from Cesium clock
    this.clockRemove = this.viewer.clock.onTick.addEventListener(() => {
      if (this.viewer.isDestroyed()) return;
      if (!this.currentVisibility) return;
      if (this.pendingTick) return;
      const now = performance.now();
      if (now - this.lastTickAt < TICK_INTERVAL_MS) return;
      this.lastTickAt = now;
      this.pendingTick = true;
      const date = Cesium.JulianDate.toDate(this.viewer.clock.currentTime);
      this.worker?.postMessage({ type: "tick", time: date.getTime() });
    });

    // Click handler — detects PointPrimitive picks
    this.handler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    );
    this.handler.setInputAction(
      (event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = this.viewer.scene.pick(event.position);
        if (!Cesium.defined(picked)) return;
        const id = picked.id as Partial<PickIdPayload> | undefined;
        if (!id || id.layer !== "satellites" || typeof id.satIndex !== "number")
          return;
        const meta = this.metas[id.satIndex];
        if (!meta) return;
        useStore.getState().setSelectedEntity({
          type: "satellite",
          id: meta.noradId,
          data: meta,
        });
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  destroy(): void {
    if (this.clockRemove) {
      this.clockRemove();
      this.clockRemove = null;
    }
    if (this.handler) {
      this.handler.destroy();
      this.handler = null;
    }
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.collection && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection);
    }
    this.collection = null;
    this.primitives = [];
    this.metas = [];
    this.tles = [];
    useStore.getState().setLayerCount("satellites", 0);
  }

  private onWorkerMessage(e: MessageEvent): void {
    const msg = e.data as
      | { type: "ready"; count: number }
      | { type: "positions"; buffer: ArrayBuffer; count: number };

    if (msg.type === "positions") {
      this.pendingTick = false;
      if (!this.collection || this.viewer.isDestroyed()) return;
      const buf = new Float32Array(msg.buffer);
      const count = msg.count;
      for (let i = 0; i < count; i++) {
        const off = i * 4;
        const idx = buf[off];
        const lonRad = buf[off + 1];
        const latRad = buf[off + 2];
        const altKm = buf[off + 3];
        const pp = this.primitives[idx];
        if (!pp) continue;
        Cesium.Cartesian3.fromRadians(
          lonRad,
          latRad,
          altKm * 1000,
          undefined,
          this.scratch,
        );
        pp.position = this.scratch;
        const meta = this.metas[idx];
        if (meta) meta.altitudeKm = altKm;
      }
    }
  }
}

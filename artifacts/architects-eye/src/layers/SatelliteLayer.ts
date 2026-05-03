import * as Cesium from "cesium";
import * as satellite from "satellite.js";
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
const SAT_TRAIL_HALF_WINDOW_S = 1800; // 30 min on each side
const SAT_TRAIL_STEP_S = 30;

const SAT_TRAIL_MATERIAL = new Cesium.PolylineGlowMaterialProperty({
  glowPower: 0.25,
  color: Cesium.Color.fromCssColorString("#a855f7").withAlpha(0.7),
  taperPower: 0.6,
});

function buildSatelliteTrail(meta: SatelliteMeta, nowMs: number):
  | Cesium.SampledPositionProperty
  | null {
  let rec;
  try {
    rec = satellite.twoline2satrec(meta.line1, meta.line2);
  } catch {
    return null;
  }
  if (!rec || (rec as { error?: number }).error) return null;

  const prop = new Cesium.SampledPositionProperty();
  prop.setInterpolationOptions({
    interpolationDegree: 2,
    interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
  });
  prop.forwardExtrapolationType = Cesium.ExtrapolationType.NONE;
  prop.backwardExtrapolationType = Cesium.ExtrapolationType.NONE;

  const startMs = nowMs - SAT_TRAIL_HALF_WINDOW_S * 1000;
  const endMs = nowMs + SAT_TRAIL_HALF_WINDOW_S * 1000;
  let added = 0;
  for (let t = startMs; t <= endMs; t += SAT_TRAIL_STEP_S * 1000) {
    const date = new Date(t);
    let pv;
    try {
      pv = satellite.propagate(rec, date);
    } catch {
      continue;
    }
    if (!pv || !pv.position || typeof pv.position === "boolean") continue;
    const gmst = satellite.gstime(date);
    const gd = satellite.eciToGeodetic(pv.position, gmst);
    const cart = Cesium.Cartesian3.fromRadians(
      gd.longitude,
      gd.latitude,
      gd.height * 1000,
    );
    prop.addSample(Cesium.JulianDate.fromDate(date), cart);
    added++;
  }
  return added >= 2 ? prop : null;
}

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
  private unsubscribeSelection: (() => void) | null = null;
  private trailedNoradId: string | null = null;
  private trailEntity: Cesium.Entity | null = null;
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

    // Trail rendering: subscribe to selection changes
    this.unsubscribeSelection = useStore.subscribe((state) => {
      this.syncTrail(state.selectedEntity);
    });
    this.syncTrail(useStore.getState().selectedEntity);

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
    if (this.unsubscribeSelection) {
      this.unsubscribeSelection();
      this.unsubscribeSelection = null;
    }
    if (this.trailEntity && !this.viewer.isDestroyed()) {
      this.viewer.entities.remove(this.trailEntity);
    }
    this.trailEntity = null;
    this.trailedNoradId = null;
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

  private syncTrail(
    selected: ReturnType<typeof useStore.getState>["selectedEntity"],
  ): void {
    const newId =
      selected && selected.type === "satellite" ? selected.id : null;
    if (newId === this.trailedNoradId) return;

    // Always remove the old temp entity first
    if (this.trailEntity && !this.viewer.isDestroyed()) {
      this.viewer.entities.remove(this.trailEntity);
    }
    this.trailEntity = null;
    this.trailedNoradId = null;

    if (!newId || !selected || selected.type !== "satellite") return;
    const meta = selected.data;
    const nowMs = Cesium.JulianDate.toDate(
      this.viewer.clock.currentTime,
    ).getTime();
    const positionProp = buildSatelliteTrail(meta, nowMs);
    if (!positionProp) return;

    this.trailEntity = this.viewer.entities.add({
      name: `sat-trail:${meta.noradId}`,
      position: positionProp,
      point: undefined,
      billboard: undefined,
      path: new Cesium.PathGraphics({
        leadTime: SAT_TRAIL_HALF_WINDOW_S,
        trailTime: SAT_TRAIL_HALF_WINDOW_S,
        width: 1.5,
        resolution: 30,
        material: SAT_TRAIL_MATERIAL,
      }),
    });
    this.trailedNoradId = newId;
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

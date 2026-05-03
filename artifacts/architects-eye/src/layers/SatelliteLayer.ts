import * as Cesium from "cesium";
import * as satellite from "satellite.js";
import { useStore, latestSelectionOfType } from "../store";
import {
  parseTLE,
  parseNoradId,
  parseMeanMotion,
  categorizeSatellite,
  type TleEntry,
  type SatelliteMeta,
} from "../utils/tle";
import SatelliteWorker from "../workers/sgp4.worker?worker";
import { flyToInspect } from "../utils/click-to-fly";
import {
  registerClickResolver,
  unregisterClickResolver,
  type ClickResult,
} from "../utils/pick-resolvers";

const TICK_INTERVAL_MS = 1000;
const SAT_TRAIL_HALF_WINDOW_S = 1800;
const SAT_TRAIL_STEP_S = 30;

const LOD_DISTANCE_THRESHOLD_M = 100_000;
const LOD_DISTANCE_THRESHOLD_M2 =
  LOD_DISTANCE_THRESHOLD_M * LOD_DISTANCE_THRESHOLD_M;
const LOD_DEFAULT_CAP = 200;
const LOD_REDUCED_CAP = 100;
const LOD_DEBOUNCE_MS = 500;
const FPS_WINDOW_MS = 1000;
const FPS_DROP_THRESHOLD = 50;
const MODEL_URI = `${import.meta.env.BASE_URL}assets/satellite.glb`;
const NADIR_HPR = new Cesium.HeadingPitchRoll(0, -Math.PI / 2, 0);

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
  // Authoritative latest position per satellite — shared by points
  // (direct write) and model entities (read via CallbackProperty).
  private currentPositions: Array<Cesium.Cartesian3 | null> = [];
  private modelEntities = new Map<number, Cesium.Entity>();
  private noradIdToIndex = new Map<string, number>();
  private lodMode: "point" | "mixed" = "point";
  private lodCap = LOD_DEFAULT_CAP;
  private lodTimer: number | null = null;
  private cameraMoveRemove: Cesium.Event.RemoveCallback | null = null;
  private postRenderRemove: Cesium.Event.RemoveCallback | null = null;
  private hasFirstPositions = false;
  private fpsFrames = 0;
  private fpsAccum = 0;
  private fpsLastT = 0;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeSelection: (() => void) | null = null;
  private trailedNoradId: string | null = null;
  private trailEntity: Cesium.Entity | null = null;
  private currentVisibility = true;
  private lastTickAt = 0;
  private pendingTick = false;
  private clockRemove: Cesium.Event.RemoveCallback | null = null;
  private scratchCamera = new Cesium.Cartesian3();

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
        for (const ent of this.modelEntities.values()) {
          ent.show = next;
        }
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
      this.destroy();
      return;
    }
    if (this.viewer.isDestroyed() || !this.collection) {
      this.destroy();
      return;
    }

    this.tles = parseTLE(text);
    this.currentPositions = new Array(this.tles.length).fill(null);

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
      this.noradIdToIndex.set(meta.noradId, i);

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

    this.unsubscribeSelection = useStore.subscribe((state) => {
      // Trail follows the most-recently-opened satellite card.
      this.syncTrail(latestSelectionOfType(state.cards, "satellite"));
      // Selection bypass: every satellite present in any card (pinned
      // or not) must render as glTF, regardless of distance or cap.
      this.evaluateLod();
    });
    this.syncTrail(
      latestSelectionOfType(useStore.getState().cards, "satellite"),
    );

    // Resolves both PointPrimitive picks (point-mode) and model Entity
    // picks (gltf-mode) to the same satIndex payload via resolveSatIndex.
    registerClickResolver("satellite", (picked) => this.resolveClick(picked));

    // LOD: re-evaluate on camera move-end (debounced 500ms)
    this.cameraMoveRemove = this.viewer.camera.moveEnd.addEventListener(() => {
      this.scheduleLodEval();
    });

    // FPS monitor for glTF mode guardrail
    this.postRenderRemove = this.viewer.scene.postRender.addEventListener(
      () => this.onPostRender(),
    );
  }

  destroy(): void {
    if (this.lodTimer != null) {
      window.clearTimeout(this.lodTimer);
      this.lodTimer = null;
    }
    if (this.cameraMoveRemove) {
      this.cameraMoveRemove();
      this.cameraMoveRemove = null;
    }
    if (this.postRenderRemove) {
      this.postRenderRemove();
      this.postRenderRemove = null;
    }
    if (this.clockRemove) {
      this.clockRemove();
      this.clockRemove = null;
    }
    unregisterClickResolver("satellite");
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
    if (!this.viewer.isDestroyed()) {
      for (const ent of this.modelEntities.values()) {
        this.viewer.entities.remove(ent);
      }
    }
    this.modelEntities.clear();
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
    this.currentPositions = [];
    useStore.getState().setLayerCount("satellites", 0);
  }

  private resolveClick(picked: unknown): ClickResult | null {
    if (!picked || typeof picked !== "object") return null;
    const satIndex = this.resolveSatIndex(picked as {
      id?: unknown;
      primitive?: unknown;
    });
    if (satIndex === null) return null;
    const meta = this.metas[satIndex];
    if (!meta) return null;
    return {
      selected: { type: "satellite", id: meta.noradId, data: meta },
      fly: () => {
        const pos = this.currentPositions[satIndex];
        if (pos) {
          flyToInspect(this.viewer, pos, "satellite", {
            predict: {
              noradId: meta.noradId,
              line1: meta.line1,
              line2: meta.line2,
            },
          });
        } else {
          console.warn(
            "[CLICK FLY SKIP] type=satellite id=" +
              meta.noradId +
              " reason=no_position",
          );
        }
      },
    };
  }

  private resolveSatIndex(picked: { id?: unknown; primitive?: unknown }):
    | number
    | null {
    const id = picked.id;
    if (id && typeof id === "object") {
      const maybe = id as Partial<PickIdPayload> & { properties?: unknown };
      if (
        maybe.layer === "satellites" &&
        typeof maybe.satIndex === "number"
      ) {
        return maybe.satIndex;
      }
      if (id instanceof Cesium.Entity && id.properties) {
        const v = id.properties.getValue(Cesium.JulianDate.now()) as
          | Partial<PickIdPayload>
          | undefined;
        if (v && v.layer === "satellites" && typeof v.satIndex === "number") {
          return v.satIndex;
        }
      }
    }
    return null;
  }

  private scheduleLodEval(): void {
    if (this.lodTimer != null) {
      window.clearTimeout(this.lodTimer);
    }
    this.lodTimer = window.setTimeout(() => {
      this.lodTimer = null;
      this.evaluateLod();
    }, LOD_DEBOUNCE_MS);
  }

  /** Set of indices for every satellite currently shown in any card.
   *  All of them get the LOD bypass so pinned satellites stay rendered
   *  as glTF even when another (non-satellite) card is most recent. */
  private getSelectedSatIndices(): Set<number> {
    const out = new Set<number>();
    const cards = useStore.getState().cards;
    for (const c of cards) {
      if (c.entity.type !== "satellite") continue;
      const idx = this.noradIdToIndex.get(c.entity.id);
      if (idx != null) out.add(idx);
    }
    return out;
  }

  private evaluateLod(): void {
    if (this.viewer.isDestroyed() || !this.collection) return;
    if (!this.hasFirstPositions) {
      // No SGP4 ticks yet — wait, we'll re-evaluate from worker callback.
      return;
    }

    const camPos = this.viewer.camera.positionWC;
    // Score by squared distance to camera; only consider sats with a
    // resolved current position AND within the LOD distance threshold.
    const candidates: Array<{ idx: number; dist2: number }> = [];
    for (let i = 0; i < this.currentPositions.length; i++) {
      const p = this.currentPositions[i];
      if (!p) continue;
      const dx = p.x - camPos.x;
      const dy = p.y - camPos.y;
      const dz = p.z - camPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > LOD_DISTANCE_THRESHOLD_M2) continue;
      candidates.push({ idx: i, dist2: d2 });
    }
    candidates.sort((a, b) => a.dist2 - b.dist2);
    const wanted = new Set<number>(
      candidates.slice(0, this.lodCap).map((c) => c.idx),
    );

    // Selection bypass: ensure every satellite shown in a card (pinned
    // or unpinned) always renders as glTF, regardless of distance or cap.
    const selIndices = this.getSelectedSatIndices();
    for (const idx of selIndices) {
      if (this.currentPositions[idx]) wanted.add(idx);
    }

    // Remove models no longer in the wanted set.
    for (const [idx, ent] of this.modelEntities) {
      if (!wanted.has(idx)) {
        this.viewer.entities.remove(ent);
        this.modelEntities.delete(idx);
        const pp = this.primitives[idx];
        if (pp) pp.show = true;
      }
    }
    // Add new models.
    for (const idx of wanted) {
      if (this.modelEntities.has(idx)) continue;
      const ent = this.createModelEntity(idx);
      if (ent) {
        this.modelEntities.set(idx, ent);
        const pp = this.primitives[idx];
        if (pp) pp.show = false;
      }
    }
    this.lodMode = wanted.size > 0 ? "mixed" : "point";
  }

  private clearAllModels(): void {
    if (this.viewer.isDestroyed()) {
      this.modelEntities.clear();
      return;
    }
    for (const [idx, ent] of this.modelEntities) {
      this.viewer.entities.remove(ent);
      const pp = this.primitives[idx];
      if (pp) pp.show = true;
    }
    this.modelEntities.clear();
  }

  private createModelEntity(idx: number): Cesium.Entity | null {
    const meta = this.metas[idx];
    if (!meta) return null;

    const positionCb = new Cesium.CallbackProperty((_t, result) => {
      const p = this.currentPositions[idx];
      if (!p) return undefined as unknown as Cesium.Cartesian3;
      return Cesium.Cartesian3.clone(p, result);
    }, false) as unknown as Cesium.PositionProperty;

    const orientationCb = new Cesium.CallbackProperty((_t, result) => {
      const p = this.currentPositions[idx];
      if (!p) return undefined as unknown as Cesium.Quaternion;
      return Cesium.Transforms.headingPitchRollQuaternion(
        p,
        NADIR_HPR,
        Cesium.Ellipsoid.WGS84,
        undefined,
        result as Cesium.Quaternion | undefined,
      );
    }, false) as unknown as Cesium.Property;

    const ent = this.viewer.entities.add({
      name: `sat-model:${meta.noradId}`,
      position: positionCb,
      orientation: orientationCb,
      show: this.currentVisibility,
      model: {
        uri: MODEL_URI,
        minimumPixelSize: 32,
        maximumScale: 50_000,
      },
      properties: { layer: "satellites", satIndex: idx },
    });
    return ent;
  }

  private onPostRender(): void {
    const now = performance.now();
    if (this.fpsLastT === 0) {
      this.fpsLastT = now;
      return;
    }
    const dt = now - this.fpsLastT;
    this.fpsLastT = now;
    this.fpsFrames++;
    this.fpsAccum += dt;
    if (this.fpsAccum < FPS_WINDOW_MS) return;
    const fps = (this.fpsFrames * 1000) / this.fpsAccum;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    if (
      this.lodMode === "mixed" &&
      fps < FPS_DROP_THRESHOLD &&
      this.lodCap === LOD_DEFAULT_CAP
    ) {
      console.log("[SAT LOD] fps_drop", {
        fps: Math.round(fps),
        cap_from: LOD_DEFAULT_CAP,
        cap_to: LOD_REDUCED_CAP,
      });
      this.lodCap = LOD_REDUCED_CAP;
      this.evaluateLod();
    }
  }

  private syncTrail(
    selected: { type: "satellite"; id: string; data: SatelliteMeta } | null,
  ): void {
    const newId = selected ? selected.id : null;
    if (newId === this.trailedNoradId) return;

    if (this.trailEntity && !this.viewer.isDestroyed()) {
      this.viewer.entities.remove(this.trailEntity);
    }
    this.trailEntity = null;
    this.trailedNoradId = null;

    if (!newId || !selected) return;
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
        let cur = this.currentPositions[idx];
        if (!cur) {
          cur = new Cesium.Cartesian3();
          this.currentPositions[idx] = cur;
        }
        Cesium.Cartesian3.fromRadians(
          lonRad,
          latRad,
          altKm * 1000,
          undefined,
          cur,
        );
        pp.position = cur;
        const meta = this.metas[idx];
        if (meta) meta.altitudeKm = altKm;
      }
      if (!this.hasFirstPositions) {
        this.hasFirstPositions = true;
        // First positions are in — evaluate LOD now in case the camera
        // is already inside the model threshold.
        this.evaluateLod();
      }
    }
  }
}

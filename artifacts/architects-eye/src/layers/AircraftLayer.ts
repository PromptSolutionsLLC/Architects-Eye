import * as Cesium from "cesium";
import { fetchAircraft, type Aircraft } from "../utils/api";
import { useStore, latestSelectionOfType } from "../store";
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
import {
  writeAircraftBatch,
  getBufferRange,
  getPositionsAtTime,
  getTrailSamples,
  startEvictionTimer,
  stopEvictionTimer,
  type AircraftBufferRecord,
} from "../buffer/aircraftBuffer";

const POLL_INTERVAL_MS = 12_000;
const STALE_MS = 60_000;
const PREDICT_AHEAD_S = 12;
const KNOTS_TO_MS = 0.514444;
const EARTH_RADIUS_M = 6_371_000;
const REPLAY_RENDER_THROTTLE_MS = 250;
const REPLAY_TRAIL_WINDOW_MS = 10 * 60 * 1000;

const AIRCRAFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <polygon points="11,2 20,20 11,14 2,20" fill="white" stroke="#00ccff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const AIRCRAFT_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AIRCRAFT_SVG)}`;

type EntryMode = "live" | "replay";

interface EntityEntry {
  entity: Cesium.Entity;
  mode: EntryMode;
  // For live entries we keep the SampledPositionProperty so click-to-fly
  // and the P8 PathGraphics trail can interpolate. Replay entries use a
  // ConstantPositionProperty (static at the queried position) — listed
  // here as the second union member.
  positionProperty:
    | Cesium.SampledPositionProperty
    | Cesium.ConstantPositionProperty;
  rotationProperty: Cesium.ConstantProperty;
  lastSeen: number;
  ac: Aircraft;
}

function predictPosition(
  lat: number,
  lon: number,
  altM: number,
  trackDeg: number,
  groundspeedKts: number,
  aheadSec: number,
): Cesium.Cartesian3 {
  const speedMs = groundspeedKts * KNOTS_TO_MS;
  const distanceM = speedMs * aheadSec;
  if (distanceM <= 0) {
    return Cesium.Cartesian3.fromDegrees(lon, lat, altM);
  }
  const headingRad = Cesium.Math.toRadians(trackDeg);
  const dLatDeg = Cesium.Math.toDegrees(
    (distanceM * Math.cos(headingRad)) / EARTH_RADIUS_M,
  );
  const dLonDeg = Cesium.Math.toDegrees(
    (distanceM * Math.sin(headingRad)) /
      (EARTH_RADIUS_M * Math.cos(Cesium.Math.toRadians(lat))),
  );
  return Cesium.Cartesian3.fromDegrees(lon + dLonDeg, lat + dLatDeg, altM);
}

const TRAIL_MATERIAL = new Cesium.PolylineGlowMaterialProperty({
  glowPower: 0.25,
  color: Cesium.Color.fromCssColorString("#22d3ee").withAlpha(0.85),
  taperPower: 0.5,
});

function makeAircraftPath(): Cesium.PathGraphics {
  return new Cesium.PathGraphics({
    leadTime: 0,
    trailTime: 600,
    width: 2.5,
    resolution: 2.0,
    material: TRAIL_MATERIAL,
  });
}

function recordToAircraft(rec: AircraftBufferRecord): Aircraft {
  return {
    hex: rec.icao24,
    flight: rec.callsign || undefined,
    lat: rec.lat,
    lon: rec.lon,
    alt_baro: rec.alt_baro_ft,
    gs: rec.ground_speed_kts,
    track: rec.track_deg,
  };
}

export class AircraftLayer {
  private viewer: Cesium.Viewer;
  private entries = new Map<string, EntityEntry>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeSelection: (() => void) | null = null;
  private unsubscribePlayback: (() => void) | null = null;
  private currentVisibility = true;
  private trailedHex: string | null = null;
  private replayTrailEntity: Cesium.Entity | null = null;

  // Replay rendering state
  private playbackMode: "live" | "replay" = "live";
  private currentReplayTs: number | null = null;
  private replayRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  mount(): void {
    this.currentVisibility = useStore.getState().layerVisibility.aircraft;
    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.aircraft;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        this.applyVisibility(next);
      }
    });

    // Trail subscription — handles BOTH live (PathGraphics) and replay
    // (manually-drawn polyline) trails. syncTrail() bails when nothing
    // has actually changed.
    this.unsubscribeSelection = useStore.subscribe((state) => {
      this.syncTrail(latestSelectionOfType(state.cards, "aircraft"));
    });
    this.syncTrail(
      latestSelectionOfType(useStore.getState().cards, "aircraft"),
    );

    // Playback-mode + replay-timestamp subscription. On every change we
    // re-evaluate whether to swap into replay rendering.
    this.playbackMode = useStore.getState().playbackMode;
    this.currentReplayTs = useStore.getState().replayTimestamp_ms;
    this.unsubscribePlayback = useStore.subscribe((state) => {
      const modeChanged = state.playbackMode !== this.playbackMode;
      const tsChanged = state.replayTimestamp_ms !== this.currentReplayTs;
      this.playbackMode = state.playbackMode;
      this.currentReplayTs = state.replayTimestamp_ms;
      if (modeChanged) {
        if (state.playbackMode === "replay") this.handleEnterReplay();
        else this.handleExitReplay();
      } else if (state.playbackMode === "replay" && tsChanged) {
        this.scheduleReplayRender();
      }
    });

    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);

    startEvictionTimer();

    registerClickResolver("aircraft", (picked) => this.resolveClick(picked));
    registerSearchProvider("aircraft", {
      search: (q) => this.search(q),
      getClickResultById: (id) => this.buildClickResult(id),
    });
  }

  private buildClickResult(hex: string): ClickResult | null {
    const entry = this.entries.get(hex);
    if (!entry) return null;
    return {
      selected: { type: "aircraft", id: hex, data: entry.ac },
      fly: () => {
        const pos = entry.positionProperty.getValue(
          this.viewer.clock.currentTime,
        );
        if (pos) {
          flyToInspect(this.viewer, pos, "aircraft");
        } else {
          console.warn(
            "[CLICK FLY SKIP] type=aircraft id=" + hex + " reason=no_position",
          );
        }
      },
    };
  }

  private search(q: string): SearchResult[] {
    const out: SearchResult[] = [];
    for (const [hex, entry] of this.entries) {
      const callsign = (entry.ac.flight ?? "").trim();
      const cs = scoreMatch(callsign, q);
      const hs = scoreMatch(hex, q);
      const score = cs >= 0 && hs >= 0 ? Math.min(cs, hs) : Math.max(cs, hs);
      if (score < 0) continue;
      out.push({
        type: "aircraft",
        id: hex,
        label: callsign || hex,
        sublabel: "AIRCRAFT · " + hex,
        score,
      });
    }
    return out;
  }

  private resolveClick(picked: unknown): ClickResult | null {
    if (!picked || typeof picked !== "object") return null;
    const id = (picked as { id?: unknown }).id;
    if (!(id instanceof Cesium.Entity)) return null;
    const hex = id.name;
    if (!hex) return null;
    const entry = this.entries.get(hex);
    if (!entry) return null;
    return {
      selected: { type: "aircraft", id: hex, data: entry.ac },
      fly: () => {
        const pos = entry.positionProperty.getValue(
          this.viewer.clock.currentTime,
        );
        if (pos) {
          flyToInspect(this.viewer, pos, "aircraft");
        } else {
          console.warn(
            "[CLICK FLY SKIP] type=aircraft id=" + hex + " reason=no_position",
          );
        }
      },
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.replayRenderTimer !== null) {
      clearTimeout(this.replayRenderTimer);
      this.replayRenderTimer = null;
    }
    unregisterClickResolver("aircraft");
    unregisterSearchProvider("aircraft");
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.unsubscribeSelection) {
      this.unsubscribeSelection();
      this.unsubscribeSelection = null;
    }
    if (this.unsubscribePlayback) {
      this.unsubscribePlayback();
      this.unsubscribePlayback = null;
    }
    this.trailedHex = null;
    this.clearAllEntities();
    this.removeReplayTrail();
    stopEvictionTimer();
    useStore.getState().setLayerCount("aircraft", 0);
  }

  private clearAllEntities(): void {
    if (this.viewer.isDestroyed()) {
      this.entries.clear();
      return;
    }
    for (const { entity } of this.entries.values()) {
      this.viewer.entities.remove(entity);
    }
    this.entries.clear();
  }

  private removeReplayTrail(): void {
    if (this.replayTrailEntity && !this.viewer.isDestroyed()) {
      this.viewer.entities.remove(this.replayTrailEntity);
    }
    this.replayTrailEntity = null;
  }

  private syncTrail(
    selected: { type: "aircraft"; id: string } | null,
  ): void {
    const newHex = selected ? selected.id : null;
    // Pure early return — do NOT issue a buffer query here. Zustand
    // fires this subscription on every store mutation (incl. replay
    // clock ticks); refreshing the trail unconditionally would create
    // an IDB query storm during playback. The replay trail is already
    // refreshed at the end of every renderReplay() (250ms throttled).
    if (newHex === this.trailedHex) return;

    // Tear down the previous live PathGraphics trail (if any).
    if (this.trailedHex) {
      const prev = this.entries.get(this.trailedHex);
      if (prev && prev.mode === "live") prev.entity.path = undefined;
    }
    this.removeReplayTrail();
    this.trailedHex = null;

    if (!newHex) return;

    if (this.playbackMode === "live") {
      const next = this.entries.get(newHex);
      if (next && next.mode === "live") {
        next.entity.path = makeAircraftPath();
        this.trailedHex = newHex;
      }
    } else {
      this.trailedHex = newHex;
      // One-shot refresh on selection change — the next renderReplay()
      // will keep it in sync as the scrub timestamp moves.
      void this.refreshReplayTrail();
    }
  }

  private applyVisibility(visible: boolean): void {
    for (const { entity } of this.entries.values()) {
      entity.show = visible;
    }
    if (this.replayTrailEntity) this.replayTrailEntity.show = visible;
  }

  private async poll(): Promise<void> {
    if (this.viewer.isDestroyed()) return;
    // Suspend live render writes while in replay mode — but we still
    // run the buffer-write side so the buffer keeps growing, since the
    // user expects the live edge to keep advancing while they scrub.
    const { lat, lon, distNm } = useStore.getState().viewport;
    const expandedDist = Math.round(distNm * 1.2);
    const aircraft = await fetchAircraft(lat, lon, expandedDist);
    if (this.viewer.isDestroyed() || this.destroyed) return;

    const nowMs = Date.now();

    // Buffer write — single transaction for the whole batch.
    const records: AircraftBufferRecord[] = [];
    for (const ac of aircraft) {
      if (ac.lat == null || ac.lon == null) continue;
      const altFt =
        typeof ac.alt_baro === "number" ? ac.alt_baro : 0;
      records.push({
        icao24: ac.hex,
        timestamp_ms: nowMs,
        lat: ac.lat,
        lon: ac.lon,
        alt_baro_ft: altFt,
        ground_speed_kts: ac.gs ?? 0,
        track_deg: ac.track ?? 0,
        callsign: (ac.flight ?? "").trim(),
      });
    }
    if (records.length > 0) {
      try {
        await writeAircraftBatch(records);
        const range = await getBufferRange();
        if (!this.destroyed) {
          useStore.getState().setBufferRange(range);
        }
      } catch (err) {
        console.warn("[BUFFER] write/range failed:", err);
      }
    }
    if (this.destroyed) return;

    // Live render path — only when not in replay mode.
    if (this.playbackMode === "live") {
      const jd = Cesium.JulianDate.now();
      for (const ac of aircraft) {
        if (ac.lat == null || ac.lon == null) continue;
        this.upsertLiveEntity(ac, nowMs, jd);
      }
      for (const [hex, entry] of this.entries) {
        if (
          entry.mode === "live" &&
          nowMs - entry.lastSeen > STALE_MS
        ) {
          if (!this.viewer.isDestroyed()) {
            this.viewer.entities.remove(entry.entity);
          }
          this.entries.delete(hex);
        }
      }
      useStore.getState().setLayerCount("aircraft", this.entries.size);
    }
  }

  private upsertLiveEntity(
    ac: Aircraft,
    nowMs: number,
    jd: Cesium.JulianDate,
  ): void {
    const lat = ac.lat!;
    const lon = ac.lon!;
    const altFt = typeof ac.alt_baro === "number" ? ac.alt_baro : 0;
    const altM = Math.max(0, altFt * 0.3048);
    const trackDeg = ac.track ?? 0;
    const gsKts = ac.gs ?? 0;

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
    const predicted = predictPosition(
      lat,
      lon,
      altM,
      trackDeg,
      gsKts,
      PREDICT_AHEAD_S,
    );
    const futureJd = Cesium.JulianDate.addSeconds(
      jd,
      PREDICT_AHEAD_S,
      new Cesium.JulianDate(),
    );
    const rotation = -Cesium.Math.toRadians(trackDeg);

    const existing = this.entries.get(ac.hex);
    if (
      existing &&
      existing.mode === "live" &&
      existing.positionProperty instanceof Cesium.SampledPositionProperty
    ) {
      existing.positionProperty.addSample(jd, position);
      existing.positionProperty.addSample(futureJd, predicted);
      existing.rotationProperty.setValue(rotation);
      existing.entity.show = this.currentVisibility;
      existing.lastSeen = nowMs;
      existing.ac = ac;
      return;
    }

    if (existing) {
      // Type/mode mismatch (shouldn't normally happen in live mode) —
      // tear it down and re-create cleanly.
      if (!this.viewer.isDestroyed()) {
        this.viewer.entities.remove(existing.entity);
      }
      this.entries.delete(ac.hex);
    }

    const positionProperty = new Cesium.SampledPositionProperty();
    positionProperty.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });
    positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    positionProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    positionProperty.addSample(jd, position);
    positionProperty.addSample(futureJd, predicted);

    const rotationProperty = new Cesium.ConstantProperty(rotation);

    const entity = this.viewer.entities.add({
      name: ac.hex,
      position: positionProperty,
      show: this.currentVisibility,
      billboard: this.makeBillboard(rotationProperty),
    });

    this.entries.set(ac.hex, {
      entity,
      mode: "live",
      positionProperty,
      rotationProperty,
      lastSeen: nowMs,
      ac,
    });

    // If this newly-created live aircraft happens to be the trailed
    // one (selection was set before the entity existed), attach the path.
    if (this.trailedHex === ac.hex && this.playbackMode === "live") {
      entity.path = makeAircraftPath();
    }
  }

  private makeBillboard(
    rotationProperty: Cesium.ConstantProperty,
  ): Cesium.BillboardGraphics.ConstructorOptions {
    return {
      image: AIRCRAFT_ICON,
      width: 22,
      height: 22,
      rotation: rotationProperty,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      // 0 = always depth-test against the globe, so aircraft on the
      // far side of the planet are correctly occluded. POSITIVE_INFINITY
      // would draw them through the ellipsoid (the previous bug).
      disableDepthTestDistance: 0,
      scaleByDistance: new Cesium.NearFarScalar(1.0e4, 1.8, 8.0e6, 0.5),
    };
  }

  // ── Replay rendering ─────────────────────────────────────────────

  private handleEnterReplay(): void {
    // Clear the trailed live PathGraphics — it lives on the entity that
    // we're about to remove.
    if (this.trailedHex) {
      const prev = this.entries.get(this.trailedHex);
      if (prev && prev.mode === "live") prev.entity.path = undefined;
    }
    this.clearAllEntities();
    useStore.getState().setLayerCount("aircraft", 0);
    this.scheduleReplayRender();
  }

  private handleExitReplay(): void {
    if (this.replayRenderTimer !== null) {
      clearTimeout(this.replayRenderTimer);
      this.replayRenderTimer = null;
    }
    this.removeReplayTrail();
    this.clearAllEntities();
    useStore.getState().setLayerCount("aircraft", 0);
    // Resume live cadence: trigger an immediate poll so the user sees
    // current positions without waiting up to 12 s.
    void this.poll();
  }

  private scheduleReplayRender(): void {
    if (this.replayRenderTimer !== null) return;
    this.replayRenderTimer = setTimeout(() => {
      this.replayRenderTimer = null;
      void this.renderReplay();
    }, REPLAY_RENDER_THROTTLE_MS);
  }

  private async renderReplay(): Promise<void> {
    if (this.destroyed || this.viewer.isDestroyed()) return;
    if (this.playbackMode !== "replay") return;
    const ts = this.currentReplayTs;
    if (ts == null) return;

    let positions: Map<string, AircraftBufferRecord>;
    try {
      positions = await getPositionsAtTime(ts);
    } catch (err) {
      console.warn("[REPLAY] buffer query failed:", err);
      return;
    }
    if (this.destroyed || this.viewer.isDestroyed()) return;
    if (this.playbackMode !== "replay" || this.currentReplayTs !== ts) {
      // Outpaced by another scrub event — its scheduled render will run.
      return;
    }

    // Diff: remove entries no longer in the buffer view.
    for (const hex of [...this.entries.keys()]) {
      if (!positions.has(hex)) {
        const entry = this.entries.get(hex);
        if (entry && !this.viewer.isDestroyed()) {
          this.viewer.entities.remove(entry.entity);
        }
        this.entries.delete(hex);
      }
    }

    // Upsert each aircraft visible at this scrub time.
    for (const [hex, rec] of positions) {
      this.upsertReplayEntity(hex, rec);
    }

    useStore.getState().setLayerCount("aircraft", this.entries.size);

    await this.refreshReplayTrail();
  }

  private upsertReplayEntity(hex: string, rec: AircraftBufferRecord): void {
    const altM = Math.max(0, rec.alt_baro_ft * 0.3048);
    const position = Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat, altM);
    const rotation = -Cesium.Math.toRadians(rec.track_deg);

    const existing = this.entries.get(hex);
    if (
      existing &&
      existing.mode === "replay" &&
      existing.positionProperty instanceof Cesium.ConstantPositionProperty
    ) {
      existing.positionProperty.setValue(position);
      existing.rotationProperty.setValue(rotation);
      existing.entity.show = this.currentVisibility;
      existing.lastSeen = rec.timestamp_ms;
      existing.ac = recordToAircraft(rec);
      return;
    }

    if (existing) {
      if (!this.viewer.isDestroyed()) {
        this.viewer.entities.remove(existing.entity);
      }
      this.entries.delete(hex);
    }

    const positionProperty = new Cesium.ConstantPositionProperty(position);
    const rotationProperty = new Cesium.ConstantProperty(rotation);
    const entity = this.viewer.entities.add({
      name: hex,
      position: positionProperty,
      show: this.currentVisibility,
      billboard: this.makeBillboard(rotationProperty),
    });
    this.entries.set(hex, {
      entity,
      mode: "replay",
      positionProperty,
      rotationProperty,
      lastSeen: rec.timestamp_ms,
      ac: recordToAircraft(rec),
    });
  }

  private async refreshReplayTrail(): Promise<void> {
    if (this.playbackMode !== "replay") {
      this.removeReplayTrail();
      return;
    }
    const hex = this.trailedHex;
    const ts = this.currentReplayTs;
    if (!hex || ts == null) {
      this.removeReplayTrail();
      return;
    }
    let samples: AircraftBufferRecord[];
    try {
      samples = await getTrailSamples(hex, ts - REPLAY_TRAIL_WINDOW_MS, ts);
    } catch (err) {
      console.warn("[REPLAY] trail query failed:", err);
      return;
    }
    if (this.destroyed || this.viewer.isDestroyed()) return;
    if (
      this.playbackMode !== "replay" ||
      this.currentReplayTs !== ts ||
      this.trailedHex !== hex
    ) {
      return;
    }
    if (samples.length < 2) {
      this.removeReplayTrail();
      return;
    }
    const positions: Cesium.Cartesian3[] = samples.map((s) =>
      Cesium.Cartesian3.fromDegrees(
        s.lon,
        s.lat,
        Math.max(0, s.alt_baro_ft * 0.3048),
      ),
    );
    if (this.replayTrailEntity) {
      const polyline = this.replayTrailEntity.polyline;
      if (polyline) {
        polyline.positions = new Cesium.ConstantProperty(positions);
      }
      this.replayTrailEntity.show = this.currentVisibility;
      return;
    }
    this.replayTrailEntity = this.viewer.entities.add({
      name: `${hex}-replay-trail`,
      polyline: {
        positions,
        width: 2.5,
        material: TRAIL_MATERIAL,
      },
      show: this.currentVisibility,
    });
  }
}

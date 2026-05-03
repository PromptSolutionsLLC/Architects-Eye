import * as Cesium from "cesium";
import { fetchAircraft, type Aircraft } from "../utils/api";
import { useStore } from "../store";

const POLL_INTERVAL_MS = 12_000;
const STALE_MS = 60_000;
const PREDICT_AHEAD_S = 12;
const KNOTS_TO_MS = 0.514444;
const EARTH_RADIUS_M = 6_371_000;

const AIRCRAFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <polygon points="11,2 20,20 11,14 2,20" fill="white" stroke="#00ccff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const AIRCRAFT_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AIRCRAFT_SVG)}`;

interface EntityEntry {
  entity: Cesium.Entity;
  positionProperty: Cesium.SampledPositionProperty;
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

export class AircraftLayer {
  private viewer: Cesium.Viewer;
  private entries = new Map<string, EntityEntry>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handler: Cesium.ScreenSpaceEventHandler | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeSelection: (() => void) | null = null;
  private currentVisibility = true;
  // Hex of the aircraft *we* added a trail to last, so we can clean
  // it up on the next selection change without disturbing other
  // layers' selections.
  private trailedHex: string | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  mount(): void {
    // Sync visibility from the store and subscribe for live updates
    this.currentVisibility = useStore.getState().layerVisibility.aircraft;
    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.aircraft;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        this.applyVisibility(next);
      }
    });

    // Trail rendering: subscribe to selection changes
    this.unsubscribeSelection = useStore.subscribe((state) => {
      this.syncTrail(state.selectedEntity);
    });
    this.syncTrail(useStore.getState().selectedEntity);

    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);

    this.handler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    );
    this.handler.setInputAction(
      (event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = this.viewer.scene.pick(event.position);
        if (!Cesium.defined(picked)) {
          // Only deselect when the *current* selection is an aircraft.
          // Other layers (satellites, vessels, airspace) own their own
          // selections and would otherwise be clobbered because every
          // ScreenSpaceEventHandler fires on the same LEFT_CLICK.
          const cur = useStore.getState().selectedEntity;
          if (cur && cur.type === "aircraft") {
            useStore.getState().setSelectedEntity(null);
          }
          return;
        }
        if (!(picked.id instanceof Cesium.Entity)) return;
        const entity = picked.id as Cesium.Entity;
        const hex = entity.name;
        if (!hex) return;
        const entry = this.entries.get(hex);
        if (entry) {
          useStore.getState().setSelectedEntity({
            type: "aircraft",
            id: hex,
            data: entry.ac,
          });
        }
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  destroy(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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
    this.trailedHex = null;
    for (const { entity } of this.entries.values()) {
      if (!this.viewer.isDestroyed()) {
        this.viewer.entities.remove(entity);
      }
    }
    this.entries.clear();
    useStore.getState().setLayerCount("aircraft", 0);
  }

  private syncTrail(
    selected: ReturnType<typeof useStore.getState>["selectedEntity"],
  ): void {
    const newHex =
      selected && selected.type === "aircraft" ? selected.id : null;
    if (newHex === this.trailedHex) return;

    // Clean up the old trail — only if WE put one there.
    if (this.trailedHex) {
      const prev = this.entries.get(this.trailedHex);
      if (prev) prev.entity.path = undefined;
    }

    this.trailedHex = null;

    if (newHex) {
      const next = this.entries.get(newHex);
      if (next) {
        next.entity.path = makeAircraftPath();
        this.trailedHex = newHex;
      }
    }
  }

  private applyVisibility(visible: boolean): void {
    for (const { entity } of this.entries.values()) {
      entity.show = visible;
    }
  }

  private async poll(): Promise<void> {
    if (this.viewer.isDestroyed()) return;
    const { lat, lon, distNm } = useStore.getState().viewport;
    const expandedDist = Math.round(distNm * 1.2);
    const aircraft = await fetchAircraft(lat, lon, expandedDist);
    if (this.viewer.isDestroyed()) return;

    const nowMs = Date.now();
    const jd = Cesium.JulianDate.now();

    for (const ac of aircraft) {
      if (ac.lat == null || ac.lon == null) continue;
      this.upsertEntity(ac, nowMs, jd);
    }

    for (const [hex, entry] of this.entries) {
      if (nowMs - entry.lastSeen > STALE_MS) {
        if (!this.viewer.isDestroyed()) {
          this.viewer.entities.remove(entry.entity);
        }
        this.entries.delete(hex);
      }
    }

    useStore.getState().setLayerCount("aircraft", this.entries.size);
  }

  private upsertEntity(
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
    if (existing) {
      // UPDATE in place — never replace the entity or its property references
      existing.positionProperty.addSample(jd, position);
      existing.positionProperty.addSample(futureJd, predicted);
      existing.rotationProperty.setValue(rotation);
      existing.entity.show = this.currentVisibility;
      existing.lastSeen = nowMs;
      existing.ac = ac;
      return;
    }

    // CREATE new entity
    const positionProperty = new Cesium.SampledPositionProperty();
    positionProperty.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });
    // HOLD prevents the entity from disappearing if the clock ticks past
    // the last sample (e.g. when a poll is delayed)
    positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    positionProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    positionProperty.addSample(jd, position);
    positionProperty.addSample(futureJd, predicted);

    const rotationProperty = new Cesium.ConstantProperty(rotation);

    const entity = this.viewer.entities.add({
      name: ac.hex,
      position: positionProperty,
      show: this.currentVisibility,
      billboard: {
        image: AIRCRAFT_ICON,
        width: 22,
        height: 22,
        rotation: rotationProperty,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.0e4, 1.8, 8.0e6, 0.5),
      },
    });

    this.entries.set(ac.hex, {
      entity,
      positionProperty,
      rotationProperty,
      lastSeen: nowMs,
      ac,
    });
  }
}

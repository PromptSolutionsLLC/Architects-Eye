import * as Cesium from "cesium";
import { fetchAircraft, type Aircraft } from "../utils/api";
import { useStore } from "../store";

const POLL_INTERVAL_MS = 12_000;
const STALE_MS = 60_000;

const AIRCRAFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <polygon points="11,2 20,20 11,14 2,20" fill="white" stroke="#00ccff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const AIRCRAFT_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AIRCRAFT_SVG)}`;

interface EntityEntry {
  entity: Cesium.Entity;
  positionProperty: Cesium.SampledPositionProperty;
  lastSeen: number;
  ac: Aircraft;
}

export class AircraftLayer {
  private viewer: Cesium.Viewer;
  private entries = new Map<string, EntityEntry>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handler: Cesium.ScreenSpaceEventHandler | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  mount(): void {
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);

    this.handler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    );
    this.handler.setInputAction(
      (event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = this.viewer.scene.pick(event.position);
        if (!Cesium.defined(picked)) {
          useStore.getState().setSelectedEntity(null);
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
    for (const { entity } of this.entries.values()) {
      if (!this.viewer.isDestroyed()) {
        this.viewer.entities.remove(entity);
      }
    }
    this.entries.clear();
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
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
    const rotation = -Cesium.Math.toRadians(ac.track ?? 0);

    const existing = this.entries.get(ac.hex);
    if (existing) {
      existing.positionProperty.addSample(jd, position);
      existing.entity.billboard!.rotation = new Cesium.ConstantProperty(
        rotation,
      );
      existing.lastSeen = nowMs;
      existing.ac = ac;
    } else {
      const positionProperty = new Cesium.SampledPositionProperty();
      positionProperty.setInterpolationOptions({
        interpolationDegree: 1,
        interpolationAlgorithm: Cesium.LinearApproximation,
      });
      positionProperty.addSample(jd, position);

      const entity = this.viewer.entities.add({
        name: ac.hex,
        position: positionProperty,
        billboard: {
          image: AIRCRAFT_ICON,
          width: 22,
          height: 22,
          rotation,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(1.0e4, 1.8, 8.0e6, 0.5),
        },
      });

      this.entries.set(ac.hex, {
        entity,
        positionProperty,
        lastSeen: nowMs,
        ac,
      });
    }
  }
}

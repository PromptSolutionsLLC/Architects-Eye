import * as Cesium from "cesium";
import { useStore, latestSelectionOfType } from "../store";
import {
  AISStreamClient,
  type VesselPosition,
  type VesselStatic,
} from "../ws/aisstream-client";
import { flyToInspect } from "../utils/click-to-fly";
import {
  registerClickResolver,
  unregisterClickResolver,
  type ClickResult,
} from "../utils/pick-resolvers";

const TELEPORT_NM_THRESHOLD = 100;
const TELEPORT_S_THRESHOLD = 60;
const EARTH_RADIUS_NM = 3_440.065;

function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const STALE_MS = 5 * 60 * 1000;
const PRUNE_INTERVAL_MS = 30_000;
const PREDICT_AHEAD_S = 30;
const KNOTS_TO_MS = 0.514444;
const EARTH_RADIUS_M = 6_371_000;

const VESSEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <polygon points="9,2 16,16 9,12 2,16" fill="#34d399" stroke="#d1fae5" stroke-width="1" stroke-linejoin="round"/>
</svg>`;
const VESSEL_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(VESSEL_SVG)}`;

const ENTITY_NAME_PREFIX = "vessel:";

export interface VesselSelectionData {
  mmsi: number;
  name: string;
  type: number;
  flag: string;
  callsign: string;
  destination: string;
  sog: number;
  cog: number;
}

interface Entry {
  entity: Cesium.Entity;
  positionProperty: Cesium.SampledPositionProperty;
  rotationProperty: Cesium.ConstantProperty;
  lastSeen: number;
  lastPos: VesselPosition | null;
}

function predictPosition(
  lat: number,
  lon: number,
  cogDeg: number,
  sogKts: number,
  aheadSec: number,
): Cesium.Cartesian3 {
  const speedMs = sogKts * KNOTS_TO_MS;
  const distanceM = speedMs * aheadSec;
  if (distanceM <= 0) return Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  const headingRad = Cesium.Math.toRadians(cogDeg);
  const dLatDeg = Cesium.Math.toDegrees(
    (distanceM * Math.cos(headingRad)) / EARTH_RADIUS_M,
  );
  const dLonDeg = Cesium.Math.toDegrees(
    (distanceM * Math.sin(headingRad)) /
      (EARTH_RADIUS_M * Math.max(0.01, Math.cos(Cesium.Math.toRadians(lat)))),
  );
  return Cesium.Cartesian3.fromDegrees(lon + dLonDeg, lat + dLatDeg, 0);
}

const VESSEL_TRAIL_MATERIAL = new Cesium.PolylineGlowMaterialProperty({
  glowPower: 0.35,
  color: Cesium.Color.fromCssColorString("#5eead4").withAlpha(1.0),
  taperPower: 0.4,
});

function makeVesselPath(): Cesium.PathGraphics {
  return new Cesium.PathGraphics({
    leadTime: 0,
    trailTime: 1800,
    width: 3,
    resolution: 5.0,
    material: VESSEL_TRAIL_MATERIAL,
  });
}

export class VesselLayer {
  private viewer: Cesium.Viewer;
  private client: AISStreamClient;
  private entries = new Map<number, Entry>();
  private staticByMmsi = new Map<number, VesselStatic>();
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeSelection: (() => void) | null = null;
  private currentVisibility = false;
  private pruneTimer: number | null = null;
  private trailedMmsi: number | null = null;

  constructor(viewer: Cesium.Viewer, client: AISStreamClient) {
    this.viewer = viewer;
    this.client = client;
  }

  mount(): void {
    this.currentVisibility = useStore.getState().layerVisibility.vessels;
    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.vessels;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        for (const e of this.entries.values()) e.entity.show = next;
      }
    });

    // Vessel trail follows the most-recently-opened vessel card.
    this.unsubscribeSelection = useStore.subscribe((state) => {
      this.syncTrail(latestSelectionOfType(state.cards, "vessel"));
    });
    this.syncTrail(
      latestSelectionOfType(useStore.getState().cards, "vessel"),
    );

    this.client.on({
      position: (p) => this.onPosition(p),
      staticData: (s) => this.onStatic(s),
    });

    this.pruneTimer = window.setInterval(
      () => this.prune(),
      PRUNE_INTERVAL_MS,
    );

    registerClickResolver("vessel", (picked) => this.resolveClick(picked));
  }

  private resolveClick(picked: unknown): ClickResult | null {
    if (!picked || typeof picked !== "object") return null;
    const id = (picked as { id?: unknown }).id;
    if (!(id instanceof Cesium.Entity)) return null;
    const name = id.name;
    if (!name || !name.startsWith(ENTITY_NAME_PREFIX)) return null;
    const mmsi = Number.parseInt(name.slice(ENTITY_NAME_PREFIX.length), 10);
    if (!Number.isFinite(mmsi)) return null;
    const entry = this.entries.get(mmsi);
    if (!entry || !entry.lastPos) return null;
    const sd = this.staticByMmsi.get(mmsi);
    const data: VesselSelectionData = {
      mmsi,
      name: sd?.name || `MMSI ${mmsi}`,
      type: sd?.type ?? 0,
      flag: sd?.flag ?? "",
      callsign: sd?.callsign ?? "",
      destination: sd?.destination ?? "",
      sog: entry.lastPos.sog,
      cog: entry.lastPos.cog,
    };
    return {
      selected: { type: "vessel", id: String(mmsi), data },
      fly: () => {
        let pos = entry.positionProperty.getValue(
          this.viewer.clock.currentTime,
        );
        if (!pos && entry.lastPos) {
          pos = Cesium.Cartesian3.fromDegrees(
            entry.lastPos.lon,
            entry.lastPos.lat,
            0,
          );
        }
        if (pos) {
          flyToInspect(this.viewer, pos, "vessel");
        } else {
          console.warn(
            "[CLICK FLY SKIP] type=vessel id=" + mmsi + " reason=no_position",
          );
        }
      },
    };
  }

  destroy(): void {
    if (this.pruneTimer != null) {
      window.clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    unregisterClickResolver("vessel");
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.unsubscribeSelection) {
      this.unsubscribeSelection();
      this.unsubscribeSelection = null;
    }
    this.trailedMmsi = null;
    if (!this.viewer.isDestroyed()) {
      for (const { entity } of this.entries.values()) {
        this.viewer.entities.remove(entity);
      }
    }
    this.entries.clear();
    this.staticByMmsi.clear();
    useStore.getState().setLayerCount("vessels", 0);
  }

  private syncTrail(
    selected: { type: "vessel"; id: string } | null,
  ): void {
    let newMmsi: number | null = null;
    if (selected) {
      const parsed = Number.parseInt(selected.id, 10);
      if (Number.isFinite(parsed)) newMmsi = parsed;
    }
    if (newMmsi === this.trailedMmsi) return;

    if (this.trailedMmsi != null) {
      const prev = this.entries.get(this.trailedMmsi);
      if (prev) prev.entity.path = undefined;
    }
    this.trailedMmsi = null;

    if (newMmsi != null) {
      const next = this.entries.get(newMmsi);
      if (next) {
        next.entity.path = makeVesselPath();
        this.trailedMmsi = newMmsi;
      }
    }
  }

  private onPosition(p: VesselPosition): void {
    if (this.viewer.isDestroyed()) return;

    // Teleport detector: AISStream very occasionally emits position
    // reports for an MMSI that jump implausible distances in seconds
    // (data corruption, MMSI collision, decoder error). Drop any
    // update that moves > 100 nm in < 60 s. First report for an MMSI
    // (no prior position) is never dropped.
    const prevEntry = this.entries.get(p.mmsi);
    if (prevEntry && prevEntry.lastPos) {
      const deltaS = (p.ts - prevEntry.lastSeen) / 1000;
      if (deltaS < TELEPORT_S_THRESHOLD) {
        const deltaNm = haversineNm(
          prevEntry.lastPos.lat,
          prevEntry.lastPos.lon,
          p.lat,
          p.lon,
        );
        if (deltaNm > TELEPORT_NM_THRESHOLD) {
          console.warn("[VESSEL TELEPORT DROP]", {
            mmsi: p.mmsi,
            prev_lat: prevEntry.lastPos.lat,
            prev_lon: prevEntry.lastPos.lon,
            new_lat: p.lat,
            new_lon: p.lon,
            delta_nm: deltaNm,
            delta_s: deltaS,
          });
          return;
        }
      }
    }

    const jd = Cesium.JulianDate.now();
    const futureJd = Cesium.JulianDate.addSeconds(
      jd,
      PREDICT_AHEAD_S,
      new Cesium.JulianDate(),
    );
    const position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0);
    const predicted = predictPosition(
      p.lat,
      p.lon,
      p.cog,
      p.sog,
      PREDICT_AHEAD_S,
    );
    const headingDeg = p.heading > 0 && p.heading < 360 ? p.heading : p.cog;
    const rotation = -Cesium.Math.toRadians(headingDeg);

    const existing = this.entries.get(p.mmsi);
    if (existing) {
      // UPDATE in place
      existing.positionProperty.addSample(jd, position);
      existing.positionProperty.addSample(futureJd, predicted);
      existing.rotationProperty.setValue(rotation);
      existing.entity.show = this.currentVisibility;
      existing.lastSeen = p.ts;
      existing.lastPos = p;
      return;
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
      name: `${ENTITY_NAME_PREFIX}${p.mmsi}`,
      position: positionProperty,
      show: this.currentVisibility,
      billboard: {
        image: VESSEL_ICON,
        width: 18,
        height: 18,
        rotation: rotationProperty,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.0e4, 1.6, 8.0e6, 0.5),
      },
    });

    this.entries.set(p.mmsi, {
      entity,
      positionProperty,
      rotationProperty,
      lastSeen: p.ts,
      lastPos: p,
    });
    useStore.getState().setLayerCount("vessels", this.entries.size);
  }

  private onStatic(s: VesselStatic): void {
    // Merge instead of overwrite: AISStreamClient emits a lightweight
    // staticData event for every PositionReport using MetaData.ShipName
    // alone, then a richer one when an actual ShipStaticData arrives.
    // Prefer non-empty / non-zero new values so a name-only update never
    // clobbers fields populated from a previous ShipStaticData.
    const existing = this.staticByMmsi.get(s.mmsi);
    if (!existing) {
      this.staticByMmsi.set(s.mmsi, s);
      return;
    }
    this.staticByMmsi.set(s.mmsi, {
      mmsi: s.mmsi,
      name: s.name || existing.name,
      type: s.type || existing.type,
      callsign: s.callsign || existing.callsign,
      destination: s.destination || existing.destination,
      flag: s.flag || existing.flag,
    });
  }

  private prune(): void {
    if (this.viewer.isDestroyed()) return;
    const cutoff = Date.now() - STALE_MS;
    let removed = 0;
    for (const [mmsi, entry] of this.entries) {
      if (entry.lastSeen < cutoff) {
        this.viewer.entities.remove(entry.entity);
        this.entries.delete(mmsi);
        removed++;
      }
    }
    if (removed > 0) {
      useStore.getState().setLayerCount("vessels", this.entries.size);
    }
  }
}

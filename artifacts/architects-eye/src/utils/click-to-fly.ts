import * as Cesium from "cesium";
import * as satellite from "satellite.js";
import { useStore, type SelectedEntity } from "../store";

const FLY_DURATION_S = 1.5;

export type FlyTargetType =
  | "satellite"
  | "aircraft"
  | "vessel"
  | "fire"
  | "quake";

interface FlyParams {
  pitchRad: number;
  rangeM: number;
}

const PARAMS: Record<FlyTargetType, FlyParams> = {
  // Satellites: shallower pitch + larger standoff so the sat stays
  // centered as the user scroll-zooms in along the camera axis.
  satellite: { pitchRad: Cesium.Math.toRadians(-20), rangeM: 80_000 },
  aircraft: { pitchRad: Cesium.Math.toRadians(-30), rangeM: 8_000 },
  vessel: { pitchRad: Cesium.Math.toRadians(-30), rangeM: 5_000 },
  fire: { pitchRad: Cesium.Math.toRadians(-45), rangeM: 10_000 },
  // Quakes: 30 km standoff per spec. Quakes don't move so no
  // predictive propagation is involved.
  quake: { pitchRad: Cesium.Math.toRadians(-45), rangeM: 30_000 },
};

interface SatellitePredictOpts {
  noradId: string;
  line1: string;
  line2: string;
}

interface FlyOpts {
  /** When type === "satellite", propagate forward by FLY_DURATION_S
   *  to land on the satellite's predicted future position. */
  predict?: SatellitePredictOpts;
}

export function isTheaterFlying(): boolean {
  return useStore.getState().isTheaterFlying;
}

// Module state for cancellation of in-flight fly's. Only one
// click-to-fly is allowed at a time; a new click cancels the prior.
let activeTempEntity: Cesium.Entity | null = null;
let activeViewer: Cesium.Viewer | null = null;

function cancelActiveFly(): void {
  if (activeViewer && !activeViewer.isDestroyed()) {
    // Cancels the underlying camera.flyToBoundingSphere animation.
    activeViewer.camera.cancelFlight();
    if (activeTempEntity) {
      activeViewer.entities.remove(activeTempEntity);
    }
  }
  activeTempEntity = null;
  activeViewer = null;
}

/**
 * Propagate a satellite forward by `aheadSeconds` from the viewer's
 * current clock and return the resulting Cartesian3, or null on any
 * SGP4 error. Logs [SAT FLY PREDICT FAIL] on failure.
 */
function predictSatellitePosition(
  viewer: Cesium.Viewer,
  opts: SatellitePredictOpts,
  aheadSeconds: number,
): Cesium.Cartesian3 | null {
  try {
    const rec = satellite.twoline2satrec(opts.line1, opts.line2);
    if (!rec || (rec as { error?: number }).error) {
      console.warn(
        "[SAT FLY PREDICT FAIL] norad=" + opts.noradId + " reason=satrec_error",
      );
      return null;
    }
    const future = Cesium.JulianDate.addSeconds(
      viewer.clock.currentTime,
      aheadSeconds,
      new Cesium.JulianDate(),
    );
    const date = Cesium.JulianDate.toDate(future);
    const pv = satellite.propagate(rec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean") {
      console.warn(
        "[SAT FLY PREDICT FAIL] norad=" +
          opts.noradId +
          " reason=propagate_no_position",
      );
      return null;
    }
    const gmst = satellite.gstime(date);
    const gd = satellite.eciToGeodetic(pv.position, gmst);
    return Cesium.Cartesian3.fromRadians(
      gd.longitude,
      gd.latitude,
      gd.height * 1000,
    );
  } catch (err) {
    console.warn(
      "[SAT FLY PREDICT FAIL] norad=" +
        opts.noradId +
        " reason=" +
        (err instanceof Error ? err.message : "exception"),
    );
    return null;
  }
}

/**
 * Fly the camera to an inspection vantage of the given world-space point.
 * Uses a temporary hidden Entity + viewer.flyTo so the camera controller
 * remains user-interruptible (drag/scroll cancels the fly cleanly).
 * Suppressed when a theater flythrough is in progress.
 *
 * For satellites, opts.predict enables forward propagation by 1.5s so
 * the camera arrives where the satellite WILL be, not where it WAS.
 */
export function flyToInspect(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian3,
  type: FlyTargetType,
  opts: FlyOpts = {},
): void {
  if (viewer.isDestroyed()) return;
  if (isTheaterFlying()) return;

  // Cancel any in-flight click-to-fly so a fresh click takes over cleanly.
  cancelActiveFly();

  // Resolve target. Satellites optionally use predicted position.
  let target = position;
  if (type === "satellite" && opts.predict) {
    const predicted = predictSatellitePosition(
      viewer,
      opts.predict,
      FLY_DURATION_S,
    );
    if (predicted) target = predicted;
  }

  const { pitchRad, rangeM } = PARAMS[type];

  const temp = viewer.entities.add({
    position: target,
    point: {
      pixelSize: 1,
      color: Cesium.Color.TRANSPARENT,
      show: false,
    },
  });
  activeTempEntity = temp;
  activeViewer = viewer;

  const cleanup = () => {
    if (!viewer.isDestroyed()) {
      viewer.entities.remove(temp);
    }
    if (activeTempEntity === temp) {
      activeTempEntity = null;
      activeViewer = null;
    }
  };

  viewer
    .flyTo(temp, {
      duration: FLY_DURATION_S,
      offset: new Cesium.HeadingPitchRange(0, pitchRad, rangeM),
    })
    .then(cleanup, cleanup);
  console.log("[FLY INVOKED]", type, "flyTo called with target:", target);
}

/**
 * Centralized per-type fly dispatcher. Computes the inspection
 * position purely from `entity.data` (independent of layer state)
 * and forwards to flyToInspect. Both the central click handler in
 * Viewer.tsx and the header SearchBox call this so fly behavior is
 * identical regardless of how an entity was selected.
 *
 * Returning silently is intentional for cable/airspace/fire
 * (cables/airspaces don't fly, fires use their own pipeline) and
 * for missing position data.
 */
export function flyToSelected(
  viewer: Cesium.Viewer | null,
  entity: SelectedEntity,
): void {
  console.log(
    "[FLY ENTRY]",
    entity.type,
    "data keys:",
    Object.keys(entity.data || {}),
  );
  console.log("[FLY THEATER GATE]", isTheaterFlying());
  console.log(
    "[FLY VIEWER]",
    "present:",
    !!viewer,
    "destroyed:",
    viewer ? viewer.isDestroyed() : "n/a",
  );
  if (!viewer || viewer.isDestroyed()) return;
  switch (entity.type) {
    case "aircraft": {
      const a = entity.data;
      if (a.lat == null || a.lon == null) {
        console.warn(
          "[FLY SKIP] type=aircraft id=" + entity.id + " reason=no_position",
        );
        return;
      }
      const altRaw = a.alt_baro;
      const altFt =
        typeof altRaw === "number"
          ? altRaw
          : typeof altRaw === "string"
            ? Number(altRaw) || 0
            : 0;
      const altM = Math.max(0, altFt * 0.3048);
      const pos = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, altM);
      console.log("[FLY BRANCH]", entity.type, "computed position:", pos);
      flyToInspect(viewer, pos, "aircraft");
      return;
    }
    case "vessel": {
      const v = entity.data;
      if (v.lat == null || v.lon == null) {
        console.warn(
          "[FLY SKIP] type=vessel id=" + entity.id + " reason=no_position",
        );
        return;
      }
      const pos = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 0);
      console.log("[FLY BRANCH]", entity.type, "computed position:", pos);
      flyToInspect(viewer, pos, "vessel");
      return;
    }
    case "satellite": {
      const m = entity.data;
      // Compute current sat position from TLE — independent of any
      // layer-side worker tick (which gates on visibility and might
      // not have run yet for a freshly-enabled satellites layer).
      // flyToInspect re-predicts to currentTime+1.5s via the predict
      // opts; this initial pos just seeds the temp entity.
      try {
        const rec = satellite.twoline2satrec(m.line1, m.line2);
        if (!rec || (rec as { error?: number }).error) {
          console.warn(
            "[FLY SKIP] type=satellite id=" +
              m.noradId +
              " reason=satrec_error",
          );
          return;
        }
        const date = Cesium.JulianDate.toDate(viewer.clock.currentTime);
        const pv = satellite.propagate(rec, date);
        if (!pv || !pv.position || typeof pv.position === "boolean") {
          console.warn(
            "[FLY SKIP] type=satellite id=" +
              m.noradId +
              " reason=propagate_no_position",
          );
          return;
        }
        const gmst = satellite.gstime(date);
        const gd = satellite.eciToGeodetic(pv.position, gmst);
        const pos = Cesium.Cartesian3.fromRadians(
          gd.longitude,
          gd.latitude,
          gd.height * 1000,
        );
        console.log("[FLY BRANCH]", entity.type, "computed position:", pos);
        flyToInspect(viewer, pos, "satellite", {
          predict: { noradId: m.noradId, line1: m.line1, line2: m.line2 },
        });
      } catch (err) {
        console.warn(
          "[FLY SKIP] type=satellite id=" +
            m.noradId +
            " reason=" +
            (err instanceof Error ? err.message : "exception"),
        );
      }
      return;
    }
    case "quake": {
      const q = entity.data;
      const pos = Cesium.Cartesian3.fromDegrees(
        q.lon,
        q.lat,
        -q.depth_km * 1000,
      );
      console.log("[FLY BRANCH]", entity.type, "computed position:", pos);
      flyToInspect(viewer, pos, "quake");
      return;
    }
    case "fire": {
      const f = entity.data;
      const pos = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0);
      console.log("[FLY BRANCH]", entity.type, "computed position:", pos);
      flyToInspect(viewer, pos, "fire");
      return;
    }
    // Cables and airspaces span thousands of km — no useful single
    // inspection vantage, so intentionally no-op here.
    case "cable":
    case "airspace":
      return;
  }
}

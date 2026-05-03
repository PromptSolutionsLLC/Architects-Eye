import * as Cesium from "cesium";
import { useStore } from "../store";

const FLY_DURATION_S = 1.5;

export type FlyTargetType = "satellite" | "aircraft" | "vessel" | "fire";

interface FlyParams {
  pitchRad: number;
  rangeM: number;
}

const PARAMS: Record<FlyTargetType, FlyParams> = {
  satellite: { pitchRad: -Math.PI / 4, rangeM: 50_000 },
  aircraft: { pitchRad: -Math.PI / 6, rangeM: 8_000 },
  vessel: { pitchRad: -Math.PI / 6, rangeM: 5_000 },
  fire: { pitchRad: -Math.PI / 4, rangeM: 10_000 },
};

export function isTheaterFlying(): boolean {
  return useStore.getState().isTheaterFlying;
}

/**
 * Fly the camera to an inspection vantage of the given world-space point.
 * Uses a temporary hidden Entity + viewer.flyTo so the camera controller
 * remains user-interruptible (drag/scroll cancels the fly cleanly).
 * Suppressed when a theater flythrough is in progress.
 */
export function flyToInspect(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian3,
  type: FlyTargetType,
): void {
  if (viewer.isDestroyed()) return;
  if (isTheaterFlying()) return;

  const { pitchRad, rangeM } = PARAMS[type];

  const temp = viewer.entities.add({
    position,
    point: {
      pixelSize: 1,
      color: Cesium.Color.TRANSPARENT,
      show: false,
    },
  });

  const cleanup = () => {
    if (!viewer.isDestroyed()) {
      viewer.entities.remove(temp);
    }
  };

  // viewer.flyTo returns a Promise<boolean> that resolves true on complete
  // and false on cancel (user input mid-flight). Some Cesium versions
  // reject on cancel, so guard with .catch.
  viewer
    .flyTo(temp, {
      duration: FLY_DURATION_S,
      offset: new Cesium.HeadingPitchRange(0, pitchRad, rangeM),
    })
    .then(cleanup, cleanup);
}

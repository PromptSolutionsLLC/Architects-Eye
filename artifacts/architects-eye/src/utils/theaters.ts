import * as Cesium from "cesium";
import { useStore, type LayerKey } from "../store";
import type { TheaterDef } from "../data/theaters";

export function flyToTheater(
  viewer: Cesium.Viewer,
  theater: TheaterDef,
): void {
  if (viewer.isDestroyed()) return;

  // Apply layer visibility per theater preset.
  const setLayerVisible = useStore.getState().setLayerVisible;
  for (const [key, value] of Object.entries(theater.layers)) {
    if (typeof value === "boolean") {
      setLayerVisible(key as LayerKey, value);
    }
  }

  // Mark theater fly window. Click-to-fly checks this and suppresses
  // entity flyTo's so the theater path is never interrupted by clicks.
  const setTheaterFlying = useStore.getState().setTheaterFlying;
  setTheaterFlying(true);

  // Fly the camera.
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      theater.camera.lon,
      theater.camera.lat,
      theater.camera.height,
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(theater.camera.pitch),
      roll: 0,
    },
    duration: theater.flyDuration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    complete: () => setTheaterFlying(false),
    cancel: () => setTheaterFlying(false),
  });

  // Fire toast.
  useStore.getState().showTheaterToast({
    name: theater.name,
    description: theater.description,
  });
}

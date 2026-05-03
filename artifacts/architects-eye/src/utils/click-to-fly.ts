import * as Cesium from "cesium";

const FLY_DURATION_S = 1.5;

let theaterBusyUntil = 0;

export function markTheaterFly(durationS: number): void {
  theaterBusyUntil = Date.now() + durationS * 1000;
}

export function isTheaterBusy(): boolean {
  return Date.now() < theaterBusyUntil;
}

export function flyToInspect(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian3,
  rangeM: number,
  pitchDeg: number = -45,
): void {
  if (viewer.isDestroyed()) return;
  if (isTheaterBusy()) return;
  viewer.camera.flyToBoundingSphere(
    new Cesium.BoundingSphere(position, 1),
    {
      duration: FLY_DURATION_S,
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(pitchDeg),
        rangeM,
      ),
    },
  );
}

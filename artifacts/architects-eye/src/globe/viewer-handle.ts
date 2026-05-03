import * as Cesium from "cesium";

let currentViewer: Cesium.Viewer | null = null;
const listeners = new Set<(v: Cesium.Viewer | null) => void>();

export function setViewer(viewer: Cesium.Viewer | null): void {
  currentViewer = viewer;
  for (const l of listeners) l(viewer);
}

export function getViewer(): Cesium.Viewer | null {
  return currentViewer;
}

export function subscribeViewer(
  cb: (v: Cesium.Viewer | null) => void,
): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

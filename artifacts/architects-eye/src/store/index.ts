import { create } from "zustand";
import type { Aircraft } from "../utils/api";

export interface SelectedEntity {
  type: "aircraft";
  id: string;
  data: Aircraft;
}

export interface Viewport {
  lat: number;
  lon: number;
  distNm: number;
}

export type LayerKey =
  | "aircraft"
  | "vessels"
  | "satellites"
  | "jamming"
  | "fires"
  | "quakes";

export type LayerVisibility = Record<LayerKey, boolean>;

export type LayerCounts = Record<LayerKey, number>;

interface AppStore {
  selectedEntity: SelectedEntity | null;
  setSelectedEntity: (e: SelectedEntity | null) => void;

  viewport: Viewport;
  setViewport: (v: Viewport) => void;

  layerVisibility: LayerVisibility;
  setLayerVisible: (layer: LayerKey, visible: boolean) => void;

  layerCounts: LayerCounts;
  setLayerCount: (layer: LayerKey, count: number) => void;

  timeOffsetMs: number;
  setTimeOffsetMs: (ms: number) => void;
}

export const useStore = create<AppStore>((set) => ({
  selectedEntity: null,
  setSelectedEntity: (e) => set({ selectedEntity: e }),

  viewport: { lat: 41.5, lon: -72.7, distNm: 250 },
  setViewport: (v) => set({ viewport: v }),

  layerVisibility: {
    aircraft: true,
    vessels: false,
    satellites: false,
    jamming: false,
    fires: false,
    quakes: false,
  },
  setLayerVisible: (layer, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layer]: visible },
    })),

  layerCounts: {
    aircraft: 0,
    vessels: 0,
    satellites: 0,
    jamming: 0,
    fires: 0,
    quakes: 0,
  },
  setLayerCount: (layer, count) =>
    set((state) => ({
      layerCounts: { ...state.layerCounts, [layer]: count },
    })),

  timeOffsetMs: 0,
  setTimeOffsetMs: (ms) => set({ timeOffsetMs: ms }),
}));

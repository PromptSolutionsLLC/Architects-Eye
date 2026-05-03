import { create } from "zustand";
import type { Aircraft } from "../utils/api";
import type { SatelliteMeta } from "../utils/tle";
import type { VesselSelectionData } from "../layers/VesselLayer";
import type { BBox } from "../ws/aisstream-client";
import type { RestrictedAirspaceZone } from "../data/restricted-airspace";

export type SelectedEntity =
  | { type: "aircraft"; id: string; data: Aircraft }
  | { type: "satellite"; id: string; data: SatelliteMeta }
  | { type: "vessel"; id: string; data: VesselSelectionData }
  | { type: "airspace"; id: string; data: RestrictedAirspaceZone };

export interface Viewport {
  lat: number;
  lon: number;
  distNm: number;
  bbox: BBox | null;
}

export type LayerKey =
  | "aircraft"
  | "vessels"
  | "satellites"
  | "jamming"
  | "restrictedAirspace"
  | "fires"
  | "quakes";

export type LayerVisibility = Record<LayerKey, boolean>;

export type LayerCounts = Record<LayerKey, number>;

export interface TheaterToast {
  name: string;
  description: string;
  // Monotonic id so consumers can re-trigger animations on the same name.
  triggerId: number;
}

interface AppStore {
  selectedEntity: SelectedEntity | null;
  setSelectedEntity: (e: SelectedEntity | null) => void;

  viewport: Viewport;
  setViewport: (v: Viewport) => void;

  layerVisibility: LayerVisibility;
  setLayerVisible: (layer: LayerKey, visible: boolean) => void;

  layerAvailability: Record<LayerKey, boolean>;
  setLayerAvailable: (layer: LayerKey, available: boolean) => void;

  layerCounts: LayerCounts;
  setLayerCount: (layer: LayerKey, count: number) => void;

  timeOffsetMs: number;
  setTimeOffsetMs: (ms: number) => void;

  theaterToast: TheaterToast | null;
  showTheaterToast: (t: { name: string; description: string }) => void;
  clearTheaterToast: () => void;
}

let toastCounter = 0;

export const useStore = create<AppStore>((set) => ({
  selectedEntity: null,
  setSelectedEntity: (e) => set({ selectedEntity: e }),

  viewport: { lat: 41.5, lon: -72.7, distNm: 250, bbox: null },
  setViewport: (v) => set({ viewport: v }),

  layerVisibility: {
    aircraft: true,
    vessels: true,
    satellites: true,
    jamming: false,
    restrictedAirspace: true,
    fires: false,
    quakes: false,
  },
  setLayerVisible: (layer, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layer]: visible },
    })),

  layerAvailability: {
    aircraft: true,
    vessels: true,
    satellites: true,
    jamming: true,
    restrictedAirspace: true,
    fires: false,
    quakes: false,
  },
  setLayerAvailable: (layer, available) =>
    set((state) => ({
      layerAvailability: { ...state.layerAvailability, [layer]: available },
    })),

  layerCounts: {
    aircraft: 0,
    vessels: 0,
    satellites: 0,
    jamming: 0,
    restrictedAirspace: 0,
    fires: 0,
    quakes: 0,
  },
  setLayerCount: (layer, count) =>
    set((state) => ({
      layerCounts: { ...state.layerCounts, [layer]: count },
    })),

  timeOffsetMs: 0,
  setTimeOffsetMs: (ms) => set({ timeOffsetMs: ms }),

  theaterToast: null,
  showTheaterToast: ({ name, description }) =>
    set({
      theaterToast: { name, description, triggerId: ++toastCounter },
    }),
  clearTheaterToast: () => set({ theaterToast: null }),
}));

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

interface AppStore {
  selectedEntity: SelectedEntity | null;
  setSelectedEntity: (e: SelectedEntity | null) => void;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
}

export const useStore = create<AppStore>((set) => ({
  selectedEntity: null,
  setSelectedEntity: (e) => set({ selectedEntity: e }),
  viewport: { lat: 41.5, lon: -72.7, distNm: 250 },
  setViewport: (v) => set({ viewport: v }),
}));

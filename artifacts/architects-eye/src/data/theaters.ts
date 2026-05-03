import type { LayerKey } from "../store";

export interface TheaterDef {
  id: string;
  name: string;
  description: string;
  camera: { lon: number; lat: number; height: number; pitch: number };
  layers: Partial<Record<LayerKey, boolean>>;
  flyDuration: number;
}

export const THEATERS: TheaterDef[] = [
  {
    id: "hormuz",
    name: "Strait of Hormuz",
    description:
      "Maritime chokepoint, GPS jamming overlay, Iranian airspace.",
    camera: { lon: 56.5, lat: 26.5, height: 350_000, pitch: -35 },
    layers: {
      aircraft: true,
      vessels: true,
      satellites: false,
      jamming: true,
      restrictedAirspace: true,
      fires: false,
    },
    flyDuration: 4.5,
  },
  {
    id: "black-sea",
    name: "Black Sea",
    description:
      "Russia–Ukraine maritime corridor, dense GPS jamming.",
    camera: { lon: 35.0, lat: 44.0, height: 700_000, pitch: -40 },
    layers: {
      aircraft: true,
      vessels: true,
      satellites: false,
      jamming: true,
      restrictedAirspace: true,
      fires: false,
    },
    flyDuration: 4.5,
  },
  {
    id: "natlantic",
    name: "North Atlantic Tracks",
    description:
      "Transatlantic flight corridor — busiest oceanic airspace on Earth.",
    camera: { lon: -40.0, lat: 50.0, height: 2_500_000, pitch: -50 },
    layers: {
      aircraft: true,
      vessels: false,
      satellites: false,
      jamming: false,
      restrictedAirspace: false,
      fires: false,
    },
    flyDuration: 4.5,
  },
  {
    id: "dmz",
    name: "Korean DMZ",
    description: "Demilitarized zone, NK ADIZ overlay.",
    camera: { lon: 127.5, lat: 38.2, height: 280_000, pitch: -35 },
    layers: {
      aircraft: true,
      vessels: true,
      satellites: false,
      jamming: false,
      restrictedAirspace: true,
      fires: false,
    },
    flyDuration: 4.5,
  },
  {
    id: "california",
    name: "California Wildfire Belt",
    description: "Wildfire activity, airspace, seismic.",
    camera: { lon: -120.0, lat: 38.0, height: 600_000, pitch: -40 },
    layers: {
      aircraft: true,
      vessels: false,
      satellites: false,
      jamming: false,
      restrictedAirspace: false,
      fires: true,
    },
    flyDuration: 4.5,
  },
  {
    id: "russia-ukraine",
    name: "Russia / Ukraine",
    description:
      "Active conflict region — closed airspace, GPS jamming, vessel traffic.",
    camera: { lon: 36.0, lat: 49.0, height: 1_500_000, pitch: -45 },
    layers: {
      aircraft: true,
      vessels: true,
      satellites: false,
      jamming: true,
      restrictedAirspace: true,
      fires: false,
    },
    flyDuration: 4.5,
  },
];

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
    camera: { lon: 56.0, lat: 25.5, height: 600_000, pitch: -55 },
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
    camera: { lon: 35.0, lat: 43.0, height: 1_200_000, pitch: -55 },
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
    // Frame the central NAT corridor between Newfoundland and Ireland
    // at ~1500km — close enough that individual aircraft become visible
    // (the previous 3500km / -40°,50° framing was just empty ocean).
    camera: { lon: -45.0, lat: 52.0, height: 1_500_000, pitch: -50 },
    layers: {
      aircraft: true,
      // Vessels and submarine cables are dense in the North Atlantic
      // and give the camera a visible payoff over open water.
      vessels: true,
      submarineCables: true,
      satellites: false,
      jamming: false,
      // NAT entry/exit points are wrapped in restricted oceanic airspace.
      restrictedAirspace: true,
      fires: false,
    },
    flyDuration: 4.5,
  },
  {
    id: "dmz",
    name: "Korean DMZ",
    description: "Demilitarized zone, NK ADIZ overlay.",
    camera: { lon: 127.5, lat: 38.0, height: 500_000, pitch: -55 },
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
    camera: { lon: -120.0, lat: 37.5, height: 1_000_000, pitch: -55 },
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
    camera: { lon: 36.0, lat: 48.5, height: 2_000_000, pitch: -55 },
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

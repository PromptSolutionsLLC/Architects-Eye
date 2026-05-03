import * as Cesium from "cesium";
import { useStore } from "../store";
import {
  registerClickResolver,
  unregisterClickResolver,
  type ClickResult,
} from "../utils/pick-resolvers";
import {
  registerSearchProvider,
  unregisterSearchProvider,
  scoreMatch,
  type SearchResult,
} from "../utils/search-registry";

const CABLES_URL = "/data/submarine-cables.geojson";
const DEFAULT_COLOR = "#5eead4";

export interface CableMeta {
  id: string;
  name: string;
  color: string;
}

interface CableFeatureProps {
  id?: string;
  name?: string;
  color?: string;
}

interface CableFeature {
  type: "Feature";
  properties: CableFeatureProps;
  geometry: {
    type: "MultiLineString";
    coordinates: number[][][];
  };
}

interface CableFeatureCollection {
  type: "FeatureCollection";
  features: CableFeature[];
}

export class SubmarineCablesLayer {
  private viewer: Cesium.Viewer;
  private collection: Cesium.PolylineCollection | null = null;
  private polylineToCable: Map<Cesium.Polyline, CableMeta> = new Map();
  // Deduped meta-by-search-id (id || name). Source-of-truth for search.
  // Cables can have many polylines per feature, so this collapses them.
  private cablesBySearchId: Map<string, CableMeta> = new Map();
  private unsubscribeStore: (() => void) | null = null;
  private currentVisibility = false;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  async mount(): Promise<void> {
    this.currentVisibility =
      useStore.getState().layerVisibility.submarineCables;

    const collection = new Cesium.PolylineCollection();
    collection.show = this.currentVisibility;
    this.viewer.scene.primitives.add(collection);
    if (this.viewer.isDestroyed()) {
      this.destroy();
      return;
    }
    this.collection = collection;

    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.submarineCables;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        if (this.collection) this.collection.show = next;
      }
    });

    registerClickResolver("cable", (picked) => this.resolveClick(picked));
    registerSearchProvider("cable", {
      search: (q) => this.search(q),
      getClickResultById: (id) => {
        const meta = this.cablesBySearchId.get(id);
        if (!meta) return null;
        return { selected: { type: "cable", id: meta.id, data: meta } };
      },
    });

    try {
      const res = await fetch(CABLES_URL);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as CableFeatureCollection;
      if (this.destroyed || !this.collection) return;
      this.ingest(data);
      useStore
        .getState()
        .setLayerCount("submarineCables", data.features.length);
      useStore.getState().setLayerAvailable("submarineCables", true);
    } catch (err) {
      console.error("[CABLES] failed to load submarine cables:", err);
      useStore.getState().setLayerAvailable("submarineCables", false);
    }
  }

  private ingest(data: CableFeatureCollection): void {
    if (!this.collection) return;
    for (const feature of data.features) {
      const props = feature.properties ?? {};
      const meta: CableMeta = {
        id: props.id ?? "",
        name: props.name ?? "Unknown cable",
        color: props.color ?? DEFAULT_COLOR,
      };
      // Stable dedup key: prefer real id, fall back to name. Cables
      // share one meta across all sub-polylines of the feature.
      const searchId = meta.id || meta.name;
      if (searchId && !this.cablesBySearchId.has(searchId)) {
        this.cablesBySearchId.set(searchId, meta);
      }
      const cesiumColor = Cesium.Color.fromCssColorString(meta.color);
      const material = Cesium.Material.fromType("PolylineGlow", {
        color: cesiumColor,
        glowPower: 0.25,
        taperPower: 1.0,
      });
      for (const sub of feature.geometry.coordinates) {
        if (!sub || sub.length < 2) continue;
        const flat: number[] = [];
        for (const [lon, lat] of sub) {
          flat.push(lon, lat);
        }
        const polyline = this.collection.add({
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: 2.5,
          material,
        });
        this.polylineToCable.set(polyline, meta);
      }
    }
  }

  private resolveClick(picked: unknown): ClickResult | null {
    if (!this.currentVisibility) return null;
    if (!picked || typeof picked !== "object") return null;
    const primitive = (picked as { primitive?: unknown }).primitive;
    if (!(primitive instanceof Cesium.Polyline)) return null;
    const meta = this.polylineToCable.get(primitive);
    if (!meta) return null;
    // No fly: cables span thousands of km — clicking opens EntityPanel only.
    return {
      selected: { type: "cable", id: meta.id, data: meta },
    };
  }

  private search(q: string): SearchResult[] {
    // Search ignores layer visibility — the SearchBox auto-enables the
    // layer on selection so a user can find e.g. "MAREA" even when the
    // submarineCables toggle is off.
    const out: SearchResult[] = [];
    for (const [searchId, meta] of this.cablesBySearchId) {
      const ns = scoreMatch(meta.name, q);
      const is = scoreMatch(searchId, q);
      const score = ns >= 0 && is >= 0 ? Math.min(ns, is) : Math.max(ns, is);
      if (score < 0) continue;
      out.push({
        type: "cable",
        id: searchId,
        label: meta.name,
        sublabel: "CABLE · " + searchId,
        score,
      });
    }
    return out;
  }

  destroy(): void {
    this.destroyed = true;
    unregisterClickResolver("cable");
    unregisterSearchProvider("cable");
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.collection && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection);
    }
    this.collection = null;
    this.polylineToCable.clear();
    this.cablesBySearchId.clear();
    useStore.getState().setLayerCount("submarineCables", 0);
  }
}

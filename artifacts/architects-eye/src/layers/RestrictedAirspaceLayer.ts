import * as Cesium from "cesium";
import { useStore } from "../store";
import {
  RESTRICTED_AIRSPACE,
  type RestrictedAirspaceZone,
} from "../data/restricted-airspace";
import {
  registerClickResolver,
  unregisterClickResolver,
  type ClickResult,
} from "../utils/pick-resolvers";

interface PickIdPayload {
  layer: "restrictedAirspace";
  zoneId: string;
}

export class RestrictedAirspaceLayer {
  private viewer: Cesium.Viewer;
  private dataSource: Cesium.CustomDataSource | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private currentVisibility = true;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  async mount(): Promise<void> {
    this.currentVisibility =
      useStore.getState().layerVisibility.restrictedAirspace;

    const ds = new Cesium.CustomDataSource("restrictedAirspace");
    ds.show = this.currentVisibility;
    await this.viewer.dataSources.add(ds);
    if (this.viewer.isDestroyed()) {
      this.destroy();
      return;
    }
    this.dataSource = ds;

    this.unsubscribeStore = useStore.subscribe((state) => {
      const next = state.layerVisibility.restrictedAirspace;
      if (next !== this.currentVisibility) {
        this.currentVisibility = next;
        if (this.dataSource) this.dataSource.show = next;
      }
    });

    for (const zone of RESTRICTED_AIRSPACE) {
      this.addZone(zone);
    }

    useStore
      .getState()
      .setLayerCount("restrictedAirspace", RESTRICTED_AIRSPACE.length);

    registerClickResolver("airspace", (picked) => this.resolveClick(picked));
  }

  private resolveClick(picked: unknown): ClickResult | null {
    if (!this.currentVisibility) return null;
    if (!picked || typeof picked !== "object") return null;
    const entity = (picked as { id?: unknown }).id;
    if (!(entity instanceof Cesium.Entity)) return null;
    const props = entity.properties;
    if (!props) return null;
    const v = props.getValue(Cesium.JulianDate.now()) as
      | Partial<PickIdPayload>
      | undefined;
    if (!v || v.layer !== "restrictedAirspace") return null;
    const zone = RESTRICTED_AIRSPACE.find((z) => z.id === v.zoneId);
    if (!zone) return null;
    // No fly: airspace zones span huge regions; clicking just opens the
    // EntityPanel with zone metadata.
    return {
      selected: { type: "airspace", id: zone.id, data: zone },
    };
  }

  private addZone(zone: RestrictedAirspaceZone): void {
    if (!this.dataSource) return;
    const positions = Cesium.Cartesian3.fromDegreesArray(zone.coords);
    if (positions.length < 3) return;

    const color = Cesium.Color.fromCssColorString(zone.color);
    const pickPayload: PickIdPayload = {
      layer: "restrictedAirspace",
      zoneId: zone.id,
    };

    // Subtle translucent fill for visual presence at zoom-out.
    this.dataSource.entities.add({
      name: zone.name,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: color.withAlpha(0.05),
        outline: false,
        height: 0,
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
      properties: pickPayload,
    });

    // Closed dashed outline (polyline, not polygon outline — clamps to ground).
    const closed = positions.concat([positions[0]]);
    this.dataSource.entities.add({
      name: zone.name,
      polyline: {
        positions: closed,
        width: 3,
        clampToGround: true,
        material: new Cesium.PolylineDashMaterialProperty({
          color,
          dashLength: 16,
          dashPattern: 0xff00,
        }),
      },
      properties: pickPayload,
    });
  }

  destroy(): void {
    unregisterClickResolver("airspace");
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.dataSource && !this.viewer.isDestroyed()) {
      this.viewer.dataSources.remove(this.dataSource, true);
    }
    this.dataSource = null;
    useStore.getState().setLayerCount("restrictedAirspace", 0);
  }
}

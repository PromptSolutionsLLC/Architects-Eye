import * as Cesium from "cesium";
import { useStore } from "../store";
import {
  RESTRICTED_AIRSPACE,
  type RestrictedAirspaceZone,
} from "../data/restricted-airspace";

interface PickIdPayload {
  layer: "restrictedAirspace";
  zoneId: string;
}

export class RestrictedAirspaceLayer {
  private viewer: Cesium.Viewer;
  private dataSource: Cesium.CustomDataSource | null = null;
  private handler: Cesium.ScreenSpaceEventHandler | null = null;
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

    // Click handler — picks any entity belonging to this layer
    this.handler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    );
    this.handler.setInputAction(
      (event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        if (!this.currentVisibility) return;
        const picked = this.viewer.scene.pick(event.position);
        if (!Cesium.defined(picked)) return;
        const entity = picked.id;
        if (!(entity instanceof Cesium.Entity)) return;
        const props = entity.properties;
        if (!props) return;
        const layerProp = props.getValue(Cesium.JulianDate.now())?.layer;
        if (layerProp !== "restrictedAirspace") return;
        const zoneId = props.getValue(Cesium.JulianDate.now())?.zoneId;
        const zone = RESTRICTED_AIRSPACE.find((z) => z.id === zoneId);
        if (!zone) return;
        useStore.getState().setSelectedEntity({
          type: "airspace",
          id: zone.id,
          data: zone,
        });
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
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
    if (this.handler) {
      this.handler.destroy();
      this.handler = null;
    }
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

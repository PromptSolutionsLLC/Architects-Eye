import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { AircraftLayer } from "../layers/AircraftLayer";
import { SatelliteLayer } from "../layers/SatelliteLayer";
import { VesselLayer } from "../layers/VesselLayer";
import { JammingLayer } from "../layers/JammingLayer";
import { RestrictedAirspaceLayer } from "../layers/RestrictedAirspaceLayer";
import { SubmarineCablesLayer } from "../layers/SubmarineCablesLayer";
import { FiresLayer } from "../layers/FiresLayer";
import { QuakesLayer } from "../layers/QuakesLayer";
import { AISStreamClient } from "../ws/aisstream-client";
import { useStore } from "../store";
import { setViewer } from "./viewer-handle";
import { resolveClick, resolveHover } from "../utils/pick-resolvers";
import { flyToSelected } from "../utils/click-to-fly";

interface JammingTooltip {
  hex: string;
  intensity: number;
  x: number;
  y: number;
}

export default function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const layerRef = useRef<AircraftLayer | null>(null);
  const satelliteLayerRef = useRef<SatelliteLayer | null>(null);
  const vesselLayerRef = useRef<VesselLayer | null>(null);
  const jammingLayerRef = useRef<JammingLayer | null>(null);
  const restrictedAirspaceLayerRef = useRef<RestrictedAirspaceLayer | null>(
    null,
  );
  const submarineCablesLayerRef = useRef<SubmarineCablesLayer | null>(null);
  const firesLayerRef = useRef<FiresLayer | null>(null);
  const quakesLayerRef = useRef<QuakesLayer | null>(null);
  const aisClientRef = useRef<AISStreamClient | null>(null);
  const centralHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jammingTooltip, setJammingTooltip] = useState<JammingTooltip | null>(
    null,
  );

  // Clear stale jamming tooltip the instant the layer is toggled off
  // (without waiting for the next MOUSE_MOVE). Selecting the boolean
  // directly keeps re-renders confined to visibility flips.
  const jammingVisible = useStore((s) => s.layerVisibility.jamming);
  useEffect(() => {
    if (!jammingVisible) setJammingTooltip(null);
  }, [jammingVisible]);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    try {
      Cesium.Ion.defaultAccessToken =
        import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

      const viewer = new Cesium.Viewer(containerRef.current, {
        timeline: false,
        animation: false,
        fullscreenButton: false,
        homeButton: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        geocoder: false,
        baseLayerPicker: false,
        infoBox: false,
        selectionIndicator: false,
        requestRenderMode: false,
        contextOptions: {
          webgl: {
            alpha: false,
            antialias: true,
            preserveDrawingBuffer: false,
            failIfMajorPerformanceCaveat: false,
          },
        },
      });

      viewerRef.current = viewer;
      setViewer(viewer);

      // Defensive: Cesium auto-sets trackedEntity when an entity is selected,
      // which locks the camera onto the entity and disables mouse controls.
      // We render trails via PathGraphics and never want camera-tracking, so
      // clear it on every pre-render. Cheap and bulletproof against any
      // code path (Cesium internals, double-click, future code) that tries
      // to set it.
      viewer.trackedEntity = undefined;
      const clearTracked = () => {
        if (viewer.trackedEntity) viewer.trackedEntity = undefined;
      };
      viewer.scene.preUpdate.addEventListener(clearTracked);

      // Google Photoreal 3D Tiles are the world surface — the underlying
      // Cesium ellipsoid globe must not render or it produces a seam where
      // the photoreal mesh hasn't yet covered the view (blue ellipsoid
      // bleeds through next to loaded photoreal terrain).
      viewer.scene.globe.show = false;
      // Likewise, drop the default Bing imagery layer so nothing competes
      // with the Photoreal tileset for the world surface.
      viewer.imageryLayers.removeAll();
      viewer.scene.skyAtmosphere.show = false;

      // Real-time clock for SampledPositionProperty interpolation
      viewer.clock.currentTime = Cesium.JulianDate.now();
      viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
      viewer.clock.shouldAnimate = true;
      viewer.clock.multiplier = 1.0;

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-72.7, 41.5, 2_000_000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 0,
      });

      // Camera moveEnd → update store viewport (debounced 500 ms)
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      viewer.camera.moveEnd.addEventListener(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
          const cart = viewerRef.current.camera.positionCartographic;
          const lat = Cesium.Math.toDegrees(cart.latitude);
          const lon = Cesium.Math.toDegrees(cart.longitude);
          const heightKm = cart.height / 1000;
          // 250 nm at 2000 km altitude; clamp 50–500 nm
          const distNm = Math.max(
            50,
            Math.min(500, Math.round(heightKm * 0.125)),
          );
          // BBox from camera view rectangle (for AIS subscription)
          const rect = viewerRef.current.camera.computeViewRectangle();
          const bbox = rect
            ? {
                swLat: Cesium.Math.toDegrees(rect.south),
                swLon: Cesium.Math.toDegrees(rect.west),
                neLat: Cesium.Math.toDegrees(rect.north),
                neLon: Cesium.Math.toDegrees(rect.east),
              }
            : null;
          useStore.getState().setViewport({ lat, lon, distNm, bbox });
        }, 500);
      });

      viewer.creditDisplay.addStaticCredit(
        new Cesium.Credit(
          '<a href="https://maps.google.com" target="_blank" rel="noreferrer">Map data ©2024 Google</a>',
          true,
        ),
      );

      // Google Photorealistic 3D Tiles
      (async () => {
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset({
            apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "",
            onlyUsingWithGoogleGeocoder: true,
          });
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.scene.primitives.add(tileset);
            // Disable dynamic SSE — slightly fewer tile requests, no
            // visible quality impact for our use case (theaters use
            // top-down / near-vertical angles where dynamic SSE doesn't
            // help). Default maximumScreenSpaceError (16) retained.
            tileset.dynamicScreenSpaceError = false;
          }
        } catch (err) {
          console.error("Failed to load Google Photorealistic 3D Tiles:", err);
        }
      })();

      // Aircraft layer
      const layer = new AircraftLayer(viewer);
      layerRef.current = layer;
      layer.mount();

      // Satellite layer (TLE fetch + SGP4 worker)
      const satLayer = new SatelliteLayer(viewer);
      satelliteLayerRef.current = satLayer;
      void satLayer.mount();

      // AIS WebSocket client + Vessel layer
      const aisClient = new AISStreamClient();
      aisClientRef.current = aisClient;
      aisClient.onPermanentFailure(() => {
        console.warn(
          "[AIS] WebSocket permanently failed — hiding vessels toggle",
        );
        useStore.getState().setLayerAvailable("vessels", false);
      });
      const vesselLayer = new VesselLayer(viewer, aisClient);
      vesselLayerRef.current = vesselLayer;
      vesselLayer.mount();
      aisClient.connect();

      // Jamming layer (static H3 hex CSV)
      const jammingLayer = new JammingLayer(viewer);
      jammingLayerRef.current = jammingLayer;
      void jammingLayer.mount();

      // Restricted airspace overlay (static polygons)
      const restrictedAirspaceLayer = new RestrictedAirspaceLayer(viewer);
      restrictedAirspaceLayerRef.current = restrictedAirspaceLayer;
      void restrictedAirspaceLayer.mount();

      // Submarine fiber-optic cable network (static GeoJSON)
      const submarineCablesLayer = new SubmarineCablesLayer(viewer);
      submarineCablesLayerRef.current = submarineCablesLayer;
      void submarineCablesLayer.mount();

      // FIRMS wildfire layer (live VIIRS, MODIS fallback)
      const firesLayer = new FiresLayer(viewer);
      firesLayerRef.current = firesLayer;
      void firesLayer.mount();

      // USGS earthquake layer (M4.5+ past 7 days, off by default)
      const quakesLayer = new QuakesLayer(viewer);
      quakesLayerRef.current = quakesLayer;
      void quakesLayer.mount();

      // ── Central pick handlers ─────────────────────────────────────
      // ONE LEFT_CLICK / MOUSE_MOVE handler shared by all layers.
      // Layers register resolvers via pick-resolvers.ts; we run a
      // single viewer.scene.pick() per event and dispatch to whichever
      // resolver claims the picked object (priority: airspace → fire
      // → satellite → aircraft → vessel for clicks; jamming for hover).
      const ssh = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      centralHandlerRef.current = ssh;

      ssh.setInputAction(
        (event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
          if (viewer.isDestroyed()) return;
          const picked = viewer.scene.pick(event.position);
          const result = Cesium.defined(picked) ? resolveClick(picked) : null;
          // Click on empty space is a no-op — cards are dismissed only
          // via their own × button, never by clicking elsewhere.
          if (!result) return;
          // Card-first ordering: open (or dedup-skip) the card before
          // dispatching fly. replaceUnpinnedCards returns false when the
          // entity already lives in a pinned card, in which case we also
          // suppress the camera fly (treat as a redundant click).
          const opened = useStore
            .getState()
            .replaceUnpinnedCards(result.selected);
          if (opened) {
            // Centralized fly wrapper — same path as the header search
            // box. Per-type dispatch lives in click-to-fly.ts so both
            // selection surfaces share identical fly behavior.
            flyToSelected(viewer, result.selected);
          }
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );

      ssh.setInputAction(
        (event: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
          if (viewer.isDestroyed()) return;
          const picked = viewer.scene.pick(event.endPosition);
          const hover = Cesium.defined(picked) ? resolveHover(picked) : null;
          if (hover) {
            setJammingTooltip({
              hex: hover.hex,
              intensity: hover.intensity,
              x: event.endPosition.x,
              y: event.endPosition.y,
            });
          } else {
            setJammingTooltip(null);
          }
        },
        Cesium.ScreenSpaceEventType.MOUSE_MOVE,
      );
    } catch (err) {
      console.error("Cesium Viewer initialization failed:", err);
      setError(
        err instanceof Error ? err.message : "WebGL initialization failed.",
      );
    }

    return () => {
      if (centralHandlerRef.current) {
        centralHandlerRef.current.destroy();
        centralHandlerRef.current = null;
      }
      quakesLayerRef.current?.destroy();
      quakesLayerRef.current = null;
      firesLayerRef.current?.destroy();
      firesLayerRef.current = null;
      submarineCablesLayerRef.current?.destroy();
      submarineCablesLayerRef.current = null;
      restrictedAirspaceLayerRef.current?.destroy();
      restrictedAirspaceLayerRef.current = null;
      jammingLayerRef.current?.destroy();
      jammingLayerRef.current = null;
      vesselLayerRef.current?.destroy();
      vesselLayerRef.current = null;
      aisClientRef.current?.destroy();
      aisClientRef.current = null;
      satelliteLayerRef.current?.destroy();
      satelliteLayerRef.current = null;
      layerRef.current?.destroy();
      layerRef.current = null;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
      setViewer(null);
    };
  }, []);

  if (error) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#ff4444",
          fontFamily: "monospace",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: "0.85rem", letterSpacing: "0.1em" }}>
          CESIUM :: WEBGL INITIALIZATION FAILED
        </span>
        <span style={{ fontSize: "0.7rem", color: "#888", maxWidth: "480px" }}>
          {error}
        </span>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
      />
      {jammingTooltip && (
        <div
          style={{
            position: "absolute",
            // Anchor: top-left corner of tooltip sits 12 px to the
            // right and below the cursor.
            left: jammingTooltip.x + 12,
            top: jammingTooltip.y + 12,
            background: "#0a0a0a",
            border: "1px solid #fbbf24",
            color: "#fef3c7",
            padding: "6px 10px",
            font: "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            lineHeight: 1.4,
            pointerEvents: "none",
            zIndex: 1000,
            whiteSpace: "nowrap",
          }}
        >
          <div>H3 INDEX: {jammingTooltip.hex}</div>
          <div>INTENSITY: {jammingTooltip.intensity.toFixed(2)}</div>
          <div>SOURCE: GPSJam.org · 2026-05-01</div>
        </div>
      )}
    </div>
  );
}

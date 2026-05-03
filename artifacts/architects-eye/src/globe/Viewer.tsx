import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { AircraftLayer } from "../layers/AircraftLayer";
import { SatelliteLayer } from "../layers/SatelliteLayer";
import { VesselLayer } from "../layers/VesselLayer";
import { JammingLayer } from "../layers/JammingLayer";
import { RestrictedAirspaceLayer } from "../layers/RestrictedAirspaceLayer";
import { AISStreamClient } from "../ws/aisstream-client";
import { useStore } from "../store";
import { setViewer } from "./viewer-handle";

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
  const aisClientRef = useRef<AISStreamClient | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      viewer.scene.globe.enableLighting = true;
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

      // [DIAGNOSTIC] Show on-screen FPS widget
      viewer.scene.debugShowFramesPerSecond = true;

      // [DIAGNOSTIC] Manual FPS counter via postRender
      let frames = 0;
      let fpsWindowStart = performance.now();
      let lastFps = 0;
      viewer.scene.postRender.addEventListener(() => {
        frames++;
        const now = performance.now();
        if (now - fpsWindowStart >= 1000) {
          lastFps = Math.round((frames * 1000) / (now - fpsWindowStart));
          frames = 0;
          fpsWindowStart = now;
        }
      });

      // Google Photorealistic 3D Tiles
      (async () => {
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset({
            apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "",
            onlyUsingWithGoogleGeocoder: true,
          });
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.scene.primitives.add(tileset);

            // [DIAGNOSTIC] Tileset config dump
            const t = tileset as unknown as Record<string, unknown>;
            console.log("[TILESET CONFIG]", {
              maximumScreenSpaceError: t.maximumScreenSpaceError,
              maximumMemoryUsage: t.maximumMemoryUsage,
              cacheBytes: t.cacheBytes,
              dynamicScreenSpaceError: t.dynamicScreenSpaceError,
              dynamicScreenSpaceErrorDensity: t.dynamicScreenSpaceErrorDensity,
              dynamicScreenSpaceErrorFactor: t.dynamicScreenSpaceErrorFactor,
              preloadWhenHidden: t.preloadWhenHidden,
              preloadFlightDestinations: t.preloadFlightDestinations,
            });

            // [DIAGNOSTIC] Tile failures
            tileset.tileFailed.addEventListener(
              (error: { url: string; message: string }) => {
                console.warn("[TILE FAIL]", error.url, error.message);
              },
            );

            // [DIAGNOSTIC] 5s interval stats dump
            const statsTimer = setInterval(() => {
              const v = viewerRef.current;
              if (!v || v.isDestroyed()) {
                clearInterval(statsTimer);
                return;
              }
              const s = (tileset as unknown as { statistics: Record<string, number> }).statistics;
              console.log("[TILESET STATS]", {
                ready: s.numberOfTilesWithContentReady,
                pending: s.numberOfPendingRequests,
                attempted: s.numberOfAttemptedRequests,
                cameraAltM: Math.round(v.camera.positionCartographic.height),
                fps: lastFps,
              });
            }, 5000);
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
    } catch (err) {
      console.error("Cesium Viewer initialization failed:", err);
      setError(
        err instanceof Error ? err.message : "WebGL initialization failed.",
      );
    }

    return () => {
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
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
}

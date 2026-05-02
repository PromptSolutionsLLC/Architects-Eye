import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { AircraftLayer } from "../layers/AircraftLayer";
import { SatelliteLayer } from "../layers/SatelliteLayer";
import { useStore } from "../store";

export default function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const layerRef = useRef<AircraftLayer | null>(null);
  const satelliteLayerRef = useRef<SatelliteLayer | null>(null);
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
          useStore.getState().setViewport({ lat, lon, distNm });
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
    } catch (err) {
      console.error("Cesium Viewer initialization failed:", err);
      setError(
        err instanceof Error ? err.message : "WebGL initialization failed.",
      );
    }

    return () => {
      satelliteLayerRef.current?.destroy();
      satelliteLayerRef.current = null;
      layerRef.current?.destroy();
      layerRef.current = null;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
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

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

export default function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const container = containerRef.current;
    let viewer: Cesium.Viewer | null = null;

    try {
      Cesium.Ion.defaultAccessToken =
        import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

      viewer = new Cesium.Viewer(container, {
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

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-72.7, 41.5, 2_000_000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 0,
      });

      viewer.creditDisplay.addStaticCredit(
        new Cesium.Credit(
          '<a href="https://maps.google.com" target="_blank" rel="noreferrer">Map data ©2024 Google</a>',
          true,
        ),
      );

      const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";

      (async () => {
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset({
            apiKey: googleApiKey,
            onlyUsingWithGoogleGeocoder: true,
          });
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.scene.primitives.add(tileset);
          }
        } catch (tileErr) {
          console.error(
            "Failed to load Google Photorealistic 3D Tiles:",
            tileErr,
          );
        }
      })();
    } catch (err) {
      console.error("Cesium Viewer initialization failed:", err);
      setError(
        err instanceof Error ? err.message : "WebGL initialization failed.",
      );
    }

    return () => {
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

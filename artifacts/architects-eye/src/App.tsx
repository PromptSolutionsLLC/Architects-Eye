import Viewer from "./globe/Viewer";
import { BootScreen } from "./components/BootScreen";
import { EntityCardStack } from "./components/EntityCardStack";
import { HeaderBar } from "./components/HeaderBar";
import { LayerToggles } from "./components/LayerToggles";
import { PerfModeController } from "./components/PerfModeController";
import { TheaterPanel } from "./components/TheaterPanel";
import { TheaterToast } from "./components/TheaterToast";
import { Timeline } from "./components/Timeline";
import { useReplayTick } from "./hooks/useReplayTick";
import { useStore } from "./store";

export default function App() {
  useReplayTick();
  const isReplay = useStore((s) => s.playbackMode === "replay");
  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000",
      }}
    >
      <Viewer />

      {/* P15 — CRT scanline overlay. Above globe, below all UI panels
          (panels are z 1000+; this sits at 50). Pointer-events none
          so it never intercepts clicks. Always-on per spec. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 50,
          opacity: 0.4,
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent 0px, transparent 1px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 3px)",
          mixBlendMode: "multiply",
        }}
      />

      {/* Subtle amber border around the viewport when in replay mode */}
      {isReplay && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            border: "1px solid rgba(251, 191, 36, 0.85)",
            boxShadow: "inset 0 0 24px rgba(251, 191, 36, 0.15)",
            pointerEvents: "none",
            zIndex: 1300,
          }}
        />
      )}

      <HeaderBar />

      {/* Left sidebar — container is click-through; cards inside are interactive */}
      <div
        style={{
          position: "fixed",
          top: 40,
          left: 0,
          width: 220,
          height: "calc(100vh - 100px)",
          zIndex: 1000,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 12,
        }}
      >
        <LayerToggles />
        <TheaterPanel />
      </div>

      <EntityCardStack />
      <Timeline />
      <TheaterToast />
      <PerfModeController />
      <BootScreen />
    </div>
  );
}

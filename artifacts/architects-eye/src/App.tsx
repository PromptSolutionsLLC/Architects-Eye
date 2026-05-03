import Viewer from "./globe/Viewer";
import { EntityCardStack } from "./components/EntityCardStack";
import { HeaderBar } from "./components/HeaderBar";
import { LayerToggles } from "./components/LayerToggles";
import { TheaterPanel } from "./components/TheaterPanel";
import { TheaterToast } from "./components/TheaterToast";
import { Timeline } from "./components/Timeline";

export default function App() {
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
    </div>
  );
}

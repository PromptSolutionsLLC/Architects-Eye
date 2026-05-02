import Viewer from "./globe/Viewer";
import { EntityPanel } from "./components/EntityPanel";

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
      <EntityPanel />
    </div>
  );
}

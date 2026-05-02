import Viewer from "./globe/Viewer";

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#000" }}>
      <Viewer />
    </div>
  );
}

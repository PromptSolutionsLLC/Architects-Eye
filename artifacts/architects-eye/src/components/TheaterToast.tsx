import { useEffect, useState } from "react";
import { useStore } from "../store";

const VISIBLE_MS = 4000;
const FADE_MS = 300;

export function TheaterToast() {
  const toast = useStore((s) => s.theaterToast);
  const clearTheaterToast = useStore((s) => s.clearTheaterToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const fadeOut = setTimeout(() => setVisible(false), VISIBLE_MS - FADE_MS);
    const clear = setTimeout(() => {
      clearTheaterToast();
      setVisible(false);
    }, VISIBLE_MS);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(clear);
    };
  }, [toast, clearTheaterToast]);

  if (!toast) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1100,
        maxWidth: 500,
        minWidth: 280,
        padding: "12px 16px",
        background: "rgba(15, 23, 42, 0.95)",
        border: "1px solid rgba(34, 211, 238, 0.3)",
        borderRadius: 2,
        backdropFilter: "blur(10px)",
        fontFamily: "monospace",
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-in-out`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          color: "#22d3ee",
          fontSize: "0.65rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        ▶ Theater
      </div>
      <div
        style={{
          color: "#fff",
          fontSize: "0.95rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          marginBottom: 4,
        }}
      >
        {toast.name}
      </div>
      <div
        style={{
          color: "#94a3b8",
          fontSize: "0.75rem",
          lineHeight: 1.4,
        }}
      >
        {toast.description}
      </div>
    </div>
  );
}

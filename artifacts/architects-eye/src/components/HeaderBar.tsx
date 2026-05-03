import { useEffect, useState } from "react";
import { useStore } from "../store";

function formatUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}Z`;
}

function Logo() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="11"
        cy="11"
        r="8.5"
        stroke="#22d3ee"
        strokeWidth="1.25"
        fill="none"
      />
      <line x1="11" y1="1.5" x2="11" y2="20.5" stroke="#22d3ee" strokeWidth="1" />
      <line x1="1.5" y1="11" x2="20.5" y2="11" stroke="#22d3ee" strokeWidth="1" />
      <circle cx="11" cy="11" r="1.5" fill="#22d3ee" />
    </svg>
  );
}

export function HeaderBar() {
  const playbackMode = useStore((s) => s.playbackMode);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const isLive = playbackMode === "live";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        zIndex: 1100,
        pointerEvents: "none",
        display: "flex",
        alignItems: "stretch",
      }}
    >
      <div
        className="flex w-full items-center justify-between border-b border-cyan-500/20 bg-slate-950/85 backdrop-blur-md"
        style={{ pointerEvents: "auto", paddingLeft: 14, paddingRight: 14 }}
      >
        {/* Left: logo + title */}
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[12px] font-bold uppercase tracking-[0.32em] text-slate-100">
            Architect's Eye
          </span>
        </div>

        {/* Center: classification */}
        <div className="rounded-sm bg-amber-500/20 px-3 py-[3px] font-mono text-[11px] tracking-[0.18em] text-amber-300">
          UNCLASSIFIED // OSINT
        </div>

        {/* Right: live pill + UTC clock */}
        <div className="flex items-center gap-3">
          {isLive ? (
            <div className="flex items-center gap-1.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-[3px] font-mono text-[11px] tracking-widest text-emerald-300">
              <span className="text-emerald-400">●</span>
              <span>LIVE</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-[3px] font-mono text-[11px] tracking-widest text-amber-300">
              <span className="text-amber-400">●</span>
              <span>REPLAY</span>
            </div>
          )}
          <span className="font-mono text-[12px] tracking-widest text-slate-300">
            {formatUtc(now)}
          </span>
        </div>
      </div>
    </div>
  );
}

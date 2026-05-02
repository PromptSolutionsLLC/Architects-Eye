import { useStore } from "../store";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function formatOffsetLabel(offsetMs: number): string {
  if (offsetMs <= 0) return "LIVE";
  const totalMin = Math.floor(offsetMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `T-${h}h ${m.toString().padStart(2, "0")}m`;
  return `T-${m}m`;
}

export function Timeline() {
  const timeOffsetMs = useStore((s) => s.timeOffsetMs);
  const setTimeOffsetMs = useStore((s) => s.setTimeOffsetMs);

  // Slider value: 0 = live (right edge), SIX_HOURS_MS = -6h (left edge).
  // We store the slider as the offset directly; left = max, right = 0.
  // To make the slider feel natural (drag right toward "now"), we invert.
  const sliderMin = 0;
  const sliderMax = SIX_HOURS_MS;
  const sliderValue = sliderMax - timeOffsetMs;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sv = Number(e.target.value);
    setTimeOffsetMs(sliderMax - sv);
  };

  const handleRelease = () => {
    // Snap small offsets back to live mode
    if (timeOffsetMs < 30_000) {
      setTimeOffsetMs(0);
    }
  };

  const isLive = timeOffsetMs <= 0;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        zIndex: 1100,
        pointerEvents: "none",
      }}
    >
      <div
        className="flex h-full items-center gap-4 border-t border-cyan-500/20 bg-slate-950/85 backdrop-blur-md"
        style={{ pointerEvents: "auto", paddingLeft: 18, paddingRight: 18 }}
      >
        <span className="font-mono text-[11px] tracking-widest text-slate-500">
          -6h
        </span>
        <div className="relative flex-1">
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={60_000}
            value={sliderValue}
            onChange={handleChange}
            onMouseUp={handleRelease}
            onTouchEnd={handleRelease}
            onKeyUp={handleRelease}
            aria-label="Time replay offset"
            className="timeline-slider w-full"
          />
        </div>
        <span className="font-mono text-[11px] tracking-widest text-slate-500">
          now
        </span>
        <span
          className={`min-w-[88px] rounded-sm border px-2 py-[3px] text-center font-mono text-[11px] tracking-widest ${
            isLive
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300"
          }`}
        >
          {formatOffsetLabel(timeOffsetMs)}
        </span>
      </div>

      <style>{`
        .timeline-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: linear-gradient(to right,
            rgba(245, 158, 11, 0.35) 0%,
            rgba(34, 211, 238, 0.55) 100%);
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }
        .timeline-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #22d3ee;
          border: 2px solid #0f172a;
          box-shadow: 0 0 6px rgba(34, 211, 238, 0.6);
          cursor: grab;
        }
        .timeline-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #22d3ee;
          border: 2px solid #0f172a;
          box-shadow: 0 0 6px rgba(34, 211, 238, 0.6);
          cursor: grab;
        }
        .timeline-slider:active::-webkit-slider-thumb { cursor: grabbing; }
        .timeline-slider:active::-moz-range-thumb { cursor: grabbing; }
      `}</style>
    </div>
  );
}

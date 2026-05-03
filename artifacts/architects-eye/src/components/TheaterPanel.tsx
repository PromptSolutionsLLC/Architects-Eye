import { THEATERS } from "../data/theaters";
import { flyToTheater } from "../utils/theaters";
import { getViewer } from "../globe/viewer-handle";

export function TheaterPanel() {
  return (
    <div
      className="rounded-sm border border-cyan-500/20 bg-slate-900/95 backdrop-blur-md"
      style={{ pointerEvents: "auto", padding: "12px 14px" }}
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400">
        Theaters
      </div>
      <div className="flex flex-col gap-1.5">
        {THEATERS.map((theater) => (
          <button
            key={theater.id}
            type="button"
            onClick={() => {
              const viewer = getViewer();
              if (!viewer) return;
              flyToTheater(viewer, theater);
            }}
            className="group flex items-center justify-between rounded-sm border border-slate-700/70 bg-slate-950/60 px-3 py-[7px] text-left text-[12px] font-medium tracking-wide text-slate-300 transition-colors hover:border-cyan-400/70 hover:bg-slate-900/70 hover:text-cyan-200"
            title={theater.description}
          >
            <span>{theater.name}</span>
            <span className="text-[10px] text-slate-600 transition-colors group-hover:text-cyan-400">
              ▸
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

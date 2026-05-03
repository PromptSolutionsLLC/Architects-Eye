import { useStore, type LayerKey } from "../store";

interface LayerSpec {
  key: LayerKey;
  label: string;
  color: string;
  enabled: boolean;
  // When true, the count cell renders "---" until the layer flips
  // available=true (i.e. data is loaded). Used for layers whose
  // initial fetch is on the order of seconds.
  showLoadingPlaceholder?: boolean;
}

const LAYERS: LayerSpec[] = [
  { key: "aircraft", label: "Aircraft", color: "#22d3ee", enabled: true },
  { key: "vessels", label: "Vessels", color: "#34d399", enabled: true },
  { key: "satellites", label: "Satellites", color: "#a855f7", enabled: true },
  { key: "jamming", label: "Jamming", color: "#ef4444", enabled: true },
  {
    key: "restrictedAirspace",
    label: "Restricted Airspace",
    color: "#ef4444",
    enabled: true,
  },
  { key: "fires", label: "Fires", color: "#f97316", enabled: true },
  {
    key: "quakes",
    label: "Quakes",
    color: "#facc15",
    enabled: true,
    showLoadingPlaceholder: true,
  },
];

interface RowProps {
  spec: LayerSpec;
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-[18px] w-[32px] rounded-full transition-colors",
        disabled
          ? "cursor-not-allowed bg-slate-800/60"
          : checked
            ? "cursor-pointer bg-cyan-500/70"
            : "cursor-pointer bg-slate-700/80",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-slate-100 shadow transition-all",
          checked ? "left-[16px]" : "left-[2px]",
          disabled ? "bg-slate-500" : "",
        ].join(" ")}
      />
    </button>
  );
}

function LayerRow({ spec }: RowProps) {
  const visible = useStore((s) => s.layerVisibility[spec.key]);
  const count = useStore((s) => s.layerCounts[spec.key]);
  const available = useStore((s) => s.layerAvailability[spec.key]);
  const setLayerVisible = useStore((s) => s.setLayerVisible);

  // If the layer was marked unavailable at runtime (e.g. WS failed),
  // hide the row entirely per spec — UNLESS the layer opts into a
  // loading placeholder (initial !available is the "still fetching"
  // state, not a permanent failure).
  if (spec.enabled && !available && !spec.showLoadingPlaceholder) return null;

  const isDisabled = !spec.enabled;
  const dim = isDisabled ? "opacity-45" : "";
  const countLabel = !spec.enabled
    ? "---"
    : spec.showLoadingPlaceholder && !available
      ? "---"
      : count.toString().padStart(3, "0");

  return (
    <div
      className={`flex items-center justify-between py-[7px] ${dim}`}
      title={isDisabled ? "Coming soon" : undefined}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="inline-block h-[8px] w-[8px] rounded-full"
          style={{
            background: spec.color,
            boxShadow: isDisabled ? "none" : `0 0 6px ${spec.color}`,
          }}
        />
        <span className="text-[12px] font-medium tracking-wide text-slate-200">
          {spec.label}
        </span>
        <span className="font-mono text-[10px] tracking-wider text-slate-500">
          {countLabel}
        </span>
      </div>
      <ToggleSwitch
        checked={spec.enabled ? visible : false}
        disabled={isDisabled}
        onChange={(next) => setLayerVisible(spec.key, next)}
      />
    </div>
  );
}

export function LayerToggles() {
  return (
    <div
      className="rounded-sm border border-cyan-500/20 bg-slate-900/95 backdrop-blur-md"
      style={{ pointerEvents: "auto", padding: "12px 14px" }}
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400">
        Data Layers
      </div>
      <div className="flex flex-col divide-y divide-slate-800/70">
        {LAYERS.map((spec) => (
          <LayerRow key={spec.key} spec={spec} />
        ))}
      </div>
    </div>
  );
}

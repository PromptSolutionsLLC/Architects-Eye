import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "../store";

const TRAIL_TICK_MS = 60 * 60 * 1000; // 1h

function formatUtcShort(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const iso = d.toISOString();
  return `${iso.slice(11, 19)}Z`;
}

function formatUtcFull(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

interface ScrubberProps {
  earliest_ms: number;
  latest_ms: number;
  current_ms: number;
  disabled: boolean;
  onScrub: (ms: number) => void;
  onScrubStart: (ms: number) => void;
}

function Scrubber({
  earliest_ms,
  latest_ms,
  current_ms,
  disabled,
  onScrub,
  onScrubStart,
}: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  // Throttle pointer-driven scrub updates to one per animation frame.
  const pendingMsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const span = Math.max(1, latest_ms - earliest_ms);
  const fillPct = Math.max(
    0,
    Math.min(100, ((current_ms - earliest_ms) / span) * 100),
  );

  const msFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return current_ms;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = rect.width > 0 ? x / rect.width : 0;
      return Math.round(earliest_ms + pct * span);
    },
    [earliest_ms, span, current_ms],
  );

  const flushScrub = useCallback(() => {
    rafRef.current = null;
    if (pendingMsRef.current != null) {
      onScrub(pendingMsRef.current);
      pendingMsRef.current = null;
    }
  }, [onScrub]);

  const queueScrub = useCallback(
    (ms: number) => {
      pendingMsRef.current = ms;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushScrub);
      }
    },
    [flushScrub],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const ms = msFromClientX(e.clientX);
    onScrubStart(ms);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setHoverX(x);
    setHoverMs(msFromClientX(e.clientX));
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      queueScrub(msFromClientX(e.clientX));
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingMsRef.current != null) {
      onScrub(pendingMsRef.current);
      pendingMsRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    setHoverMs(null);
  };

  // Tick marks at every full hour boundary inside the buffer range.
  const tickPositions = useMemo(() => {
    const ticks: number[] = [];
    const firstHour =
      Math.ceil(earliest_ms / TRAIL_TICK_MS) * TRAIL_TICK_MS;
    for (let t = firstHour; t <= latest_ms; t += TRAIL_TICK_MS) {
      ticks.push(((t - earliest_ms) / span) * 100);
    }
    return ticks;
  }, [earliest_ms, latest_ms, span]);

  const handleStyle: CSSProperties = {
    position: "absolute",
    left: `calc(${fillPct}% - 6px)`,
    top: "50%",
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: disabled ? "#475569" : "#fbbf24",
    transform: "translateY(-50%)",
    boxShadow: disabled ? "none" : "0 0 8px rgba(251, 191, 36, 0.55)",
    border: "2px solid #0f172a",
    pointerEvents: "none",
  };

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        height: 32,
        display: "flex",
        alignItems: "center",
      }}
      onPointerLeave={handlePointerLeave}
    >
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          width: "100%",
          height: 4,
          borderRadius: 2,
          background: "#1e293b",
          cursor: disabled ? "not-allowed" : "pointer",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${fillPct}%`,
            background: disabled ? "#334155" : "#fbbf24",
            borderRadius: 2,
            opacity: disabled ? 0.4 : 1,
            pointerEvents: "none",
          }}
        />
        {tickPositions.map((pct, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${pct}%`,
              top: -3,
              width: 1,
              height: 10,
              background: "rgba(148, 163, 184, 0.45)",
              pointerEvents: "none",
            }}
          />
        ))}
        <div style={handleStyle} />
      </div>
      {hoverMs != null && !disabled && (
        <div
          style={{
            position: "absolute",
            left: hoverX,
            bottom: 26,
            transform: "translateX(-50%)",
            background: "#0a0a0a",
            border: "1px solid rgba(251, 191, 36, 0.5)",
            color: "#fef3c7",
            padding: "3px 8px",
            font: "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {formatUtcFull(hoverMs)}
        </div>
      )}
    </div>
  );
}

export function Timeline() {
  const playbackMode = useStore((s) => s.playbackMode);
  const replayTimestamp_ms = useStore((s) => s.replayTimestamp_ms);
  const replaySpeed = useStore((s) => s.replaySpeed);
  const replayPlaying = useStore((s) => s.replayPlaying);
  const bufferRange = useStore((s) => s.bufferRange);
  const enterReplay = useStore((s) => s.enterReplay);
  const exitReplay = useStore((s) => s.exitReplay);
  const setReplayTimestamp = useStore((s) => s.setReplayTimestamp);
  const setReplaySpeed = useStore((s) => s.setReplaySpeed);
  const togglePlayPause = useStore((s) => s.togglePlayPause);

  // Re-render the LIVE-mode fill bar once a second so it visually
  // reaches the right edge as time advances.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isReplay = playbackMode === "replay";
  const hasBuffer = bufferRange != null;
  // Treat the live edge as max(latest_ms, now) so the fill bar can
  // continue creeping toward the right edge between buffer writes.
  const latest_ms = hasBuffer
    ? Math.max(bufferRange.latest_ms, nowMs)
    : nowMs;
  const earliest_ms = hasBuffer ? bufferRange.earliest_ms : nowMs - 1000;
  const current_ms =
    isReplay && replayTimestamp_ms != null ? replayTimestamp_ms : latest_ms;

  const handleScrubStart = (ms: number) => {
    enterReplay(ms);
  };

  const handleScrub = (ms: number) => {
    if (ms >= latest_ms - 500) {
      exitReplay();
      return;
    }
    setReplayTimestamp(ms);
  };

  const handleSpeedClick = () => {
    setReplaySpeed(replaySpeed === 1 ? 2 : 1);
  };

  const playDisabled = !isReplay;
  const speedDisabled = !isReplay;
  const scrubDisabled = !hasBuffer;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        zIndex: 1100,
        pointerEvents: "none",
      }}
    >
      <div
        className="flex h-full items-center gap-3 border-t border-cyan-500/20 bg-slate-950/85 backdrop-blur-md"
        style={{ pointerEvents: "auto", paddingLeft: 16, paddingRight: 16 }}
      >
        <button
          type="button"
          onClick={togglePlayPause}
          disabled={playDisabled}
          aria-label={replayPlaying ? "Pause replay" : "Play replay"}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: playDisabled ? "#1e293b" : "#0f172a",
            border: `1px solid ${
              playDisabled ? "rgba(71, 85, 105, 0.4)" : "rgba(34, 211, 238, 0.4)"
            }`,
            borderRadius: 2,
            color: playDisabled ? "#475569" : "#22d3ee",
            cursor: playDisabled ? "not-allowed" : "pointer",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1,
            padding: 0,
          }}
        >
          {replayPlaying ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          onClick={handleSpeedClick}
          disabled={speedDisabled}
          aria-label={`Replay speed ${replaySpeed}x`}
          style={{
            width: 36,
            height: 32,
            background: speedDisabled ? "#1e293b" : "#0f172a",
            border: `1px solid ${
              speedDisabled
                ? "rgba(71, 85, 105, 0.4)"
                : "rgba(34, 211, 238, 0.4)"
            }`,
            borderRadius: 2,
            color: speedDisabled ? "#475569" : "#22d3ee",
            cursor: speedDisabled ? "not-allowed" : "pointer",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 11,
            letterSpacing: "0.08em",
            padding: 0,
          }}
        >
          {replaySpeed}x
        </button>

        {scrubDisabled ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 32,
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px dashed rgba(71, 85, 105, 0.6)",
              borderRadius: 2,
              color: "#64748b",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 10,
              letterSpacing: "0.24em",
            }}
          >
            BUFFER EMPTY · WATCH TO RECORD
          </div>
        ) : (
          <Scrubber
            earliest_ms={earliest_ms}
            latest_ms={latest_ms}
            current_ms={current_ms}
            disabled={false}
            onScrub={handleScrub}
            onScrubStart={handleScrubStart}
          />
        )}

        <button
          type="button"
          onClick={isReplay ? exitReplay : undefined}
          disabled={!isReplay}
          aria-label={isReplay ? "Return to live" : "Live mode active"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            background: isReplay
              ? "rgba(16, 185, 129, 0.04)"
              : "rgba(16, 185, 129, 0.12)",
            border: `1px solid ${
              isReplay
                ? "rgba(16, 185, 129, 0.25)"
                : "rgba(16, 185, 129, 0.5)"
            }`,
            borderRadius: 2,
            color: isReplay ? "#475569" : "#34d399",
            cursor: isReplay ? "pointer" : "default",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 11,
            letterSpacing: "0.18em",
          }}
        >
          <span style={{ color: isReplay ? "#475569" : "#34d399" }}>●</span>
          <span>LIVE</span>
        </button>
      </div>

      {isReplay && replayTimestamp_ms != null && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            top: 40,
            right: 16,
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px",
            background: "rgba(251, 191, 36, 0.12)",
            border: "1px solid rgba(251, 191, 36, 0.5)",
            borderRadius: 2,
            color: "#fef3c7",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 11,
            letterSpacing: "0.18em",
            pointerEvents: "none",
          }}
        >
          <span style={{ color: "#fbbf24" }}>●</span>
          <span>REPLAY · {formatUtcShort(replayTimestamp_ms)}</span>
        </div>
      )}
    </div>
  );
}

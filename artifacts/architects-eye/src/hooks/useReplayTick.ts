import { useEffect } from "react";
import { useStore } from "../store";

/** Drives the replay clock forward while replayPlaying === true and
 *  playbackMode === 'replay'. Runs ONE rAF loop, advancing
 *  replayTimestamp_ms by (frameDelta_ms * replaySpeed) per tick.
 *  Auto-exits replay (back to live) when the timestamp catches up to
 *  Date.now(). The loop is created lazily and torn down whenever the
 *  driving conditions go false. */
export function useReplayTick(): void {
  useEffect(() => {
    let rafId: number | null = null;
    let lastTs: number | null = null;

    const tick = (now: number) => {
      const state = useStore.getState();
      if (state.playbackMode !== "replay" || !state.replayPlaying) {
        rafId = null;
        lastTs = null;
        return;
      }
      if (lastTs == null) {
        lastTs = now;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const dtMs = now - lastTs;
      lastTs = now;
      const current = state.replayTimestamp_ms ?? Date.now();
      const next = current + dtMs * state.replaySpeed;
      const liveEdge = Date.now();
      if (next >= liveEdge) {
        console.log("[REPLAY] returned to live");
        state.exitReplay();
        rafId = null;
        lastTs = null;
        return;
      }
      state.setReplayTimestamp(next);
      rafId = requestAnimationFrame(tick);
    };

    const unsubscribe = useStore.subscribe((state) => {
      const shouldRun =
        state.playbackMode === "replay" && state.replayPlaying;
      if (shouldRun && rafId == null) {
        lastTs = null;
        rafId = requestAnimationFrame(tick);
      } else if (!shouldRun && rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        lastTs = null;
      }
    });

    // Kick once in case we mount mid-playback.
    const init = useStore.getState();
    if (init.playbackMode === "replay" && init.replayPlaying) {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      unsubscribe();
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, []);
}

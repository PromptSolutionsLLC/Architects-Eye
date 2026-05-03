import { useEffect, useRef, useState } from "react";

/**
 * P15 — Boot terminal loading sequence. Black overlay with amber
 * monospace text typed character-by-character, then fades to globe.
 *
 * Behavior:
 *  - Mounts immediately on App load (covers entire viewport, z 9999)
 *  - Six lines, 30 ms/char, 200 ms inter-line pause
 *  - 600 ms hold after final line, then 800 ms opacity fade
 *  - Unmounts after fade
 *  - ESC or click-anywhere → instant skip to fade-out
 *  - Runs ONCE per page load; HMR re-mounts are suppressed via a
 *    module-level flag so iterating on adjacent components in dev
 *    doesn't replay the boot animation every save.
 */

const LINES = [
  "ARCHITECT'S EYE v1.0",
  "INITIALIZING SECURE OSINT TERMINAL...",
  "FETCHING TLE CATALOG... [15,304 OBJECTS]",
  "ESTABLISHING AISSTREAM CONNECTION...",
  "LOADING SUBMARINE CABLE TOPOLOGY...",
  "[ READY ]",
] as const;

const CHAR_MS = 30;
const LINE_PAUSE_MS = 200;
const HOLD_MS = 600;
const FADE_MS = 800;
const AMBER = "#fbbf24";

// Module-level: one-shot per page load. HMR re-mounts skip animation.
let bootHasRun = false;

export function BootScreen() {
  const [skipMount, setSkipMount] = useState(bootHasRun);
  // typedLines[i] is the substring of LINES[i] currently revealed.
  const [typedLines, setTypedLines] = useState<string[]>([""]);
  const [phase, setPhase] = useState<"typing" | "fading" | "done">(
    bootHasRun ? "done" : "typing",
  );
  const skipRef = useRef(false);

  // Mount-once guard
  useEffect(() => {
    if (bootHasRun) {
      setSkipMount(true);
      return;
    }
    bootHasRun = true;
  }, []);

  // Typing chain
  useEffect(() => {
    if (skipMount || phase !== "typing") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const beginFade = () => {
      if (cancelled) return;
      // NOTE: do NOT schedule the fade→done timer here. Calling
      // setPhase("fading") triggers a re-render whose cleanup would
      // cancel any timer pushed onto `timers`, leaving the boot
      // screen stuck at opacity:0 and (with pointer-events:auto)
      // eating every click on the page. The fade→done transition
      // is handled by a separate useEffect below.
      setPhase("fading");
    };

    const typeLine = (lineIdx: number, charIdx: number) => {
      if (cancelled) return;
      if (skipRef.current) {
        // Reveal everything immediately and jump to fade.
        setTypedLines(LINES.map((l) => l));
        beginFade();
        return;
      }
      const line = LINES[lineIdx];
      if (charIdx > line.length) {
        // line complete; pause then advance
        if (lineIdx === LINES.length - 1) {
          timers.push(setTimeout(beginFade, HOLD_MS));
          return;
        }
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            setTypedLines((prev) => [...prev, ""]);
            typeLine(lineIdx + 1, 0);
          }, LINE_PAUSE_MS),
        );
        return;
      }
      setTypedLines((prev) => {
        const copy = prev.slice();
        copy[lineIdx] = line.slice(0, charIdx);
        return copy;
      });
      timers.push(setTimeout(() => typeLine(lineIdx, charIdx + 1), CHAR_MS));
    };

    typeLine(0, 0);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [skipMount, phase]);

  // Independent fade→done timer. Lives in its own effect so it is
  // immune to the typing effect's cleanup (which fires the moment
  // phase changes to "fading").
  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("done"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // ESC key → skip
  useEffect(() => {
    if (skipMount || phase === "done") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        skipRef.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skipMount, phase]);

  if (skipMount || phase === "done") return null;

  return (
    <div
      onClick={() => {
        skipRef.current = true;
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: AMBER,
        fontFamily:
          '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
        fontSize: 14,
        lineHeight: 1.7,
        letterSpacing: 0.5,
        // While fading we MUST drop pointer-events so clicks fall
        // through to the globe / UI underneath even if React holds
        // the node in the DOM for one extra frame, and as a safety
        // net against any future bug that could pin phase to
        // "fading" indefinitely.
        cursor: phase === "fading" ? "default" : "pointer",
        pointerEvents: phase === "fading" ? "none" : "auto",
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-in-out`,
        userSelect: "none",
      }}
    >
      <div style={{ minWidth: 420, padding: "0 24px" }}>
        {typedLines.map((text, i) => {
          const isCurrent = i === typedLines.length - 1 && phase === "typing";
          return (
            <div key={i} style={{ whiteSpace: "pre" }}>
              {text}
              {isCurrent && <span className="ae-boot-cursor">_</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

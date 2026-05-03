import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type LayerKey } from "../store";
import {
  searchAll,
  getSearchProvider,
  type SearchEntityType,
  type SearchResult,
} from "../utils/search-registry";
import { flyToSelected } from "../utils/click-to-fly";
import { getViewer } from "../globe/viewer-handle";

const DEBOUNCE_MS = 150;
const STALE_TOAST_MS = 2000;

const TYPE_TO_LAYER: Record<SearchEntityType, LayerKey> = {
  aircraft: "aircraft",
  vessel: "vessels",
  satellite: "satellites",
  quake: "quakes",
  cable: "submarineCables",
};

const TYPE_DOT_COLOR: Record<SearchEntityType, string> = {
  aircraft: "#22d3ee",
  vessel: "#34d399",
  satellite: "#a855f7",
  quake: "#fb923c",
  cable: "#5eead4",
};

interface DropdownState {
  results: SearchResult[];
  totalMatches: number;
}

const EMPTY_DROPDOWN: DropdownState = { results: [], totalMatches: 0 };

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [staleToast, setStaleToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the query → debouncedQuery transition.
  useEffect(() => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  const dropdown = useMemo<DropdownState>(() => {
    if (debouncedQuery.trim().length === 0) return EMPTY_DROPDOWN;
    return searchAll(debouncedQuery);
  }, [debouncedQuery]);

  // Reset the highlight index when the result set changes.
  useEffect(() => {
    setHighlight(0);
  }, [dropdown.results]);

  // Click-outside → blur. We listen on mousedown so it fires before
  // input focus would re-acquire it on a same-element click.
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && wrapRef.current.contains(e.target)) {
        return;
      }
      setFocused(false);
      inputRef.current?.blur();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, []);

  const showDropdown = focused && dropdown.results.length > 0;

  const showStaleToast = (msg: string) => {
    setStaleToast(msg);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setStaleToast(null);
      toastTimer.current = null;
    }, STALE_TOAST_MS);
  };

  const selectResult = (r: SearchResult) => {
    const provider = getSearchProvider(r.type);
    if (!provider) {
      console.warn("[SEARCH STALE] type=" + r.type + " id=" + r.id);
      showStaleToast("Entity no longer available");
      return;
    }
    const cr = provider.getClickResultById(r.id);
    if (!cr) {
      console.warn("[SEARCH STALE] type=" + r.type + " id=" + r.id);
      showStaleToast("Entity no longer available");
      return;
    }
    // Force-enable the entity's layer so the camera lands on something
    // actually visible (per spec — only for the 5 searchable types).
    const layerKey = TYPE_TO_LAYER[r.type];
    const visState = useStore.getState();
    if (!visState.layerVisibility[layerKey]) {
      visState.setLayerVisible(layerKey, true);
    }
    // Same pipeline as the central click handler in Viewer.tsx — open
    // the card, then dispatch the fly through the centralized wrapper
    // (which computes position from entity.data, sidestepping the
    // per-layer fly closures whose internal state may not be ready
    // for a layer that was just toggled on by setLayerVisible above).
    const opened = useStore.getState().replaceUnpinnedCards(cr.selected);
    if (opened) {
      flyToSelected(getViewer(), cr.selected);
    }

    // Reset and blur so the dropdown disappears.
    setQuery("");
    setDebouncedQuery("");
    setFocused(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      setDebouncedQuery("");
      setFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (dropdown.results.length === 0) return;
      setHighlight((h) =>
        Math.min(dropdown.results.length - 1, h + 1),
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (dropdown.results.length === 0) return;
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === "Enter") {
      if (dropdown.results.length === 0) return;
      const r = dropdown.results[Math.min(highlight, dropdown.results.length - 1)];
      if (r) selectResult(r);
      return;
    }
  };

  const overflow = Math.max(0, dropdown.totalMatches - dropdown.results.length);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: 320,
        pointerEvents: "auto",
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={onKeyDown}
        placeholder="SEARCH ENTITIES..."
        spellCheck={false}
        autoComplete="off"
        style={{
          width: "100%",
          height: 32,
          boxSizing: "border-box",
          background: "rgba(2, 6, 23, 0.85)",
          color: "#e2e8f0",
          border: `1px solid ${focused ? "#fbbf24" : "#334155"}`,
          borderRadius: 2,
          outline: "none",
          padding: "0 10px",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      />
      {showDropdown && (
        <div
          style={{
            position: "absolute",
            top: 32,
            left: 0,
            width: 320,
            background: "rgba(2, 6, 23, 0.96)",
            border: `1px solid ${focused ? "#fbbf24" : "#334155"}`,
            borderTop: "none",
            borderBottomLeftRadius: 2,
            borderBottomRightRadius: 2,
            boxShadow: "0 8px 18px rgba(0,0,0,0.45)",
            zIndex: 1200,
            maxHeight: 36 * 10 + 24,
            overflowY: "auto",
          }}
        >
          {dropdown.results.map((r, idx) => {
            const isHi = idx === highlight;
            return (
              <div
                key={r.type + ":" + r.id}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  // Prevent the input from blurring before our click
                  // handler fires the selection (avoids race).
                  e.preventDefault();
                  selectResult(r);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 36,
                  padding: "0 8px",
                  cursor: "pointer",
                  background: isHi
                    ? "rgba(251, 191, 36, 0.10)"
                    : "transparent",
                  borderTop: idx === 0 ? "none" : "1px solid #1e293b",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 auto",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: TYPE_DOT_COLOR[r.type],
                    boxShadow: `0 0 6px ${TYPE_DOT_COLOR[r.type]}80`,
                  }}
                />
                <span
                  style={{
                    flex: "0 1 auto",
                    minWidth: 0,
                    color: "#f1f5f9",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.label}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    flex: "0 1 auto",
                    minWidth: 0,
                    color: "#64748b",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.sublabel}
                </span>
              </div>
            );
          })}
          {overflow > 0 && (
            <div
              style={{
                height: 24,
                padding: "0 8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderTop: "1px solid #1e293b",
                color: "#64748b",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 10,
                letterSpacing: "0.10em",
              }}
            >
              +{overflow} MORE
            </div>
          )}
        </div>
      )}
      {staleToast && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 36,
            left: 0,
            width: 320,
            padding: "6px 10px",
            background: "rgba(127, 29, 29, 0.95)",
            border: "1px solid rgba(248, 113, 113, 0.7)",
            borderRadius: 2,
            color: "#fecaca",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 11,
            letterSpacing: "0.06em",
            zIndex: 1300,
          }}
        >
          {staleToast}
        </div>
      )}
    </div>
  );
}

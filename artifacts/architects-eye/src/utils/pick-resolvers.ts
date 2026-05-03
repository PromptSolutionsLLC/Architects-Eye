import type { SelectedEntity } from "../store";

/**
 * Centralized pick-resolver registry. Layers register a resolver at
 * mount time; the Viewer runs ONE viewer.scene.pick() per click and
 * iterates resolvers in fixed priority order (airspace → fire →
 * satellite → aircraft → vessel). The first non-null wins.
 *
 * Each resolver is responsible for:
 *  - inspecting the picked object
 *  - returning a SelectedEntity (or null)
 *  - optionally returning a pre-bound `fly` thunk that the Viewer
 *    will invoke after applying the selection (so click-to-fly logic
 *    stays inside each layer)
 *
 * Hover resolvers (MOUSE_MOVE) follow the same shape but only the
 * jamming layer registers one today.
 */

export type ClickResult = {
  selected: SelectedEntity;
  fly?: () => void;
};

export type ClickResolver = (picked: unknown) => ClickResult | null;

const CLICK_PRIORITY = [
  "airspace",
  "fire",
  "quake",
  "satellite",
  "aircraft",
  "vessel",
] as const;

export type ClickLayerKey = (typeof CLICK_PRIORITY)[number];

const clickResolvers = new Map<ClickLayerKey, ClickResolver>();

export function registerClickResolver(
  key: ClickLayerKey,
  fn: ClickResolver,
): void {
  clickResolvers.set(key, fn);
}

export function unregisterClickResolver(key: ClickLayerKey): void {
  clickResolvers.delete(key);
}

export function resolveClick(picked: unknown): ClickResult | null {
  for (const key of CLICK_PRIORITY) {
    const fn = clickResolvers.get(key);
    if (!fn) continue;
    const r = fn(picked);
    if (r) return r;
  }
  return null;
}

// ─── Hover ────────────────────────────────────────────────────────────
export type HoverResult = {
  hex: string;
  intensity: number;
};

export type HoverResolver = (picked: unknown) => HoverResult | null;

const hoverResolvers = new Map<string, HoverResolver>();

export function registerHoverResolver(name: string, fn: HoverResolver): void {
  hoverResolvers.set(name, fn);
}

export function unregisterHoverResolver(name: string): void {
  hoverResolvers.delete(name);
}

export function resolveHover(picked: unknown): HoverResult | null {
  for (const fn of hoverResolvers.values()) {
    const r = fn(picked);
    if (r) return r;
  }
  return null;
}

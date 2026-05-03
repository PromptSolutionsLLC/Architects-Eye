import { create } from "zustand";
import type { Aircraft, Fire, Quake } from "../utils/api";
import type { SatelliteMeta } from "../utils/tle";
import type { VesselSelectionData } from "../layers/VesselLayer";
import type { BBox } from "../ws/aisstream-client";
import type { RestrictedAirspaceZone } from "../data/restricted-airspace";
import type { CableMeta } from "../layers/SubmarineCablesLayer";

export type SelectedEntity =
  | { type: "aircraft"; id: string; data: Aircraft }
  | { type: "satellite"; id: string; data: SatelliteMeta }
  | { type: "vessel"; id: string; data: VesselSelectionData }
  | { type: "airspace"; id: string; data: RestrictedAirspaceZone }
  | { type: "fire"; id: string; data: Fire }
  | { type: "quake"; id: string; data: Quake }
  | { type: "cable"; id: string; data: CableMeta };

export interface EntityCard {
  cardId: string;
  entity: SelectedEntity;
  pinned: boolean;
  position: { x: number; y: number };
  zIndex: number;
  collapsed: boolean;
}

export interface Viewport {
  lat: number;
  lon: number;
  distNm: number;
  bbox: BBox | null;
}

export type LayerKey =
  | "aircraft"
  | "vessels"
  | "satellites"
  | "jamming"
  | "restrictedAirspace"
  | "submarineCables"
  | "fires"
  | "quakes";

export type LayerVisibility = Record<LayerKey, boolean>;

export type LayerCounts = Record<LayerKey, number>;

export interface TheaterToast {
  name: string;
  description: string;
  triggerId: number;
}

export type PlaybackMode = "live" | "replay";

export interface BufferRange {
  earliest_ms: number;
  latest_ms: number;
}

export const CARD_WIDTH = 320;
const CARD_TOP_OFFSET = 80;
const CARD_RIGHT_MARGIN = 24;
const CARD_CASCADE = 30;
const CARD_MIN_VISIBLE = 80; // px of header that must remain on-screen
const CARD_HEADER_H = 28;

interface AppStore {
  cards: EntityCard[];
  /** Open a new card. Returns the new cardId, or null if entity is
   *  already shown in a PINNED card (no-op dedup). */
  openCard: (
    entity: SelectedEntity,
    opts?: { pinned?: boolean; position?: { x: number; y: number } },
  ) => string | null;
  /** Remove all unpinned cards, then open a new card for `entity`.
   *  Returns true if a new card was opened (caller should fly camera);
   *  false if `entity` already exists in a pinned card (no-op). */
  replaceUnpinnedCards: (entity: SelectedEntity) => boolean;
  dismissCard: (cardId: string) => void;
  togglePinCard: (cardId: string) => void;
  moveCard: (cardId: string, x: number, y: number) => void;
  bringCardToFront: (cardId: string) => void;
  toggleCollapseCard: (cardId: string) => void;
  /** Re-clamp every card's position so at least 80 px of its header
   *  remains within the new viewport bounds (e.g. on window resize). */
  clampAllCards: (viewportW: number, viewportH: number) => void;

  viewport: Viewport;
  setViewport: (v: Viewport) => void;

  layerVisibility: LayerVisibility;
  setLayerVisible: (layer: LayerKey, visible: boolean) => void;

  layerAvailability: Record<LayerKey, boolean>;
  setLayerAvailable: (layer: LayerKey, available: boolean) => void;

  layerCounts: LayerCounts;
  setLayerCount: (layer: LayerKey, count: number) => void;

  timeOffsetMs: number;
  setTimeOffsetMs: (ms: number) => void;

  theaterToast: TheaterToast | null;
  showTheaterToast: (t: { name: string; description: string }) => void;
  clearTheaterToast: () => void;

  isTheaterFlying: boolean;
  setTheaterFlying: (flying: boolean) => void;

  // ── Replay scrubber (P13) ───────────────────────────────────────
  playbackMode: PlaybackMode;
  replayTimestamp_ms: number | null;
  replaySpeed: 1 | 15;
  replayPlaying: boolean;
  bufferRange: BufferRange | null;
  enterReplay: (timestamp_ms: number) => void;
  exitReplay: () => void;
  setReplayTimestamp: (ms: number) => void;
  setReplaySpeed: (s: 1 | 15) => void;
  togglePlayPause: () => void;
  setBufferRange: (range: BufferRange | null) => void;
}

let toastCounter = 0;
let zCounter = 0;
let cardCounter = 0;

function newCardId(): string {
  // Prefer crypto.randomUUID when available; fall back to a counter
  // so the store stays usable in Node-side tests / SSR.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `card-${++cardCounter}-${Date.now()}`;
}

function clampPos(
  x: number,
  y: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  // Horizontal: at least CARD_MIN_VISIBLE px of the (CARD_WIDTH-wide)
  // header must overlap [0, vw].
  const xMin = CARD_MIN_VISIBLE - CARD_WIDTH; // negative
  const xMax = vw - CARD_MIN_VISIBLE;
  // Vertical: header must be on-screen.
  const yMin = 0;
  const yMax = Math.max(0, vh - CARD_HEADER_H);
  return {
    x: Math.max(xMin, Math.min(xMax, x)),
    y: Math.max(yMin, Math.min(yMax, y)),
  };
}

function computeCascadePosition(
  cards: EntityCard[],
  vw: number,
  vh: number,
): { x: number; y: number } {
  // Spec: first unpinned card is anchored top-right at
  //   x = viewportWidth - CARD_RIGHT_MARGIN - CARD_WIDTH,
  //   y = CARD_TOP_OFFSET.
  // Each subsequent unpinned card cascades (+30 x, +30 y) from the
  // previous unpinned position, so the prior card peeks out top-left.
  // Wrap back to step 0 when the cascade pushes the card off-screen.
  // Pinned cards do not influence cascade — they keep their last
  // dragged positions, so we count only unpinned siblings here.
  const baseX = vw - CARD_RIGHT_MARGIN - CARD_WIDTH;
  const baseY = CARD_TOP_OFFSET;
  const unpinnedCount = cards.reduce((n, c) => (c.pinned ? n : n + 1), 0);
  // Bound the cascade by whichever axis runs out of viewport first.
  // Leave ~120 px of body height visible; allow x to push to the right
  // edge before the header ducks under CARD_MIN_VISIBLE.
  const maxByY = Math.max(
    1,
    Math.floor((vh - baseY - 120) / CARD_CASCADE),
  );
  const maxByX = Math.max(
    1,
    Math.floor((vw - CARD_MIN_VISIBLE - baseX) / CARD_CASCADE),
  );
  const maxStep = Math.min(maxByY, maxByX);
  const step = unpinnedCount % maxStep;
  return clampPos(
    baseX + step * CARD_CASCADE,
    baseY + step * CARD_CASCADE,
    vw,
    vh,
  );
}

/** Latest card whose entity matches `type`, or null. Used by layers
 *  whose trail / visualization follows the most recent selection of
 *  their kind (e.g. AircraftLayer trail). */
export function latestSelectionOfType<T extends SelectedEntity["type"]>(
  cards: EntityCard[],
  type: T,
): Extract<SelectedEntity, { type: T }> | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const e = cards[i].entity;
    if (e.type === type) return e as Extract<SelectedEntity, { type: T }>;
  }
  return null;
}

function viewportSize(): { w: number; h: number } {
  if (typeof window !== "undefined") {
    return { w: window.innerWidth, h: window.innerHeight };
  }
  return { w: 1280, h: 720 };
}

export const useStore = create<AppStore>((set, get) => ({
  cards: [],

  openCard: (entity, opts) => {
    const state = get();
    // Dedup against pinned cards: same type+id in a pinned card → no-op.
    const dup = state.cards.find(
      (c) => c.pinned && c.entity.type === entity.type && c.entity.id === entity.id,
    );
    if (dup) return null;
    const { w, h } = viewportSize();
    const position =
      opts?.position ?? computeCascadePosition(state.cards, w, h);
    const card: EntityCard = {
      cardId: newCardId(),
      entity,
      pinned: opts?.pinned ?? false,
      position,
      zIndex: ++zCounter,
      collapsed: false,
    };
    set({ cards: [...state.cards, card] });
    return card.cardId;
  },

  replaceUnpinnedCards: (entity) => {
    const state = get();
    // Pinned-dedup: skip everything if a pinned card already shows this entity.
    const pinnedDup = state.cards.find(
      (c) => c.pinned && c.entity.type === entity.type && c.entity.id === entity.id,
    );
    if (pinnedDup) return false;
    const kept = state.cards.filter((c) => c.pinned);
    const { w, h } = viewportSize();
    const position = computeCascadePosition(kept, w, h);
    const card: EntityCard = {
      cardId: newCardId(),
      entity,
      pinned: false,
      position,
      zIndex: ++zCounter,
      collapsed: false,
    };
    set({ cards: [...kept, card] });
    return true;
  },

  dismissCard: (cardId) =>
    set((s) => ({ cards: s.cards.filter((c) => c.cardId !== cardId) })),

  togglePinCard: (cardId) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.cardId === cardId ? { ...c, pinned: !c.pinned } : c,
      ),
    })),

  moveCard: (cardId, x, y) =>
    set((s) => {
      const { w, h } = viewportSize();
      const clamped = clampPos(x, y, w, h);
      return {
        cards: s.cards.map((c) =>
          c.cardId === cardId ? { ...c, position: clamped } : c,
        ),
      };
    }),

  bringCardToFront: (cardId) =>
    set((s) => {
      const target = s.cards.find((c) => c.cardId === cardId);
      if (!target) return {};
      // Already on top? avoid a re-render loop.
      const maxZ = s.cards.reduce((m, c) => (c.zIndex > m ? c.zIndex : m), 0);
      if (target.zIndex >= maxZ) return {};
      return {
        cards: s.cards.map((c) =>
          c.cardId === cardId ? { ...c, zIndex: ++zCounter } : c,
        ),
      };
    }),

  toggleCollapseCard: (cardId) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.cardId === cardId ? { ...c, collapsed: !c.collapsed } : c,
      ),
    })),

  clampAllCards: (vw, vh) =>
    set((s) => ({
      cards: s.cards.map((c) => ({
        ...c,
        position: clampPos(c.position.x, c.position.y, vw, vh),
      })),
    })),

  viewport: { lat: 41.5, lon: -72.7, distNm: 250, bbox: null },
  setViewport: (v) => set({ viewport: v }),

  layerVisibility: {
    aircraft: true,
    vessels: true,
    satellites: true,
    jamming: false,
    restrictedAirspace: true,
    submarineCables: false,
    fires: false,
    quakes: false,
  },
  setLayerVisible: (layer, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layer]: visible },
    })),

  layerAvailability: {
    aircraft: true,
    vessels: true,
    satellites: true,
    jamming: true,
    restrictedAirspace: true,
    submarineCables: false,
    fires: true,
    quakes: false,
  },
  setLayerAvailable: (layer, available) =>
    set((state) => ({
      layerAvailability: { ...state.layerAvailability, [layer]: available },
    })),

  layerCounts: {
    aircraft: 0,
    vessels: 0,
    satellites: 0,
    jamming: 0,
    restrictedAirspace: 0,
    submarineCables: 0,
    fires: 0,
    quakes: 0,
  },
  setLayerCount: (layer, count) =>
    set((state) => ({
      layerCounts: { ...state.layerCounts, [layer]: count },
    })),

  timeOffsetMs: 0,
  setTimeOffsetMs: (ms) => set({ timeOffsetMs: ms }),

  theaterToast: null,
  showTheaterToast: ({ name, description }) =>
    set({
      theaterToast: { name, description, triggerId: ++toastCounter },
    }),
  clearTheaterToast: () => set({ theaterToast: null }),

  isTheaterFlying: false,
  setTheaterFlying: (flying) => set({ isTheaterFlying: flying }),

  playbackMode: "live",
  replayTimestamp_ms: null,
  replaySpeed: 1,
  replayPlaying: false,
  bufferRange: null,
  enterReplay: (timestamp_ms) =>
    set({
      playbackMode: "replay",
      replayTimestamp_ms: timestamp_ms,
      replayPlaying: false,
    }),
  exitReplay: () =>
    set({
      playbackMode: "live",
      replayTimestamp_ms: null,
      replayPlaying: false,
    }),
  setReplayTimestamp: (ms) => set({ replayTimestamp_ms: ms }),
  setReplaySpeed: (s) => set({ replaySpeed: s }),
  togglePlayPause: () =>
    set((state) => ({ replayPlaying: !state.replayPlaying })),
  setBufferRange: (range) => set({ bufferRange: range }),
}));

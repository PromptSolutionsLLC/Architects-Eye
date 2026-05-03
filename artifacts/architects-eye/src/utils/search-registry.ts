import type { ClickResult } from "./pick-resolvers";

export type SearchEntityType =
  | "aircraft"
  | "vessel"
  | "satellite"
  | "quake"
  | "cable";

export interface SearchResult {
  type: SearchEntityType;
  id: string;
  label: string;
  sublabel: string;
  /** 0 = exact case-insensitive, 1 = prefix, 2 = substring. Lower is better. */
  score: number;
}

export interface SearchProvider {
  /** Iterate this type's domain and return matching results. Caller is
   *  responsible for length-gating; provider just runs the match. */
  search(query: string): SearchResult[];
  /** Resolve a (type, id) pair back to the same { selected, fly } shape
   *  that the central click handler already consumes. Returns null if
   *  the entity has been removed (stale). */
  getClickResultById(id: string): ClickResult | null;
}

const providers = new Map<SearchEntityType, SearchProvider>();

export function registerSearchProvider(
  type: SearchEntityType,
  provider: SearchProvider,
): void {
  providers.set(type, provider);
}

export function unregisterSearchProvider(type: SearchEntityType): void {
  providers.delete(type);
}

export function getSearchProvider(
  type: SearchEntityType,
): SearchProvider | null {
  return providers.get(type) ?? null;
}

/** Substring match scorer. Returns -1 on no-match, lower is better.
 *  Both sides are upper-cased. Empty `text` never matches. */
export function scoreMatch(text: string, q: string): number {
  if (!text) return -1;
  const T = text.toUpperCase();
  const Q = q.toUpperCase();
  if (T === Q) return 0;
  if (T.startsWith(Q)) return 1;
  if (T.includes(Q)) return 2;
  return -1;
}

const TYPE_PRIORITY: Record<SearchEntityType, number> = {
  satellite: 0,
  aircraft: 1,
  vessel: 2,
  cable: 3,
  quake: 4,
};

const RESULT_CAP = 10;

export interface SearchAllResult {
  results: SearchResult[];
  totalMatches: number;
}

/** Run the query across all registered providers, gating satellites
 *  to length >= 3 to avoid a 15k-record scan on every keystroke.
 *  Returns up to RESULT_CAP results in priority order
 *  (satellite > aircraft > vessel > cable > quake), with within-type
 *  ties broken by match score. Also returns the total match count
 *  before capping so callers can render a "+N more" footer. */
export function searchAll(query: string): SearchAllResult {
  const q = query.trim();
  if (q.length === 0) return { results: [], totalMatches: 0 };

  const allMatches: SearchResult[] = [];

  for (const [type, provider] of providers) {
    if (type === "satellite" && q.length < 3) continue;
    let matches: SearchResult[];
    try {
      matches = provider.search(q);
    } catch (err) {
      console.warn("[SEARCH] provider failed", { type, err });
      continue;
    }
    allMatches.push(...matches);
  }

  allMatches.sort((a, b) => {
    const pa = TYPE_PRIORITY[a.type];
    const pb = TYPE_PRIORITY[b.type];
    if (pa !== pb) return pa - pb;
    if (a.score !== b.score) return a.score - b.score;
    return a.label.localeCompare(b.label);
  });

  return {
    results: allMatches.slice(0, RESULT_CAP),
    totalMatches: allMatches.length,
  };
}

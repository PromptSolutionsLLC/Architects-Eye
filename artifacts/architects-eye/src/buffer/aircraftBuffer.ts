// Rolling 6h aircraft position buffer backed by IndexedDB. Used by
// the Timeline replay scrubber. Buffer starts EMPTY on page load and
// fills as the live aircraft poll (12s cadence) writes new records.
// Eviction sweeps anything older than 6h every 5 minutes.

const DB_NAME = "architects-eye-buffer";
const STORE_NAME = "aircraft-positions";
const DB_VERSION = 1;
export const RETENTION_MS = 6 * 60 * 60 * 1000;
const EVICT_INTERVAL_MS = 5 * 60 * 1000;

export interface AircraftBufferRecord {
  id?: number;
  icao24: string;
  timestamp_ms: number;
  lat: number;
  lon: number;
  alt_baro_ft: number;
  ground_speed_kts: number;
  track_deg: number;
  callsign: string;
}

export interface BufferRange {
  earliest_ms: number;
  latest_ms: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let evictTimer: ReturnType<typeof setInterval> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("timestamp_ms", "timestamp_ms", { unique: false });
        store.createIndex("icao24", "icao24", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Write all aircraft from one poll cycle in a single transaction. */
export async function writeAircraftBatch(
  records: AircraftBufferRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const r of records) {
      store.add(r);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("buffer write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("buffer write aborted"));
  });
}

/** Aircraft considered "gone" if no buffer sample within this window.
 *  Live STALE_MS is 60s; we use 5x for replay so a temporarily-quiet
 *  aircraft still appears in the snapshot. The bound also caps the
 *  cursor scan at ~5min worth of records (~3.75k at 150ac × 12s polls)
 *  regardless of buffer size, keeping replay queries cheap. */
const REPLAY_PRESENCE_WINDOW_MS = 5 * 60 * 1000;

/** For each unique icao24 active in the recent window, return its most
 *  recent record with timestamp_ms <= queried time. Iterates the
 *  timestamp_ms index in descending order over a bounded range
 *  [timestamp_ms - REPLAY_PRESENCE_WINDOW_MS, timestamp_ms],
 *  accumulating first-seen-per-icao24. */
export async function getPositionsAtTime(
  timestamp_ms: number,
): Promise<Map<string, AircraftBufferRecord>> {
  const db = await openDb();
  // Diagnostic: capture buffer range alongside the query so we can
  // tell whether zero-result queries are caused by a too-tight window
  // or by the buffer simply not containing the queried timestamp.
  const bufferRange = await getBufferRange();
  return new Promise((resolve, reject) => {
    const result = new Map<string, AircraftBufferRecord>();
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("timestamp_ms");
    const windowStart = timestamp_ms - REPLAY_PRESENCE_WINDOW_MS;
    const windowEnd = timestamp_ms;
    const range = IDBKeyRange.bound(windowStart, windowEnd);
    const cursorReq = idx.openCursor(range, "prev");
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        console.log("[BUFFER QUERY]", {
          queryTs: timestamp_ms,
          windowStart,
          windowEnd,
          recordsFound: result.size,
          bufferRange: bufferRange
            ? {
                earliest: bufferRange.earliest_ms,
                latest: bufferRange.latest_ms,
              }
            : null,
        });
        resolve(result);
        return;
      }
      const rec = cursor.value as AircraftBufferRecord;
      if (!result.has(rec.icao24)) {
        result.set(rec.icao24, rec);
      }
      cursor.continue();
    };
    cursorReq.onerror = () =>
      reject(cursorReq.error ?? new Error("cursor failed"));
  });
}

/** All buffered records for one icao24 inside [fromMs, toMs], ordered
 *  ascending by timestamp_ms. Used to build the replay-mode trail
 *  polyline for the selected aircraft. */
export async function getTrailSamples(
  icao24: string,
  fromMs: number,
  toMs: number,
): Promise<AircraftBufferRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out: AircraftBufferRecord[] = [];
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("icao24");
    const cursorReq = idx.openCursor(IDBKeyRange.only(icao24));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        out.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
        resolve(out);
        return;
      }
      const rec = cursor.value as AircraftBufferRecord;
      if (rec.timestamp_ms >= fromMs && rec.timestamp_ms <= toMs) {
        out.push(rec);
      }
      cursor.continue();
    };
    cursorReq.onerror = () =>
      reject(cursorReq.error ?? new Error("cursor failed"));
  });
}

/** Earliest and latest record timestamps in the buffer, or null if empty. */
export async function getBufferRange(): Promise<BufferRange | null> {
  const db = await openDb();
  const earliest = await new Promise<number | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("timestamp_ms");
    const req = idx.openCursor(null, "next");
    req.onsuccess = () => {
      const c = req.result;
      resolve(c ? (c.value as AircraftBufferRecord).timestamp_ms : null);
    };
    req.onerror = () => reject(req.error);
  });
  if (earliest == null) return null;
  const latest = await new Promise<number | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("timestamp_ms");
    const req = idx.openCursor(null, "prev");
    req.onsuccess = () => {
      const c = req.result;
      resolve(c ? (c.value as AircraftBufferRecord).timestamp_ms : null);
    };
    req.onerror = () => reject(req.error);
  });
  if (latest == null) return null;
  return { earliest_ms: earliest, latest_ms: latest };
}

/** Delete every record older than (now - RETENTION_MS). Cheap range
 *  delete via the timestamp_ms index. */
export async function evictOldRecords(): Promise<number> {
  const threshold = Date.now() - RETENTION_MS;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let deleted = 0;
    const tx = db.transaction(STORE_NAME, "readwrite");
    const idx = tx.objectStore(STORE_NAME).index("timestamp_ms");
    const cursorReq = idx.openCursor(IDBKeyRange.upperBound(threshold));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      cursor.delete();
      deleted++;
      cursor.continue();
    };
    cursorReq.onerror = () =>
      reject(cursorReq.error ?? new Error("evict cursor failed"));
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error ?? new Error("evict tx failed"));
  });
}

/** Start the 5-minute eviction interval. Idempotent. */
export function startEvictionTimer(): void {
  if (evictTimer !== null) return;
  evictTimer = setInterval(() => {
    void evictOldRecords().catch((err) => {
      console.warn("[BUFFER] eviction failed:", err);
    });
  }, EVICT_INTERVAL_MS);
}

export function stopEvictionTimer(): void {
  if (evictTimer !== null) {
    clearInterval(evictTimer);
    evictTimer = null;
  }
}

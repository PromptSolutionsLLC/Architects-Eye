import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server as HttpServer } from "http";
import { logger } from "../lib/logger";

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const WS_PATH = "/api/ws/vessels";
const RESUBSCRIBE_DEBOUNCE_MS = 2_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 16_000;

interface BBox {
  swLat: number;
  swLon: number;
  neLat: number;
  neLon: number;
}

interface ClientState {
  ws: WebSocket;
  bbox: BBox | null;
}

interface AisStreamMetaData {
  MMSI?: number;
  latitude?: number;
  longitude?: number;
}

interface KnownPos {
  lat: number;
  lon: number;
  ts: number;
}

const POSITION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const POSITION_CACHE_PRUNE_INTERVAL_MS = 60 * 1000;

const clients = new Set<ClientState>();
const lastKnownPosByMmsi = new Map<number, KnownPos>();
let positionPruneTimer: NodeJS.Timeout | null = null;

function startPositionCachePruner(): void {
  if (positionPruneTimer) return;
  positionPruneTimer = setInterval(() => {
    const cutoff = Date.now() - POSITION_CACHE_TTL_MS;
    for (const [mmsi, p] of lastKnownPosByMmsi) {
      if (p.ts < cutoff) lastKnownPosByMmsi.delete(mmsi);
    }
  }, POSITION_CACHE_PRUNE_INTERVAL_MS);
  // Prevent the pruner from holding the event loop open during shutdown
  positionPruneTimer.unref?.();
}

let upstream: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let resubscribeTimer: NodeJS.Timeout | null = null;
let lastSubscriptionPayload: string | null = null;

function unionBBoxes(): [number, number][][] | null {
  let any = false;
  let swLat = 90;
  let swLon = 180;
  let neLat = -90;
  let neLon = -180;
  for (const c of clients) {
    if (!c.bbox) continue;
    any = true;
    swLat = Math.min(swLat, c.bbox.swLat);
    swLon = Math.min(swLon, c.bbox.swLon);
    neLat = Math.max(neLat, c.bbox.neLat);
    neLon = Math.max(neLon, c.bbox.neLon);
  }
  if (!any) return null;
  return [
    [
      [swLat, swLon],
      [neLat, neLon],
    ],
  ];
}

function vesselInBBox(lat: number, lon: number, b: BBox): boolean {
  if (lat < b.swLat || lat > b.neLat) return false;
  // antimeridian-safe lon test
  if (b.swLon <= b.neLon) {
    return lon >= b.swLon && lon <= b.neLon;
  }
  return lon >= b.swLon || lon <= b.neLon;
}

function sendSubscriptionToUpstream(): void {
  if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
  const apiKey = process.env["AISSTREAM_API_KEY"];
  if (!apiKey) return;
  const boxes = unionBBoxes();
  if (!boxes) return;
  const payload = {
    APIKey: apiKey,
    BoundingBoxes: boxes,
    // Strict whitelist: Class A position reports (Types 1/2/3), Class B
    // position reports (Type 18), and ShipStaticData (Type 5/24 — name,
    // ship type, callsign, destination). BaseStationReport (Type 4) and
    // AidsToNavigationReport (Type 21) are NOT in this whitelist, so the
    // stationary land-based transmitters that caused vessels-on-land are
    // dropped at the AISStream upstream and never reach the server.
    FilterMessageTypes: [
      "PositionReport",
      "StandardClassBPositionReport",
      "ShipStaticData",
    ],
  };
  const json = JSON.stringify(payload);
  if (json === lastSubscriptionPayload) return;
  lastSubscriptionPayload = json;
  upstream.send(json);
  logger.info({ boxes }, "[ais] subscription sent to AISStream");
}

function scheduleResubscribe(): void {
  if (resubscribeTimer) clearTimeout(resubscribeTimer);
  resubscribeTimer = setTimeout(() => {
    resubscribeTimer = null;
    sendSubscriptionToUpstream();
  }, RESUBSCRIBE_DEBOUNCE_MS);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (clients.size === 0) return; // no clients → nothing to reconnect for
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_MS,
  );
  reconnectAttempts++;
  logger.info({ delay, attempt: reconnectAttempts }, "[ais] reconnect scheduled");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectUpstream();
  }, delay);
}

function connectUpstream(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (upstream) return;
  logger.info("[ais] connecting to AISStream upstream");
  const ws = new WebSocket(AISSTREAM_URL);
  upstream = ws;

  ws.on("open", () => {
    reconnectAttempts = 0;
    lastSubscriptionPayload = null;
    sendSubscriptionToUpstream();
    logger.info("[ais] upstream connected");
  });

  ws.on("message", (raw: RawData) => {
    const text = raw.toString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    forwardToClients(parsed, text);
  });

  ws.on("close", (code, reason) => {
    logger.warn({ code, reason: reason.toString() }, "[ais] upstream closed");
    if (upstream === ws) upstream = null;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    logger.error({ err }, "[ais] upstream error");
  });
}

function forwardToClients(msg: unknown, raw: string): void {
  if (!msg || typeof msg !== "object") return;
  const md = (msg as { MetaData?: AisStreamMetaData }).MetaData;
  const mmsi = md?.MMSI;
  let lat = md?.latitude;
  let lon = md?.longitude;

  // Update / consult MMSI position cache so we can attribute static messages.
  if (typeof mmsi === "number") {
    if (typeof lat === "number" && typeof lon === "number") {
      lastKnownPosByMmsi.set(mmsi, { lat, lon, ts: Date.now() });
    } else {
      const cached = lastKnownPosByMmsi.get(mmsi);
      if (cached) {
        lat = cached.lat;
        lon = cached.lon;
      }
    }
  }

  // No spatial attribution possible → drop (per-spec: forwarding must be
  // filtered by client bbox; we don't broadcast unknown-location messages).
  if (typeof lat !== "number" || typeof lon !== "number") return;

  for (const c of clients) {
    if (!c.bbox) continue;
    if (!vesselInBBox(lat, lon, c.bbox)) continue;
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(raw);
  }
}

export function setupVesselWebSocket(server: HttpServer): void {
  if (!process.env["AISSTREAM_API_KEY"]) {
    logger.warn(
      "[ais] AISSTREAM_API_KEY not set — vessel WebSocket disabled",
    );
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const path = url.split("?")[0];
    if (path !== WS_PATH) {
      // Not our route. There are no other upgrade handlers in this app, so
      // explicitly destroy the socket to avoid leaking the half-open upgrade
      // connection.
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const state: ClientState = { ws, bbox: null };
    clients.add(state);
    logger.info({ clientCount: clients.size }, "[ais] client connected");

    // Lazy-connect upstream on first client
    if (!upstream && clients.size === 1) {
      connectUpstream();
    }

    ws.on("message", (raw: RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { type?: string }).type !== "bbox"
      )
        return;
      const b = (parsed as { bbox?: Partial<BBox> }).bbox;
      if (
        !b ||
        typeof b.swLat !== "number" ||
        typeof b.swLon !== "number" ||
        typeof b.neLat !== "number" ||
        typeof b.neLon !== "number"
      )
        return;
      state.bbox = {
        swLat: b.swLat,
        swLon: b.swLon,
        neLat: b.neLat,
        neLon: b.neLon,
      };
      scheduleResubscribe();
    });

    ws.on("close", () => {
      clients.delete(state);
      logger.info(
        { clientCount: clients.size },
        "[ais] client disconnected",
      );
      scheduleResubscribe();
      if (clients.size === 0 && upstream) {
        try {
          upstream.close();
        } catch {
          /* noop */
        }
        upstream = null;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }
    });

    ws.on("error", (err) => {
      logger.warn({ err }, "[ais] client socket error");
    });
  });

  startPositionCachePruner();
  logger.info({ path: WS_PATH }, "[ais] vessel WebSocket route mounted");
}

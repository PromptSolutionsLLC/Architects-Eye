import { useStore } from "../store";

export interface BBox {
  swLat: number;
  swLon: number;
  neLat: number;
  neLon: number;
}

export interface VesselPosition {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  heading: number;
  ts: number;
}

export interface VesselStatic {
  mmsi: number;
  name: string;
  type: number;
  callsign: string;
  destination: string;
  flag: string;
}

export interface VesselListeners {
  position?: (p: VesselPosition) => void;
  staticData?: (s: VesselStatic) => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 16_000;
const VIEWPORT_DEBOUNCE_MS = 1_000;
const FAILURE_THRESHOLD = 3;

function midToFlag(mmsi: number): string {
  const mid = Math.floor(mmsi / 1_000_000);
  // Subset of the most common Maritime Identification Digits
  const map: Record<number, string> = {
    201: "AL", 202: "AD", 203: "AT", 205: "BE", 206: "BY", 207: "BG",
    208: "VA", 209: "CY", 210: "CY", 211: "DE", 212: "CY", 213: "GE",
    214: "MD", 215: "MT", 216: "AM", 218: "DE", 219: "DK", 220: "DK",
    224: "ES", 225: "ES", 226: "FR", 227: "FR", 228: "FR", 229: "MT",
    230: "FI", 231: "FO", 232: "GB", 233: "GB", 234: "GB", 235: "GB",
    236: "GI", 237: "GR", 238: "HR", 239: "GR", 240: "GR", 241: "GR",
    242: "MA", 243: "HU", 244: "NL", 245: "NL", 246: "NL", 247: "IT",
    248: "MT", 249: "MT", 250: "IE", 251: "IS", 252: "LI", 253: "LU",
    254: "MC", 255: "PT", 256: "MT", 257: "NO", 258: "NO", 259: "NO",
    261: "PL", 262: "ME", 263: "PT", 264: "RO", 265: "SE", 266: "SE",
    267: "SK", 268: "SM", 269: "CH", 270: "CZ", 271: "TR", 272: "UA",
    273: "RU", 274: "MK", 275: "LV", 276: "EE", 277: "LT", 278: "SI",
    279: "RS", 301: "AI", 303: "US", 304: "AG", 305: "AG", 306: "CW",
    307: "AW", 308: "BS", 309: "BS", 310: "BM", 311: "BS", 312: "BZ",
    314: "BB", 316: "CA", 319: "KY", 321: "CR", 323: "CU", 325: "DM",
    327: "DO", 329: "GP", 330: "GD", 331: "GL", 332: "GT", 334: "HN",
    336: "HT", 338: "US", 339: "JM", 341: "KN", 343: "LC", 345: "MX",
    347: "MQ", 348: "MS", 350: "NI", 351: "PA", 352: "PA", 353: "PA",
    354: "PA", 355: "PA", 356: "PA", 357: "PA", 358: "PR", 359: "SV",
    361: "PM", 362: "TT", 364: "TC", 366: "US", 367: "US", 368: "US",
    369: "US", 370: "PA", 371: "PA", 372: "PA", 373: "PA", 374: "PA",
    375: "VC", 376: "VC", 377: "VC", 378: "VG", 379: "VI", 401: "AF",
    403: "SA", 405: "BD", 408: "BH", 410: "BT", 412: "CN", 413: "CN",
    414: "CN", 416: "TW", 417: "LK", 419: "IN", 422: "IR", 423: "AZ",
    425: "IQ", 428: "IL", 431: "JP", 432: "JP", 434: "TM", 436: "KZ",
    437: "UZ", 438: "JO", 440: "KR", 441: "KR", 443: "PS", 445: "KP",
    447: "KW", 450: "LB", 451: "KG", 453: "MO", 455: "MV", 457: "MN",
    459: "NP", 461: "OM", 463: "PK", 466: "QA", 468: "SY", 470: "AE",
    472: "TJ", 473: "YE", 475: "YE", 477: "HK", 478: "BA", 501: "AQ",
    503: "AU", 506: "MM", 508: "BN", 510: "FM", 511: "PW", 512: "NZ",
    514: "KH", 515: "KH", 516: "CX", 518: "CK", 520: "FJ", 523: "CC",
    525: "ID", 529: "KI", 531: "LA", 533: "MY", 536: "MP", 538: "MH",
    540: "NC", 542: "NU", 544: "NR", 546: "PF", 548: "PH", 553: "PG",
    555: "PN", 557: "SB", 559: "AS", 561: "WS", 563: "SG", 564: "SG",
    565: "SG", 566: "SG", 567: "TH", 570: "TO", 572: "TV", 574: "VN",
    576: "VU", 577: "VU", 578: "WF", 601: "ZA", 603: "AO", 605: "DZ",
    607: "TF", 608: "IO", 609: "BI", 610: "BJ", 611: "BW", 612: "CF",
    613: "CM", 615: "CG", 616: "KM", 617: "CV", 618: "AQ", 619: "CI",
    620: "KM", 621: "DJ", 622: "EG", 624: "ET", 625: "ER", 626: "GA",
    627: "GH", 629: "GM", 630: "GW", 631: "GQ", 632: "GN", 633: "BF",
    634: "KE", 635: "AQ", 636: "LR", 637: "LR", 638: "SS", 642: "LY",
    644: "LS", 645: "MU", 647: "MG", 649: "ML", 650: "MZ", 654: "MR",
    655: "MW", 656: "NE", 657: "NG", 659: "NA", 660: "RE", 661: "RW",
    662: "SD", 663: "SN", 664: "SC", 665: "SH", 666: "SO", 667: "SL",
    668: "ST", 669: "SZ", 670: "TD", 671: "TG", 672: "TN", 674: "TZ",
    675: "UG", 676: "CD", 677: "TZ", 678: "ZM", 679: "ZW", 701: "AR",
    710: "BR", 720: "BO", 725: "CL", 730: "CO", 735: "EC", 740: "FK",
    745: "GF", 750: "GY", 755: "PY", 760: "PE", 765: "SR", 770: "UY",
    775: "VE",
  };
  return map[mid] ?? "";
}

export class AISStreamClient {
  private ws: WebSocket | null = null;
  private listeners: VesselListeners = {};
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private viewportTimer: number | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private destroyed = false;
  private failureCount = 0;
  private hadOpen = false;
  private lastSentBBoxJson: string | null = null;
  private failureCallbacks = new Set<() => void>();

  on(listeners: VesselListeners): void {
    Object.assign(this.listeners, listeners);
  }

  onPermanentFailure(cb: () => void): void {
    this.failureCallbacks.add(cb);
  }

  hasFailed(): boolean {
    return this.failureCount >= FAILURE_THRESHOLD && !this.hadOpen;
  }

  connect(): void {
    if (this.destroyed) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/ws/vessels`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.warn("[AIS] WebSocket construction failed", err);
      this.notifyFailure();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.hadOpen = true;
      this.reconnectAttempts = 0;
      this.failureCount = 0;
      this.lastSentBBoxJson = null;
      this.sendBBoxFromStore();
      this.subscribeViewport();
    };

    socket.onmessage = (e) => this.onMessage(e);

    socket.onclose = () => {
      this.ws = null;
      if (!this.hadOpen) this.failureCount++;
      if (this.destroyed) return;
      if (this.hasFailed()) {
        this.notifyFailure();
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = (e) => {
      console.warn("[AIS] socket error", e);
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    if (this.viewportTimer != null) window.clearTimeout(this.viewportTimer);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }

  private notifyFailure(): void {
    for (const cb of this.failureCallbacks) {
      try {
        cb();
      } catch {
        /* noop */
      }
    }
  }

  private subscribeViewport(): void {
    if (this.unsubscribeStore) return;
    let lastBBoxJson = "";
    this.unsubscribeStore = useStore.subscribe((state) => {
      const bbox = state.viewport.bbox;
      if (!bbox) return;
      const json = JSON.stringify(bbox);
      if (json === lastBBoxJson) return;
      lastBBoxJson = json;
      if (this.viewportTimer != null) window.clearTimeout(this.viewportTimer);
      this.viewportTimer = window.setTimeout(() => {
        this.viewportTimer = null;
        this.sendBBoxFromStore();
      }, VIEWPORT_DEBOUNCE_MS);
    });
  }

  private sendBBoxFromStore(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const bbox = useStore.getState().viewport.bbox;
    if (!bbox) return;
    const json = JSON.stringify(bbox);
    if (json === this.lastSentBBoxJson) return;
    this.lastSentBBoxJson = json;
    this.ws.send(JSON.stringify({ type: "bbox", bbox }));
  }

  private onMessage(e: MessageEvent): void {
    let msg: unknown;
    try {
      msg = typeof e.data === "string" ? JSON.parse(e.data) : null;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as {
      MessageType?: string;
      MetaData?: {
        MMSI?: number;
        ShipName?: string;
        latitude?: number;
        longitude?: number;
      };
      Message?: {
        PositionReport?: {
          Cog?: number;
          Sog?: number;
          TrueHeading?: number;
          Latitude?: number;
          Longitude?: number;
        };
        ShipStaticData?: {
          Name?: string;
          Type?: number;
          CallSign?: string;
          Destination?: string;
        };
      };
    };

    const md = m.MetaData;
    if (!md || typeof md.MMSI !== "number") return;
    const mmsi = md.MMSI;

    if (m.MessageType === "PositionReport") {
      const r = m.Message?.PositionReport;
      if (!r) return;
      const lat = typeof md.latitude === "number" ? md.latitude : r.Latitude;
      const lon = typeof md.longitude === "number" ? md.longitude : r.Longitude;
      if (typeof lat !== "number" || typeof lon !== "number") return;
      this.listeners.position?.({
        mmsi,
        lat,
        lon,
        sog: r.Sog ?? 0,
        cog: r.Cog ?? 0,
        heading: r.TrueHeading ?? r.Cog ?? 0,
        ts: Date.now(),
      });
    } else if (m.MessageType === "ShipStaticData") {
      const s = m.Message?.ShipStaticData;
      if (!s) return;
      this.listeners.staticData?.({
        mmsi,
        name: (md.ShipName || s.Name || "").trim(),
        type: s.Type ?? 0,
        callsign: (s.CallSign || "").trim(),
        destination: (s.Destination || "").trim(),
        flag: midToFlag(mmsi),
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer != null) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export function decodeShipType(type: number): string {
  if (type >= 70 && type <= 79) return "Cargo";
  if (type >= 80 && type <= 89) return "Tanker";
  if (type >= 60 && type <= 69) return "Passenger";
  if (type >= 30 && type <= 39) {
    if (type === 30) return "Fishing";
    if (type === 31 || type === 32) return "Towing";
    if (type === 33) return "Dredging";
    if (type === 34) return "Diving Ops";
    if (type === 35) return "Military";
    if (type === 36) return "Sailing";
    if (type === 37) return "Pleasure Craft";
    return "Other (30-39)";
  }
  if (type >= 40 && type <= 49) return "High Speed Craft";
  if (type >= 50 && type <= 59) return "Special Service";
  if (type >= 90 && type <= 99) return "Other";
  if (type === 0) return "Unknown";
  return `Type ${type}`;
}

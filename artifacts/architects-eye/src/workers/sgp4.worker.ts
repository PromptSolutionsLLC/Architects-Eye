/// <reference lib="webworker" />
import * as satellite from "satellite.js";
import type { TleEntry } from "../utils/tle";

type SatRec = ReturnType<typeof satellite.twoline2satrec>;

interface InitMessage {
  type: "init";
  tles: TleEntry[];
}

interface TickMessage {
  type: "tick";
  time: number; // milliseconds since epoch
}

type InboundMessage = InitMessage | TickMessage;

let satrecs: Array<SatRec | null> = [];

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;
  if (msg.type === "init") {
    satrecs = msg.tles.map((t) => {
      try {
        const rec = satellite.twoline2satrec(t.line1, t.line2);
        // Some malformed records produce satrec objects flagged with non-zero error
        if (rec && (rec as { error?: number }).error) return null;
        return rec;
      } catch {
        return null;
      }
    });
    ctx.postMessage({ type: "ready", count: satrecs.length });
    return;
  }

  if (msg.type === "tick") {
    const date = new Date(msg.time);
    const gmst = satellite.gstime(date);
    const out = new Float32Array(satrecs.length * 4);
    let written = 0;

    for (let i = 0; i < satrecs.length; i++) {
      const rec = satrecs[i];
      if (!rec) continue;
      let pv;
      try {
        pv = satellite.propagate(rec, date);
      } catch {
        continue;
      }
      if (!pv || !pv.position || typeof pv.position === "boolean") continue;

      const gd = satellite.eciToGeodetic(pv.position, gmst);
      const off = written * 4;
      out[off] = i;
      out[off + 1] = gd.longitude;
      out[off + 2] = gd.latitude;
      out[off + 3] = gd.height;
      written++;
    }

    const trimmed = out.slice(0, written * 4);
    ctx.postMessage(
      { type: "positions", buffer: trimmed.buffer, count: written },
      [trimmed.buffer],
    );
  }
};

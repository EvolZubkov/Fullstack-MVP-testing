/**
 * @module shared/sim/protocol-codec
 *
 * The run protocol in a form the LMS report can carry.
 *
 * Owner requirement 2026-10-08: everything the analytics takes from telemetry and from a web run
 * must also reach the LMS and come back with its report export. The run protocol is what scenes,
 * typical errors and the miss map are built from, so it travels as `sim_<questionId>_<n>`
 * pseudo-interactions next to `scale_*` and `var_*`.
 *
 * Only the INPUTS of the run are written: actions and refusals by id, misses by coordinates,
 * committed values, exit and timeout, each with its time. Entering scenes, hints and goals are
 * derived by the engine, and the import restores them by replaying the inputs against the scenario
 * (`replayRun`) — the same way the server already re-derives a web run. This keeps the protocol
 * several times shorter than the full event list.
 *
 * Text form, version 1: `1;<event>;<event>;…`, where an event is a letter, its payload and
 * `@<time>` — milliseconds since the previous written event, base 36:
 *
 * - `a<id>` — action, `b<id>` — refused action;
 * - `m<x>,<y>` — miss at stage coordinates;
 * - `v<field>=<value>` — committed value;
 * - `x` — exit, `o` — timeout;
 * - `z` — the end of the run, last: its time makes the duration, which a replay cannot know (the
 *   run ends after its last input — on the goal screen, or later on exit).
 *
 * Ids, fields and values are escaped: `%`, `;`, `@`, `=`, `,`, `~` and whitespace become `%XX`.
 * Whitespace matters because the report parser trims cells, and a chunk boundary may fall on it.
 *
 * Chunks. The string is cut into chunks of {@link CHUNK_SIZE} characters, each prefixed with `~`:
 * a cell of digits alone could otherwise be read back as a number and lose its leading zeros.
 * A protocol longer than {@link MAX_CHUNKS} chunks is not written at all — a cut protocol cannot
 * be replayed, and the outcome and counts still travel in the question's own interaction.
 *
 * Pure and framework-free: the package gets it through the `TBTemplate` bundle.
 */
import type { SimEvent } from "./contract";

/** Format version, the first field of the encoded string. */
export const PROTOCOL_CODEC_VERSION = 1;
/** Characters of protocol per pseudo-interaction, without the `~` marker. */
export const CHUNK_SIZE = 250;
/** The most chunks one run may take; a longer protocol is not written. */
export const MAX_CHUNKS = 40;
/** Prefix of the pseudo-interaction ids: `sim_<questionId>_<n>`, `n` from 1. */
export const SIM_PROTOCOL_PREFIX = "sim_";

const CHUNK_MARK = "~";

/** An input event of the protocol — what a replay needs. */
export type ProtocolInput = Extract<SimEvent, { type: "action" | "blocked" | "miss" | "value" | "exit" | "timeout" }>;

/** A decoded protocol. */
export interface DecodedProtocol {
  events: ProtocolInput[];
  /** Duration of the run, ms; `null` — the end marker was not written. */
  durationMs: number | null;
}

/** `%XX` for a Latin-1 character, `%uXXXX` beyond it (Unicode whitespace). */
function escape(text: string): string {
  return String(text).replace(/[%;@=,~\s]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return code > 0xff ? `%u${code.toString(16).padStart(4, "0")}` : `%${code.toString(16).padStart(2, "0")}`;
  });
}

function unescape(text: string): string {
  return text.replace(/%u([0-9a-f]{4})|%([0-9a-f]{2})/gi, (_, wide: string | undefined, hex: string | undefined) =>
    String.fromCharCode(parseInt((wide ?? hex) as string, 16)));
}

/**
 * Encode the inputs of a protocol.
 *
 * @param events The full protocol of a run, as the engine wrote it.
 * @param durationMs Duration of the run (`SimResult.durationMs`); written as the end marker.
 * @returns The encoded string; an empty string when there is nothing to write.
 */
export function encodeProtocol(events: readonly SimEvent[] | null | undefined, durationMs?: number | null): string {
  if (!Array.isArray(events)) return "";
  const parts: string[] = [];
  let last = 0;
  for (const event of events) {
    if (!event || typeof event.t !== "number") continue;
    let body: string;
    switch (event.type) {
      case "action": body = `a${escape(event.id)}`; break;
      case "blocked": body = `b${escape(event.id)}`; break;
      case "miss": body = `m${escape(String(event.x))},${escape(String(event.y))}`; break;
      case "value": body = `v${escape(event.field)}=${escape(event.value)}`; break;
      case "exit": body = "x"; break;
      case "timeout": body = "o"; break;
      default: continue;
    }
    const t = Math.max(0, Math.round(event.t));
    parts.push(`${body}@${Math.max(0, t - last).toString(36)}`);
    last = Math.max(last, t);
  }
  if (parts.length === 0) return "";
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
    parts.push(`z@${Math.max(0, Math.round(durationMs) - last).toString(36)}`);
  }
  return `${PROTOCOL_CODEC_VERSION};${parts.join(";")}`;
}

/**
 * Decode an encoded protocol back into input events.
 *
 * Scene names are not carried — the replay knows the scene itself — so the decoded events have an
 * empty `scene`.
 *
 * @param encoded The string {@link encodeProtocol} produced.
 * @returns The input events in order and the duration, or `null` when the string is not a
 *   protocol of a known version or is damaged: a partly read protocol would replay into a
 *   different run.
 */
export function decodeProtocol(encoded: string | null | undefined): DecodedProtocol | null {
  if (typeof encoded !== "string" || encoded === "") return null;
  const [version, ...items] = encoded.split(";");
  if (version !== String(PROTOCOL_CODEC_VERSION)) return null;
  const out: ProtocolInput[] = [];
  let durationMs: number | null = null;
  let t = 0;
  for (const item of items) {
    // The end marker closes the protocol: nothing may follow it.
    if (durationMs !== null) return null;
    const at = item.lastIndexOf("@");
    if (at < 1) return null;
    const delta = parseInt(item.slice(at + 1), 36);
    if (!Number.isFinite(delta) || delta < 0) return null;
    t += delta;
    const kind = item.charAt(0);
    const body = item.slice(1, at);
    switch (kind) {
      case "a":
      case "b": {
        if (!body) return null;
        out.push(kind === "a"
          // The role is not carried: the replay triggers by id, and the engine knows the role.
          ? { t, type: "action", scene: "", id: unescape(body), role: "path" }
          : { t, type: "blocked", scene: "", id: unescape(body) });
        break;
      }
      case "m": {
        const [xs, ys] = body.split(",");
        const x = Number(unescape(xs ?? ""));
        const y = Number(unescape(ys ?? ""));
        if (xs === undefined || ys === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        out.push({ t, type: "miss", scene: "", x, y });
        break;
      }
      case "v": {
        const eq = body.indexOf("=");
        if (eq < 1) return null;
        out.push({ t, type: "value", scene: "", field: unescape(body.slice(0, eq)), value: unescape(body.slice(eq + 1)), correct: null });
        break;
      }
      case "x":
        out.push({ t, type: "exit" });
        break;
      case "o":
        out.push({ t, type: "timeout" });
        break;
      case "z":
        if (body) return null;
        durationMs = t;
        break;
      default:
        return null;
    }
  }
  return { events: out, durationMs };
}

/**
 * Cut an encoded protocol into the responses of its pseudo-interactions.
 *
 * @param encoded The string {@link encodeProtocol} produced.
 * @returns Chunks in order, each prefixed with `~`; empty when there is nothing to write or the
 *   protocol is longer than {@link MAX_CHUNKS} chunks.
 */
export function protocolChunks(encoded: string): string[] {
  if (!encoded) return [];
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) chunks.push(CHUNK_MARK + encoded.slice(i, i + CHUNK_SIZE));
  return chunks.length > MAX_CHUNKS ? [] : chunks;
}

/**
 * Join chunks read back from the report.
 *
 * @param chunks Chunk number (from 1) -> cell value.
 * @returns The encoded protocol, or `null` when a chunk is missing or not marked: a protocol with
 *   a hole cannot be replayed.
 */
export function joinProtocolChunks(chunks: Record<number, string>): string | null {
  const numbers = Object.keys(chunks).map(Number).sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  let out = "";
  for (let i = 0; i < numbers.length; i += 1) {
    if (numbers[i] !== i + 1) return null;
    const cell = chunks[numbers[i]];
    if (typeof cell !== "string" || !cell.startsWith(CHUNK_MARK)) return null;
    out += cell.slice(CHUNK_MARK.length);
  }
  return out;
}

/**
 * Parse a pseudo-interaction id of the protocol.
 *
 * @param id Interaction id from the report.
 * @returns The question and chunk number, or `null` for any other id.
 */
export function parseProtocolInteractionId(id: string): { questionId: string; n: number } | null {
  const match = /^sim_(.+)_(\d+)$/.exec(id);
  if (!match) return null;
  const n = Number(match[2]);
  return n >= 1 ? { questionId: match[1], n } : null;
}

/**
 * The few things Bun, Node.js (26.10+) and txiki.js do differently, behind one API, so the rest
 * of the app only imports node:* modules (which Tarve shims on txiki.js) and this file.
 *   FFI          bun:ffi · node:ffi · tjs:ffi (published by Tarve's txiki prelude)
 *   TCP probe    node:net on Bun/Node; tjs.connect on txiki.js (its node:net shim is pipes only)
 *   zip entries  DecompressionStream("gzip") everywhere, CRC checked natively (txiki's zlib shim has no raw inflate)
 */
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { closeSync, openSync, writeSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export type Runtime = "bun" | "node" | "txiki";

const g = globalThis as Record<string, any>;

export const RUNTIME: Runtime = g.__tarveTxikiFfi ? "txiki" : (process.versions as Record<string, string | undefined>).bun ? "bun" : "node";

// ---------------------------------------------------------------------------
// FFI
// ---------------------------------------------------------------------------

/**
 * `buffer`: a Uint8Array whose bytes the callee reads/writes (pass the whole array: txiki.js
 * ignores a view's offset). `ptr`: an opaque handle a function returned, or null.
 */
export type FfiType = "void" | "i32" | "u32" | "i64" | "ptr" | "buffer";
export interface FfiSymbol {
  args: readonly FfiType[];
  returns: FfiType;
}
export type FfiFunctions<S> = { [K in keyof S]: (...args: any[]) => any };

const NODE_TYPES: Record<FfiType, string> = { void: "void", i32: "int32", u32: "uint32", i64: "int64", ptr: "pointer", buffer: "buffer" };

/** Open a system library with the runtime's FFI and bind `symbols`. */
export function dlopen<S extends Record<string, FfiSymbol>>(library: string, symbols: S): FfiFunctions<S> {
  if (RUNTIME === "txiki") {
    const fns = g.__tarveTxikiFfi.dlopen(library, symbols).symbols as FfiFunctions<S>;
    // tjs:ffi takes 64-bit integers as numbers (a BigInt throws), Bun and Node as BigInt
    for (const [name, s] of Object.entries(symbols)) {
      if (!s.args.includes("i64")) continue;
      const fn = fns[name as keyof S];
      fns[name as keyof S] = (...a: unknown[]) => fn(...a.map((v, i) => (s.args[i] === "i64" && typeof v === "bigint" ? Number(v) : v)));
    }
    return fns;
  }
  const require = createRequire(import.meta.url);
  if (RUNTIME === "bun") return (require("bun:ffi") as { dlopen(l: string, s: object): { symbols: FfiFunctions<S> } }).dlopen(library, symbols).symbols;
  const definitions = Object.fromEntries(
    Object.entries(symbols).map(([name, s]) => [name, { arguments: s.args.map((t) => NODE_TYPES[t]), return: NODE_TYPES[s.returns] }]),
  );
  return (require("node:ffi") as { dlopen(l: string, s: object): { functions: FfiFunctions<S> } }).dlopen(library, definitions).functions;
}

/** A `ptr` result that is NULL: Bun gives null/0, Node 0n, txiki.js a pointer object. */
export function isNullPtr(p: unknown): boolean {
  if (p == null || p === 0 || p === 0n) return true;
  if (typeof p === "object") {
    const o = p as { isNull?: boolean; addr?: bigint | number };
    return o.isNull === true || (o.addr !== undefined && BigInt(o.addr) === 0n);
  }
  return false;
}

/** NUL-terminated UTF-16 for W APIs, in its own ArrayBuffer (no pooled Buffer offset). */
export function wide(s: string): Uint8Array {
  const u = new Uint16Array(s.length + 1);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Uint8Array(u.buffer);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** appendFileSync (txiki.js's node:fs shim has none). */
export function appendText(path: string, data: string | Uint8Array): void {
  const fd = openSync(path, "a");
  try {
    writeSync(fd, typeof data === "string" ? new TextEncoder().encode(data) : data);
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Compression / checksums
// ---------------------------------------------------------------------------

/**
 * A zip entry's bytes (method 0 stored, 8 deflate), CRC-32 and size checked natively: the data is
 * wrapped as a gzip member carrying the entry's CRC and size, and the gunzip verifies both. No JS-side CRC pass: on txiki.js (QuickJS) that
 * costs ~8 MB/s and blocks the event loop for the length of a MariaDB unzip.
 */
export async function inflateZipEntry(raw: Uint8Array, method: 0 | 8, crc: number, size: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = [new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])];
  if (method === 8) parts.push(raw);
  else {
    // stored data as raw-deflate stored blocks: [BFINAL] [LEN] [~LEN] bytes, at most 65535 each
    for (let o = 0; o === 0 || o < raw.length; o += 65535) {
      const n = Math.min(65535, raw.length - o);
      const h = new Uint8Array(5);
      const v = new DataView(h.buffer);
      h[0] = o + n >= raw.length ? 1 : 0;
      v.setUint16(1, n, true);
      v.setUint16(3, ~n & 0xffff, true);
      parts.push(h, raw.subarray(o, o + n));
    }
  }
  const trailer = new Uint8Array(8);
  const tv = new DataView(trailer.buffer);
  tv.setUint32(0, crc >>> 0, true);
  tv.setUint32(4, size >>> 0, true);
  parts.push(trailer);
  const member = new Blob(parts as Uint8Array<ArrayBuffer>[]);
  // txiki.js's DecompressionStream skips the gzip trailer check; its node:zlib (Tarve's native
  // miniz_oxide) verifies it, synchronously but in native code
  const out = RUNTIME === "txiki" ? gunzipSync(new Uint8Array(await member.arrayBuffer())) : new Uint8Array(await new Response(member.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  if (out.byteLength !== size) throw new Error(`size ${out.byteLength} instead of ${size}`);
  return out;
}

let crcTable: Uint32Array | undefined;
/** CRC-32 in JS (zip writers, tests); extraction checks it natively (inflateZipEntry). */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  const t = crcTable;
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

interface TjsConnection {
  readonly opened: Promise<unknown>;
  close(): void;
}

/** Whether something accepts TCP connections on host:port within `timeoutMs`. */
export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    // the deadline is wall-clock: libuv's cached loop time is stale after a long synchronous
    // stretch, and a plain setTimeout would then fire at once and report a live port as closed
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (ms: number) => {
      timer = setTimeout(() => (Date.now() >= deadline ? finish(false) : arm(deadline - Date.now())), ms);
    };
    arm(timeoutMs);
    if (RUNTIME === "txiki") {
      const tjs = g.tjs as { connect(t: "tcp", h: string, p: number): Promise<TjsConnection> };
      tjs.connect("tcp", host, port).then(
        async (c) => {
          try {
            await c.opened;
            finish(true);
          } catch {
            finish(false);
          } finally {
            try {
              c.close();
            } catch {
              /* already closed */
            }
          }
        },
        () => finish(false),
      );
      return;
    }
    const sock = createConnection({ host, port });
    sock.once("connect", () => {
      finish(true);
      sock.destroy();
    });
    sock.setTimeout(timeoutMs + 1000, () => sock.destroy());
    sock.once("error", () => {
      finish(false);
      sock.destroy();
    });
    sock.once("close", () => finish(false));
  });
}

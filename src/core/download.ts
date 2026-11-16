/**
 * Dependency-free downloader and zip extractor (no curl.exe / tar.exe):
 * only fetch and DecompressionStream, so it works on any Windows the app runs on, under Bun,
 * Node.js or txiki.js.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { createHash } from "node:crypto";
import { inflateZipEntry } from "./runtime";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DownloadOptions {
  onProgress?: (received: number, total: number) => void;
  /** Expected SHA-256 (hex); the file is rejected when it differs. */
  sha256?: string;
  /** Attempts before giving up (resuming each time). Default 8. */
  retries?: number;
  /** Abort and retry when no byte arrives for this long. Default 30 s. */
  stallMs?: number;
}

/**
 * Download `url` to `dest`. Bytes go to `dest.part`; a retry resumes it with an HTTP Range
 * request (when the server answers 206) and the file is renamed only once complete.
 */
export async function download(url: string, dest: string, opts: DownloadOptions = {}): Promise<string> {
  const part = dest + ".part";
  const retries = opts.retries ?? 8;
  const stallMs = opts.stallMs ?? 30_000;
  mkdirSync(dirname(dest), { recursive: true });
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(15_000, 1000 * 2 ** (attempt - 1)));
    const have = existsSync(part) ? statSync(part).size : 0;
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(new Error("No response from server")), stallMs);
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort(new Error(`Download stalled for ${stallMs / 1000}s`)), stallMs);
    };
    let fd: number | undefined;
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": "Vela-stack-manager", ...(have > 0 ? { Range: `bytes=${have}-` } : {}) },
      });
      // 416 with "bytes */<size>" = <have>: the partial is the whole file (an earlier attempt
      // finished downloading but stopped before the rename)
      const complete = res.status === 416 && have > 0 && Number(/\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1]) === have;
      if (res.status === 416 && have > 0 && !complete) {
        rmSync(part, { force: true }); // our partial is bigger than the file: start over
        throw new Error("Invalid partial file");
      }
      if (complete) {
        await res.body?.cancel().catch(() => {});
        opts.onProgress?.(have, have);
      } else if (!res.ok || !res.body) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          lastErr = err;
          break; // 404 etc.: retrying won't help
        }
        throw err;
      } else {
        const resumed = res.status === 206 && have > 0;
        let received = resumed ? have : 0;
        const len = Number(res.headers.get("content-length") ?? 0);
        const total = len > 0 ? len + received : 0;
        fd = openSync(part, resumed ? "a" : "w");
        opts.onProgress?.(received, total);
        let lastReport = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          kick();
          writeSync(fd, chunk);
          received += chunk.byteLength;
          if (Date.now() - lastReport > 200) {
            lastReport = Date.now();
            opts.onProgress?.(received, total);
          }
        }
        closeSync(fd);
        fd = undefined;
        if (total && received !== total) throw new Error(`Connection dropped (${received} of ${total} bytes)`);
        opts.onProgress?.(received, total || received);
      }
      if (opts.sha256) {
        const got = createHash("sha256").update(readFileSync(part)).digest("hex");
        if (got.toLowerCase() !== opts.sha256.toLowerCase()) {
          rmSync(part, { force: true });
          throw new Error(`SHA-256 mismatch (expected ${opts.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…)`);
        }
      }
      rmSync(dest, { force: true });
      renameSync(part, dest);
      return dest;
    } catch (err) {
      lastErr = ctrl.signal.aborted ? ctrl.signal.reason : err;
    } finally {
      clearTimeout(timer);
      if (fd !== undefined) closeSync(fd);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Download failed: ${msg} — ${url}`);
}

// ---------------------------------------------------------------------------
// Zip (stored + deflate, zip64), zip-slip safe, CRC-checked
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compSize: number;
  size: number;
  offset: number;
}

function readEntries(bytes: Uint8Array): ZipEntry[] {
  const buf = le(bytes);
  // End of central directory: last 22 bytes + up to 64 KB comment
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid zip (end of directory not found)");
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  // zip64 locator sits right before the EOCD
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) throw new Error("Invalid zip64");
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Invalid zip (central directory)");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let compSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    // zip64 extended info: only the fields that are 0xFFFFFFFF are present, in this order
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) (size = Number(buf.readBigUInt64LE(q))), (q += 8);
        if (compSize === 0xffffffff) (compSize = Number(buf.readBigUInt64LE(q))), (q += 8);
        if (offset === 0xffffffff) offset = Number(buf.readBigUInt64LE(q));
      }
      e += 4 + len;
    }
    out.push({ name, method, crc, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Extract a .zip into `destDir`. Entries that would escape `destDir` are rejected. */
/** The little-endian reads of Buffer, over a DataView (txiki.js's Buffer has no 64-bit ones). */
function le(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    length: b.length,
    readUInt16LE: (o: number) => v.getUint16(o, true),
    readUInt32LE: (o: number) => v.getUint32(o, true),
    readBigUInt64LE: (o: number) => v.getBigUint64(o, true),
    toString: (enc: "utf8" | "latin1", s: number, e: number) =>
      enc === "utf8" ? new TextDecoder().decode(b.subarray(s, e)) : String.fromCharCode(...b.subarray(s, e)),
  };
}

export async function unzip(zipPath: string, destDir: string): Promise<number> {
  const bytes: Uint8Array = readFileSync(zipPath);
  const buf = le(bytes);
  const root = normalize(destDir + sep);
  mkdirSync(root, { recursive: true });
  let n = 0;
  for (const ent of readEntries(bytes)) {
    const target = normalize(join(root, ent.name));
    if (!target.startsWith(root)) throw new Error(`Zip with unsafe path: ${ent.name}`);
    if (ent.name.endsWith("/")) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    if (buf.readUInt32LE(ent.offset) !== 0x04034b50) throw new Error(`Invalid zip at ${ent.name}`);
    const start = ent.offset + 30 + buf.readUInt16LE(ent.offset + 26) + buf.readUInt16LE(ent.offset + 28);
    const raw = bytes.subarray(start, start + ent.compSize);
    if (ent.method !== 0 && ent.method !== 8) throw new Error(`Zip: compression method ${ent.method} not supported (${ent.name})`);
    let data: Uint8Array;
    try {
      data = await inflateZipEntry(raw, ent.method, ent.crc, ent.size); // a stream: UI stays responsive
    } catch (err) {
      throw new Error(`Corrupt zip: ${ent.name} (${err instanceof Error ? err.message : String(err)})`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    n++;
  }
  return n;
}

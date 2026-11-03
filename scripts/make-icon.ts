/**
 * Regenerates assets/icon.png (the app/exe icon) from the Tarve view in scripts/icon-view.tsx.
 * Tarve's capture is opaque, so the corners are cut here: a rounded-rect alpha mask, with the
 * edge colours un-premultiplied from the black capture background.
 *
 *   bun scripts/make-icon.ts
 */
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, rmSync } from "node:fs";

const tmp = "dist/icon-capture.png";
mkdirSync("dist", { recursive: true });
const p = Bun.spawn([process.execPath, "scripts/icon-view.tsx", tmp], { stdout: "inherit", stderr: "inherit" });
if ((await p.exited) !== 0) throw new Error("icon capture failed");

const src = Buffer.from(await Bun.file(tmp).arrayBuffer());
rmSync(tmp, { force: true });
const W = src.readUInt32BE(16);
const H = src.readUInt32BE(20);
if (src[24] !== 8 || src[25] !== 6) throw new Error("expected 8-bit RGBA PNG");
const chunks: Buffer[] = [];
for (let o = 8; o < src.length; ) {
  const len = src.readUInt32BE(o);
  if (src.toString("ascii", o + 4, o + 8) === "IDAT") chunks.push(src.subarray(o + 8, o + 8 + len));
  o += 12 + len;
}
const raw = inflateSync(Buffer.concat(chunks));
const stride = W * 4;
const px = Buffer.alloc(H * stride);
for (let y = 0; y < H; y++) {
  const f = raw[y * (stride + 1)]!;
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  for (let x = 0; x < stride; x++) {
    const a = x >= 4 ? px[y * stride + x - 4]! : 0;
    const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
    const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4]! : 0;
    const v = line[x]!;
    const pr = a + b - c;
    const pa = Math.abs(pr - a), pb = Math.abs(pr - b), pc = Math.abs(pr - c);
    const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][f]!) & 0xff;
  }
}

// rounded square as laid out in icon-view.tsx (inset 8, radius 56 at 256 px), scaled to the capture
const k = W / 256;
const inset = 8 * k, size = W - 2 * inset, rad = 56 * k;
const inside = (x: number, y: number) => {
  const dx = Math.max(Math.abs(x - W / 2) - (size / 2 - rad), 0);
  const dy = Math.max(Math.abs(y - H / 2) - (size / 2 - rad), 0);
  return dx * dx + dy * dy <= rad * rad;
};
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
    const a = n / 16;
    const i = y * stride + x * 4;
    for (let ch = 0; ch < 3; ch++) px[i + ch] = a > 0 ? Math.min(255, Math.round(px[i + ch]! / a)) : 0;
    px[i + 3] = Math.round(a * 255);
  }

const rows = Buffer.alloc(H * (stride + 1));
for (let y = 0; y < H; y++) px.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
const crc = (buf: Buffer) => Bun.hash.crc32(buf) >>> 0;
const chunk = (type: string, data: Buffer) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
mkdirSync("assets", { recursive: true });
await Bun.write(
  "assets/icon.png",
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]),
);
console.log(`assets/icon.png ${W}×${H}`);

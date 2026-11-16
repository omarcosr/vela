/**
 * Exercises everything src/core/runtime.ts abstracts, on whichever runtime runs it:
 *   bun scripts/runtime-check.ts
 *   node node_modules/@tarve/core/dist/npm/cli.js run scripts/runtime-check.ts --runtime node
 *   tarve build scripts/runtime-check.ts --runtime txiki --outfile dist/check.exe && dist\check.exe
 * Exits 1 when a check fails.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RUNTIME, appendText, crc32 } from "../src/core/runtime";
import { processPath, readUserDword, tcpListenerPids, tcpPortPid } from "../src/core/win";
import { exec, portOpen, running, spawnDetached, stopProcess, sysTool } from "../src/core/proc";
import { unzip } from "../src/core/download";

const results: [string, boolean, string][] = [];
async function check(name: string, fn: () => unknown | Promise<unknown>, ok: (v: any) => boolean) {
  try {
    const v = await fn();
    results.push([name, ok(v), JSON.stringify(v)?.slice(0, 90) ?? String(v)]);
  } catch (e) {
    results.push([name, false, "threw: " + (e instanceof Error ? e.message : String(e))]);
  }
}

/** A one-entry zip (deflate) built with CompressionStream. */
async function makeZip(name: string, content: Uint8Array, method: 0 | 8 = 8, crcXor = 0): Promise<Uint8Array> {
  const comp = method === 0 ? content : new Uint8Array(await new Response(new Blob([content as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const n = new TextEncoder().encode(name);
  const crc = (crc32(content) ^ crcXor) >>> 0;
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, method, true);
  lv.setUint32(14, crc, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, content.length, true); lv.setUint16(26, n.length, true);
  local.set(n, 30);
  const cd = new Uint8Array(46 + n.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, method, true);
  cv.setUint32(16, crc, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, content.length, true); cv.setUint16(28, n.length, true);
  cd.set(n, 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true); ev.setUint32(16, local.length + comp.length, true);
  const out = new Uint8Array(local.length + comp.length + cd.length + eocd.length);
  out.set(local, 0); out.set(comp, local.length); out.set(cd, local.length + comp.length); out.set(eocd, local.length + comp.length + cd.length);
  return out;
}

const dir = join(tmpdir(), `vela-runtime-check-${RUNTIME}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

await check("crc32('123456789')", () => crc32(new TextEncoder().encode("123456789")).toString(16), (v) => v === "cbf43926");
await check("tcpListenerPids(135)", () => tcpListenerPids(135), (v) => v.length > 0);
await check("tcpPortPid(135)", () => tcpPortPid(135), (v) => typeof v === "number" && v > 0);
await check("tcpPortPid(1)", () => tcpPortPid(1), (v) => v === null);
await check("readUserDword(Themes\\Personalize)", () => readUserDword("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme"), (v) => v === 0 || v === 1);
await check("readUserDword(missing)", () => readUserDword("Software\\VelaNope", "x"), (v) => v === null);
await check("processPath(4 = System)", () => processPath(4), (v) => typeof v === "string");
await check("exec(cmd /c echo)", async () => (await exec([sysTool("cmd.exe"), "/c", "echo", "hello"])).stdout.trim(), (v) => v === "hello");
await check("exec stdin", async () => (await exec([sysTool("findstr.exe"), "x"], { stdin: "axb\r\nnope\r\n" })).stdout.trim(), (v) => v === "axb");
await check("exec exit code", async () => (await exec([sysTool("cmd.exe"), "/c", "exit", "3"])).code, (v) => v === 3);
await check("exec missing exe rejects", async () => exec(["C:\\nope\\nope.exe"]).then(() => "resolved", () => "rejected"), (v) => v === "rejected");
await check("exec timeout", async () => (await exec([sysTool("ping.exe"), "-n", "20", "127.0.0.1"], { timeoutMs: 500 })).code, (v) => v !== 0);
await check("portOpen(135)", () => portOpen(135), (v) => v === true);
await check("portOpen(1)", () => portOpen(1, "127.0.0.1", 800), (v) => v === false);
await check("spawnDetached + processPath + log", async () => {
  const log = join(dir, "ping.log");
  const rp = spawnDetached("check", sysTool("ping.exe"), ["-n", "3", "127.0.0.1"], { logFile: log });
  await new Promise((r) => setTimeout(r, 1200));
  const path = processPath(rp.child.pid!);
  await stopProcess("check", 3000);
  await new Promise((r) => setTimeout(r, 300));
  return { path: path.split("\\").pop(), logged: readFileSync(log, "utf8").includes("127.0.0.1"), left: running.size };
}, (v) => /^ping\.exe$/i.test(v.path) && v.logged && v.left === 0);
await check("appendText", () => {
  const f = join(dir, "a.txt");
  appendText(f, "one\n");
  appendText(f, "two\n");
  return readFileSync(f, "utf8");
}, (v) => v === "one\ntwo\n");
await check("unzip (deflate + crc)", async () => {
  const body = new TextEncoder().encode("Vela ".repeat(5000));
  writeFileSync(join(dir, "t.zip"), await makeZip("sub/t.txt", body));
  const n = await unzip(join(dir, "t.zip"), join(dir, "out"));
  return { n, same: readFileSync(join(dir, "out", "sub", "t.txt"), "utf8") === "Vela ".repeat(5000) };
}, (v) => v.n === 1 && v.same);
await check("unzip (stored, > 64 KiB, and empty)", async () => {
  const body = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff);
  writeFileSync(join(dir, "s.zip"), await makeZip("s.bin", body, 0));
  writeFileSync(join(dir, "e.zip"), await makeZip("e.txt", new Uint8Array(0), 0));
  await unzip(join(dir, "s.zip"), join(dir, "s"));
  await unzip(join(dir, "e.zip"), join(dir, "e"));
  const got = readFileSync(join(dir, "s", "s.bin"));
  return { same: got.length === body.length && got.every((b, i) => b === body[i]), empty: readFileSync(join(dir, "e", "e.txt")).length };
}, (v) => v.same && v.empty === 0);
await check("unzip rejects a bad CRC (deflate and stored)", async () => {
  const body = new TextEncoder().encode("corrupt? ".repeat(100));
  const r: string[] = [];
  for (const m of [8, 0] as const) {
    writeFileSync(join(dir, `bad${m}.zip`), await makeZip("x.txt", body, m, 1));
    r.push(await unzip(join(dir, `bad${m}.zip`), join(dir, `bad${m}`)).then(() => "accepted", (e) => (/Corrupt zip/.test(String(e)) ? "rejected" : String(e))));
  }
  return r;
}, (v) => v.every((x: string) => x === "rejected"));
/** PowerShell reporting whether its own console window is visible (none at all = hidden). */
const PS_VIS = "Add-Type -Name W -Namespace V -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern System.IntPtr GetConsoleWindow(); [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(System.IntPtr h);'; $h=[V.W]::GetConsoleWindow(); if ($h -eq [IntPtr]::Zero -or -not [V.W]::IsWindowVisible($h)) { 'hidden' } else { 'visible' }";
const ps = sysTool("WindowsPowerShell\\v1.0\\powershell.exe");
await check("exec: no visible console window", async () => (await exec([ps, "-NoProfile", "-Command", PS_VIS], { timeoutMs: 30000 })).stdout.trim(), (v) => v === "hidden");
await check("spawnDetached (service): no visible console window", async () => {
  const log = join(dir, "vis.log");
  spawnDetached("vis", ps, ["-NoProfile", "-Command", PS_VIS], { logFile: log });
  for (let i = 0; i < 300 && running.has("vis"); i++) await new Promise((r) => setTimeout(r, 100));
  return readFileSync(log, "utf8").trim();
}, (v) => v === "hidden");
await check("portOpen right after 1.5 s of synchronous work", async () => {
  const end = Date.now() + 1500;
  while (Date.now() < end) crc32(new Uint8Array(4096));
  return portOpen(135, "127.0.0.1", 700);
}, (v) => v === true);

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r[1]);
console.log(`runtime: ${RUNTIME}`);
for (const [name, ok, detail] of results) console.log(`${ok ? "ok  " : "FAIL"} ${name}  ${detail}`);
console.log(failed.length ? `${failed.length} failed` : "all passed");
process.exit(failed.length ? 1 : 0);

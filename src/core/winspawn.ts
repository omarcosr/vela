/**
 * Child processes started with CreateProcessW through the runtime's FFI, always CREATE_NO_WINDOW:
 * txiki.js's tjs.spawn has no windowsHide, so every console program (php, mysqladmin, taskkill,
 * reg, certutil…) flashed a cmd window. stdio goes to files (NUL, a log, or temp files read once
 * the process exited), so no pipe can fill and stall the child. Exit is detected by polling the
 * process handle. Children join a kill-on-close job, as libuv's do on Bun and Node.js.
 */
import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dlopen, wide } from "./runtime";

type K = ReturnType<typeof load>;
let k: K | undefined;
function load() {
  return dlopen("kernel32.dll", {
    CreateFileW: { args: ["buffer", "u32", "u32", "buffer", "u32", "u32", "i64"], returns: "i64" },
    CreateProcessW: { args: ["i64", "buffer", "i64", "i64", "i32", "u32", "buffer", "buffer", "buffer", "buffer"], returns: "i32" },
    WaitForSingleObject: { args: ["i64", "u32"], returns: "u32" },
    GetExitCodeProcess: { args: ["i64", "buffer"], returns: "i32" },
    TerminateProcess: { args: ["i64", "u32"], returns: "i32" },
    CloseHandle: { args: ["i64"], returns: "i32" },
    GetLastError: { args: [], returns: "u32" },
    CreateJobObjectW: { args: ["i64", "i64"], returns: "i64" },
    SetInformationJobObject: { args: ["i64", "u32", "buffer", "u32"], returns: "i32" },
    AssignProcessToJobObject: { args: ["i64", "i64"], returns: "i32" },
  });
}

const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const FILE_APPEND_DATA = 0x4;
const SHARE_ALL = 7;
const OPEN_EXISTING = 3;
const OPEN_ALWAYS = 4;
const CREATE_ALWAYS = 2;
const STARTF_USESHOWWINDOW = 0x1;
const STARTF_USESTDHANDLES = 0x100;
const CREATE_UNICODE_ENVIRONMENT = 0x400;
const CREATE_NO_WINDOW = 0x08000000;
const CREATE_NEW_CONSOLE = 0x10;
const CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
const STILL_ACTIVE = 259;
const big = (v: unknown) => BigInt(v as number | bigint);
const INVALID = -1n;

/** One argument for CommandLineToArgvW, quoted as libuv does. */
function quote(a: string): string {
  if (a && !/[\s"]/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/, "$1$1")}"`;
}

/** An inheritable handle (SECURITY_ATTRIBUTES.bInheritHandle) on a file. */
function openInheritable(path: string, mode: "read" | "write" | "append"): bigint {
  const sa = new Uint8Array(24);
  const v = new DataView(sa.buffer);
  v.setUint32(0, 24, true);
  v.setInt32(16, 1, true);
  const access = mode === "read" ? GENERIC_READ : mode === "write" ? GENERIC_WRITE : FILE_APPEND_DATA;
  const disp = mode === "read" ? OPEN_EXISTING : mode === "write" ? CREATE_ALWAYS : OPEN_ALWAYS;
  const h = big(k!.CreateFileW(wide(path), access, SHARE_ALL, sa, disp, 0x80, 0n));
  if (h === INVALID || h === 0n || h === 0xffffffffffffffffn) throw Object.assign(new Error(`cannot open ${path} (Windows error ${k!.GetLastError()})`), { code: "EIO" });
  return h;
}

let job: bigint | undefined;
/** A job that ends its processes when Vela exits (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE). */
function killOnCloseJob(): bigint {
  if (job !== undefined) return job;
  job = big(k!.CreateJobObjectW(0n, 0n));
  if (job !== 0n) {
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION (144 bytes on x64): BasicLimitInformation.LimitFlags at 16
    const info = new Uint8Array(144);
    new DataView(info.buffer).setUint32(16, 0x2000 | 0x800, true); // KILL_ON_JOB_CLOSE | BREAKAWAY_OK
    k!.SetInformationJobObject(job, 9, info, 144);
  }
  return job;
}

export interface HiddenSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** File for stdin; default NUL. */
  stdinFile?: string;
  /** stdout and stderr: appended to one file, or written to two (truncated). Default NUL. */
  logFile?: string;
  stdoutFile?: string;
  stderrFile?: string;
  /** A visible console of its own (a terminal the user asked for) instead of none. */
  newConsole?: boolean;
  /** Leave Vela's job: the process outlives Vela. */
  detached?: boolean;
}

/** The part of node's ChildProcess the app uses. */
export class HiddenChild extends EventEmitter {
  pid?: number;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  readonly stdin = null;
  readonly stdout = null;
  readonly stderr = null;
  /** @internal */ handle?: bigint;

  kill(): boolean {
    if (this.handle === undefined || this.exitCode !== null) return false;
    const ok = !!k!.TerminateProcess(this.handle, 1);
    if (ok) {
      this.killed = true;
      this.signalCode = "SIGTERM";
    }
    return ok;
  }

  unref(): this {
    return this;
  }
  ref(): this {
    return this;
  }
}

const live = new Set<HiddenChild>();
let poller: ReturnType<typeof setInterval> | undefined;
function poll() {
  const code = new Uint8Array(4);
  for (const c of live) {
    if (k!.WaitForSingleObject(c.handle!, 0) !== 0) continue;
    k!.GetExitCodeProcess(c.handle!, code);
    const n = new DataView(code.buffer).getUint32(0, true);
    live.delete(c);
    k!.CloseHandle(c.handle!);
    c.exitCode = c.killed ? null : n === STILL_ACTIVE ? 0 : n;
    c.emit("exit", c.exitCode, c.signalCode);
    c.emit("close", c.exitCode, c.signalCode);
  }
  if (live.size === 0 && poller) {
    clearInterval(poller);
    poller = undefined;
  }
}

/** Start a program with no window. Failures arrive as an "error" event, like node's spawn. */
export function spawnHidden(command: string, args: readonly string[], opts: HiddenSpawnOptions = {}): HiddenChild {
  k ??= load();
  const child = new HiddenChild();
  const handles: bigint[] = [];
  try {
    const stdin = openInheritable(opts.stdinFile ?? "NUL", "read");
    handles.push(stdin);
    let out: bigint;
    let err: bigint;
    if (opts.logFile) {
      out = err = openInheritable(opts.logFile, "append");
      handles.push(out);
    } else {
      out = openInheritable(opts.stdoutFile ?? "NUL", opts.stdoutFile ? "write" : "append");
      err = openInheritable(opts.stderrFile ?? "NUL", opts.stderrFile ? "write" : "append");
      handles.push(out, err);
    }
    // STARTUPINFOW (104 bytes on x64): dwFlags at 60, wShowWindow at 64, std handles at 80/88/96
    const si = new Uint8Array(104);
    const sv = new DataView(si.buffer);
    sv.setUint32(0, 104, true);
    if (opts.newConsole) sv.setUint32(60, 0, true);
    else {
      sv.setUint32(60, STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW, true);
      sv.setUint16(64, 0, true); // SW_HIDE, for GUI programs too
      sv.setBigInt64(80, stdin, true);
      sv.setBigInt64(88, out, true);
      sv.setBigInt64(96, err, true);
    }
    const pi = new Uint8Array(24);
    const env = opts.env ?? process.env;
    const block = Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined).map(([a, b]) => `${a}=${b}\0`).join("") + "\0";
    const line = [command, ...args].map(quote).join(" ");
    const flags = CREATE_UNICODE_ENVIRONMENT | (opts.newConsole ? CREATE_NEW_CONSOLE : CREATE_NO_WINDOW) | (opts.detached ? CREATE_BREAKAWAY_FROM_JOB : 0);
    const start = (f: number) => k!.CreateProcessW(0n, wide(line), 0n, 0n, opts.newConsole ? 0 : 1, f, wide(block), wide(opts.cwd ?? process.cwd()), si, pi);
    if (!start(flags) && !(opts.detached && start(flags & ~CREATE_BREAKAWAY_FROM_JOB))) {
      const code = k.GetLastError();
      const missing = code === 2 || code === 3;
      const e = Object.assign(new Error(`spawn ${command} ${missing ? "ENOENT" : `failed (Windows error ${code})`}`), { code: missing ? "ENOENT" : "EIO", errno: -code, path: command });
      queueMicrotask(() => child.emit("error", e));
      return child;
    }
    const pv = new DataView(pi.buffer);
    const hProcess = pv.getBigInt64(0, true);
    k.CloseHandle(pv.getBigInt64(8, true));
    child.pid = pv.getUint32(16, true);
    if (opts.detached) k.CloseHandle(hProcess);
    else {
      const j = killOnCloseJob();
      if (j !== 0n) k.AssignProcessToJobObject(j, hProcess);
      child.handle = hProcess;
      live.add(child);
      poller ??= setInterval(poll, 100);
    }
    queueMicrotask(() => child.emit("spawn"));
  } catch (e) {
    queueMicrotask(() => child.emit("error", e));
  } finally {
    for (const h of new Set(handles)) k.CloseHandle(h);
  }
  return child;
}

let seq = 0;
let swept = false;
/** Temp files a grandchild still held (it inherited the handle) when its exec finished. */
function sweep(dir: string) {
  swept = true;
  try {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (Date.now() - statSync(p).mtimeMs > 3_600_000) rmSync(p, { force: true });
    }
  } catch {
    /* nothing to sweep */
  }
}
/** Run to completion: stdout/stderr through temp files, read after the exit. */
export async function execHidden(
  command: string,
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; stdin?: string; timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const dir = join(tmpdir(), "vela-exec");
  mkdirSync(dir, { recursive: true });
  if (!swept) sweep(dir);
  const base = join(dir, `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const files = { in: `${base}.in`, out: `${base}.out`, err: `${base}.err` };
  if (opts.stdin !== undefined) writeFileSync(files.in, opts.stdin);
  try {
    const child = spawnHidden(command, args, { cwd: opts.cwd, env: opts.env, stdinFile: opts.stdin !== undefined ? files.in : undefined, stdoutFile: files.out, stderrFile: files.err });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 15000);
      child.once("error", (e) => (clearTimeout(timer), reject(e)));
      child.once("exit", (c: number | null) => (clearTimeout(timer), resolve(c)));
    });
    const read = (p: string) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return "";
      }
    };
    return { code, stdout: read(files.out), stderr: read(files.err) };
  } finally {
    for (const f of Object.values(files)) rmSync(f, { force: true });
  }
}

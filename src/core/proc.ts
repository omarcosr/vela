import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { processPath, tcpPortPid } from "./win";
import { RUNTIME, tcpProbe } from "./runtime";
import { execHidden, spawnHidden } from "./winspawn";

/** Absolute path of a Windows system tool: never resolved through PATH (missing or hijacked entries). */
export function sysTool(exe: string): string {
  return join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32", exe);
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a helper program to completion without blocking the UI thread and without a console
 * window (`windowsHide`). Every short-lived child process in the app goes through here.
 */
export async function exec(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; stdin?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  // txiki.js's spawn can't hide the console window: CreateProcessW with CREATE_NO_WINDOW instead
  if (RUNTIME === "txiki") return execHidden(cmd[0]!, cmd.slice(1), { ...opts, env: opts.env ? { ...process.env, ...opts.env } : undefined });
  const child = spawn(cmd[0]!, cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    stdio: [opts.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const collect = (s: NodeJS.ReadableStream | null) =>
    new Promise<string>((resolve) => {
      if (!s) return resolve("");
      const chunks: Uint8Array[] = [];
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        let n = 0;
        for (const c of chunks) n += c.byteLength;
        const all = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) (all.set(c, o), (o += c.byteLength));
        resolve(new TextDecoder().decode(all));
      };
      s.on("data", (c: Uint8Array | string) => chunks.push(typeof c === "string" ? new TextEncoder().encode(c) : c));
      s.on("end", end);
      s.on("close", end);
      s.on("error", end);
    });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 15000);
  try {
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
    const [stdout, stderr, code] = await Promise.all([collect(child.stdout), collect(child.stderr), exited]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

export interface RunningProcess {
  child: ChildProcess;
  service: string;
  startedAt: number;
  logFile: string;
  /** Spawn failure (exe missing, blocked by AV, …). */
  error?: string;
  /** The service answered on its port at least once (a later exit is a crash, not a failed start). */
  confirmed?: boolean;
  /** Vela asked it to stop (graceful command or kill): its exit is expected. */
  stopping?: boolean;
}

type ExitListener = (service: string, code: number | null) => void;
const exitListeners = new Set<ExitListener>();

/** Called when a confirmed process exits without Vela asking it to (a real crash). */
export function onUnexpectedExit(listener: ExitListener): () => void {
  exitListeners.add(listener);
  return () => exitListeners.delete(listener);
}

/** Flag every process of a service as up (after its port answered). */
export function markConfirmed(service: string): void {
  for (const k of managedNames(service)) running.get(k)!.confirmed = true;
}

/** Flag every process of a service as being stopped on purpose (before nginx -s quit, mysqladmin…). */
export function markStopping(service: string): void {
  for (const k of managedNames(service)) running.get(k)!.stopping = true;
}

/** All child processes currently managed by this app, keyed by service name. */
export const running = new Map<string, RunningProcess>();

export function spawnDetached(
  service: string,
  exe: string,
  args: string[],
  opts: { cwd?: string; logFile: string; env?: Record<string, string> },
): RunningProcess {
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const env = { ...process.env, ...(opts.env ?? {}) };
  // txiki.js: no windowsHide and no fd stdio in tjs.spawn; CreateProcessW writes straight to the log
  const hidden = RUNTIME === "txiki";
  const logFd = hidden ? undefined : openSync(opts.logFile, "a");
  const child = hidden
    ? (spawnHidden(exe, args, { cwd: opts.cwd, env, logFile: opts.logFile }) as unknown as ChildProcess)
    : spawn(exe, args, { cwd: opts.cwd, env, stdio: ["ignore", logFd!, logFd!], windowsHide: true, detached: false });
  const rp: RunningProcess = { child, service, startedAt: Date.now(), logFile: opts.logFile };
  running.set(service, rp);
  // a missing/blocked exe emits "error" instead of throwing; unhandled it would crash the app
  child.on("error", (err) => {
    rp.error = err.message;
    if (running.get(service) === rp) running.delete(service);
  });
  child.on("exit", (code) => {
    if (running.get(service) === rp) running.delete(service);
    if (rp.confirmed && !rp.stopping) for (const l of exitListeners) l(service.split("#")[0]!, code);
    try {
      if (logFd !== undefined) closeSync(logFd);
    } catch {
      /* already closed */
    }
  });
  return rp;
}

export function isRunning(service: string): boolean {
  return managedNames(service).some((k) => {
    const rp = running.get(k);
    return !!rp && rp.child.exitCode === null && !rp.child.killed;
  });
}

export async function stopProcess(service: string, graceMs = 4000): Promise<void> {
  const rp = running.get(service);
  if (!rp) return;
  rp.stopping = true;
  running.delete(service);
  if (rp.child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, graceMs);
    rp.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    // child.kill() only ends the direct child on Windows; nginx leaves its workers behind.
    if (rp.child.pid) void killTree(rp.child.pid);
    else {
      try {
        rp.child.kill();
      } catch {
        /* already gone */
      }
    }
  });
}

/** Kill a process and every descendant (taskkill /T /F). */
export async function killTree(pid: number): Promise<void> {
  await exec([sysTool("taskkill.exe"), "/PID", String(pid), "/T", "/F"], { timeoutMs: 5000 });
}

/** Names of the managed processes of a service: "php", "php#1", … */
export function managedNames(service: string): string[] {
  return [...running.keys()].filter((k) => k === service || k.startsWith(service + "#"));
}

/** Check whether a TCP port is accepting connections on 127.0.0.1. */
export function portOpen(port: number, host = "127.0.0.1", timeoutMs = 1200): Promise<boolean> {
  return tcpProbe(host, port, timeoutMs);
}

export function fileExistsNonEmpty(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
}

export interface PortOwner {
  pid: number;
  /** Full executable path; "" when Windows won't tell us (elevated or another user's process). */
  path: string;
  /** File name of `path`, e.g. "com.docker.backend.exe"; "" when unknown. */
  image: string;
}

/** Which process serves a local TCP port (Win32 TCP table, no netstat). */
export async function portOwner(port: number): Promise<PortOwner | null> {
  const pid = tcpPortPid(port);
  if (!pid) return null;
  const path = processPath(pid);
  return { pid, path, image: path.slice(path.lastIndexOf("\\") + 1) };
}

/**
 * Small Win32 bindings through the runtime's FFI (runtime.ts: bun:ffi, node:ffi or tjs:ffi), so
 * polling needs no child processes: no netstat/tasklist/reg every refresh (each one a process
 * launch, a possible console flash and locale-dependent output).
 */
import { dlopen, isNullPtr, wide } from "./runtime";

const iphlpapi = dlopen("iphlpapi.dll", {
  GetExtendedTcpTable: { args: ["buffer", "buffer", "i32", "u32", "u32", "u32"], returns: "u32" },
});
const kernel32 = dlopen("kernel32.dll", {
  OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
  QueryFullProcessImageNameW: { args: ["ptr", "u32", "buffer", "buffer"], returns: "i32" },
  CloseHandle: { args: ["ptr"], returns: "i32" },
});
const advapi32 = dlopen("advapi32.dll", {
  // hkey: a predefined HKEY is a sign-extended LONG; pdwType unused (NULL)
  RegGetValueW: { args: ["i64", "buffer", "buffer", "u32", "ptr", "buffer", "buffer"], returns: "i32" },
});

const AF_INET = 2;
const AF_INET6 = 23;
const TCP_TABLE_OWNER_PID_ALL = 5;
const ERROR_INSUFFICIENT_BUFFER = 122;
const MIB_TCP_STATE_LISTEN = 2;
const MIB_TCP_STATE_ESTAB = 5;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const HKEY_CURRENT_USER = -2147483647n; // (HKEY)(LONG)0x80000001, sign-extended
const RRF_RT_REG_DWORD = 0x10;

/** A DWORD in/out parameter. */
function dword(value = 0): { buf: Uint8Array; get(): number; set(v: number): void } {
  const buf = new Uint8Array(4);
  const v = new DataView(buf.buffer);
  v.setUint32(0, value, true);
  return { buf, get: () => v.getUint32(0, true), set: (n) => v.setUint32(0, n, true) };
}

export interface TcpRow {
  localPort: number;
  state: number;
  /** No remote endpoint: a listening socket (some stacks report state 0 instead of LISTEN). */
  unconnected: boolean;
  pid: number;
}

function table(af: number): TcpRow[] {
  const size = dword(0);
  let buf = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const rc = iphlpapi.GetExtendedTcpTable(buf, size.buf, 0, af, TCP_TABLE_OWNER_PID_ALL, 0);
    if (rc === 0) break;
    if (rc !== ERROR_INSUFFICIENT_BUFFER) return [];
    buf = new Uint8Array(size.get() + 1024); // table can grow between the two calls
    size.set(buf.byteLength);
  }
  const v = new DataView(buf.buffer);
  const n = v.getUint32(0, true);
  const rows: TcpRow[] = [];
  // MIB_TCPROW_OWNER_PID: 6 DWORDs. MIB_TCP6ROW_OWNER_PID: 16+4+4+16+4+4+4+4 bytes.
  const stride = af === AF_INET ? 24 : 56;
  for (let i = 0; i < n; i++) {
    const o = 4 + i * stride;
    const [state, portRaw, pid, remotePort] =
      af === AF_INET
        ? [v.getUint32(o, true), v.getUint32(o + 8, true), v.getUint32(o + 20, true), v.getUint32(o + 16, true)]
        : [v.getUint32(o + 48, true), v.getUint32(o + 20, true), v.getUint32(o + 52, true), v.getUint32(o + 44, true)];
    rows.push({ state, pid, unconnected: remotePort === 0, localPort: ((portRaw & 0xff) << 8) | ((portRaw >> 8) & 0xff) });
  }
  return rows;
}

/**
 * PID serving a local TCP port: the LISTEN socket, else the server side of an ESTABLISHED
 * connection (Docker Desktop / WSL relays don't always expose a listener).
 */
export function tcpPortPid(port: number): number | null {
  const rows = [...table(AF_INET), ...table(AF_INET6)].filter((r) => r.localPort === port && r.pid > 0);
  return (rows.find((r) => r.state === MIB_TCP_STATE_LISTEN || (r.unconnected && r.state !== MIB_TCP_STATE_ESTAB)) ?? rows.find((r) => r.state === MIB_TCP_STATE_ESTAB))?.pid ?? null;
}

/** Every PID listening on a local TCP port (nginx: the master and each worker share the socket). */
export function tcpListenerPids(port: number): number[] {
  const rows = [...table(AF_INET), ...table(AF_INET6)].filter((r) => r.localPort === port && r.pid > 0 && (r.state === MIB_TCP_STATE_LISTEN || (r.unconnected && r.state !== MIB_TCP_STATE_ESTAB)));
  return [...new Set(rows.map((r) => r.pid))];
}

/** Full executable path of a process, or "" when it can't be opened (elevated / other user). */
export function processPath(pid: number): string {
  const h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (isNullPtr(h)) return "";
  try {
    const buf = new Uint8Array(2048);
    const len = dword(1024);
    if (!kernel32.QueryFullProcessImageNameW(h, 0, buf, len.buf)) return "";
    return String.fromCharCode(...new Uint16Array(buf.buffer, 0, len.get()));
  } finally {
    kernel32.CloseHandle(h);
  }
}

/** A REG_DWORD under HKEY_CURRENT_USER, or null. */
export function readUserDword(subkey: string, value: string): number | null {
  const data = dword(0);
  const size = dword(4);
  const rc = advapi32.RegGetValueW(HKEY_CURRENT_USER, wide(subkey), wide(value), RRF_RT_REG_DWORD, null, data.buf, size.buf);
  return rc === 0 ? data.get() : null;
}

/**
 * Small Win32 bindings via bun:ffi, so polling needs no child processes: no netstat/tasklist/reg
 * every refresh (each one a process launch, a possible console flash and locale-dependent output).
 */
import { dlopen, FFIType, ptr } from "bun:ffi";

const iphlpapi = dlopen("iphlpapi.dll", {
  GetExtendedTcpTable: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.u32 },
});
const kernel32 = dlopen("kernel32.dll", {
  OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
  QueryFullProcessImageNameW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
});
const advapi32 = dlopen("advapi32.dll", {
  RegGetValueW: { args: [FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
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

const wide = (s: string) => Buffer.from(s + "\0", "utf16le");

export interface TcpRow {
  localPort: number;
  state: number;
  /** No remote endpoint: a listening socket (some stacks report state 0 instead of LISTEN). */
  unconnected: boolean;
  pid: number;
}

function table(af: number): TcpRow[] {
  const size = new Uint32Array([0]);
  let buf = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const rc = iphlpapi.symbols.GetExtendedTcpTable(ptr(buf), ptr(size), 0, af, TCP_TABLE_OWNER_PID_ALL, 0);
    if (rc === 0) break;
    if (rc !== ERROR_INSUFFICIENT_BUFFER) return [];
    buf = new Uint8Array(size[0]! + 1024); // table can grow between the two calls
    size[0] = buf.byteLength;
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
  const h = kernel32.symbols.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!h) return "";
  try {
    const buf = new Uint16Array(1024);
    const len = new Uint32Array([buf.length]);
    if (!kernel32.symbols.QueryFullProcessImageNameW(h, 0, ptr(buf), ptr(len))) return "";
    return String.fromCharCode(...buf.subarray(0, len[0]));
  } finally {
    kernel32.symbols.CloseHandle(h);
  }
}

/** A REG_DWORD under HKEY_CURRENT_USER, or null. */
export function readUserDword(subkey: string, value: string): number | null {
  const data = new Uint32Array(1);
  const size = new Uint32Array([4]);
  const k = wide(subkey);
  const n = wide(value);
  const rc = advapi32.symbols.RegGetValueW(HKEY_CURRENT_USER, ptr(k), ptr(n), RRF_RT_REG_DWORD, null, ptr(data), ptr(size));
  return rc === 0 ? data[0]! : null;
}

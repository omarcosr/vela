/**
 * <site>.test domains: a marked block in the Windows hosts file. Writing it needs admin, so the
 * new file is staged in temp and copied by an elevated PowerShell (one UAC prompt, no console).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, sysTool } from "./proc";

const HOSTS = sysTool(join("drivers", "etc", "hosts"));
const BEGIN = "# >>> Vela sites (managed by Vela; do not edit between the markers)";
/** Marker written by older Portuguese builds; read as BEGIN so their block is still replaced. */
const LEGACY_BEGIN = "# >>> Vela sites (gerenciado pelo Vela; não edite entre as marcas)";
const END = "# <<< Vela sites";

function readHosts(): string {
  return readFileSync(HOSTS, "utf8").replace(LEGACY_BEGIN, BEGIN);
}

function withBlock(current: string, domains: string[]): string {
  const re = new RegExp(`\\r?\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`);
  const base = current.replace(re, "\r\n").replace(/(\r?\n)+$/, "");
  if (domains.length === 0) return base + "\r\n";
  const lines = domains.flatMap((d) => [`127.0.0.1 ${d}`, `::1 ${d}`]);
  return `${base}\r\n\r\n${BEGIN}\r\n${lines.join("\r\n")}\r\n${END}\r\n`;
}

/** Domains currently listed in the Vela block. */
function listed(current: string): string[] {
  const a = current.indexOf(BEGIN);
  const b = current.indexOf(END, a);
  if (a < 0 || b < 0) return [];
  return [...new Set(current.slice(a + BEGIN.length, b).split(/\r?\n/).map((l) => l.trim().split(/\s+/)[1]).filter((d): d is string => !!d))];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function hostsHas(domains: string[]): boolean {
  try {
    return sameSet(listed(readHosts()), domains);
  } catch {
    return false;
  }
}

/** Make the Vela block list exactly these domains. No-op (no UAC) when it already does. */
export async function syncHosts(domains: string[]): Promise<void> {
  const cur = readHosts();
  if (sameSet(listed(cur), domains)) return;
  const next = withBlock(cur, domains);
  const staged = join(tmpdir(), `vela-hosts-${process.pid}.txt`);
  writeFileSync(staged, next, "utf8");
  const q = (p: string) => p.replace(/'/g, "''");
  const inner = `Copy-Item -LiteralPath '${q(staged)}' -Destination '${q(HOSTS)}' -Force`;
  const ps = `Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',"${inner.replace(/"/g, '\\"')}"`;
  await exec([sysTool(join("WindowsPowerShell", "v1.0", "powershell.exe")), "-NoProfile", "-Command", ps], { timeoutMs: 120000 });
  if (!hostsHas(domains)) throw new Error("The hosts file was not changed (administrator permission denied?)");
}

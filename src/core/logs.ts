import { closeSync, openSync, readdirSync, readSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logsDir } from "./config";

export interface LogFile {
  name: string;
  size: number;
  modified: number;
}

export function listLogs(root: string): LogFile[] {
  const dir = logsDir(root);
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .filter((f) => !dropLegacy(dir, f))
      .map((name) => {
        const st = statSync(join(dir, name));
        return { name, size: st.size, modified: st.mtimeMs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function readLogTail(root: string, name: string, maxLines = 300): string {
  // sanitize: no path traversal
  if (/[\\/]/.test(name) || name.includes("..")) return "";
  return tailFile(join(logsDir(root), name), maxLines);
}

/** Last `maxLines` lines of a file, reading at most `maxBytes` from its end (logs grow unbounded). */
export function tailFile(path: string, maxLines = 300, maxBytes = 256 * 1024): string {
  let fd: number | undefined;
  try {
    const size = statSync(path).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fd = openSync(path, "r");
    readSync(fd, buf, 0, len, size - len);
    let lines = buf.toString("utf8").split(/\r?\n/);
    if (len < size) lines = lines.slice(1); // first line is probably cut
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Empty a log file (keeps it so running services can keep appending). */
export function clearLog(root: string, name: string): boolean {
  if (/[\\/]/.test(name) || name.includes("..")) return false;
  try {
    writeFileSync(join(logsDir(root), name), ""); // O_TRUNC, like truncateSync(…, 0)
    return true;
  } catch {
    return false;
  }
}

/** php-run-1..3.log came from an older version (one log per worker); remove them once empty. */
function dropLegacy(dir: string, name: string): boolean {
  if (!/^php-run-\d+\.log$/.test(name)) return false;
  try {
    if (statSync(join(dir, name)).size > 0) return false;
    unlinkSync(join(dir, name));
    return true;
  } catch {
    return false;
  }
}

/** Severity of a log line, from its [level] tag or, failing that, keywords. */
export type LogLevel = "all" | "warn" | "error";

const RE_ERR = /\b(error|fatal|crit(ical)?|emerg|alert|failed|exception)\b|\[ERROR\]/i;
const RE_WARN = /\b(warn(ing)?|notice|deprecated)\b/i;
const RE_TAG = /\[(error|err|fatal|crit|critical|emerg|alert|warn|warning|notice|note|info|debug)\]/i;
export function levelOf(l: string): LogLevel {
  // an explicit [level] tag (nginx, mariadb, php) wins over keywords in the message
  const tag = RE_TAG.exec(l)?.[1]?.toLowerCase();
  if (tag) return /^(error|err|fatal|crit|critical|emerg|alert)$/.test(tag) ? "error" : /^(warn|warning|notice)$/.test(tag) ? "warn" : "all";
  return RE_ERR.test(l) ? "error" : RE_WARN.test(l) ? "warn" : "all";
}

/** php.ini generation and running the PHP CLI (used for certificates, Composer and WP setup). */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { binDir, type Config } from "./config";
import { isInstalled } from "./installer";
import { exec, type ExecResult } from "./proc";

/**
 * OPcache: php.ini-development leaves it unloaded, so php-cgi compiled every file of the app on
 * every request (phpMyAdmin, Laravel and WordPress load hundreds). validate_timestamps stays on
 * with revalidate_freq=0, so edits show up on the next request.
 */
const OPCACHE_MARK = "; vela: opcache defaults applied";

function withOpcache(ini: string): string {
  return ini
    .replace(/^;zend_extension\s*=\s*opcache\s*$/m, "zend_extension=opcache")
    .replace(/^;opcache\.enable\s*=.*$/m, "opcache.enable=1")
    .replace(/^;opcache\.memory_consumption\s*=.*$/m, "opcache.memory_consumption=256")
    .replace(/^;opcache\.max_accelerated_files\s*=.*$/m, "opcache.max_accelerated_files=20000")
    .replace(/^;opcache\.revalidate_freq\s*=.*$/m, "opcache.revalidate_freq=0")
    .replace(/^;realpath_cache_size\s*=.*$/m, "realpath_cache_size = 4096k")
    .replace(/^;realpath_cache_ttl\s*=.*$/m, "realpath_cache_ttl = 600");
}

/**
 * First run: php.ini from php.ini-development with the extensions a typical app needs. User edits
 * are kept; an existing php.ini only gets OPcache switched on where it is still the stock comment.
 */
export function writePhpIni(dir: string): void {
  const iniPath = join(dir, "php.ini");
  if (existsSync(iniPath)) {
    // once only (marker): after that, OPcache is the user's choice (the extensions list)
    const cur = readFileSync(iniPath, "utf8");
    if (cur.includes(OPCACHE_MARK)) return;
    const next = existsSync(join(dir, "ext", "php_opcache.dll")) ? withOpcache(cur) : cur;
    writeFileSync(iniPath, next.replace(/\s*$/, "") + "\r\n" + OPCACHE_MARK + "\r\n", "utf8");
    return;
  }
  const base = readFileSync(join(dir, "php.ini-development"), "utf8");
  // PHP 8.5+ has OPcache built in (no php_opcache.dll to load)
  const tuned = (existsSync(join(dir, "ext", "php_opcache.dll")) ? withOpcache(base) : base)
    .replace(/^;?extension_dir\s*=.*$/m, 'extension_dir = "ext"')
    .replace(/^;extension=(mysqli|pdo_mysql|pdo_sqlite|sqlite3|openssl|mbstring|curl|gd|intl|zip|fileinfo|sodium|exif)$/gm, "extension=$1")
    .replace(/^;?cgi\.fix_pathinfo\s*=.*$/m, "cgi.fix_pathinfo=1")
    .replace(/^upload_max_filesize\s*=.*$/m, "upload_max_filesize = 64M")
    .replace(/^post_max_size\s*=.*$/m, "post_max_size = 64M")
    .replace(/^memory_limit\s*=.*$/m, "memory_limit = 512M");
  writeFileSync(iniPath, tuned.replace(/\s*$/, "") + "\r\n" + OPCACHE_MARK + "\r\n", "utf8");
}

/** The default PHP install (the PHP service's version), ready for CLI use. */
export function phpDir(cfg: Config, version = cfg.services.php.version): string {
  if (!isInstalled(cfg.root, "php", version)) throw new Error(`PHP ${version} is not installed (install it from the PHP card)`);
  const dir = binDir(cfg.root, "php", version);
  writePhpIni(dir);
  return dir;
}

/** Run php.exe with our php.ini: a script file or code through stdin. */
export function runPhp(cfg: Config, args: string[], opts: { stdin?: string; cwd?: string; env?: Record<string, string>; timeoutMs?: number; version?: string } = {}): Promise<ExecResult> {
  const dir = phpDir(cfg, opts.version);
  return exec([join(dir, "php.exe"), "-c", join(dir, "php.ini"), ...args], { cwd: opts.cwd ?? dir, stdin: opts.stdin, env: opts.env, timeoutMs: opts.timeoutMs ?? 60000 });
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

export interface PhpExtension {
  name: string;
  enabled: boolean;
  /** Loaded with zend_extension (OPcache, Xdebug). */
  zend: boolean;
}

/** extension=x / ;extension=php_x.dll / zend_extension="x" … (one per line) */
const EXT_LINE = /^[ \t]*(;?)[ \t]*(zend_extension|extension)[ \t]*=[ \t]*"?(?:php_)?([A-Za-z0-9_]+)(?:\.dll)?"?[ \t]*\r?$/gm;
const ZEND = new Set(["opcache", "xdebug"]);

/** Every DLL in ext/ and whether php.ini loads it. Creates php.ini on first use. */
export function phpExtensions(dir: string): PhpExtension[] {
  writePhpIni(dir);
  const ini = readFileSync(join(dir, "php.ini"), "utf8");
  const state = new Map<string, { enabled: boolean; zend: boolean }>();
  for (const m of ini.matchAll(EXT_LINE)) {
    const name = m[3]!.toLowerCase();
    const prev = state.get(name);
    state.set(name, { enabled: (prev?.enabled ?? false) || m[1] === "", zend: m[2] === "zend_extension" || ZEND.has(name) });
  }
  let dlls: string[] = [];
  try {
    dlls = readdirSync(join(dir, "ext")).map((f) => /^php_([A-Za-z0-9_]+)\.dll$/i.exec(f)?.[1]?.toLowerCase()).filter((n): n is string => !!n);
  } catch {
    /* no ext dir */
  }
  return [...new Set(dlls)]
    .map((name) => ({ name, enabled: state.get(name)?.enabled ?? false, zend: state.get(name)?.zend ?? ZEND.has(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Switch extensions on/off in php.ini: (un)comments their line, or adds one after the last extension line. */
export function setPhpExtensions(dir: string, wanted: Record<string, boolean>): void {
  const path = join(dir, "php.ini");
  const current = new Map(phpExtensions(dir).map((x) => [x.name, x]));
  let ini = readFileSync(path, "utf8");
  for (const [name, on] of Object.entries(wanted)) {
    const ext = current.get(name);
    if (!ext || ext.enabled === on) continue;
    let done = false;
    ini = ini.replace(EXT_LINE, (line, semi: string, kind: string, n: string) => {
      if (n.toLowerCase() !== name) return line;
      if (!on) return semi ? line : ";" + line.replace(/^[ \t]*/, "");
      if (done || !semi) return line;
      done = true;
      return line.replace(/^[ \t]*;[ \t]*/, "");
    });
    if (on && !done) {
      const add = `${ext.zend ? "zend_extension" : "extension"}=${name}`;
      let last = -1;
      for (const m of ini.matchAll(EXT_LINE)) last = m.index! + m[0].replace(/\r$/, "").length;
      ini = last >= 0 ? ini.slice(0, last) + "\r\n" + add + ini.slice(last) : ini.replace(/\s*$/, "") + "\r\n" + add + "\r\n";
    }
  }
  writeFileSync(path, ini, "utf8");
}

/** Extensions PHP could not load with the current php.ini ("Unable to load dynamic library …"). */
export async function brokenPhpExtensions(dir: string): Promise<string[]> {
  const r = await exec([join(dir, "php.exe"), "-c", join(dir, "php.ini"), "-m"], { cwd: dir, timeoutMs: 20000 });
  const text = r.stdout + "\n" + r.stderr;
  return [...new Set([...text.matchAll(/Unable to load dynamic library '(?:php_)?([A-Za-z0-9_]+)/g)].map((m) => m[1]!.toLowerCase()))];
}

export const hasPhpCli = (cfg: Config) => existsSync(join(binDir(cfg.root, "php", cfg.services.php.version), "php.exe"));

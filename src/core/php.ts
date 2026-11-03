/** php.ini generation and running the PHP CLI (used for certificates, Composer and WP setup). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { binDir, type Config } from "./config";
import { isInstalled } from "./installer";
import { exec, type ExecResult } from "./proc";

/** First run: php.ini from php.ini-development with the extensions a typical app needs. User edits are kept. */
export function writePhpIni(dir: string): void {
  const iniPath = join(dir, "php.ini");
  if (existsSync(iniPath)) return; // keep user edits
  const base = readFileSync(join(dir, "php.ini-development"), "utf8");
  const tuned = base
    .replace(/^;?extension_dir\s*=.*$/m, 'extension_dir = "ext"')
    .replace(/^;extension=(mysqli|pdo_mysql|pdo_sqlite|sqlite3|openssl|mbstring|curl|gd|intl|zip|fileinfo|sodium|exif)$/gm, "extension=$1")
    .replace(/^;?cgi\.fix_pathinfo\s*=.*$/m, "cgi.fix_pathinfo=1")
    .replace(/^upload_max_filesize\s*=.*$/m, "upload_max_filesize = 64M")
    .replace(/^post_max_size\s*=.*$/m, "post_max_size = 64M")
    .replace(/^memory_limit\s*=.*$/m, "memory_limit = 512M");
  writeFileSync(iniPath, tuned, "utf8");
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

export const hasPhpCli = (cfg: Config) => existsSync(join(binDir(cfg.root, "php", cfg.services.php.version), "php.exe"));

/**
 * New-site templates: Vazio, Laravel (Composer) and WordPress, each optionally with its own
 * MariaDB database wired into the project's config.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { binDir, dataDir, logsDir, tmpDir, type Config, type SiteConfig } from "./config";
import { download, unzip } from "./download";
import { appendText } from "./runtime";
import { hasPhpCli, runPhp } from "./php";
import { createDatabase } from "./services";
import { detectDocroot, writeBlankSite } from "./sites";

export type Template = "blank" | "laravel" | "wordpress";

export const TEMPLATES: { value: Template; label: string; hint: string }[] = [
  { value: "blank", label: "Blank", hint: "Just an index.php" },
  { value: "laravel", label: "Laravel", hint: "composer create-project laravel/laravel" },
  { value: "wordpress", label: "WordPress", hint: "Latest version from wordpress.org" },
];

/** DB name from a site name (MySQL identifiers: no "-"). */
export const dbNameFor = (site: string) => site.replace(/-/g, "_");

export function setupLog(cfg: Config, site: string): string {
  return join(logsDir(cfg.root), `site-${site}-setup.log`);
}

/** Fill a fresh site folder from a template. Long-running for Laravel/WordPress; progress goes to onStep. */
export async function applyTemplate(cfg: Config, site: SiteConfig, template: Template, withDb: boolean, onStep: (msg: string) => void): Promise<void> {
  const log = setupLog(cfg, site.name);
  mkdirSync(logsDir(cfg.root), { recursive: true });
  const note = (m: string) => {
    appendText(log, `[${new Date().toLocaleTimeString()}] ${m}\n`);
    onStep(m);
  };
  const db = dbNameFor(site.name);
  if (withDb) {
    note(`Creating database ${db}…`);
    await createDatabase(cfg, db);
  }
  switch (template) {
    case "blank":
      writeBlankSite(site.path, site.name);
      break;
    case "wordpress":
      await wordpress(cfg, site, withDb ? db : null, note);
      break;
    case "laravel":
      await laravel(cfg, site, withDb ? db : null, note, log);
      break;
  }
  site.docroot = detectDocroot(site.path);
  note("Done.");
}

async function wordpress(cfg: Config, site: SiteConfig, db: string | null, note: (m: string) => void): Promise<void> {
  note("Downloading WordPress…");
  const zip = join(tmpDir(cfg.root), "wordpress-latest.zip");
  await download("https://wordpress.org/latest.zip", zip);
  note("Extracting…");
  const stage = join(tmpDir(cfg.root), `wp-${site.name}`);
  rmSync(stage, { recursive: true, force: true });
  await unzip(zip, stage);
  const inner = join(stage, "wordpress");
  for (const f of readdirSync(inner)) renameSync(join(inner, f), join(site.path, f));
  rmSync(stage, { recursive: true, force: true });
  rmSync(zip, { force: true });
  if (db) {
    note("Configuring wp-config.php…");
    const salt = () => randomBytes(48).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
    const php = (v: string) => "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    let conf = readFileSync(join(site.path, "wp-config-sample.php"), "utf8")
      .replace("'database_name_here'", php(db))
      .replace("'username_here'", php(cfg.mariadbUser))
      .replace("'password_here'", php(cfg.mariadbPassword))
      .replace("'localhost'", php(`127.0.0.1:${cfg.services.mariadb.port}`));
    conf = conf.replace(/'put your unique phrase here'/g, () => php(salt()));
    writeFileSync(join(site.path, "wp-config.php"), conf, "utf8");
  }
}

async function composerPhar(cfg: Config, note: (m: string) => void): Promise<string> {
  const phar = join(binDir(cfg.root, "composer", "latest"), "composer.phar");
  if (!existsSync(phar)) {
    note("Downloading Composer…");
    await download("https://getcomposer.org/download/latest-stable/composer.phar", phar);
  }
  return phar;
}

async function laravel(cfg: Config, site: SiteConfig, db: string | null, note: (m: string) => void, log: string): Promise<void> {
  if (!hasPhpCli(cfg)) throw new Error("Install PHP first (Laravel is created with Vela's PHP)");
  const phar = await composerPhar(cfg, note);
  note("composer create-project laravel/laravel (may take a few minutes)…");
  const home = dataDir(cfg.root, "composer");
  mkdirSync(home, { recursive: true });
  // the folder exists (empty); Composer wants to create it itself
  rmSync(site.path, { recursive: true, force: true });
  const r = await runPhp(cfg, [phar, "create-project", "laravel/laravel", site.path, "--prefer-dist", "--no-interaction", "--no-progress"], {
    cwd: join(site.path, ".."),
    env: { COMPOSER_HOME: home, COMPOSER_NO_INTERACTION: "1" },
    timeoutMs: 20 * 60_000,
  });
  appendText(log, r.stdout + r.stderr);
  if (r.code !== 0) {
    mkdirSync(site.path, { recursive: true });
    throw new Error(`Composer failed: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(" ")}`);
  }
  if (db) {
    note("Configuring .env…");
    const envPath = join(site.path, ".env");
    const set = (text: string, key: string, value: string) => {
      const line = `${key}=${/[\s#"]/.test(value) ? JSON.stringify(value) : value}`;
      const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
      return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
    };
    let env = readFileSync(envPath, "utf8");
    env = set(env, "DB_CONNECTION", "mysql");
    env = set(env, "DB_HOST", "127.0.0.1");
    env = set(env, "DB_PORT", String(cfg.services.mariadb.port));
    env = set(env, "DB_DATABASE", db);
    env = set(env, "DB_USERNAME", cfg.mariadbUser);
    env = set(env, "DB_PASSWORD", cfg.mariadbPassword);
    writeFileSync(envPath, env, "utf8");
    note("php artisan migrate…");
    const m = await runPhp(cfg, ["artisan", "migrate", "--force", "--no-interaction"], { cwd: site.path, timeoutMs: 5 * 60_000 });
    appendText(log, m.stdout + m.stderr);
    if (m.code !== 0) note("Warning: migrate failed (see the setup log); the project was created.");
  }
}

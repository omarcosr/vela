import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import type { Config } from "./config";
import { binDir, dataDir, logsDir, wwwDir, type SiteConfig } from "./config";
import { siteCert } from "./certs";
import { writePhpIni } from "./php";
import { siteDomain, siteRoot } from "./sites";
import { isInstalled } from "./installer";
import { exec, isRunning, killTree, managedNames, markConfirmed, markStopping, portOpen, portOwner, running, sysTool, spawnDetached, stopProcess, type PortOwner } from "./proc";
import { processPath, tcpListenerPids, tcpPortPid } from "./win";
import { tailFile } from "./logs";
import type { ServiceName } from "./manifest";

/**
 * running: the port answers and the process behind it is one of Vela's binaries.
 * occupied: the port answers but another program holds it (Docker, another stack, an unknown
 * or elevated process). Vela never reports that as "running" and never kills it.
 */
export type ServiceStatus = "running" | "stopped" | "not-installed" | "starting" | "occupied";

export interface ServiceState {
  service: ServiceName;
  status: ServiceStatus;
  port: number;
  version: string;
  pid?: number;
  uptimeMs?: number;
  message?: string;
  /** Running from a previous Vela session (not a child of this process): stoppable, no uptime. */
  orphan?: boolean;
  /** occupied: what holds the port ("com.docker.backend.exe", or "unknown process"). */
  owner?: string;
  /** occupied: full path of that program, when Windows tells us. */
  ownerPath?: string;
}

export const ALL_SERVICES: ServiceName[] = ["nginx", "php", "mariadb", "redis"];
/** mariadb first (php apps often need it), then redis, php, nginx last. */
const START_ORDER: ServiceName[] = ["mariadb", "redis", "php", "nginx"];

/** php-cgi workers, one per port starting at the configured one; nginx balances across them. */
export const PHP_WORKERS = 4;

const fwd = (p: string) => p.replace(/\\/g, "/");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Config generation
// ---------------------------------------------------------------------------

/**
 * PHP pools: the PHP service's version on its port, plus one pool per other installed version a
 * site asks for, at port + 10·k. Each pool is PHP_WORKERS php-cgi processes on consecutive ports.
 */
export function phpPools(cfg: Config): { version: string; port: number }[] {
  const def = cfg.services.php;
  const extra = [...new Set(cfg.sites.map((s) => s.php).filter((v): v is string => !!v && v !== def.version))].filter((v) => isInstalled(cfg.root, "php", v));
  return [{ version: def.version, port: def.port }, ...extra.map((version, k) => ({ version, port: def.port + 10 * (k + 1) }))];
}

const poolName = (version: string) => "php_" + version.replace(/\W/g, "_");

/** The PHP pool a site runs on (falls back to the default when its version isn't installed). */
function sitePool(cfg: Config, site: SiteConfig): string {
  const pools = phpPools(cfg);
  return poolName((pools.find((p) => p.version === site.php) ?? pools[0]!).version);
}

/** HTTPS needs the port: skipped (not fatal) when another program holds it. */
function httpsPortUsable(cfg: Config): boolean {
  const pid = tcpPortPid(cfg.httpsPort);
  return !pid || isOurs(cfg, "nginx", { pid, path: processPath(pid), image: "" });
}

const phpLocation = (pool: string) => `
        location ~ \\.php$ {
            try_files $uri =404;
            fastcgi_pass   ${pool};
            fastcgi_index  index.php;
            fastcgi_read_timeout 300;
            fastcgi_param  SCRIPT_FILENAME  $document_root$fastcgi_script_name;
            include        fastcgi_params;
        }

        location ~ /\\.(?!well-known) {
            deny all;
        }`;

function siteServer(cfg: Config, site: SiteConfig, https: boolean): string {
  const domain = siteDomain(cfg, site);
  const cert = siteCert(cfg, domain);
  const log = (kind: string) => `"${fwd(join(logsDir(cfg.root), `site-${site.name}-${kind}.log`))}"`;
  const listens = [`listen       ${cfg.services.nginx.port};`];
  if (https && site.https && cert) listens.push(`listen       ${cfg.httpsPort} ssl;`, `ssl_certificate     "${fwd(cert.crt)}";`, `ssl_certificate_key "${fwd(cert.key)}";`);
  return `
    server {
        ${listens.join("\n        ")}
        server_name  ${domain};
        root         "${fwd(siteRoot(site))}";
        index        index.php index.html;
        access_log   ${log("access")};
        error_log    ${log("error")} warn;

        location / {
            try_files $uri $uri/ /index.php?$query_string;
        }
${phpLocation(sitePool(cfg, site))}
    }
`;
}

export function writeNginxConf(cfg: Config, dir: string): void {
  const upstreams = phpPools(cfg)
    .map((p) => `    upstream ${poolName(p.version)} {\n${Array.from({ length: PHP_WORKERS }, (_, i) => `        server 127.0.0.1:${p.port + i};`).join("\n")}\n    }`)
    .join("\n\n");
  const https = httpsPortUsable(cfg);
  const conf = `worker_processes  auto;
error_log  "${fwd(join(logsDir(cfg.root), "nginx-error.log"))}" warn;
pid        "${fwd(join(dataDir(cfg.root, "nginx"), "nginx.pid"))}";

events {
    worker_connections  1024;
}

http {
    include       "${fwd(join(dir, "conf", "mime.types"))}";
    default_type  application/octet-stream;
    access_log    "${fwd(join(logsDir(cfg.root), "nginx-access.log"))}";
    sendfile      on;
    keepalive_timeout  65;
    client_max_body_size 64m;
    server_tokens off;
    server_names_hash_bucket_size 128;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

${upstreams}

    # http://localhost/ : the www folder (dashboard and loose files)
    server {
        listen       ${cfg.services.nginx.port} default_server;
        server_name  localhost;
        root         "${fwd(wwwDir(cfg.root))}";
        index        index.php index.html;
        autoindex    on;

        location / {
            try_files $uri $uri/ =404;
        }
${phpLocation(poolName(cfg.services.php.version))}
    }
${cfg.sites.map((site) => siteServer(cfg, site, https)).join("")}
}
`;
  mkdirSync(dataDir(cfg.root, "nginx"), { recursive: true });
  writeFileSync(join(dir, "conf", "nginx.conf"), conf, "utf8");
}

/** Apply site/port changes to a running Nginx without dropping connections. */
export async function reloadNginx(cfg: Config): Promise<void> {
  const st = await getStatusFor(cfg, "nginx");
  if (st.status !== "running") return;
  const dir = binDir(cfg.root, "nginx", cfg.services.nginx.version);
  writeNginxConf(cfg, dir);
  const r = await exec([join(dir, "nginx.exe"), "-p", dir, "-c", join(dir, "conf", "nginx.conf"), "-s", "reload"], { cwd: dir, timeoutMs: 8000 });
  if (r.code !== 0) throw new Error(`nginx -s reload: ${(r.stderr || r.stdout).trim().slice(-300)}`);
}

/** A friendly landing page the first time, so http://localhost/ isn't a 403. */
function ensureWww(cfg: Config): void {
  const www = wwwDir(cfg.root);
  mkdirSync(www, { recursive: true });
  if (readdirSync(www).length > 0) return;
  writeFileSync(
    join(www, "index.php"),
    `<?php $db = @fsockopen('127.0.0.1', ${cfg.services.mariadb.port}, $e, $s, 0.3); $rd = @fsockopen('127.0.0.1', ${cfg.services.redis.port}, $e, $s, 0.3); ?>
<!doctype html><meta charset="utf-8"><title>Vela</title>
<style>body{font:15px/1.6 system-ui;background:#faf9f5;color:#16150f;max-width:640px;margin:10vh auto;padding:0 24px}
h1{font-size:40px;margin:0}code{background:#f1efe8;padding:2px 6px;border-radius:6px}.ok{color:#15803d}.no{color:#b91c1c}</style>
<h1>Vela</h1><p>Nginx + PHP <?= PHP_VERSION ?> running.</p>
<ul><li>MariaDB: <b class="<?= $db ? 'ok' : 'no' ?>"><?= $db ? 'online' : 'offline' ?></b></li>
<li>Redis: <b class="<?= $rd ? 'ok' : 'no' ?>"><?= $rd ? 'online' : 'offline' ?></b></li></ul>
<p>Put your projects in <code><?= htmlspecialchars(__DIR__) ?></code>.</p>
`,
    "utf8",
  );
}

/** php-cgi (VS16/VS17 builds) needs the VC++ runtime; without it Windows only says 0xC0000135. */
function missingVcRuntime(): string | null {
  for (const dll of ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"]) if (!existsSync(sysTool(dll))) return dll;
  return null;
}


async function initMariaDbDatadir(cfg: Config, dir: string): Promise<void> {
  const datadir = dataDir(cfg.root, "mariadb");
  if (existsSync(join(datadir, "mysql")) || existsSync(join(datadir, "ibdata1"))) return;
  mkdirSync(datadir, { recursive: true });
  const r = await exec([join(dir, "bin", "mysql_install_db.exe"), `--datadir=${datadir}`, `--password=${cfg.mariadbPassword}`], { cwd: dir, timeoutMs: 120000 });
if (r.code !== 0) {
    // leave no half-initialised datadir behind, or the next start would skip init
    rmSync(datadir, { recursive: true, force: true });
    throw new Error(`mysql_install_db failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  }
}

function writeMyIni(cfg: Config, dir: string): string {
  const datadir = dataDir(cfg.root, "mariadb");
  const ini = `[mysqld]
datadir=${fwd(datadir)}
port=${cfg.services.mariadb.port}
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_general_ci
innodb_buffer_pool_size=256M
skip-name-resolve
[client]
port=${cfg.services.mariadb.port}
default-character-set=utf8mb4
`;
  const iniPath = join(dir, "my.ini");
  writeFileSync(iniPath, ini, "utf8");
  return iniPath;
}

function writeRedisConf(cfg: Config, dir: string): string {
  const confPath = join(dir, "redis.conf");
  const conf = `port ${cfg.services.redis.port}
bind 127.0.0.1
dir "${fwd(dataDir(cfg.root, "redis"))}"
save 900 1
save 300 10
appendonly no
`;
  writeFileSync(confPath, conf, "utf8");
  return confPath;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function runLog(cfg: Config, service: ServiceName): string {
  return join(logsDir(cfg.root), `${service}-run.log`);
}

export async function startService(cfg: Config, service: ServiceName): Promise<ServiceState> {
  const { version, port } = cfg.services[service];
  const dir = binDir(cfg.root, service, version);
  const state: ServiceState = { service, status: "starting", port, version };
  if (!isInstalled(cfg.root, service, version)) {
    return { ...state, status: "not-installed", message: "Install the version first" };
  }
  if (isRunning(service)) return getStatusFor(cfg, service);
  if (await portOpen(port, "127.0.0.1", 500)) {
    // already up: report what is there (ours from an earlier session, or someone else)
    const st = await getStatusFor(cfg, service);
    if (st.status === "occupied") st.message = `Port ${port} is already in use by ${st.owner}`;
    return st;
  }
  mkdirSync(logsDir(cfg.root), { recursive: true });

  try {
    switch (service) {
      case "nginx": {
        ensureWww(cfg);
        writeNginxConf(cfg, dir);
        spawnDetached("nginx", join(dir, "nginx.exe"), ["-p", dir, "-c", join(dir, "conf", "nginx.conf")], {
          cwd: dir,
          logFile: runLog(cfg, "nginx"),
        });
        break;
      }
      case "php": {
        const missing = missingVcRuntime();
        if (missing) return { ...state, status: "stopped", message: `Visual C++ Redistributable x64 (${missing}) is missing. Install it: https://aka.ms/vs/17/release/vc_redist.x64.exe` };
        for (const [k, pool] of phpPools(cfg).entries()) {
          const pdir = binDir(cfg.root, "php", pool.version);
          writePhpIni(pdir);
          for (let i = 0; i < PHP_WORKERS; i++) {
            // "php" is the first worker of the default pool; every other one is "php#…" (managedNames)
            const name = k === 0 && i === 0 ? "php" : `php#${pool.version}#${i}`;
            spawnDetached(name, join(pdir, "php-cgi.exe"), ["-b", `127.0.0.1:${pool.port + i}`, "-c", join(pdir, "php.ini")], {
              cwd: pdir,
              logFile: runLog(cfg, "php"),
              // php-cgi exits after 500 requests by default; 0 keeps workers alive forever
              env: { PHP_FCGI_MAX_REQUESTS: "0" },
            });
          }
        }
        break;
      }
      case "mariadb": {
        await initMariaDbDatadir(cfg, dir);
        const iniPath = writeMyIni(cfg, dir);
        spawnDetached("mariadb", join(dir, "bin", "mysqld.exe"), ["--defaults-file=" + iniPath, "--console"], {
          cwd: dir,
          logFile: runLog(cfg, "mariadb"),
        });
        break;
      }
      case "redis": {
        mkdirSync(dataDir(cfg.root, "redis"), { recursive: true });
        const confPath = writeRedisConf(cfg, dir);
        spawnDetached("redis", join(dir, "redis-server.exe"), [confPath], {
          cwd: dir,
          logFile: runLog(cfg, "redis"),
        });
        break;
      }
    }
  } catch (err) {
    return { ...state, status: "stopped", message: err instanceof Error ? err.message : String(err) };
  }

  // wait for the port to come up (mariadb's first boot can take a while)
  const deadline = Date.now() + (service === "mariadb" ? 30000 : 12000);
  while (Date.now() < deadline) {
    await sleep(300);
    if (await portOpen(port)) break;
    if (!isRunning(service)) break;
  }
  const st = await getStatusFor(cfg, service);
  if (st.status === "running") markConfirmed(service);
  if (st.status !== "running") {
    const spawnErr = running.get(service)?.error;
    const tail = tailFile(runLog(cfg, service), 3).trim();
    st.message = spawnErr ?? (tail ? `Failed to start: ${tail.slice(-300)}` : "Failed to start (see logs)");
    if (st.status === "stopped") await stopService(service, cfg);
  }
  return st;
}

/** The port answers, but the process behind it is not ours to stop (Docker, another stack, …). */
export class ForeignPortError extends Error {
  constructor(
    readonly service: ServiceName,
    readonly port: number,
    readonly owner: PortOwner | null,
  ) {
    super(
      owner
        ? `Port ${port} belongs to ${ownerLabel(owner)} (PID ${owner.pid}), not Vela. Stop it there or change the port in Settings.`
        : `Port ${port} is still responding, but its owner could not be identified.`,
    );
  }
}

/**
 * Is this process one of Vela's own binaries for the service (any installed version)?
 * Decided by executable path, not name: another stack's nginx.exe is not ours, and a process
 * whose path can't be read is never assumed to be.
 */
function isOurs(cfg: Config, service: ServiceName, owner: PortOwner | null): boolean {
  if (!owner?.path) return false;
  const base = join(cfg.root, "bin", service).toLowerCase() + sep;
  return owner.path.toLowerCase().startsWith(base);
}

const ownerLabel = (owner: PortOwner | null) => owner?.image || "unknown process";

/** Stop a service. Throws ForeignPortError when the port stays up and belongs to someone else. */
export async function stopService(service: ServiceName, cfg: Config, password = cfg.mariadbPassword): Promise<void> {
  const { version, port } = cfg.services[service];
  const dir = binDir(cfg.root, service, version);
  const installed = isInstalled(cfg.root, service, version);
  const up = () => portOpen(port, "127.0.0.1", 300);

  if (!(await up()) && managedNames(service).length === 0) return;

  // who is actually behind the port? never kill a process that isn't this service
  const owner = (await up()) ? await portOwner(port) : null;
  const foreign = owner !== null && !isOurs(cfg, service, owner);
  if (foreign && managedNames(service).length === 0) throw new ForeignPortError(service, port, owner);

  markStopping(service);
  // graceful first, where the service has a way to ask for it
  if (installed && !foreign) {
    if (service === "nginx") {
      await exec([join(dir, "nginx.exe"), "-p", dir, "-c", join(dir, "conf", "nginx.conf"), "-s", "quit"], { cwd: dir, timeoutMs: 5000 });
    } else if (service === "mariadb") {
      // password via MYSQL_PWD, not argv: command lines are visible to every process
await exec([join(dir, "bin", "mysqladmin.exe"), "-h", "127.0.0.1", "-P", String(port), "-u", cfg.mariadbUser, "shutdown"], { cwd: dir, timeoutMs: 8000, env: { MYSQL_PWD: password } });
    }
  }

  await Promise.all(managedNames(service).map((n) => stopProcess(n, 3000)));

  // Whatever of ours still holds the port (orphans from an earlier session, nginx workers left
  // behind by "-s quit") is killed by PID; only processes running our own binaries, never by name.
  const ports = service === "php" ? phpPools(cfg).flatMap((p) => Array.from({ length: PHP_WORKERS }, (_, i) => p.port + i)) : [port];
  for (let i = 0; i < 15 && (await up()); i++) {
    if (i % 3 === 2) {
      const pids = [...new Set(ports.flatMap(tcpListenerPids))];
      const owners = pids.map((pid) => ({ pid, path: processPath(pid), image: "" }));
      if (owners.length > 0 && owners.every((o) => !isOurs(cfg, service, o))) throw new ForeignPortError(service, port, await portOwner(port));
      await Promise.all(owners.filter((o) => isOurs(cfg, service, o)).map((o) => killTree(o.pid)));
    }
    await sleep(300);
  }
  if (await up()) {
    const now = await portOwner(port);
    if (!isOurs(cfg, service, now)) throw new ForeignPortError(service, port, now);
    throw new Error(`${service} did not stop: process ${now?.pid} is still using port ${port}`);
  }
}

export async function restartService(cfg: Config, service: ServiceName): Promise<ServiceState> {
  await stopService(service, cfg);
  return startService(cfg, service);
}

export async function getStatusFor(cfg: Config, service: ServiceName): Promise<ServiceState> {
  const { version, port } = cfg.services[service];
  const base: ServiceState = { service, status: "stopped", port, version };
  if (!isInstalled(cfg.root, service, version)) return { ...base, status: "not-installed" };

  // authoritative check: is the port accepting connections?
  const up = await portOpen(port, "127.0.0.1", 700);
  const rp = running.get(service);
  if (up) {
    // always check who answers (Win32 TCP table, cheap): a child we track can't vouch for the port
    const owner = await portOwner(port);
    if (!isOurs(cfg, service, owner)) return { ...base, status: "occupied", pid: owner?.pid, owner: ownerLabel(owner), ownerPath: owner?.path || undefined };
    return { ...base, status: "running", pid: rp?.child.pid ?? owner?.pid, uptimeMs: rp ? Date.now() - rp.startedAt : undefined, orphan: !rp };
  }
  if (rp && rp.child.exitCode === null) return { ...base, status: "starting", pid: rp.child.pid };
  return base;
}

export async function getAllStatus(cfg: Config): Promise<ServiceState[]> {
  return Promise.all(ALL_SERVICES.map((s) => getStatusFor(cfg, s)));
}

export async function startAll(cfg: Config): Promise<ServiceState[]> {
  const out: ServiceState[] = [];
  for (const s of START_ORDER) {
    if (cfg.services[s].enabled) out.push(await startService(cfg, s));
  }
  return out;
}

/** Stop everything, in reverse start order; one failure doesn't keep the others running. */
export async function stopAllServices(cfg: Config): Promise<Error[]> {
  const errors: Error[] = [];
  for (const s of [...START_ORDER].reverse()) {
    try {
      await stopService(s, cfg);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  return errors;
}

export async function resetMariaDbDatadir(cfg: Config): Promise<void> {
  await stopService("mariadb", cfg);
  rmSync(dataDir(cfg.root, "mariadb"), { recursive: true, force: true });
}

/** The config file Vela generates for a service (exists after the first start). */
export function configFileOf(cfg: Config, service: ServiceName): string {
  const dir = binDir(cfg.root, service, cfg.services[service].version);
  switch (service) {
    case "nginx":
      return join(dir, "conf", "nginx.conf");
    case "php":
      return join(dir, "php.ini");
    case "mariadb":
      return join(dir, "my.ini");
    case "redis":
      return join(dir, "redis.conf");
  }
}

/** True once mysql_install_db has created the datadir (the root password is then baked in). */
export function mariaDbInitialized(cfg: Config): boolean {
  const d = dataDir(cfg.root, "mariadb");
  return existsSync(join(d, "mysql")) || existsSync(join(d, "ibdata1"));
}

const sqlStr = (v: string) => "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

/** mysql.exe client: SQL through stdin, password through MYSQL_PWD (never argv). */
function mysqlClient(cfg: Config, password = cfg.mariadbPassword) {
  const { version, port } = cfg.services.mariadb;
  const dir = binDir(cfg.root, "mariadb", version);
  return (sql: string) =>
    exec([join(dir, "bin", "mysql.exe"), "-h", "127.0.0.1", "-P", String(port), "-u", cfg.mariadbUser, "-N", "-B"], { cwd: dir, stdin: sql, timeoutMs: 15000, env: { MYSQL_PWD: password } });
}

/** Run fn with MariaDB up: starts it when stopped and stops it again afterwards. */
async function withMariaDb<T>(cfg: Config, fn: (mysql: ReturnType<typeof mysqlClient>) => Promise<T>, stopWith?: () => string): Promise<T> {
  if (!isInstalled(cfg.root, "mariadb", cfg.services.mariadb.version)) throw new Error("MariaDB is not installed");
  const wasUp = (await getStatusFor(cfg, "mariadb")).status === "running";
  if (!wasUp) {
    const st = await startService(cfg, "mariadb");
    if (st.status !== "running") throw new Error(st.message ?? "Could not start MariaDB");
  }
  try {
    return await fn(mysqlClient(cfg));
  } finally {
    if (!wasUp) await stopService("mariadb", cfg, stopWith?.() ?? cfg.mariadbPassword).catch(() => {});
  }
}

const sqlId = (v: string) => "`" + v.replace(/`/g, "``") + "`";

/** CREATE DATABASE IF NOT EXISTS (utf8mb4). */
export async function createDatabase(cfg: Config, name: string): Promise<void> {
  await withMariaDb(cfg, async (mysql) => {
    const r = await mysql(`CREATE DATABASE IF NOT EXISTS ${sqlId(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "CREATE DATABASE failed");
  });
}

/**
 * Change the MariaDB root password for real (ALTER USER on every root host), not just in config.
 * Starts the server for the change when it is stopped, and stops it again afterwards.
 */
export async function changeMariaDbPassword(cfg: Config, next: string): Promise<void> {
  if (!mariaDbInitialized(cfg)) return; // applied by mysql_install_db on first start
  let changed = false;
  await withMariaDb(
    cfg,
    async (mysql) => {
      const hosts = await mysql(`SELECT Host FROM mysql.user WHERE User=${sqlStr(cfg.mariadbUser)};`);
      if (hosts.code !== 0) {
        const err = hosts.stderr.trim();
        throw new Error(/1045|Access denied/i.test(err) ? "The current password saved in Vela is not accepted by MariaDB" : err || "mysql.exe failed");
      }
      const list = hosts.stdout
        .split(/\r?\n/)
        .map((h) => h.trim())
        // hostname accounts (root@DESKTOP-…) are unusable with skip-name-resolve and ALTER USER rejects them
        .filter((h) => /^(localhost|%|[\d.%]+|[0-9a-f:]+)$/i.test(h));
      const sql = list.map((h) => `ALTER USER ${sqlStr(cfg.mariadbUser)}@${sqlStr(h)} IDENTIFIED BY ${sqlStr(next)};`).join("\n") + "\nFLUSH PRIVILEGES;";
      const res = await mysql(sql);
      if (res.code !== 0) throw new Error(res.stderr.trim() || "ALTER USER failed");
      changed = true;
    },
    // mysqladmin shutdown has to authenticate with the password now in effect
    () => (changed ? next : cfg.mariadbPassword),
  );
}

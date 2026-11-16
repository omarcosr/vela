/**
 * End-to-end check of the whole stack on the runtime that runs it, in a throwaway root
 * (%TEMP%\vela-e2e-<runtime>) with its own ports, so the user's Vela and config.json are untouched:
 * install (download + sha256 + unzip) every service, start/stop/restart, nginx → php-cgi, sites,
 * HTTPS certificates, MariaDB, Redis, templates (blank, WordPress, Laravel), phpMyAdmin, logs,
 * crash detection and foreign-port protection.
 *
 *   bun scripts/e2e.ts
 *   node node_modules/@tarve/core/dist/npm/cli.js run scripts/e2e.ts --runtime node
 *   tarve build scripts/e2e.ts --runtime txiki --outfile e2e.exe && e2e.exe > e2e.log
 *
 * VELA_E2E_REUSE=1 keeps an existing root (skips the downloads). VELA_E2E_SKIP=laravel,wordpress skips steps.
 * VELA_E2E_ZIPS=<dir> seeds <service>-<version>.zip files (slow mirrors).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { binDir, dataDir, defaultConfig, logsDir, wwwDir, type Config } from "../src/core/config";
import { RUNTIME } from "../src/core/runtime";
import { installedVersions, installVersion, isInstalled } from "../src/core/installer";
import { ALL_SERVICES, changeMariaDbPassword, createDatabase, ForeignPortError, getAllStatus, getStatusFor, mariaDbInitialized, reloadNginx, restartService, startAll, startService, stopAllServices, stopService } from "../src/core/services";
import { exec, killTree, onUnexpectedExit, portOpen, portOwner, running, sysTool } from "../src/core/proc";
import { addSite, newSiteFolder, removeSite, siteDomain, syncWwwSites } from "../src/core/sites";
import { applyTemplate } from "../src/core/templates";
import { ensureSiteCert, caTrusted } from "../src/core/certs";
import { ensurePhpMyAdmin } from "../src/core/phpmyadmin";
import { brokenPhpExtensions, phpExtensions, runPhp, setPhpExtensions } from "../src/core/php";
import { clearLog, listLogs, readLogTail } from "../src/core/logs";
import { autostartEnabled, canAutostart } from "../src/core/autostart";
import type { ServiceName } from "../src/core/manifest";

const env = process.env;
const skip = new Set((env.VELA_E2E_SKIP ?? "").split(",").filter(Boolean));
const root = join(tmpdir(), `vela-e2e-${RUNTIME}`);
const t0 = Date.now();
const lines: string[] = [];
const say = (s: string) => {
  lines.push(s);
  console.log(s);
};
let failures = 0;

async function step<T>(name: string, fn: () => Promise<T> | T, ok: (v: T) => boolean | string = () => true): Promise<T | undefined> {
  const s = Date.now();
  try {
    const v = await fn();
    const r = ok(v);
    const pass = r === true;
    if (!pass) failures++;
    say(`${pass ? "ok  " : "FAIL"} ${name} (${((Date.now() - s) / 1000).toFixed(1)}s)${pass ? "" : "  " + (typeof r === "string" ? r : JSON.stringify(v)?.slice(0, 300))}`);
    return v;
  } catch (e) {
    failures++;
    say(`FAIL ${name} (${((Date.now() - s) / 1000).toFixed(1)}s)  threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 600));
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** nginx -s reload returns before the new workers take over. */
const reload = async () => {
  const st = await getStatusFor(cfg, "nginx");
  if (st.status !== "running") throw new Error(`reload skipped: nginx is ${st.status} ${st.owner ?? ""}`);
  await reloadNginx(cfg);
  await sleep(800);
};

/** cpSync -r (not in txiki.js's node:fs shim). */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const d of readdirSync(from, { withFileTypes: true })) {
    if (d.isDirectory()) copyDir(join(from, d.name), join(to, d.name));
    else copyFileSync(join(from, d.name), join(to, d.name));
  }
}

/** curl.exe (in Windows since 1803): Host-based routing without DNS, and -k for our own CA. */
async function http(url: string, host?: string): Promise<{ code: number; body: string }> {
  const u = new URL(url);
  const args = ["-s", "-k", "-m", "20", "-o", "-", "-w", "\n%{http_code}"];
  if (host) args.push("--resolve", `${host}:${u.port}:127.0.0.1`), (u.hostname = host);
  const r = await exec([sysTool("curl.exe"), ...args, u.toString()], { timeoutMs: 25000 });
  const i = r.stdout.lastIndexOf("\n");
  return { code: Number(r.stdout.slice(i + 1)), body: r.stdout.slice(0, i) };
}

/** Polls until pred holds (nginx on Windows: old workers keep accepting for a moment after a reload). */
async function httpUntil(url: string, host: string | undefined, pred: (r: { code: number; body: string }) => boolean, ms = 15000) {
  const end = Date.now() + ms;
  let r = await http(url, host);
  while (!pred(r) && Date.now() < end) {
    await sleep(250);
    r = await http(url, host);
  }
  return r;
}

/** Not answered by the default (www) server: neither its dashboard nor its 404. */
const notDefault = (r: { code: number; body: string }) => r.code !== 404 && r.code !== 0 && !r.body.includes("<title>Vela</title>");

const cfg: Config = defaultConfig();
cfg.root = root;
cfg.services.nginx.port = 8081;
cfg.services.php.port = 9100;
cfg.services.mariadb.port = 3307;
cfg.services.redis.port = 6380;
cfg.httpsPort = 8443;

say(`Vela e2e — runtime ${RUNTIME} — root ${root}`);

try {
  await step("ports free", async () => {
    const busy: number[] = [];
    for (const p of [8081, 8443, 9100, 9101, 9102, 9103, 3307, 6380, 6381]) if (await portOpen(p, "127.0.0.1", 300)) busy.push(p);
    return busy;
  }, (b) => b.length === 0 || `in use: ${b.join(", ")}`);

  if (env.VELA_E2E_REUSE !== "1") rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  // --- install -------------------------------------------------------------------------------
  for (const s of ALL_SERVICES) {
    const v = cfg.services[s].version;
    let events = 0;
    // VELA_E2E_ZIPS=<dir> with <service>-<version>.zip: seeded as a finished partial download, so
    // install still runs fetch (Range → 416 "complete"), sha256 and unzip without re-downloading
    const cached = env.VELA_E2E_ZIPS ? join(env.VELA_E2E_ZIPS, `${s}-${v}.zip`) : "";
    if (cached && existsSync(cached) && !isInstalled(root, s, v)) {
      mkdirSync(join(root, "tmp"), { recursive: true });
      copyFileSync(cached, join(root, "tmp", `${s}-${v}.zip.part`));
    }
    await step(`install ${s} ${v}${cached && existsSync(cached) ? " (seeded zip)" : ""}`, async () => {
      await installVersion(root, s, v, () => events++);
      return isInstalled(root, s, v);
    }, (x) => x === true);
  }
  await step("installedVersions", () => ALL_SERVICES.map((s) => installedVersions(root, s)), (v) => v.every((x) => x.length === 1));

  // --- start ---------------------------------------------------------------------------------
  await step("startAll", () => startAll(cfg), (st) => st.every((x) => x.status === "running") || st.map((x) => `${x.service}:${x.status} ${x.message ?? ""}`).join(" | "));
  await step("getAllStatus: running, ours, pid", () => getAllStatus(cfg), (st) => st.every((x) => x.status === "running" && !!x.pid && !x.orphan) || JSON.stringify(st));
  await step("mariadb datadir initialised", () => mariaDbInitialized(cfg), (x) => x);
  await step("portOwner(nginx) is our nginx.exe", () => portOwner(cfg.services.nginx.port), (o) => !!o?.path && o.path.toLowerCase().startsWith(root.toLowerCase()) || JSON.stringify(o));
  await step("startService when already running", () => startService(cfg, "redis"), (s) => s.status === "running");

  // --- web -----------------------------------------------------------------------------------
  await step("http://localhost/ (nginx → php-cgi, dashboard sees MariaDB + Redis)", () => http("http://127.0.0.1:8081/"), (r) => (r.code === 200 && /PHP 8\./.test(r.body) && (r.body.match(/online/g)?.length ?? 0) === 2) || `${r.code} ${r.body.slice(0, 200)}`);
  writeFileSync(join(wwwDir(root), "info.php"), "<?php echo 'VELA-OK ', PHP_VERSION, ' ', extension_loaded('openssl') ? 'ssl' : '', ' ', getenv('PHP_FCGI_MAX_REQUESTS');");
  await step("php file in www", () => http("http://127.0.0.1:8081/info.php"), (r) => (r.code === 200 && r.body.startsWith("VELA-OK 8.") && r.body.endsWith(" 0")) || `${r.code} ${r.body}`);
  await step("4 php-cgi workers answer (round robin)", async () => {
    const codes = await Promise.all(Array.from({ length: 12 }, () => http("http://127.0.0.1:8081/info.php")));
    return codes.map((c) => c.code);
  }, (c) => c.every((x) => x === 200));
  await step("php-cgi has OPcache on", async () => {
    writeFileSync(join(wwwDir(root), "op.php"), "<?php echo function_exists('opcache_get_status') && (opcache_get_status(false)['opcache_enabled'] ?? false) ? 'on' : 'off';");
    return http("http://127.0.0.1:8081/op.php");
  }, (r) => r.body === "on" || `${r.code} ${r.body.slice(0, 200)}`);
  await step("mysqli to host 'localhost' is fast (MariaDB listens on ::1 too)", async () => {
    writeFileSync(join(wwwDir(root), "lh.php"), `<?php mysqli_report(MYSQLI_REPORT_OFF); $t = microtime(true); $m = @mysqli_connect('localhost', 'root', '${cfg.mariadbPassword}', '', ${cfg.services.mariadb.port}); echo $m ? 'ok' : mysqli_connect_error(), ' ', round((microtime(true) - $t) * 1000);`);
    return http("http://127.0.0.1:8081/lh.php");
  }, (r) => (/^ok \d+$/.test(r.body) && Number(r.body.split(" ")[1]) < 300) || r.body);
  await step("PHP extensions: list, enable bz2, disable, php -m agrees", async () => {
    const dir = binDir(root, "php", cfg.services.php.version);
    const list = phpExtensions(dir);
    const mods = async () => (await runPhp(cfg, ["-m"])).stdout.toLowerCase().split(/\r?\n/);
    const before = list.find((x) => x.name === "bz2")?.enabled;
    setPhpExtensions(dir, { bz2: true });
    const on = (await mods()).includes("bz2") && phpExtensions(dir).find((x) => x.name === "bz2")?.enabled;
    setPhpExtensions(dir, { bz2: false });
    const off = !(await mods()).includes("bz2") && !phpExtensions(dir).find((x) => x.name === "bz2")?.enabled;
    const broken = await brokenPhpExtensions(dir);
    return { n: list.length, mysqli: list.find((x) => x.name === "mysqli")?.enabled, opcacheZend: list.find((x) => x.name === "opcache")?.zend, before, on, off, broken };
  }, (v) => (v.n > 20 && v.mysqli && v.opcacheZend && v.before === false && v.on && v.off && v.broken.length === 0) || JSON.stringify(v));
  await step("runPhp (CLI)", () => runPhp(cfg, ["-r", "echo 6*7;"]), (r) => r.stdout.trim() === "42" || JSON.stringify(r));

  // --- sites ---------------------------------------------------------------------------------
  const blank = await step("new site 'e2e' (blank template + database)", async () => {
    const site = addSite(cfg, newSiteFolder(cfg, "e2e"), "e2e");
    const steps: string[] = [];
    await applyTemplate(cfg, site, "blank", true, (m) => steps.push(m));
    await reload();
    return site;
  });
  if (blank) {
    await step("site served by name (e2e.localhost)", () => httpUntil("http://e2e.localhost:8081/", siteDomain(cfg, blank), notDefault), (r) => (r.code === 200 && r.body.includes("<h1>e2e</h1>")) || `${r.code} ${r.body.slice(0, 200)}`);
    await step("database e2e exists", async () => (await exec([join(binDir(root, "mariadb", cfg.services.mariadb.version), "bin", "mysql.exe"), "-h", "127.0.0.1", "-P", "3307", "-u", "root", "-N", "-B", "-e", "SHOW DATABASES"], { env: { MYSQL_PWD: cfg.mariadbPassword } })).stdout, (o) => o.split(/\r?\n/).includes("e2e") || o);
    await step("HTTPS: CA + site certificate (PHP openssl), nginx reload", async () => {
      await ensureSiteCert(cfg, siteDomain(cfg, blank));
      blank.https = true;
      await reload();
      await sleep(500);
      return http("https://e2e.localhost:8443/", siteDomain(cfg, blank));
    }, (r) => (r.code === 200 && r.body.includes("<h1>e2e</h1>")) || `${r.code} ${r.body.slice(0, 200)}`);
    await step("caTrusted (certutil -verify, read only)", () => caTrusted(cfg), (v) => typeof v === "boolean");
    await step("site log files written", () => listLogs(root).map((l) => l.name), (n) => n.includes("site-e2e-access.log") || n.join(","));
  }
  await step("syncWwwSites imports a dropped-in folder", () => {
    mkdirSync(join(wwwDir(root), "dropped", "public"), { recursive: true });
    writeFileSync(join(wwwDir(root), "dropped", "public", "index.php"), "<?php echo 'DROP';");
    syncWwwSites(cfg);
    return cfg.sites.find((s) => s.name === "dropped");
  }, (s) => s?.docroot === "public" || JSON.stringify(s));
  await step("dropped site served from its docroot", async () => {
    await reload();
    return httpUntil("http://dropped.localhost:8081/", "dropped.localhost", notDefault);
  }, (r) => r.body === "DROP" || `${r.code} ${r.body.slice(0, 200)}`);
  await step("removeSite remembers the www folder", () => {
    removeSite(cfg, "dropped");
    syncWwwSites(cfg);
    return cfg.sites.some((s) => s.name === "dropped");
  }, (v) => v === false);

  if (!skip.has("phpmyadmin")) {
    const pma = await step("phpMyAdmin (download + site + config)", async () => {
      const s = await ensurePhpMyAdmin(cfg);
      await reload();
      return { s, r: await httpUntil(`http://${s.name}.localhost:8081/`, `${s.name}.localhost`, notDefault) };
    }, ({ r }) => (r.code === 200 && /phpMyAdmin/.test(r.body)) || `${r.code} ${r.body.slice(0, 300)}`);
    if (pma) await step("phpMyAdmin logs into Vela's MariaDB", async () => {
      const jar = join(root, "pma-cookies.txt");
      rmSync(jar, { force: true });
      const host = `${pma.s.name}.localhost`;
      const curl = (extra: string[]) => exec([sysTool("curl.exe"), "-s", "-k", "-m", "20", "-b", jar, "-c", jar, "-L", "--resolve", `${host}:8081:127.0.0.1`, ...extra, `http://${host}:8081/index.php`], { timeoutMs: 25000 });
      const page = (await curl([])).stdout;
      const token = /name="token" value="([^"]+)"/.exec(page)?.[1] ?? "";
      const r = await curl(["--data-urlencode", "pma_username=root", "--data-urlencode", `pma_password=${cfg.mariadbPassword}`, "--data-urlencode", "server=1", "--data-urlencode", `token=${token}`]);
      return { token: !!token, ok: /logout|server_databases/i.test(r.stdout) && !/Cannot log in|Access denied/i.test(r.stdout), tail: r.stdout.replace(/\s+/g, " ").slice(0, 200) };
    }, (v) => (v.token && v.ok) || JSON.stringify(v));
  }
  if (!skip.has("wordpress")) {
    const wp = await step("WordPress template (download, unzip, wp-config, database)", async () => {
      const site = addSite(cfg, newSiteFolder(cfg, "wp"), "wp");
      await applyTemplate(cfg, site, "wordpress", true, () => {});
      await reload();
      return site;
    });
    if (wp) {
      await step("WordPress answers (redirect to the installer)", () => httpUntil("http://wp.localhost:8081/", "wp.localhost", notDefault), (r) => r.code === 302 || (r.code === 200 && /WordPress/.test(r.body)) || `${r.code} ${r.body.slice(0, 200)}`);
      await step("WordPress install page talks to MariaDB", () => httpUntil("http://wp.localhost:8081/wp-admin/install.php", "wp.localhost", notDefault), (r) => (r.code === 200 && /WordPress/.test(r.body) && !/Error establishing a database connection/.test(r.body)) || `${r.code} ${r.body.slice(0, 300)}`);
    }
  }
  if (!skip.has("laravel")) {
    const lv = await step("Laravel template (composer create-project, .env, migrate)", async () => {
      const site = addSite(cfg, newSiteFolder(cfg, "lara"), "lara");
      const notes: string[] = [];
      await applyTemplate(cfg, site, "laravel", true, (m) => notes.push(m));
      await reload();
      return { site, notes };
    }, (r) => !r.notes.some((n) => /Warning/.test(n)) || r.notes.join(" / "));
    if (lv) await step("Laravel answers", () => httpUntil("http://lara.localhost:8081/", "lara.localhost", notDefault), (r) => (r.code === 200 && /Laravel/.test(r.body)) || `${r.code} ${r.body.slice(0, 300)}`);
  }

  // --- MariaDB / Redis -------------------------------------------------------------------------
  const mysql = (sql: string, pwd = cfg.mariadbPassword) =>
    exec([join(binDir(root, "mariadb", cfg.services.mariadb.version), "bin", "mysql.exe"), "-h", "127.0.0.1", "-P", "3307", "-u", "root", "-N", "-B"], { stdin: sql, env: { MYSQL_PWD: pwd } });
  await step("mysql over stdin", async () => (await mysql("SELECT 40+2;")).stdout.trim(), (v) => v === "42");
  await step("createDatabase", async () => {
    await createDatabase(cfg, "e2e_two");
    return (await mysql("SHOW DATABASES;")).stdout;
  }, (o) => o.includes("e2e_two"));
  await step("changeMariaDbPassword and back", async () => {
    await changeMariaDbPassword(cfg, "Pw-e2e'1");
    cfg.mariadbPassword = "Pw-e2e'1"; // what the UI saves after a successful change
    const a = (await mysql("SELECT 1;", "Pw-e2e'1")).stdout.trim();
    await changeMariaDbPassword(cfg, "password");
    cfg.mariadbPassword = "password";
    const b = (await mysql("SELECT 1;", "password")).stdout.trim();
    return a + b;
  }, (v) => v === "11");
  const cli = join(binDir(root, "redis", cfg.services.redis.version), "redis-cli.exe");
  await step("redis-cli SET/GET", async () => {
    await exec([cli, "-p", "6380", "SET", "vela", RUNTIME]);
    return (await exec([cli, "-p", "6380", "GET", "vela"])).stdout.trim();
  }, (v) => v === RUNTIME);

  // --- lifecycle -----------------------------------------------------------------------------
  for (const s of ["nginx", "php", "mariadb", "redis"] as ServiceName[]) {
    await step(`restartService ${s}`, async () => {
      const before = running.get(s)?.child.pid;
      const st = await restartService(cfg, s);
      return { st, changed: st.pid !== before };
    }, (r) => (r.st.status === "running" && r.changed) || JSON.stringify(r.st));
  }
  await step("site still served after restarts", () => http("http://127.0.0.1:8081/info.php"), (r) => r.code === 200);

  await step("logs: list, tail, clear", () => {
    const names = listLogs(root).map((l) => l.name);
    const tail = readLogTail(root, "mariadb-run.log", 50);
    const cleared = clearLog(root, "nginx-access.log") && readFileSync(join(logsDir(root), "nginx-access.log"), "utf8") === "";
    return { names: names.length, tail: tail.length, cleared, traversal: clearLog(root, "..\\x") };
  }, (v) => (v.names >= 5 && v.tail > 0 && v.cleared && v.traversal === false) || JSON.stringify(v));
  await step("service output reaches its run log (mariadb)", () => readLogTail(root, "mariadb-run.log", 400), (t) => /ready for connections/i.test(t) || t.slice(-300));
  await step("service output reaches its run log (redis)", () => readLogTail(root, "redis-run.log", 400), (t) => /Ready to accept connections/i.test(t) || t.slice(-300));

  await step("crash detection (kill redis behind Vela's back)", async () => {
    let crashed = "";
    const off = onUnexpectedExit((s) => (crashed = s));
    const pid = running.get("redis")!.child.pid!;
    await killTree(pid);
    for (let i = 0; i < 30 && !crashed; i++) await sleep(100);
    off();
    return { crashed, status: (await getStatusFor(cfg, "redis")).status };
  }, (v) => (v.crashed === "redis" && v.status === "stopped") || JSON.stringify(v));
  await step("start redis again", () => startService(cfg, "redis"), (s) => s.status === "running");

  await step("foreign process on a service port: occupied, never killed", async () => {
    const foreign = join(root, "foreign-redis");
    copyDir(binDir(root, "redis", cfg.services.redis.version), foreign);
    const p = spawn(join(foreign, "redis-server.exe"), ["--port", "6381", "--bind", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
    for (let i = 0; i < 30 && !(await portOpen(6381, "127.0.0.1", 200)); i++) await sleep(100);
    const c2: Config = { ...cfg, services: { ...cfg.services, redis: { ...cfg.services.redis, port: 6381 } } };
    const st = await getStatusFor(c2, "redis");
    let threw = "";
    try {
      await stopService("redis", c2);
    } catch (e) {
      threw = e instanceof ForeignPortError ? "ForeignPortError" : String(e);
    }
    const alive = await portOpen(6381);
    if (p.pid) await killTree(p.pid);
    return { status: st.status, threw, alive };
  }, (v) => (v.status === "occupied" && v.threw === "ForeignPortError" && v.alive) || JSON.stringify(v));

  await step("autostart (read only)", async () => ({ can: canAutostart(), enabled: await autostartEnabled() }), (v) => v.can === (RUNTIME === "txiki") && typeof v.enabled === "boolean"); // a txiki build is already the packaged exe
} finally {
  await step("stopAllServices", () => stopAllServices(cfg), (e) => e.length === 0 || e.map((x) => x.message).join(" | "));
  await step("every port closed, nothing tracked", async () => {
    const open: number[] = [];
    for (const p of [8081, 8443, 9100, 9101, 9102, 9103, 3307, 6380, 6381]) if (await portOpen(p, "127.0.0.1", 300)) open.push(p);
    return { open, tracked: [...running.keys()] };
  }, (v) => (v.open.length === 0 && v.tracked.length === 0) || JSON.stringify(v));
  await step("redis kept its data dir", () => existsSync(dataDir(root, "redis")) && readdirSync(dataDir(root, "redis")).length >= 0, (v) => v);
}

say(`${failures ? `${failures} FAILED` : "ALL PASSED"} — ${RUNTIME} — ${((Date.now() - t0) / 1000).toFixed(0)}s`);
try {
  writeFileSync(join(tmpdir(), `vela-e2e-${RUNTIME}.log`), lines.join("\n") + "\n");
} catch {
  /* console only */
}
process.exit(failures ? 1 : 0);

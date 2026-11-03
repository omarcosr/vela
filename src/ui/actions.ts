/** Everything the UI does: start/stop/install, logs, settings, theme, tray and hotkeys. Views only call these. */
import { openExternal, type ToastItem } from "@tarve/core";
import { createDatabase, phpPools, reloadNginx, ALL_SERVICES, changeMariaDbPassword, ForeignPortError, getAllStatus, mariaDbInitialized, PHP_WORKERS, restartService, type ServiceState, startAll, startService, stopAllServices, stopService } from "../core/services";
import { addSite, nameFromFolder, newSiteFolder, removeSite, siteDomain, siteUrl, syncWwwSites } from "../core/sites";
import { applyTemplate, dbNameFor, setupLog } from "../core/templates";
import { caTrusted, ensureSiteCert, trustCa } from "../core/certs";
import { syncHosts } from "../core/hosts";
import { autostartEnabled, canAutostart, setAutostart } from "../core/autostart";
import { ensureAdminer } from "../core/adminer";
import { spawn } from "node:child_process";
import { installVersion } from "../core/installer";
import { isValidPort, saveConfig, SITE_NAME, type SiteConfig } from "../core/config";
import { basename } from "node:path";
import { levelOf, listLogs, readLogTail } from "../core/logs";
import type { ServiceName } from "../core/manifest";
import { anyBusy, anyRunning, ask, errText, findStatus, localUrl, scanInstalled, SERVICE_META, type Tab, toast, ui, update } from "./store";
import { applyDark, systemPrefersDark, type ThemeMode, fmtUptime } from "./theme";

let lastRefreshKey = "";

/**
 * The 3 s poll. Re-renders only when something it shows changed (status, a formatted uptime,
 * new log lines, imported sites), so an idle window does no layout or paint work.
 */
export async function refresh() {
  if (ui.refreshing) return;
  ui.refreshing = true;
  let changed = false;
  try {
    ui.statuses = await getAllStatus(ui.cfg);
    if (ui.tab === "logs" && ui.logFollow) changed = loadLogs() || changed;
    if (ui.tab === "sites" && syncWwwSites(ui.cfg)) {
      saveConfig(ui.cfg);
      void applySites();
      changed = true;
    }
    updateTray();
    if (ui.cfg.theme === "system") await applyTheme();
  } finally {
    ui.refreshing = false;
  }
  const key = JSON.stringify(ui.statuses.map((s) => ({ ...s, uptimeMs: fmtUptime(s.uptimeMs) })));
  if (changed || key !== lastRefreshKey) {
    lastRefreshKey = key;
    update();
  }
}

/**
 * A process Vela started exited on its own (proc.ts knows the difference: stops and restarts
 * flag their processes first). Replaces the old "was running, now stopped" status diff, which
 * also fired right after the user clicked Parar.
 */
export function onCrash(service: string, code: number | null) {
  const name = service as ServiceName;
  if (!SERVICE_META[name]) return;
  const title = `${SERVICE_META[name].title} crashed`;
  const body = code !== null ? `The process exited with code ${code}. Check the log.` : "The process stopped unexpectedly. Check the log.";
  toast(title, body, "destructive", { label: "Restart", onClick: () => void onToggleRun(name) });
  if (ui.cfg.notifyCrash) notify(`crash-${name}`, title, body, () => openLogs(name));
  void refresh();
}

/** Run an action for one service with its busy flag set; never leaves the flag stuck. */
export async function withBusy(name: ServiceName, fn: () => Promise<void>) {
  if (ui.busy[name]) return;
  ui.busy[name] = true;
  update();
  try {
    await fn();
  } catch (err) {
    toast(`${SERVICE_META[name].title}: error`, errText(err), "destructive");
  } finally {
    ui.busy[name] = false;
    await refresh();
  }
}

export async function onStartAll() {
  if (anyBusy()) return;
  const toInstall = ALL_SERVICES.filter((s) => ui.cfg.services[s].enabled && findStatus(s).status === "not-installed");
  if (toInstall.length) {
    toast("Install first", toInstall.map((s) => `${SERVICE_META[s].title} ${ui.cfg.services[s].version}`).join(", "), "destructive");
    return;
  }
  ui.globalBusy = "start";
  update();
  try {
    const results = await startAll(ui.cfg);
    const failed = results.filter((r) => r.status !== "running");
    if (results.length === 0) toast("Nothing to start", "Enable at least one service.");
    else if (failed.length === 0) toast("Stack is running", `http://localhost${ui.cfg.services.nginx.port === 80 ? "" : `:${ui.cfg.services.nginx.port}`}/`, "success");
    else toast(`${failed.length} service(s) failed to start`, failed.map((f) => `${SERVICE_META[f.service].title}: ${f.message ?? f.status}`).join("\n"), "destructive");
  } catch (err) {
    toast("Error starting", errText(err), "destructive");
  } finally {
    ui.globalBusy = null;
    await refresh();
  }
}

export async function onStopAll(skipConfirm = false) {
  if (anyBusy()) return;
  if (!skipConfirm) {
    const n = ui.statuses.filter((s) => s.status === "running").length;
    return ask("Stop the stack?", `${n} service(s) will be stopped. Open database and Redis connections will be dropped.`, "Stop all", () => void onStopAll(true));
  }
  ui.globalBusy = "stop";
  update();
  try {
    const errors = await stopAllServices(ui.cfg);
    if (errors.length === 0) toast("Stack stopped", undefined, "success");
    else toast(`${errors.length} service(s) are still running`, errors.map((e) => e.message).join("\n"), "destructive", portAction(errors));
  } catch (err) {
    toast("Error stopping", errText(err), "destructive");
  } finally {
    ui.globalBusy = null;
    await refresh();
  }
}

export function onInstall(name: ServiceName) {
  const version = ui.cfg.services[name].version;
  return withBusy(name, async () => {
    try {
      await installVersion(ui.cfg.root, name, version, (p) => {
        ui.progress[name] = p;
        update();
      });
      ui.installed = scanInstalled();
      toast(`${SERVICE_META[name].title} ${version} installed`, undefined, "success");
      if (ui.cfg.notifyInstall) notify(`install-${name}`, `${SERVICE_META[name].title} ${version} installed`, "Ready to start.");
    } catch (err) {
      toast(`Failed to install ${SERVICE_META[name].title} ${version}`, errText(err), "destructive");
    }
  });
}

export function onToggleRun(name: ServiceName) {
  const st = findStatus(name);
  if (st.status === "not-installed") return onInstall(name);
  if (st.status === "occupied") {
    return toast(`Port ${st.port} is in use`, `${st.owner} is using the ${SERVICE_META[name].title} port.`, "destructive", { label: "Change port", onClick: () => openServiceSettings(name) });
  }
  return withBusy(name, async () => {
    if (st.status === "running" || st.status === "starting") {
      try {
        await stopService(name, ui.cfg);
        toast(`${SERVICE_META[name].title} stopped`, undefined, "success");
      } catch (err) {
        toast(`Couldn't stop ${SERVICE_META[name].title}`, errText(err), "destructive", portAction([err]));
      }
    } else {
      const res = await startService(ui.cfg, name);
      if (res.status === "running" && !res.orphan) toast(`${SERVICE_META[name].title} running`, `port ${res.port}`, "success");
      else toast(`${SERVICE_META[name].title} failed to start`, res.message, "destructive");
    }
  });
}

export function onRestart(name: ServiceName) {
  return withBusy(name, async () => {
    let res: ServiceState;
    try {
      res = await restartService(ui.cfg, name);
    } catch (err) {
      return toast(`Couldn't restart ${SERVICE_META[name].title}`, errText(err), "destructive", portAction([err]));
    }
    if (res.status === "running") toast(`${SERVICE_META[name].title} restarted`, undefined, "success");
    else toast(`${SERVICE_META[name].title} didn't come back up`, res.message, "destructive");
  });
}

let logKey = "";

/** Reload the selected log; the tail is re-read only when the file changed. True when it did. */
export function loadLogs(): boolean {
  ui.logFiles = listLogs(ui.cfg.root);
  if (!ui.selectedLog || !ui.logFiles.some((f) => f.name === ui.selectedLog)) ui.selectedLog = ui.logFiles[0]?.name ?? null;
  const f = ui.logFiles.find((x) => x.name === ui.selectedLog);
  const key = `${ui.selectedLog}|${f?.size}|${f?.modified}|${ui.logNewestFirst}|${ui.logFiles.length}`;
  if (key === logKey) return false;
  logKey = key;
  const raw = ui.selectedLog ? readLogTail(ui.cfg.root, ui.selectedLog, 800) : "";
  ui.logLines = raw ? raw.split("\n") : [];
  if (ui.logNewestFirst) ui.logLines.reverse();
  return true;
}

export function visibleLogLines() {
  const q = ui.logQuery.trim().toLowerCase();
  return ui.logLines.filter((l) => {
    if (q && !l.toLowerCase().includes(q)) return false;
    const lv = levelOf(l);
    return ui.logLevel === "all" || (ui.logLevel === "warn" ? lv !== "all" : lv === "error");
  });
}

export function openLogs(service?: ServiceName) {
  ui.tab = "logs";
  ui.logFiles = listLogs(ui.cfg.root);
  if (service) {
    const pref = ui.logFiles.find((f) => f.name === `${service}-error.log`) ?? ui.logFiles.find((f) => f.name.startsWith(service));
    if (pref) ui.selectedLog = pref.name;
  }
  loadLogs();
  update();
}

/** Open the Logs tab on a specific file (site logs, setup logs). */
export function openLogFile(name: string) {
  ui.tab = "logs";
  ui.logFiles = listLogs(ui.cfg.root);
  ui.selectedLog = name;
  loadLogs();
  update();
}

export function saveRoot() {
  const next = ui.form.root.trim();
  if (!next) return toast("Enter a folder", undefined, "destructive");
  if (anyRunning()) return toast("Stop the stack first", "The folder can't be changed while services are running.", "destructive");
  ui.cfg.root = next;
  saveConfig(ui.cfg);
  ui.installed = scanInstalled();
  toast("Stack folder updated", ui.cfg.root, "success");
  void refresh();
}

/** php uses PHP_WORKERS consecutive ports; returns a message for the first clash. */
function portConflict(parsed: Record<ServiceName, number>): string | null {
  const taken = new Map<number, ServiceName>();
  for (const s of ALL_SERVICES) {
    const span = s === "php" ? PHP_WORKERS : 1;
    for (let i = 0; i < span; i++) {
      const other = taken.get(parsed[s] + i);
      if (other) return `${SERVICE_META[s].title} and ${SERVICE_META[other].title} are using ${parsed[s] + i}`;
      taken.set(parsed[s] + i, s);
    }
  }
  return null;
}

export function openServiceSettings(name: ServiceName) {
  const s = ui.cfg.services[name];
  ui.svcEdit = { name, version: s.version, port: String(s.port), enabled: s.enabled, dbPass: "", dbPass2: "", showPass: false };
  update();
}

export function saveServiceSettings() {
  const e = ui.svcEdit;
  if (!e) return;
  const name = e.name;
  const port = Number(e.port);
  if (!isValidPort(port)) return toast("Invalid port", `"${e.port}"`, "destructive");
  const parsed = Object.fromEntries(ALL_SERVICES.map((s) => [s, s === name ? port : ui.cfg.services[s].port])) as Record<ServiceName, number>;
  const conflict = portConflict(parsed);
  if (conflict) return toast("Port conflict", conflict, "destructive");
  if (name === "mariadb" && (e.dbPass || e.dbPass2)) {
    if (e.dbPass !== e.dbPass2) return toast("Passwords don't match", undefined, "destructive");
    const pass = e.dbPass;
    e.dbPass = e.dbPass2 = "";
    void withBusy("mariadb", async () => {
      try {
        await changeMariaDbPassword(ui.cfg, pass);
        ui.cfg.mariadbPassword = pass;
        saveConfig(ui.cfg);
        toast("MariaDB password changed", mariaDbInitialized(ui.cfg) ? "Applied to user " + ui.cfg.mariadbUser + "." : "It will be used when creating the data directory.", "success");
      } catch (err) {
        toast("Couldn't change the password", errText(err), "destructive");
      }
    });
  }

  const cur = ui.cfg.services[name];
  const changed = cur.version !== e.version || cur.port !== port;
  const wasRunning = findStatus(name).status === "running";
  const apply = () => {
    cur.version = e.version;
    cur.port = port;
    cur.enabled = e.enabled;
    ui.form.ports[name] = String(port);
    saveConfig(ui.cfg);
  };
  ui.svcEdit = null;
  const title = SERVICE_META[name].title;
  const needsInstall = !ui.installed[name].includes(e.version);
  if (!changed || !wasRunning) {
    apply();
    toast(`${title} configured`, `${e.version} · port ${port}`, "success", needsInstall ? { label: "Install", onClick: () => void onInstall(name) } : undefined);
    return void refresh();
  }
  // stop with the old version/port, then start with the new ones
  return withBusy(name, async () => {
    await stopService(name, ui.cfg);
    apply();
    if (needsInstall) return toast(`${title} ${e.version} isn't installed`, "Install it to start with the new version.", "destructive", { label: "Install", onClick: () => void onInstall(name) });
    const res = await startService(ui.cfg, name);
    if (res.status === "running") toast(`${title} restarted`, `${e.version} · port ${port}`, "success");
    else toast(`${title} did not start`, res.message, "destructive");
  });
}

export async function applyTheme() {
  const next = ui.cfg.theme === "system" ? await systemPrefersDark() : ui.cfg.theme === "dark";
  if (applyDark(next)) update();
}

type BoolPref = "notifyCrash" | "notifyInstall" | "tray" | "closeToTray" | "autoStart" | "stopOnExit";

export function setPref(key: BoolPref, v: boolean) {
  ui.cfg[key] = v;
  saveConfig(ui.cfg);
  if (key === "tray") {
    if (!v) {
      ui.tray?.remove();
      ui.tray = null;
    }
    ui.trayKey = "";
    updateTray();
  }
  update();
}

function notify(id: string, title: string, body: string, onClick?: () => void) {
  try {
    ui.handle?.notify({ title, body, id, onClick: () => { ui.handle?.activate(); onClick?.(); } });
  } catch {
    /* notifications unavailable */
  }
}

export function setTheme(mode: ThemeMode) {
  ui.cfg.theme = mode;
  if (!process.env.VELA_THEME) saveConfig(ui.cfg);
  void applyTheme();
  update();
}

export function savePorts() {
  const parsed = {} as Record<ServiceName, number>;
  for (const s of ALL_SERVICES) {
    const n = Number(ui.form.ports[s]);
    if (!isValidPort(n)) return toast("Invalid port", `${SERVICE_META[s].title}: "${ui.form.ports[s]}"`, "destructive");
    parsed[s] = n;
  }
  const conflict = portConflict(parsed);
  if (conflict) return toast("Port conflict", conflict, "destructive");
  const changedRunning = ALL_SERVICES.filter((s) => parsed[s] !== ui.cfg.services[s].port && findStatus(s).status === "running");
  for (const s of ALL_SERVICES) ui.cfg.services[s].port = parsed[s];
  saveConfig(ui.cfg);
  toast(
    "Ports saved",
    changedRunning.length ? `Restart: ${changedRunning.map((s) => SERVICE_META[s].title).join(", ")}` : undefined,
    "success",
  );
  void refresh();
}

export function connectionOf(name: ServiceName): { value: string; href?: string } {
  const { port } = ui.cfg.services[name];
  switch (name) {
    case "nginx":
      return { value: localUrl(), href: localUrl() };
    case "php":
      return { value: `fastcgi_pass 127.0.0.1:${port}` };
    case "mariadb":
      return { value: `mysql -h 127.0.0.1 -P ${port} -u ${ui.cfg.mariadbUser} -p` };
    case "redis":
      return { value: `redis-cli -p ${port}` };
  }
}

/** Toast action for a port held by another program: jump to the port settings. */
function portAction(errors: unknown[]): ToastItem["action"] {
  return errors.some((e) => e instanceof ForeignPortError) ? { label: "Change port", onClick: () => goTo("settings") } : undefined;
}

export function goTo(t: Tab) {
  if (t === "logs") return openLogs();
  ui.tab = t;
  if (t === "settings" && ui.autostart === undefined) void loadAutostart();
  if ((t === "sites" || t === "settings") && ui.caTrusted === null) void caTrusted(ui.cfg).then((v) => { ui.caTrusted = v; update(); });
  if (t === "sites") {
    if (syncWwwSites(ui.cfg)) {
      saveConfig(ui.cfg);
      void applySites();
    }
  }
  update();
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

const siteBy = (name: string) => ui.cfg.sites.find((s) => s.name === name);
let phpPoolKey = "";

/**
 * Make the running stack match ui.cfg.sites: certificates for HTTPS sites, the hosts block for
 * .test, an Nginx reload, and a PHP restart when the set of PHP versions changed.
 */
export async function applySites(): Promise<void> {
  const cfg = ui.cfg;
  for (const s of cfg.sites.filter((x) => x.https)) {
    try {
      await ensureSiteCert(cfg, siteDomain(cfg, s));
    } catch (err) {
      toast(`HTTPS for ${s.name}`, errText(err), "destructive");
    }
  }
  if (cfg.siteTld === "test") {
    try {
      await syncHosts(cfg.sites.map((s) => siteDomain(cfg, s)));
    } catch (err) {
      toast(".test domains not registered", errText(err), "destructive", { label: "Use .localhost", onClick: () => void setSiteTld("localhost") });
    }
  }
  const pools = phpPools(cfg).map((p) => p.version).join(",");
  if (phpPoolKey && pools !== phpPoolKey && findStatus("php").status === "running") {
    await withBusy("php", async () => {
      await restartService(cfg, "php");
    });
  }
  phpPoolKey = pools;
  try {
    await reloadNginx(cfg);
  } catch (err) {
    toast("Nginx failed to reload", errText(err), "destructive", { label: "View log", onClick: () => openLogs("nginx") });
  }
  update();
}

function siteTask(name: string, step: string | null) {
  if (step === null) delete ui.siteTasks[name];
  else ui.siteTasks[name] = step;
  update();
}

export function openNewSite(folder: string | null = null) {
  ui.newSite = { name: folder ? nameFromFolder(ui.cfg, basename(folder)) : "", template: "blank", folder, db: false, https: false };
  update();
}

export async function pickFolderForSite() {
  const folder = await ui.handle?.openFolderDialog({ title: "Project folder" });
  if (folder) openNewSite(folder);
}

/** Create (template) or add (existing folder) the site described by ui.newSite. */
export async function submitNewSite() {
  const d = ui.newSite;
  if (!d) return;
  const cfg = ui.cfg;
  let site: SiteConfig;
  try {
    if (d.folder) site = addSite(cfg, d.folder, d.name);
    else {
      const path = newSiteFolder(cfg, d.name);
      site = { name: d.name, path, docroot: "", https: false };
      cfg.sites.push(site);
    }
  } catch (err) {
    return toast("Couldn't create", errText(err), "destructive");
  }
  site.https = d.https;
  ui.newSite = null;
  saveConfig(cfg);
  update();
  if (!d.folder) {
    try {
      await applyTemplate(cfg, site, d.template, d.db, (m) => siteTask(site.name, m));
    } catch (err) {
      toast(`${site.name}: setup incomplete`, errText(err), "destructive", { label: "View log", onClick: () => openLogFile(`site-${site.name}-setup.log`) });
    } finally {
      siteTask(site.name, null);
    }
    saveConfig(cfg);
  } else if (d.db) {
    try {
      siteTask(site.name, "Creating database…");
      await createDatabase(cfg, dbNameFor(site.name));
    } catch (err) {
      toast("Database not created", errText(err), "destructive");
    } finally {
      siteTask(site.name, null);
    }
  }
  siteTask(site.name, "Applying…");
  await applySites();
  siteTask(site.name, null);
  const nginxUp = findStatus("nginx").status === "running";
  toast(`Site ${siteDomain(cfg, site)} is ready`, site.path, "success", nginxUp ? { label: "Open", onClick: () => openExternal(siteUrl(cfg, site)) } : { label: "Start Nginx", onClick: () => void onToggleRun("nginx") });
}

export function openSiteSettings(name: string) {
  const s = siteBy(name);
  if (!s) return;
  ui.siteEdit = { name, newName: name, docroot: s.docroot, php: s.php ?? "", https: s.https };
  update();
}

export async function saveSiteSettings() {
  const e = ui.siteEdit;
  const s = e && siteBy(e.name);
  if (!e || !s) return;
  const newName = e.newName.trim();
  if (!SITE_NAME.test(newName)) return toast("Invalid name", "Lowercase letters, numbers, and - (like a domain name)", "destructive");
  if (newName !== s.name && siteBy(newName)) return toast(`A site named "${newName}" already exists`, undefined, "destructive");
  s.name = newName;
  s.docroot = e.docroot;
  s.php = e.php || undefined;
  s.https = e.https;
  ui.siteEdit = null;
  saveConfig(ui.cfg);
  siteTask(s.name, "Applying…");
  await applySites();
  siteTask(s.name, null);
  toast(`${siteDomain(ui.cfg, s)} updated`, undefined, "success");
}

export function confirmRemoveSite(name: string) {
  const s = siteBy(name);
  if (!s) return;
  ask(`Remove ${siteDomain(ui.cfg, s)}?`, `Vela will stop serving this site. Files in ${s.path} won't be deleted.`, "Remove", () => {
    removeSite(ui.cfg, name);
    ui.siteEdit = null;
    saveConfig(ui.cfg);
    void applySites();
    toast(`${name} removed`, "Files kept.");
  });
}

export function openSite(name: string) {
  const s = siteBy(name);
  if (s) openExternal(siteUrl(ui.cfg, s));
}

export function openSiteInEditor(name: string) {
  const s = siteBy(name);
  if (s) openExternal(`vscode://file/${s.path.replace(/\\/g, "/")}`);
}

/** Windows Terminal in the project folder, else PowerShell (its own window, on purpose). */
export function openSiteTerminal(name: string) {
  const s = siteBy(name);
  if (!s) return;
  const run = (cmd: string, args: string[]) =>
    new Promise<boolean>((done) => {
      const p = spawn(cmd, args, { cwd: s.path, detached: true, stdio: "ignore" });
      p.once("error", () => done(false));
      p.once("spawn", () => {
        p.unref();
        done(true);
      });
    });
  void run("wt.exe", ["-d", s.path]).then((ok) => ok || run("powershell.exe", ["-NoExit", "-NoLogo"]));
}

export function openSiteLogs(name: string) {
  openLogFile(`site-${name}-error.log`);
}

export async function setSiteTld(tld: "localhost" | "test") {
  if (ui.cfg.siteTld === tld) return;
  const prev = ui.cfg.siteTld;
  ui.cfg.siteTld = tld;
  saveConfig(ui.cfg);
  update();
  // leaving .test: drop the hosts block (one more UAC prompt)
  if (prev === "test") await syncHosts([]).catch(() => {});
  await applySites();
}

export function saveHttpsPort() {
  const p = Number(ui.form.httpsPort);
  if (!isValidPort(p)) return toast("Invalid port", `"${ui.form.httpsPort}"`, "destructive");
  ui.cfg.httpsPort = p;
  saveConfig(ui.cfg);
  toast("HTTPS port saved", `${p}`, "success");
  void applySites();
}

export async function onTrustCa() {
  try {
    await trustCa(ui.cfg);
    ui.caTrusted = await caTrusted(ui.cfg);
    toast(ui.caTrusted ? "Vela certificate installed" : "Certificate not installed", ui.caTrusted ? "Reopen your browser for HTTPS to appear as secure." : undefined, ui.caTrusted ? "success" : "destructive");
  } catch (err) {
    toast("Certificate not installed", errText(err), "destructive");
  }
  update();
}

export { setupLog };

function updateTray() {
  if (!ui.handle || process.env.VELA_CAPTURE || !ui.cfg.tray) return;
  const up = ui.statuses.filter((s) => s.status === "running").length;
  const key = ui.statuses.map((s) => s.status).join(",") + (ui.globalBusy ?? "");
  if (key === ui.trayKey) return;
  ui.trayKey = key;
  const opts = {
    tooltip: `Vela — ${up}/${ALL_SERVICES.length} running`,
    onClick: () => ui.handle?.activate(),
    menu: [
      { id: "show", label: "Show Vela", onSelect: () => ui.handle?.activate() },
      { type: "separator" as const },
      ...ALL_SERVICES.map((s) => ({
        id: `svc-${s}`,
        label: `${SERVICE_META[s].title}`,
        checked: findStatus(s).status === "running",
        disabled: findStatus(s).status === "not-installed" || findStatus(s).status === "occupied" || anyBusy(),
        onSelect: () => void onToggleRun(s),
      })),
      { type: "separator" as const },
      { id: "start", label: "Start all", disabled: anyBusy(), onSelect: () => void onStartAll() },
      { id: "stop", label: "Stop all", disabled: anyBusy() || up === 0, onSelect: () => void onStopAll(true) },
      { id: "open", label: "Open localhost", onSelect: () => openExternal(localUrl()) },
      { type: "separator" as const },
      { id: "quit", label: "Quit", onSelect: () => { ui.quitting = true; ui.handle?.close(); } },
    ],
  };
  try {
    if (ui.tray) ui.tray.update(opts);
    else ui.tray = ui.handle.tray(opts);
  } catch {
    /* no tray host */
  }
}

/** Shown in the F1 dialog; registerHotkeys() below is the source of truth for the bindings. */
export const SHORTCUTS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: "Navigation",
    items: [
      { keys: ["Ctrl", "1"], label: "Services" },
      { keys: ["Ctrl", "2"], label: "Sites" },
      { keys: ["Ctrl", "3"], label: "Logs" },
      { keys: ["Ctrl", "4"], label: "Settings" },
    ],
  },
  {
    group: "Stack",
    items: [
      { keys: ["Ctrl", "Enter"], label: "Start all" },
      { keys: ["Ctrl", "Shift", "X"], label: "Stop all" },
      { keys: ["F5"], label: "Refresh status" },
    ],
  },
  {
    group: "General",
    items: [
      { keys: ["Ctrl", "L"], label: "Open localhost" },
      { keys: ["Ctrl", "F"], label: "Search logs" },
      { keys: ["F1"], label: "Show this list" },
    ],
  },
];

export function registerHotkeys() {
  if (!ui.handle) return;
  const h = ui.handle;
  const tabs: Tab[] = ["services", "sites", "logs", "settings"];
  tabs.forEach((t, i) => h.registerHotkey(`Ctrl+${i + 1}`, () => goTo(t)));
  h.registerHotkey("Ctrl+Enter", () => void onStartAll());
  h.registerHotkey("Ctrl+Shift+X", () => void onStopAll());
  h.registerHotkey("F5", () => void refresh());
  h.registerHotkey("Ctrl+L", () => openExternal(localUrl()));
  h.registerHotkey("Ctrl+F", () => {
    openLogs();
    h.focus("log-search");
  });
  h.registerHotkey("F1", () => {
    ui.helpOpen = !ui.helpOpen;
    update();
  });
}

// ---------------------------------------------------------------------------
// Windows sign-in, Adminer
// ---------------------------------------------------------------------------

export async function loadAutostart() {
  ui.autostart = canAutostart() ? await autostartEnabled() : null;
  update();
}

export async function toggleAutostart(on: boolean) {
  try {
    await setAutostart(on);
    ui.autostart = await autostartEnabled();
  } catch (err) {
    toast("Could not change sign-in startup", errText(err), "destructive");
  }
  update();
}

/** Install Adminer as the "adminer" site if needed, then open it (Nginx and PHP must be up). */
export async function openAdminer() {
  try {
    const site = await ensureAdminer(ui.cfg);
    saveConfig(ui.cfg);
    await applySites();
    const missing = (["nginx", "php"] as const).filter((s) => findStatus(s).status !== "running");
    if (missing.length) {
      return toast("Adminer is ready", `Start ${missing.map((s) => SERVICE_META[s].title).join(" and ")} to open it.`, "default", {
        label: "Start",
        onClick: () => void Promise.all(missing.map((s) => onToggleRun(s))).then(() => openSite(site.name)),
      });
    }
    openSite(site.name);
  } catch (err) {
    toast("Adminer not installed", errText(err), "destructive");
  }
}

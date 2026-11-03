/** UI state (one `ui` object) and the small helpers every view uses: toast, ask, findStatus. */
import { createApp, type ToastItem, type TrayHandle } from "@tarve/core";
import { ALL_SERVICES, PHP_WORKERS, type ServiceState } from "../core/services";
import { installedVersions, type InstallProgress } from "../core/installer";
import { loadConfig } from "../core/config";
import type { LogFile, LogLevel } from "../core/logs";
import type { ServiceName } from "../core/manifest";
import type { Template } from "../core/templates";

export const SERVICE_META: Record<ServiceName, { title: string; description: string }> = {
  nginx: { title: "Nginx", description: "Web server; forwards .php via FastCGI." },
  php: { title: "PHP", description: `php-cgi NTS with ${PHP_WORKERS} FastCGI workers.` },
  mariadb: { title: "MariaDB", description: "Database with a portable data directory." },
  redis: { title: "Redis", description: "In-memory cache, bound to 127.0.0.1." },
};

export type Tab = "services" | "sites" | "logs" | "settings";

/** All UI state. Tarve is render-driven: handlers mutate `ui`, then call update(). */
export const ui = {
  cfg: loadConfig(),
  statuses: [] as ServiceState[],
  /** Installed versions per service (bin/<service>/<version>). */
  installed: {} as Record<ServiceName, string[]>,
  busy: {} as Partial<Record<ServiceName, boolean>>,
  globalBusy: null as "start" | "stop" | null,
  progress: {} as Partial<Record<ServiceName, InstallProgress>>,
  toasts: [] as ToastItem[],
  tab: "services" as Tab,

  logFiles: [] as LogFile[],
  selectedLog: null as string | null,
  logNewestFirst: true,
  logFollow: true,
  logLines: [] as string[],
  logQuery: "",
  logLevel: "all" as LogLevel,

  /** Long-running site work (template setup, certificates) by site name: the step being run. */
  siteTasks: {} as Record<string, string>,
  /** "New site" / "Add folder" dialog. */
  newSite: null as { name: string; template: Template; folder: string | null; db: boolean; https: boolean } | null,
  /** Site settings dialog draft; `name` is the site being edited. */
  siteEdit: null as { name: string; newName: string; docroot: string; php: string; https: boolean } | null,
  /** Is the Vela CA trusted by Windows (null: not checked yet). */
  caTrusted: null as boolean | null,
  /** Registered to open at Windows sign-in; null when not possible (dev run), undefined: not checked. */
  autostart: undefined as boolean | null | undefined,

  confirm: null as { title: string; description: string; actionLabel: string; run: () => void; destructive: boolean } | null,
  helpOpen: false,
  /** Draft of the per-service settings modal; applied on Salvar. */
  svcEdit: null as { name: ServiceName; version: string; port: string; enabled: boolean; dbPass: string; dbPass2: string; showPass: boolean } | null,
  /** Draft of the Settings forms. */
  form: { root: "", ports: {} as Record<ServiceName, string>, httpsPort: "" },

  /** Close requests hide to the tray unless this is set (tray "Sair"). */
  quitting: false,
  tray: null as TrayHandle | null,
  trayKey: "",
  handle: null as ReturnType<typeof createApp> | null,
  refreshTimer: null as ReturnType<typeof setInterval> | null,
  refreshing: false,
};
ui.installed = scanInstalled();
ui.form = {
  root: ui.cfg.root,
  ports: Object.fromEntries(ALL_SERVICES.map((s) => [s, String(ui.cfg.services[s].port)])) as Record<ServiceName, string>,
  httpsPort: String(ui.cfg.httpsPort),
};

export const update = () => ui.handle?.update();

export const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function scanInstalled(): Record<ServiceName, string[]> {
  return Object.fromEntries(ALL_SERVICES.map((s) => [s, installedVersions(ui.cfg.root, s)])) as Record<ServiceName, string[]>;
}

export function toast(title: string, description?: string, variant: ToastItem["variant"] = "default", action?: ToastItem["action"]) {
  const id = `${Date.now()}-${Math.random()}`;
  const wrapped = action ? { label: action.label, onClick: () => { ui.toasts = ui.toasts.filter((t) => t.id !== id); action.onClick(); } } : undefined;
  ui.toasts = [...ui.toasts.slice(-3), { id, title, description, variant, action: wrapped }];
  setTimeout(() => {
    ui.toasts = ui.toasts.filter((t) => t.id !== id);
    update();
  }, action ? 12000 : variant === "destructive" ? 7000 : 4200);
  update();
}

/** Ask before something disruptive; `run` executes on confirm. */
export function ask(title: string, description: string, actionLabel: string, run: () => void, destructive = true) {
  ui.confirm = { title, description, actionLabel, run, destructive };
  update();
}

export function findStatus(name: ServiceName): ServiceState {
  return (
    ui.statuses.find((s) => s.service === name) ?? {
      service: name,
      status: "stopped",
      port: ui.cfg.services[name].port,
      version: ui.cfg.services[name].version,
    }
  );
}

export const anyBusy = () => ui.globalBusy !== null || ALL_SERVICES.some((s) => ui.busy[s]);

export const anyRunning = () => ui.statuses.some((s) => s.status === "running" || s.status === "starting");

export function localUrl(path = "") {
  const p = ui.cfg.services.nginx.port;
  return `http://localhost${p === 80 ? "" : `:${p}`}/${path}`;
}

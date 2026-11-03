import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type ServiceKey = "nginx" | "php" | "mariadb" | "redis";

export const APP_NAME = "Vela";
export const APP_ID = "Vela.Stack";

export interface ServiceConfig {
  version: string;
  enabled: boolean;
  port: number;
}

/** A project served by Nginx on its own domain (<name>.<siteTld>). */
export interface SiteConfig {
  /** Also the subdomain: letters, digits, "-" (DNS label). */
  name: string;
  /** Project folder (anywhere on disk, or inside www). */
  path: string;
  /** Document root relative to path: "" (the folder itself), "public", "web"… */
  docroot: string;
  /** PHP version for this site; undefined = the PHP service's version. */
  php?: string;
  /** Also serve https://<domain> with a certificate from Vela's local CA. */
  https: boolean;
}

export interface Config {
  root: string;
  services: Record<ServiceKey, ServiceConfig>;
  /** Start every enabled service when the app opens. */
  autoStart: boolean;
  /** Stop the services this app started when the window closes. */
  stopOnExit: boolean;
  mariadbUser: string;
  mariadbPassword: string;
  /** UI palette; "system" follows Windows' app theme. */
  theme: "light" | "dark" | "system";
  /** Windows notification when a service crashes. */
  notifyCrash: boolean;
  /** Windows notification when a download/install finishes. */
  notifyInstall: boolean;
  /** Icon in the notification area with a service menu. */
  tray: boolean;
  /** The window close button hides to the tray instead of quitting. */
  closeToTray: boolean;
  sites: SiteConfig[];
  /** "localhost": <site>.localhost (browsers resolve it, no admin). "test": <site>.test via the hosts file (asks for admin). */
  siteTld: "localhost" | "test";
  httpsPort: number;
  /** Folders in www the user removed from the list (not re-imported). */
  ignoredWww: string[];
}

export function defaultRoot(): string {
  return join(homedir(), "Vela");
}

export function defaultConfig(): Config {
  return {
    root: defaultRoot(),
    services: {
      nginx: { version: "1.30.6", enabled: true, port: 80 },
      php: { version: "8.4.27", enabled: true, port: 9000 },
      mariadb: { version: "11.8.9", enabled: true, port: 3306 },
      redis: { version: "8.10.3", enabled: true, port: 6379 },
    },
    autoStart: false,
    stopOnExit: true,
    mariadbUser: "root",
    mariadbPassword: "password",
    theme: "system",
    notifyCrash: true,
    notifyInstall: true,
    tray: true,
    closeToTray: false,
    sites: [],
    siteTld: "localhost",
    httpsPort: 443,
    ignoredWww: [],
  };
}

export function configPath(): string {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(localAppData, APP_NAME, "config.json");
}

export function isValidPort(p: unknown): p is number {
  return typeof p === "number" && Number.isInteger(p) && p > 0 && p < 65536;
}

export const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validSite(s: unknown): s is SiteConfig {
  const o = s as Partial<SiteConfig> | null;
  return !!o && typeof o.name === "string" && SITE_NAME.test(o.name) && typeof o.path === "string" && o.path.length > 0;
}

/** Load config.json, validating every field and falling back to defaults per field. */
export function loadConfig(): Config {
  const def = defaultConfig();
  const p = configPath();
  try {
    if (!existsSync(p)) return def;
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<Config>;
    const services = { ...def.services };
    for (const k of Object.keys(services) as ServiceKey[]) {
      const s = raw.services?.[k];
      if (!s) continue;
      services[k] = {
        version: typeof s.version === "string" && s.version ? s.version : def.services[k].version,
        enabled: typeof s.enabled === "boolean" ? s.enabled : def.services[k].enabled,
        port: isValidPort(s.port) ? s.port : def.services[k].port,
      };
    }
    return {
      root: typeof raw.root === "string" && raw.root.trim() ? raw.root : def.root,
      services,
      autoStart: typeof raw.autoStart === "boolean" ? raw.autoStart : def.autoStart,
      stopOnExit: typeof raw.stopOnExit === "boolean" ? raw.stopOnExit : def.stopOnExit,
      mariadbUser: typeof raw.mariadbUser === "string" && raw.mariadbUser ? raw.mariadbUser : def.mariadbUser,
      mariadbPassword: typeof raw.mariadbPassword === "string" ? raw.mariadbPassword : def.mariadbPassword,
      notifyCrash: typeof raw.notifyCrash === "boolean" ? raw.notifyCrash : def.notifyCrash,
      notifyInstall: typeof raw.notifyInstall === "boolean" ? raw.notifyInstall : def.notifyInstall,
      tray: typeof raw.tray === "boolean" ? raw.tray : def.tray,
      closeToTray: typeof raw.closeToTray === "boolean" ? raw.closeToTray : def.closeToTray,
      sites: Array.isArray(raw.sites) ? raw.sites.filter(validSite).map((s) => ({ name: s.name, path: s.path, docroot: typeof s.docroot === "string" ? s.docroot : "", php: typeof s.php === "string" && s.php ? s.php : undefined, https: s.https === true })) : def.sites,
      siteTld: raw.siteTld === "test" ? "test" : "localhost",
      httpsPort: isValidPort(raw.httpsPort) ? raw.httpsPort : def.httpsPort,
      ignoredWww: Array.isArray(raw.ignoredWww) ? raw.ignoredWww.filter((x): x is string => typeof x === "string") : def.ignoredWww,
      theme: raw.theme === "light" || raw.theme === "dark" || raw.theme === "system" ? raw.theme : def.theme,
    };
  } catch {
    return def;
  }
}

/** Atomic write: a crash mid-save never leaves a truncated config.json. */
export function saveConfig(cfg: Config): void {
  const p = configPath();
  mkdirSync(join(p, ".."), { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  renameSync(tmp, p);
}

// Well-known directories inside the stack root
export function binDir(root: string, service: string, version: string): string {
  return join(root, "bin", service, version);
}

export function dataDir(root: string, service: string): string {
  return join(root, "data", service);
}

export function logsDir(root: string): string {
  return join(root, "logs");
}

export function wwwDir(root: string): string {
  return join(root, "www");
}

export function tmpDir(root: string): string {
  return join(root, "tmp");
}

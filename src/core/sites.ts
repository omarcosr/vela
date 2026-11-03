/**
 * Site registry: every project Vela serves on its own domain (<name>.localhost or <name>.test).
 * Projects can live anywhere; folders dropped into www are picked up automatically.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { SITE_NAME, wwwDir, type Config, type SiteConfig } from "./config";

export { SITE_NAME };

/** Folders that usually hold the front controller, checked in order. */
const DOCROOTS = ["public", "web", "public_html", "htdocs", "dist"];

/** "public" for Laravel/Symfony-style projects, "" when the folder itself is the web root. */
export function detectDocroot(path: string): string {
  for (const d of DOCROOTS) if (existsSync(join(path, d, "index.php")) || existsSync(join(path, d, "index.html"))) return d;
  return "";
}

/** Subfolders that could be a document root, for the site settings select. */
export function docrootCandidates(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "vendor" && d.name !== "node_modules")
      .map((d) => d.name)
      .sort((a, b) => (DOCROOTS.indexOf(a) + 1 || 99) - (DOCROOTS.indexOf(b) + 1 || 99) || a.localeCompare(b));
  } catch {
    return [];
  }
}

export const siteDomain = (cfg: Config, s: SiteConfig) => `${s.name}.${cfg.siteTld}`;
export const siteRoot = (s: SiteConfig) => (s.docroot ? join(s.path, s.docroot) : s.path);

export function siteUrl(cfg: Config, s: SiteConfig, https = s.https): string {
  const port = https ? cfg.httpsPort : cfg.services.nginx.port;
  const def = https ? 443 : 80;
  return `${https ? "https" : "http"}://${siteDomain(cfg, s)}${port === def ? "" : `:${port}`}/`;
}

/** "public/index.php" etc. (what the docroot serves), or null when there is nothing to serve. */
export function siteEntry(s: SiteConfig): string | null {
  const root = siteRoot(s);
  const f = ["index.php", "index.html"].find((x) => existsSync(join(root, x)));
  return f ? (s.docroot ? `${s.docroot}/${f}` : f) : null;
}

/** A free, DNS-safe site name derived from a folder name. */
export function nameFromFolder(cfg: Config, folder: string): string {
  const base =
    folder
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "site";
  let name = base;
  for (let i = 2; cfg.sites.some((s) => s.name === name); i++) name = `${base}-${i}`;
  return name;
}

const samePath = (a: string, b: string) => normalize(resolve(a)).toLowerCase() === normalize(resolve(b)).toLowerCase();

/** Register www folders that are not sites yet (unless the user removed them). True when it changed. */
export function syncWwwSites(cfg: Config): boolean {
  const www = wwwDir(cfg.root);
  let changed = false;
  let dirs: string[] = [];
  try {
    dirs = readdirSync(www, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  } catch {
    return false;
  }
  for (const d of dirs) {
    const path = join(www, d);
    if (cfg.ignoredWww.includes(d) || cfg.sites.some((s) => samePath(s.path, path))) continue;
    cfg.sites.push({ name: nameFromFolder(cfg, d), path, docroot: detectDocroot(path), https: false });
    changed = true;
  }
  return changed;
}

/** Add an existing folder as a site. */
export function addSite(cfg: Config, path: string, name = nameFromFolder(cfg, path.split(/[\\/]/).filter(Boolean).pop() ?? "site")): SiteConfig {
  if (!SITE_NAME.test(name)) throw new Error("Name: lowercase letters, digits and - (like a domain)");
  if (cfg.sites.some((s) => s.name === name)) throw new Error(`A site named "${name}" already exists`);
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Folder not found: ${path}`);
  const existing = cfg.sites.find((s) => samePath(s.path, path));
  if (existing) throw new Error(`That folder is already the site "${existing.name}"`);
  const site: SiteConfig = { name, path, docroot: detectDocroot(path), https: false };
  cfg.sites.push(site);
  cfg.ignoredWww = cfg.ignoredWww.filter((d) => !samePath(join(wwwDir(cfg.root), d), path));
  return site;
}

/** Folder for a brand-new site: www/<name>, which must not exist yet. */
export function newSiteFolder(cfg: Config, name: string): string {
  if (!SITE_NAME.test(name)) throw new Error("Name: lowercase letters, digits and - (like a domain)");
  if (cfg.sites.some((s) => s.name === name)) throw new Error(`A site named "${name}" already exists`);
  const path = join(wwwDir(cfg.root), name);
  if (existsSync(path) && readdirSync(path).length > 0) throw new Error(`${path} already exists and is not empty`);
  mkdirSync(path, { recursive: true });
  return path;
}

/** Forget a site. Files are never deleted; a www folder is remembered so it isn't re-imported. */
export function removeSite(cfg: Config, name: string): void {
  const s = cfg.sites.find((x) => x.name === name);
  if (!s) return;
  cfg.sites = cfg.sites.filter((x) => x !== s);
  const www = wwwDir(cfg.root);
  const rel = s.path.slice(www.length + 1);
  if (samePath(join(www, rel), s.path) && rel && !rel.includes("\\") && !rel.includes("/") && !cfg.ignoredWww.includes(rel)) cfg.ignoredWww.push(rel);
}

/** The "Vazio" template. */
export function writeBlankSite(path: string, name: string): void {
  writeFileSync(
    join(path, "index.php"),
    `<?php\n// ${name} — criado pelo Vela\n?><!doctype html><meta charset="utf-8"><title>${name}</title>\n<h1>${name}</h1><p>PHP <?= PHP_VERSION ?> · <?= date('H:i:s') ?></p>\n`,
    "utf8",
  );
}

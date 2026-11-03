/** Adminer (single-file database UI), installed on demand as the "adminer" site. */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir, type Config, type SiteConfig } from "./config";
import { download } from "./download";

export const ADMINER_SITE = "adminer";

/** Download adminer.php once and register the site. Returns the site. */
export async function ensureAdminer(cfg: Config): Promise<SiteConfig> {
  const dir = dataDir(cfg.root, "adminer");
  const index = join(dir, "index.php");
  if (!existsSync(index)) {
    mkdirSync(dir, { recursive: true });
    await download("https://www.adminer.org/latest.php", index);
  }
  let site = cfg.sites.find((s) => s.name === ADMINER_SITE);
  if (!site) {
    site = { name: ADMINER_SITE, path: dir, docroot: "", https: false };
    cfg.sites.push(site);
  }
  return site;
}

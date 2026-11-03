import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST, type ServiceName } from "./manifest";
import { binDir, logsDir, tmpDir } from "./config";
import { fileExistsNonEmpty } from "./proc";
import { download, unzip } from "./download";

export interface InstallProgress {
  state: "idle" | "downloading" | "extracting" | "done" | "error";
  service: ServiceName;
  version: string;
  received: number;
  total: number;
  message?: string;
}

export const installState: Partial<Record<ServiceName, InstallProgress>> = {};

/** Expected executable that marks a completed install, per service. */
export function serviceExe(service: ServiceName, dir: string): string {
  switch (service) {
    case "nginx":
      return join(dir, "nginx.exe");
    case "php":
      return join(dir, "php-cgi.exe");
    case "mariadb":
      return join(dir, "bin", "mysqld.exe");
    case "redis":
      return join(dir, "redis-server.exe");
  }
}

/**
 * Some zips nest everything inside a single top folder (nginx-1.30.6/,
 * mariadb-11.8.9-winx64/ etc). After extracting, if `markerRel` is not there but
 * a single child directory holds it, hoist that child's contents up. Repeats as
 * long as there is exactly one child dir and no loose files (handles deeper nesting).
 */
function flattenSingleRoot(dest: string, markerRel: string): void {
  for (let pass = 0; pass < 5; pass++) {
    if (existsSync(join(dest, markerRel))) return;
    const children = readdirSync(dest, { withFileTypes: true });
    const dirs = children.filter((c) => c.isDirectory());
    const files = children.filter((c) => c.isFile());
    if (dirs.length !== 1 || files.length > 0) return;
    const first = dirs[0];
    if (!first) return;
    // Only hoist if the marker (or its first segment) is actually inside the child.
    const inner = join(dest, first.name);
    const markerHead = markerRel.split("/")[0] ?? "";
    if (!existsSync(join(inner, markerRel)) && !existsSync(join(inner, markerHead))) return;
    for (const entry of readdirSync(inner)) {
      renameSync(join(inner, entry), join(dest, entry));
    }
    rmSync(inner, { recursive: true, force: true });
  }
}

export function isInstalled(root: string, service: ServiceName, version: string): boolean {
  return fileExistsNonEmpty(serviceExe(service, binDir(root, service, version)));
}

export async function installVersion(
  root: string,
  service: ServiceName,
  version: string,
  onProgress?: (p: InstallProgress) => void,
): Promise<string> {
  const entry = MANIFEST[service].versions.find((v) => v.version === version);
  if (!entry) throw new Error(`Version ${version} of ${service} not found in the manifest`);
  const dir = binDir(root, service, version);

  const current = installState[service];
  if (current && (current.state === "downloading" || current.state === "extracting")) {
    throw new Error(`${service} ${current.version} is already being installed`);
  }

  const report = (p: Partial<InstallProgress>) => {
    const full: InstallProgress = {
      state: "idle",
      received: 0,
      total: 0,
      ...(installState[service]?.version === version ? installState[service] : {}),
      ...p,
      service,
      version,
    };
    installState[service] = full;
    onProgress?.(full);
  };

  if (isInstalled(root, service, version)) {
    report({ state: "done" });
    return dir;
  }

  // marker path relative to the service dir, forward-slash form: e.g. "bin/mysqld.exe"
  const marker = serviceExe(service, ".").replace(/^\.[\\/]/, "").replace(/\\/g, "/");
  mkdirSync(tmpDir(root), { recursive: true });
  mkdirSync(logsDir(root), { recursive: true });
  const zipPath = join(tmpDir(root), `${service}-${version}.zip`);

  try {
          report({ state: "downloading", received: 0, total: 0, message: undefined });
    await download(entry.url, zipPath, { onProgress: (received, total) => report({ received, total }), sha256: entry.sha256 });
    report({ state: "extracting", received: 1, total: 1 });
    rmSync(dir, { recursive: true, force: true });
    await unzip(zipPath, dir);
    flattenSingleRoot(dir, marker);
    if (!fileExistsNonEmpty(serviceExe(service, dir))) {
      // try one more hoist pass for deep nesting like nginx-1.30.6/nginx-1.30.6/
      flattenSingleRoot(dir, marker);
      flattenSingleRoot(dir, marker);
    }
    if (!fileExistsNonEmpty(serviceExe(service, dir))) {
      throw new Error(`Expected binary not found after extraction: ${serviceExe(service, dir)}`);
    }
    rmSync(zipPath, { force: true });
    report({ state: "done" });
    return dir;
  } catch (err) {
    report({ state: "error", message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export function installedVersions(root: string, service: ServiceName): string[] {
  const base = join(root, "bin", service);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isInstalled(root, service, d.name))
    .map((d) => d.name);
}

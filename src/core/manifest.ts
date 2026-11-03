export interface VersionEntry {
  version: string;
  url: string;
  notes?: string;
  /** Optional SHA-256 of the zip; downloads that don't match are rejected. */
  sha256?: string;
}

export interface ServiceManifest {
  latest: string;
  versions: VersionEntry[];
}

/**
 * Download manifest for the portable stacks.
 * Sources: docs/download-sources.md (nginx.org, windows.php.net releases.json,
 * archive.mariadb.org, redis-windows GitHub releases).
 */
export const MANIFEST: Record<"nginx" | "php" | "mariadb" | "redis", ServiceManifest> = {
  nginx: {
    latest: "1.30.6",
    versions: [
      { version: "1.31.8", url: "https://nginx.org/download/nginx-1.31.8.zip", notes: "mainline" },
      { version: "1.30.6", url: "https://nginx.org/download/nginx-1.30.6.zip", notes: "stable" },
      { version: "1.28.3", url: "https://nginx.org/download/nginx-1.28.3.zip" },
      { version: "1.26.3", url: "https://nginx.org/download/nginx-1.26.3.zip" },
      { version: "1.24.0", url: "https://nginx.org/download/nginx-1.24.0.zip" },
      { version: "1.22.1", url: "https://nginx.org/download/nginx-1.22.1.zip" },
    ],
  },
  php: {
    latest: "8.5.12",
    versions: [
      { version: "8.5.12", url: "https://windows.php.net/downloads/releases/php-8.5.12-1-nts-Win32-vs17-x64.zip", notes: "NTS x64 vs17" },
      { version: "8.4.27", url: "https://windows.php.net/downloads/releases/php-8.4.27-1-nts-Win32-vs17-x64.zip" },
      { version: "8.3.36", url: "https://windows.php.net/downloads/releases/php-8.3.36-1-nts-Win32-vs16-x64.zip" },
      { version: "8.2.35", url: "https://windows.php.net/downloads/releases/php-8.2.35-1-nts-Win32-vs16-x64.zip" },
      { version: "8.1.34", url: "https://windows.php.net/downloads/releases/php-8.1.34-nts-Win32-vs16-x64.zip", notes: "security-only" },
    ],
  },
  mariadb: {
    latest: "11.8.9",
    versions: [
      { version: "12.3.3", url: "https://archive.mariadb.org/mariadb-12.3.3/winx64-packages/mariadb-12.3.3-winx64.zip", notes: "rolling" },
      { version: "11.8.9", url: "https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip", notes: "LTS" },
      { version: "11.4.13", url: "https://archive.mariadb.org/mariadb-11.4.13/winx64-packages/mariadb-11.4.13-winx64.zip", notes: "LTS" },
      { version: "10.11.14", url: "https://archive.mariadb.org/mariadb-10.11.14/winx64-packages/mariadb-10.11.14-winx64.zip" },
      { version: "10.6.23", url: "https://archive.mariadb.org/mariadb-10.6.23/winx64-packages/mariadb-10.6.23-winx64.zip", notes: "legacy" },
    ],
  },
  redis: {
    latest: "8.10.3",
    versions: [
      { version: "8.10.3", url: "https://github.com/redis-windows/redis-windows/releases/download/8.10.3/Redis-8.10.3-Windows-x64-msys2.zip" },
      { version: "8.10.2", url: "https://github.com/redis-windows/redis-windows/releases/download/8.10.2/Redis-8.10.2-Windows-x64-msys2.zip" },
      { version: "8.8.3", url: "https://github.com/redis-windows/redis-windows/releases/download/8.8.3/Redis-8.8.3-Windows-x64-msys2.zip" },
      { version: "8.6.6", url: "https://github.com/redis-windows/redis-windows/releases/download/8.6.6/Redis-8.6.6-Windows-x64-msys2.zip" },
      { version: "5.0.14.1", url: "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip", notes: "legacy" },
    ],
  },
};

export type ServiceName = keyof typeof MANIFEST;

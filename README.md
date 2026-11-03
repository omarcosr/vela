# Vela — stack manager for Windows

A real alternative to [WNMP](https://github.com/x64architecture/wnmp): manages portable **Nginx + PHP (FastCGI) + MariaDB + Redis** on Windows, with **version selection** for each service and a **native** GUI built with [Tarve](https://tarve.dev) (TSX → Rust runtime, no WebView).

## Features

- **Services**: Nginx, PHP (php-cgi NTS, 4 FastCGI workers), MariaDB (portable datadir), and Redis — each with a start/stop button, live status (port listening), and status badge.
- **Version selection**: dropdown for each service with multiple official versions (nginx.org, windows.php.net, archive.mariadb.org, redis-windows). Switching to a version that isn't installed triggers a download with a progress bar, extraction, and installation to `~/Vela/bin/<serviço>/<versão>`.
- **Resilient downloads**: automatic retries with HTTP Range resumption if the connection drops.
- **Logs**: built-in viewer (access/error/run logs for each service), live updates, newest first, clear log.
- **Configuration**: stack root, ports for all services (with conflict checking), MariaDB credentials, start on launch, and stop on close; saved to `%LOCALAPPDATA%\Vela\config.json`.
- **Sites**: each project gets its own domain (`<nome>.localhost`, or `<nome>.test` via the hosts file), in any folder (or inside `www`, detected automatically). Public folder detected (`public/`), PHP version per site, HTTPS with Vela's local CA, MariaDB database per site, and Empty / Laravel (Composer) / WordPress templates. Actions: open, VS Code, terminal, folder, site logs.
- **Interaction**: shortcuts (`Ctrl+1…4`, `Ctrl+Enter`, `Ctrl+Shift+X`, `F5`, `Ctrl+L`, `Ctrl+F`, `F1`), confirmation before stopping everything or deleting the datadir, tray icon with per-service menu, alert (toast + Windows notification) when a service stops, with a Restart button.
- **Single instance**: launching a second instance focuses the running window.
- **Open at sign-in**: starts with Windows, minimized to the tray.
- **Database (Adminer)**: quick link that installs Adminer as the `adminer` site.
- **Clean shutdown**: `nginx -s quit`, `mysqladmin shutdown`, kill the process tree, and clean up orphans from previous sessions.
- **Screenshot**: `set VELA_CAPTURE=docs\shot.png&& set VELA_TAB=logs&& bun src/main.tsx` saves the screen and exits.
- **Portable layout**: no registry entries, no Windows service — everything in `~/Vela`:

```
~/Vela
├── bin\<servico>\<versao>\   # extracted binaries
├── data\mariadb\             # datadir
├── data\redis\
├── logs\
└── www\                      # sites root
```

## Requirements

- Windows 10/11 x64
- [Bun](https://bun.sh) 1.4+ (dev mode) — or `bun run build` to generate a single `.exe`
- Visual C++ Redistributable (VS16/VS17) for PHP

## Usage

```powershell
bun install
bun run start        # opens the GUI
```

1. **Services** tab → choose a version for each service → **Download & install** (first time only).
2. **Start all** starts MariaDB → Redis → PHP → Nginx in that order.
3. The **Logs** tab shows logs; **Settings** changes the root/ports.

Put your projects in `~/Vela/www` and visit `http://localhost/`.

## Smoke tests

```powershell
bun src/smoke-redis.ts    # installs Redis 5.0.14.1, starts on 6380, PONG via redis-cli, stops
bun src/smoke-web.ts      # installs Nginx 1.30.6 + PHP 8.4.27, GET http://127.0.0.1:8080/index.php → VELA-OK 8.4.27
bun src/smoke-mariadb.ts  # installs MariaDB 11.8.9, initializes datadir, SELECT VERSION(), stops
```

## Building the executable

```powershell
bun run build         # dist/Vela.exe (~68 MB: --trim, --trim-locales, --aot; see scripts/build.ts)
bun run icon          # regenerates assets/icon.png (icon for the .exe, window, and tray)
```

## Technical notes

- **Status** is checked via a real TCP connection to the service port (not just by PID).
- `nginx.conf` is generated to point to `~/Vela/www` and php-cgi on the configured port; `php.ini` is created from `php.ini-development` with `pdo_mysql`, `mysqli`, `mbstring`, `openssl`, `curl`, `gd`, `intl`, and `zip` enabled.
- MariaDB runs with `mysqld --defaults-file=my.ini --console`; the datadir is initialized with `mysql_install_db.exe` the first time.
- Redis uses the community build `redis-windows` (there is no official Windows build).
- Default ports: 80 (nginx), 9000 (php-cgi), 3306 (mariadb), 6379 (redis) — configurable in **Settings**.

## Documentation

- [`docs/tarve-api.md`](docs/tarve-api.md) — cheat sheet for the Tarve API used by the GUI
- [`docs/download-sources.md`](docs/download-sources.md) — official download sources and portable installation notes
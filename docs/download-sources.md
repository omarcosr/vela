# Download Sources — WNMP (Windows x64, portátil)

Manifest de URLs oficiais de download (ZIP/binário) para instalador de stack local estilo WNMP.
Levantado em 2026-11-03 via `nginx.org`, `downloads.php.net/~windows` (releases.json oficial do PHP for Windows), `archive.mariadb.org` e API de releases do GitHub.

> Verificação automática recomendada: as URLs abaixo seguem padrões estáveis confirmados nos índices/listagens citados; valide com HTTP HEAD antes do download.

---

## 1. Nginx for Windows — oficial (nginx.org)

Fonte: https://nginx.org/en/download.html
Padrão: `https://nginx.org/download/nginx-<ver>.zip` (mainline / stable / legacy, mesmo caminho). Cada zip tem `.zip.asc` (PGP).

| Versão | Branch | URL | Tipo |
|---|---|---|---|
| 1.31.8 | mainline | https://nginx.org/download/nginx-1.31.8.zip | zip |
| 1.30.6 | stable | https://nginx.org/download/nginx-1.30.6.zip | zip |
| 1.28.3 | legacy | https://nginx.org/download/nginx-1.28.3.zip | zip |
| 1.26.3 | legacy | https://nginx.org/download/nginx-1.26.3.zip | zip |
| 1.24.0 | legacy | https://nginx.org/download/nginx-1.24.0.zip | zip |
| 1.22.1 | legacy | https://nginx.org/download/nginx-1.22.1.zip | zip |

### Instalação portátil
- Extrair o zip; raiz contém `nginx.exe`, `conf/`, `logs/`, `html/`, `temp/`.
- Rodar do diretório raiz: `nginx.exe` (start), `nginx.exe -s stop` / `-s quit`, `nginx.exe -s reload`, `nginx.exe -t`.
- Não requer serviço nem instalador; paths relativos ao diretório do exe (use `-p C:\caminho` se rodar de outro CWD).
- Aviso oficial (docs Windows): funciona como servidor básico; performance/limitações menores vs Unix. Fonte: https://nginx.org/en/docs/windows.html

---

## 2. PHP for Windows — oficial (windows.php.net / downloads.php.net)

- Página de download: https://windows.php.net/download (redireciona para https://downloads.php.net/~windows/download/)
- **`releases.json` EXISTE e é a fonte programática correta**: https://windows.php.net/downloads/releases/releases.json
  (o host canônico redireciona para https://downloads.php.net/~windows/releases/releases.json — HTTP 200 confirmado).
- Estrutura: objeto por branch (`"8.4": { "version": "...", "nts-vs17-x64": { "zip": { "path", "size", "sha256" } } }`).
- URL final = `https://windows.php.net/downloads/releases/<path>` (o `path` vem do JSON; host espelho: `https://downloads.php.net/~windows/releases/<path>`).
- Padrão de nome confirmado: `php-<ver>-nts-Win32-vs16|vs17-x64.zip` (vs16 p/ 8.1–8.3, vs17 p/ 8.4+/8.5+). Nota: o sufixo hoje é `nts-Win32-vs16-x64` — NÃO `nts-Win32-vs16-x64-latest`; para "latest" por branch use o JSON.
- Valores abaixo extraídos diretamente do releases.json (com sha256):

| Versão | URL (base https://windows.php.net/downloads/releases/) | Tipo |
|---|---|---|
| 8.5.12-1 | php-8.5.12-1-nts-Win32-vs17-x64.zip | zip NTS x64 (vs17) |
| 8.4.27-1 | php-8.4.27-1-nts-Win32-vs17-x64.zip | zip NTS x64 (vs17) |
| 8.3.36-1 | php-8.3.36-1-nts-Win32-vs16-x64.zip | zip NTS x64 (vs16) |
| 8.2.35-1 | php-8.2.35-1-nts-Win32-vs16-x64.zip | zip NTS x64 (vs16) |
| 8.1.34 | php-8.1.34-nts-Win32-vs16-x64.zip | zip NTS x64 (vs16, security-only) |

- NTS = Non Thread Safe (correto para FastCGI/PHP-FPM style com Nginx). TS disponível no mesmo JSON se quiser Apache/modulo.
- 8.1 é security-only (EOL de suporte ativo); listar como "legado".

### Instalação portátil
- Extrair zip; `php.exe` na raiz. `php.ini`: copiar `php.ini-development` → `php.ini`.
- Para Nginx+FastCGI rodar: `php-cgi.exe -b 127.0.0.1:9000` (NTS) — via run_hidden/loop (php-cgi morre após N requests; usar wrapper tipo FastCGI process manager simples ou `php-cgi -b` com restart). Alternativa moderna: FrankenPHP/Caddy, fora do escopo.
- Extensões essenciais (descomentar `extension=` no php.ini, DLLs em `ext\`):
  - `ext/php_mysqli.dll` e/ou `php_pdo_mysql.dll` (MariaDB/MySQL via PDO)
  - `php_openssl.dll`, `php_mbstring.dll`, `php_curl.dll`, `php_fileinfo.dll`, `php_gd.dll` (conforme app)
- `extension_dir = "ext"` (caminho relativo funciona se php.ini no mesmo dir do php.exe).
- VS16 requer VC++ 2015–2019 redistribuível; VS17 requer VC++ 2015–2022 redist (o zip NÃO embute o runtime — incluir `vc_redist.x64.exe` no instalador: https://aka.ms/vs/17/release/vc_redist.x64.exe).

---

## 3. MariaDB for Windows — oficial (archive.mariadb.org)

- Índice geral: https://archive.mariadb.org/ (confirmado).
- Padrão: `https://archive.mariadb.org/mariadb-<ver>/winx64-packages/mariadb-<ver>-winx64.zip` — zip "b" (sem instalador), x64, com `.zip.asc` e `sha256sums.txt` no mesmo diretório. Confirmado por listagem dos diretórios `winx64-packages` (11.4.5, 11.8.9, 12.3.3).

| Versão | URL | Tipo |
|---|---|---|
| 12.3.3 | https://archive.mariadb.org/mariadb-12.3.3/winx64-packages/mariadb-12.3.3-winx64.zip | zip (~99MB) |
| 12.2.2 | https://archive.mariadb.org/mariadb-12.2.2/winx64-packages/mariadb-12.2.2-winx64.zip | zip |
| 11.8.9 (LTS) | https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip | zip (~93MB) |
| 11.4.13 (LTS) | https://archive.mariadb.org/mariadb-11.4.13/winx64-packages/mariadb-11.4.13-winx64.zip | zip |
| 11.4.5 | https://archive.mariadb.org/mariadb-11.4.5/winx64-packages/mariadb-11.4.5-winx64.zip | zip (~87MB, exemplo pedido) |

- Branches maintenance: 11.4 e 11.8 = LTS; 12.x/13.x = rolling/short. Para stack estável recomendar 11.8.9 ou 11.4.13.

### Instalação portátil (sem instalador)
- O zip winx64-packages contém a árvore completa: `bin\mysqld.exe`, `bin\mysql.exe`, `bin\mysql_install_db.exe` (e `mariadb-install-db.exe`), `bin\mysqladmin.exe`, `share\`, `support-files\` — roda 100% portátil (o instalador MSI apenas registra serviço/registry; nada disso é necessário). Fonte do conteúdo/uso: documentação oficial https://mariadb.com/kb/en/installing-mariadb-windows-zip-packages/ (que descreve exatamente esse fluxo zip + mysql_install_db).
- Inicialização:
  1. `bin\mysql_install_db.exe --datadir=C:\wnmp\mariadb\data --password=root --service=` (sem registrar serviço; `--service=` vazio ou omitir a flag `--service` evita instalação de serviço Windows)
  2. `bin\mysqld.exe --defaults-file=C:\wnmp\mariadb\my.ini --datadir=C:\wnmp\mariadb\data --console` (foreground; matar pelo processo/pai)
- `my.ini` mínimo: `[mysqld] port=3306, basedir=C:\wnmp\mariadb, datadir=C:\wnmp\mariadb\data, character-set-server=utf8mb4`.
- Cliente: `bin\mysql.exe -u root -p -h 127.0.0.1`.

---

## 4. Redis para Windows — comparação de fontes

| Fonte | Estado | Última versão | Veredito |
|---|---|---|---|
| `tporadowski/redis` | Abandonado (última release 2022) | 5.0.14.1 | Só para legado |
| `microsoftarchive/redis` | Abandonado (2016/2018) | 3.2.100 | Evitar |
| **`redis-windows/redis-windows`** | **Ativo — CI GitHub Actions contínuo** | **8.10.3 (27/out/2026)** | **Recomendado** |

- Fonte recomendada: https://github.com/redis-windows/redis-windows/releases — builds 7.x, 8.x e recentes Redis 8.x compilados por CI a partir do código oficial do Redis, com SHA256 publicados na release.
- Padrão: `https://github.com/redis-windows/redis-windows/releases/download/<tag>/Redis-<tag>-Windows-x64-msys2.zip` (variantes: `msys2`, `cygwin`, `*-with-Service`).

| Versão | URL | Tipo |
|---|---|---|
| 8.10.3 | https://github.com/redis-windows/redis-windows/releases/download/8.10.3/Redis-8.10.3-Windows-x64-msys2.zip | zip x64 (msys2), sha256 AF16DF…C447F |
| 8.10.2 | https://github.com/redis-windows/redis-windows/releases/download/8.10.2/Redis-8.10.2-Windows-x64-msys2.zip | zip x64, sha256 7C8CEB…0EE85 |
| 8.8.3 | https://github.com/redis-windows/redis-windows/releases/download/8.8.3/Redis-8.8.3-Windows-x64-msys2.zip | zip x64 |
| 8.8.2 | https://github.com/redis-windows/redis-windows/releases/download/8.8.2/Redis-8.8.2-Windows-x64-msys2.zip | zip x64, sha256 7E7946…0CB453 |
| 8.6.6 | https://github.com/redis-windows/redis-windows/releases/download/8.6.6/Redis-8.6.6-Windows-x64-msys2.zip | zip x64, sha256 A38005…94DC8B |

- Sim, existem builds 7.x no mesmo repositório (tags 7.4.x/7.2.x nos releases antigos do repo; hoje a série ativa é 8.x).
- Legado (fallback): tporadowski 5.0.14.1 zip: https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip (12.6MB) e MSI: `Redis-x64-5.0.14.1.msi`.
- Observação: não há Redis "oficial" para Windows (Microsoft descontinuou o port em 3.2.100; redis.io não publica binários Windows). O repo redis-windows é a comunidade de fato mantida (workflow-run por release, hashes publicados).

### Instalação portátil
- Extrair; binários `redis-server.exe`, `redis-cli.exe` na raiz.
- Rodar: `redis-server.exe --port 6379 --dir C:\wnmp\redis --dbfilename dump.rdb` (ou com `redis.conf` próprio: `redis-server.exe redis.conf`).
- Variante `-with-Service` inclui helper para registrar como serviço Windows — desnecessário em modo portátil.

---

## Manifest JSON proposto

```json
{
  "generated": "2026-11-03",
  "platform": "win-x64",
  "nginx": {
    "source": "https://nginx.org/en/download.html",
    "url_pattern": "https://nginx.org/download/nginx-{version}.zip",
    "releases": [
      { "version": "1.31.8", "branch": "mainline", "type": "zip", "url": "https://nginx.org/download/nginx-1.31.8.zip", "notes": "Mainline atual; zip com .zip.asc (PGP)" },
      { "version": "1.30.6", "branch": "stable", "type": "zip", "url": "https://nginx.org/download/nginx-1.30.6.zip", "notes": "Stable recomendada" },
      { "version": "1.28.3", "branch": "legacy", "type": "zip", "url": "https://nginx.org/download/nginx-1.28.3.zip", "notes": "" },
      { "version": "1.26.3", "branch": "legacy", "type": "zip", "url": "https://nginx.org/download/nginx-1.26.3.zip", "notes": "" },
      { "version": "1.24.0", "branch": "legacy", "type": "zip", "url": "https://nginx.org/download/nginx-1.24.0.zip", "notes": "" },
      { "version": "1.22.1", "branch": "legacy", "type": "zip", "url": "https://nginx.org/download/nginx-1.22.1.zip", "notes": "" }
    ],
    "portable": { "binary": "nginx.exe", "start": "nginx.exe (no dir raiz)", "stop": "nginx.exe -s quit" }
  },
  "php": {
    "source": "https://windows.php.net/download",
    "releases_json": "https://windows.php.net/downloads/releases/releases.json",
    "base_url": "https://windows.php.net/downloads/releases/",
    "sapi": "nts",
    "releases": [
      { "version": "8.5.12-1", "type": "zip", "url": "https://windows.php.net/downloads/releases/php-8.5.12-1-nts-Win32-vs17-x64.zip", "notes": "vs17; sha256 no releases.json" },
      { "version": "8.4.27-1", "type": "zip", "url": "https://windows.php.net/downloads/releases/php-8.4.27-1-nts-Win32-vs17-x64.zip", "notes": "vs17" },
      { "version": "8.3.36-1", "type": "zip", "url": "https://windows.php.net/downloads/releases/php-8.3.36-1-nts-Win32-vs16-x64.zip", "notes": "vs16" },
      { "version": "8.2.35-1", "type": "zip", "url": "https://windows.php.net/downloads/releases/php-8.2.35-1-nts-Win32-vs16-x64.zip", "notes": "vs16" },
      { "version": "8.1.34", "type": "zip", "url": "https://windows.php.net/downloads/releases/php-8.1.34-nts-Win32-vs16-x64.zip", "notes": "security-only" }
    ],
    "portable": {
      "binary": "php-cgi.exe -b 127.0.0.1:9000",
      "extensions": ["php_pdo_mysql.dll", "php_mysqli.dll", "php_openssl.dll", "php_mbstring.dll", "php_curl.dll", "php_fileinfo.dll"],
      "ini": "copiar php.ini-development -> php.ini; extension_dir=ext",
      "runtime_dep": "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    }
  },
  "mariadb": {
    "source": "https://archive.mariadb.org/",
    "url_pattern": "https://archive.mariadb.org/mariadb-{version}/winx64-packages/mariadb-{version}-winx64.zip",
    "releases": [
      { "version": "12.3.3", "type": "zip", "url": "https://archive.mariadb.org/mariadb-12.3.3/winx64-packages/mariadb-12.3.3-winx64.zip", "notes": "rolling; ~99MB; sha256sums.txt no dir" },
      { "version": "12.2.2", "type": "zip", "url": "https://archive.mariadb.org/mariadb-12.2.2/winx64-packages/mariadb-12.2.2-winx64.zip", "notes": "" },
      { "version": "11.8.9", "type": "zip", "url": "https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip", "notes": "LTS; recomendado" },
      { "version": "11.4.13", "type": "zip", "url": "https://archive.mariadb.org/mariadb-11.4.13/winx64-packages/mariadb-11.4.13-winx64.zip", "notes": "LTS" },
      { "version": "11.4.5", "type": "zip", "url": "https://archive.mariadb.org/mariadb-11.4.5/winx64-packages/mariadb-11.4.5-winx64.zip", "notes": "~87MB" }
    ],
    "portable": {
      "init": "bin\\mysql_install_db.exe --datadir=<data> --password=<pwd>",
      "start": "bin\\mysqld.exe --defaults-file=<my.ini> --datadir=<data> --console",
      "client": "bin\\mysql.exe -u root -p",
      "contains": ["mysqld.exe", "mysql_install_db.exe", "mysql.exe"],
      "doc": "https://mariadb.com/kb/en/installing-mariadb-windows-zip-packages/"
    }
  },
  "redis": {
    "source": "https://github.com/redis-windows/redis-windows/releases",
    "recommended": "redis-windows (ativo, CI com hashes); tporadowski abandonado (5.0.14.1, 2022)",
    "releases": [
      { "version": "8.10.3", "type": "zip", "url": "https://github.com/redis-windows/redis-windows/releases/download/8.10.3/Redis-8.10.3-Windows-x64-msys2.zip", "notes": "sha256 AF16DF340525B431E9EC8DABFD625D5E7A233F82805B5418819904EA909C447F" },
      { "version": "8.10.2", "type": "zip", "url": "https://github.com/redis-windows/redis-windows/releases/download/8.10.2/Redis-8.10.2-Windows-x64-msys2.zip", "notes": "" },
      { "version": "8.8.3", "type": "zip", "url": "https://github.com/redis-windows/redis-windows/releases/download/8.8.3/Redis-8.8.3-Windows-x64-msys2.zip", "notes": "" },
      { "version": "8.8.2", "type": "zip", "url": "https://github.com/redis-windows/redis-windows/releases/download/8.8.2/Redis-8.8.2-Windows-x64-msys2.zip", "notes": "" },
      { "version": "8.6.6", "type": "zip", "url": "https://github.com/redis-windows/redis-windows/releases/download/8.6.6/Redis-8.6.6-Windows-x64-msys2.zip", "notes": "" },
      { "version": "5.0.14.1", "type": "zip", "url": "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip", "notes": "legado, apenas fallback" }
    ],
    "portable": { "binary": "redis-server.exe", "start": "redis-server.exe --port 6379 --dir <dir>", "client": "redis-cli.exe" }
  }
}
```

---

## Fontes citadas

- Nginx: https://nginx.org/en/download.html · https://nginx.org/en/docs/windows.html
- PHP: https://windows.php.net/download · https://windows.php.net/downloads/releases/releases.json (→ https://downloads.php.net/~windows/releases/releases.json)
- MariaDB: https://archive.mariadb.org/ · https://archive.mariadb.org/mariadb-11.4.5/winx64-packages/ · https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/ · https://archive.mariadb.org/mariadb-12.3.3/winx64-packages/ · https://mariadb.com/kb/en/installing-mariadb-windows-zip-packages/
- Redis: https://api.github.com/repos/redis-windows/redis-windows/releases · https://api.github.com/repos/tporadowski/redis/releases · https://github.com/redis-windows/redis-windows/releases · https://github.com/tporadowski/redis/releases

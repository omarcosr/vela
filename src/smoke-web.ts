/** Smoke: nginx + php-cgi serving phpinfo on port 8080. */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig, wwwDir } from "./core/config";
import { installVersion } from "./core/installer";
import { startService, stopService } from "./core/services";

const cfg = loadConfig();
cfg.services.nginx.version = "1.30.6";
cfg.services.nginx.port = 8080;
cfg.services.php.version = "8.4.27";
cfg.services.php.port = 9100;

mkdirSync(wwwDir(cfg.root), { recursive: true });
writeFileSync(`${wwwDir(cfg.root)}/index.php`, "<?php echo 'VELA-OK ' . PHP_VERSION;");

for (const s of ["php", "nginx"] as const) {
  if (s === "php") console.log("Installing PHP 8.4.27 (~30MB)...");
  else console.log("Installing Nginx 1.30.6...");
  await installVersion(cfg.root, s, cfg.services[s].version);
  console.log(s, "Installed");
}

console.log("Starting PHP...");
console.log("php:", (await startService(cfg, "php")).status);
console.log("Starting Nginx...");
console.log("nginx:", (await startService(cfg, "nginx")).status);

await new Promise((r) => setTimeout(r, 1500));
const res = await fetch("http://127.0.0.1:8080/index.php");
const body = await res.text();
console.log("HTTP", res.status, "body:", body.slice(0, 120));

await stopService("nginx", cfg);
await stopService("php", cfg);
console.log("done");
process.exit(0);

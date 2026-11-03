/** Smoke: MariaDB install + init + start + query + stop on port 3307. */
import { loadConfig } from "./core/config";
import { installVersion } from "./core/installer";
import { startService, stopService } from "./core/services";
import { binDir } from "./core/config";
import { join } from "node:path";

const cfg = loadConfig();
cfg.services.mariadb.version = "11.8.9";
cfg.services.mariadb.port = 3307;

console.log("installing mariadb 11.8.9 (~90MB)...");
await installVersion(cfg.root, "mariadb", "11.8.9", (p) => {
  if (p.state === "downloading" && p.total > 0) {
    process.stdout.write(`\r  ${((p.received / p.total) * 100).toFixed(0)}%`);
  }
});
console.log("\ninstalled");

console.log("starting (init datadir the first time)...");
const st = await startService(cfg, "mariadb");
console.log("status:", st.status, st.message ?? "");

await new Promise((r) => setTimeout(r, 1500));
const dir = binDir(cfg.root, "mariadb", "11.8.9");
const q = Bun.spawnSync([
  join(dir, "bin", "mysql.exe"), "-u", cfg.mariadbUser, "-h", "127.0.0.1", "-P", "3307",
  "-e", "SELECT VERSION(); CREATE DATABASE IF NOT EXISTS vela_test; SHOW DATABASES;",
], { stdout: "pipe", stderr: "pipe", windowsHide: true, env: { ...process.env, MYSQL_PWD: cfg.mariadbPassword } });
console.log("stdout:", new TextDecoder().decode(q.stdout));
console.log("stderr:", new TextDecoder().decode(q.stderr).slice(0, 200));

await stopService("mariadb", cfg);
console.log("stopped");
process.exit(0);

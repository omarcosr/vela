/**
 * Smoke test: install Redis 5.0.14.1 (small zip), start it, check port, stop.
 * Run: bun src/smoke-redis.ts
 */
import { join } from "node:path";
import { binDir, loadConfig } from "./core/config";
import { installVersion, isInstalled } from "./core/installer";
import { startService, stopService, getStatusFor } from "./core/services";
import { portOpen } from "./core/proc";

const cfg = loadConfig();
cfg.services.redis.version = "5.0.14.1";
cfg.services.redis.port = 6380; // 6379 is taken by Docker Desktop on this machine
// in-memory only: smoke tests must not overwrite the user's config.json

console.log("Installing Redis 5.0.14.1...");
await installVersion(cfg.root, "redis", "5.0.14.1", (p) => {
  if (p.state === "downloading" && p.total > 0) {
    process.stdout.write(`\r  ${(p.received / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB`);
  }
});
console.log("\nInstalled:", isInstalled(cfg.root, "redis", "5.0.14.1"));

console.log("Starting...");
const st = await startService(cfg, "redis");
console.log("status:", st.status, st.message ?? "");

await new Promise((r) => setTimeout(r, 1500));
console.log("Port 6380 is open:", await portOpen(6380));

const pong = Bun.spawnSync([join(binDir(cfg.root, "redis", "5.0.14.1"), "redis-cli.exe"), "-p", "6380", "ping"], { stdout: "pipe", windowsHide: true });
console.log("redis-cli ping:", new TextDecoder().decode(pong.stdout).trim());

console.log("Stopping...");
await stopService("redis", cfg);
await new Promise((r) => setTimeout(r, 800));
const st2 = await getStatusFor(cfg, "redis");
console.log("Final status:", st2.status);
console.log("PORT CLOSED:", !(await portOpen(6380)));

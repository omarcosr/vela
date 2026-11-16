/** "Open at Windows sign-in": a value under HKCU\\…\\Run pointing at the packaged Vela.exe. */
import { exec, sysTool } from "./proc";

const KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const NAME = "Vela";

/** Only the packaged exe can be registered (in dev, execPath is bun.exe / node.exe / tjs.exe). */
export const canAutostart = () => !/[\\/](bun|node|tjs)(\.exe)?$/i.test(process.execPath);

export async function autostartEnabled(): Promise<boolean> {
  const r = await exec([sysTool("reg.exe"), "query", KEY, "/v", NAME], { timeoutMs: 5000 });
  return r.code === 0 && r.stdout.toLowerCase().includes(process.execPath.toLowerCase());
}

export async function setAutostart(on: boolean): Promise<void> {
  const args = on ? ["add", KEY, "/v", NAME, "/t", "REG_SZ", "/d", `"${process.execPath}" --minimized`, "/f"] : ["delete", KEY, "/v", NAME, "/f"];
  const r = await exec([sysTool("reg.exe"), ...args], { timeoutMs: 5000 });
  if (r.code !== 0 && on) throw new Error((r.stderr || r.stdout).trim() || "reg.exe failed");
}

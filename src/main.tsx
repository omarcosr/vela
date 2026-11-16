/**
 * Entry point. The UI is loaded dynamically so a startup failure can be reported: the packaged
 * exe has no console, and without this it would just never open.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { appendText, dlopen, wide } from "./core/runtime";

function reportFatal(err: unknown) {
  const text = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
  const log = join(process.env.LOCALAPPDATA ?? ".", "Vela", "crash.log");
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendText(log, `[${new Date().toISOString()}] ${text}\n\n`);
  } catch {
    /* nowhere to write */
  }
  try {
    const user32 = dlopen("user32.dll", { MessageBoxW: { args: ["ptr", "buffer", "buffer", "u32"], returns: "i32" } });
    const MB_ICONERROR = 0x10;
    user32.MessageBoxW(null, wide(`Vela couldn't open.\n\n${text.slice(0, 800)}\n\nDetails in ${log}`), wide("Vela"), MB_ICONERROR);
  } catch {
    console.error(text);
  }
}

try {
  const { appClosed, shutdown } = await import("./ui/app");
  await appClosed();
  await shutdown();
  process.exit(0);
} catch (err) {
  reportFatal(err);
  process.exit(1);
}

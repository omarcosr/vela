/**
 * Entry point. The UI is loaded dynamically so a startup failure can be reported: the packaged
 * exe has no console, and without this it would just never open.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { dlopen, FFIType, ptr } from "bun:ffi";

function reportFatal(err: unknown) {
  const text = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
  const log = join(process.env.LOCALAPPDATA ?? ".", "Vela", "crash.log");
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `[${new Date().toISOString()}] ${text}\n\n`);
  } catch {
    /* nowhere to write */
  }
  try {
    const user32 = dlopen("user32.dll", { MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 } });
    const w = (s: string) => Buffer.from(s + "\0", "utf16le");
    const MB_ICONERROR = 0x10;
    user32.symbols.MessageBoxW(null, ptr(w(`Vela couldn't open.\n\n${text.slice(0, 800)}\n\nDetails in ${log}`)), ptr(w("Vela")), MB_ICONERROR);
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

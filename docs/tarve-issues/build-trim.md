# `tarve build`: expose Bun's `--trim` (cuts ~56 MB off every Windows executable)

**Package:** `@tarve/core` 0.9.0 · Bun 1.4.4 · win32-x64

## Summary

`tarve build` (Bun runtime) calls `Bun.build({ compile: { … } })`, which embeds the whole Bun runtime: on Bun 1.4.4 that is ~150 MB, almost all of a Tarve `.exe`. Bun 1.4 has `--trim` / `compile.trim` ("Remove the Bun and Node.js APIs your code never calls"), which removes ~56 MB, but Tarve has no option to pass it through.

| Vela (real app: FFI, child_process, fs, Bun.spawn, Bun.connect, fetch) | Size |
|---|---|
| `tarve build` | 154.7 MB |
| same build with `compile.trim = true` | **96.0 MB** |

The trimmed executable runs normally: window/FFI, and a smoke test that downloads with curl, extracts with tar, spawns redis-server, checks the port with `Bun.connect` and stops it with taskkill.

## Repro

```ts
// bun build.ts
import { build } from "@tarve/core/build";
const original = Bun.build;
(Bun as any).build = (o: any) => { if (o.compile) o.compile.trim = true; return original(o); };
console.log(await build({ entrypoint: "src/main.tsx", outfile: "dist/App.exe" }));
```

## Proposal

- `tarve build --trim` / `BuildOptions.trim` (and `--trim-locales`), passed to `compile.trim` / `compile.trimLocales`. Maybe make it the default for Bun builds.
- Same for `tarve package` when it builds first.

## Related: `--native-features auto` false positive

`nativeFeaturesFor` turns on `net` when **any** `http(s)://` string literal appears in the source (`/["'`](https?:\/\/…)/`). An app that only *lists* download URLs (and uses Bun's `fetch`) gets the `media` native variant (17.8 MB) instead of `core` (13.2 MB). Detecting the native fetch/URL-loading APIs that need `net` (e.g. `<Image src="https://…">`, `<video src>`) instead of every URL string would avoid it. There is no clean CLI way to ask for "core only" either: `--native-features=` (empty) works by accident; `--native-features core` (or `none`) would be clearer.

## Update: `--aot` and `--trim-locales`

| Vela (`@tarve/core` 0.9.0, Bun 1.4.4, win32-x64) | Size |
|---|---|
| `tarve build` | 154.7 MB |
| + `compile.trim` | 96.0 MB |
| + `--trim-locales=pt-BR,en --aot` | **68.0 MB** |

`--aot` and `--trim-locales` are **CLI only** (`Bun.build({ compile: { aot: true } })` is silently ignored), so a Tarve option would have to bundle with `Bun.build` (keeping the native-library plugin) and then compile the bundle with `bun build --compile --aot …`. That is what Vela's `scripts/build.ts` does today, and the AOT executable runs the window, FFI (iphlpapi/kernel32/advapi32 via bun:ffi), child processes, fetch and zlib fine.

`--aot` prints warnings against Tarve's own bundle that may be worth a look:
- `TS100152: No such built-in module: node:ffi` (the Node FFI branch in the bridge)
- `TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable` for `globalThis[Symbol.for("tarve.forwardedLaunches")] ??= …`, `tarve.singleInstanceRelease` and `globalThis[Rs] = …` in createApp. In practice the app works, but storing that state in a module-level variable instead of on `globalThis` would avoid the warning (and any risk if Bun enforces it).

Proposal: `tarve build --aot` / `--trim-locales <list>` (or `BuildOptions.aot` / `trimLocales`).

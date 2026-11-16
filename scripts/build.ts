/**
 * `tarve build` plus Bun's size flags, which Tarve 0.9.0 can't pass through (docs/tarve-issues/build-trim.md):
 *   --trim          drop the Bun/Node APIs the app never calls
 *   --trim-locales  keep only pt-BR/en ICU data
 *   --aot           compile the JS ahead of time; the executable no longer carries the JIT tiers
 *
 * How: Tarve's own Bun.build call (with its native-library plugin) is redirected to write a plain
 * bundle; that bundle is then compiled with the Bun CLI, which has these flags.
 *
 *   bun scripts/build.ts [--outfile dist/Vela.exe] [--no-aot] [--runtime bun|node|txiki]
 *
 * --runtime node|txiki: a plain `tarve build` for that runtime (the Bun flags above don't apply).
 * The app runs the same on all three (src/core/runtime.ts).
 */
import { build } from "@tarve/core/build";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const aot = !args.includes("--no-aot");
const runtime = (flag("--runtime") ?? "bun") as "bun" | "node" | "txiki";
if (!["bun", "node", "txiki"].includes(runtime)) throw new Error(`--runtime: bun, node or txiki (got ${runtime})`);
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);

type BuildConfig = Parameters<typeof Bun.build>[0];
interface CompileOptions {
  target?: string;
  outfile: string;
  windows?: { hideConsole?: boolean; title?: string; version?: string; description?: string; publisher?: string; copyright?: string; icon?: string };
}

const original = Bun.build;
if (runtime === "bun") (Bun as { build: typeof Bun.build }).build = (async (options: BuildConfig) => {
  const { compile, ...rest } = options as BuildConfig & { compile?: CompileOptions };
  if (!compile) return original(options);
  const outdir = mkdtempSync(join(tmpdir(), "vela-bundle-"));
  try {
    const bundle = await original({ ...rest, outdir, naming: { entry: "app.js", asset: "[name]-[hash].[ext]" } });
    if (!bundle.success) return bundle;
    const entry = join(outdir, "app.js");
    // The plain bundle turns `import x from "./a.png" with { type: "file" }` into `var x = "./a-hash.png"`
    // plus an emitted file. Turn those back into file imports so the CLI compile embeds them
    // (otherwise the exe looks for B:/~BUN/root/a-hash.png and dies at startup).
    let code = await Bun.file(entry).text();
    const imports: string[] = [];
    for (const asset of readdirSync(outdir).filter((f) => f !== "app.js")) {
      const re = new RegExp(`var (\\w+)="\\./${escapeRe(asset)}";`, "g");
      code = code.replace(re, (_, name: string) => {
        imports.push(`import ${name} from "./${asset}" with { type: "file" };`);
        return "";
      });
    }
    await Bun.write(entry, imports.join("\n") + "\n" + code);
    const w = compile.windows ?? {};
    const cli = [
      process.execPath, "build", "--compile", entry, "--outfile", compile.outfile,
      "--trim-locales=pt-BR,en",
      ...(aot ? ["--aot"] : []),
      "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
      ...(compile.target ? [`--target=${compile.target}`] : []),
      ...(w.hideConsole ? ["--windows-hide-console"] : []),
      ...(w.title ? [`--windows-title=${w.title}`] : []),
      ...(w.version ? [`--windows-version=${w.version}`] : []),
      ...(w.description ? [`--windows-description=${w.description}`] : []),
      ...(w.publisher ? [`--windows-publisher=${w.publisher}`] : []),
      ...(w.copyright ? [`--windows-copyright=${w.copyright}`] : []),
      ...(w.icon ? [`--windows-icon=${w.icon}`] : []),
    ];
    const p = Bun.spawn(cli, { stdout: "inherit", stderr: "inherit" });
    if ((await p.exited) !== 0) throw new Error("bun build --compile falhou");
    return { ...bundle, outputs: [] };
  } finally {
    if (!process.env.VELA_KEEP_BUNDLE) rmSync(outdir, { recursive: true, force: true });
    else console.log("bundle kept:", outdir);
  }
}) as typeof Bun.build;

const outfile = await build({
  entrypoint: "src/main.tsx",
  outfile: flag("--outfile") ?? (runtime === "bun" ? "dist/Vela.exe" : `dist/Vela-${runtime}.exe`),
  runtime,
  // URLs in src/core/manifest.ts make "auto" pick the larger "net/media" native variant; fetch is Bun's.
  nativeFeatures: [],
});
console.log(`${outfile}  ${(Bun.file(outfile).size / 1048576).toFixed(1)} MB`);

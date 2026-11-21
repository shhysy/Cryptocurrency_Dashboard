import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const output = resolve(root, ".trader", "trader.mjs");
await mkdir(resolve(root, ".trader"), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "scripts", "trader.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  alias: { "@": root },
  sourcemap: "inline",
  logLevel: "info",
});

const child = spawn(process.execPath, [output], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  });
}

const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) resolveExit(1);
    else resolveExit(code ?? 1);
  });
});
process.exitCode = Number(exitCode);

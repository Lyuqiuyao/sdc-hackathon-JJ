import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "receivables-workflow-"));
try {
  await build({ entryPoints: ["tests/workflow.test.ts", "tests/gemini.test.ts"],
    outdir: dir, outExtension: {".js":".mjs"}, bundle: true, platform: "node", format: "esm",
    banner: {js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"} });
  const result = spawnSync(process.execPath, ["--test", join(dir,"workflow.test.mjs"), join(dir,"gemini.test.mjs")], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

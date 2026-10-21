import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "receivables-workflow-"));
try {
  const outfile = join(dir, "workflow.test.mjs");
  await build({ entryPoints: ["tests/workflow.test.ts"], outfile, bundle: true, platform: "node", format: "esm" });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

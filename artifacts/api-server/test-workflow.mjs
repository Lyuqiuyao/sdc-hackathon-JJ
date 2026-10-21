import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "receivables-workflow-"));
try {
  await build({ entryPoints: ["tests/workflow.test.ts", "tests/gemini.test.ts", "tests/openai-safety.test.ts",
    "tests/managed-openai.test.ts", "tests/managed-startup.ts"],
    outdir: dir, outExtension: {".js":".mjs"}, bundle: true, platform: "node", format: "esm",
    banner: {js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"} });
  const result = spawnSync(process.execPath, ["--import", new URL("./tests/no-network.mjs", import.meta.url).href,
    "--test", join(dir,"workflow.test.mjs"), join(dir,"gemini.test.mjs"), join(dir,"openai-safety.test.mjs"),
    join(dir,"managed-openai.test.mjs")], {
    stdio: "inherit", env: { ...process.env,
      AI_INTEGRATIONS_OPENAI_BASE_URL: "https://managed-openai.synthetic.invalid/proxy/v1",
      AI_INTEGRATIONS_OPENAI_API_KEY: "synthetic-managed-credential-not-real",
      OPENAI_API_KEY: "synthetic-private-key-must-never-be-used",
      GEMINI_API_KEY: "synthetic-legacy-key-not-real" },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}

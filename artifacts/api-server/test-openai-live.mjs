import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// A separate, explicit opt-in is required. Never part of simulated tests/builds.
if (!process.argv.includes("--allow-managed-live")) {
  console.log(JSON.stringify({result:"NOT_RUN",reason:"Real managed model calls require separate authorization and --allow-managed-live."}));
  process.exit(2);
}
const dir=await mkdtemp(join(tmpdir(),"openai-live-"));
try {
  const file=join(dir,"live.mjs");
  await build({entryPoints:["tests/managed-openai-live.ts"],outfile:file,bundle:true,platform:"node",format:"esm",
    banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
  process.exitCode=spawnSync(process.execPath,[file,"--allow-managed-live"],{stdio:"inherit"}).status??1;
} finally { await rm(dir,{recursive:true,force:true}); }

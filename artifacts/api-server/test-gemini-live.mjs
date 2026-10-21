import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
console.log(JSON.stringify({result:"NOT_RUN",reason:"Gemini retired. Use pnpm --filter @workspace/api-server run test:openai-live."}));
process.exit(2);
const dir=await mkdtemp(join(tmpdir(),"gemini-live-"));
try {
  const file=join(dir,"live.mjs");
  await build({entryPoints:["tests/gemini-live.ts"],outfile:file,bundle:true,platform:"node",format:"esm",
    banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
  process.exitCode=spawnSync(process.execPath,[file],{stdio:"inherit"}).status??1;
} finally { await rm(dir,{recursive:true,force:true}); }

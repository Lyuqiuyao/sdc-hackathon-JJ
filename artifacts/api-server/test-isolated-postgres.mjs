import { build } from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Never reads the workspace database URL. A fresh cluster, private Unix socket,
// no TCP listener, no Web app and no model request. Removed in finally.
const dir=await mkdtemp(join(tmpdir(),"sdc-ai-isolated-"));
const data=join(dir,"data"),socket=join(dir,"socket");
const systemEnv={PATH:process.env.PATH,HOME:process.env.HOME,USER:process.env.USER,LANG:"C"};
try {
  await mkdir(socket,{mode:0o700});
  execFileSync("initdb",["-D",data,"-U","sdc_test","-A","trust","--no-locale","-E","UTF8"],{env:systemEnv,stdio:"ignore",timeout:30000});
  execFileSync("pg_ctl",["-D",data,"-l",join(dir,"postgres.log"),"-o",
    `-F -c listen_addresses='' -c unix_socket_permissions=0700 -k ${socket} -p 55439`,"-w","start"],
    {env:systemEnv,stdio:"ignore",timeout:30000});
  await build({entryPoints:["tests/isolated-postgres.test.ts","tests/coordination-process-worker.ts"],
    outdir:dir,outExtension:{".js":".mjs"},bundle:true,platform:"node",format:"esm",
    banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
  const guard=new URL("./tests/no-network.mjs",import.meta.url).href;
  const result=spawnSync(process.execPath,["--import",guard,"--test",join(dir,"isolated-postgres.test.mjs")],{
    stdio:"inherit",timeout:90000,env:{...systemEnv,
      DATABASE_URL:`postgresql://sdc_test@localhost/postgres?host=${encodeURIComponent(socket)}&port=55439`,
      SDC_ISOLATED_DB:"temporary-unix-socket-only",SDC_ISOLATED_SOCKET_DIR:socket,SDC_NETWORK_GUARD:guard,
      AI_INTEGRATIONS_OPENAI_BASE_URL:"https://managed-openai.synthetic.invalid/proxy/v1",
      AI_INTEGRATIONS_OPENAI_API_KEY:"synthetic-managed-not-real",
      OPENAI_API_KEY:"synthetic-private-must-not-be-used",GEMINI_API_KEY:"synthetic-legacy-not-real",
    }});
  process.exitCode=result.status??1;
} catch {
  console.error("Isolated PostgreSQL harness failed; no shared database fallback was attempted.");
  process.exitCode=1;
} finally {
  if(existsSync(join(data,"postmaster.pid"))) {
    try {execFileSync("pg_ctl",["-D",data,"-m","immediate","-w","stop"],{env:systemEnv,stdio:"ignore",timeout:15000});}
    catch {console.error("Temporary cluster stop failed; inspect only the isolated temporary directory.");}
  }
  await rm(dir,{recursive:true,force:true});
}

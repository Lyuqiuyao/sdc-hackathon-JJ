import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { pool, db, demoWorkspaces } from "@workspace/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createWorkspaceRepository } from "../src/lib/receivables/repository";
import { createPlanEnricher } from "../src/lib/receivables/ai-enrichment";
import { generate } from "../src/lib/receivables/service";
import { claimGeneration } from "../src/lib/receivables/ai-coordination";
import { syntheticAdvice } from "./synthetic-advice";

// The harness replaces the database URL in the CHILD ONLY and creates this
// private Unix socket. No fallback to the workspace's database is permitted.
assert.equal(process.env.SDC_ISOLATED_DB,"temporary-unix-socket-only");
const socket=process.env.SDC_ISOLATED_SOCKET_DIR!;
assert.ok(socket.startsWith("/tmp/sdc-ai-isolated-"));
assert.ok(process.env.DATABASE_URL!.includes(encodeURIComponent(socket)));
const check=await pool.query("select current_setting('unix_socket_directories') as sockets");
assert.equal(check.rows[0].sockets,socket);
await pool.query("create table demo_workspaces (id text primary key, payload jsonb not null, updated_at timestamptz not null default now())");
const SecondaryPool=pool.constructor as new (options:object)=>typeof pool;
const secondPool=new SecondaryPool({connectionString:process.env.DATABASE_URL});
const secondDb=drizzle(secondPool,{schema:{demoWorkspaces}});
test.after(async()=>{await secondPool.end();await pool.end();});

test("two OS processes: one actual synthetic Transport call under PostgreSQL row locking",{timeout:20000},async()=>{
  const repo=createWorkspaceRepository(db,"isolated-processes");
  const plan=await repo.changeState(s=>{s.settings.aiMode="openai";return generate(s,{});});
  const workers:ChildProcess[]=[];
  try {
    const launch=()=>{
      const child=fork(new URL("./coordination-process-worker.mjs",import.meta.url),[],{
        stdio:["ignore","ignore","ignore","ipc"],
        execArgv:["--import",process.env.SDC_NETWORK_GUARD!],env:process.env,
      });
      workers.push(child);
      return child;
    };
    const a=launch(),b=launch();
    let transports=0,finished=0;
    const complete=new Promise<void>((resolve,reject)=>{
      let ready=0;
      for(const child of [a,b]) {
        child.on("error",()=>reject(Error("Worker startup failed")));
        child.on("message",(m:{type:string})=>{
          if(m.type==="ready"&&++ready===2) {
            a.send({type:"run",planId:plan.id,workspaceId:repo.workspaceId});
            b.send({type:"run",planId:plan.id,workspaceId:repo.workspaceId});
          }
          if(m.type==="transport")transports++;
          if(m.type==="failed")reject(Error("Worker failed"));
          if(m.type==="done") {
            finished++;
            if(finished===1)for(const other of [a,b])if(other!==child&&other.connected)other.send({type:"release"});
            if(finished===2)resolve();
          }
        });
      }
    });
    await complete;
    assert.equal(transports,1);
    const state=await repo.readState();
    assert.equal(state.plans.find(p=>p.id===plan.id)!.providerMode,"openai");
    assert.equal(state.adviceSnapshots!.filter(s=>s.status==="applied").length,1);
  } finally {for(const child of workers)if(child.exitCode===null)child.kill();}
});
test("separate database connections recover an expired abandoned lease with database time",async()=>{
  const a=createWorkspaceRepository(db,"isolated-recovery");
  const b=createWorkspaceRepository(secondDb,"isolated-recovery");
  const plan=await a.changeState(s=>{s.settings.aiMode="openai";return generate(s,{});});
  await a.changeState((s,time)=>claimGeneration(s,s.plans.find(p=>p.id===plan.id)!,a.workspaceId,time!-61000,60000));
  let calls=0;
  const result=await createPlanEnricher(b,(s,p)=>syntheticAdvice(s,p,async()=>{calls++;}))(plan.id);
  assert.equal(calls,1);assert.equal(result.providerMode,"openai");
  const current=await a.readState();
  assert.ok(current.adviceSnapshots!.some(s=>s.status==="expired"));
  assert.equal(Object.values(current.aiLeases!)[0]!.status,"succeeded");
});
test("PostgreSQL rolls back snapshot alteration, deletion and throwing transactions",async()=>{
  const repo=createWorkspaceRepository(db,"isolated-immutability");
  await repo.changeState(s=>generate(s,{}));
  const before=await repo.readState();
  await assert.rejects(repo.changeState(s=>{s.adviceSnapshots![0]!.reasonCode="tampered";}),/append-only/);
  await assert.rejects(repo.changeState(s=>{s.adviceSnapshots=[];}),/append-only/);
  await assert.rejects(repo.changeState(s=>{s.settings.cashCents++;throw Error("Synthetic rollback");}),/Synthetic rollback/);
  assert.deepEqual(await repo.readState(),before);
});
test("database PK and workspace association protect separate coordination aggregates",async()=>{
  const rows=await db.select().from(demoWorkspaces).where(eq(demoWorkspaces.id,"isolated-processes"));
  assert.equal(rows.length,1);
  assert.notEqual((await db.select().from(demoWorkspaces)).length,0);
  const repo=createWorkspaceRepository(secondDb,"isolated-association");
  await assert.rejects(repo.changeState(s=>{s.workspaceId="wrong-workspace";}),/association mismatch/);
  assert.notEqual((await repo.readState()).workspaceId,"wrong-workspace");
});

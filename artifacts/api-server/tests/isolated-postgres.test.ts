import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { pool, db, demoWorkspaces } from "@workspace/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createWorkspaceRepository } from "../src/lib/receivables/repository";
import { createPlanEnricher } from "../src/lib/receivables/ai-enrichment";
import { generate } from "../src/lib/receivables/service";
import { claimGeneration } from "../src/lib/receivables/ai-coordination";
import { syntheticAdvice } from "./synthetic-advice";
import { appendPlanSnapshot } from "../src/lib/receivables/advice-snapshots";
import { seedState } from "../src/lib/receivables/seed";

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
  await repo.changeState(s=>{
    const plan=generate(s,{});
    appendPlanSnapshot(s,plan,{status:"fallback",reasonCode:"rules_draft",provider:"rules_fallback"});
  });
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
test("isolated Express GET contract exposes snapshots and safe missing-plan responses; no business writes",async()=>{
  const repo=createWorkspaceRepository(db);
  const plan=await repo.changeState(s=>{
    s.settings.aiMode="rules";
    const p=generate(s,{});
    appendPlanSnapshot(s,p,{status:"fallback",reasonCode:"rules_selected",provider:"rules_fallback"});
    return p;
  });
  const before=await repo.readState();
  const app=(await import("../src/app")).default;
  const server=createServer(app);
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();
  assert.ok(address&&typeof address!=="string");
  const get=(path:string)=>new Promise<{status:number;body:string}>((resolve,reject)=>{
    const req=request({hostname:"127.0.0.1",port:address.port,method:"GET",path},res=>{
      let body="";res.setEncoding("utf8");res.on("data",chunk=>{body+=chunk;});
      res.on("end",()=>resolve({status:res.statusCode!,body}));
    });req.on("error",reject);req.end();
  });
  try {
    const snapshots=await get(`/api/plans/${plan.id}/advice-snapshots`);
    assert.equal(snapshots.status,200);
    const rows=JSON.parse(snapshots.body);
    assert.ok(rows.some((s:any)=>s.planId===plan.id&&s.rawResponseRetained===false));
    assert.equal((await get("/api/plans/missing-synthetic-plan/advice-snapshots")).status,404);
    assert.equal((await get("/api/workspace")).status,200);
    assert.equal((await get("/api/certifier")).status,404);
    assert.deepEqual(await repo.readState(),before);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("isolated real API round-trip: profile, SEDG, reviews, merge, approval and simulated Email; no financial mutation",async()=>{
  const repo=createWorkspaceRepository(db);
  const initial=seedState();
  await db.update(demoWorkspaces).set({payload:initial}).where(eq(demoWorkspaces.id,repo.workspaceId));
  const app=(await import("../src/app")).default,server=createServer(app);
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const call=(method:string,path:string,data?:object)=>new Promise<{status:number;body:any}>((resolve,reject)=>{
    const body=data===undefined?"":JSON.stringify(data);
    const req=request({hostname:"127.0.0.1",port:address.port,method,path,
      headers:body?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}:{}},res=>{
      let text="";res.setEncoding("utf8");res.on("data",chunk=>{text+=chunk;});
      res.on("end",()=>resolve({status:res.statusCode!,body:JSON.parse(text)}));
    });req.on("error",reject);req.end(body);
  });
  const taskEdits=(p:any)=>p.tasks.map(({id,method,noticeEn,noticeMs}:any)=>({id,method,noticeEn,noticeMs}));
  try {
    const customer=initial.customers[2]!;
    const profile={industry:customer.industry,paymentHistory:customer.paymentHistory,profileSummary:"Synthetic API contract fixture.",
      existingEsgRating:"unknown",expectedVersion:0,syntheticConfirmed:true};
    assert.equal((await call("PUT",`/api/customers/${customer.id}/profile`,{...profile,syntheticConfirmed:false})).status,400);
    const saved=await call("PUT",`/api/customers/${customer.id}/profile`,profile);
    assert.equal(saved.status,200);assert.equal(saved.body.profileVersion,1);
    assert.equal((await call("PUT",`/api/customers/${customer.id}/profile`,profile)).status,409);
    const declaration=await call("POST",`/api/customers/${customer.id}/sedg`,{
      environmental:"Synthetic environment",social:"Synthetic social",governance:"Synthetic governance",
      sourceReference:"Synthetic API test",syntheticConfirmed:true});
    assert.equal(declaration.status,200);assert.equal(declaration.body.status,"Submitted - unverified");
    let response=await call("POST","/api/plans",{});
    assert.equal(response.status,200);
    let p=response.body;assert.equal(p.scoringSnapshot.version,"split_v2");
    assert.equal((await call("POST",`/api/plans/${p.id}/decision`,{decision:"approve",notes:"Synthetic test"})).status,409);
    for(const customerId of new Set<string>(p.tasks.filter((t:any)=>t.queue==="two_dimensional").map((t:any)=>t.customerId))) {
      const prior=p;
      response=await call("PATCH",`/api/plans/${p.id}`,{tasks:taskEdits(p),notes:"",expectedVersion:p.version,
        customerReview:{customerId,decision:"collect_now",reason:"Synthetic reviewed collection decision"}});
      assert.equal(response.status,200,JSON.stringify(response.body));p=response.body;
      assert.notEqual(prior.id,p.id);assert.ok(p.version>prior.version);
      assert.equal((await call("PATCH",`/api/plans/${prior.id}`,{tasks:taskEdits(prior),notes:"Stale tab edit"})).status,409);
    }
    response=await call("PATCH",`/api/plans/${p.id}`,{tasks:taskEdits(p).reverse(),notes:"",expectedVersion:p.version,
      mergeReason:"Synthetic human-reviewed final queue merge"});
    assert.equal(response.status,200,JSON.stringify(response.body));p=response.body;
    assert.equal((await call("POST",`/api/plans/${p.id}/decision`,{decision:"approve",notes:"Exact synthetic version approved"})).status,200);
    assert.equal((await call("POST",`/api/plans/${p.id}/execute`)).status,200);
    assert.equal((await call("POST",`/api/plans/${p.id}/execute`)).status,200);
    const final=await call("GET","/api/workspace");
    assert.equal(final.body.executions.length,p.tasks.length);
    assert.ok(final.body.executions.every((e:any)=>e.channel==="Simulated Email"&&e.recipient.endsWith("@example.invalid")&&e.noticeEn&&e.noticeMs&&e.planVersion===p.version));
    const persisted=await repo.readState();
    assert.deepEqual(persisted.invoices,initial.invoices);assert.deepEqual(persisted.documents,initial.documents);
    assert.equal(persisted.settings.cashCents,initial.settings.cashCents);
    const history=await call("GET",`/api/plans/${p.id}/advice-snapshots`);
    assert.equal(history.status,200);assert.ok(history.body.some((s:any)=>s.status==="approved"));
    assert.ok(history.body.every((s:any)=>s.rawResponseRetained===false));
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

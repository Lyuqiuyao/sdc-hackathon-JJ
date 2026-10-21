import { build } from "esbuild";
import { writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { resolve } from "node:path";

const dir = resolve("../receivables-admin/public/__generated_checks__");
const html = resolve(dir, "mvp.html");
const js = resolve(dir, "mvp.js");
if (process.argv.includes("--clean")) {
  for (const folder of [dir,resolve("../receivables-admin/dist/public/__generated_checks__")]) {
    for (const name of ["mvp.html","mvp.js"])
      await unlink(resolve(folder,name)).catch(e => { if (e.code !== "ENOENT") throw e; });
    await rmdir(folder).catch(e => { if (e.code !== "ENOENT") throw e; });
  }
} else {
  const result = await build({
    entryPoints: ["tests/mvp-browser-fixture.ts"], bundle: true, write: false,
    platform: "browser", format: "esm", define: { "process.env": "{}" },
    external: ["@workspace/integrations-openai-ai-server"],
    plugins: [{ name: "test-only-crypto", setup(b) {
      b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: "crypto", namespace: "offline-test" }));
      b.onLoad({ filter: /.*/, namespace: "offline-test" }, () => ({ contents: `
        export const randomUUID=()=>globalThis.crypto.randomUUID();
        export function createHash(){let text="";return {update(value){text+=value;return this;},
          digest(){let h=14695981039346656037n;for(const c of text)h=BigInt.asUintN(64,(h^BigInt(c.codePointAt(0)))*1099511628211n);return h.toString(16).padStart(64,"0");}};}
      ` }));
    } }],
  });
  await mkdir(dir, {recursive:true});
  await writeFile(js, result.outputFiles[0].text, { flag: "wx" });
  try {
    await writeFile(html, `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated synthetic MVP test</title></head><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
window.__SDC_OFFLINE_FIXTURE__=true;
await import('/__generated_checks__/mvp.js');
const screen=new URLSearchParams(location.search).get('screen')||'/customers?customer=CUS-003';
history.replaceState(null,'',screen);
await import('/src/main.tsx');
</script></body></html>`, { flag: "wx" });
  } catch (error) { await unlink(js); throw error; }
  console.log("Isolated browser fixture generated. All API fetches are in-browser synthetic handlers; no database or model client is configured. Remove with node test-mvp-preview.mjs --clean.");
}

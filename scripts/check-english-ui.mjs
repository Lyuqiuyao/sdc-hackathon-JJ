import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const roots = [
  "artifacts/receivables-admin/src", "artifacts/receivables-admin/public",
  "artifacts/api-server/src/lib/receivables", "artifacts/api-server/src/routes",
  "artifacts/api-server/tests",
];
const extensions = /\.(?:[cm]?[jt]sx?|json|html|ya?ml)$/;
const han = /\p{Script=Han}/u;
let scanned = 0;
const failures = [];
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory() && entry.name !== "__generated_checks__") await scan(child);
    else if (extensions.test(entry.name)) {
      scanned++;
      const lines = (await readFile(child, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        // The user explicitly requested these two localized SMTP mode labels.
        const text = relative(root, child) === "artifacts/receivables-admin/src/pages/approvals.tsx"
          ? line.replaceAll("【当前：真实发送模式】", "").replaceAll("【当前：模拟模式】", "") : line;
        if (han.test(text)) failures.push(`${relative(root, child)}:${index + 1}`);
      });
    }
  }
}
for (const path of roots) await scan(join(root, path));
for (const path of ["artifacts/receivables-admin/index.html", "lib/api-spec/openapi.yaml"]) {
  scanned++;
  if (han.test(await readFile(join(root, path), "utf8"))) failures.push(path);
}
console.log(`English UI source check: ${scanned} files; ${failures.length} Han-containing locations.`);
console.log("Scope: administrator source/public text, business/routes, tests/fixtures, HTML and OpenAPI. Excludes uploads, historical reports, memory, dependencies, generated/build output and database content. Malay Latin text is allowed. Escaped negative-test codepoints are technical test data, not rendered UI.");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}

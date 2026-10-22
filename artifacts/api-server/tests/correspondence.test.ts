import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { appendCorrespondence, listCorrespondence, MAX_CORRESPONDENCE_BYTES } from "../src/lib/receivables/correspondence";
import { signature } from "../src/lib/receivables/compute";
import { reset } from "../src/lib/receivables/service";

test("paste, TXT and CSV retain original text, server attribution and one audit per upload", () => {
  const state = seedState(), companyId = state.customers[0]!.id;
  const before = structuredClone(state), originalSignature = signature(state);
  for (const fileType of ["text", "txt", "csv"] as const) {
    const rawText = '  Synthetic WhatsApp export\r\n"hello",<script>not executable</script>\n  ';
    const record = appendCorrespondence(state, companyId, { fileType, filename: fileType === "text" ? "Pasted text" : `SYNTHETIC.${fileType}`, rawText });
    assert.equal(record.rawText, rawText);
    assert.equal(record.companyId, companyId);
    assert.equal(record.uploadedBy, "Demo Admin");
    assert.ok(Number.isFinite(Date.parse(record.uploadedAt)));
    assert.equal(state.auditLogs.at(-1)!.related, companyId);
    assert.ok(state.auditLogs.at(-1)!.after.includes(record.id));
    assert.ok(!JSON.stringify(state.auditLogs.at(-1)).includes(rawText));
  }
  assert.equal(state.auditLogs.length, before.auditLogs.length + 3);
  assert.equal(new Set(state.correspondenceRecords!.map(r => r.id)).size, 3);
  assert.equal(listCorrespondence(state, companyId).length, 3);
  assert.deepEqual(listCorrespondence(state, state.customers[1]!.id), []);
  const { correspondenceRecords: _records, auditLogs: _logs, ...rest } = state;
  const { auditLogs: _oldLogs, ...baseline } = before;
  assert.deepEqual(rest, baseline);
  assert.equal(signature(state), originalSignature, "Uploading must not invalidate or rescore existing plans");
});

test("invalid input never appends records or audits", () => {
  const state = seedState(), before = structuredClone(state), id = state.customers[0]!.id;
  const valid = { fileType: "txt", filename: "SYNTHETIC.txt", rawText: "Synthetic content" };
  for (const body of [
    { ...valid, rawText: " \r\n\t" }, { ...valid, rawText: "" }, { ...valid, rawText: 42 },
    { ...valid, fileType: "exe" }, { ...valid, filename: "file.csv" },
    { ...valid, filename: "../file.txt" }, { ...valid, rawText: "bad\0text" },
    { ...valid, uploadedBy: "Spoofed identity" }, { ...valid, uploadedAt: "2000-01-01" },
    { ...valid, filename: "x".repeat(256) },
  ]) assert.throws(() => appendCorrespondence(state, id, body));
  assert.throws(() => appendCorrespondence(state, "missing-company", valid), /Company not found/);
  assert.throws(() => listCorrespondence(state, "missing-company"), /Company not found/);
  assert.deepEqual(state, before);
});

test("10 MiB is accepted exactly; byte overflow and multibyte overflow are rejected", () => {
  const state = seedState(), id = state.customers[0]!.id;
  const base = { fileType: "text", filename: "Pasted text" };
  appendCorrespondence(state, id, { ...base, rawText: "s".repeat(MAX_CORRESPONDENCE_BYTES) });
  assert.throws(() => appendCorrespondence(state, id, { ...base, rawText: "s".repeat(MAX_CORRESPONDENCE_BYTES + 1) }));
  assert.throws(() => appendCorrespondence(state, id, { ...base, rawText: "\u4e2d".repeat(Math.floor(MAX_CORRESPONDENCE_BYTES / 3) + 1) }), /10 MB/);
  assert.equal(state.correspondenceRecords!.length, 1);
});

test("old states without correspondence work; demo reset retains uploaded history", () => {
  const state = seedState(), id = state.customers[0]!.id;
  assert.deepEqual(listCorrespondence(state, id), []);
  const row = appendCorrespondence(state, id, { fileType: "csv", filename: "SYNTHETIC.csv", rawText: "source,message\r\nSynthetic,Hello" });
  reset(state, true);
  assert.deepEqual(listCorrespondence(state, id), [row]);
  assert.ok(state.auditLogs.some(log => log.type === "Correspondence upload" && log.after.includes(row.id)));
});

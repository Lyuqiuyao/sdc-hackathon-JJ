import { randomUUID } from "node:crypto";
import { UploadCompanyCorrespondenceBody, UploadCompanyCorrespondenceResponse } from "@workspace/api-zod";
import type { CorrespondenceRecord } from "./repository";
import { changeState, readState } from "./repository";
import { BusinessError, now, type DemoState } from "./model";
import { audit } from "./service";

export const MAX_CORRESPONDENCE_BYTES = 10 * 1024 * 1024;
export const MAX_COMPANY_CORRESPONDENCE = 5;

function assertCompany(state: DemoState, companyId: string) {
  if (!state.customers.some(customer => customer.id === companyId))
    throw new BusinessError("Company not found.", 404);
}

export function listCorrespondence(state: DemoState, companyId: string): CorrespondenceRecord[] {
  assertCompany(state, companyId);
  return (state.correspondenceRecords ?? []).filter(record => record.companyId === companyId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

function retainNewestCorrespondence(state: DemoState, companyId: string) {
  const ordered = (state.correspondenceRecords ?? []).filter(record => record.companyId === companyId)
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const removed = ordered.slice(0, Math.max(0, ordered.length - MAX_COMPANY_CORRESPONDENCE));
  if (!removed.length) return;
  const ids = new Set(removed.map(record => record.id));
  state.correspondenceRecords = state.correspondenceRecords!.filter(record => !ids.has(record.id));
  audit(state, "Correspondence retention", "Removed oldest correspondence records and their raw text to retain at most five records for this company. Existing analysis, portrait and audit history was retained.",
    companyId, JSON.stringify([...ids]), "", undefined, { result: "Success" });
}

// Old workspaces exceeding the cap are pruned on their next list/detail read.
async function retainedRecords(companyId: string) {
  const state = await readState();
  const records = listCorrespondence(state, companyId);
  if (records.length <= MAX_COMPANY_CORRESPONDENCE) return records;
  return changeState(current => {
    assertCompany(current, companyId);
    retainNewestCorrespondence(current, companyId);
    return listCorrespondence(current, companyId);
  });
}

export async function correspondenceMetadata(companyId: string) {
  return (await retainedRecords(companyId)).map(({ rawText: _rawText, ...metadata }) => metadata);
}

export async function correspondenceDetail(companyId: string, recordId: string) {
  const record = (await retainedRecords(companyId)).find(record => record.id === recordId);
  if (!record) throw new BusinessError("Correspondence record not found. It may have been removed by the five-record retention limit.", 404);
  return record;
}

export async function recordUploadFailure(companyId: string, reason: string) {
  await changeState(state => audit(state, "Correspondence upload failed", reason, companyId, "", "", undefined, { result: "Failed" }));
}

export async function uploadCorrespondence(companyId: string, body: unknown) {
  const result = await changeState(state => {
    try {
      return { record: UploadCompanyCorrespondenceResponse.parse(appendCorrespondence(state, companyId, body)) } as const;
    } catch (error) {
      if (!(error instanceof BusinessError) && !(error instanceof Error && error.name === "ZodError")) throw error;
      const message = error instanceof BusinessError ? error.message : "Invalid correspondence format, fields or lengths.";
      audit(state, "Correspondence upload failed", message, companyId, "", "", undefined, { result: "Failed" });
      // Return the error so the failure audit commits before HTTP error handling.
      return { error: message, status: error instanceof BusinessError ? error.status : 400 } as const;
    }
  });
  if ("error" in result) throw new BusinessError(result.error!, result.status);
  return result.record;
}

export function appendCorrespondence(state: DemoState, companyId: string, body: unknown): CorrespondenceRecord {
  assertCompany(state, companyId);
  const rawText = body && typeof body === "object" ? (body as { rawText?: unknown }).rawText : undefined;
  if (typeof rawText === "string" && Buffer.byteLength(rawText, "utf8") > MAX_CORRESPONDENCE_BYTES)
    throw new BusinessError("Correspondence exceeds the 10 MB limit.", 413);
  const input = UploadCompanyCorrespondenceBody.strict().parse(body);
  if (!input.rawText.trim()) throw new BusinessError("Correspondence must not be empty.");
  if (Buffer.byteLength(input.rawText, "utf8") > MAX_CORRESPONDENCE_BYTES)
    throw new BusinessError("Correspondence exceeds the 10 MB limit.", 413);
  if (input.rawText.includes("\0")) throw new BusinessError("Only plain text content is supported.");
  if (!input.filename.trim() || /[/\\\u0000-\u001f]/.test(input.filename))
    throw new BusinessError("A valid filename is required.");
  if (input.fileType !== "text" && !input.filename.toLowerCase().endsWith(`.${input.fileType}`))
    throw new BusinessError("Only matching .txt or .csv files are supported.");
  const record: CorrespondenceRecord = {
    id: `COR-${randomUUID()}`, companyId, ...input,
    uploadedBy: "Demo Admin", uploadedAt: now(),
  };
  (state.correspondenceRecords ??= []).push(record);
  retainNewestCorrespondence(state, companyId);
  // Raw text and user-controlled filenames must not be copied to the audit log.
  audit(state, "Correspondence upload", "Saved raw correspondence without extraction, AI processing or changes to company profiles, scores or plans.",
    companyId, "", `${record.id}; type=${record.fileType}; bytes=${Buffer.byteLength(record.rawText, "utf8")}`, undefined, { result: "Success" });
  return record;
}

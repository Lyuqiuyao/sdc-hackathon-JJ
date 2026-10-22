import { randomUUID } from "node:crypto";
import { UploadCompanyCorrespondenceBody } from "@workspace/api-zod";
import type { CorrespondenceRecord } from "./repository";
import { BusinessError, now, type DemoState } from "./model";
import { audit } from "./service";

export const MAX_CORRESPONDENCE_BYTES = 10 * 1024 * 1024;

function assertCompany(state: DemoState, companyId: string) {
  if (!state.customers.some(customer => customer.id === companyId))
    throw new BusinessError("Company not found.", 404);
}

export function listCorrespondence(state: DemoState, companyId: string): CorrespondenceRecord[] {
  assertCompany(state, companyId);
  return (state.correspondenceRecords ?? []).filter(record => record.companyId === companyId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function appendCorrespondence(state: DemoState, companyId: string, body: unknown): CorrespondenceRecord {
  assertCompany(state, companyId);
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
  // Raw text and user-controlled filenames must not be copied to the audit log.
  audit(state, "Correspondence upload", "Saved raw correspondence without extraction, AI processing or changes to company profiles, scores or plans.",
    companyId, "", `${record.id}; type=${record.fileType}; bytes=${Buffer.byteLength(record.rawText, "utf8")}`);
  return record;
}

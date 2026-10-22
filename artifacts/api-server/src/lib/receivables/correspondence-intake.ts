import { randomUUID } from "node:crypto";
import { IdentifyCorrespondenceResponse, ArchiveCorrespondenceGroupBody, ArchiveCorrespondenceGroupResponse,
  type CorrespondenceIntake, type CorrespondenceInput } from "@workspace/api-zod";
import { BusinessError, type DemoState } from "./model";
import { changeState } from "./repository";
import { audit } from "./service";
import { appendCorrespondence, validateCorrespondenceInput } from "./correspondence";
import { identifyCorrespondenceCompanies } from "./ai-provider";
import { groupSourceText, rosterSignature, splitIntakeLines, textHash } from "./correspondence-routing";

export interface StoredCorrespondenceIntake {
  receipt: CorrespondenceIntake;
  filename: string;
  fileType: CorrespondenceInput["fileType"];
  rosterSignature: string;
  groupHashes: Record<string, string>;
  archived: Record<string, { recordId: string; companyId: string }>;
}
const roster = (state: DemoState) => state.customers.map(company => ({
  id: company.id, name: company.name, collectionEmail: company.collectionEmail,
}));
function failure(error: unknown) {
  return error instanceof BusinessError ? { error: error.message, status: error.status }
    : { error: "Invalid correspondence fields or assignment.", status: 400 };
}

export async function identifyCorrespondence(body: unknown) {
  const id = `INTAKE-${randomUUID()}`;
  const claim = await changeState(state => {
    try {
      const input = validateCorrespondenceInput(body);
      const lines = splitIntakeLines(input.rawText);
      const companies = roster(state);
      audit(state, "Correspondence identification started", "Requested company identification and lossless source-line grouping. No company records have been created.",
        id, "", JSON.stringify({ lineCount: lines.length, bytes: Buffer.byteLength(input.rawText, "utf8") }), undefined, { result: "Pending" });
      return { input, lines, companies } as const;
    } catch (error) {
      audit(state, "Correspondence identification rejected", "Invalid or oversized source document; no content was archived.", id, "", "", undefined, { result: "Rejected" });
      return failure(error);
    }
  });
  if ("error" in claim) throw new BusinessError(claim.error, claim.status);
  try {
    const identified = await identifyCorrespondenceCompanies(claim.lines, claim.companies);
    const result = await changeState((state, databaseNowMs) => {
      if (rosterSignature(roster(state)) !== rosterSignature(claim.companies)) {
        audit(state, "Correspondence identification discarded", "Company roster changed during identification. Identify the source again.", id, "", "", undefined, { result: "Rejected" });
        return { error: "Company roster changed. Identify the source again.", status: 409 } as const;
      }
      const receipt = IdentifyCorrespondenceResponse.parse({
        id, createdAt: new Date(databaseNowMs!).toISOString(),
        expiresAt: new Date(databaseNowMs! + 60 * 60 * 1000).toISOString(), ...identified,
      });
      const stored = state.correspondenceIntakes ??= {};
      stored[id] = {
        receipt, filename: claim.input.filename, fileType: claim.input.fileType,
        rosterSignature: rosterSignature(claim.companies),
        groupHashes: Object.fromEntries(receipt.groups.map(group => [group.id, textHash(groupSourceText(claim.lines, group.spans))])),
        archived: {},
      };
      const ordered = Object.values(stored).filter(entry => entry.receipt.id !== id)
        .sort((a, b) => b.receipt.createdAt.localeCompare(a.receipt.createdAt));
      const removed = ordered.filter((entry, index) =>
        index >= 19 || Date.parse(entry.receipt.expiresAt) <= databaseNowMs!);
      for (const entry of removed) delete stored[entry.receipt.id];
      if (removed.length) audit(state, "Correspondence identification retention", "Removed expired or oldest identification receipts. No archived correspondence, analysis or portrait was removed.",
        id, "", JSON.stringify({ removed: removed.map(entry => entry.receipt.id) }), undefined, { result: "Success" });
      if (identified.provider !== "openai") audit(state, "Correspondence identification AI fallback",
        "AI identification was not completed. Conservative source-identifier rules were used; uncertain sections require manual confirmation.",
        id, "", identified.reasonCode, undefined,
        { result: ["missing_managed_config", "identification_context_limit"].includes(identified.reasonCode) ? "Rejected" : "Failed" });
      audit(state, "Correspondence identification completed", "Identified source-line groups. Explicit matches may be archived; suggestions and conflicts are not automatic assignments.",
        id, "", JSON.stringify({ provider: receipt.provider, reasonCode: receipt.reasonCode,
          groups: receipt.groups.map(group => ({ id: group.id, companyId: group.companyId, resolution: group.resolution })) }), undefined, { result: "Success" });
      return { receipt } as const;
    });
    if ("error" in result) throw new BusinessError(result.error!, result.status);
    return result.receipt;
  } catch (error) {
    await changeState(state => audit(state, "Correspondence identification failed",
      "No identification result was applied and no company correspondence was archived.", id, "", "", undefined,
      { result: error instanceof BusinessError ? "Rejected" : "Failed" }));
    if (error instanceof BusinessError) throw error;
    throw new BusinessError("Company identification could not complete. Retry without changing company records.", 503);
  }
}

export function archiveIntakeGroup(state: DemoState, id: string, body: unknown, databaseNowMs: number) {
  const input = ArchiveCorrespondenceGroupBody.strict().parse(body);
  const stored = state.correspondenceIntakes?.[id];
  const group = stored?.receipt.groups.find(row => row.id === input.groupId);
  if (!stored || !group) throw new BusinessError("Identification receipt not found. Identify the source again.", 404);
  if (stored.groupHashes[group.id] !== textHash(input.rawText)) throw new BusinessError("Source text differs from the identified group. Identify the edited source again.", 409);
  const archived = stored.archived[group.id];
  if (archived) {
    if (archived.companyId !== input.companyId) throw new BusinessError("This group is already assigned to another company.", 409);
    const record = state.correspondenceRecords?.find(row => row.id === archived.recordId && row.companyId === archived.companyId);
    if (!record) throw new BusinessError("This group was already archived, but its original record was removed by retention. It will not be uploaded again.", 409);
    audit(state, "Correspondence archive reused", "Idempotent retry returned the already archived record without duplicating it.",
      archived.companyId, "", JSON.stringify({ intakeId: id, groupId: group.id, recordId: record.id }), undefined, { result: "Success" });
    const { rawText: _raw, ...metadata } = record;
    return ArchiveCorrespondenceGroupResponse.parse(metadata);
  }
  if (Date.parse(stored.receipt.expiresAt) <= databaseNowMs) throw new BusinessError("Identification expired. Identify the source again.", 409);
  if (stored.rosterSignature !== rosterSignature(roster(state))) throw new BusinessError("Company roster changed. Identify the source again.", 409);
  if (group.resolution === "conflicting") throw new BusinessError("This section contains conflicting company identifiers. Split the source and identify it again.", 409);
  if (group.resolution === "matched" && group.companyId !== input.companyId)
    throw new BusinessError("The selected company differs from the verified source match.", 409);
  if (group.resolution !== "matched" && !input.manualConfirmed)
    throw new BusinessError("An uncertain company suggestion requires explicit manual confirmation.", 409);
  const record = appendCorrespondence(state, input.companyId,
    { filename: stored.filename, fileType: stored.fileType, rawText: input.rawText });
  stored.archived[group.id] = { recordId: record.id, companyId: record.companyId };
  audit(state, "Correspondence company assignment", input.manualConfirmed
    ? "Administrator explicitly confirmed the company for an unresolved source section."
    : "Automatically archived an explicit source-company match.",
    record.companyId, "", JSON.stringify({ intakeId: id, groupId: group.id, recordId: record.id,
      identificationProvider: stored.receipt.provider, manualConfirmed: input.manualConfirmed }), undefined, { result: "Success" });
  const { rawText: _raw, ...metadata } = record;
  return ArchiveCorrespondenceGroupResponse.parse(metadata);
}

export async function archiveCorrespondenceGroup(id: string, body: unknown) {
  const result = await changeState((state, databaseNowMs) => {
    try { return { record: archiveIntakeGroup(state, id, body, databaseNowMs!) } as const; }
    catch (error) {
      if (!(error instanceof BusinessError) && !(error instanceof Error && error.name === "ZodError")) throw error;
      const rejected = failure(error);
      audit(state, "Correspondence assignment rejected", rejected.error, id, "", "", undefined, { result: "Rejected" });
      return rejected;
    }
  });
  if ("error" in result) throw new BusinessError(result.error, result.status);
  return result.record;
}

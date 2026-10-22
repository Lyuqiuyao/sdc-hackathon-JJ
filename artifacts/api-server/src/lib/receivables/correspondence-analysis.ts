import { createHash, randomUUID } from "node:crypto";
import { AnalyzeCompanyCorrespondenceResponse } from "@workspace/api-zod";
import { changeState } from "./repository";
import { BusinessError, now } from "./model";
import { audit } from "./service";
import { analyzeCorrespondenceText } from "./ai-provider";

export interface CorrespondenceAnalysisJob {
  attemptId: string;
  expiresAtMs: number;
}
const sourceHash = (text: string) => createHash("sha256").update(text).digest("hex");

export async function analyzeCompanyRecord(companyId: string, recordId: string) {
  const attemptId = `NLP-${randomUUID()}`, key = `${companyId}:${recordId}`;
  const claim = await changeState((state, databaseNowMs) => {
    const record = state.correspondenceRecords?.find(row => row.companyId === companyId && row.id === recordId);
    const companyExists = state.customers.some(company => company.id === companyId);
    const previous = state.correspondenceAnalysisJobs?.[key];
    const time = databaseNowMs!;
    const error = !companyExists || !record ? "Company or linked correspondence record not found."
      : previous && previous.expiresAtMs > time ? "This correspondence record is already being analyzed." : undefined;
    if (error) {
      audit(state, "Correspondence NLP rejected", error, key, "", attemptId, undefined, { result: "Rejected" });
      return { error, status: companyExists && record ? 409 : 404 } as const;
    }
    if (previous) audit(state, "Correspondence NLP expired", "Previous analysis lease expired; any late result will be discarded.", key, previous.attemptId, attemptId, undefined, { result: "Rejected" });
    (state.correspondenceAnalysisJobs ??= {})[key] = { attemptId, expiresAtMs: time + 90_000 };
    audit(state, "Correspondence NLP started", "Communication extraction requested. Uploaded text is unverified data, not instructions. This extraction does not change profile, financial facts or planner values.",
      key, "", attemptId, undefined, { result: "Pending" });
    return { record: structuredClone(record!), hash: sourceHash(record!.rawText) } as const;
  });
  if ("error" in claim) throw new BusinessError(claim.error!, claim.status);
  try {
    // Network access and regex extraction take place outside the repository lock.
    const extracted = await analyzeCorrespondenceText(claim.record.rawText);
    const result = await changeState((state, databaseNowMs) => {
      const job = state.correspondenceAnalysisJobs?.[key];
      const record = state.correspondenceRecords?.find(row => row.companyId === companyId && row.id === recordId);
      if (job?.attemptId !== attemptId || job.expiresAtMs <= databaseNowMs! ||
        !record || sourceHash(record.rawText) !== claim.hash || !state.customers.some(company => company.id === companyId)) {
        audit(state, "Correspondence NLP discarded", "Source association changed or analysis lease expired; result was not applied.", key, "", attemptId, undefined, { result: "Rejected" });
        if (job?.attemptId === attemptId) delete state.correspondenceAnalysisJobs![key];
        return { error: "Analysis expired or source changed. Retry the analysis manually." } as const;
      }
      const analysis = AnalyzeCompanyCorrespondenceResponse.parse({
        id: attemptId, companyId, recordId, filename: record.filename,
        extractedAt: now(), actor: "Demo Admin", sourceHash: claim.hash,
        ...extracted, ...(extracted.provider === "openai" ? { connectionMode: "replit_managed" } : {}),
      });
      // Separate company-keyed communication history: never mutate signed customer
      // data, invoices, profile text, scoring inputs or plan snapshots.
      ((state.companyCorrespondenceAnalyses ??= {})[companyId] ??= []).push(analysis);
      delete state.correspondenceAnalysisJobs![key];
      audit(state, "Correspondence NLP completed", "Saved unverified communication extraction only. No company profile, financial record, score or plan was changed.",
        key, "", JSON.stringify({ analysisId: analysis.id, provider: analysis.provider, reasonCode: analysis.reasonCode,
          model: analysis.model, sourceHash: analysis.sourceHash,
          followUpCount: analysis.fields.followUpItems.length, promiseCount: analysis.fields.customerPromises.length,
          disputeCount: analysis.fields.disputes.length }), undefined, { result: "Success" });
      return { analysis } as const;
    });
    if ("error" in result) throw new BusinessError(result.error!, 409);
    return result.analysis;
  } catch (error) {
    await changeState(state => {
      if (state.correspondenceAnalysisJobs?.[key]?.attemptId === attemptId) delete state.correspondenceAnalysisJobs[key];
      audit(state, "Correspondence NLP failed", "Analysis could not be applied. No raw model response was retained; no profile, financial facts or plans were changed.", key, "", attemptId, undefined,
        { result: error instanceof BusinessError ? "Rejected" : "Failed" });
    });
    if (error instanceof BusinessError) throw error;
    throw new BusinessError("Correspondence analysis could not be saved. Please retry manually.", 503);
  }
}

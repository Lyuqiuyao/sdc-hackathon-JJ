import { randomUUID } from "node:crypto";
import { GenerateCompanyPortraitResponse } from "@workspace/api-zod";
import { changeState } from "./repository";
import { BusinessError, now } from "./model";
import { audit } from "./service";
import { companyPortraitFacts } from "./company-portrait-facts";
import { generateCompanyPortraitContent } from "./ai-provider";

export interface CompanyPortraitJob { attemptId: string; expiresAtMs: number }

export async function generatePortrait(companyId: string) {
  const attemptId = `POR-${randomUUID()}`;
  const claim = await changeState((state, databaseNowMs) => {
    const previous = state.companyPortraitJobs?.[companyId];
    const exists = state.customers.some(row => row.id === companyId);
    const error = !exists ? "Company not found." : previous && previous.expiresAtMs > databaseNowMs!
      ? "A company portrait is already being generated." : undefined;
    if (error) {
      audit(state, "Company portrait rejected", error, companyId, "", attemptId, undefined, { result: "Rejected" });
      return { error, status: exists ? 409 : 404 } as const;
    }
    if (previous) audit(state, "Company portrait expired", "Previous generation lease expired; late results will be discarded.", companyId, previous.attemptId, attemptId, undefined, { result: "Rejected" });
    const facts = companyPortraitFacts(state, companyId);
    (state.companyPortraitJobs ??= {})[companyId] = { attemptId, expiresAtMs: databaseNowMs! + 90_000 };
    audit(state, "Company portrait started", "Requested an advisory portrait from structured invoices and prior unverified NLP results. No scoring or planner inputs will change.",
      companyId, "", JSON.stringify({ attemptId, inputSignature: facts.inputSignature, sourceAnalysisIds: facts.sourceAnalysisIds }), undefined, { result: "Pending" });
    return { facts } as const;
  });
  if ("error" in claim) throw new BusinessError(claim.error!, claim.status);
  try {
    // External model I/O stays outside the database row lock.
    const content = await generateCompanyPortraitContent(claim.facts);
    const result = await changeState((state, databaseNowMs) => {
      const job = state.companyPortraitJobs?.[companyId];
      const current = state.customers.some(row => row.id === companyId) ? companyPortraitFacts(state, companyId) : undefined;
      if (job?.attemptId !== attemptId || job.expiresAtMs <= databaseNowMs! || current?.inputSignature !== claim.facts.inputSignature) {
        audit(state, "Company portrait discarded", "Generation expired or source data changed; portrait was not applied.", companyId, "", attemptId, undefined, { result: "Rejected" });
        if (job?.attemptId === attemptId) delete state.companyPortraitJobs![companyId];
        return { error: "Portrait sources changed or generation expired. Generate again manually." } as const;
      }
      const portrait = GenerateCompanyPortraitResponse.parse({
        id: attemptId, companyId, generatedAt: now(), actor: "Demo Admin",
        ...content, ...(content.provider === "openai" ? { connectionMode: "replit_managed" } : {}),
        contentPolicy: "controlled_facts", inputSignature: claim.facts.inputSignature,
        sourceAnalysisIds: claim.facts.sourceAnalysisIds, isStale: false,
      });
      ((state.companyPortraits ??= {})[companyId] ??= []).push(portrait);
      delete state.companyPortraitJobs![companyId];
      audit(state, "Company portrait completed", "Saved advisory portrait with controlled facts. No customer profile text, financial data, scoring, planning or approval was changed.",
        companyId, "", JSON.stringify({ portraitId: portrait.id, provider: portrait.provider, model: portrait.model,
          reasonCode: portrait.reasonCode, inputSignature: portrait.inputSignature, riskTagCodes: portrait.riskTags.map(tag => tag.code) }), undefined, { result: "Success" });
      return { portrait } as const;
    });
    if ("error" in result) throw new BusinessError(result.error!, 409);
    return result.portrait;
  } catch (error) {
    await changeState(state => {
      if (state.companyPortraitJobs?.[companyId]?.attemptId === attemptId) delete state.companyPortraitJobs[companyId];
      audit(state, "Company portrait failed", "Portrait could not be saved. No raw model response was retained; existing business data was not changed.", companyId, "", attemptId, undefined,
        { result: error instanceof BusinessError ? "Rejected" : "Failed" });
    });
    if (error instanceof BusinessError) throw error;
    throw new BusinessError("Company portrait could not be saved. Please retry manually.", 503);
  }
}

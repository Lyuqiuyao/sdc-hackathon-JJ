import { randomUUID } from "node:crypto";
import type { CompanyProfileInput, SedgInput, SedgSubmission } from "@workspace/api-zod";
import { type DemoState, BusinessError, now } from "./model";
import { assertEnglishInput } from "./language";
import { audit } from "./service";
import { validMailbox } from "./email-recipients";
import { changeState } from "./repository";

export async function auditedCompanyChange<T>(customerId: string, operation: string, apply: (state: DemoState) => T): Promise<T> {
  const result = await changeState(state => {
    try { return { value: apply(state) } as const; }
    catch (error) {
      if (!(error instanceof BusinessError) && !(error instanceof Error && error.name === "ZodError")) throw error;
      const message = error instanceof BusinessError ? error.message : "Invalid structured company fields, email or self-assessment values.";
      const status = error instanceof BusinessError ? error.status : 400;
      audit(state, `${operation} rejected`, message, customerId, "", "", undefined,
        { result: status < 500 ? "Rejected" : "Failed" });
      return { error: message, status } as const;
    }
  });
  if ("error" in result) throw new BusinessError(result.error!, result.status);
  return result.value;
}

export function saveProfile(state: DemoState, customerId: string, input: CompanyProfileInput) {
  assertEnglishInput(input);
  const customer = state.customers.find(c => c.id === customerId);
  if (!customer) throw new BusinessError("Customer not found.", 404);
  if (input.syntheticConfirmed !== true) throw new BusinessError("Confirm synthetic demo data only. This is not provenance verification.");
  if ((customer.profileVersion ?? 0) !== input.expectedVersion) throw new BusinessError("Company folder changed. Reload before saving.", 409);
  if (input.collectionEmail != null && !validMailbox(input.collectionEmail.trim()))
    throw new BusinessError("Enter one valid customer collection email address.");
  if (![input.industry, input.paymentHistory, input.profileSummary].every(s => s.trim()) ||
    !["A", "B", "C", "unknown"].includes(input.existingEsgRating)) throw new BusinessError("Complete the structured company information.");
  const before = JSON.stringify(customer);
  Object.assign(customer, { industry: input.industry.trim(), paymentHistory: input.paymentHistory.trim(),
    ...(input.collectionEmail !== undefined ? { collectionEmail: input.collectionEmail?.trim() ?? null } : {}),
    profileSummary: input.profileSummary.trim(), esgRating: input.existingEsgRating,
    profileVersion: (customer.profileVersion ?? 0) + 1, profileSource: "User-declared synthetic demo information - not independently verified" });
  audit(state, "Company information", "Imported existing synthetic rating and structured company profile. No ESG assessment or certification was performed.",
    customer.id, before, JSON.stringify(customer));
  return customer;
}
export function submitSedg(state: DemoState, customerId: string, input: SedgInput) {
  assertEnglishInput(input);
  if (!state.customers.some(c => c.id === customerId)) throw new BusinessError("Customer not found.", 404);
  if (input.syntheticConfirmed !== true) throw new BusinessError("Confirm synthetic demo data only.");
  if (![input.environmental, input.social, input.governance, input.sourceReference,
    input.repaymentWillingness, input.cashFlowAssessment, input.businessAssessment].every(s => s.trim()) ||
    !Number.isInteger(input.cooperationYears) || input.cooperationYears < 0 || input.cooperationYears > 200 ||
    !Number.isInteger(input.overdueCount) || input.overdueCount < 0 || input.overdueCount > 100000)
    throw new BusinessError("Complete all structured SEDG declaration fields.");
  const row: SedgSubmission = { id: `SEDG-${randomUUID()}`, customerId,
    repaymentWillingness: input.repaymentWillingness.trim(), cashFlowAssessment: input.cashFlowAssessment.trim(),
    cooperationYears: input.cooperationYears, overdueCount: input.overdueCount, businessAssessment: input.businessAssessment.trim(),
    environmental: input.environmental.trim(), social: input.social.trim(), governance: input.governance.trim(),
    sourceReference: input.sourceReference.trim(), source: "User-declared synthetic demo information - not verified",
    status: "Submitted - unverified", createdAt: now(), actor: "Demo Admin" };
  (state.sedgSubmissions ??= []).push(row);
  audit(state, "SEDG submission", "Recorded an unverified synthetic declaration. No document, identity, certification or ESG rating was verified or generated.",
    row.id, "", JSON.stringify(row));
  return row;
}

import { randomUUID } from "node:crypto";
import type { CompanyProfileInput, SedgInput, SedgSubmission } from "@workspace/api-zod";
import { type DemoState, BusinessError, now } from "./model";
import { assertEnglishInput } from "./language";
import { audit } from "./service";

export function saveProfile(state: DemoState, customerId: string, input: CompanyProfileInput) {
  assertEnglishInput(input);
  const customer = state.customers.find(c => c.id === customerId);
  if (!customer) throw new BusinessError("Customer not found.", 404);
  if (input.syntheticConfirmed !== true) throw new BusinessError("Confirm synthetic demo data only. This is not provenance verification.");
  if ((customer.profileVersion ?? 0) !== input.expectedVersion) throw new BusinessError("Company folder changed. Reload before saving.", 409);
  if (![input.industry, input.paymentHistory, input.profileSummary].every(s => s.trim()) ||
    !["A", "B", "C", "unknown"].includes(input.existingEsgRating)) throw new BusinessError("Complete the structured company information.");
  const before = JSON.stringify(customer);
  Object.assign(customer, { industry: input.industry.trim(), paymentHistory: input.paymentHistory.trim(),
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
  if (![input.environmental, input.social, input.governance, input.sourceReference].every(s => s.trim()))
    throw new BusinessError("Complete all structured SEDG declaration fields.");
  const row: SedgSubmission = { id: `SEDG-${randomUUID()}`, customerId,
    environmental: input.environmental.trim(), social: input.social.trim(), governance: input.governance.trim(),
    sourceReference: input.sourceReference.trim(), source: "User-declared synthetic demo information - not verified",
    status: "Submitted - unverified", createdAt: now(), actor: "Demo Admin" };
  (state.sedgSubmissions ??= []).push(row);
  audit(state, "SEDG submission", "Recorded an unverified synthetic declaration. No document, identity, certification or ESG rating was verified or generated.",
    row.id, "", JSON.stringify(row));
  return row;
}

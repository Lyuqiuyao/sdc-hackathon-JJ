import type { CollectionTask, CustomerReviewInput } from '@workspace/api-client-react';

export type ApprovalDraft = Pick<CollectionTask, 'id' | 'method' | 'noticeEn' | 'noticeMs' | 'noticeVariants'>;
export type ReviewForm = Pick<CustomerReviewInput, 'decision' | 'reason'>;
export type ReviewForms = Record<string, ReviewForm>;
type SavedReview = Pick<CustomerReviewInput, 'customerId' | 'decision'>;
export type ApprovalDrafts = { tasks: ApprovalDraft[]; notes: string; reviewForms?: ReviewForms; mergeReason?: string };

export function unsavedReviewForms(forms: ReviewForms, reviews: readonly SavedReview[] = []): ReviewForms {
  const saved = new Map(reviews.map(review => [review.customerId, review.decision]));
  // These are new-submission forms: the previous reason is displayed separately.
  // Their clean reason is empty; their clean selection is the saved decision.
  return Object.fromEntries(Object.entries(forms).filter(([id, form]) =>
    form.reason !== '' || form.decision !== (saved.get(id) ?? 'collect_now')));
}

// A successful explicit save consumes only its submitted draft. Keep other
// customers' inputs, and any text/selection changed while the request was pending.
export function remainingDecisionDrafts(
  forms: ReviewForms, mergeReason: string,
  submitted?: { customerId: string; form: ReviewForm } | { mergeReason: string },
) {
  const reviewForms = { ...forms };
  if (submitted && 'customerId' in submitted) {
    const current = reviewForms[submitted.customerId];
    if (current?.decision === submitted.form.decision && current.reason === submitted.form.reason)
      delete reviewForms[submitted.customerId];
  }
  return { reviewForms, mergeReason: submitted && 'mergeReason' in submitted && mergeReason === submitted.mergeReason ? '' : mergeReason };
}

// Tab-memory only, not a save: no server writes, localStorage or sessionStorage.
// Older browsers cannot cancel same-document history traversal. Retain drafts
// across route unmounts so returning to that plan cannot silently lose work.
const draftsByPlan = new Map<string, ApprovalDrafts>();
export const readApprovalDrafts = (planId: string) => draftsByPlan.get(planId);
export function retainApprovalDrafts(planId: string, drafts: ApprovalDrafts, dirty: boolean) {
  if (dirty) draftsByPlan.set(planId, drafts);
  else draftsByPlan.delete(planId);
}
export const clearApprovalDrafts = (planId: string) => draftsByPlan.delete(planId);

import type { CollectionTask } from '@workspace/api-client-react';

export type ApprovalDraft = Pick<CollectionTask, 'id' | 'method' | 'noticeEn' | 'noticeMs' | 'noticeVariants'>;
export type ApprovalDrafts = { tasks: ApprovalDraft[]; notes: string };

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

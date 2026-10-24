import test from 'node:test';
import assert from 'node:assert/strict';
import { clearApprovalDrafts, readApprovalDrafts, retainApprovalDrafts, remainingDecisionDrafts, unsavedReviewForms, type ReviewForms } from './approval-drafts.ts';

test('unsaved order, both notice languages and notes survive route unmounts, isolated by plan', () => {
  const drafts = { tasks: [
    { id: 'second', method: 'Email', noticeEn: 'Draft EN', noticeMs: 'Draft MS' },
    { id: 'first', method: 'Email', noticeEn: 'Other EN', noticeMs: 'Other MS' },
  ], notes: 'Unsaved approval notes' };
  retainApprovalDrafts('pending-one', drafts, true);
  assert.deepEqual(readApprovalDrafts('pending-one'), drafts);
  assert.equal(readApprovalDrafts('pending-two'), undefined);
  clearApprovalDrafts('pending-one');
  assert.equal(readApprovalDrafts('pending-one'), undefined);
});
test('reverting to server state removes the cached draft', () => {
  const drafts = { tasks: [], notes: 'Draft' };
  retainApprovalDrafts('reverted-plan', drafts, true);
  retainApprovalDrafts('reverted-plan', { tasks: [], notes: '' }, false);
  assert.equal(readApprovalDrafts('reverted-plan'), undefined);
});

test('customer reasons and selections compare independently against clean submission state', () => {
  const saved = [{ customerId: 'reviewed', decision: 'negotiable_extension' as const }];
  const forms: ReviewForms = {
    reviewed: { decision: 'negotiable_extension', reason: '' },
    pending: { decision: 'collect_now', reason: '' },
  };
  assert.deepEqual(unsavedReviewForms(forms, saved), {});
  forms.reviewed.decision = 'collect_now';
  assert.deepEqual(Object.keys(unsavedReviewForms(forms, saved)), ['reviewed']);
  forms.reviewed.decision = 'negotiable_extension';
  forms.pending.reason = ' '; // Even incomplete or whitespace-only input is not silently lost.
  assert.deepEqual(Object.keys(unsavedReviewForms(forms, saved)), ['pending']);
  forms.pending.reason = '';
  assert.deepEqual(unsavedReviewForms(forms, saved), {});
});

test('decision-only and reason-only drafts survive route unmounts in plan-isolated tab memory', () => {
  const drafts = { tasks: [], notes: '', reviewForms: {
    '2d-customer': { decision: 'negotiable_extension' as const, reason: '' },
    '3d-customer': { decision: 'collect_now' as const, reason: 'Needs review' },
  }, mergeReason: 'Proposed final order' };
  retainApprovalDrafts('review-drafts', drafts, true);
  assert.deepEqual(readApprovalDrafts('review-drafts'), drafts);
  assert.equal(readApprovalDrafts('other-plan'), undefined);
  retainApprovalDrafts('review-drafts', { tasks: [], notes: '', reviewForms: {}, mergeReason: '' }, false);
  assert.equal(readApprovalDrafts('review-drafts'), undefined);
});

test('saving one customer consumes only its submitted form, not other customers or final-order reason', () => {
  const forms: ReviewForms = {
    a: { decision: 'collect_now', reason: 'Save this reason' },
    b: { decision: 'negotiable_extension', reason: 'Still a draft' },
  };
  const remaining = remainingDecisionDrafts(forms, 'Keep this final reason', { customerId: 'a', form: { ...forms.a } });
  assert.deepEqual(remaining, { reviewForms: { b: forms.b }, mergeReason: 'Keep this final reason' });
  assert.equal(Object.keys(forms).length, 2, 'does not mutate live forms');
});

test('task saves consume no decision drafts; final-order saves consume only their reason', () => {
  const forms: ReviewForms = { a: { decision: 'collect_now', reason: 'Keep customer reason' } };
  assert.deepEqual(remainingDecisionDrafts(forms, 'Final reason'), { reviewForms: forms, mergeReason: 'Final reason' });
  assert.deepEqual(remainingDecisionDrafts(forms, 'Final reason', { mergeReason: 'Final reason' }), { reviewForms: forms, mergeReason: '' });
});

test('typing or changing a selection during an explicit save preserves the newer draft', () => {
  const submitted = { customerId: 'a', form: { decision: 'collect_now' as const, reason: 'Submitted' } };
  for (const form of [
    { decision: 'collect_now' as const, reason: 'New text' },
    { decision: 'negotiable_extension' as const, reason: 'Submitted' },
  ]) {
    assert.deepEqual(remainingDecisionDrafts({ a: form }, '', submitted).reviewForms, { a: form });
  }
  assert.equal(remainingDecisionDrafts({}, 'New final reason', { mergeReason: 'Submitted' }).mergeReason, 'New final reason');
});

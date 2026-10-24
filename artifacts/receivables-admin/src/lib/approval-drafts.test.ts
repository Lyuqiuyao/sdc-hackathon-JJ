import test from 'node:test';
import assert from 'node:assert/strict';
import { clearApprovalDrafts, readApprovalDrafts, retainApprovalDrafts } from './approval-drafts.ts';

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

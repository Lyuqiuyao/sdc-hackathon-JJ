import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalDraftWarning, installApprovalNavigationGuard, keepsApprovalDrafts } from './approval-navigation.ts';

const current = 'https://example.test/admin/approvals?plan=p1&queue=two_dimensional';
function fixture(modern = true) {
  const events = new EventTarget(), navigation = new EventTarget();
  let dirty = true, answer = false, prompts = 0, moves = 0;
  const pushState = () => { moves++; }, replaceState = () => { moves++; };
  const win = Object.assign(events, {
    location: new URL(current),
    history: { pushState, replaceState },
    confirm: () => { prompts++; return answer; },
    ...(modern ? { navigation } : {}),
  }) as unknown as Window;
  const cleanup = installApprovalNavigationGuard(win, () => dirty);
  const navigate = (url: string, cancelable = true) => {
    const event = Object.assign(new Event('navigate', { cancelable }), {
      destination: { url: new URL(url, current).href }, downloadRequest: null,
    });
    navigation.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { win, cleanup, navigate, setDirty: (v: boolean) => { dirty = v; },
    setAnswer: (v: boolean) => { answer = v; }, prompts: () => prompts, moves: () => moves,
    pushState, replaceState };
}
test('queue switches and hash changes keep drafts; leaving route or version does not', () => {
  const url = new URL(current);
  for (const next of ['?plan=p1&queue=three_dimensional', '#folder'])
    assert.equal(keepsApprovalDrafts(url, new URL(next, current)), true);
  for (const next of ['/admin/customers', '?plan=p2', 'https://other.test/admin/approvals?plan=p1'])
    assert.equal(keepsApprovalDrafts(url, new URL(next, current)), false);
});
test('navigation cancellation keeps the editor; explicit discard and clean state allow leaving', () => {
  const f = fixture();
  assert.equal(f.navigate('?plan=p1&queue=three_dimensional'), false);
  assert.equal(f.prompts(), 0);
  assert.equal(f.navigate('/admin/customers'), true);
  assert.equal(f.navigate('?plan=p2'), true);
  f.setAnswer(true);
  assert.equal(f.navigate('/admin/customers'), false);
  f.setDirty(false);
  assert.equal(f.navigate('/admin/settings'), false);
  assert.equal(f.prompts(), 3);
  f.cleanup();
  assert.equal(f.navigate('/admin/customers'), false);
});
test('reload/close warning follows dirty state and is removed on cleanup', () => {
  const f = fixture();
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    f.win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(unload(), true);
  f.setDirty(false); assert.equal(unload(), false);
  f.setDirty(true); f.cleanup(); assert.equal(unload(), false);
});
test('legacy Wouter history guards links and version selection, restoring original methods', () => {
  const f = fixture(false);
  f.win.history.replaceState(null, '', '?plan=p1&queue=three_dimensional');
  assert.equal(f.moves(), 1); assert.equal(f.prompts(), 0);
  f.win.history.replaceState(null, '', '?plan=p2');
  f.win.history.pushState(null, '', '/admin/settings');
  assert.equal(f.moves(), 1); assert.equal(f.prompts(), 2);
  f.setAnswer(true);
  f.win.history.pushState(null, '', '/admin/settings');
  assert.equal(f.moves(), 2);
  f.cleanup();
  assert.equal(f.win.history.pushState, f.pushState);
  assert.equal(f.win.history.replaceState, f.replaceState);
});

test('English warnings identify customer drafts and final-order reason separately from task edits', () => {
  const customer = approvalDraftWarning(false, true, false);
  assert.match(customer, /customer decision selections or reasons/);
  assert.doesNotMatch(customer, /queue order|final-order confirmation reason/);
  const finalOrder = approvalDraftWarning(false, false, true);
  assert.match(finalOrder, /final-order confirmation reason/);
  assert.doesNotMatch(finalOrder, /customer decision|queue order/);
  const all = approvalDraftWarning(true, true, true);
  for (const label of ['queue order', 'customer decision', 'final-order confirmation reason'])
    assert.ok(all.includes(label));
  assert.match(all, /not been submitted/);
});

test('guard uses live draft wording without prompting on queues or company-folder hashes', () => {
  const f = fixture();
  f.cleanup();
  let message = approvalDraftWarning(false, true, false), shown = '';
  f.win.confirm = text => { shown = text ?? ''; return false; };
  const cleanup = installApprovalNavigationGuard(f.win, () => true, () => message);
  assert.equal(f.navigate('?plan=p1&queue=three_dimensional'), false);
  assert.equal(f.navigate('#folder'), false);
  assert.equal(shown, '');
  assert.equal(f.navigate('/admin/settings'), true);
  assert.equal(shown, message);
  message = approvalDraftWarning(false, false, true);
  assert.equal(f.navigate('?plan=p2'), true);
  assert.equal(shown, message);
  const unload = new Event('beforeunload', { cancelable: true });
  f.win.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  cleanup();
});

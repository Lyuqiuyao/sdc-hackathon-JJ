export function approvalDraftWarning(taskEdits: boolean, customerReviews: boolean, finalOrderReason: boolean) {
  const drafts = [
    taskEdits && 'queue order, notices or plan notes',
    customerReviews && 'customer decision selections or reasons',
    finalOrderReason && 'the final-order confirmation reason',
  ].filter(Boolean).join('; ');
  return `You have unsaved changes to: ${drafts}. Leave without saving? These drafts have not been submitted and may be lost on refresh or close.`;
}
const warning = approvalDraftWarning(true, true, true);

// Queue tabs and hash changes keep the same mounted editor and its drafts.
export function keepsApprovalDrafts(current: URL, destination: URL) {
  return current.origin === destination.origin &&
    current.pathname === destination.pathname &&
    current.searchParams.get('plan') === destination.searchParams.get('plan');
}

type NavigationEvent = Event & { destination: { url: string }; downloadRequest: string | null };
type NavigationWindow = Window & { navigation?: EventTarget };

export function installApprovalNavigationGuard(win: Window, isDirty: () => boolean, getWarning = () => warning) {
  const canLeave = (destination: string) => !isDirty() ||
    keepsApprovalDrafts(new URL(win.location.href), new URL(destination, win.location.href)) ||
    win.confirm(getWarning());
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  win.addEventListener('beforeunload', beforeUnload);

  // The Navigation API can cancel Back/Forward before the router unmounts
  // the editor, without inserting synthetic entries into browser history.
  const navigation = (win as NavigationWindow).navigation;
  if (navigation) {
    const onNavigate = (event: Event) => {
      const next = event as NavigationEvent;
      if (next.cancelable && next.downloadRequest == null && !canLeave(next.destination.url))
        next.preventDefault();
    };
    navigation.addEventListener('navigate', onNavigate);
    return () => {
      navigation.removeEventListener('navigate', onNavigate);
      win.removeEventListener('beforeunload', beforeUnload);
    };
  }

  // Older browsers: protect Wouter links, programmatic navigation and plan
  // selection via its existing History API. Native unloads use beforeunload.
  // History traversal cannot be cancelled before unmount in these browsers;
  // the editor retains drafts in tab memory for restoration on return.
  const history = win.history;
  const push = history.pushState, replace = history.replaceState;
  const wrap = (original: History['pushState']): History['pushState'] =>
    function (data, unused, url) {
      if (url == null || canLeave(String(url))) original.call(history, data, unused, url);
    };
  const guardedPush = wrap(push), guardedReplace = wrap(replace);
  history.pushState = guardedPush;
  history.replaceState = guardedReplace;
  return () => {
    if (history.pushState === guardedPush) history.pushState = push;
    if (history.replaceState === guardedReplace) history.replaceState = replace;
    win.removeEventListener('beforeunload', beforeUnload);
  };
}

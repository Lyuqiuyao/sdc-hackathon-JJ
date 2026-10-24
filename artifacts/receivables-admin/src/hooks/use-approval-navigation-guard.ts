import { useEffect, useRef } from 'react';
import { installApprovalNavigationGuard } from '@/lib/approval-navigation';

export function useApprovalNavigationGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  const savedNavigation = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirty) return;
    return installApprovalNavigationGuard(window, () => dirtyRef.current && !savedNavigation.current);
  }, [dirty]);

  // Only the existing successful save/decision flow may switch versions
  // without a discard prompt. Failed requests never reach this callback.
  return (navigate: () => void) => {
    savedNavigation.current = true;
    try { navigate(); } finally { savedNavigation.current = false; }
  };
}

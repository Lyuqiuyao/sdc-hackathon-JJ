import { useEffect, useRef } from 'react';
import { installApprovalNavigationGuard } from '@/lib/approval-navigation';

export function useApprovalNavigationGuard(dirty: boolean, warning?: string) {
  const dirtyRef = useRef(dirty);
  const warningRef = useRef(warning);
  const savedNavigation = useRef(false);
  dirtyRef.current = dirty;
  warningRef.current = warning;
  useEffect(() => {
    if (!dirty) return;
    return installApprovalNavigationGuard(window, () => dirtyRef.current && !savedNavigation.current, () => warningRef.current ?? 'You have unsaved approval drafts. Leave without saving?');
  }, [dirty]);

  // Only the existing successful save/decision flow may switch versions
  // without a discard prompt. Failed requests never reach this callback.
  return (navigate: () => void) => {
    savedNavigation.current = true;
    try { navigate(); } finally { savedNavigation.current = false; }
  };
}

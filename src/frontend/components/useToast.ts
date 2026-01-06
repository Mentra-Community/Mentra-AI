import { useState, useCallback } from 'react';
import { ToastType } from './Toast';

export interface ToastState {
  show: boolean;
  message: string;
  type: ToastType;
}

/**
 * Hook for managing toast notifications
 * Usage:
 * const { toastState, showToast } = useToast();
 *
 * showToast('Success message', 'success');
 * showToast('Warning message', 'warning');
 * showToast('Error message', 'error');
 */
export function useToast() {
  const [toastState, setToastState] = useState<ToastState>({
    show: false,
    message: '',
    type: 'success'
  });

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToastState({
      show: true,
      message,
      type
    });
  }, []);

  const hideToast = useCallback(() => {
    setToastState(prev => ({
      ...prev,
      show: false
    }));
  }, []);

  return {
    toastState,
    showToast,
    hideToast
  };
}

export default useToast;

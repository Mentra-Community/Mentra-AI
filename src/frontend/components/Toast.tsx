import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export type ToastType = 'success' | 'warning' | 'error';

export interface ToastProps {
  show: boolean;
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

/**
 * Toast notification component with blur effect
 * Slides down from the top of the screen
 */
export function Toast({ show, message, type = 'success', duration = 3000, onClose }: ToastProps) {
  React.useEffect(() => {
    if (show && duration > 0 && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [show, duration, onClose]);

  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: '',
          border: '',
          text: '#111111',
          icon: '✓'
        };
      case 'warning':
        return {
          bg: 'bg-yellow-500/30',
          border: 'border-yellow-500',
          text: 'text-yellow-100',
          icon: '⚠'
        };
      case 'error':
        return {
          bg: 'bg-red-500/30',
          border: 'border-red-500',
          text: 'text-red-100',
          icon: '✕'
        };
      default:
        return {
          bg: 'bg-green-500/30',
          border: 'border-green-500',
          text: 'text-green-100',
          icon: '✓'
        };
    }
  };

  const styles = getTypeStyles();

  const toastContent = (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 30
          }}
          className="fixed bottom-2 left-0 right-0 flex justify-center px-6 !z-[9999]"
          style={{ willChange: 'transform, opacity' }}
        >
          <div
            className={`${styles.bg} border-[0.5px] border-[#c9c9c9] shadow-2xl px-6 py-2 w-full rounded-2xl text-[10px] bg-white/80`}
            style={{
              color: styles.text,
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)'
            }}
          >
            <div className="flex items-center justify-center gap-3">
              <span className="">{message}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(toastContent, document.body);
}

export default Toast;

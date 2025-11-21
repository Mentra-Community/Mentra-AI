import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WhiteMiraLogo from '../../public/figma-parth-assets/icons/white-mira-logo.svg';

interface BottomHeaderProps {
  isDarkMode: boolean;
  isVisible: boolean;
}

/**
 * Bottom header component that stays fixed at the bottom
 * with backdrop blur effect
 */
function BottomHeader({ isDarkMode, isVisible }: BottomHeaderProps): React.JSX.Element {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          className={`fixed bottom-0 left-0 right-0 h-[92px] flex items-center justify-center z-[200] backdrop-blur-[16px] ${
            isDarkMode ? 'bg-transparent/30' : 'bg-white/30'
          }`}
          style={{
            borderTop: ` ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`
          }}
        >
          <h2
            className="text-2xl font-semibold flex flex-col justify-center items-center"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            <img src={WhiteMiraLogo} alt="Mira Logo" className="w-[32px] h-[32px]" />
            <div className='text-[16px] font-semibold mt-[4px] text-white'>start with "Hey Mira"</div>
          </h2>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default BottomHeader;

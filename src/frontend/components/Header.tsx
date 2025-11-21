import React from 'react';
import { Settings, Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface HeaderProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onSettingsClick: () => void;
}

/**
 * Header component with Settings and Dark Mode toggle buttons
 */
function Header({ isDarkMode, onToggleDarkMode, onSettingsClick }: HeaderProps): React.JSX.Element {
  return (
    <div className="w-full h-[72px] flex items-center justify-between px-[24px] relative z-50">
      {/* Settings Button - Left */}
      <button
        onClick={onSettingsClick}
        className="w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all duration-300 hover:opacity-80 hover:scale-110"
        style={{ backgroundColor: 'var(--primary-foreground)' }}
      >
        <Settings className="w-[20px] h-[20px]" style={{ color: 'var(--secondary-foreground)' }} />
      </button>

      {/* Dark Mode Toggle - Right */}
      <button
        onClick={onToggleDarkMode}
        className="w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all duration-300 hover:opacity-80 hover:scale-110"
        style={{ backgroundColor: 'var(--primary-foreground)' }}
      >
        <AnimatePresence mode="wait">
          {isDarkMode ? (
            <motion.div
              key="moon-icon"
              initial={{ opacity: 0, scale: 0.8, rotate: -180 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.8, rotate: 180 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            >
              <Moon className="w-[20px] h-[20px]" style={{ color: 'var(--secondary-foreground)' }} />
            </motion.div>
          ) : (
            <motion.div
              key="sun-icon"
              initial={{ opacity: 0, scale: 0.8, rotate: 180 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.8, rotate: -180 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            >
              <Sun className="w-[20px] h-[20px]" style={{ color: 'var(--secondary-foreground)' }} />
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}

export default Header;

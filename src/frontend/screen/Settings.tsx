import React from 'react';
import { motion } from 'framer-motion';
import Header from '../components/Header';

interface SettingsProps {
  onBack: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

/**
 * Settings page component
 * Displays settings options and allows navigation back to chat
 */
function Settings({ onBack, isDarkMode, onToggleDarkMode }: SettingsProps): React.JSX.Element {
  return (
    <div className={`h-screen flex flex-col ${isDarkMode ? 'dark' : ''}`} style={{ backgroundColor: 'var(--background)' }}>
      {/* Header */}
      <Header
        isDarkMode={isDarkMode}
        onToggleDarkMode={onToggleDarkMode}
        onSettingsClick={onBack}
      />

      {/* Settings Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-[24px] pt-[32px]"
      >
        {/* Model Setting Row */}
        <div
          className="flex items-center justify-between px-[24px] py-[20px] rounded-[16px]"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <span
            className="text-[18px] font-medium"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Model
          </span>
          <span
            className="text-[18px] font-medium"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Gemini Flash Lite 4.0
          </span>
        </div>
      </motion.div>
    </div>
  );
}

export default Settings;

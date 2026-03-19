import React from 'react';
import { Settings, Menu, ArrowLeft } from 'lucide-react';

interface HeaderProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
  showBackArrow?: boolean;
}

/**
 * Header component with Menu button (left) and Settings button (right)
 */
function Header({
  onSettingsClick,
  onMenuClick,
  showMenuButton = true,
  showBackArrow = false
}: HeaderProps) {
  return (
    <div className="w-full h-[72px] flex items-center justify-between px-[24px] relative z-10">
      {/* Left side - Menu button or Back arrow or spacer */}
      {showBackArrow ? (
        <button
          onClick={onSettingsClick}
          className="w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all duration-300 hover:opacity-80 hover:scale-110"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <ArrowLeft className="w-[20px] h-[20px]" style={{ color: 'var(--secondary-foreground)' }} />
        </button>
      ) : showMenuButton ? (
        <button
          onClick={onMenuClick}
          className="w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all duration-300 hover:opacity-80 hover:scale-110"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <Menu className="w-[20px] h-[20px]" style={{ color: 'var(--secondary-foreground)' }} />
        </button>
      ) : (
        <div className="w-[40px] h-[40px]" />
      )}

      {/* Right side - Settings Button or spacer */}
      {showBackArrow ? (
        <div className="w-[40px] h-[40px]" />
      ) : (
        <button
          onClick={onSettingsClick}
          className="mt-[25px] w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all duration-300 hover:opacity-80 hover:scale-110"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <Settings className="w-[20px] h-[20px]" style={{ color: 'var(--secondary-foreground)' }} />
        </button>
      )}
    </div>
  );
}

export default Header;

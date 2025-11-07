import React from 'react';
import './MiraBackgroundAnimation.css';

interface MiraBackgroundAnimationProps {
  className?: string;
}

export const MiraBackgroundAnimation: React.FC<MiraBackgroundAnimationProps> = ({ className }) => {
  return (
    <div className={`mira-background h-full ${className || ''}`}>
      <div className="mira-bg-container">
        {/* Blue circle - top right */}
        <div className="mira-circle mira-circle-1"></div>

        {/* Pink circle - bottom left */}
        <div className="mira-circle mira-circle-2"></div>

        {/* Red circle - bottom center */}
        <div className="mira-circle mira-circle-3"></div>

        {/* Green gradient circle - right side */}
        <div className="mira-circle mira-circle-4"></div>

        {/* Purple circle - top left */}
        <div className="mira-circle mira-circle-5"></div>
      </div>
    </div>
  );
};
